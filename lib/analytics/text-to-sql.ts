import { geminiGenerate, getOrderedGeminiKeys } from '@/lib/gemini';
import { readConfig } from '@/lib/config';
import type { AnalyticsFilters } from './types';

// ── Full DB schema embedded for the LLM ──────────────────────────────────────

const DB_SCHEMA = `
TABLE: conversations
Purpose: One row per closed Robylon chat. The primary analytics table.
  id                  VARCHAR(100) PRIMARY KEY  -- Robylon chat_id (use as c.id)
  contact_id          BIGINT                    -- FK contacts.id
  waba_channel_id     INTEGER                   -- FK waba_channels.id
  team_id             INTEGER                   -- FK teams.id
  agent_id            INTEGER                   -- FK agents.id
  conversation_type   VARCHAR(10)               -- 'bot' | 'agent' | 'hybrid'
  started_at          TIMESTAMPTZ
  closed_at           TIMESTAMPTZ               -- use this for date filtering
  csat_score          SMALLINT                  -- 1=bad  3=could_be_better  5=good  (NULL if no response)
  csat_label          VARCHAR(20)               -- 'good' | 'could_be_better' | 'bad'  (NULL if no response)
  tags                JSONB                     -- {"disposition":"Payment Issue","sub_disposition":"Refund Request"}
  frt_seconds         INTEGER                   -- first-response time in seconds (NULL for bot-only)
  bot_to_team_seconds INTEGER                   -- seconds from bot start to agent handoff
  resolution_seconds  INTEGER                   -- total resolution time in seconds
  created_at          TIMESTAMPTZ

TABLE: iqs_scores
Purpose: LLM-generated quality scores. NOT every conversation is scored.
  chat_id        VARCHAR(100) PRIMARY KEY  -- FK conversations.id
  iqs_score      SMALLINT                 -- composite score 0–100
  parameters     JSONB                    -- parameter detail (see below)
  scored_at      TIMESTAMPTZ

IQS parameters JSONB — access pattern: (parameters->'<key>'->>'score')::text
  Parameter keys (all lowercase in JSONB):
    technical, all_questions, expectation, contextual, follow_up,
    sentences, process, opening, call, tags, grammar, empathy
  score values: 'true' = pass  |  'false' = fail  |  null = not applicable

CRITICAL JOIN RULES:
  -- To count ALL conversations (volume, disposition counts, CSAT, trends): query conversations ONLY, NO join to iqs_scores.
  -- To compute IQS averages or parameter pass/fail rates: JOIN iqs_scores ON iqs_scores.chat_id = c.id (INNER — restricts to scored chats).
  -- NEVER join iqs_scores just to count conversations — it silently excludes unscored chats and gives wrong totals.
  -- "Calls requested" / "calls were requested" means disposition = Calls_Directly (use conversations.tags). Do NOT use the 'call' IQS parameter for this.

TABLE: agents
  id      SERIAL PRIMARY KEY
  name    VARCHAR(255) UNIQUE
  team_id INTEGER      -- FK teams.id
  status  VARCHAR(10)  -- 'active' | 'inactive'

TABLE: teams
  id   SERIAL PRIMARY KEY
  name VARCHAR(100) UNIQUE  -- 'Regular' | 'HNI'
  type VARCHAR(20)          -- 'regular' | 'hni'

TABLE: waba_channels
  id     SERIAL PRIMARY KEY
  number VARCHAR(20) UNIQUE
  type   VARCHAR(20)  -- 'platform_regular' | 'platform_hni' | 'hni_rm'
  name   VARCHAR(100)

TABLE: contacts
  id    BIGSERIAL PRIMARY KEY
  phone VARCHAR(20) UNIQUE

KEY QUERY PATTERNS:
  -- Disposition filter:      tags->>'disposition' = 'Payment Issue'
  -- Sub-disposition filter:  tags->>'sub_disposition' = 'Refund Request'
  -- Bad CSAT:                csat_label = 'bad'
  -- CBB CSAT:                csat_label = 'could_be_better'
  -- Unclassified chats:      tags->>'disposition' IS NULL
  -- IQS param pass rate:     (parameters->'technical'->>'score')::text = 'true'
  -- IQS param fail rate:     (parameters->'technical'->>'score')::text = 'false'
  -- Week bucket:             date_trunc('week', closed_at)::date AS week_start
  -- Day bucket:              closed_at::date AS day
  -- Agent join:              JOIN agents a ON a.id = c.agent_id
  -- Team join:               JOIN teams t ON t.id = c.team_id
  -- Percentage:              ROUND(100.0 * COUNT(CASE WHEN x THEN 1 END) / NULLIF(COUNT(*), 0), 1)
`;

