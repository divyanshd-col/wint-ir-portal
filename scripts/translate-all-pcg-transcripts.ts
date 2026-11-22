import './_load-env';
import { query } from '../lib/cx/db';
import { readConfig } from '../lib/config';
import { getIQSGeminiKeys, geminiGenerate } from '../lib/gemini';

interface TranscriptTurn {
  turnIndex: number;
  speaker: 'RM' | 'Customer';
  time: string;
  text: string;
  translated?: boolean;
}

function hasNonEnglish(text: string): boolean {
  if (!text) return false;
  // Non-ASCII characters (Devanagari, Tamil, Telugu, Gujarati, Marathi, etc.)
  if (/[\u0900-\u0D7F]/.test(text)) return true;
  // Common Romanized Hinglish patterns
  const hinglishPattern = /\b(haan|nahi|nahin|kya|toh|karna|bol raha|accha|theek|bhi|aur|kaise|mera|aapka|sir ji|bataiye|samajh|paise|rupaye|boliye|kariye|dekh lijiye|batata hoon|kar deta hoon)\b/i;
  return hinglishPattern.test(text);
}

function isCallNeedingTranslation(turns: TranscriptTurn[]): boolean {
  if (!Array.isArray(turns) || turns.length === 0) return false;
  return turns.some(t => hasNonEnglish(t.text));
}

async function translateTurnsWithGemini(
  turns: TranscriptTurn[],
  keys: string[]
): Promise<TranscriptTurn[]> {
  const prompt = `You are an expert translator specializing in Indian financial sales conversations.
Translate the following dialogue turns into natural, fluent English.
Keep all existing English speech, financial terms, and numbers exact.
Translate all Hindi, Hinglish, or regional Indian language dialogue into clear, professional English.
Preserve the speaker ('RM' or 'Customer'), the timestamp ('time'), and the 'turnIndex'.
Preserve brand names like 'Wint Wealth', customer names, RM names, and specific numbers/dates.

Dialogue turns to translate:
${JSON.stringify(turns, null, 2)}

Return ONLY valid JSON matching this schema:
[
  {
    "turnIndex": number,
    "speaker": "RM" | "Customer",
    "time": "MM:SS",
    "text": "fluent English translation..."
  }
]`;

  const raw = await geminiGenerate(keys, 'gemini-2.5-flash', [{ text: prompt }], undefined, 90_000);
  const cleaned = raw.replace(/```json/g, '').replace(/```/g, '').trim();
  const parsed = JSON.parse(cleaned);

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('Gemini returned empty or invalid translation array');
  }

  return parsed.map((t: any, idx: number) => ({
    turnIndex: t.turnIndex || (idx + 1),
    speaker: t.speaker === 'Customer' ? 'Customer' : 'RM',
    time: t.time || turns[idx]?.time || '00:00',
    text: t.text || turns[idx]?.text || '',
    translated: true
  }));
}

function translateParameterQuotes(params: Record<string, any>, translatedTurns: TranscriptTurn[]) {
  if (!params || typeof params !== 'object') return params;
  const updated = { ...params };
  for (const [key, p] of Object.entries(updated)) {
    if (p && typeof p === 'object' && p.quote && hasNonEnglish(p.quote)) {
      // Find closest turn or note translated quote
      const matchingTurn = translatedTurns.find(t => t.turnIndex === p.turnIndex);
      if (matchingTurn) {
        updated[key] = { ...p, quote: matchingTurn.text };
      }
    }
  }
  return updated;
}

