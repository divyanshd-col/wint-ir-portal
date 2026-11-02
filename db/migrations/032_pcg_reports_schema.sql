-- Migration 032: Weekly PCG Relationship Manager Scorecard Reports
-- Stores weekly voice performance reports, AI coaching themes, evidence calls, and 1-on-1 discussion notes.

CREATE TABLE IF NOT EXISTS pcg_reports (
  id              VARCHAR(120) PRIMARY KEY,          -- `${canonical_rm_name}:${week_start}`
  rm_name         VARCHAR(120) NOT NULL,             -- RM Name (canonical)
  tl_name         VARCHAR(120),                      -- Team Lead name
  week_start      DATE NOT NULL,                     -- Monday of the reported week
  week_end        DATE NOT NULL,                     -- Sunday of the reported week
  status          VARCHAR(30) NOT NULL DEFAULT 'published'
                  CHECK (status IN ('draft', 'published', 'failed')),

  generated       JSONB NOT NULL,                    -- numbers, whatWentWell, themes, breaches, evidence
  comments        JSONB NOT NULL DEFAULT '[]'::jsonb, -- RM & TL comments / highlights

  viewed_at       TIMESTAMPTZ,                       -- RM opened it → clears unread badge
  generated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  model_version   VARCHAR(50),
  error_note      TEXT,

  UNIQUE (rm_name, week_start)
);

CREATE INDEX IF NOT EXISTS idx_pcg_reports_rm_week ON pcg_reports(rm_name, week_start DESC);
CREATE INDEX IF NOT EXISTS idx_pcg_reports_status  ON pcg_reports(status);
CREATE INDEX IF NOT EXISTS idx_pcg_reports_tl      ON pcg_reports(tl_name);

