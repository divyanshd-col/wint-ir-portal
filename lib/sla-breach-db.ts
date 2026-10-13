import { query } from '@/lib/cx/db';
import { SLA_HOURS, type BreachingTicket } from '@/lib/sla-breach';

/**
 * Tickets whose latest customer message is still unanswered (no REPLY_SENT after it) and whose
 * SLA breach time (that message + 24h) falls in [windowStart, windowEnd]. Status is ignored on purpose.
 * Customer messages = TICKET_CREATED + NEW_MESSAGE from the customer; bot replies and internal notes don't count.
 * l1_intent = names.l1 from the most recent event carrying a classification (null if none yet).
 * Only webhook events from windowStart - 24h onwards are scanned: older customer messages breach before the window.
 */
export async function fetchBreachingTickets(window: { windowStart: Date; windowEnd: Date }): Promise<BreachingTicket[]> {
  return query<BreachingTicket>(
    `WITH ev AS (
       SELECT chat_id,
              MAX(COALESCE((payload->>'created_at')::timestamptz, received_at))
                FILTER (WHERE event_type = 'TICKET_CREATED'
                           OR (event_type = 'NEW_MESSAGE' AND payload->'data'->>'sender_type' = 'customer')) AS last_customer_at,
              MAX(COALESCE((payload->>'created_at')::timestamptz, received_at))
                FILTER (WHERE event_type = 'REPLY_SENT') AS last_reply_at
       FROM robylon_webhook_payloads
       WHERE source = 'email' AND received_at >= $1::timestamptz - make_interval(hours => $3)
       GROUP BY chat_id
     ),
     intent AS (
       SELECT DISTINCT ON (p.chat_id) p.chat_id, i->'names'->>'l1' AS l1_intent
       FROM robylon_webhook_payloads p,
            jsonb_array_elements(CASE WHEN jsonb_typeof(p.payload->'data'->'intents') = 'array'
                                      THEN p.payload->'data'->'intents' ELSE '[]'::jsonb END) i
       WHERE p.source = 'email' AND p.chat_id IN (SELECT chat_id FROM ev) AND i->'names'->>'l1' IS NOT NULL
       ORDER BY p.chat_id, p.received_at DESC
     )
     SELECT c.chat_id, c.id AS ticket_id, c.customer_email, c.customer_phone,
            ev.last_customer_at AS user_last_replied_at, intent.l1_intent,
            ev.last_customer_at + make_interval(hours => $3) AS sla_breach_time
     FROM ev
     JOIN email_conversations c ON c.chat_id = ev.chat_id
     LEFT JOIN intent ON intent.chat_id = ev.chat_id
     WHERE ev.last_customer_at IS NOT NULL
       AND (ev.last_reply_at IS NULL OR ev.last_reply_at < ev.last_customer_at)
       AND ev.last_customer_at + make_interval(hours => $3) BETWEEN $1 AND $2
     ORDER BY sla_breach_time`,
    [window.windowStart, window.windowEnd, SLA_HOURS],
  );
}
