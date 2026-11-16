# PCG email events on the shared Robylon email webhook

Robylon sends every email event, CX and PCG, to `POST /api/webhooks/email`. The route splits them by **inbox**.

## How an event is routed

1. Read the PCG inbox list: the saved list in the portal config (Settings → PCG → Email Inbox, `pcgEmailInboxes`), or until one is saved the built-in default (`DEFAULT_PCG_EMAIL_INBOXES` in `lib/email/inbox.ts`: hnidesk@, pmsadvisory@, huf@ wintwealth.com). A saved list, even an empty one, replaces the default; an empty list means everything is CX.
2. Find the inbox the event names: `channel_info.email`, else the `ticket_channel_email_rb_em` property (`lib/email/inbox.ts`).
3. Inbox on the PCG list → **PCG**: store the payload as-is in `pcg_webhook_payloads` (`source='robylon_email'`, `channel='email'`), skip every CX step (no `email_conversations`, no reply evaluation, no SLA input), answer 200.
4. No inbox on the event (about 3% of NEW_MESSAGE / INTERNAL_NOTE_ADDED): it **follows its ticket**, PCG if an earlier event of that ticket was stored as PCG.
5. Anything else → CX, unchanged.

## What is protected

| Risk | How it is handled |
|---|---|
| Robylon retries a delivery (non-2xx, slow, same `event_id`) | A failed PCG write answers 500 so Robylon retries; an `event_id` already stored returns `duplicate` and is not stored twice (`savePcgEmailEvent`). |
| The PCG list cannot be read | The webhook answers 500 (retry). It never guesses "CX": that would put PCG emails through CX scoring and SLA alerts. |
| An inbox-less event arrives before the event that names the PCG inbox, or both are in flight at once | The first PCG event of a ticket moves what CX already holds for it (raw events, `email_conversations`, evaluations) out of CX (`adoptCxEmailTicketIntoPcg`). An inbox-less event processed as CX re-checks the ticket afterwards. |
| The CX inbox is added to the PCG list by mistake | Saving is refused when the inbox carries 50% or more of the CX tickets of the last 7 days. |
| A bad address in the list | Validated (address format, max 20, lower-cased, de-duplicated). Only a PCG admin can change it; every change is in the settings history. |
| PCG rows reaching CX reports | They live in another table. Nothing reads `pcg_webhook_payloads` for emails yet, and the CX SLA alert / analytics read only `robylon_webhook_payloads`. |

## Go-live checklist

1. The three PCG inboxes are built in, so routing is active as soon as this is deployed. In Settings → PCG → Email Inbox you can see the effective list; saving a list replaces the default, so keep all PCG inboxes on it.
2. Send a test email to the PCG inbox. Check: `select event_type, chat_id from pcg_webhook_payloads where source='robylon_email' order by id desc limit 5;` shows its events, and `select 1 from robylon_webhook_payloads where chat_id = '<ticket>'` returns nothing.
3. Watch the logs for `Moved N earlier event(s) of PCG ticket` (an out-of-order delivery, handled) and for `Failed to store PCG` / `Could not read the PCG inbox list` (Robylon retries; investigate if repeated).
4. Confirm `hello@` CX events still land in `robylon_webhook_payloads` and `email_conversations`.

The old `/api/webhooks/pcg-email` route is removed: Robylon only sends to `/api/webhooks/email`.