async function main() {
  console.log('🚀 Starting Non-English Call Transcript Translation to English...\n');

  const config = await readConfig();
  const keys = getIQSGeminiKeys(config);
  if (!keys || keys.length === 0) {
    throw new Error('No Gemini API keys found in config');
  }
  console.log(`✓ Loaded ${keys.length} Gemini API keys for translation.`);

  // 1. Fetch PCG calls
  console.log('Fetching evaluated PCG calls from database...');
  const pcgCalls = await query<any>(`
    SELECT call_id, rm_name, transcript_turns, parameters
    FROM pcg_call_evaluations
    WHERE transcript_turns IS NOT NULL
      AND jsonb_array_length(CASE WHEN jsonb_typeof(transcript_turns::jsonb) = 'array' THEN transcript_turns::jsonb ELSE '[]'::jsonb END) > 0
    ORDER BY scored_at DESC
  `);
  console.log(`Total evaluated PCG calls in DB: ${pcgCalls.length}`);

  const callsToTranslate: any[] = [];
  for (const c of pcgCalls) {
    let turns = c.transcript_turns;
    if (typeof turns === 'string') {
      try { turns = JSON.parse(turns); } catch { turns = []; }
    }
    if (isCallNeedingTranslation(turns)) {
      callsToTranslate.push({ ...c, parsedTurns: turns });
    }
  }

  console.log(`\n🎯 Found ${callsToTranslate.length} PCG calls with non-English / Hindi / Hinglish content needing translation.`);

  // Process in concurrent batches
  const CONCURRENCY = 4;
  let completed = 0;
  let errors = 0;

  for (let i = 0; i < callsToTranslate.length; i += CONCURRENCY) {
    const chunk = callsToTranslate.slice(i, i + CONCURRENCY);
    await Promise.all(
      chunk.map(async (call) => {
        try {
          const translatedTurns = await translateTurnsWithGemini(call.parsedTurns, keys);
          
          let params = call.parameters;
          if (typeof params === 'string') {
            try { params = JSON.parse(params); } catch { params = null; }
          }
          const updatedParams = params ? translateParameterQuotes(params, translatedTurns) : null;

          await query(`
            UPDATE pcg_call_evaluations
            SET transcript_turns = $1,
                parameters = COALESCE($2, parameters),
                updated_at = NOW()
            WHERE call_id = $3
          `, [
            JSON.stringify(translatedTurns),
            updatedParams ? JSON.stringify(updatedParams) : null,
            call.call_id
          ]);

          completed++;
          console.log(`[${completed}/${callsToTranslate.length}] ✓ Translated call ${call.call_id} (RM: ${call.rm_name}, ${translatedTurns.length} turns)`);
        } catch (err: any) {
          errors++;
          console.error(`[ERROR] Failed to translate call ${call.call_id}:`, err.message);
        }
      })
    );
  }

  console.log(`\n🎉 PCG Translation Complete! ${completed} calls translated to English, ${errors} errors.`);

  // 2. Also check and translate regular CX call_recordings with Devanagari
  console.log('\nChecking regular CX call_recordings for non-English transcripts...');
  const cxCalls = await query<any>(`
    SELECT id, transcript
    FROM call_recordings
    WHERE transcript::text ~ '[\\u0900-\\u097F]'
  `);
  console.log(`Found ${cxCalls.length} CX call recordings with Devanagari script.`);

  let cxCompleted = 0;
  for (const rec of cxCalls) {
    try {
      let segments = rec.transcript;
      if (typeof segments === 'string') {
        try { segments = JSON.parse(segments); } catch { segments = []; }
      }
      if (!Array.isArray(segments) || segments.length === 0) continue;

      const speechTurns = segments
        .filter((s: any) => s.type === 'speech' && s.text)
        .map((s: any, idx: number) => ({
          turnIndex: idx + 1,
          speaker: s.speaker === 'INVESTOR' ? ('Customer' as const) : ('RM' as const),
          time: s.ts || '00:00',
          text: s.text
        }));

      if (!isCallNeedingTranslation(speechTurns)) continue;

      const translatedTurns = await translateTurnsWithGemini(speechTurns, keys);

      let turnIdx = 0;
      const updatedSegments = segments.map((seg: any) => {
        if (seg.type === 'speech') {
          const trans = translatedTurns[turnIdx++];
          return {
            ...seg,
            text: trans?.text || seg.text,
            translated: true
          };
        }
        return seg;
      });

      await query(`
        UPDATE call_recordings
        SET transcript = $1, updated_at = NOW()
        WHERE id = $2
      `, [JSON.stringify(updatedSegments), rec.id]);

      cxCompleted++;
      console.log(`[CX ${cxCompleted}/${cxCalls.length}] ✓ Translated call recording ${rec.id}`);
    } catch (err: any) {
      console.error(`[CX ERROR] Failed to translate call recording ${rec.id}:`, err.message);
    }
  }

  console.log(`\n✨ All non-English transcripts successfully translated to English!`);
}

main().catch((err) => {
  console.error('Fatal translation error:', err);
  process.exit(1);
});

