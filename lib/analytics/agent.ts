import { geminiGenerate, getOrderedGeminiKeys } from '@/lib/gemini';
import { readConfig } from '@/lib/config';
import { executeRawSQL } from './executor';
import { readTranscripts } from './transcript-reader';
import type { AnalyticsFilters } from './types';

// ── Call 1: Planner prompt ────────────────────────────────────────────────────

const PLANNER_PROMPT = `You are a SQL query planner for Wint Wealth's CX analytics system.
Read the user's question and output a JSON plan describing exactly what data to fetch.

Today: {TODAY}

## OUTPUT — exactly one of:

Plan:
{"action":"plan","intent":"one-line description","sqls":[{"sql":"SELECT ...","intent":"what this fetches","output_shape":"single_number|bar_chart|line_chart|table"}],"needs_transcripts":false,"transcript_id_sql":null,"transcript_intent":null,"output_shape":"single_number|bar_chart|line_chart|table|insight_summary|transcript_analysis|combined_analysis"}

Clarify (only when disposition/agent name is ambiguous — maps to 2+ values):
{"action":"clarify","question":"..."}

## DECISION RULES
- Counts, trends, breakdowns, rankings → sqls only, needs_transcripts: false
- "How many chats where customer mentioned X" → use transcript::text ILIKE '%X%' in SQL — no transcripts needed
- What customers/agents said, tone, quotes, themes → needs_transcripts: true + transcript_id_sql
- transcript_id_sql must have LIMIT {ID_FETCH_LIMIT}
- Multiple metrics → include multiple objects in sqls array (they run in parallel)

## ACTIVE FILTERS — apply as WHERE defaults unless question overrides a dimension
{ACTIVE_FILTERS}

## SCHEMA
\`\`\`sql
conversations (
  id                  VARCHAR(100) PRIMARY KEY,
  contact_id          BIGINT,            -- never SELECT phone from contacts
  team_id             INTEGER,
  agent_id            INTEGER,
  conversation_type   VARCHAR,           -- 'bot' | 'agent' | 'hybrid'
  closed_at           TIMESTAMPTZ,       -- ALL time filters go here, never started_at
  csat_score          SMALLINT,          -- 1 | 3 | 5 | NULL
  csat_label          VARCHAR,           -- 'bad' | 'could_be_better' | 'good' | NULL
  tags                JSONB,             -- {"disposition":"...","sub_disposition":"..."}
  frt_seconds         INTEGER,
  bot_to_team_seconds INTEGER,
  resolution_seconds  INTEGER,
  raw_payload         JSONB
)
iqs_scores (
  chat_id       VARCHAR(100) PRIMARY KEY,
  iqs_score     SMALLINT,
  parameters    JSONB,                   -- {"technical":{"score":true|false|null,"reasoning":"..."},...}
  scored_at     TIMESTAMPTZ
)
teams  (id SERIAL PRIMARY KEY, name VARCHAR, type VARCHAR)   -- type: 'regular' | 'hni'
agents (id SERIAL PRIMARY KEY, name VARCHAR, team_id INT, status VARCHAR)
\`\`\`

## SQL RULES
- NEVER use BETWEEN on closed_at (TIMESTAMPTZ). Use: c.closed_at >= 'YYYY-MM-DD' AND c.closed_at < 'YYYY-MM-DD+1day'
- INNER JOIN iqs_scores ONLY when query needs iqs_score or parameters columns
- Never count score = null as IQS failure — null = N/A, exclude from denominator
- Always use csat_label for CSAT filtering, never csat_score
- Never SELECT contacts.phone
- bar_chart: alias text column AS "name", numeric AS "value"
- line_chart: alias date AS "date" (YYYY-MM-DD), metric AS "value"
- Add LIMIT 500 on all non-aggregate queries (except transcript_id_sql which uses LIMIT {ID_FETCH_LIMIT})
- Trend bucket: daily if window ≤ 30 days, weekly if 31–90 days

## JSONB ACCESS PATTERNS
\`\`\`sql
c.tags->>'disposition'
c.tags->>'sub_disposition'
i.parameters->'technical'->>'score'        -- returns 'true' | 'false' | 'null' as string
c.transcript::text ILIKE '%keyword%'       -- full-text search across entire transcript
(c.raw_payload->'counts'->>'user_message_count')::int
\`\`\`

## IQS PARAMETER BREAKDOWN — use this exact LATERAL pattern
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
    ('call',base.parameters->'call'->>'score'),
    ('tags',base.parameters->'tags'->>'score'),
    ('empathy',base.parameters->'empathy'->>'score'),
    ('grammar',base.parameters->'grammar'->>'score'),
    ('opening',base.parameters->'opening'->>'score'),
    ('process',base.parameters->'process'->>'score'),
    ('follow_up',base.parameters->'follow_up'->>'score'),
    ('sentences',base.parameters->'sentences'->>'score'),
    ('technical',base.parameters->'technical'->>'score'),
    ('contextual',base.parameters->'contextual'->>'score'),
    ('expectation',base.parameters->'expectation'->>'score'),
    ('all_questions',base.parameters->'all_questions'->>'score')
  ) AS p(param_key, score_val)
  GROUP BY param_key
)
SELECT param_key, failed, applicable,
  ROUND(failed::numeric / NULLIF(applicable, 0) * 100, 1) AS failure_rate_pct
FROM param_stats WHERE applicable >= 10
ORDER BY failure_rate_pct DESC LIMIT 3;
\`\`\`

## TEAM FILTER
\`\`\`sql
INNER JOIN teams t ON t.id = c.team_id AND t.type = 'hni'      -- HNI only
INNER JOIN teams t ON t.id = c.team_id AND t.type = 'regular'  -- Regular CX only
-- omit entirely if team = all
\`\`\`

## DISPOSITIONS (match user input to exact strings, case-sensitive)
{DISPOSITION_LIST}

## IQS PARAMETERS
technical, all_questions, expectation, contextual, follow_up, sentences, process, opening, call, tags, grammar, empathy`;

