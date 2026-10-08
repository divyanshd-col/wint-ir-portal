-- Migration 027: Email Reply Evaluations & Conversation Thread Metadata

-- 1. Enhance email_conversations with merged ticket support and structured thread summary
ALTER TABLE email_conversations
  ADD COLUMN IF NOT EXISTS merged_into_ticket_id VARCHAR(100),
  ADD COLUMN IF NOT EXISTS thread_summary JSONB;

CREATE INDEX IF NOT EXISTS idx_email_conv_merged ON email_conversations (merged_into_ticket_id) WHERE merged_into_ticket_id IS NOT NULL;

-- 2. Create email_reply_evaluations table
CREATE TABLE IF NOT EXISTS email_reply_evaluations (
  id                  BIGSERIAL PRIMARY KEY,
  ticket_id           VARCHAR(100) NOT NULL REFERENCES email_conversations(id) ON DELETE CASCADE,
  message_id          VARCHAR(255) NOT NULL UNIQUE,
  agent_id            VARCHAR(100),
  agent_name          VARCHAR(255),
  sent_at             TIMESTAMPTZ NOT NULL,
  customer_message    TEXT,
  agent_reply_text    TEXT,
  raw_reply_payload   JSONB,
  evaluation_status   VARCHAR(50) DEFAULT 'Pending', -- 'Pending', 'In_Batch', 'Completed', 'Failed', 'Skipped'
  batch_job_id        VARCHAR(255),                  -- Gemini Batch Job resource name / ID
  quality_score       NUMERIC(5, 2),                 -- 0 - 100%
  compliance_passed   BOOLEAN,
  compliance_issues   TEXT[],
  parameter_scores    JSONB,                         -- Breakdown: accuracy, tone, clarity, compliance, etc.
  qa_override_score   NUMERIC(5, 2),                 -- Manual QA score
  qa_notes            TEXT,                          -- QA feedback / reasoning
  dispute_status      VARCHAR(50) DEFAULT 'None',    -- 'None', 'Raised', 'Under_Review', 'Resolved', 'Rejected'
  dispute_notes       TEXT,
  evaluated_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_eval_status ON email_reply_evaluations (evaluation_status);
CREATE INDEX IF NOT EXISTS idx_email_eval_agent ON email_reply_evaluations (agent_name);
CREATE INDEX IF NOT EXISTS idx_email_eval_ticket ON email_reply_evaluations (ticket_id);
CREATE INDEX IF NOT EXISTS idx_email_eval_sent_at ON email_reply_evaluations (sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_eval_batch ON email_reply_evaluations (batch_job_id) WHERE batch_job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_email_eval_score ON email_reply_evaluations (quality_score);
