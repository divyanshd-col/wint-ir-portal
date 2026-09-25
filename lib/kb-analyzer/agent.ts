import { query } from '@/lib/cx/db';
import { readConfig } from '@/lib/config';
import { geminiGenerate, getIQSGeminiKeys } from '@/lib/gemini';
import { log } from '@/lib/log';
import { OFFICIAL_KB_DOCUMENTS } from './kb-list';

export interface KBDraftSuggestionRow {
  week_number: string;
  category: string;
  question: string;
  chat_ids: string[];
  agent_answer: string;
  suggested_kb_content: string;
  target_kb: string;
  tag: 'Educational' | 'Non-Educational';
  chat_type: 'Bot Handled' | 'Transferred to Agent';
  created_at?: string;
}

export function getWeekLabel(d: Date): string {
  const date = new Date(d.getTime());
  const day = date.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(date);
  monday.setDate(date.getDate() + diffToMonday);

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  const target = new Date(date.valueOf());
  const dayNr = (date.getDay() + 6) % 7;
  target.setDate(target.getDate() - dayNr + 3);
  const firstThursday = target.valueOf();
  target.setMonth(0, 1);
  if (target.getDay() !== 4) {
    target.setMonth(0, 1 + ((4 - target.getDay() + 7) % 7));
  }
  const weekNumber = 1 + Math.round((firstThursday - target.valueOf()) / 604800000);
  const year = target.getFullYear();

  const monStr = monday.toLocaleString('en-US', { month: 'short' });
  const sunStr = sunday.toLocaleString('en-US', { month: 'short' });

  const dateRange = monStr === sunStr
    ? `${monStr} ${monday.getDate()} - ${sunday.getDate()}`
    : `${monStr} ${monday.getDate()} - ${sunStr} ${sunday.getDate()}`;

  return `Week ${weekNumber}, ${year} (${dateRange})`;
}

export const KB_ANALYSIS_SYSTEM_PROMPT = `You are the Wint Wealth KB Intelligence AI Agent. Your task is to analyze complete customer support chat transcripts end-to-end, compare investor queries and human agent answers against our official 27 Knowledge Base modules, detect KB Gaps (missing information, missing SOPs, edge cases, unclear policies), and draft exact KB documentation content to be added to the Knowledge Base.

CRITICAL MANDATE FOR "suggested_kb_content":
The "suggested_kb_content" field MUST NOT be a conversational chat reply or what an agent should say to a customer.
Instead, it MUST be formal, standardized, publication-ready Knowledge Base Documentation content (with headings, steps, eligibility rules, and policy details) that the documentation team can directly copy and paste into the official KB article.

OFFICIAL KNOWLEDGE BASE MODULES DIRECTORY (27 Modules):
${OFFICIAL_KB_DOCUMENTS.map((doc, i) => `${i + 1}. "${doc}"`).join('\n')}

INPUT
- CHAT_ID: Robylon chat ID.
- DISPOSITION & SUB_DISPOSITION: Categorization assigned to this chat.
- TRANSCRIPT: Numbered turn-by-turn customer and support agent messages.

YOUR INSTRUCTIONS:
1. Identify the core investor question and the human support agent's resolution.
2. Compare the agent's resolution against our official 27 Knowledge Base modules directory.
3. Identify the EXACT KB Document Title ("target_kb") from the official list above where this missing information, edge case, or policy detail should be added. It MUST match one of the 27 titles in the OFFICIAL KNOWLEDGE BASE MODULES DIRECTORY exactly.
4. Assign a short canonical 2-4 word topic identifier ("topic_key") for grouping identical/similar queries (e.g. "Form 121 Submission SOP", "SGB Zerodha Tracking Change", "PTC Default Definition").
5. Extract the raw answer given by the human IR support agent in the transcript ("agent_answer").
6. Draft the EXACT KB DOCUMENTATION CONTENT ("suggested_kb_content") to be added to the target KB module:
   - Format as a structured KB Article section (Heading, Overview, Steps, FAQs, Exceptions).
   - Ensure it is generic and applicable to all investors (remove customer-specific PII/data).
   - Make it 100% publication-ready for the Knowledge Base.
7. Classify/Tag the entry:
   - "Educational": General rules, policy facts, processes, eligibility, timelines that should be documented in KB.
   - "Non-Educational": Individual account-specific lookups, PAN verifications, personal refund tracking requiring API integration.

OUTPUT FORMAT:
Return ONLY valid JSON (no markdown fences, no extra text):
{
  "has_gap_or_educational_query": true|false,
  "category": "<Exact disposition or topic category>",
  "topic_key": "<Canonical 2-4 word topic identifier>",
  "target_kb": "<Exact KB Title selected from the OFFICIAL KNOWLEDGE BASE MODULES DIRECTORY>",
  "question": "<Precise investor question>",
  "agent_answer": "<Exact answer given by human agent in transcript>",
  "suggested_kb_content": "<Formal KB Documentation content to be added to the target KB article>",
  "tag": "Educational" | "Non-Educational"
}`;

