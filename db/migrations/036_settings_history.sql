-- 036_settings_history.sql
-- Change history for admin settings (prompts, email scoring rubric, quality thresholds).
-- The live values stay in the settings store (Redis); each change is also recorded here with who made it and the value
-- before and after (NULL = the built-in default). The app creates this table on first use if it is missing.

CREATE TABLE IF NOT EXISTS settings_history (
  id          BIGSERIAL PRIMARY KEY,
  setting_key TEXT NOT NULL,
  action      TEXT NOT NULL DEFAULT 'save',   -- 'save' | 'restore'
  old_value   JSONB,
  new_value   JSONB,
  changed_by  TEXT NOT NULL,
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_settings_history_key_time ON settings_history (setting_key, changed_at DESC);
