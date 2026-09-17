// Full database schema description, embedded verbatim into LLM prompts.
//
// Single source of truth shared by:
//   - lib/analytics/text-to-sql.ts  (the in-app Gemini planner, legacy path)
//   - app/api/mcp/[transport]/route.ts  (the remote MCP `get_schema` tool)
//
// Keep this in sync with db/migrations/*.sql. When a table or column changes,
// update it here and both consumers pick it up.

export const DB_SCHEMA = `
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
  phone VARCHAR(20) UNIQUE   -- PII: masked in MCP results (last 4 digits only)

KEY QUERY PATTERNS:
  -- Disposition filter:      tags->>'disposition' = 'Payment Issue'
  -- Sub-disposition filter:  tags->>'sub_disposition' = 'Refund Request'
  -- Bad CSAT:                csat_label = 'bad'
  -- CBB CSAT:                csat_label = 'could_be_better'
  -- Unclassified chats:      tags->>'disposition' IS NULL
  -- IQS param pass rate:     COALESCE(parameters->'__agent_parameters'->'accuracy', parameters->'accuracy')->>'score' = 'true'
  -- IQS param fail rate:     COALESCE(parameters->'__agent_parameters'->'accuracy', parameters->'accuracy')->>'score' = 'false'
  -- IQS param keys (v4):     issue_resolution, accuracy, expectation_follow_through, dissatisfactionhandling, personalization, empathy, escalation_decision, readability, greeting_handover, post_call_recap
  -- Score values are text 'true' | 'false' | '0.5' | 'null' — never cast score to boolean
  -- Week bucket:             date_trunc('week', closed_at)::date AS week_start
  -- Day bucket:              closed_at::date AS day
  -- Agent join:              JOIN agents a ON a.id = c.agent_id
  -- Team join:               JOIN teams t ON t.id = c.team_id
  -- Percentage:              ROUND(100.0 * COUNT(CASE WHEN x THEN 1 END) / NULLIF(COUNT(*), 0), 1)

CONVERSATION TRANSCRIPTS (what was actually said):
  -- conversations.transcript is a JSONB array of messages ({sender_type, content, timestamp}).
  -- It is a large blob and is NEVER returned by run_read_query (do not SELECT it).
  -- Two ways to use transcript content:
  --   1) Keyword/existence questions ("how many chats mentioned 'refund'?") — filter in SQL WITHOUT fetching:
  --        WHERE c.transcript::text ILIKE '%refund%'
  --   2) Content questions (tone, verbatim quotes, root cause, why CSAT was bad, themes) — use the
  --      get_transcripts tool: first run_read_query to get the relevant chat_ids (add a LIMIT, e.g. 20),
  --      then call get_transcripts({ chat_ids: [...] }) with up to 50 ids to read the messages.
  -- Fetch transcripts only when the answer depends on their content; for counts/metrics, SQL alone is enough.
`;
