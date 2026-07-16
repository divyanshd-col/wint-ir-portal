# Email Workflow Automation — Implementation Plan

Goal: bring email interactions (currently handled inside Robylon) into the IR
Portal with the same automated pipeline that chats and calls already have —
webhook ingestion → PostgreSQL storage → auto disposition + IQS scoring →
QA review → disputes → TL coaching → analytics.

---

## 1. Where we are today

| Channel | Ingestion | Storage | Auto-scoring | QA review UI |
|---|---|---|---|---|
| Chat (WhatsApp) | Robylon webhook: `TICKET_CLOSED`, `CLASSIFICATION_UPDATED`, `CSAT_SUBMITTED` → `/api/webhooks/chat` | `conversations` table | Chat IQS (11 params) via `lib/scoring/engine.ts` | `/quality/chat-evaluation`, TL + agent views |
| Call (voice) | Robylon webhook: `CC_VOICE_CALL_COMPLETE` → transcription → `pending_link` → linked to chat at `TICKET_CLOSED` | `call_recordings` + call columns on `iqs_scores` | Call IQS (11 params) | `/quality/call-evaluation` |
| **Email** | **Lives entirely in Robylon — nothing reaches the portal** | — | — | — |

Key properties of the existing pipeline we want to preserve:

- **Event-driven, order-independent**: transcript and classification can arrive
  in either order; scoring fires when both are present.
- **Idempotent**: dedup by `event_type:event_id` (`storeHasProcessedEvent`).
- **Safety net**: `/api/cron/process-pending-scores` re-scores anything that
  has transcript + tags but no score after 12h.
- **Identity linking**: `contacts` keyed by phone number links calls to chats.

---

## 2. Proposed email flow

```
Investor email arrives (→ Robylon inbox)
        ↓
Agent replies / resolves inside Robylon (no change to agent workflow)
        ↓
Robylon fires webhook on ticket closure  ──►  POST /api/webhooks/email
        ↓
Portal normalises the thread (strip quoted history, signatures, HTML→text)
        ↓
Stored in PostgreSQL (conversations with channel='email' + email_messages)
        ↓
Disposition:  Robylon CLASSIFICATION_UPDATED (preferred)
              OR portal-side Gemini classifier (same pattern as calls)
        ↓
Email IQS scored (email-specific parameter set + weights)
        ↓
QA review in /quality (email tab) → confirm / override → disputes
        ↓
TL coaching, agent self-analytics, text-to-SQL analytics, Slack alerts
        ↓
Fallback: hourly/daily cron re-scores unscored email threads (>12h)
```

### 2.1 Ingestion — `POST /api/webhooks/email`

Mirror `/api/webhooks/chat`:

- Same auth: `Authorization: Bearer <WEBHOOK_SECRET>` or `?secret=`.
- Same dedup: `event_type:event_id` via `storeHasProcessedEvent`.
- Events handled:
  - `EMAIL_TICKET_CLOSED` (or `TICKET_CLOSED` with `channel: "email"`) —
    full thread payload → upsert conversation + messages.
  - `CLASSIFICATION_UPDATED` — disposition l1/l2 → update tags, trigger
    scoring if thread already stored (identical to chat handler).
  - `CSAT_SUBMITTED` — if Robylon runs CSAT surveys on email.

Alternative: extend the existing `/api/webhooks/chat` route with a channel
discriminator. Recommended: **separate route** — email payloads (multi-message
threads, HTML, attachments) are structurally different, and the chat route is
already long; both can share the scoring engine and dedup helpers.

### 2.2 Normalisation — `lib/scoring/email-transcript.ts`

The email analogue of `normalizeRobylonMessages`:

- HTML → plain text (preserve paragraph breaks, drop tracking pixels/images).
- Strip quoted history ("On <date>, X wrote:", `>` blocks, Gmail/Outlook
  reply markers) so each stored message contains only its new content.
- Strip signatures and legal footers (heuristics + configurable patterns).
- Map senders to roles: `customer` (requester email) vs `agent` vs `bot`
  (if Robylon AI auto-replied — attributed to Myra, like bot chats).
- Produce the same shape the scorer consumes: `transcriptText`,
  `timedMessages` (for timing analysis), `transcriptForStorage`.

### 2.3 Storage — migration `013_email_schema.sql`

Reuse `conversations` rather than a parallel table so all downstream queries
(QA review, TL, analytics, disputes) keep working with minimal change:

