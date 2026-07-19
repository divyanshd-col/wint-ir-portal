-- Migration 010: Add Bot IQS Score Columns
-- Supports dual-leg scoring (Type 2/3 chats)

ALTER TABLE iqs_scores
ADD COLUMN bot_iqs_score SMALLINT CHECK (bot_iqs_score BETWEEN 0 AND 100),
ADD COLUMN bot_parameters JSONB,
ADD COLUMN bot_model_version VARCHAR(50),
ADD COLUMN bot_scored_at TIMESTAMPTZ;