// ── Result types ──────────────────────────────────────────────────────────────

export type TextToSQLResult =
  | { kind: 'sql'; sql: string; chartHint: 'bar' | 'line' | 'table' | 'stat'; title: string }
  | { kind: 'theme_extraction' }
  | { kind: 'cannot_answer'; message: string };

// ── Prompt builder ────────────────────────────────────────────────────────────

function buildPrompt(
  message: string,
  filters: AnalyticsFilters,
  priorContext: string | undefined,
  today: string,
): string {
  const csatStr  = filters.csatLabels.length    ? filters.csatLabels.join(', ')       : 'all';
  const typeStr  = filters.conversationTypes.length ? filters.conversationTypes.join(', ') : 'all';
  const teamStr  = filters.teams.length         ? `IDs: ${filters.teams.join(', ')}` : 'all';
  const dispStr  = filters.dispositions.length  ? filters.dispositions.join(', ')    : 'all';

  return `You are a PostgreSQL query generator for a CX analytics dashboard at Wint Wealth (fintech bond company).

Your job: read the user question and output ONE JSON object — nothing else, no markdown, no explanation.

═══════════════════════════════════════════════
OUTPUT FORMAT — choose exactly one
═══════════════════════════════════════════════

For questions answerable by SQL:
{"kind":"sql","sql":"SELECT ...","chartHint":"bar|line|table|stat","title":"Human-readable chart title"}

For questions about what customers are SAYING, THEMES, WHY things happen, summarising issues:
{"kind":"theme_extraction"}

For questions that are truly impossible to answer from this database schema:
{"kind":"cannot_answer","message":"One sentence saying what you CAN answer instead"}

═══════════════════════════════════════════════
SQL RULES — follow exactly, every time
═══════════════════════════════════════════════
1. Only SELECT queries. Never INSERT/UPDATE/DELETE/DROP/CREATE/ALTER/TRUNCATE/GRANT.
2. Never access pg_* tables or information_schema.
3. Always alias columns for rendering:
   bar   chart → text label AS "name",  numeric AS "value"  (optional 3rd column AS "sub")
   line  chart → date string AS "date" (YYYY-MM-DD),  numeric AS "value"
   stat  block → label string AS "label",  value string AS "value"
   table       → descriptive column aliases, max 6 columns
4. Add LIMIT 500 unless the query returns a single aggregate row.
5. Always filter by closed_at for date ranges (not started_at or created_at).
6. Use ILIKE for disposition/sub-disposition text matching when the user names one.
7. Return duration columns as plain integers (seconds). The UI formats them.
8. For IQS averages or parameter rates: JOIN iqs_scores ON iqs_scores.chat_id = c.id. For pure conversation counts (volume, disposition, CSAT): do NOT join iqs_scores.
9. For percentages: ROUND(100.0 * numerator / NULLIF(denominator, 0), 1) AS pct
10. Apply the active filters below as WHERE-clause defaults, UNLESS the user question overrides a dimension.

═══════════════════════════════════════════════
CHART HINT GUIDE
═══════════════════════════════════════════════
bar   → ranked counts, breakdowns by category, failure rate comparisons
line  → any time-series trend (daily, weekly, monthly)
stat  → single aggregate numbers (total count, one average, one metric)
table → multi-column agent/team tables, period comparisons, anything with 3+ metrics per row

${DB_SCHEMA}

═══════════════════════════════════════════════
ACTIVE FILTER BAR (use as WHERE-clause defaults)
═══════════════════════════════════════════════
Date range:         ${filters.dateFrom} to ${filters.dateTo}
CSAT labels:        ${csatStr}
Conversation types: ${typeStr}
Teams:              ${teamStr}
Dispositions:       ${dispStr}
Today:              ${today}
${priorContext ? `
═══════════════════════════════════════════════
PRIOR CONTEXT (previous assistant answer — use to resolve follow-up questions)
═══════════════════════════════════════════════
${priorContext.slice(0, 600)}
` : ''}
USER QUESTION: ${message}`;
}

