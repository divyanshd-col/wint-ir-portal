-- Migration 011: Create chat_review_comparisons table
-- Stores the difference between Chat reviewed by AI vs Chat reviewed by Human.
-- On re-review or reopening, only the latest human review is stored.

CREATE TABLE IF NOT EXISTS chat_review_comparisons (
  chat_id          VARCHAR(100) PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
  ai_score         SMALLINT,
  human_score      SMALLINT,
  ai_parameters    JSONB,
  human_parameters JSONB,
  action           VARCHAR(50) NOT NULL,
  reviewed_by      VARCHAR(255) NOT NULL,
  reviewed_at      TIMESTAMPTZ DEFAULT NOW(),
  review_note      TEXT
);

CREATE INDEX IF NOT EXISTS idx_chat_review_comparisons_reviewed_at ON chat_review_comparisons(reviewed_at);