```sql
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS channel VARCHAR(10)
  NOT NULL DEFAULT 'chat' CHECK (channel IN ('chat','email'));
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS email_subject TEXT;

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS email VARCHAR(255);
CREATE UNIQUE INDEX IF NOT EXISTS contacts_email_idx ON contacts (LOWER(email))
  WHERE email IS NOT NULL;
```

- The thread itself goes into the existing `transcript JSONB` column using the
  same message shape (`sender_type`, `content`, `timestamp`), plus
  email-specific fields per message (`subject`, `from`, `to`, `cc`,
  `message_id`, `attachments: [{name, url, mime, size}]`).
- `contacts` gains `email` alongside `phone` — this also enables
  cross-channel identity: if Robylon supplies both phone and email for a
  requester, calls/chats/emails from the same investor can be linked.
- Email IQS columns on `iqs_scores` follow the call pattern
  (`email_iqs_score`, `email_parameters`, ...) **only if** we allow one
  conversation to carry multiple channel scores; since an email thread is its
  own conversation row, the existing `iqs_score`/`parameters` columns can be
  reused as-is — preferred.
- Timing columns reused: `frt_seconds` = first agent reply − first customer
  email; `resolution_seconds` = thread open → close. `bot_to_team_seconds`
  only if Robylon AI first-touches emails.

### 2.4 Disposition classification

Preferred: Robylon fires `CLASSIFICATION_UPDATED` for email tickets exactly as
for chats (agent tags the ticket, we receive l1/l2).

