-- Migration 037 (was 035 on its branch; 035 and 036 are taken). Already applied to production: Add compliance_alerted_at column to call_evaluations and backfill
ALTER TABLE call_evaluations
  ADD COLUMN IF NOT EXISTS compliance_alerted_at TIMESTAMPTZ;

-- Backfill calls that had a critical gate failure or alert previously so they are never re-alerted
UPDATE call_evaluations
SET compliance_alerted_at = COALESCE(reviewed_at, scored_at, NOW())
WHERE call_gate_result = 'FAIL'
  AND compliance_alerted_at IS NULL;
