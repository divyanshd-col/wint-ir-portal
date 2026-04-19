-- Analytics audit log: records every query run through the Insight Chat tool
CREATE TABLE IF NOT EXISTS analytics_audit_log (
  id           BIGSERIAL PRIMARY KEY,
  user_email   TEXT NOT NULL,
  query_text   TEXT NOT NULL,
  query_type   SMALLINT,          -- 1 = SQL template, 2 = theme extraction
  template_id  TEXT,              -- which of the 15 templates was used
  sql_executed TEXT,              -- for future LLM-generated SQL logging
  row_count    INTEGER,
  llm_tokens   INTEGER,
  latency_ms   INTEGER,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_analytics_audit_user    ON analytics_audit_log(user_email);
CREATE INDEX IF NOT EXISTS idx_analytics_audit_created ON analytics_audit_log(created_at DESC);
