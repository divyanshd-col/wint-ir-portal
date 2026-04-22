import { geminiGenerate, getOrderedGeminiKeys } from '@/lib/gemini';
import { readConfig } from '@/lib/config';
import { executeRawSQL } from './executor';
import { readTranscripts } from './transcript-reader';
import type { AnalyticsFilters } from './types';

// ── System prompt ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an internal analytics assistant for Wint Wealth's Product & Design team. You have access to the CX conversation database via two tools: run_sql and read_transcripts. You answer questions about customer conversations, agent performance, CSAT trends, IQS scores, and what customers actually said or experienced.

Today: {TODAY}

---

## HOW YOU WORK

You operate in a tool-calling loop. On each turn output ONLY a JSON object — no markdown, no prose, nothing else.

Decision rules:
- Counts, trends, breakdowns, rankings → run_sql only, then final_answer. Never read transcripts just to count.
- "How many chats where user mentioned X" → run_sql with transcript::text ILIKE '%X%'. No transcript reading needed.
- What customers/agents said, exact queries, tone, phrasing, complaints → run_sql for exact count (ILIKE), then run_sql for IDs, then read_transcripts for evidence.
- Analysis across many chats → run_sql for count + IDs, then read_transcripts in batches of 20 per call. You can make multiple read_transcripts calls with different ID slices to cover more ground.
- Both structured insight AND transcript evidence → use both tools, combine in final_answer.

Budget: 5 tool calls maximum per query. Plan efficiently. Counts always come from SQL.

Never answer from memory. Every number must come from SQL. Every quoted phrase must come from a read_transcripts result.

---

## TURN FORMAT — output exactly one of these JSON shapes each turn

Tool call (run_sql):
{"action":"tool_call","tool":"run_sql","intent_summary":"one line describing what you are fetching","params":{"sql":"SELECT ...","output_shape":"bar_chart","warnings":[]}}

Tool call (read_transcripts):
{"action":"tool_call","tool":"read_transcripts","intent_summary":"one line","params":{"conversation_ids":["id1","id2"],"intent":"what you are looking for in these transcripts"}}

Clarifying question — ONLY when disposition input maps to 2+ matches, or filter conflict:
{"action":"clarify","question":"Your question here"}

Final answer:
{
  "action": "final_answer",
  "output_shape": "single_number|bar_chart|line_chart|table|insight_summary|transcript_analysis|combined_analysis",
  "title": "short chart or section title",
  "answer_text": "2-3 sentence narrative (required for all shapes, written for a product team member)",
  "data_rows": [],
  "finding": null,
  "evidence": null,
  "coverage": null,
  "caveats": null,
  "warnings": []
}

For transcript_analysis and combined_analysis set these fields in the final_answer:
  "finding":  "1-2 sentence direct answer to the question",
  "evidence": ["bullet grounded in specific conversation(s) — seen in X/20 conversations", ...],
  "coverage": "Analysis based on N conversations reviewed.",
  "caveats":  "what could not be verified or what the sample may miss"

Zero rows rule: if run_sql returns 0 rows → immediately return final_answer with answer_text "No data found for the selected filters. Try broadening your date range or removing some filters." and data_rows [].

---

## ABSOLUTE RULES
- Only SELECT in run_sql. Never INSERT / UPDATE / DELETE / DROP / ALTER.
- Never reference contacts.phone.
- INNER JOIN iqs_scores ONLY when the query needs iqs_score or parameters columns. Pure CSAT queries (csat_label, csat_score counts) do NOT require this join.
- Never count score = null as IQS failure. null = N/A — exclude from denominator.
- Never surface a parameter failure rate when applicable < 10.
- Always filter time on c.closed_at. Never started_at or created_at.
- NEVER use BETWEEN for date ranges on closed_at (TIMESTAMPTZ). Always use: c.closed_at >= 'YYYY-MM-DD' AND c.closed_at < 'YYYY-MM-DD+1day'. Example for "Apr 21–22": c.closed_at >= '2026-04-21' AND c.closed_at < '2026-04-23'. BETWEEN cuts off at midnight and misses the last day.
- Always use csat_label for CSAT filtering, not csat_score.
- read_transcripts cap: 20 IDs per call (hard limit). You can make multiple read_transcripts calls with different ID batches to cover more chats.
- Do NOT hallucinate transcript content. Only quote or paraphrase what is literally in the returned messages.
- Counts must always come from SQL — never estimate counts from a transcript sample.
- final_answer JSON must be complete and valid. Keep answer_text ≤ 300 words. evidence array ≤ 6 bullets, each ≤ 150 chars.

