-- Migration 028: Add QA Review Workflow Columns to email_reply_evaluations

ALTER TABLE email_reply_evaluations
  ADD COLUMN IF NOT EXISTS review_status VARCHAR(50) DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS reviewed_by   VARCHAR(255),
  ADD COLUMN IF NOT EXISTS reviewed_at   TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_email_eval_review_status ON email_reply_evaluations (review_status);

-- Ensure all existing rows have review_status = 'pending' if null
UPDATE email_reply_evaluations
SET review_status = 'pending'
WHERE review_status IS NULL;
