-- Migration 033: Dedicated Table for PCG Webhook Payloads (DoubleTick WhatsApp & Runo Telephony)
CREATE TABLE IF NOT EXISTS pcg_webhook_payloads (
  id           BIGSERIAL PRIMARY KEY,
  source       VARCHAR(50) NOT NULL,                    -- 'doubletick', 'runo', etc.
  channel      VARCHAR(50),                             -- 'whatsapp', 'call', etc.
  event_type   VARCHAR(100),                            -- 'CHAT_EXPORT', 'OUTGOING', 'AUDIO_RECORDING', 'INCOMING', 'MISSED', etc.
  event_id     VARCHAR(255),                            -- DoubleTick messageId, Runo callId, etc.
  chat_id      VARCHAR(100),                            -- DoubleTick customer phone/chatId, Runo callId/phone, etc.
  payload      JSONB NOT NULL,                          -- Complete raw webhook JSON payload as received
  headers      JSONB,                                   -- Request headers if captured
  received_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pcg_webhook_payloads_received_at ON pcg_webhook_payloads (received_at DESC);
CREATE INDEX IF NOT EXISTS idx_pcg_webhook_payloads_source ON pcg_webhook_payloads (source);
CREATE INDEX IF NOT EXISTS idx_pcg_webhook_payloads_channel ON pcg_webhook_payloads (channel);
CREATE INDEX IF NOT EXISTS idx_pcg_webhook_payloads_chat_id ON pcg_webhook_payloads (chat_id);
CREATE INDEX IF NOT EXISTS idx_pcg_webhook_payloads_event_type ON pcg_webhook_payloads (event_type);
CREATE INDEX IF NOT EXISTS idx_pcg_webhook_payloads_event_id ON pcg_webhook_payloads (event_id);

-- Backfill existing PCG payloads from robylon_webhook_payloads into pcg_webhook_payloads
INSERT INTO pcg_webhook_payloads (id, source, channel, event_type, event_id, chat_id, payload, headers, received_at)
SELECT 
  id,
  source,
  CASE 
    WHEN source = 'doubletick' THEN 'whatsapp'
    WHEN source = 'runo' THEN 'call'
    ELSE COALESCE(channel, 'unknown')
  END AS channel,
  event_type,
  event_id,
  chat_id,
  payload,
  headers,
  received_at
FROM robylon_webhook_payloads
WHERE source IN ('doubletick', 'runo')
ON CONFLICT (id) DO NOTHING;

-- Synchronize sequence with the max id
SELECT setval(
  pg_get_serial_sequence('pcg_webhook_payloads', 'id'),
  COALESCE((SELECT MAX(id) FROM pcg_webhook_payloads), 1)
);

