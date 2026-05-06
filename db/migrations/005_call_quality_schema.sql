-- Call quality schema
-- call_recordings: one row per call, holds audio metadata + Gemini transcript segments
-- call_iqs_scores: IQS parameters scored against the call transcript

CREATE TABLE IF NOT EXISTS call_recordings (
  id                 VARCHAR(100) PRIMARY KEY,
  chat_id            VARCHAR(100) REFERENCES conversations(id) ON DELETE SET NULL,
  agent_id           INTEGER REFERENCES agents(id) ON DELETE SET NULL,
  contact_id         BIGINT REFERENCES contacts(id) ON DELETE SET NULL,
  recording_url      TEXT,
  duration_seconds   INTEGER,
  called_at          TIMESTAMPTZ,
  language           VARCHAR(100),
  transcript         JSONB,          -- array of { type, speaker, text, ... } segments
  interruption_count SMALLINT DEFAULT 0,
  dead_air_count     SMALLINT DEFAULT 0,
  status             VARCHAR(20) NOT NULL DEFAULT 'transcribed',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS call_recordings_chat_id_idx ON call_recordings (chat_id);
CREATE INDEX IF NOT EXISTS call_recordings_agent_id_idx ON call_recordings (agent_id);
CREATE INDEX IF NOT EXISTS call_recordings_called_at_idx ON call_recordings (called_at DESC);

CREATE TABLE IF NOT EXISTS call_iqs_scores (
  call_id        VARCHAR(100) PRIMARY KEY REFERENCES call_recordings(id) ON DELETE CASCADE,
  iqs_score      SMALLINT NOT NULL CHECK (iqs_score BETWEEN 0 AND 100),
  parameters     JSONB NOT NULL,   -- { "Technical": { "score": true|false|null, "reasoning": "..." }, ... }
  model_version  VARCHAR(50),
  scored_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
