# Email SLA alert: intent

Confirmed with the product owner (interview, 2026-11-10). Code: `lib/sla-breach.ts`, `lib/sla-breach-db.ts`, `app/api/cron/sla-breach/route.ts`.
To compare the alert against the database yourself, run `scripts/sla-alert-check.sql` (read-only).

## Outcome
The email SLA alert lists a ticket only when the **customer spoke last** and no agent has acted since. Each listed ticket is either
**overdue** (the 24h deadline has passed and the customer is still waiting) or **upcoming** (the deadline falls in the current run's window).
Overdue tickets come first, oldest breach first.

## Problem it fixes
Answered tickets, where the agent's reply was the last entry, were still flagged. Causes found in the data:
- `email_conversations.status` is stale: 520 of 759 `OPEN` tickets were older than 30 days and 145 had already been closed in Robylon.
- 530 open tickets had no message events, so the clock was guessed from `created_at` / `updated_at` and an empty "last sender" counted as the customer.
- Robylon's finer statuses (Answered, Pending email sent, ...) were never used.

## Rules
1. **Which tickets**: table status `OPEN`, and Robylon's latest status (`STATUS_CHANGED.new_status`) is one of
   Open, PENDING, Customer responded ("Customer reponded" in Robylon), Pending email sent, Answered, Internal Dependency, External Dependency.
   A ticket with events but no status event counts as Open.
   **Ignored**: WAITING_ON_AGENT, Hold, Entity Escalation, Repayment, Repayment External Dependency, CLOSED (and Resolved).
2. **Customer clock**: the newest customer message (incoming, sender not `@wintwealth.com`) + 24h wall-clock.
   A ticket with no stored incoming message at all uses its creation time (the first email),
   except a **Portal** ticket (`ticket_source_rb_em` = Portal: we sent the first email, e.g. a failed-repayment notice): no customer is waiting until they reply.
3. **Agent acted** (not flagged) when the newest of these is later than the customer's message:
   a reply sent, an incoming mail from a `@wintwealth.com` address (internal), `first_response_at`,
   or the ticket moved to **Answered** / **Pending email sent**. Internal notes do not count.
4. **Safeguard**: Answered / PENDING / Pending email sent are in scope on purpose. If the customer wrote after the agent's last action, the ticket is
   flagged even though Robylon still says Answered (its automation to move it to Customer responded may have failed). Message times decide, not the status.
5. **Skipped**: tickets with no stored Robylon event at all (357 on 2026-11-10, almost all created before 28 Sep when event capture started), until a new event arrives.
   A ticket started by a `@wintwealth.com` sender has no customer waiting.
6. **Window**: unchanged. Run 1 (09:45 IST) lists breaches 10:00-19:00 IST today; run 2 (15:00 IST) lists 19:00 today to 11:30 tomorrow. Overdue tickets are listed in both runs.
   Automated senders (noreply and similar) are still excluded and counted.

## Success
On the next production run no listed ticket has an agent action after the customer's last message. Check with `scripts/sla-alert-check.sql`.

## Constraints
- Message and status events exist only from 28 Sep 2026. Older tickets cannot be judged.
- The first run lists the existing backlog as overdue (about 31 tickets on 2026-11-10, some more than a month old); later runs list only new ones.
- No historical record of what was alerted: the cron only posts to Slack.

## Out of scope
A report of replies that went out after 24h, and any change to the Slack layout or the two daily runs.
