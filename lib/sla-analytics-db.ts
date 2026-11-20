import { query } from '@/lib/cx/db';
import type { SlaEmailRow } from '@/lib/sla-analytics';

/**
 * One row per customer email received in [from, to), with the first agent reply after it. One set-based statement (a single pass
 * over the email events of the period, about half a second for a week), not a lookup per ticket. Everything comes from
 * robylon_webhook_payloads: email_conversations is not read (it misses tickets and its status goes stale).
 *
 * A customer email is an incoming message from a sender that is not @wintwealth.com. A ticket's creation is NOT a customer email:
 * tickets an agent starts from the Robylon portal (ticket_source "Portal", e.g. an outbound "send us your bank details" mail) have
 * no customer email until the customer writes back, and every customer-started ticket has an incoming event at creation anyway.
 *
 * "The agent acted" (the first of these after the customer email) is any of:
 *  - a REPLY_SENT event;
 *  - an incoming mail from a @wintwealth.com address (an internal forward);
 *  - an agent message Robylon sent no message event for, e.g. an agent forwarding the customer's mail to colleagues. Every webhook
 *    carries running message counts, so such a message shows up as agent_message_count going up on an event that is neither a
 *    reply nor an internal note (notes also raise that count, which is why they are excluded). Its time is that event's time, which
 *    is usually within minutes of the message;
 *  - failing all of those, the ticket moving to Answered / Pending email sent.
 * Internal notes are never an agent response, but the first note after the customer email is returned (noted_at) so the breach list
 * can say "Note added" where an agent chose not to reply and left a note instead.
 */
