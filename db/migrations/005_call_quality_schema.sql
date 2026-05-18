-- call_recordings: stores call audio metadata + Gemini transcript segments.
-- One row per call, linked to conversations via chat_id.
-- Call IQS scores live in the existing iqs_scores table (new columns added below)
-- so every chat_id has one row that covers both chat quality and call quality.

CREATE TABLE IF NOT EXISTS call_recordings (
  id                 VARCHAR(100) PRIMARY KEY,
  chat_id            VARCHAR(100) REFERENCES conversations(id) ON DELETE SET NULL,
  agent_id           INTEGER REFERENCES agents(id) ON DELETE SET NULL,
  contact_id         BIGINT REFERENCES contacts(id) ON DELETE SET NULL,
  recording_url      TEXT,
  duration_seconds   INTEGER,
  called_at          TIMESTAMPTZ,
  language           VARCHAR(100),
  transcript         JSONB,          -- array of CallSegment objects
  interruption_count SMALLINT DEFAULT 0,
  dead_air_count     SMALLINT DEFAULT 0,
  status             VARCHAR(30) NOT NULL DEFAULT 'transcribed',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS call_recordings_chat_id_idx  ON call_recordings (chat_id);
CREATE INDEX IF NOT EXISTS call_recordings_agent_id_idx ON call_recordings (agent_id);
CREATE INDEX IF NOT EXISTS call_recordings_called_at_idx ON call_recordings (called_at DESC);

-- Add call IQS columns to the existing iqs_scores table.
-- iqs_score + parameters      = chat quality score (unchanged)
-- call_iqs_score + call_parameters = call quality score (new)
-- Both are keyed by chat_id — one row covers both interactions.
ALTER TABLE iqs_scores
  ADD COLUMN IF NOT EXISTS call_iqs_score     SMALLINT CHECK (call_iqs_score BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS call_parameters    JSONB,
  ADD COLUMN IF NOT EXISTS call_model_version VARCHAR(50),
  ADD COLUMN IF NOT EXISTS call_scored_at     TIMESTAMPTZ;
