import { geminiGenerate } from '@/lib/gemini';
import type { ConversationTranscript } from './transcript-reader';

const PROMPT = `You are summarising a batch of customer service conversations for a senior CX analyst at Wint Wealth.
Analysis goal: {INTENT}

Write a single analytical paragraph (5-8 sentences). Go beyond surface description — identify patterns, concentrations, and anomalies.

Cover:
- The dominant theme or issue in this batch (name it specifically, with rough frequency: "~8 of 20 customers...")
- Customer sentiment and what specifically triggers it (not just "frustrated" — what causes it)
- How agents handled it: what worked, what didn't, where conversations broke down or escalated
- Any outliers or surprising cases that don't fit the dominant pattern
- Resolution rate and what determines whether a chat resolves or escalates

Be specific and use numbers. Synthesise across all conversations — do not list them individually.`;

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
      'gemini-3.5-flash',
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
