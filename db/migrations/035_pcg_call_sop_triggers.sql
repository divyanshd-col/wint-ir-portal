-- Migration 035: PCG Call SOP Triggers Table & Evaluation Column
-- Stores behavioral/compliance monitoring alerts for Runo PCG voice calls across the 7 monitoring categories.

CREATE TABLE IF NOT EXISTS pcg_call_sop_triggers (
  id BIGSERIAL PRIMARY KEY,
  call_id VARCHAR(100) NOT NULL REFERENCES pcg_call_recordings(call_id) ON DELETE CASCADE,
  rm_name VARCHAR(255) NOT NULL,
  tl_name VARCHAR(255) NOT NULL,
  customer_phone VARCHAR(50),
  -- The 7 SOP Detection Fields
  category VARCHAR(100) NOT NULL, -- e.g. 'Customer Behaviour & Hostility'
  severity VARCHAR(20) NOT NULL,  -- 'CRITICAL', 'MEDIUM', 'LOW'
  direction VARCHAR(50) NOT NULL, -- 'Customer said this to RM' or 'RM said this to customer'
  signal VARCHAR(255) NOT NULL,   -- e.g. 'Threatening legal action or regulator complaint'
  quote TEXT NOT NULL,            -- Exact transcribed dialogue quote
  timestamp VARCHAR(20),          -- Audio timestamp (e.g. '02:45')
  turn_index INT,                 -- Turn 14
  -- Slack Alert Tracking & Deduplication
  slack_alert_sent BOOLEAN DEFAULT false,
  slack_channel_id VARCHAR(50),
  slack_message_ts VARCHAR(50),   -- Slack message ID (prevents double-posting)
  slack_error TEXT,
  -- Audit & TL Review State
  review_status VARCHAR(30) DEFAULT 'PENDING', -- 'PENDING', 'ACKNOWLEDGED', 'FALSE_POSITIVE'
  reviewed_by VARCHAR(100),
  reviewed_at TIMESTAMPTZ,
  review_note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Fast lookup indexes
CREATE INDEX IF NOT EXISTS idx_pcg_sop_call_id ON pcg_call_sop_triggers(call_id);
CREATE INDEX IF NOT EXISTS idx_pcg_sop_severity ON pcg_call_sop_triggers(severity);
CREATE INDEX IF NOT EXISTS idx_pcg_sop_category ON pcg_call_sop_triggers(category);
CREATE INDEX IF NOT EXISTS idx_pcg_sop_created ON pcg_call_sop_triggers(created_at DESC);

-- Ensure pcg_call_evaluations has dedicated sop_triggers column for fast payload loads
ALTER TABLE pcg_call_evaluations ADD COLUMN IF NOT EXISTS sop_triggers JSONB DEFAULT '[]'::jsonb;

