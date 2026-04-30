import { geminiGenerate, getOrderedGeminiKeys } from '@/lib/gemini';
import { readConfig } from '@/lib/config';
import { executeRawSQL } from './executor';
import { readTranscripts } from './transcript-reader';
import type { AnalyticsFilters } from './types';
import type { DispositionTree } from './dispositions';

// ── Call 1: Planner prompt ────────────────────────────────────────────────────

export const PLANNER_PROMPT = `You are a SQL query planner for Wint Wealth's CX analytics system.
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
- "Chat links", "show me conversations", "give me examples", "list some chats", "sample chats", "conversation IDs" → needs_transcripts: false. SQL: SELECT c.id, 'https://app.robylon.ai/unified-inbox/share/' || c.id AS link, c.closed_at::date AS date, c.csat_label, c.tags->>'disposition' AS disposition FROM conversations c WHERE [filters] ORDER BY c.closed_at DESC LIMIT N. Output as table. NEVER set needs_transcripts=true just to return IDs.
- What customers/agents SAID inside conversations, tone, quotes, themes from chat content → needs_transcripts: true + transcript_id_sql
- transcript_id_sql must have LIMIT {ID_FETCH_LIMIT}
- Multiple metrics → include multiple objects in sqls array (they run in parallel)

## MULTI-QUERY STRATEGY — add a second SQL when it adds analytical value
- Ranking question (who is best/worst) → add a second SQL for the team average of that metric so the synthesizer can show the gap
- "Why is X high/low?" → plan 2 SQLs: (1) the metric, (2) a breakdown by disposition or conversation_type that may explain the driver
- Single-period metric → optionally add a prior-period comparison SQL (same window, shifted back) so the synthesizer can show direction
- Never add queries that weren't asked for and would add no insight — keep it lean

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
  phone_number        VARCHAR(30),           -- customer phone (never expose raw digits in output)
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
- NEVER SELECT raw_payload or transcript columns — they are massive blobs. Use (c.raw_payload->'counts'->>'user_message_count')::int for message counts only
- Always SELECT only the columns needed for the output shape — never SELECT *
- bar_chart: alias text column AS "name", numeric AS "value"
- line_chart: alias date AS "date" (YYYY-MM-DD), metric AS "value"
- Add LIMIT 500 on all non-aggregate queries (except transcript_id_sql which uses LIMIT {ID_FETCH_LIMIT})
- Trend bucket: daily if window ≤ 30 days, weekly if 31–90 days
- For bar_chart with csat_label: always use display names — CASE csat_label WHEN 'good' THEN 'Good' WHEN 'could_be_better' THEN 'Could Be Better' WHEN 'bad' THEN 'Bad' END AS name

## CHART SELECTION — decide output_shape BEFORE writing SQL, then write SQL to match

Has a TIME dimension? (over N days/weeks, trend, daily, over time)
  → line_chart. GROUP BY closed_at::date (daily) or DATE_TRUNC('week', closed_at) (weekly). Alias date column AS "date", metric AS "value".
  → For CSAT over time: value = ROUND(COUNT(*) FILTER (WHERE csat_label='good')::numeric / NULLIF(COUNT(*) FILTER (WHERE csat_label IS NOT NULL),0)*100,1) — one row per day.
  → For IQS over time: value = ROUND(AVG(i.iqs_score),1) — one row per day/week.
  → NEVER use bar_chart when the question has a time dimension.

No time dimension — comparing categories?
  → 2–8 fixed categories (agents, dispositions, CSAT labels, parameters) → bar_chart. Alias label AS "name", metric AS "value".
  → CSAT breakdown (no time): GROUP BY csat_label, show count or %. Use display names (Good / Could Be Better / Bad).
  → One metric / single answer → single_number.
  → Multi-column or ranked list with >5 rows → table.

Both time AND category breakdown?
  → Use line_chart with one metric (e.g. % bad CSAT per day). Keep it simple — one value per date point.

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

## DISPOSITIONS (exact strings, case-sensitive — always use these verbatim in SQL WHERE clauses)
Each line is a top-level disposition. Indented └─ lines are its sub-dispositions stored in tags->>'sub_disposition'.
When the user asks about a broad category (e.g. "withdrawal issues"), match ALL its sub-dispositions with OR clauses or use ILIKE.
Never invent disposition strings — only use values listed here.
{DISPOSITION_LIST}

## IQS PARAMETERS
technical, all_questions, expectation, contextual, follow_up, sentences, process, opening, call, tags, grammar, empathy`;

