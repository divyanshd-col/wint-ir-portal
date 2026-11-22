-- Email SLA alert: every ticket the alert considers "waiting on an agent", with the facts behind it.
-- Read-only. Same rules as lib/sla-breach.ts + lib/sla-breach-db.ts, written independently, so the two can be compared.
-- Rules: docs/intent/email-sla-alert.md
--   customer_clock  = newest customer message (incoming, sender not @wintwealth.com); created_at only if the ticket has no incoming message stored and is not a Portal ticket (we sent the first email)
--   agent_last      = newest of: reply sent, incoming mail from a @wintwealth.com address, first_response_at, status moved to Answered / Pending email sent
--   waiting         = customer_clock is later than agent_last (or there is no agent action)
--   breach_at       = customer_clock + 24h; overdue = breach_at is already past
WITH ev AS (
  SELECT w.chat_id, w.event_type, w.received_at,
         w.payload->'data'->'message'->>'message_type' AS mt,
         lower(COALESCE(w.payload->'data'->'message'->>'from_email', '')) AS frm,
         w.payload->'data'->>'new_status' AS new_status,
         (SELECT COALESCE(NULLIF(p->>'snapshot_value', ''), p->>'selected_value')
            FROM jsonb_array_elements(COALESCE(w.payload->'data'->'properties', '[]'::jsonb)) p
           WHERE p->>'name' = 'ticket_source_rb_em' LIMIT 1) AS src,
         COALESCE((w.payload->'data'->'message'->>'created_at')::timestamptz, w.received_at) AS msg_at
  FROM robylon_webhook_payloads w
  WHERE w.source = 'email'),
facts AS (
  SELECT chat_id,
    (array_agg(src ORDER BY received_at DESC) FILTER (WHERE src IS NOT NULL))[1] AS ticket_source,
    max(msg_at) FILTER (WHERE event_type = 'NEW_MESSAGE' AND mt = 'incoming' AND frm NOT LIKE '%@wintwealth.com') AS last_customer_msg,
    bool_or(event_type = 'NEW_MESSAGE' AND mt = 'incoming') AS has_incoming,
    max(msg_at) FILTER (WHERE (event_type = 'REPLY_SENT' AND mt = 'reply')
                           OR (event_type = 'NEW_MESSAGE' AND mt = 'incoming' AND frm LIKE '%@wintwealth.com')) AS last_agent_msg,
    max(received_at) FILTER (WHERE event_type = 'STATUS_CHANGED' AND lower(btrim(new_status)) IN ('answered', 'pending email sent')) AS last_agent_status
  FROM ev GROUP BY chat_id),
latest_status AS (
  SELECT DISTINCT ON (chat_id) chat_id, new_status
  FROM ev WHERE event_type = 'STATUS_CHANGED' AND new_status IS NOT NULL
  ORDER BY chat_id, received_at DESC),
t AS (
  SELECT e.chat_id, e.customer_email, e.created_at, ls.new_status AS robylon_status,
         COALESCE(f.last_customer_msg, CASE WHEN COALESCE(f.has_incoming, false) OR lower(f.ticket_source) = 'portal' THEN NULL ELSE e.created_at END) AS customer_clock,
         GREATEST(e.first_response_at, f.last_agent_msg, f.last_agent_status) AS agent_last
  FROM email_conversations e
  JOIN facts f ON f.chat_id = e.chat_id            -- tickets with no stored events at all are skipped
  LEFT JOIN latest_status ls ON ls.chat_id = e.chat_id
  WHERE e.status = 'OPEN'
    AND (ls.new_status IS NULL OR lower(btrim(ls.new_status)) IN
         ('open', 'pending', 'customer reponded', 'customer responded', 'pending email sent', 'answered', 'internal dependency', 'external dependency')))
SELECT chat_id, customer_email, COALESCE(robylon_status, '(no status event)') AS robylon_status,
       customer_clock AS customer_last_message_at, agent_last AS agent_last_action_at,
       customer_clock + interval '24 hours' AS breach_at,
       (customer_clock + interval '24 hours') < now() AS overdue
FROM t
WHERE customer_clock IS NOT NULL AND (agent_last IS NULL OR customer_clock > agent_last)
ORDER BY breach_at;