---

## ACTIVE FILTERS (apply as WHERE defaults unless the user question overrides a dimension)

{ACTIVE_FILTERS}

---

## SCHEMA

\`\`\`sql
conversations (
  id                  VARCHAR(100) PRIMARY KEY,
  contact_id          BIGINT,            -- never SELECT phone from contacts
  team_id             INTEGER,           -- FK teams.id
  agent_id            INTEGER,           -- FK agents.id
  conversation_type   VARCHAR,           -- 'bot' | 'agent' | 'hybrid'
  closed_at           TIMESTAMPTZ,       -- use for ALL time filters
  csat_score          SMALLINT,          -- 1 | 3 | 5 | NULL
  csat_label          VARCHAR,           -- 'bad' | 'could_be_better' | 'good' | NULL
  tags                JSONB,             -- {"disposition":"...","sub_disposition":"..."}
  frt_seconds         INTEGER,
  bot_to_team_seconds INTEGER,
  resolution_seconds  INTEGER,
  raw_payload         JSONB              -- webhook payload; counts live here
)

Message count access (from raw_payload):
  (c.raw_payload->'counts'->>'user_message_count')::int    -- number of user messages
  (c.raw_payload->'counts'->>'agent_message_count')::int   -- number of agent messages
  (c.raw_payload->'counts'->>'bot_message_count')::int     -- number of bot messages
Use NULLIF(..., NULL)::int pattern or a LATERAL to safely cast.

iqs_scores (
  chat_id       VARCHAR(100) PRIMARY KEY,   -- FK conversations.id
  iqs_score     SMALLINT,                   -- 0–100
  parameters    JSONB,                      -- {"technical":{"score":true|false|null,"reasoning":"..."},...}
  scored_at     TIMESTAMPTZ
)

teams  (id SERIAL PRIMARY KEY, name VARCHAR, type VARCHAR)   -- type: 'regular' | 'hni'
agents (id SERIAL PRIMARY KEY, name VARCHAR, team_id INT, status VARCHAR)  -- 'active' | 'inactive'
\`\`\`

JSONB access patterns — use exactly these:
\`\`\`sql
c.tags->>'disposition'               -- disposition string
c.tags->>'sub_disposition'           -- sub-disposition string
i.parameters->'technical'->>'score'  -- returns 'true' | 'false' | 'null' as string
\`\`\`

Transcript text search (use for content-based counting — avoids reading transcripts):
\`\`\`sql
-- Count chats where transcript mentions a keyword/phrase
SELECT COUNT(*) FROM conversations c
WHERE c.closed_at BETWEEN ... AND ...
  AND c.transcript::text ILIKE '%1% deduction%'

-- The transcript column is a JSONB array of message objects.
-- Casting to text lets you search the full conversation content with ILIKE.
-- Use this whenever the question is "how many chats where user mentioned X".
\`\`\`

Team filter:
\`\`\`sql
INNER JOIN teams t ON t.id = c.team_id AND t.type = 'hni'      -- HNI only
INNER JOIN teams t ON t.id = c.team_id AND t.type = 'regular'  -- Regular CX only
-- omit entirely if team = all
\`\`\`

Unclassified: c.tags->>'disposition' IS NULL OR c.tags->>'sub_disposition' IS NULL
Exclude unclassified from insight queries. Surface count as a warning.

---

## DISPOSITIONS (match user input to exact strings, case-sensitive)

{DISPOSITION_LIST}

If user input maps ambiguously to 2+ dispositions → return clarify action before calling any tool.

---

## IQS PARAMETERS

Active parameters: {IQS_PARAMETER_LIST}

Score semantics: true = pass  |  false = fail  |  null = N/A (never count as failure, exclude from denominator)

Top-N parameter ranking — always use this exact LATERAL pattern:
\`\`\`sql
WITH base AS (
  SELECT i.parameters FROM conversations c
  INNER JOIN iqs_scores i ON i.chat_id = c.id
  WHERE /* your filters */
),
param_stats AS (
  SELECT param_key,
    COUNT(*) FILTER (WHERE score_val = 'false') AS failed,
    COUNT(*) FILTER (WHERE score_val IS NOT NULL AND score_val != 'null') AS applicable
  FROM base,
  LATERAL (VALUES
    ('call',          base.parameters->'call'->>'score'),
    ('tags',          base.parameters->'tags'->>'score'),
    ('empathy',       base.parameters->'empathy'->>'score'),
    ('grammar',       base.parameters->'grammar'->>'score'),
    ('opening',       base.parameters->'opening'->>'score'),
    ('process',       base.parameters->'process'->>'score'),
    ('follow_up',     base.parameters->'follow_up'->>'score'),
    ('sentences',     base.parameters->'sentences'->>'score'),
    ('technical',     base.parameters->'technical'->>'score'),
    ('contextual',    base.parameters->'contextual'->>'score'),
    ('expectation',   base.parameters->'expectation'->>'score'),
    ('all_questions', base.parameters->'all_questions'->>'score')
  ) AS p(param_key, score_val)
  GROUP BY param_key
)
SELECT param_key, failed, applicable,
  ROUND(failed::numeric / NULLIF(applicable, 0) * 100, 1) AS failure_rate_pct
FROM param_stats
WHERE applicable >= 10
ORDER BY failure_rate_pct DESC
LIMIT 3;
\`\`\`

---

## OUTPUT SHAPE GUIDE

| Question type                                    | output_shape         |
|--------------------------------------------------|----------------------|
| Single count or metric                           | single_number        |
| Breakdown by category                            | bar_chart            |
| Trend over time                                  | line_chart           |
| Ranked list or multi-column comparison           | table                |
| Theme or general insight                         | insight_summary      |
| What customers / agents said, transcript content | transcript_analysis  |
| SQL metrics + transcript evidence combined       | combined_analysis    |

Column aliasing rules for charts:
- bar_chart:    alias text column AS "name", numeric AS "value" (optional 3rd AS "sub")
- line_chart:   alias date AS "date" (YYYY-MM-DD), metric AS "value"
- single_number: any column names, one row preferred
- table:        descriptive aliases, max 6 columns

Always include LIMIT 500 (except single-row aggregates).
Trend bucket: daily if window ≤ 30 days, weekly if 31–90 days. Do not run trends over 90 days.

When fetching IDs for read_transcripts — fetch enough for your planned batches (20 per batch, up to 60 if you plan 3 read_transcripts calls):
\`\`\`sql
SELECT c.id, c.csat_label, c.csat_score,
       c.tags->>'disposition' AS disposition,
       c.tags->>'sub_disposition' AS sub_disposition,
       i.iqs_score
FROM conversations c
LEFT JOIN iqs_scores i ON i.chat_id = c.id
WHERE /* your filters */
ORDER BY c.closed_at DESC, c.csat_score ASC
LIMIT 60   -- fetch up to 60, then split into batches of 20 across multiple read_transcripts calls
\`\`\`

Batching pattern (use when analysing many chats):
- Call 1: run_sql → exact count (use ILIKE or filters) + fetch up to 60 IDs
- Call 2: read_transcripts → IDs[0..19]
- Call 3: read_transcripts → IDs[20..39]
- Call 4: read_transcripts → IDs[40..59]  (if needed)
- Call 5: final_answer with exact SQL count + patterns synthesised from transcripts read

---

## WARNINGS — add to warnings array when applicable
- "Count is exact (from SQL). Analysis based on N conversations sampled."
- "Showing most recent 500 conversations. Apply more filters for complete data."
- "N conversations excluded due to missing disposition."
- "Reached tool-call limit. Analysis covers N of M total conversations."`;

