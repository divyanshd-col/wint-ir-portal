-- Migration 039: Dedicated Table for PCG WhatsApp Chat Quality Evaluations

CREATE TABLE IF NOT EXISTS pcg_chat_evaluations (
  id                          BIGSERIAL PRIMARY KEY,
  customer_phone              VARCHAR(30) NOT NULL,
  waba_number                 VARCHAR(30) NOT NULL,
  customer_name               VARCHAR(255),
  rm_name                     VARCHAR(100) NOT NULL,
  tl_name                     VARCHAR(100) NOT NULL,

  -- Overall & Category IQS Scores (0-100)
  iqs_score                   SMALLINT,
  process_score               NUMERIC(5,2),
  communication_score         NUMERIC(5,2),
  customer_service_score      NUMERIC(5,2),
  applicable_weight           SMALLINT,
  verdict                     VARCHAR(50), -- 'excellent', 'meets_expectations', 'coaching', 'remediation', 'NOT_SCOREABLE'
  is_evaluable                BOOLEAN DEFAULT TRUE,
  exclusion_reason            VARCHAR(255),

  -- 11 Quality Parameters breakdown & 5 Compliance checks
  parameters                  JSONB NOT NULL,
  compliance_flags            JSONB NOT NULL DEFAULT '[]'::jsonb,
  compliance_tripwire         BOOLEAN DEFAULT FALSE,
  compliance_reason           TEXT,
  ai_coaching_tip             TEXT,

  -- Conversation Metrics & Frozen Snapshot
  total_messages              INT DEFAULT 0,
  first_response_time_seconds INT,
  avg_response_time_seconds   INT,
  transcript_turns            JSONB NOT NULL DEFAULT '[]'::jsonb,
  last_evaluated_message_id   VARCHAR(255),

  -- Timestamps
  chat_closed_at              TIMESTAMPTZ NOT NULL,
  scored_at                   TIMESTAMPTZ DEFAULT NOW(),

  -- Review & Dispute Tracking
  status                      VARCHAR(30) DEFAULT 'pending', -- 'pending', 'reviewed', 'overridden'
  dispute_status              VARCHAR(30) DEFAULT 'none',    -- 'none', 'pending', 'resolved', 'overridden'
  dispute_reason              TEXT,
  dispute_comments            JSONB DEFAULT '[]'::jsonb,
  tl_override_note            TEXT,
  reviewed_by                 VARCHAR(100),
  reviewed_at                 TIMESTAMPTZ,

  model_version               VARCHAR(50) DEFAULT 'gemini-2.5-flash',
  created_at                  TIMESTAMPTZ DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pcg_chat_eval_phone ON pcg_chat_evaluations(customer_phone);
CREATE INDEX IF NOT EXISTS idx_pcg_chat_eval_rm ON pcg_chat_evaluations(rm_name);
CREATE INDEX IF NOT EXISTS idx_pcg_chat_eval_tl ON pcg_chat_evaluations(tl_name);
CREATE INDEX IF NOT EXISTS idx_pcg_chat_eval_closed_at ON pcg_chat_evaluations(chat_closed_at DESC);
CREATE INDEX IF NOT EXISTS idx_pcg_chat_eval_iqs ON pcg_chat_evaluations(iqs_score);
CREATE INDEX IF NOT EXISTS idx_pcg_chat_eval_verdict ON pcg_chat_evaluations(verdict);
CREATE INDEX IF NOT EXISTS idx_pcg_chat_eval_dispute ON pcg_chat_evaluations(dispute_status);