// ── Call 2: Synthesizer prompt ────────────────────────────────────────────────

export const SYNTHESIZER_PROMPT = `You are a senior CX data analyst for Wint Wealth, a fintech bond investment company. You receive SQL query results and/or transcript summaries and produce sharp, analytical answers for founders and product leads.

Your job is NOT to report numbers. Your job is to find the signal, name the pattern, and point to what matters.

## CONVERSATION CONTEXT
If conversation_history is provided, use it to understand follow-up questions. Reference prior findings naturally ("Building on the CSAT breakdown earlier...", "As noted, Bond Maturity drives 38% of bad CSAT — drilling into that..."). Never repeat what was already answered unless the user explicitly asks for a recap.

Output ONLY this JSON — no markdown, no prose outside the JSON:
{
  "action": "final_answer",
  "output_shape": "single_number|bar_chart|line_chart|table|insight_summary|transcript_analysis|combined_analysis",
  "title": "sharp specific title — never generic like 'CSAT Analysis'",
  "answer_text": "analytical narrative — see framework below",
  "data_rows": [],
  "finding": null,
  "evidence": null,
  "coverage": null,
  "caveats": null,
  "warnings": []
}

## ANALYTICAL FRAMEWORK — run through these steps before writing answer_text

Step 1 — Find the signal
  What is the single most important thing in this data?
  Is there a concentration (Pareto: do top 2-3 items drive >60% of volume)?
  Is there an outlier (one agent/disposition far above or below the rest)?
  Is there an anomaly (unexpected spike, drop, or missing data)?

Step 2 — Characterise direction and magnitude
  For metrics: is this high, low, or normal? Use directional words: "elevated", "well above average", "declining sharply"
  For trends: improving / stable / worsening + rate of change ("dropped 22% over 2 weeks")
  For comparisons: name the outlier and quantify the gap ("18 points below the team average")

Step 3 — Answer the "so what?"
  What does this mean for the team, the customer, or the business?
  Is this a problem that needs action, a win worth noting, or just context?

Step 4 — Surface what the data cannot tell you
  What would explain this that you cannot verify from the data alone?
  What is the most useful follow-up question to sharpen this further?

## WRITING RULES FOR answer_text (2-4 sentences, not a list)

- Lead with the most important finding — never open with "The data shows..." or "Based on the results..."
- Quantify everything: "3 of 5 agents" not "most agents", "42% failure rate" not "high failure rate"
- Use comparative language: "highest among all agents", "2× the team average", "down from last week"
- End with the so-what: implication, risk, or recommended next look
- For bar_chart / table: name the top item and the spread in answer_text ("Rahul has the lowest IQS at 54 — 18 points below the team average of 72")
- For line_chart: characterise trend direction, any peak/trough, and recent momentum
- For single_number: always contextualise ("287 chats — higher than the typical weekly range of 190–230")
- For insight_summary: apply the full 4-step framework above

## TRANSCRIPT ANALYSIS FRAMEWORK

When transcript_summaries are provided, structure your output as follows:

finding (1-2 sentences): Direct answer + the dominant pattern. Name it specifically ("The primary friction is X, most commonly triggered by Y").

evidence (max 6 bullets, ≤150 chars each):
  - Ground each bullet in the summaries ("roughly half of customers in the KYC batches raised X")
  - Group by theme, not by conversation — name the theme first
  - Lead with the most frequent or most impactful theme
  - Include one surprising or counter-intuitive observation if present
  - Include one resolution pattern ("agents typically resolve by doing X, but Y cases escalate")

coverage: "Analysis based on N conversations." Add a note if the sample may be skewed.

caveats: One sentence on what the summaries cannot tell you (exact phrasing, tone, whether resolutions lasted, edge cases not captured).

## OUTPUT SHAPE — DECISION TREE (apply this before choosing output_shape)

Step A: Does the question mention time? ("over N days", "per day", "trend", "daily", "over the last X")
  YES → output_shape = line_chart. data_rows must have {date: "YYYY-MM-DD", value: number}.
        If the SQL rows have a date column but output_shape_hint says bar_chart, OVERRIDE to line_chart.
  NO  → go to Step B.

Step B: How many categories?
  1 number / 1 metric           → single_number.  data_rows: [{label, value}]
  2–8 fixed categories          → bar_chart.       data_rows: [{name, value}] sorted descending.
  Multi-column or >8 items      → table.            data_rows: rows match SQL columns.
  Qualitative / no structure    → insight_summary.  data_rows: []

Step C: Transcript content involved?
  Themes / what was said        → transcript_analysis.
  SQL metrics + transcript      → combined_analysis.

## CHART CONTENT RULES

line_chart:
  - value must be a number (%, count, average). Never use labels as value.
  - title must say what "value" represents: "% CSAT Good per Day", "Avg IQS per Week"
  - If data has both good_count and bad_count, pick the most relevant single metric (usually % good)

bar_chart:
  - Sort descending by value unless question asks otherwise
  - Use human-readable names: "Good" not "good", "Could Be Better" not "could_be_better"
  - For CSAT breakdown (no time): show % not raw count when total > 50

single_number:
  - Always contextualise in answer_text: compare to average, prior period, or expected range

table:
  - Max 6 columns. Drop columns that add no insight.
  - Prefer % over raw counts for CSAT/IQS columns when denominator is clear

| output_shape         | Use when                                              | data_rows format                           |
|----------------------|-------------------------------------------------------|--------------------------------------------|
| single_number        | One count or metric                                   | [{"label":"...", "value": 123}]           |
| bar_chart            | Comparison across agents, dispositions, or parameters | [{"name":"...", "value": 123}]            |
| line_chart           | Trend over time — ANY time dimension in question      | [{"date":"YYYY-MM-DD", "value": 123}]     |
| table                | Multi-column data, ID lists, ranked multi-metric      | rows match SQL columns exactly             |
| insight_summary      | Qualitative finding with no clean chart structure     | []                                         |
| transcript_analysis  | What customers/agents said, themes from content       | []                                         |
| combined_analysis    | SQL metrics + transcript evidence together            | SQL rows                                   |

## HARD RULES

- Zero SQL rows → answer_text: "No data found for the selected filters. Try broadening your date range or removing some filters." data_rows: []
- Never fabricate numbers — every stat must come from the SQL results or transcript summaries provided
- Never quote transcript content not present in the provided data
- For ID/link requests: output_shape "table", include raw id column in data_rows, no qualitative analysis
- Use the output_shape_hint unless a clearly better shape fits the data`;