export async function fetchSlaEmails(from: Date, to: Date): Promise<SlaEmailRow[]> {
  const rows = await query<{
    chat_id: string; ticket_id: string; customer_at: Date; next_reply: Date | null; next_status: Date | null; next_note: Date | null;
    robylon_status: string | null; ticket_status: string | null;
  }>(
    `WITH msg AS (
       SELECT w.chat_id, w.event_type,
              COALESCE((w.payload->'data'->'message'->>'created_at')::timestamptz, w.received_at) AS t,
              COALESCE((w.payload->'data'->'message'->>'from_email') ILIKE '%@wintwealth.com', false) AS staff,
              w.payload->'data'->'message'->>'message_type' AS mt,
              w.payload->>'ticket_id' AS tid
       FROM robylon_webhook_payloads w
       WHERE w.source = 'email' AND w.received_at >= $1 AND w.event_type IN ('NEW_MESSAGE', 'REPLY_SENT', 'INTERNAL_NOTE_ADDED')
     ),
     st AS (
       SELECT w.chat_id, w.payload->'data'->>'new_status' AS new_status, w.received_at AS t
       FROM robylon_webhook_payloads w
       WHERE w.source = 'email' AND w.event_type = 'STATUS_CHANGED'
     ),
     cnt AS (
       SELECT chat_id, event_type, t, a - lag(a) OVER (PARTITION BY chat_id ORDER BY t) AS da
       FROM (
         SELECT w.chat_id, w.event_type, w.received_at AS t, (w.payload->'counts'->>'agent_message_count')::int AS a
         FROM robylon_webhook_payloads w
         WHERE w.source = 'email' AND w.received_at >= $1 AND w.payload->'counts' IS NOT NULL
       ) x
     ),
     ev AS (
       SELECT m.chat_id, 'cust' AS kind, m.t, m.tid FROM msg m WHERE m.event_type = 'NEW_MESSAGE' AND m.mt = 'incoming' AND NOT m.staff
       UNION ALL
       SELECT m.chat_id, 'reply', m.t, NULL::text FROM msg m WHERE m.event_type = 'REPLY_SENT' AND m.mt = 'reply'
       UNION ALL
       SELECT m.chat_id, 'reply', m.t, NULL::text FROM msg m WHERE m.event_type = 'NEW_MESSAGE' AND m.mt = 'incoming' AND m.staff
       UNION ALL
       SELECT m.chat_id, 'note', m.t, NULL::text FROM msg m WHERE m.event_type = 'INTERNAL_NOTE_ADDED'
       UNION ALL
       SELECT c.chat_id, 'reply', c.t, NULL::text FROM cnt c WHERE c.da > 0 AND c.event_type IN ('STATUS_CHANGED', 'TICKET_CLOSED', 'TICKET_CREATED')
       UNION ALL
       SELECT s.chat_id, 'status', s.t, NULL::text FROM st s WHERE s.t >= $1 AND lower(s.new_status) IN ('answered', 'pending email sent')
     ),
     paired AS (
       SELECT chat_id, kind, t, tid,
              min(t) FILTER (WHERE kind = 'reply')  OVER w AS next_reply,
              min(t) FILTER (WHERE kind = 'status') OVER w AS next_status,
              min(t) FILTER (WHERE kind = 'note')   OVER w AS next_note
       FROM ev
       WINDOW w AS (PARTITION BY chat_id ORDER BY t, kind ROWS BETWEEN 1 FOLLOWING AND UNBOUNDED FOLLOWING)
     ),
     cust AS (SELECT * FROM paired WHERE kind = 'cust' AND t >= $1 AND t < $2),
     last_status AS (
       SELECT DISTINCT ON (s.chat_id) s.chat_id, s.new_status AS st
       FROM st s JOIN (SELECT DISTINCT chat_id FROM cust) k ON k.chat_id = s.chat_id
       ORDER BY s.chat_id, s.t DESC
     ),
     closed AS (
       SELECT w.chat_id, max(w.received_at) AS closed_at
       FROM robylon_webhook_payloads w
       WHERE w.source = 'email' AND w.event_type = 'TICKET_CLOSED' AND w.received_at >= $1
       GROUP BY w.chat_id
     ),
     last_cust AS (SELECT chat_id, max(t) AS last_customer_at FROM ev WHERE kind = 'cust' GROUP BY chat_id)
     SELECT c.chat_id, COALESCE(c.tid, c.chat_id) AS ticket_id, c.t AS customer_at, c.next_reply, c.next_status, c.next_note,
            ls.st AS robylon_status,
            CASE WHEN cl.closed_at IS NOT NULL AND cl.closed_at >= lc.last_customer_at THEN 'CLOSED' END AS ticket_status
     FROM cust c
     LEFT JOIN closed cl ON cl.chat_id = c.chat_id
     LEFT JOIN last_cust lc ON lc.chat_id = c.chat_id
     LEFT JOIN last_status ls ON ls.chat_id = c.chat_id
     ORDER BY c.t`,
    [from.toISOString(), to.toISOString()],
  );
  const out: SlaEmailRow[] = rows.map((r) => ({
    chat_id: r.chat_id,
    ticket_id: r.ticket_id,
    customer_at: new Date(r.customer_at),
    // Any agent action wins; the Answered / Pending email sent status only stands in when nothing else follows.
    replied_at: r.next_reply ? new Date(r.next_reply) : r.next_status ? new Date(r.next_status) : null,
    noted_at: r.next_note ? new Date(r.next_note) : null,
    robylon_status: r.robylon_status,
    ticket_status: r.ticket_status,
  }));

  // Data check for the unanswered emails only (usually a handful of tickets, looked up by chat_id): when Robylon last told us
  // anything, and how many agent messages Robylon's own running count shows beyond the replies / notes / forwards we stored.
  // A positive gap means a webhook never reached us and the reply may exist in Robylon.
  const unanswered = [...new Set(out.filter(r => !r.replied_at).map(r => r.chat_id))];
  if (unanswered.length) {
    const gaps = await query<{ chat_id: string; last_event_at: Date; robylon_agent_count: number | null; stored_agent_count: string }>(
      `SELECT w.chat_id,
              max(w.received_at) AS last_event_at,
              (array_agg((w.payload->'counts'->>'agent_message_count')::int ORDER BY w.received_at DESC)
                 FILTER (WHERE w.payload->'counts' IS NOT NULL))[1] AS robylon_agent_count,
              count(*) FILTER (WHERE w.event_type IN ('REPLY_SENT', 'INTERNAL_NOTE_ADDED')
                OR (w.event_type = 'NEW_MESSAGE' AND (w.payload->'data'->'message'->>'from_email') ILIKE '%@wintwealth.com')) AS stored_agent_count
       FROM robylon_webhook_payloads w
       WHERE w.chat_id = ANY($1::text[]) AND w.source = 'email'
       GROUP BY w.chat_id`,
      [unanswered],
    );
    const byChat = new Map(gaps.map(g => [g.chat_id, g]));
    for (const r of out) {
      const g = !r.replied_at ? byChat.get(r.chat_id) : undefined;
      if (!g) continue;
      r.last_event_at = new Date(g.last_event_at);
      r.missing_agent_messages = Math.max(0, (g.robylon_agent_count ?? 0) - Number(g.stored_agent_count));
    }
  }
  return out;
}
