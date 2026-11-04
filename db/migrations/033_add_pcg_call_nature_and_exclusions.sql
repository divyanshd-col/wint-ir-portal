-- Migration 033: Add call_nature, exclusion_reason, category_source to pcg_call_recordings,
-- and is_evaluable, exclusion_reason to pcg_call_evaluations for PCG call filtering.

-- 1. Ingestion Table: pcg_call_recordings
ALTER TABLE pcg_call_recordings 
ADD COLUMN IF NOT EXISTS call_nature VARCHAR(50) DEFAULT 'unclassified',
ADD COLUMN IF NOT EXISTS exclusion_reason VARCHAR(100),
ADD COLUMN IF NOT EXISTS category_source VARCHAR(50);

CREATE INDEX IF NOT EXISTS idx_pcg_call_nature ON pcg_call_recordings(call_nature);
CREATE INDEX IF NOT EXISTS idx_pcg_exclusion_reason ON pcg_call_recordings(exclusion_reason);

-- 2. Quality Evaluation Table: pcg_call_evaluations
ALTER TABLE pcg_call_evaluations 
ADD COLUMN IF NOT EXISTS is_evaluable BOOLEAN DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS exclusion_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_pcg_is_evaluable ON pcg_call_evaluations(is_evaluable);

