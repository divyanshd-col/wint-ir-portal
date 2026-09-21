import { query } from '@/lib/cx/db';
import { readConfig } from '@/lib/config';
import { geminiGenerate, getOrderedGeminiKeys } from '@/lib/gemini';
import { logLlmTokenUsage } from '@/lib/token-tracker';

export interface KBSuggestionResult {
  category: string;
  question: string;
  chat_ids: string[];
  agent_answer: string;
  suggested_kb_content: string;
  tag: 'Educational' | 'Non-Educational';
  week_number: string;
  target_kb: string;
  chat_type: 'Bot Handled' | 'Transferred to Agent';
}

export interface GeneratorOptions {
  targetDate?: Date | string;
  dryRun?: boolean;
  limit?: number;
  concurrency?: number;
}

const TARGET_KB_DOCUMENTS = [
  'SEBI KYC',
  'Account Deletion',
  'Profile section',
  'Sign up and Login',
  'Liquidity',
  'Taxation',
  'SIP',
  'Repayment',
  'Basics of bonds',
  'Asset details page',
  'Asset listing page',
  'Dashboard - Investment',
  'Reports and Documents',
  'AIF',
  'Flexi Investments',
  'KB main',
] as const;

const ALLOWED_CATEGORIES = [
  'KYC',
  'SIP',
  'Interest Repayment',
  'Liquidity',
  'Taxation',
  'Asset',
] as const;

/**
 * Computes week boundaries (Monday 00:00:00 UTC to Sunday 23:59:59.999 UTC)
 * and formats week_number e.g. "Week 39, 2026 (Sep 21 - 27)".
 */
