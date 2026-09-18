-- Migration 024: Add chat_type column to kb_draft_suggestions table
ALTER TABLE kb_draft_suggestions ADD COLUMN IF NOT EXISTS chat_type VARCHAR(100) NOT NULL DEFAULT 'Transferred to Agent';
CREATE INDEX IF NOT EXISTS idx_kb_draft_suggestions_chat_type ON kb_draft_suggestions(chat_type);
