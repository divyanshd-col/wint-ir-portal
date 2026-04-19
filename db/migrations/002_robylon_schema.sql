-- Teams (seed manually: 'regular' and 'hni')
CREATE TABLE IF NOT EXISTS teams (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR(100) NOT NULL UNIQUE,
  type       VARCHAR(20)  DEFAULT 'regular',
  created_at TIMESTAMPTZ  DEFAULT NOW()
);

-- WhatsApp Business channels
CREATE TABLE IF NOT EXISTS waba_channels (
  id         SERIAL PRIMARY KEY,
  number     VARCHAR(20)  UNIQUE,
  type       VARCHAR(20)  CHECK (type IN ('platform_regular','platform_hni','hni_rm')),
  name       VARCHAR(100),
  created_at TIMESTAMPTZ  DEFAULT NOW()
);

-- Agents (auto-created from webhook agent names if missing)
CREATE TABLE IF NOT EXISTS agents (
  id              SERIAL PRIMARY KEY,
  name            VARCHAR(255) NOT NULL UNIQUE,
  team_id         INTEGER REFERENCES teams(id),
  waba_channel_id INTEGER REFERENCES waba_channels(id),
  status          VARCHAR(10)  DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at      TIMESTAMPTZ  DEFAULT NOW()
);

-- Contacts (upserted on every webhook by phone number)
CREATE TABLE IF NOT EXISTS contacts (
  id         BIGSERIAL PRIMARY KEY,
  phone      VARCHAR(20) UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Conversations (one row per closed Robylon chat — written at TICKET_CLOSED)
CREATE TABLE IF NOT EXISTS conversations (
  id                   VARCHAR(100) PRIMARY KEY,  -- Robylon chat_id
  contact_id           BIGINT     REFERENCES contacts(id),
  waba_channel_id      INTEGER    REFERENCES waba_channels(id),
  team_id              INTEGER    REFERENCES teams(id),
  agent_id             INTEGER    REFERENCES agents(id),
  conversation_type    VARCHAR(10) CHECK (conversation_type IN ('bot','agent','hybrid')),
  started_at           TIMESTAMPTZ,
  closed_at            TIMESTAMPTZ,
  csat_score           SMALLINT   CHECK (csat_score IN (1,3,5)),
  csat_label           VARCHAR(20) CHECK (csat_label IN ('good','could_be_better','bad')),
  webhook_trigger      VARCHAR(30),
  transcript           JSONB,
  tags                 JSONB,
  frt_seconds          INTEGER,
  bot_to_team_seconds  INTEGER,
  resolution_seconds   INTEGER,
  raw_payload          JSONB,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_conversations_agent   ON conversations(agent_id);
CREATE INDEX IF NOT EXISTS idx_conversations_closed  ON conversations(closed_at);
CREATE INDEX IF NOT EXISTS idx_conversations_csat    ON conversations(csat_score) WHERE csat_score IS NOT NULL;

-- IQS scores (one row per scored conversation — written async by LLM pipeline)
CREATE TABLE IF NOT EXISTS iqs_scores (
  chat_id       VARCHAR(100) PRIMARY KEY REFERENCES conversations(id),
  iqs_score     SMALLINT    NOT NULL CHECK (iqs_score BETWEEN 0 AND 100),
  parameters    JSONB       NOT NULL,  -- {"technical": {"score": true|false|null, "reasoning": "..."}, ...}
  model_version VARCHAR(50),
  scored_at     TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_iqs_scores_scored_at ON iqs_scores(scored_at);

-- Seed teams
INSERT INTO teams (name, type) VALUES ('Regular', 'regular'), ('HNI', 'hni') ON CONFLICT DO NOTHING;