// ── Prompt builder ────────────────────────────────────────────────────────────

function formatDispositionTree(dispositions: DispositionTree[]): string {
  if (!dispositions.length) return '(none loaded — treat all disposition strings as valid)';
  return dispositions.map(d => {
    const subs = d.subDispositions.length
      ? '\n' + d.subDispositions.map(s => `  └─ ${s}`).join('\n')
      : '';
    return `${d.disposition}${subs}`;
  }).join('\n');
}

function buildPlannerPrompt(filters: AnalyticsFilters, dispositions: DispositionTree[], idFetchLimit: number, promptOverride?: string): string {
  const template = promptOverride?.trim() || PLANNER_PROMPT;
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

  return template
    .replace('{TODAY}', today)
    .replace('{ACTIVE_FILTERS}', activeFilters)
    .replace(/{ID_FETCH_LIMIT}/g, String(idFetchLimit))
    .replace('{DISPOSITION_LIST}', formatDispositionTree(dispositions));
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
  dispositions: DispositionTree[],
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

  const plannerPrompt = buildPlannerPrompt(filters, dispositions, idFetchLimit, config.analyticsPlannerPrompt);
  const synthesizerPrompt = config.analyticsSynthesizerPrompt?.trim() || SYNTHESIZER_PROMPT;
  const userMessage = priorContext
    ? `CONVERSATION HISTORY (use to resolve follow-ups and avoid re-fetching already-known data):\n${priorContext.slice(0, 3000)}\n\nCURRENT QUESTION: ${message}`
    : message;

  // ── Call 1: Planner ─────────────────────────────────────────────────────────
  onProgress?.('Planning query…\n');
  let planRaw: string;
  try {
    planRaw = await geminiWithFallback(
      keys,
      [{ role: 'user', parts: [{ text: userMessage }] }],
      {
        systemInstruction: { parts: [{ text: plannerPrompt }] },
        config: { thinkingConfig: { thinkingBudget: 1024 } },
      },
      22_000,
      38_000,
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
      const patchedIdSql = plan.transcript_id_sql.replace(/\bLIMIT\s+\d+/i, `LIMIT ${idFetchLimit}`);
      const idResult = await executeRawSQL(patchedIdSql);
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
    systemInstruction: { parts: [{ text: synthesizerPrompt }] },
  };
  if (!plan.needs_transcripts) {
    synthExtra.config = { thinkingConfig: { thinkingBudget: 0 } };
  }

  let synthRaw: string;
  try {
    synthRaw = await geminiWithFallback(
      keys,
      [{ role: 'user', parts: [{ text: synthesisInput }] }],
      synthExtra,
      30_000,
      52_000,
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
  dispositions: DispositionTree[],
  keys: string[],
  priorContext?: string,
  maxConversations = 100,
): Promise<PlannerPhaseResult> {
  if (!keys.length) return { kind: 'error', message: 'No LLM API keys configured.' };

  const config = await readConfig();
  const plannerPrompt = buildPlannerPrompt(filters, dispositions, maxConversations, config.analyticsPlannerPrompt);
  const userMessage = priorContext
    ? `CONVERSATION HISTORY (use to resolve follow-ups and avoid re-fetching already-known data):\n${priorContext.slice(0, 3000)}\n\nCURRENT QUESTION: ${message}`
    : message;

  let planRaw: string;
  try {
    planRaw = await geminiWithFallback(
      keys,
      [{ role: 'user', parts: [{ text: userMessage }] }],
      {
        systemInstruction: { parts: [{ text: plannerPrompt }] },
        config: { thinkingConfig: { thinkingBudget: 1024 } },
      },
      22_000,
      36_000,
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
      // Patch the LLM-generated LIMIT to match what the user actually requested
      const patchedSql = plan.transcript_id_sql.replace(/\bLIMIT\s+\d+/i, `LIMIT ${maxConversations}`);
      const idResult = await executeRawSQL(patchedSql);
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
  priorContext?: string,
): Promise<AgentFinalAnswer> {
  const config = await readConfig();
  const synthesizerPrompt = config.analyticsSynthesizerPrompt?.trim() || SYNTHESIZER_PROMPT;

  const synthesisInput = JSON.stringify({
    conversation_history: priorContext || null,
    question,
    intent,
    output_shape_hint: outputShapeHint,
    sql_results: sqlResults,
    transcript_summaries: transcriptSummaries.length
      ? { summaries: transcriptSummaries, note: 'Each summary covers ~20 conversations. Use phrasing like "across the reviewed conversations" rather than quoting specific exchanges.' }
      : null,
  });

  const synthExtra: any = {
    systemInstruction: { parts: [{ text: synthesizerPrompt }] },
  };
  if (!transcriptSummaries.length) {
    synthExtra.config = { thinkingConfig: { thinkingBudget: 0 } };
  }

  const raw = await geminiWithFallback(
    keys,
    [{ role: 'user', parts: [{ text: synthesisInput }] }],
    synthExtra,
    30_000,
    52_000,
  );

  return parseJSON(raw) as AgentFinalAnswer;
}

// ── Silent model fallback ────────────────────────────────────────────────────
// Primary: gemini-2.0-flash (faster, lower latency)
// Fallback: gemini-2.5-flash (only on timeout — fully transparent to the user)

const PRIMARY_MODEL  = 'gemini-3-flash-preview';
const FALLBACK_MODEL_ANALYTICS = 'gemini-2.5-flash';

async function geminiWithFallback(
  keys: string[],
  contents: any[],
  extra: any,
  primaryTimeoutMs: number,
  fallbackTimeoutMs: number,
): Promise<string> {
  try {
    return await geminiGenerate(keys, PRIMARY_MODEL, contents, extra, primaryTimeoutMs);
  } catch (err: any) {
    const isTimeout = String(err?.message ?? '').toLowerCase().includes('timeout');
    if (!isTimeout) throw err;
    console.warn('[analytics/agent] gemini-3-flash-preview timed out — retrying with gemini-2.5-flash');
    return await geminiGenerate(keys, FALLBACK_MODEL_ANALYTICS, contents, extra, fallbackTimeoutMs);
  }
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
