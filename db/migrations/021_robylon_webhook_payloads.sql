-- Migration 021: robylon_webhook_payloads table for storing raw incoming Robylon webhooks as received
CREATE TABLE IF NOT EXISTS robylon_webhook_payloads (
  id           BIGSERIAL PRIMARY KEY,
  source       VARCHAR(50) NOT NULL DEFAULT 'chat',      -- 'chat', 'call', etc.
  event_type   VARCHAR(100),                            -- 'TICKET_CLOSED', 'CLASSIFICATION_UPDATED', 'CSAT_SUBMITTED', 'CC_VOICE_CALL_COMPLETE', etc.
  event_id     VARCHAR(255),                            -- Robylon event_id
  chat_id      VARCHAR(100),                            -- Robylon chat_id or call_id
  payload      JSONB NOT NULL,                          -- Raw webhook JSON payload as received
  headers      JSONB,                                   -- Request headers if captured
  received_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_robylon_webhook_payloads_received_at ON robylon_webhook_payloads (received_at DESC);
CREATE INDEX IF NOT EXISTS idx_robylon_webhook_payloads_chat_id ON robylon_webhook_payloads (chat_id);
CREATE INDEX IF NOT EXISTS idx_robylon_webhook_payloads_event_type ON robylon_webhook_payloads (event_type);
CREATE INDEX IF NOT EXISTS idx_robylon_webhook_payloads_event_id ON robylon_webhook_payloads (event_id);
