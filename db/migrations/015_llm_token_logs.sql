-- Migration 015: llm_token_logs table for tracking real AI usage & spend per job
CREATE TABLE IF NOT EXISTS llm_token_logs (
  id                  BIGSERIAL PRIMARY KEY,
  job_type            VARCHAR(60) NOT NULL,
  feature_group       VARCHAR(30) NOT NULL,
  model_name          VARCHAR(50) NOT NULL,
  entity_id           VARCHAR(100),
  user_email          VARCHAR(100),
  input_tokens        INTEGER NOT NULL DEFAULT 0,
  output_tokens       INTEGER NOT NULL DEFAULT 0,
  total_tokens        INTEGER NOT NULL DEFAULT 0,
  duration_seconds    NUMERIC(10,2) DEFAULT 0,
  latency_ms          INTEGER DEFAULT 0,
  estimated_cost_usd  NUMERIC(10,6) NOT NULL DEFAULT 0.0,
  estimated_cost_inr  NUMERIC(10,4) NOT NULL DEFAULT 0.0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_llm_token_logs_job ON llm_token_logs (job_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_llm_token_logs_group ON llm_token_logs (feature_group, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_llm_token_logs_created ON llm_token_logs (created_at DESC);
