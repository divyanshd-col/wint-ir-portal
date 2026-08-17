-- Migration 013: Weekly IR quality scorecard reports
-- Supports storing weekly scorecards with agent feedback / comments.

CREATE TABLE IF NOT EXISTS ir_reports (
  id              VARCHAR(120) PRIMARY KEY,          -- `${agent_id}:${week_start}`
  agent_id        INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  week_start      DATE NOT NULL,                     -- Monday of the reported week
  week_end        DATE NOT NULL,                     -- Sunday
  status          VARCHAR(30) NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft', 'published', 'failed')),

  generated       JSONB NOT NULL,                    -- original output; NEVER mutated
  comments        JSONB NOT NULL DEFAULT '[]'::jsonb, -- Agent comments/highlights and feedback

  model_version   VARCHAR(50),
  generated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  viewed_at       TIMESTAMPTZ,                       -- IR opened it → clears unread badge
  error_note      TEXT,

  UNIQUE (agent_id, week_start)
);

CREATE INDEX IF NOT EXISTS idx_ir_reports_agent_week ON ir_reports(agent_id, week_start DESC);
CREATE INDEX IF NOT EXISTS idx_ir_reports_status     ON ir_reports(status);
