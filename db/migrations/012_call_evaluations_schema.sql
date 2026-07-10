-- Migration 012: Create call_evaluations and call_review_comparisons tables
-- Supports storing call-specific QA evaluation results and overrides separately from chat evaluations.

CREATE TABLE IF NOT EXISTS call_evaluations (
  call_id                 VARCHAR(100) PRIMARY KEY REFERENCES call_recordings(id) ON DELETE CASCADE,
  chat_id                 VARCHAR(100) REFERENCES conversations(id) ON DELETE SET NULL,
  agent_id                INTEGER REFERENCES agents(id) ON DELETE SET NULL,
  call_sequence_in_thread SMALLINT DEFAULT 1,
  scored_at               TIMESTAMPTZ DEFAULT NOW(),
  gates_prompt_version    VARCHAR(50) DEFAULT 'v3.1',
  iqs_prompt_version      VARCHAR(50) DEFAULT 'v3.1',
  source                  VARCHAR(20) DEFAULT 'audio' CHECK (source IN ('audio', 'transcript_fallback')),
  speaker_id_confidence   VARCHAR(10) CHECK (speaker_id_confidence IN ('high', 'medium', 'low')),
  context_truncated       BOOLEAN DEFAULT FALSE,
  
  -- Prompt 1 (Gates) Results
  call_gate_result        VARCHAR(10) CHECK (call_gate_result IN ('PASS', 'FAIL')),
  gates                   JSONB NOT NULL, -- Detailed G1, G2, G3 scores, reasoning, evidence, borderline
  
  -- Prompt 2 (IQS) Results
  iqs_scores              JSONB NOT NULL, -- Scores and reasoning for P1, P2, P3, P5, P6, P7, P8, P9, P10, P11
  iqs_percent             NUMERIC(5,2), -- Deterministic score math outcome (0.00 to 100.00)
  applicable_weight       SMALLINT, -- Excludes NAs from denominator
  verdict                 VARCHAR(50), -- "FAILED_CRITICAL", "excellent", "meets_expectations", "coaching", "remediation", "NOT_SCOREABLE"
  
  -- Supplementary Metadata
  kb_gaps                 JSONB DEFAULT '[]', -- Array of topics
  breach_mentions         JSONB DEFAULT '[]', -- Array of objects
  borderline_items        JSONB DEFAULT '[]', -- Array of objects
  
  -- Review tracking
  reviewed_by             VARCHAR(255),
  reviewed_at             TIMESTAMPTZ,
  review_note             TEXT,
  status                  VARCHAR(30) DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed', 'reopened'))
);

CREATE INDEX IF NOT EXISTS idx_call_evaluations_chat_id ON call_evaluations(chat_id);
CREATE INDEX IF NOT EXISTS idx_call_evaluations_agent_id ON call_evaluations(agent_id);
CREATE INDEX IF NOT EXISTS idx_call_evaluations_status   ON call_evaluations(status);

CREATE TABLE IF NOT EXISTS call_review_comparisons (
  call_id          VARCHAR(100) PRIMARY KEY REFERENCES call_recordings(id) ON DELETE CASCADE,
  ai_score         SMALLINT,
  human_score      SMALLINT,
  ai_parameters    JSONB,
  human_parameters JSONB,
  action           VARCHAR(50) NOT NULL, -- e.g., 'override', 'reopen'
  reviewed_by      VARCHAR(255) NOT NULL,
  reviewed_at      TIMESTAMPTZ DEFAULT NOW(),
  review_note      TEXT
);