// ── SQL safety guard ──────────────────────────────────────────────────────────

const BLOCKED_PATTERNS = [
  /\bINSERT\b/,
  /\bUPDATE\b/,
  /\bDELETE\b/,
  /\bDROP\b/,
  /\bCREATE\b/,
  /\bALTER\b/,
  /\bTRUNCATE\b/,
  /\bGRANT\b/,
  /\bREVOKE\b/,
  /\bPG_/,
  /INFORMATION_SCHEMA/,
];

function validateSQL(sql: string): boolean {
  const trimmed = sql.trim();
  if (!trimmed.toUpperCase().startsWith('SELECT')) return false;
  const upper = trimmed.toUpperCase();
  return !BLOCKED_PATTERNS.some(re => re.test(upper));
}

// Ensure LIMIT exists; append if missing
function enforceLimit(sql: string, max = 500): string {
  const cleaned = sql.trimEnd().replace(/;+$/, '');
  return /\bLIMIT\s+\d+/i.test(cleaned) ? cleaned : `${cleaned} LIMIT ${max}`;
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function generateSQL(
  message: string,
  filters: AnalyticsFilters,
  priorContext?: string,
): Promise<TextToSQLResult> {
  const config = await readConfig();
  const keys = getOrderedGeminiKeys(config);
  if (!keys.length) {
    return { kind: 'cannot_answer', message: 'No LLM API keys configured.' };
  }

  const today = new Date().toISOString().slice(0, 10);
  const prompt = buildPrompt(message, filters, priorContext, today);

  let raw: string;
  try {
    raw = await geminiGenerate(
      keys,
      'gemini-3.5-flash',
      [{ role: 'user', parts: [{ text: prompt }] }],
      {},
      20_000,
    );
  } catch (err: any) {
    console.error('[text-to-sql] LLM error:', err?.message);
    return { kind: 'cannot_answer', message: 'LLM unavailable — please try again.' };
  }

  const cleaned = raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  let parsed: any;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    console.error('[text-to-sql] JSON parse failed:', cleaned.slice(0, 300));
    return { kind: 'cannot_answer', message: 'Could not understand the LLM response.' };
  }

  if (parsed.kind === 'theme_extraction') {
    return { kind: 'theme_extraction' };
  }

  if (parsed.kind === 'cannot_answer') {
    return { kind: 'cannot_answer', message: parsed.message ?? 'Unable to answer this question.' };
  }

  if (parsed.kind === 'sql' && typeof parsed.sql === 'string') {
    if (!validateSQL(parsed.sql)) {
      console.warn('[text-to-sql] SQL validation rejected:', parsed.sql.slice(0, 200));
      return { kind: 'cannot_answer', message: 'The generated query was rejected for safety reasons.' };
    }
    const chartHint = ['bar', 'line', 'table', 'stat'].includes(parsed.chartHint)
      ? parsed.chartHint as 'bar' | 'line' | 'table' | 'stat'
      : 'table';
    return {
      kind: 'sql',
      sql: enforceLimit(parsed.sql),
      chartHint,
      title: typeof parsed.title === 'string' ? parsed.title : '',
    };
  }

  return { kind: 'cannot_answer', message: 'Unexpected response format from LLM.' };
}
