-- Migration 026: Dedicated pcg_call_recordings Table for Runo PCG Call Recordings
CREATE TABLE IF NOT EXISTS pcg_call_recordings (
  id                  BIGSERIAL PRIMARY KEY,
  call_id             VARCHAR(100) UNIQUE NOT NULL,      -- Runo callId (e.g. 68fb1d8ecf9af992f3132454)
  caller_id           VARCHAR(100),                      -- Runo callerId
  called_by           VARCHAR(100),                      -- Runo calledBy (admin/team name)
  agent_name          VARCHAR(255),                      -- Runo rep name (e.g. Aravind)
  customer_id         VARCHAR(100),                      -- Runo customerId
  phone_number        VARCHAR(50),                       -- Customer phone (+919014502431)
  user_phone          VARCHAR(50),                       -- Agent phone (+919989766169)
  process_id          VARCHAR(100),                      -- Runo processId
  call_type           VARCHAR(50),                       -- 'outgoing', 'incoming', 'missed'
  tag                 VARCHAR(100),                      -- 'unanswered', null, etc.
  duration_seconds    INT DEFAULT 0,                     -- Call duration in seconds
  recording_url       TEXT,                              -- S3 AAC/MP3 audio recording URL
  start_time          TIMESTAMPTZ,                       -- Call start timestamp
  created_at_time     TIMESTAMPTZ,                       -- Call created timestamp
  raw_payload         JSONB NOT NULL,                    -- Raw Runo JSON payload as received
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pcg_call_recordings_call_id ON pcg_call_recordings(call_id);
CREATE INDEX IF NOT EXISTS idx_pcg_call_recordings_phone ON pcg_call_recordings(phone_number);
CREATE INDEX IF NOT EXISTS idx_pcg_call_recordings_start ON pcg_call_recordings(start_time DESC);
