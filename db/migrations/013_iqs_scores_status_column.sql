-- Migration 013: Add status column to iqs_scores and backfill reviewed chats
--
-- The status column was previously added manually to production without a tracked migration.
-- This migration ensures it exists in all environments and backfills 'reviewed' for any
-- rows where reviewed_by IS NOT NULL (chats that were reviewed via the old Upstash KV
-- system before the status column existed — they have reviewed_by/reviewed_at set but
-- status still at the DEFAULT 'pending').
--
-- Run once: psql $DATABASE_URL -f db/migrations/013_iqs_scores_status_column.sql

ALTER TABLE iqs_scores
  ADD COLUMN IF NOT EXISTS status VARCHAR(30) NOT NULL DEFAULT 'pending';

-- Backfill: any row with reviewed_by set was reviewed; promote it to 'reviewed'.
UPDATE iqs_scores
  SET status = 'reviewed'
  WHERE reviewed_by IS NOT NULL
    AND reviewed_at IS NOT NULL
    AND status = 'pending';

CREATE INDEX IF NOT EXISTS idx_iqs_scores_status ON iqs_scores (status);