// ── Call 2: Synthesizer prompt ────────────────────────────────────────────────

const SYNTHESIZER_PROMPT = `You are a data analyst for Wint Wealth's CX team.
You have received SQL query results and optionally transcript content. Produce a final_answer JSON.

Output ONLY this JSON object — no markdown, no prose outside the JSON:
{
  "action": "final_answer",
  "output_shape": "single_number|bar_chart|line_chart|table|insight_summary|transcript_analysis|combined_analysis",
  "title": "short title",
  "answer_text": "2-3 sentence narrative (≤300 words, written for a product team member)",
  "data_rows": [],
  "finding": null,
  "evidence": null,
  "coverage": null,
  "caveats": null,
  "warnings": []
}

For transcript_analysis and combined_analysis populate:
  "finding":  "1-2 sentence direct answer to the question"
  "evidence": ["bullet grounded in specific conversations — seen in X/N", ...] (max 6 bullets, ≤150 chars each)
  "coverage": "Analysis based on N of M total conversations."
  "caveats":  "what could not be verified or what the sample may miss"

Output shape guide:
| output_shape         | Use when                                          | data_rows format                         |
|----------------------|---------------------------------------------------|------------------------------------------|
| single_number        | One count or metric                               | [{"label":"...", "value": 123}]         |
| bar_chart            | Comparison by category                            | [{"name":"...", "value": 123}]          |
| line_chart           | Trend over time                                   | [{"date":"YYYY-MM-DD", "value": 123}]   |
| table                | Multi-column or >5 items                          | rows match SQL columns                   |
| insight_summary      | Finding with no structured chart                  | []                                       |
| transcript_analysis  | Themes/quotes from transcripts                    | []                                       |
| combined_analysis    | SQL metrics + transcript evidence                 | SQL rows                                 |

Rules:
- Zero SQL rows → answer_text: "No data found for the selected filters. Try broadening your date range or removing some filters." data_rows: []
- Never fabricate numbers — every stat must come from the SQL results provided
- Never quote transcript content not present in the provided transcript data
- Use the output_shape_hint unless a different shape clearly fits better`;

// ── Prompt builder ────────────────────────────────────────────────────────────

