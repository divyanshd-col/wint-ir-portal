-- Migration 042: Create exotel_call_recordings table
-- Dedicated storage for raw Exotel calls made directly by agents.
-- Strictly for audit/storage purposes; not evaluated or transcribed.

CREATE TABLE IF NOT EXISTS exotel_call_recordings (
  call_sid         VARCHAR(100) PRIMARY KEY,
  agent_phone      VARCHAR(50),
  customer_phone   VARCHAR(50),
  duration_seconds INTEGER,
  recording_url    TEXT,
  status           VARCHAR(50),
  direction        VARCHAR(50),
  called_at        TIMESTAMPTZ NOT NULL,
  raw_payload      JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_exotel_calls_called_at ON exotel_call_recordings (called_at DESC);
CREATE INDEX IF NOT EXISTS idx_exotel_calls_agent_phone ON exotel_call_recordings (agent_phone);
CREATE INDEX IF NOT EXISTS idx_exotel_calls_customer_phone ON exotel_call_recordings (customer_phone);

