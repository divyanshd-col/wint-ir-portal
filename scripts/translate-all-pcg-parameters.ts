import './_load-env';
import { query } from '../lib/cx/db';
import { readConfig } from '../lib/config';
import { getIQSGeminiKeys, geminiGenerate } from '../lib/gemini';

function hasNonEnglish(text: string): boolean {
  if (!text) return false;
  if (/[\u0900-\u0D7F]/.test(text)) return true;
  const hinglishPattern = /\b(haan|nahi|nahin|kya|toh|karna|bol raha|accha|theek|bhi|aur|kaise|mera|aapka|sir ji|bataiye|samajh|paise|rupaye|boliye|kariye|dekh lijiye|batata hoon|kar deta hoon|bhaiya|bhai|humne|humara|dala|matlab|kaunse|apne|baat kar|is cheez|hume pata)\b/i;
  return hinglishPattern.test(text);
}

function areParametersNeedingTranslation(params: any): boolean {
  if (!params) return false;
  if (Array.isArray(params)) {
    return params.some((p: any) =>
      hasNonEnglish(p?.explanation || '') ||
      hasNonEnglish(p?.quote || '') ||
      hasNonEnglish(p?.reasoning || '')
    );
  }
  if (typeof params === 'object') {
    return Object.values(params).some((p: any) =>
      hasNonEnglish(p?.explanation || '') ||
      hasNonEnglish(p?.quote || '') ||
      hasNonEnglish(p?.reasoning || '')
    );
  }
  return false;
}

async function translateParameters(params: any, keys: string[]): Promise<any> {
  const isArr = Array.isArray(params);
  const prompt = `You are a QA Quality Auditor and Translation Specialist for Wint Wealth.
The following QA evaluation parameter objects contain dialogue citations in Hindi, Hinglish, or regional speech in their "explanation", "reasoning", or "quote" fields (e.g., 'Theek hai, bhaiya', 'Pura HNI ka hi aaya', 'Aap Ahaan se baat kar sakte ho', 'Happy Dhanteras, bhai', etc.).

TASK:
- Translate all non-English / Hindi / Hinglish dialogue quotes, phrases, and words into fluent, natural English.
- Example: "Turn 50 [RM] ('Theek hai, bhaiya. Okay, aur kuch ho toh batana.')" -> "Turn 50 [RM] ('All right, brother. Okay, let me know if there is anything else.')"
- Example: "Turn 34 [RM] ('Pura HNI ka hi aaya. Matlab humara toh 20 Cr humne jo dala tha wo tha.')" -> "Turn 34 [RM] ('It was entirely from HNIs. Meaning, the 20 Cr that we had contributed was that.')"
- Example: "Turn 48 [RM] ('Aap Ahaan se baat kar sakte ho is cheez ke liye')" -> "Turn 48 [RM] ('You can speak to Ahaan regarding this')"
- Example: "Turn 3 [RM] ('Ha ha, Happy Dhanteras, bhai.')" -> "Turn 3 [RM] ('Ha ha, Happy Dhanteras, brother.')"
- Keep all parameter IDs, names, maxScores, earnedScores, and statuses ('Yes', 'Half', 'No', 'NA') exactly unchanged.
- Return ONLY the updated JSON matching the exact input structure.

Input Parameters JSON:
${JSON.stringify(params, null, 2)}`;

  const raw = await geminiGenerate(keys, 'gemini-2.5-flash', [{ text: prompt }], undefined, 90_000);
  const cleaned = raw.replace(/```json/g, '').replace(/```/g, '').trim();
  const parsed = JSON.parse(cleaned);

  if (isArr && (!Array.isArray(parsed) || parsed.length !== params.length)) {
    throw new Error('Gemini returned invalid or mismatched parameter array');
  }

  return parsed;
}

async function main() {
  console.log('🚀 Checking for PCG Call Parameters needing English Translation...\n');
  const config = await readConfig();
  const geminiKeys = getIQSGeminiKeys(config);
  if (!geminiKeys || geminiKeys.length === 0) {
    console.error('❌ No Gemini API keys found in config.');
    process.exit(1);
  }
  console.log(`✓ Loaded ${geminiKeys.length} Gemini API keys.`);

  const rows = await query(`
    SELECT call_id, rm_name, parameters
    FROM pcg_call_evaluations
    WHERE parameters IS NOT NULL
    ORDER BY scored_at DESC
  `);

  console.log(`Total evaluated calls in DB: ${rows.length}`);

  const callsToTranslate: Array<{ call_id: string; rm_name: string; parameters: any[] }> = [];

  for (const row of rows) {
    let params = row.parameters;
    if (typeof params === 'string') {
      try { params = JSON.parse(params); } catch { continue; }
    }
    if (areParametersNeedingTranslation(params)) {
      callsToTranslate.push({
        call_id: row.call_id,
        rm_name: row.rm_name,
        parameters: params,
      });
    }
  }

  console.log(`🎯 Found ${callsToTranslate.length} calls with non-English quotes in their parameters.\n`);

  if (callsToTranslate.length === 0) {
    console.log('✨ All call parameters are already 100% in English! No action needed.');
    process.exit(0);
  }

  let successCount = 0;
  let errorCount = 0;

  for (let i = 0; i < callsToTranslate.length; i++) {
    const item = callsToTranslate[i];
    const key = geminiKeys[i % geminiKeys.length];

    try {
      const translatedParams = await translateParameters(item.parameters, [key]);

      await query(`
        UPDATE pcg_call_evaluations
        SET parameters = $1, updated_at = NOW()
        WHERE call_id = $2
      `, [JSON.stringify(translatedParams), item.call_id]);

      successCount++;
      console.log(`[${i + 1}/${callsToTranslate.length}] ✓ Translated parameters for call ${item.call_id} (RM: ${item.rm_name})`);
    } catch (err: any) {
      errorCount++;
      console.error(`[ERROR] Failed to translate call ${item.call_id}: ${err.message}`);
    }

    // Small delay to prevent rate limit spikes
    await new Promise((r) => setTimeout(r, 600));
  }

  console.log(`\n🎉 Translation Complete! ${successCount} calls updated with 100% English parameters, ${errorCount} errors.`);
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal translation error:', err);
  process.exit(1);
});
