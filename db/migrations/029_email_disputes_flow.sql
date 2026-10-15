-- Migration 029: Email Disputes Flow Enhancements
-- Adds flag_id and challenged_params to email_reply_evaluations,
-- and message_id to iqs_flags to support unified dispute threads across email evaluations.

-- 1. Add dispute tracking columns to email_reply_evaluations
ALTER TABLE email_reply_evaluations
  ADD COLUMN IF NOT EXISTS flag_id VARCHAR(100),
  ADD COLUMN IF NOT EXISTS challenged_params JSONB DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_email_eval_flag_id ON email_reply_evaluations (flag_id) WHERE flag_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_email_eval_dispute_status ON email_reply_evaluations (dispute_status);

-- 2. Add message_id support to iqs_flags for direct lookup of email evaluations
ALTER TABLE iqs_flags
  ADD COLUMN IF NOT EXISTS message_id VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_iqs_flags_message_id ON iqs_flags (message_id) WHERE message_id IS NOT NULL;