export async function runKBAgendaAnalysis(options?: {
  daysBack?: number;
  limitChats?: number;
  dispositionFilter?: string;
}): Promise<{
  success: boolean;
  analyzedCount: number;
  insertedCount: number;
  suggestions: KBDraftSuggestionRow[];
  error?: string;
}> {
  const daysBack = options?.daysBack || 14;
  const limitChats = options?.limitChats || 60;
  const targetDispositions = options?.dispositionFilter
    ? [options.dispositionFilter]
    : ['Taxation', 'Liquidity', 'SIP', 'Asset', 'KYC', 'Interest Repayment'];

  log.info('kb-analyzer', 'Starting KB Gap Analysis', { daysBack, limitChats, targetDispositions });

  try {
    const chats = await query<{
      id: string;
      closed_at: string;
      disposition: string;
      sub_disposition: string;
      transcript: any;
      conversation_type: string | null;
      bot_to_team_seconds: number | null;
    }>(
      `WITH ranked_chats AS (
        SELECT 
          c.id,
          c.closed_at,
          c.tags->>'disposition' AS disposition,
          c.tags->>'sub_disposition' AS sub_disposition,
          c.transcript,
          c.conversation_type,
          c.bot_to_team_seconds,
          ROW_NUMBER() OVER (
            PARTITION BY date_trunc('week', c.closed_at) 
            ORDER BY c.closed_at DESC
          ) AS rn
        FROM conversations c
        WHERE c.transcript IS NOT NULL
          AND c.closed_at >= NOW() - ($1 * INTERVAL '1 day')
          AND (c.tags->>'disposition' = ANY($2::text[]))
      )
      SELECT id, closed_at, disposition, sub_disposition, transcript, conversation_type, bot_to_team_seconds
      FROM ranked_chats
      WHERE rn <= $3
      ORDER BY closed_at DESC`,
      [daysBack, targetDispositions, Math.ceil(limitChats / 2)]
    );

    if (!chats.length) {
      log.info('kb-analyzer', 'No educational chats found for analysis window');
      return { success: true, analyzedCount: 0, insertedCount: 0, suggestions: [] };
    }

    const rawResults: KBDraftSuggestionRow[] = [];

    for (const chat of chats) {
      let transcriptText = '';
      if (Array.isArray(chat.transcript)) {
        transcriptText = chat.transcript
          .map((m: any, idx: number) => `[${idx + 1}] ${m.role || m.sender || 'USER'}: ${m.text || m.content || ''}`)
          .join('\n');
      } else if (chat.transcript?.messages && Array.isArray(chat.transcript.messages)) {
        transcriptText = chat.transcript.messages
          .map((m: any, idx: number) => `[${idx + 1}] ${m.role || m.sender || 'USER'}: ${m.text || m.content || ''}`)
          .join('\n');
      } else if (typeof chat.transcript === 'string') {
        transcriptText = chat.transcript;
      }

      if (!transcriptText || transcriptText.length < 50) continue;

      const chatDate = new Date(chat.closed_at || Date.now());
      const weekLabel = getWeekLabel(chatDate);

      // Determine Chat Type (Bot Handled vs Transferred to Agent)
      const isBotHandled = chat.conversation_type === 'bot' || chat.bot_to_team_seconds === null;
      const chatType: 'Bot Handled' | 'Transferred to Agent' = isBotHandled ? 'Bot Handled' : 'Transferred to Agent';

      const userPrompt = `CHAT_ID: ${chat.id}\nDISPOSITION: ${chat.disposition || 'General'}\nSUB_DISPOSITION: ${chat.sub_disposition || 'General'}\n\nTRANSCRIPT:\n${transcriptText.slice(0, 8000)}`;

      try {
        const config = await readConfig();
        let keys = getIQSGeminiKeys(config);
        if (!keys.length) {
          keys = [
            process.env.IQS_GEMINI_API_KEY,
            process.env.GEMINI_API_KEY,
            process.env.GEMINI_API_KEY1,
            process.env.GEMINI_API_KEY2,
            process.env.GEMINI_API_KEY3,
          ].filter(Boolean) as string[];
        }
        const responseText = await geminiGenerate(
          keys,
          'gemini-3.5-flash',
          [userPrompt],
          {
            systemInstruction: KB_ANALYSIS_SYSTEM_PROMPT,
            temperature: 0.1,
            jobType: 'kb_query_expansion',
            featureGroup: 'Analytics',
            entityId: chat.id,
          },
          300_000
        );

        let jsonClean = responseText.trim();
        if (jsonClean.startsWith('```json')) jsonClean = jsonClean.slice(7);
        if (jsonClean.startsWith('```')) jsonClean = jsonClean.slice(3);
        if (jsonClean.endsWith('```')) jsonClean = jsonClean.slice(0, -3);

        const parsed = JSON.parse(jsonClean.trim());

        const kbContent = parsed.suggested_kb_content || parsed.suggested_bot_answer;
        if (parsed.has_gap_or_educational_query && parsed.question && kbContent) {
          const rawAnswer = parsed.agent_answer || 'Response provided in transcript.';
          const suggestionRow: KBDraftSuggestionRow = {
            week_number: weekLabel,
            category: chat.disposition || parsed.category || 'Taxation',
            question: parsed.question,
            chat_ids: [chat.id],
            agent_answer: `[Chat #${chat.id}]: ${rawAnswer}`,
            suggested_kb_content: kbContent,
            target_kb: parsed.target_kb || 'KB main',
            tag: parsed.tag === 'Non-Educational' ? 'Non-Educational' : 'Educational',
            chat_type: chatType,
          };

          rawResults.push(suggestionRow);

          // Real-time immediate DB insertion per processed chat
          await query(
            `INSERT INTO kb_draft_suggestions (
              week_number, category, question, chat_ids, agent_answer, suggested_kb_content, target_kb, tag, chat_type
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              suggestionRow.week_number,
              suggestionRow.category,
              suggestionRow.question,
              JSON.stringify(suggestionRow.chat_ids),
              suggestionRow.agent_answer,
              suggestionRow.suggested_kb_content,
              suggestionRow.target_kb,
              suggestionRow.tag,
              suggestionRow.chat_type,
            ]
          );
        }
      } catch (err: any) {
        log.warn('kb-analyzer', `Failed processing chat ${chat.id}`, { err: err?.message ?? String(err) });
      }
    }

    log.info('kb-analyzer', 'Analysis complete', { analyzedCount: chats.length, insertedCount: rawResults.length });
    return {
      success: true,
      analyzedCount: chats.length,
      insertedCount: rawResults.length,
      suggestions: rawResults,
    };
  } catch (err: any) {
    const errMsg = err?.message ?? String(err);
    log.error('kb-analyzer', 'Analysis failed', { err: errMsg });
    return {
      success: false,
      analyzedCount: 0,
      insertedCount: 0,
      suggestions: [],
      error: errMsg,
    };
  }
}
