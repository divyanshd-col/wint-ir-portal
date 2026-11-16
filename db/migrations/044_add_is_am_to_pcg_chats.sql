-- Migration: 044_add_is_am_to_pcg_chats.sql
-- Add is_am flag and preceding_rm_name to support AM-handled conversations & handoffs

ALTER TABLE pcg_chat_evaluations ADD COLUMN IF NOT EXISTS is_am BOOLEAN DEFAULT false;
ALTER TABLE pcg_chat_evaluations ADD COLUMN IF NOT EXISTS preceding_rm_name VARCHAR(255);
ALTER TABLE pcg_conversations ADD COLUMN IF NOT EXISTS is_am BOOLEAN DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_pcg_chat_eval_is_am ON pcg_chat_evaluations (is_am);
CREATE INDEX IF NOT EXISTS idx_pcg_conv_is_am ON pcg_conversations (is_am);

