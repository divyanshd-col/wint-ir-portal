-- Migration 040: Enable Session-Based Splitting on 48h Inactivity for PCG WhatsApp Chats
-- Allows multiple conversation session rows per (customer_phone, waba_number).

-- 1. Alter pcg_conversations primary key from composite (customer_phone, waba_number) to id
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'pcg_conversations_pkey' AND conrelid = 'pcg_conversations'::regclass
  ) THEN
    ALTER TABLE pcg_conversations DROP CONSTRAINT pcg_conversations_pkey;
  END IF;
END $$;

ALTER TABLE pcg_conversations ADD PRIMARY KEY (id);

-- 2. Add indexing for phone, waba and status
CREATE INDEX IF NOT EXISTS idx_pcg_conv_phone_waba_status ON pcg_conversations(customer_phone, waba_number, status);
CREATE INDEX IF NOT EXISTS idx_pcg_conv_status_last_msg ON pcg_conversations(status, last_message_at);

-- 3. Add conversation_id reference to pcg_chat_evaluations
ALTER TABLE pcg_chat_evaluations ADD COLUMN IF NOT EXISTS conversation_id BIGINT;
CREATE INDEX IF NOT EXISTS idx_pcg_chat_eval_conv_id ON pcg_chat_evaluations(conversation_id);

