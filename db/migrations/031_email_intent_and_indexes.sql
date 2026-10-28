-- Migration 031: Add intent_l1 to email_conversations and partial index on robylon_webhook_payloads for internal notes

ALTER TABLE email_conversations ADD COLUMN IF NOT EXISTS intent_l1 VARCHAR(255);
CREATE INDEX IF NOT EXISTS idx_email_conv_intent ON email_conversations(intent_l1);
CREATE INDEX IF NOT EXISTS idx_email_conv_chat_id ON email_conversations(chat_id);
CREATE INDEX IF NOT EXISTS idx_robylon_webhooks_notes ON robylon_webhook_payloads (chat_id) WHERE event_type = 'INTERNAL_NOTE_ADDED';

-- Backfill intent_l1 from webhooks
WITH latest_intents AS (
  SELECT DISTINCT ON (w.chat_id)
    w.chat_id,
    COALESCE(NULLIF(p->>'snapshot_value', ''), p->>'selected_value') AS val
  FROM robylon_webhook_payloads w,
       jsonb_array_elements(COALESCE(w.payload->'data'->'properties', '[]'::jsonb)) p
  WHERE w.source = 'email'
    AND p->>'name' = 'Intents_L1' 
    AND COALESCE(p->>'selected_value', '') <> ''
  ORDER BY w.chat_id, w.received_at DESC
)
UPDATE email_conversations c
SET intent_l1 = li.val
FROM latest_intents li
WHERE (c.chat_id = li.chat_id OR c.id = li.chat_id)
  AND (c.intent_l1 IS NULL OR c.intent_l1 <> li.val);