function buildPlannerPrompt(filters: AnalyticsFilters, dispositions: string[], idFetchLimit: number): string {
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

  return PLANNER_PROMPT
    .replace('{TODAY}', today)
    .replace('{ACTIVE_FILTERS}', activeFilters)
    .replace(/{ID_FETCH_LIMIT}/g, String(idFetchLimit))
    .replace('{DISPOSITION_LIST}', dispositions.length ? dispositions.join(', ') : '(none loaded — treat all disposition strings as valid)');
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface PlanSQL {
  sql: string;
  intent: string;
  output_shape?: string;
}

interface PlannerPlan {
  action: 'plan';
  intent: string;
  sqls: PlanSQL[];
  needs_transcripts: boolean;
  transcript_id_sql: string | null;
  transcript_intent: string | null;
  output_shape: string;
}

interface PlannerClarify {
  action: 'clarify';
  question: string;
}

type PlannerResult = PlannerPlan | PlannerClarify;

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
  const cleaned = raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  try { return JSON.parse(cleaned); } catch {}

  const candidates = extractJsonObjects(cleaned).reverse();
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed.action === 'string') return parsed;
    } catch {}
  }

  console.error('[analytics/agent] Could not extract JSON. First 400 chars:\n', raw.slice(0, 400));
  throw new Error('No valid JSON found in LLM response');
}

// ── Main agent — 2-call architecture ─────────────────────────────────────────

