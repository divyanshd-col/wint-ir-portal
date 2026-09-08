-- Migration 017: token_usage_logs — centralized tracking of LLM token usage and estimated cost across all models.
--
-- Tracks:
--   - Input tokens, output tokens, total tokens
--   - Model and provider (e.g. gemini-3.5-flash, gemini-3.5-pro, claude-sonnet-4-6)
--   - Feature (chat, quality_scoring, call_analysis, analytics, corrections, ir_report)
--   - Cost in USD
--   - Latency in ms
--   - Caller email / metadata

CREATE TABLE IF NOT EXISTS token_usage_logs (
  id            BIGSERIAL PRIMARY KEY,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  provider      VARCHAR(40) NOT NULL,
  model         VARCHAR(80) NOT NULL,
  feature       VARCHAR(60) NOT NULL,
  input_tokens  INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens  INTEGER NOT NULL DEFAULT 0,
  cost_usd      NUMERIC(12, 6) NOT NULL DEFAULT 0,
  latency_ms    INTEGER,
  status        VARCHAR(20) NOT NULL DEFAULT 'success',
  request_count INTEGER NOT NULL DEFAULT 1,
  user_email    VARCHAR(255),
  metadata      JSONB
);

CREATE INDEX IF NOT EXISTS idx_token_usage_created_at ON token_usage_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_token_usage_model      ON token_usage_logs (model);
CREATE INDEX IF NOT EXISTS idx_token_usage_feature    ON token_usage_logs (feature);
CREATE INDEX IF NOT EXISTS idx_token_usage_provider   ON token_usage_logs (provider);