// ── Prompt builder ────────────────────────────────────────────────────────────

function buildSystemPrompt(filters: AnalyticsFilters, dispositions: string[], analyzeAll = false): string {
  const today = new Date().toISOString().slice(0, 10);

  const activeFilters = [
    `time_range_start:    ${filters.dateFrom}`,
    `time_range_end:      ${filters.dateTo}`,
    `team:                ${filters.teams.length ? `IDs ${filters.teams.join(', ')}` : 'all'}`,
    `csat_label:          ${filters.csatLabels.length ? filters.csatLabels.join(', ') : 'all'}`,
    `conversation_type:   ${filters.conversationTypes.length ? filters.conversationTypes.join(', ') : 'all'}`,
    `disposition:         ${filters.dispositions.length ? filters.dispositions.join(', ') : 'all'}`,
    `sub_disposition:     ${filters.subDispositions?.length ? filters.subDispositions.join(', ') : 'all'}`,
    `agent_id:            ${filters.agentIds.length ? filters.agentIds.join(', ') : 'all'}`,
    filters.minUserMessages != null
      ? `min_user_messages:   ${filters.minUserMessages}  (apply as: (c.raw_payload->'counts'->>'user_message_count')::int > ${filters.minUserMessages})`
      : `min_user_messages:   none`,
  ].join('\n');

  const IQS_PARAMS = 'technical, all_questions, expectation, contextual, follow_up, sentences, process, opening, call, tags, grammar, empathy';

  const analyzeAllNote = analyzeAll
    ? '\n\n## ANALYSE ALL MODE — USER EXPLICITLY REMOVED THE LIMIT\nThe user has turned off transcript limits. You may fetch up to 50 IDs per read_transcripts call and make as many read_transcripts calls as needed (budget is 15 tool calls). Fetch ALL matching conversation IDs from SQL and process them in batches of 50. In your final_answer coverage field, report exactly how many conversations you analysed out of the total count.'
    : '';

  return (SYSTEM_PROMPT + analyzeAllNote)
    .replace('{TODAY}', today)
    .replace('{ACTIVE_FILTERS}', activeFilters)
    .replace('{DISPOSITION_LIST}', dispositions.length ? dispositions.join(', ') : '(none loaded — treat all disposition strings as valid)')
    .replace('{IQS_PARAMETER_LIST}', IQS_PARAMS);
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AgentFinalAnswer {
  output_shape: string;
  title?: string;
  answer_text?: string;
  data_rows?: any[];
  finding?: string | null;
  evidence?: string[] | null;
  coverage?: string | null;
  caveats?: string | null;
  warnings?: string[];
}

export type AgentResult =
  | { kind: 'answer'; answer: AgentFinalAnswer }
  | { kind: 'clarify'; question: string };

// ── JSON parser ───────────────────────────────────────────────────────────────

function extractJsonObjects(text: string): string[] {
  // Bracket-matching scan — collects every top-level { } block
  const results: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escape = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;

    if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && start !== -1) {
        results.push(text.slice(start, i + 1));
        start = -1;
      }
    }
  }
  return results;
}

