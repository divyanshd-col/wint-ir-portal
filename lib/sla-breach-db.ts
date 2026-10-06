import { query } from '@/lib/cx/db';
import { SLA_HOURS, type BreachingTicket } from '@/lib/sla-breach';

/** Production query: OPEN tickets whose SLA breach time (anchor + 24h) falls in [windowStart, windowEnd]. */
export async function fetchBreachingTickets(window: { windowStart: Date; windowEnd: Date }): Promise<BreachingTicket[]> {
  return query<BreachingTicket>(
    `WITH tickets AS (
       SELECT chat_id, id AS ticket_id, customer_email, customer_phone,
              CASE WHEN first_response_at IS NULL THEN created_at ELSE updated_at END AS sla_clock_start
       FROM email_conversations
       WHERE status = 'OPEN'
     )
     SELECT chat_id, ticket_id, customer_email, customer_phone,
            sla_clock_start AS user_last_replied_at,
            sla_clock_start + make_interval(hours => $3) AS sla_breach_time
     FROM tickets
     WHERE sla_clock_start + make_interval(hours => $3) BETWEEN $1 AND $2
     ORDER BY sla_breach_time`,
    [window.windowStart, window.windowEnd, SLA_HOURS],
  );
}