export async function runAnalyticsAgent(
  message: string,
  filters: AnalyticsFilters,
  dispositions: string[],
  priorContext?: string,
  onProgress?: (update: string) => void,
  maxConversations = 60,
): Promise<AgentResult> {
  const config = await readConfig();
  const keys = getOrderedGeminiKeys(config);

  if (!keys.length) {
    return {
      kind: 'answer',
      answer: { output_shape: 'insight_summary', answer_text: 'No LLM API keys configured.', warnings: [] },
    };
  }

  const TRANSCRIPT_CAP = maxConversations > 20 ? 50 : 20;
  const idFetchLimit   = maxConversations;

  const plannerPrompt = buildPlannerPrompt(filters, dispositions, idFetchLimit);
  const userMessage = priorContext
    ? `PRIOR CONTEXT (previous answer — use to resolve follow-ups):\n${priorContext.slice(0, 500)}\n\nQUESTION: ${message}`
    : message;

  // ── Call 1: Planner ─────────────────────────────────────────────────────────
  onProgress?.('Planning query…\n');
  let planRaw: string;
  try {
    planRaw = await geminiGenerate(
      keys,
      'gemini-2.5-flash',
      [{ role: 'user', parts: [{ text: userMessage }] }],
      {
        systemInstruction: { parts: [{ text: plannerPrompt }] },
        config: { thinkingConfig: { thinkingBudget: 1024 } },
      },
      30_000,
    );
  } catch (err: any) {
    return llmError(err);
  }

  let plan: PlannerResult;
  try {
    plan = parseJSON(planRaw);
  } catch {
    console.error('[analytics/agent] Planner parse failed. Raw:', planRaw.slice(0, 400));
    return {
      kind: 'answer',
      answer: { output_shape: 'insight_summary', answer_text: 'Could not understand the question. Try rephrasing it.', warnings: [] },
    };
  }

  if (plan.action === 'clarify') {
    return { kind: 'clarify', question: plan.question };
  }

  // ── Execute all SQL queries in parallel ─────────────────────────────────────
  const sqlResults = await Promise.all(
    (plan.sqls ?? []).map(async (q) => {
      onProgress?.(`Intent: ${q.intent}\nSQL:\n${q.sql}\n\nRunning…\n`);
      try {
        const r = await executeRawSQL(q.sql);
        const preview = r.rows.slice(0, 3).map((row: any) => JSON.stringify(row)).join('\n');
        onProgress?.(`→ ${r.rowCount} row${r.rowCount !== 1 ? 's' : ''} returned${preview ? `\nPreview:\n${preview}` : ''}\n`);
        return { intent: q.intent, rows: r.rows, row_count: r.rowCount, error: null };
      } catch (err: any) {
        onProgress?.(`→ Query error: ${err.message}\n`);
        return { intent: q.intent, rows: [], row_count: 0, error: err.message };
      }
    })
  );

  // ── Read transcripts if needed (sequential batches to avoid connection pressure) ──
  let transcriptData: any = null;
  if (plan.needs_transcripts && plan.transcript_id_sql) {
    onProgress?.('Fetching transcript IDs…\n');
    try {
      const idResult = await executeRawSQL(plan.transcript_id_sql);
      const ids: string[] = idResult.rows
        .map((r: any) => r.id ?? r[Object.keys(r)[0]])
        .filter(Boolean)
        .slice(0, idFetchLimit);

      onProgress?.(`${ids.length} conversations to read (${Math.ceil(ids.length / TRANSCRIPT_CAP)} batch${Math.ceil(ids.length / TRANSCRIPT_CAP) !== 1 ? 'es' : ''})\n`);

      const allTranscripts: any[] = [];
      for (let i = 0; i < ids.length; i += TRANSCRIPT_CAP) {
        const batch = ids.slice(i, i + TRANSCRIPT_CAP);
        const batchNum = Math.floor(i / TRANSCRIPT_CAP) + 1;
        const totalBatches = Math.ceil(ids.length / TRANSCRIPT_CAP);
        onProgress?.(`Reading batch ${batchNum}/${totalBatches} (${batch.length} transcripts)…\n`);
        try {
          const result = await readTranscripts(batch);
          allTranscripts.push(result);
          onProgress?.(`Batch ${batchNum} loaded\n`);
        } catch (err: any) {
          onProgress?.(`Batch ${batchNum} error: ${err.message}\n`);
        }
      }

      transcriptData = {
        total_fetched: ids.length,
        intent: plan.transcript_intent,
        batches: allTranscripts,
      };
    } catch (err: any) {
      onProgress?.(`Transcript ID fetch error: ${err.message}\n`);
    }
  }

  // ── Call 2: Synthesizer ─────────────────────────────────────────────────────
  onProgress?.('Synthesising answer…\n');
  const synthesisInput = JSON.stringify({
    question: message,
    intent: plan.intent,
    output_shape_hint: plan.output_shape,
    sql_results: sqlResults,
    transcripts: transcriptData,
  });

  // Disable thinking for pure SQL (fast); full thinking when transcripts involved
  const synthExtra: any = {
    systemInstruction: { parts: [{ text: SYNTHESIZER_PROMPT }] },
  };
  if (!plan.needs_transcripts) {
    synthExtra.config = { thinkingConfig: { thinkingBudget: 0 } };
  }

  let synthRaw: string;
  try {
    synthRaw = await geminiGenerate(
      keys,
      'gemini-2.5-flash',
      [{ role: 'user', parts: [{ text: synthesisInput }] }],
      synthExtra,
      45_000,
    );
  } catch (err: any) {
    return llmError(err);
  }

  try {
    const answer = parseJSON(synthRaw) as AgentFinalAnswer;
    return { kind: 'answer', answer };
  } catch {
    console.error('[analytics/agent] Synthesizer parse failed. First 400 chars:', synthRaw.slice(0, 400));
    return {
      kind: 'answer',
      answer: {
        output_shape: 'insight_summary',
        answer_text: 'Analysis complete but the response could not be parsed. Try again or narrow your question.',
        warnings: [],
      },
    };
  }
}

// ── Split-phase exports (used by /api/analytics/plan + /api/analytics/insights) ──

export interface SqlResult {
  intent: string;
  rows: any[];
  row_count: number;
  error: string | null;
}

export type PlannerPhaseResult =
  | { kind: 'plan'; intent: string; sql_results: SqlResult[]; needs_transcripts: boolean; transcript_intent: string | null; output_shape: string; transcript_ids: string[] }
  | { kind: 'clarify'; question: string }
  | { kind: 'error'; message: string };

