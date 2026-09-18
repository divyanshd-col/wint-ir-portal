-- Migration 016: Create table kb_draft_suggestions for KB gap detection & answer drafting
CREATE TABLE IF NOT EXISTS kb_draft_suggestions (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date                 DATE NOT NULL DEFAULT CURRENT_DATE,
  category             VARCHAR(100) NOT NULL,
  question             TEXT NOT NULL,
  chat_ids             JSONB NOT NULL DEFAULT '[]'::jsonb,
  agent_answer         TEXT NOT NULL,
  suggested_bot_answer TEXT NOT NULL,
  target_kb            VARCHAR(255) NOT NULL DEFAULT 'General KB',
  tag                  VARCHAR(50) NOT NULL CHECK (tag IN ('Educational', 'Non-Educational')),
  status               VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'published', 'archived')),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kb_draft_suggestions_date ON kb_draft_suggestions(date DESC);
CREATE INDEX IF NOT EXISTS idx_kb_draft_suggestions_category ON kb_draft_suggestions(category);
CREATE INDEX IF NOT EXISTS idx_kb_draft_suggestions_tag ON kb_draft_suggestions(tag);
