-- Migration 041: Add summary column to pcg_chat_evaluations and pcg_conversations

ALTER TABLE pcg_chat_evaluations ADD COLUMN IF NOT EXISTS summary TEXT;
ALTER TABLE pcg_conversations ADD COLUMN IF NOT EXISTS summary TEXT;

