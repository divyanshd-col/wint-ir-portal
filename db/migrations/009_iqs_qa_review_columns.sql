-- Migration 009: Add QA review tracking columns to iqs_scores
--
-- Previously, QA review status was stored only in Upstash KV, which is a
-- no-op when the env vars aren't set, causing reviews to vanish on reload.
-- Moving the data into the database makes it reliably persistent.
--
-- Run once: psql $DATABASE_URL -f db/migrations/009_iqs_qa_review_columns.sql

ALTER TABLE iqs_scores
  ADD COLUMN IF NOT EXISTS reviewed_by   TEXT,
  ADD COLUMN IF NOT EXISTS reviewed_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS review_note   TEXT;

-- Index speeds up the "fetch all unreviewed" query in the pending tab
CREATE INDEX IF NOT EXISTS idx_iqs_scores_reviewed_at ON iqs_scores (reviewed_at);
