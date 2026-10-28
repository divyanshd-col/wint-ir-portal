# Email SLA Breach Alert

A cron-triggered job that posts open email tickets about to breach the 24-hour SLA to Slack, so the CX team can reply before the breach.

- Route: `GET /api/cron/sla-breach?trigger=1|2`
- Code: `app/api/cron/sla-breach/route.ts`, `lib/sla-breach.ts` (rules, window, Slack message), `lib/sla-breach-db.ts` (query)
- Tests: `scripts/sla-breach.test.ts` (offline, part of `npm test`), `scripts/sla-breach.integration.test.ts` (opt-in, needs a local Postgres)
- Triggered externally (cron-job.org), not by Vercel Cron: `vercel.json` has no entry for it.

## When it runs

| Trigger | Runs (IST) | cron-job.org schedule (UTC) | Alerts on tickets breaching |
|---|---|---|---|
| `trigger=1` | 9:45 AM | `15 4 * * *` (every day at 04:15) | 10:00 AM to 7:00 PM IST today |
| `trigger=2` | 3:00 PM | `30 9 * * *` (every day at 09:30) | 7:00 PM IST today to 11:30 AM IST tomorrow |

The window is calculated from the actual time of the call, using the IST calendar day (IST has no daylight saving), so the UTC schedule is safe.

## Which tickets are listed

A ticket is listed when **all** of these hold:

1. `email_conversations.status` is `OPEN`.
2. **The customer spoke last.** The latest conversation message (a `NEW_MESSAGE` or `REPLY_SENT` event in `robylon_webhook_payloads`, `message_type` `incoming` or `reply`) was not sent from an `@wintwealth.com` address. Internal notes are ignored: they do not answer the customer, so the SLA clock keeps running.
3. **Chat Status is not `Repayment` or `Repayment External Dependency`.** Taken from the latest `Chat Status` property in the ticket's events (not the separate `Status` property). The match ignores case; `Repayment Int/Ext Dependency` is not excluded.
4. **The breach time falls in the trigger's window.** Breach time = time of the customer's last message + 24 hours. With no message events the ticket is unanswered, so the clock starts at `created_at`. If a first response exists but there are no message events, `updated_at` is used as a fallback, and the ticket stays in the alert (a false alert beats a missed breach).
5. The sender is not automated: `noreply`, `no-reply`, `donotreply`, `notifications`, `mailer-daemon`, `postmaster`, `bounce(s)`, `recommendations`, `newsletter(s)` (the part before `@`). These are dropped and counted in the message header.

Tickets are sorted by breach time, soonest first.

## The Slack message

A line with the tags (`@cx_tl @email`) and the count, then a table:

| Ticket ID | Category | Breaches in | Breaches at | Open ticket |
|---|---|---|---|---|
| 175165 | Junk | 2h 43m | 14 Oct, 1:10 PM | Open ticket (link) |

- **Ticket ID** is the `chat_id`; the link is `https://app.robylon.ai/unified-inbox/share/<chat_id>`.
- **Category** is the L1 intent: the latest `Intents_L1` property in the ticket's events. It shows the name (not the id), and `—` when Robylon has not classified the ticket (empty, `None`, or a raw id).
- **Breaches in** is the time left from when the job ran (`overdue` once past). **Breaches at** is in IST.
- The table shows at most 99 rows, then a note with how many more there are.
- With nothing to report it posts "No SLA breaches expected… ✅" and tags nobody.

## Configuration

Environment variables (set them for the right environment in Vercel; never commit them):

| Variable | Purpose |
|---|---|
| `SLA_CRON_SECRET` | Bearer token the caller must send. Unset means every call returns 401 |
| `SLA_SLACK_BOT_TOKEN` | Bot token (`xoxb-…`) of the SLA Slack app, scope `chat:write` |
| `SLA_SLACK_CHANNEL` | Channel ID, e.g. `C0123ABCDEF`. The bot must be invited to the channel |
| `SLA_SLACK_MENTIONS` | Optional. Comma-separated Slack IDs (`S…` user group, `U…` user). Default: plain text `@cx_tl @email`, which pings in this workspace |

The database is the app's normal one (`POSTGRES_URL_NON_POOLING` / `POSTGRES_URL`); the job only reads from it.

### cron-job.org job

| Setting | Value |
|---|---|
| URL | `https://<app domain>/api/cron/sla-breach?trigger=1` (or `2`). Use the final domain: cron-job.org does not follow redirects |
| Method | GET |
| Header | `Authorization: Bearer <SLA_CRON_SECRET>` |
| Schedule | see the table above (UTC) |
| Extras | save responses in history; notify on failure |

A healthy response is `{"ok":true,"count":<tickets listed>,"excluded":<automated senders dropped>}`.

### Preview deployments

- Add the variables above for the branch under Vercel, Environment Variables, Preview Branches, then redeploy (variables only apply to new deployments).
- If Deployment Protection is on, the job gets a 302 to a Vercel login page. Add a Protection Bypass for Automation secret in the project settings and send it as the header `x-vercel-protection-bypass: <secret>`. The bearer token is still checked by the route.
- A preview reads the same database as the project's Preview environment, so check which database that points to before testing with real tickets.

| Response | Meaning |
|---|---|
| 200 | Posted to Slack |
| 400 | `trigger` is not `1` or `2` |
| 401 | Missing or wrong bearer token (or `SLA_CRON_SECRET` unset) |
| 404 | The route is not deployed on that URL |
| 500 | The database query or the Slack post failed (see the deployment logs; a Slack `not_in_channel` means the bot was not invited) |

## Performance

One query reads the open tickets and, per ticket, three indexed lookups on `robylon_webhook_payloads.chat_id` (last message, Chat Status, category), about 300 rows at most. Measured at 25,000 tickets and 325,000 events (a 3 GB table): 150 to 440 ms. A single-pass rewrite was tried and was not faster, so the plain query stays. The index `idx_robylon_webhook_payloads_chat_id` (migration 021) must exist. The route has `maxDuration = 30`.

## Known limitations

- Tickets without message events in the log fall back to `created_at` (or `updated_at` once a first response exists). That is exact for unanswered tickets and approximate otherwise.
- The sender filter is pattern based. Company support addresses (for example `care@…`, `support@…`) are kept on purpose.
- No de-duplication: a retried or double-fired job posts again.
- Category is only available once Robylon has classified the ticket; many open tickets show `—`.

## Testing

```bash
npx tsx --test scripts/sla-breach.test.ts          # offline unit tests, also run by npm test
```

The integration test needs a throwaway local Postgres, because it truncates `email_conversations` and `robylon_webhook_payloads`:

```bash
docker run -d --name sla-test-pg -e POSTGRES_PASSWORD=test -p 54329:5432 postgres:16
docker exec sla-test-pg createdb -U postgres sla_integration
SLA_TEST_DATABASE_URL=postgres://postgres:test@localhost:54329/sla_integration \
  npx tsx --test scripts/sla-breach.integration.test.ts
```

It refuses any database that is not on localhost.
