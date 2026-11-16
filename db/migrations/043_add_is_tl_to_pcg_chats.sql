-- Migration: 043_add_is_tl_to_pcg_chats.sql
-- Add is_tl flag to differentiate between RM-handled chats and TL-handled chats

ALTER TABLE pcg_chat_evaluations ADD COLUMN IF NOT EXISTS is_tl BOOLEAN DEFAULT false;
ALTER TABLE pcg_conversations ADD COLUMN IF NOT EXISTS is_tl BOOLEAN DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_pcg_chat_eval_is_tl ON pcg_chat_evaluations (is_tl);
CREATE INDEX IF NOT EXISTS idx_pcg_conv_is_tl ON pcg_conversations (is_tl);

