import { geminiGenerate } from '@/lib/gemini';
import type { ConversationTranscript } from './transcript-reader';

const PROMPT = `You are summarising a batch of customer service conversations for a CX analytics system.
Analysis goal: {INTENT}

Write a single concise paragraph (5-8 sentences) covering:
- The main issues or questions raised by customers
- Overall customer sentiment (frustrated / neutral / positive)
- How agents handled these conversations
- Patterns or themes relevant to the analysis goal

Be specific — use rough numbers where you can (e.g. "roughly half of customers...").
Synthesise across all conversations; do not list them individually.`;

export async function miniSummarizeTranscripts(
  transcripts: ConversationTranscript[],
  intent: string,
  keys: string[],
): Promise<string> {
  const formatted = transcripts.map((t, i) => {
    const msgs = t.messages
      .slice(0, 15)
      .map(m => `  [${m.sender_type}] ${m.content.slice(0, 300)}`)
      .join('\n');
    return `--- Chat ${i + 1} | CSAT: ${t.csat_label ?? 'N/A'} | IQS: ${t.iqs_score ?? 'N/A'} | Disposition: ${t.disposition ?? 'unclassified'}\n${msgs}`;
  }).join('\n\n');

  try {
    const result = await geminiGenerate(
      keys,
      'gemini-2.5-flash',
      [{ role: 'user', parts: [{ text: formatted }] }],
      {
        systemInstruction: { parts: [{ text: PROMPT.replace('{INTENT}', intent) }] },
        config: { thinkingConfig: { thinkingBudget: 0 } },
      },
      20_000,
    );
    return result.trim();
  } catch {
    return `[Summary unavailable for ${transcripts.length} conversations in this batch]`;
  }
}
