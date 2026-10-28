-- Migration 027: Dedicated Tables for PCG WhatsApp Conversations (DoubleTick) and IQS Scores

-- Table 1: pcg_conversations (Ongoing Persistent Chat Thread per Customer per WABA)
CREATE TABLE IF NOT EXISTS pcg_conversations (
  id                  BIGSERIAL,
  customer_phone      VARCHAR(30) NOT NULL,
  waba_number         VARCHAR(30) NOT NULL,
  customer_name       VARCHAR(255),
  customer_id         VARCHAR(100),
  assigned_rm_id      VARCHAR(100),
  rm_name             VARCHAR(100),
  transcript          JSONB DEFAULT '[]'::jsonb,
  total_messages      INT DEFAULT 0,
  last_message_text   TEXT,
  last_event_type     VARCHAR(50),
  last_direction      VARCHAR(20),
  last_status         VARCHAR(30),
  last_message_at     TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW(),
  raw_payload         JSONB,
  PRIMARY KEY (customer_phone, waba_number)
);

CREATE INDEX IF NOT EXISTS idx_pcg_conv_phone ON pcg_conversations(customer_phone);
CREATE INDEX IF NOT EXISTS idx_pcg_conv_waba ON pcg_conversations(waba_number);
CREATE INDEX IF NOT EXISTS idx_pcg_conv_last_msg ON pcg_conversations(last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_pcg_conv_rm ON pcg_conversations(assigned_rm_id);

-- Table 2: pcg_iqs_scores (Dedicated Quality Audits & IQS Scoring per Evaluation Cycle)
CREATE TABLE IF NOT EXISTS pcg_iqs_scores (
  id                  BIGSERIAL PRIMARY KEY,
  customer_phone      VARCHAR(30) NOT NULL,
  waba_number         VARCHAR(30) NOT NULL,
  evaluation_cycle    VARCHAR(50),                         -- e.g. 'weekly_2026_w41', 'manual_audit'
  iqs_score           SMALLINT,                            -- Overall 0-100 score
  parameters          JSONB,                               -- Graded parameter breakdowns
  ai_coaching_tip     TEXT,                                -- Actionable coaching feedback
  compliance_passed   BOOLEAN,
  compliance_flags    INT DEFAULT 0,
  model_version       VARCHAR(100),
  scored_at           TIMESTAMPTZ DEFAULT NOW(),
  status              VARCHAR(30) DEFAULT 'pending',       -- 'pending', 'reviewed', 'overridden'
  reviewed_by         VARCHAR(100),
  reviewed_at         TIMESTAMPTZ,
  review_note         TEXT,
  dispute_status      VARCHAR(30),                         -- 'pending', 'resolved', 'rejected'
  dispute_reason      TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pcg_iqs_phone ON pcg_iqs_scores(customer_phone);
CREATE INDEX IF NOT EXISTS idx_pcg_iqs_scored_at ON pcg_iqs_scores(scored_at DESC);
CREATE INDEX IF NOT EXISTS idx_pcg_iqs_status ON pcg_iqs_scores(status);