export function getWeekBounds(target?: Date | string): {
  weekStart: string;
  weekEnd: string;
  weekNumber: string;
  mondayDate: Date;
} {
  let baseDate: Date;
  if (target) {
    baseDate = typeof target === 'string' ? new Date(target) : target;
  } else {
    // Default to last completed week (7 days ago)
    baseDate = new Date();
    baseDate.setUTCDate(baseDate.getUTCDate() - 7);
  }

  const day = baseDate.getUTCDay();
  const diff = baseDate.getUTCDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(Date.UTC(baseDate.getUTCFullYear(), baseDate.getUTCMonth(), diff, 0, 0, 0, 0));
  const sunday = new Date(Date.UTC(monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate() + 6, 23, 59, 59, 999));

  // Compute ISO week number
  const d = new Date(Date.UTC(monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);

  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const startMonth = months[monday.getUTCMonth()];
  const endMonth = months[sunday.getUTCMonth()];

  const dateRangeStr =
    startMonth === endMonth
      ? `${startMonth} ${monday.getUTCDate()} - ${sunday.getUTCDate()}`
      : `${startMonth} ${monday.getUTCDate()} - ${endMonth} ${sunday.getUTCDate()}`;

  const weekNumber = `Week ${weekNo}, ${monday.getUTCFullYear()} (${dateRangeStr})`;

  return {
    weekStart: monday.toISOString(),
    weekEnd: sunday.toISOString(),
    weekNumber,
    mondayDate: monday,
  };
}

/**
 * Formats transcript messages into readable text for the LLM prompt.
 */
function formatTranscriptText(transcript: any): string {
  let msgs: any[] = [];
  if (Array.isArray(transcript)) {
    msgs = transcript;
  } else if (Array.isArray(transcript?.messages)) {
    msgs = transcript.messages;
  }

  return msgs
    .filter((m) => m && m.content && !m.is_internal)
    .map((m) => {
      const sender = m.sender_type === 'customer' ? 'Customer' : m.sender_name || 'Agent/Bot';
      return `${sender}: ${m.content}`;
    })
    .slice(0, 35)
    .join('\n');
}

/**
 * Prompts Gemini to analyze a conversation and synthesize a KB draft suggestion.
 */
async function extractKBSuggestionFromChat(
  chat: {
    id: string;
    conversation_type: string;
    disposition: string;
    sub_disposition: string;
    transcript: any;
  },
  keys: string[],
  weekNumber: string
): Promise<KBSuggestionResult | null> {
  const transcriptText = formatTranscriptText(chat.transcript);
  if (!transcriptText || transcriptText.length < 50) return null;

  const chatType: 'Bot Handled' | 'Transferred to Agent' =
    chat.conversation_type === 'bot' ? 'Bot Handled' : 'Transferred to Agent';

  const prompt = `You are a Senior Knowledge Base Architect and CX Quality Specialist for Wint Wealth (an Indian fixed-income and bond investment platform).
Your task is to analyze a resolved customer chat and determine if it contains an educational inquiry that belongs in the official Wint Wealth Knowledge Base (KB).

CONVERSATION CONTEXT:
Chat ID: #${chat.id}
Type: ${chatType}
Disposition Category: ${chat.disposition || 'Uncategorized'}
Sub-disposition: ${chat.sub_disposition || 'General'}

TRANSCRIPT:
${transcriptText}

KNOWLEDGE BASE TARGET DOCUMENTS:
${TARGET_KB_DOCUMENTS.map((doc) => `- "${doc}"`).join('\n')}

VALID CATEGORIES:
${ALLOWED_CATEGORIES.join(', ')}

INSTRUCTIONS:
1. Determine if the customer asked a real question or experienced an issue regarding bonds, KYC, repayments, Form 121/taxes, SIP, liquidity/selling bonds, or account management.
2. If the chat is trivial (e.g. only greetings, payment link without query, wrong number), return:
   {"has_suggestion": false}
3. If it is an educational or operational query:
   - "question": Formulate a clear, concise, generalized title of the customer's question (e.g. "How can I submit Form 121 for my bond investments to claim TDS exemption?").
   - "agent_answer": Summarize the factual answer provided by the agent/bot in this chat, prefixed with "[Chat #${chat.id}]: ". Include exact amounts, dates, or steps mentioned.
   - "suggested_kb_content": Draft a professional, production-ready Knowledge Base section in clean Markdown (use ## headings, bullet points, numbered steps, bold emphasis, and clear troubleshooting instructions).
   - "target_kb": Pick the single most accurate document from the TARGET DOCUMENTS list above.
   - "category": Pick the single most accurate category from VALID CATEGORIES.

RESPOND ONLY WITH VALID JSON IN THIS EXACT FORMAT (NO CODEBLOCK FENCES):
{
  "has_suggestion": true,
  "category": "KYC",
  "question": "...",
  "agent_answer": "[Chat #${chat.id}]: ...",
  "suggested_kb_content": "## ...\\n\\n### Overview\\n...\\n\\n### Key Steps\\n* ...",
  "target_kb": "SEBI KYC"
}`;

  try {
    const t0 = Date.now();
    const raw = await geminiGenerate(
      keys,
      'gemini-3.5-flash',
      [{ role: 'user', parts: [{ text: prompt }] }],
      { config: { temperature: 0.2 } },
      45_000
    );
    const latencyMs = Date.now() - t0;

    const cleaned = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
    const parsed = JSON.parse(cleaned);

    if (!parsed.has_suggestion) return null;
    if (!parsed.question || !parsed.suggested_kb_content) return null;

    // Log token analytics
    logLlmTokenUsage({
      jobType: 'analytics_insight_synthesizer',
      modelName: 'gemini-3.5-flash',
      inputTokens: Math.ceil(prompt.length / 4),
      outputTokens: Math.ceil(raw.length / 4),
      entityId: chat.id,
      userEmail: 'system:cron',
      latencyMs,
    }).catch(() => {});

    // Ensure valid target KB and category
    const matchedKB = TARGET_KB_DOCUMENTS.find(
      (k) => k.toLowerCase() === String(parsed.target_kb).toLowerCase()
    ) || 'General KB';

    const matchedCategory = ALLOWED_CATEGORIES.find(
      (c) => c.toLowerCase() === String(parsed.category).toLowerCase()
    ) || chat.disposition || 'KYC';

    return {
      category: matchedCategory,
      question: String(parsed.question).trim(),
      chat_ids: [chat.id],
      agent_answer: String(parsed.agent_answer || `[Chat #${chat.id}]: Resolved query`).trim(),
      suggested_kb_content: String(parsed.suggested_kb_content).trim(),
      tag: 'Educational',
      week_number: weekNumber,
      target_kb: matchedKB,
      chat_type: chatType,
    };
  } catch (err: any) {
    console.warn(`[kb-generator] Failed to process chat #${chat.id}:`, err.message);
    return null;
  }
}

/**
 * Main function to generate and insert weekly KB draft suggestions.
 */
export async function generateWeeklyKBSuggestions(options: GeneratorOptions = {}): Promise<{
  ok: boolean;
  weekNumber: string;
  weekStart: string;
  weekEnd: string;
  candidatesFound: number;
  suggestionsGenerated: number;
  suggestionsInserted: number;
  results: KBSuggestionResult[];
}> {
  const { weekStart, weekEnd, weekNumber } = getWeekBounds(options.targetDate);
  const maxSuggestions = options.limit || 40;
  const concurrency = options.concurrency || 4;

  console.log(`[kb-generator] Starting generation for ${weekNumber} (${weekStart} to ${weekEnd})`);

  // 1. Fetch candidate conversations that are not already present in kb_draft_suggestions
  const candidates = await query<any>(
    `
    SELECT
      c.id,
      c.conversation_type,
      c.tags->>'disposition' AS disposition,
      c.tags->>'sub_disposition' AS sub_disposition,
      c.transcript,
      c.csat_label
    FROM conversations c
    WHERE c.closed_at >= $1::timestamptz
      AND c.closed_at <= $2::timestamptz
      AND c.tags->>'disposition' = ANY($3::text[])
      AND jsonb_array_length(c.transcript) >= 6
      AND NOT EXISTS (
        SELECT 1 FROM kb_draft_suggestions k WHERE k.chat_ids @> to_jsonb(c.id)
      )
    ORDER BY c.closed_at DESC
    LIMIT 200
    `,
    [
      weekStart,
      weekEnd,
      ['KYC', 'SIP', 'Interest Repayment', 'Liquidity', 'Taxation', 'Asset'],
    ]
  );

  console.log(`[kb-generator] Found ${candidates.length} candidate conversations`);

  if (candidates.length === 0) {
    return {
      ok: true,
      weekNumber,
      weekStart,
      weekEnd,
      candidatesFound: 0,
      suggestionsGenerated: 0,
      suggestionsInserted: 0,
      results: [],
    };
  }

  // 2. Select diverse candidates across dispositions and sub-dispositions
  const groupedBySub = new Map<string, any[]>();
  for (const c of candidates) {
    const key = `${c.disposition || 'Other'}::${c.sub_disposition || 'Other'}`;
    const list = groupedBySub.get(key) || [];
    list.push(c);
    groupedBySub.set(key, list);
  }

  const selectedCandidates: any[] = [];
  // Round-robin selection across sub-dispositions up to maxSuggestions
  let added = true;
  let round = 0;
  while (added && selectedCandidates.length < maxSuggestions && round < 3) {
    added = false;
    for (const [, list] of groupedBySub.entries()) {
      if (list[round] && selectedCandidates.length < maxSuggestions) {
        selectedCandidates.push(list[round]);
        added = true;
      }
    }
    round++;
  }

  console.log(`[kb-generator] Selected ${selectedCandidates.length} diverse candidates for LLM processing`);

  // 3. Load Gemini API keys
  const config = await readConfig();
  const keys = getOrderedGeminiKeys(config);
  if (!keys.length) {
    throw new Error('No Gemini API keys configured in portal settings.');
  }

  // 4. Concurrently process candidates in batches of `concurrency`
  const generated: KBSuggestionResult[] = [];
  for (let i = 0; i < selectedCandidates.length; i += concurrency) {
    const batch = selectedCandidates.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map((chat) => extractKBSuggestionFromChat(chat, keys, weekNumber))
    );

    for (const res of batchResults) {
      if (res) generated.push(res);
    }
  }

  console.log(`[kb-generator] Generated ${generated.length} suggestions from ${selectedCandidates.length} candidates`);

  // 5. Insert into kb_draft_suggestions unless dryRun is specified
  let insertedCount = 0;
  if (!options.dryRun && generated.length > 0) {
    for (const item of generated) {
      try {
        await query(
          `
          INSERT INTO kb_draft_suggestions (
            category,
            question,
            chat_ids,
            agent_answer,
            suggested_kb_content,
            tag,
            created_at,
            week_number,
            target_kb,
            chat_type
          ) VALUES ($1, $2, $3::jsonb, $4, $5, $6, NOW(), $7, $8, $9)
          `,
          [
            item.category,
            item.question,
            JSON.stringify(item.chat_ids),
            item.agent_answer,
            item.suggested_kb_content,
            item.tag,
            item.week_number,
            item.target_kb,
            item.chat_type,
          ]
        );
        insertedCount++;
      } catch (insertErr: any) {
        console.error('[kb-generator] Insert error for question:', item.question, insertErr.message);
      }
    }
  }

  return {
    ok: true,
    weekNumber,
    weekStart,
    weekEnd,
    candidatesFound: candidates.length,
    suggestionsGenerated: generated.length,
    suggestionsInserted: insertedCount,
    results: generated,
  };
}
