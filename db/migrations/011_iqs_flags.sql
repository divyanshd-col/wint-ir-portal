-- Migration 011: Add tables for IQS flags (disputes) and thread comments
--
-- This moves disputes and discussion threads out of Redis into PostgreSQL.

CREATE TABLE IF NOT EXISTS iqs_flags (
  id                 VARCHAR(100) PRIMARY KEY,
  score_id           VARCHAR(100),
  chat_id            VARCHAR(100) NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  agent_name         VARCHAR(255) NOT NULL,
  agent_email        VARCHAR(255) NOT NULL,
  agent_note         TEXT,
  challenged_params  JSONB NOT NULL DEFAULT '[]'::jsonb,
  flagged_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ,
  raised_by_role     VARCHAR(10) NOT NULL,
  param_category     VARCHAR(10) NOT NULL,
  parent_flag_id     VARCHAR(100),
  status             VARCHAR(50) NOT NULL,
  reviewed_by        VARCHAR(255),
  reviewed_at        TIMESTAMPTZ,
  review_note        TEXT
);

CREATE TABLE IF NOT EXISTS iqs_flag_comments (
  id           VARCHAR(100) PRIMARY KEY,
  flag_id      VARCHAR(100) NOT NULL REFERENCES iqs_flags(id) ON DELETE CASCADE,
  author_email VARCHAR(255) NOT NULL,
  author_name  VARCHAR(255) NOT NULL,
  role         VARCHAR(20) NOT NULL,
  content      TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indices for performance
CREATE INDEX IF NOT EXISTS idx_iqs_flags_chat_id ON iqs_flags(chat_id);
CREATE INDEX IF NOT EXISTS idx_iqs_flags_status ON iqs_flags(status);
CREATE INDEX IF NOT EXISTS idx_iqs_flag_comments_flag_id ON iqs_flag_comments(flag_id);
