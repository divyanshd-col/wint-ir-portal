-- Migration 034: Add status and closed_at to pcg_conversations for 48-hour inactivity closing

ALTER TABLE pcg_conversations
  ADD COLUMN IF NOT EXISTS status VARCHAR(30) NOT NULL DEFAULT 'OPEN',
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_pcg_conv_status ON pcg_conversations(status);
CREATE INDEX IF NOT EXISTS idx_pcg_conv_closed_at ON pcg_conversations(closed_at);
CREATE INDEX IF NOT EXISTS idx_pcg_conv_status_last_msg ON pcg_conversations(status, last_message_at);

-- Update all existing conversations with > 48 hours of inactivity to CLOSED
UPDATE pcg_conversations
SET status = 'CLOSED',
    closed_at = COALESCE(last_message_at + INTERVAL '48 hours', created_at + INTERVAL '48 hours', NOW()),
    updated_at = NOW()
WHERE status = 'OPEN'
  AND COALESCE(last_message_at, created_at) < NOW() - INTERVAL '48 hours';

