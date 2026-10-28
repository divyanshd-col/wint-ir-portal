import { query } from '@/lib/cx/db';
import type { EmailTicketRow } from '@/lib/sla-breach';

/**
 * OPEN email tickets plus the facts the SLA rules need, taken from Robylon's webhook log
 * (email_conversations only keeps the last create/message payload). The rules themselves live in
 * findBreachingTickets so they are unit-tested; this query only gathers facts (a few hundred rows).
 *  - last_message_*: latest conversation message (customer incoming or agent reply; internal notes ignored)
 *  - chat_status:    latest "Chat Status" property
 *  - intent_l1:      latest "Intents_L1" property
 */
export async function fetchOpenTickets(): Promise<EmailTicketRow[]> {
  return query<EmailTicketRow>(
    `SELECT e.id, e.chat_id, e.customer_email, e.customer_phone, e.status,
            e.created_at, e.first_response_at, e.updated_at,
            msg.from_email AS last_message_from, msg.sent_at AS last_message_at,
            cs.val AS chat_status, intent.val AS intent_l1
     FROM email_conversations e
     LEFT JOIN LATERAL (
       SELECT w.payload->'data'->'message'->>'from_email' AS from_email,
              COALESCE((w.payload->'data'->'message'->>'created_at')::timestamptz, w.received_at) AS sent_at
       FROM robylon_webhook_payloads w
       WHERE w.source = 'email' AND w.chat_id = e.chat_id
         AND w.event_type IN ('NEW_MESSAGE', 'REPLY_SENT')
         AND w.payload->'data'->'message'->>'message_type' IN ('incoming', 'reply')
       ORDER BY sent_at DESC LIMIT 1
     ) msg ON true
     LEFT JOIN LATERAL (
       SELECT COALESCE(NULLIF(p->>'snapshot_value', ''), p->>'selected_value') AS val
       FROM robylon_webhook_payloads w,
            jsonb_array_elements(COALESCE(w.payload->'data'->'properties', '[]'::jsonb)) p
       WHERE w.source = 'email' AND w.chat_id = e.chat_id
         AND p->>'name' = 'Chat Status' AND COALESCE(p->>'selected_value', '') <> ''
       ORDER BY w.received_at DESC LIMIT 1
     ) cs ON true
     LEFT JOIN LATERAL (
       SELECT COALESCE(NULLIF(p->>'snapshot_value', ''), p->>'selected_value') AS val
       FROM robylon_webhook_payloads w,
            jsonb_array_elements(COALESCE(w.payload->'data'->'properties', '[]'::jsonb)) p
       WHERE w.source = 'email' AND w.chat_id = e.chat_id
         AND p->>'name' = 'Intents_L1' AND COALESCE(p->>'selected_value', '') <> ''
       ORDER BY w.received_at DESC LIMIT 1
     ) intent ON true
     WHERE e.status = 'OPEN'`,
  );
}
