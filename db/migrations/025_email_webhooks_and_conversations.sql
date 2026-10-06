-- Migration 025: Dedicated email_conversations Table for Email Tickets
CREATE TABLE IF NOT EXISTS email_conversations (
  id                        VARCHAR(100) PRIMARY KEY, -- Robylon ticket_id / chat_id
  chat_id                   VARCHAR(100) NOT NULL,
  subject_line              VARCHAR(500),
  customer_email            VARCHAR(255),
  customer_phone            VARCHAR(50),
  agent_name                VARCHAR(255),
  status                    VARCHAR(50) DEFAULT 'OPEN', -- 'OPEN', 'RESOLVED', 'CLOSED'
  created_at                TIMESTAMPTZ DEFAULT NOW(),
  first_response_at         TIMESTAMPTZ,
  closed_at                 TIMESTAMPTZ,
  raw_payload               JSONB,
  updated_at                TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_conv_created ON email_conversations (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_conv_agent ON email_conversations (agent_name);