export async function runPlannerPhase(
  message: string,
  filters: AnalyticsFilters,
  dispositions: string[],
  keys: string[],
  priorContext?: string,
  maxConversations = 100,
): Promise<PlannerPhaseResult> {
  if (!keys.length) return { kind: 'error', message: 'No LLM API keys configured.' };

  const plannerPrompt = buildPlannerPrompt(filters, dispositions, maxConversations);
  const userMessage = priorContext
    ? `PRIOR CONTEXT (previous answer):\n${priorContext.slice(0, 500)}\n\nQUESTION: ${message}`
    : message;

  let planRaw: string;
  try {
    planRaw = await geminiGenerate(
      keys,
      'gemini-2.5-flash',
      [{ role: 'user', parts: [{ text: userMessage }] }],
      {
        systemInstruction: { parts: [{ text: plannerPrompt }] },
        config: { thinkingConfig: { thinkingBudget: 1024 } },
      },
      28_000,
    );
  } catch (err: any) {
    return { kind: 'error', message: err?.message ?? 'Planner LLM failed' };
  }

  let plan: PlannerResult;
  try {
    plan = parseJSON(planRaw);
  } catch {
    return { kind: 'error', message: 'Could not parse planner response. Try rephrasing.' };
  }

  if (plan.action === 'clarify') {
    return { kind: 'clarify', question: plan.question };
  }

  const sql_results: SqlResult[] = await Promise.all(
    (plan.sqls ?? []).map(async (q) => {
      try {
        const r = await executeRawSQL(q.sql);
        return { intent: q.intent, rows: r.rows, row_count: r.rowCount, error: null };
      } catch (err: any) {
        return { intent: q.intent, rows: [], row_count: 0, error: err.message };
      }
    }),
  );

  let transcript_ids: string[] = [];
  if (plan.needs_transcripts && plan.transcript_id_sql) {
    try {
      const idResult = await executeRawSQL(plan.transcript_id_sql);
      transcript_ids = idResult.rows
        .map((r: any) => r.id ?? r[Object.keys(r)[0]])
        .filter(Boolean)
        .slice(0, maxConversations);
    } catch { /* proceed without transcripts */ }
  }

  return {
    kind: 'plan',
    intent: plan.intent,
    sql_results,
    needs_transcripts: plan.needs_transcripts,
    transcript_intent: plan.transcript_intent,
    output_shape: plan.output_shape,
    transcript_ids,
  };
}

export async function runSynthesizerPhase(
  question: string,
  intent: string,
  outputShapeHint: string,
  sqlResults: SqlResult[],
  transcriptSummaries: string[],
  keys: string[],
): Promise<AgentFinalAnswer> {
  const synthesisInput = JSON.stringify({
    question,
    intent,
    output_shape_hint: outputShapeHint,
    sql_results: sqlResults,
    transcript_summaries: transcriptSummaries.length
      ? { summaries: transcriptSummaries, note: 'Each summary covers ~20 conversations. Use phrasing like "across the reviewed conversations" rather than quoting specific exchanges.' }
      : null,
  });

  const synthExtra: any = {
    systemInstruction: { parts: [{ text: SYNTHESIZER_PROMPT }] },
  };
  if (!transcriptSummaries.length) {
    synthExtra.config = { thinkingConfig: { thinkingBudget: 0 } };
  }

  const raw = await geminiGenerate(
    keys,
    'gemini-2.5-flash',
    [{ role: 'user', parts: [{ text: synthesisInput }] }],
    synthExtra,
    40_000,
  );

  return parseJSON(raw) as AgentFinalAnswer;
}

// ── LLM error helper ──────────────────────────────────────────────────────────

function llmError(err: any): AgentResult {
  const msg = err?.message ?? String(err);
  console.error('[analytics/agent] LLM error:', msg);
  const text = msg.includes('timeout')
    ? 'Request timed out — try a simpler question or smaller date range.'
    : msg.includes('quota') || msg.includes('429')
    ? 'API quota exhausted — try again in a few seconds.'
    : msg.includes('API_KEY') || msg.includes('401') || msg.includes('403')
    ? 'Invalid API key — check your Gemini key in Settings.'
    : `LLM error: ${msg.slice(0, 120)}`;
  return { kind: 'answer', answer: { output_shape: 'insight_summary', answer_text: text, warnings: [] } };
}