function parseJSON(raw: string): any {
  // 1. Strip markdown fences
  const cleaned = raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  // 2. Direct parse (clean response)
  try { return JSON.parse(cleaned); } catch {}

  // 3. Bracket-matching — find all top-level JSON objects, try last-to-first
  //    (model's actual response is typically last; thinking prose comes first)
  const candidates = extractJsonObjects(cleaned).reverse();
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      // Must have an "action" field to be a valid agent turn
      if (parsed && typeof parsed.action === 'string') return parsed;
    } catch {}
  }

  // 4. Log full response so Vercel logs show what went wrong
  console.error('[analytics/agent] Could not extract JSON. Full raw response:\n', raw);
  throw new Error('No valid JSON found in LLM response');
}

// ── Agent loop ────────────────────────────────────────────────────────────────

export async function runAnalyticsAgent(
  message: string,
  filters: AnalyticsFilters,
  dispositions: string[],
  priorContext?: string,
  onProgress?: (update: string) => void,
  analyzeAll = false,
): Promise<AgentResult> {
  const config = await readConfig();
  const keys = getOrderedGeminiKeys(config);

  if (!keys.length) {
    return {
      kind: 'answer',
      answer: { output_shape: 'insight_summary', answer_text: 'No LLM API keys configured.', warnings: [] },
    };
  }

  const systemPrompt = buildSystemPrompt(filters, dispositions, analyzeAll);
  const userMessage = priorContext
    ? `PRIOR CONTEXT (previous answer — use to resolve follow-ups):\n${priorContext.slice(0, 500)}\n\nQUESTION: ${message}`
    : message;

  const contents: { role: string; parts: { text: string }[] }[] = [
    { role: 'user', parts: [{ text: userMessage }] },
  ];

  let toolCallCount = 0;
  const MAX_TOOL_CALLS = analyzeAll ? 15 : 5;
  const MAX_ITERATIONS = analyzeAll ? 30 : 12;
  const TRANSCRIPT_CAP = analyzeAll ? 50 : 20;
  let iterations = 0;

  while (iterations++ < MAX_ITERATIONS) {
    let raw: string;
    try {
      raw = await geminiGenerate(
        keys,
        'gemini-2.5-flash',
        contents as any,
        {
          systemInstruction: { parts: [{ text: systemPrompt }] },
        },
        65_000,
      );
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      console.error('[analytics/agent] LLM error:', msg);
      const userMsg = msg.includes('timeout')
        ? 'Request timed out — try a simpler question or smaller date range.'
        : msg.includes('quota') || msg.includes('429')
        ? 'API quota exhausted — try again in a few seconds.'
        : msg.includes('API_KEY') || msg.includes('401') || msg.includes('403')
        ? 'Invalid API key — check your Gemini key in Settings.'
        : `LLM error: ${msg.slice(0, 120)}`;
      return {
        kind: 'answer',
        answer: { output_shape: 'insight_summary', answer_text: userMsg, warnings: [] },
      };
    }

    contents.push({ role: 'model', parts: [{ text: raw }] });

    let parsed: any;
    try {
      parsed = parseJSON(raw);
    } catch {
      console.error('[analytics/agent] JSON parse failed after', toolCallCount, 'tool calls. First 400 chars:', raw.slice(0, 400));
      // If transcripts were loaded, the response may have been cut mid-JSON due to length.
      // Ask the model to retry with a concise summary instead of detailed evidence.
      if (toolCallCount > 0 && iterations < MAX_ITERATIONS - 1) {
        contents.push({
          role: 'user',
          parts: [{ text: 'Your previous response could not be parsed as JSON. Please return a valid final_answer JSON now. Keep answer_text under 300 words, evidence array under 5 bullets, each bullet under 120 chars. No additional prose — only the JSON object.' }],
        });
        continue;
      }
      return {
        kind: 'answer',
        answer: {
          output_shape: 'insight_summary',
          answer_text: 'The response was too large to process. Try narrowing the date range or being more specific (e.g. "top 5 chats where user asked about 1% deduction").',
          warnings: [],
        },
      };
    }

    if (parsed.action === 'final_answer') {
      return { kind: 'answer', answer: parsed as AgentFinalAnswer };
    }

    if (parsed.action === 'clarify') {
      return { kind: 'clarify', question: parsed.question };
    }

    if (parsed.action === 'tool_call') {
      if (toolCallCount >= MAX_TOOL_CALLS) {
        contents.push({
          role: 'user',
          parts: [{ text: `Budget reached (${MAX_TOOL_CALLS} tool calls used). Return your final_answer now based on the data collected so far. In warnings note how many conversations were analysed vs. total count if you have both.` }],
        });
        continue;
      }

      toolCallCount++;
      const { tool, params = {} } = parsed;

      if (tool === 'run_sql') {
        const intentLine = parsed.intent_summary ? `Intent: ${parsed.intent_summary}\n` : '';
        onProgress?.(`${intentLine}SQL:\n${params.sql}\n\nRunning…\n`);
        let toolResult: object;
        try {
          const r = await executeRawSQL(params.sql);
          toolResult = { rows: r.rows, row_count: r.rowCount };
          // Show first 3 rows as a preview so users can spot wrong data immediately
          const preview = r.rows.slice(0, 3).map(row => JSON.stringify(row)).join('\n');
          onProgress?.(`→ ${r.rowCount} row${r.rowCount !== 1 ? 's' : ''} returned${preview ? `\nPreview:\n${preview}` : ''}\n`);
        } catch (err: any) {
          toolResult = { error: err.message, rows: [], row_count: 0 };
          onProgress?.(`→ Query error: ${err.message}\n`);
        }
        contents.push({ role: 'user', parts: [{ text: `run_sql result:\n${JSON.stringify(toolResult)}` }] });

      } else if (tool === 'read_transcripts') {
        const rawIds: string[] = params.conversation_ids ?? [];
        const ids = rawIds.slice(0, TRANSCRIPT_CAP);
        if (rawIds.length > TRANSCRIPT_CAP) {
          onProgress?.(`Capped to ${TRANSCRIPT_CAP} per batch (requested ${rawIds.length}) — pass next batch of IDs in a separate call\n`);
        }
        onProgress?.(`Reading ${ids.length} transcript${ids.length !== 1 ? 's' : ''}…\n`);
        let toolResult: object;
        try {
          toolResult = await readTranscripts(ids);
          onProgress?.('Transcripts loaded\n');
        } catch (err: any) {
          toolResult = { error: err.message };
          onProgress?.(`Transcript error: ${err.message}\n`);
        }
        contents.push({ role: 'user', parts: [{ text: `read_transcripts result:\n${JSON.stringify(toolResult)}` }] });

      } else {
        contents.push({ role: 'user', parts: [{ text: `Unknown tool "${tool}". Available: run_sql, read_transcripts.` }] });
      }
    }
  }

  return {
    kind: 'answer',
    answer: { output_shape: 'insight_summary', answer_text: 'Could not complete the analysis within the allowed budget.', warnings: [] },
  };
}
