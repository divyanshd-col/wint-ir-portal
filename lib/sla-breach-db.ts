import { query } from '@/lib/cx/db';
import type { EmailTicketRow } from '@/lib/sla-breach';

/**
 * OPEN email tickets plus the facts the SLA rules need, taken from Robylon's webhook log
 * (email_conversations only keeps the last create/message payload). The rules themselves live in
 * findBreachingTickets so they are unit-tested; this query only gathers facts (a few hundred rows).
 *  - robylon_status:           latest STATUS_CHANGED new_status ("Answered", "Customer reponded", ...)
 *  - last_customer_message_at: latest incoming message from a sender outside @wintwealth.com
 *  - last_agent_message_at:    latest reply sent, or incoming mail from a @wintwealth.com address (internal notes are ignored)
 *  - last_agent_status_at:     latest move to Answered / Pending email sent
 *  - has_events:               any webhook event stored for the ticket (older tickets have none and are skipped)
 *  - has_incoming_message:     any incoming message stored (customer or Wint sender); then the first email is a message event
 *  - intent_l1:                latest "Intents_L1" property
 *  - ticket_source:            latest "ticket_source_rb_em" property ("Email" | "Portal"); a Portal ticket starts with our outbound mail
 */
export async function fetchOpenTickets(): Promise<EmailTicketRow[]> {
  return query<EmailTicketRow>(
    `SELECT e.id, e.chat_id, e.customer_email, e.customer_phone, e.created_at, e.first_response_at,
            ev.has_events, ev.has_incoming_message, ev.robylon_status, ev.last_customer_message_at, ev.last_agent_message_at, ev.last_agent_status_at,
            intent.val AS intent_l1, src.val AS ticket_source
     FROM email_conversations e
     CROSS JOIN LATERAL (
       SELECT count(*) > 0 AS has_events,
              COALESCE(bool_or(w.event_type = 'NEW_MESSAGE' AND m.message_type = 'incoming'), false) AS has_incoming_message,
              (array_agg(w.payload->'data'->>'new_status' ORDER BY w.received_at DESC)
                 FILTER (WHERE w.event_type = 'STATUS_CHANGED' AND w.payload->'data'->>'new_status' IS NOT NULL))[1] AS robylon_status,
              max(m.sent_at) FILTER (WHERE w.event_type = 'NEW_MESSAGE' AND m.message_type = 'incoming' AND NOT m.is_staff) AS last_customer_message_at,
              max(m.sent_at) FILTER (WHERE (w.event_type = 'REPLY_SENT' AND m.message_type = 'reply')
                                        OR (w.event_type = 'NEW_MESSAGE' AND m.message_type = 'incoming' AND m.is_staff)) AS last_agent_message_at,
              max(w.received_at) FILTER (WHERE w.event_type = 'STATUS_CHANGED'
                                          AND lower(btrim(w.payload->'data'->>'new_status')) IN ('answered', 'pending email sent')) AS last_agent_status_at
       FROM robylon_webhook_payloads w
       CROSS JOIN LATERAL (
         SELECT w.payload->'data'->'message'->>'message_type' AS message_type,
                COALESCE((w.payload->'data'->'message'->>'created_at')::timestamptz, w.received_at) AS sent_at,
                (COALESCE(w.payload->'data'->'message'->>'from_email', '') ILIKE '%@wintwealth.com') AS is_staff
       ) m
       WHERE w.source = 'email' AND w.chat_id = e.chat_id
     ) ev
     LEFT JOIN LATERAL (
       SELECT COALESCE(NULLIF(p->>'snapshot_value', ''), p->>'selected_value') AS val
       FROM robylon_webhook_payloads w,
            jsonb_array_elements(COALESCE(w.payload->'data'->'properties', '[]'::jsonb)) p
       WHERE w.source = 'email' AND w.chat_id = e.chat_id
         AND p->>'name' = 'Intents_L1' AND COALESCE(p->>'selected_value', '') <> ''
       ORDER BY w.received_at DESC LIMIT 1
     ) intent ON true
     LEFT JOIN LATERAL (
       SELECT COALESCE(NULLIF(p->>'snapshot_value', ''), p->>'selected_value') AS val
       FROM robylon_webhook_payloads w,
            jsonb_array_elements(COALESCE(w.payload->'data'->'properties', '[]'::jsonb)) p
       WHERE w.source = 'email' AND w.chat_id = e.chat_id
         AND p->>'name' = 'ticket_source_rb_em'
       ORDER BY w.received_at DESC LIMIT 1
     ) src ON true
     WHERE e.status = 'OPEN'`,
  );
}