Fallback (if Robylon can't): classify portal-side with Gemini, same pattern as
`CALL_DISPOSITION_CLASSIFY_PROMPT` in the call pipeline — constrained to the
official disposition list, stored into `tags`, then scoring proceeds.

### 2.5 Email IQS scoring

New parameter set in `lib/quality.ts` (following `WEIGHTS` / `BOT_WEIGHTS`
pattern: `EMAIL_WEIGHTS`, `EMAIL_PARAM_NAMES`, `EMAIL_PARAM_ORDER`) and a new
`EMAIL_IQS_SYSTEM_PROMPT`. Draft parameter set (to be validated with QA team):

| # | Parameter | Weight | Notes vs chat |
|---|---|---|---|
| 1 | Technically / Legally Correct | 20% | unchanged; SEBI violations auto-fail |
| 2 | All Questions Answered | 15% | ↑ — email threads must be complete, no quick follow-up |
| 3 | Expectation Setting | 10% | unchanged |
| 4 | Structure & Formatting | 10% | new — greeting, paragraphing, subject hygiene |
| 5 | Contextual & Personal | 10% | unchanged |
| 6 | Grammar / Language | 10% | ↑ — written formality matters more on email |
| 7 | Simple to Understand | 10% | unchanged |
| 8 | Empathy | 5% | slightly ↓ |
| 9 | Follow-up & Closing | 5% | unchanged |
| 10 | First Response Timeliness | 5% | replaces "First Response & Opening" — SLA-based |
| 11 | Process-wise | 5% | unchanged (escalation to call where required folds in) |

Scoring engine: `executeScoring` in `lib/scoring/engine.ts` branches on
`conversation.channel` to pick prompt + weights (same way it already branches
bot vs agent). KB grounding via `getKbContextForScoring` is reused unchanged.

### 2.6 QA review, disputes, TL, analytics

- `/quality` gains an **Email Evaluation** tab (sibling of chat/call-evaluation)
  with a thread viewer (subject line, per-message from/to, collapsed quoted
  text, attachment chips).
- `/api/cx/qa/chats-to-review` and reviewed-chats APIs gain a `channel`
  filter; `qaDispositionMap` config reused so QA ownership by disposition
  works identically.
- Disputes: no change — they key off `chat_id`/`iqs_scores`, which email rows
  share.
- TL member analytics, agent self-analytics, WoW trend: add channel filter /
  breakdown (chat vs email IQS shown separately, since parameter sets differ).
- Analytics text-to-SQL: add `channel` and email columns to the schema prompt
  in `lib/analytics/` so "average email FRT last week" just works.
- Slack quality alerts (`lib/quality-alert.ts`): include channel in alert text.

### 2.7 Safety nets & ops

- Extend `/api/cron/process-pending-scores` — its query already selects
  conversations with transcript + tags and no score; with email rows in the
  same table this works with only a channel-aware log line.
- `AUDIT` entries via `storeAppendAuditEntry` unchanged.
- Backfill script (`scripts/backfill-emails.mjs`) to import historical email
  tickets via Robylon export/API once the pipeline is live.

### 2.8 Optional Phase — real-time email drafting assist

Chats have a second workflow: the live triage assistant (`/` → Router →
fact-collection → KB answer → Draft). The same Stage 0–2 pipeline can draft
email replies (an "email mode" for the Draft stage producing subject +
formatted body). This needs Robylon to deliver **open** email tickets (not
just closed ones) or an inbox API, and a way to push the drafted reply back.
Out of scope for the first release; listed here so the webhook contract can
anticipate it (see Robylon requirement #8).

---

## 3. Requirements from Robylon

1. **Email ticket-closed webhook** (`EMAIL_TICKET_CLOSED` or `TICKET_CLOSED`
   with an explicit `channel: "email"` field), containing the **full thread**:
   - Stable `chat_id`/ticket ID (and behaviour on reopen — same ID or new?).
   - Every message with: direction/sender role (customer / agent / Robylon AI),
     sender email address, agent name, ISO-8601 timestamps (not the truncated
     format chat uses — see `parseRobyTimestamp` workarounds), subject,
     plain-text body **and** original HTML, attachment metadata + URLs.
   - Requester identity: email address (mandatory — our contact key) and
     phone number if known (enables cross-channel linking with calls/chats).
   - Assignment events/timestamps (who was assigned, when) — needed for FRT
     the same way "assigned by / Auto-Assigned" messages drive chat FRT.
   - `conversation_started` / `conversation_ended` timestamps.
2. **`CLASSIFICATION_UPDATED` for email tickets** — disposition l1/l2, same
   payload shape as chat. If email tickets are not classified in Robylon,
   confirm so we classify portal-side instead.
3. **`CSAT_SUBMITTED` for email** — if CSAT surveys are (or will be) sent on
   email resolutions; same rating vocabulary (good / could be better / bad).
4. **Event envelope guarantees**: unique `event_id` per event (dedup),
   `event_type` distinguishing email events, documented retry policy
   (we already handle retries idempotently), delivery ordering expectations
   (we handle out-of-order, but need to know it can happen).
5. **Auth**: webhooks signed the same way (Bearer `WEBHOOK_SECRET` header) to
   the new endpoint URL we provide.
6. **Attachment access**: how long do attachment/recording URLs stay valid
   (signed S3 URLs? expiry?) — determines whether the portal must copy
   attachments to its own storage at ingest time.
7. **Ticket lifecycle semantics**: what happens on thread **reopen**,
   **merge**, and **split** — does a new webhook fire, does the ID change,
   is the full thread re-sent? (Drives our upsert/dedup design.)
8. **(Future) open-ticket access** for the drafting assistant: webhook on new
   inbound email (before closure) or a pull API for open tickets, plus an API
   to post a draft/reply back into the Robylon ticket.
9. **Historical backfill**: an export or paginated API for closed email
   tickets (last 3–6 months) in the same payload shape, so analytics start
   with history rather than from zero.
10. **Volume & limits**: expected daily email ticket volume and any webhook
    rate limits, so we can size Vercel function timeouts (email threads are
    bigger payloads than chat transcripts).
11. **Sample payloads**: 5–10 real (redacted) webhook payloads covering:
    single-email thread, long multi-reply thread, thread with attachments,
    Robylon-AI-answered thread, reopened thread — before we freeze the schema.

---

## 4. Suggested build phases

| Phase | Scope | Depends on |
|---|---|---|
| 0 | Robylon alignment: confirm requirements §3, get sample payloads | Robylon |
| 1 | Migration 013 + `/api/webhooks/email` + normaliser; store threads (no scoring). Shadow-run in prod to validate payloads | Phase 0 |
| 2 | Email IQS params + prompt (validated with QA team) + scoring engine branch + cron coverage | Phase 1 |
| 3 | QA review UI (email tab, thread viewer), channel filters on QA/TL APIs, disputes | Phase 2 |
| 4 | Analytics (text-to-SQL schema, WoW, agent/TL dashboards), Slack alerts, historical backfill | Phase 3 |
| 5 (optional) | Real-time email drafting assist | Robylon open-ticket API |
