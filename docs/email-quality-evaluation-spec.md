# Email Quality Evaluation: Revised Spec

Status: draft v3 (checked against live data on 7 Oct 2026). Replaces "Email Process Implementation.md". Built from repo review and 21 days of production webhook data (17 Sep to 7 Oct 2026: 3,060 human replies, about 146 per day). Early checks used only `source = 'email'` (29 Sep onwards); email events also arrived as `source = 'chat'` with `ticket_provider = 'ROBYLON_EMAIL'` from 17 Sep to 29 Sep.
Items marked **DECISION** need an answer before build. Items marked **DRAFT** are proposals for you to edit.

---

## 1. What the data changed

| Finding | Evidence | Consequence |
|---|---|---|
| The sender is `data.message.sender`, not `human_agent_info` | When both exist and differ (e.g. sender "Nirmiti", `human_agent_info` "Aditya R"), `human_agent_info` equals the **assignee**. The same holds for notes. | Attribute each reply to `data.message.sender`. `human_agent_info` is the assignee only. |
| Sender is a display name, with no ID | About 10% of human replies have no `human_agent_info` at all. Names carry trailing spaces ("Priti ", "Pooja "). | Match senders to `agents` by trimmed, case-insensitive name. Unmatched senders are visible, never silently dropped or auto-created. |
| Multi-agent tickets are common | 227 tickets have 2 or more agent IDs among their replies. Ticket 166482 has 6 agents across 7 replies. | Per-reply attribution is essential. |
| Current handler never stores the agent | It reads `handled_by_name`, which does not exist in the payloads. 1,293 of 1,293 replies had it null. | `email_conversations.agent_name` has never held a sender. Fix the handler regardless of this project. |
| 22% of replies have no ticket row | 190 orphan tickets, **none** with a create event inside the window. They are tickets created before 29 Sep (e.g. chat 115594), still receiving replies. | The handler's `UPDATE`-only path drops them. Tickets live for weeks, so the long-open scenario is real. No in-window ordering race was seen. |
| 13 Robylon statuses | OPEN, Answered, PENDING, Pending email sent, Customer reponded (sic), WAITING_ON_AGENT, Internal Dependency, External Dependency, Repayment, Repayment External Dependency, Hold, Entity Escalation, CLOSED. | Store Robylon's status raw. Our 3-value `status` stays for the SLA cron only. |
| Merge is a flag | `ticket_is_merged_rb_em` and `Ticket Is Merged` appear in `properties`. 55 events have value 1. There is no merge event. | Detect merges from the flag. See open decision D4. |
| AI replies fire `REPLY_SENT` | 42 events (3%) have `handled_by = AI`. | Skip them. Do not score them. |
| Notes are a separate event | `INTERNAL_NOTE_ADDED` (455 events) with `message_type = note`. | Never evaluate notes. |
| Customer emails quote the whole thread | A `NEW_MESSAGE` body includes the earlier agent reply and its disclaimer. | Strip quoted history before using a customer message as context. |
| Volume is small | About 146 human replies per day (3,060 in 21 days), plus 67 AI replies that jumped from under 6 a day to 19 and 20 on 5 and 6 Oct. | Synchronous Gemini calls in chunks. No Batch API, no thread summary. |
| **71 replies (5.4%) already lack the disclaimer** | 1,252 of 1,323 human replies contain it. The other 71 come from exactly two senders (Priya D: 66 of 66, Pavithra Reddy: 5 of 5). Their signatures end at "High Yield Asset-backed Products www.wintwealth.com" with no TnC. Every other sender is 100%. | The disclaimer is a per-agent signature template, so the failure is all-or-nothing per agent. It may be a signature setup problem, not individual lapses. Tell the two agents and their TL before scores go live. |
| Agent replies carry no quoted history | 0 of 1,323 contain `wrote:`, `blockquote` or `gmail_quote`. | A plain text match on the reply body is a valid disclaimer check. |
| Delivery lag is small | p50 about 5s, p99 14 to 19s, max about 3m05s for every event type. | A 10-minute settle delay before evaluating is enough. |
| Sender names all match `agents` | 24 distinct senders, each matches exactly one `agents.name` (case-insensitive, trimmed). | Name lookup works today. It stays fragile (Robylon shows "Roopa" for the account `dhanunjaya@`), so unmatched names must be listed, not dropped. |
| Merge flag marks the absorbed ticket about 60% of the time | 18 flagged tickets: 11 closed within 2 minutes of the flag, 4 closed later, 3 never closed. `Ticket Is Merged` is always empty, so no survivor ID is available. | Do not build merge linking (about 18 tickets a week). Do not exclude flagged tickets from SLA alerts: the 3 never-closed ones may be survivors. |
| Reopen and re-close are rare | Of 934 closed tickets: 4 got a customer message after close, 7 a reply after close, 6 closed more than once. | No supersede machinery. Re-run the ticket check on each close. |
| Closes follow replies closely | 222 of 934 closes (24%) have a reply in the 60 seconds before. | The ticket-level check must not run inside the webhook. |
| Customer messages are clean | All 1,139 are `sender_type = customer`, `is_csat_reply = false`, `from_forwardee = false`. 59 (5%) come from no-reply style addresses. | No CSAT or forwardee handling. Skip replies to automated senders. |

## 2. Entities and state machines

### 2.1 Ticket (`email_conversations`): mirrors Robylon, owns no evaluation state

- Add `robylon_status` (raw), `is_merged`, `status_event_at`, `robylon_status_event_at`, `last_customer_message_at`, `is_stub`.
- Keep `status` (OPEN / RESOLVED / CLOSED) with today's meaning, because the SLA cron reads it. Do not change that meaning in this project.
- **The evaluator never writes to `email_conversations`.** `slaClockStart` reads `updated_at`, so any write by the evaluator would shift the SLA clock.

| Event | Effect | Guard |
|---|---|---|
| any event, ticket row missing | create stub row (`is_stub = true`) | none |
| TICKET_CREATED / NEW_MESSAGE | `status = OPEN` | only if event time is at least `status_event_at` |
| REPLY_SENT (human reply) | `status = RESOLVED`, set `first_response_at` if null | same guard |
| STATUS_CHANGED | `robylon_status = new_status` | same guard |
| TICKET_CLOSED | `status = CLOSED`, set `closed_at` | same guard |
| merge flag = 1 on any event | `is_merged = true` (sticky, display only) | none. Not used for SLA or scoring. |

A customer message after CLOSED reopens the ticket (existing behaviour). Clear `closed_at` on reopen.

**Versioning and the SLA anchor (v3).**
- Replace the single `last_event_at` with one timestamp per field: `status_event_at` (guards `status`) and `robylon_status_event_at` (guards `robylon_status`). Otherwise a note stamped later blocks an earlier status change that arrives after it.
- Add `last_customer_message_at`, set only by `TICKET_CREATED` and `NEW_MESSAGE`. Point `slaClockStart` and `fetchBreachingTickets` at it instead of `updated_at`. `STATUS_CHANGED` runs about 500 times a day and notes about 65, and neither may touch `updated_at` or move the SLA clock.
- Handlers for `STATUS_CHANGED` and `INTERNAL_NOTE_ADDED` write only their own columns.

### 2.2 Reply evaluation (`email_reply_evaluations`)

```
(webhook) -> PENDING -> PROCESSING -> COMPLETED
                 ^           |
                 |           +-> PENDING   (transient error, attempts < 3)
                 |           +-> FAILED    (attempts >= 3)
                 +--- lease expired (locked_at older than 15 min)
(webhook) -> SKIPPED   (skip_reason set at ingest, terminal)
FAILED -> PENDING      (manual retry by QA/admin only)
```

| Transition | Trigger | Rule |
|---|---|---|
| none -> PENDING | REPLY_SENT, `handled_by = HUMAN`, `message_type = reply`, non-empty body | Insert with `ON CONFLICT (message_id) DO NOTHING`. A redelivery never resets an existing row. |
| none -> SKIPPED | REPLY_SENT with `handled_by = AI`, or `message_type <> reply`, or empty body | `skip_reason` = `AI_REPLY`, `NOT_A_REPLY`, `EMPTY_BODY` |
| PENDING -> PROCESSING | evaluator cron | Claimed with `FOR UPDATE SKIP LOCKED`, which makes overlapping runs impossible |
| PROCESSING -> COMPLETED | model returns valid JSON | Written with a fence: `WHERE evaluation_status = 'PROCESSING' AND locked_at = <claimed value>`. A stale worker cannot overwrite. |
| PROCESSING -> PENDING | API error or timeout | `attempts` below 3 |
| PROCESSING -> FAILED | `attempts` reaches 3 | Counted and listed on the QA dashboard |
| PROCESSING -> PENDING | lease expired | Crashed worker recovery |

COMPLETED has no exit except re-evaluation. A re-run updates the AI columns and appends a `RE_EVALUATED` event. It never touches the override.

### 2.3 Score changes (`email_reply_score_events`, append-only)

Event types: `AI_SCORED`, `RE_EVALUATED`, `QA_OVERRIDE`, `OVERRIDE_REMOVED`, `DISPUTE_ADJUSTED`.
Each row stores who, when, `score_before`, `score_after` and a note.

Effective score = `override_score` if present, else `quality_score`.
The override columns on the evaluation row and the event row are written in one transaction. The event table is the history; the columns are a cache.

### 2.4 Dispute (`email_reply_disputes`): new, mirrors the existing agent -> TL -> QA flow

```
RAISED -> UPHELD            (TL resolves, score unchanged)
RAISED -> ADJUSTED          (TL resolves with a new score)
RAISED -> FORWARDED_TO_QA -> UPHELD | ADJUSTED
RAISED | FORWARDED_TO_QA -> WITHDRAWN   (agent)
```

- Only the reply's own agent can raise one, only when the evaluation is COMPLETED.
- At most one open dispute per reply (partial unique index).
- ADJUSTED writes a `DISPUTE_ADJUSTED` score event. A later QA override wins over an earlier dispute outcome by time. Both are in the audit trail.
- **ASSUMPTION:** roles and routing copy the chat flow (`app/api/cx/tl/disputes`, `app/api/cx/qa/disputes`). I have not read their logic. Confirm.

### 2.5 Ticket-level check (`email_ticket_evaluations`): runs on TICKET_CLOSED only

States: `PENDING -> COMPLETED`. Created on `TICKET_CLOSED`, evaluated by the cron only once the close is at least 10 minutes old (24% of closes follow a reply within 60 seconds). A re-close creates a new row (6 of 934 tickets); no `SUPERSEDED` state.
Result: whether the last customer message went unanswered. Per-reply `unanswered_questions` stays on the reply row for what a single reply missed; the ticket check does not repeat it.
**It is not attributed to any agent score.** It is shown at team level for TLs.
There is no 6-hour cron. The existing SLA breach alert (09:45 and 15:00 IST) stays separate and unchanged.

### 2.6 Compliance alert

Columns on the reply row: `alert_claimed_at`, `alert_sent_at`.
Flow: `UPDATE ... SET alert_claimed_at = now() WHERE alert_claimed_at IS NULL RETURNING`, then send, then set `alert_sent_at`. If the send fails, clear the claim so the next run retries. Never alert before the evaluation is committed.
Alert only when `compliance_passed = false` and a flagged issue is marked severe (see section 5).

## 3. Schema (migration 027)

```sql
ALTER TABLE email_conversations
  ADD COLUMN IF NOT EXISTS robylon_status TEXT,
  ADD COLUMN IF NOT EXISTS is_merged      BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS status_event_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS robylon_status_event_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_customer_message_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS is_stub        BOOLEAN NOT NULL DEFAULT FALSE;

-- Every inbound and outbound email in a ticket. No FK to tickets: tickets may predate ingestion.
CREATE TABLE IF NOT EXISTS email_messages (
  message_id          TEXT PRIMARY KEY,                -- data.message_id
  ticket_id           VARCHAR(100) NOT NULL,
  chat_id             VARCHAR(100),
  direction           TEXT NOT NULL CHECK (direction IN ('CUSTOMER','AGENT','AI')),
  sender_name         TEXT,                            -- trimmed data.message.sender
  sent_at             TIMESTAMPTZ NOT NULL,            -- data.message.created_at, NOT received_at
  body_text           TEXT,                            -- html stripped, quoted history removed
  body_html           TEXT,                            -- agent replies only
  webhook_payload_id  BIGINT REFERENCES robylon_webhook_payloads(id)
);
CREATE INDEX IF NOT EXISTS idx_email_messages_ticket ON email_messages (ticket_id, sent_at);

CREATE TABLE IF NOT EXISTS email_reply_evaluations (
  message_id          TEXT PRIMARY KEY REFERENCES email_messages(message_id),
  ticket_id           VARCHAR(100) NOT NULL,
  sender_name         TEXT NOT NULL,
  agent_id            INTEGER REFERENCES agents(id),   -- NULL = unattributed (shown in its own bucket)
  assignee_ref        TEXT,                            -- human_agent_info.agent_id, audit only
  team_id_at_send     INTEGER REFERENCES teams(id),
  sent_at             TIMESTAMPTZ NOT NULL,
  evaluation_status   TEXT NOT NULL DEFAULT 'PENDING'
                      CHECK (evaluation_status IN ('PENDING','PROCESSING','COMPLETED','FAILED','SKIPPED')),
  skip_reason         TEXT,
  attempts            SMALLINT NOT NULL DEFAULT 0,
  locked_at           TIMESTAMPTZ,
  last_error          TEXT,
  context_message_ids TEXT[],
  context_quality     TEXT CHECK (context_quality IN ('FULL','PARTIAL')),
  quality_score       SMALLINT CHECK (quality_score BETWEEN 0 AND 100),
  compliance_passed   BOOLEAN,
  compliance_issues   JSONB,
  parameter_scores    JSONB,
  unanswered_questions JSONB,
  model_version       TEXT,
  rubric_version      TEXT,
  evaluated_at        TIMESTAMPTZ,
  override_score      SMALLINT CHECK (override_score BETWEEN 0 AND 100),
  override_by         TEXT,
  override_at         TIMESTAMPTZ,
  override_note       TEXT,
  alert_claimed_at    TIMESTAMPTZ,
  alert_sent_at       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_ere_queue ON email_reply_evaluations (evaluation_status, sent_at)
  WHERE evaluation_status IN ('PENDING','PROCESSING');
CREATE INDEX IF NOT EXISTS idx_ere_agent ON email_reply_evaluations (agent_id, sent_at);

CREATE TABLE IF NOT EXISTS email_reply_score_events (
  id BIGSERIAL PRIMARY KEY,
  message_id   TEXT NOT NULL REFERENCES email_reply_evaluations(message_id),
  event_type   TEXT NOT NULL,
  score_before SMALLINT, score_after SMALLINT,
  actor        TEXT, note TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS email_reply_disputes (
  id BIGSERIAL PRIMARY KEY,
  message_id        TEXT NOT NULL REFERENCES email_reply_evaluations(message_id),
  raised_by_agent_id INTEGER REFERENCES agents(id),
  agent_note        TEXT,
  challenged_params JSONB NOT NULL DEFAULT '[]',
  score_at_raise    SMALLINT,
  status            TEXT NOT NULL CHECK (status IN ('RAISED','FORWARDED_TO_QA','UPHELD','ADJUSTED','WITHDRAWN')),
  resolved_by TEXT, resolved_at TIMESTAMPTZ, resolution_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_open_dispute ON email_reply_disputes (message_id)
  WHERE status IN ('RAISED','FORWARDED_TO_QA');

CREATE TABLE IF NOT EXISTS email_ticket_evaluations (
  id BIGSERIAL PRIMARY KEY,
  ticket_id TEXT NOT NULL, closed_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','COMPLETED')),
  result JSONB, evaluated_at TIMESTAMPTZ,
  UNIQUE (ticket_id, closed_at)
);
```

## 4. Ingest rules (`app/api/webhooks/email/route.ts`)

1. Return a non-2xx response if any DB write fails. Today errors are swallowed and the handler returns `ok: true`, so Robylon never retries.
2. If the ticket row is missing, create a stub instead of a no-op `UPDATE`. A stub sets `is_stub = true` and `created_at = NULL` (the real creation time is unknown). A stub created from a REPLY_SENT sets `first_response_at` to the event time, which is a known guess. `INTERNAL_NOTE_ADDED` events are saved raw only; notes are not stored in `email_messages`.
3. Use `data.message.created_at` for ordering. Ignore status writes older than the field's own `*_event_at`.
4. `agent_name` on the ticket continues to mean the assignee (`human_agent_info`). It is never used for scoring.
5. For REPLY_SENT: insert into `email_messages`, then `email_reply_evaluations`, in one transaction. Resolve the sender by name lookup only. **Do not call `upsertAgent`** for senders, because it auto-creates agents and would create junk rows from odd names. An unmatched sender leaves `agent_id` null.
6. Capture `team_id_at_send` from the matched agent at ingest.
7. Store NEW_MESSAGE bodies in `email_messages` as `CUSTOMER`. Strip quoted history (the "On ... wrote:" block and `>` lines).
8. If `WEBHOOK_SECRET` is unset, reject the request. Today it accepts everything.
9. **Fix `mergeAgentDuplicates` (`lib/robylon/db.ts`):** add `UPDATE email_reply_evaluations SET agent_id = $1 WHERE agent_id = ANY($2)` before the `DELETE FROM agents`, and wrap the statements in one transaction. Today they run separately, so an FK failure on the delete leaves the other tables already re-pointed.
10. **Backfill:** replay `robylon_webhook_payloads` filtered on `payload->>'ticket_provider' = 'ROBYLON_EMAIL'` (not on `source`; it covers the chat-source rows from 17 Sep as well; no event ID appears in both sources). `TICKET_CLOSED` only exists from 22 Sep and `STATUS_CHANGED` from 24 Sep, so ticket states before those dates cannot be rebuilt through the same logic. It is idempotent because `message_id` is the primary key.

## 5. Evaluator (cron, external scheduler, hourly)

- Claim up to 40 rows per run with `FOR UPDATE SKIP LOCKED`, only rows with `sent_at` at least 10 minutes old (delivery lag is at most about 3 minutes). Call `geminiGenerate` (existing helper, `gemini-3.5-flash`) once per reply, 5 at a time. No Batch API.
- Set `maxDuration = 300` for the route in `vercel.json`. Without it the function can be killed mid-chunk, which returns the rest of the chunk to PENDING only after the 15-minute lease and burns an attempt each time.
- Skip a reply (`skip_reason = AUTOMATED_SENDER`) if the customer message it answers comes from a no-reply style address (reuse `isAutomatedSender` in `lib/sla-breach.ts`).
- **Context, as of send time:** the reply, the customer message it answers (latest `CUSTOMER` message with `sent_at` before the reply, quoted text stripped), and up to the 5 messages before that, from `email_messages`. If fewer than expected exist (pre-29 Sep tickets), set `context_quality = PARTIAL`. There is no thread summary.
- **Disclaimer check is deterministic code, not the model:** normalise the body text and look for the brand TnC phrase. The model checks only judgement items.
- Strip HTML and inline styles before sending to the model (about 9 KB per reply raw).
- Never write to `email_conversations`. Never touch `override_*`.

**DRAFT rubric (edit freely).** Compliance gate: any failure sets `compliance_passed = false`.

| # | Parameter | Type | Note |
|---|---|---|---|
| C1 | Brand disclaimer present in signature | code | deterministic |
| C2 | No investment advice, recommendation or return guarantee | model | severe, alerts Slack |
| C3 | No request for OTP, password or card CVV | model | severe, alerts Slack |
| C4 | No internal information leaked (internal links, other customers) | model | severe, alerts Slack |
| Q1 | Answered every question the customer asked | model | fills `unanswered_questions` |
| Q2 | Did not re-ask for information already given in the thread | model | |
| Q3 | Gave a clear next step and timeline | model | |
| Q4 | Tone and empathy appropriate to the customer's state | model | |
| Q5 | Professional format: greeting, clarity, no errors | model | |

Weights and the list of "severe" items are **DECISION D5**.
Accuracy against product facts is excluded from v1: there is no knowledge base in the evaluator.

## 6. Dashboards

- Agent score = average of effective scores over `COMPLETED` replies in the window, by **`sent_at` in IST**.
- Counts shown next to the score: Pending, Failed, Skipped, Unattributed. Failed replies are never silently dropped from view.
- Team view uses `team_id_at_send`, so moving an agent later does not rewrite history.
- Roles as in the original spec (agent, team lead, QA).

## 7. Invariants and what enforces them

| Invariant | Enforcement |
|---|---|
| One message yields one evaluation row | `PRIMARY KEY (message_id)` plus `ON CONFLICT DO NOTHING` |
| Never two evaluations in flight for one reply | `FOR UPDATE SKIP LOCKED` plus lease |
| A stale worker cannot overwrite a newer result | fenced write on `locked_at` |
| A reply is scored for the person who sent it | sender-name match, never `human_agent_info` |
| AI replies and notes are never scored | skip rules at ingest |
| Context never includes anything after the reply | `sent_at` filter in context query |
| QA overrides survive re-runs | re-run never writes `override_*` |
| Every score change is traceable | append-only `email_reply_score_events` |
| A reply is never lost because the ticket row is missing | stub creation, no FK |
| Redelivered or late events do not regress state | per-field `*_event_at` guard, `message_id` key |
| The evaluator cannot move the SLA clock | evaluator never writes `email_conversations` |
| One open dispute per reply | partial unique index |
| Alerts fire once, only after commit | claim-then-send, `alert_sent_at` |
| Merges leave history and attribution unchanged | scores keyed by `message_id` and `agent_id`, not by ticket |

## 8. Rollout

1. **P0, independent value:** fix ingest rules 1 to 3, 5 (capture), 8. Add `STATUS_CHANGED` and the merge flag.
2. **P1:** migration 027 plus backfill from `robylon_webhook_payloads`.
3. **P2:** evaluator plus rubric, running silently (no dashboards).
4. **P3:** compliance Slack alert.
5. **P4:** portal views, then QA override, then disputes.

## 9. Open decisions

| ID | Question | Recommended default |
|---|---|---|
| D1 | Can a QA override or dispute change a closed month's score? (a) yes, always logged, or (b) lock after N days and treat later changes as an adjustment in the current month | (a) to start |
| D2 | Should the 24h SLA clock pause in "External Dependency", "Internal Dependency" or "Hold"? | out of scope here; flag to the SLA owner |
| D3 | AI-reply timeline not yet seen (the ticket you ran had no AI reply). Run the timeline query on chat 158373 to confirm the AI event pattern. | proceed with the skip rule |
| D4 | RESOLVED. The flag appears on the absorbed ticket about 60% of the time, with no survivor ID. | display-only flag; no merge linking; do not exclude from SLA alerts |
| D5 | Rubric parameters, weights and the list of severe compliance items | the DRAFT table above |
| D6 | RESOLVED. All 24 senders match `agents.name` exactly once. | lookup-only; unmatched senders listed for an admin to map |
| D8 | The two agents with no disclaimer (71 replies in 7 days): fix the signature template first, or score them from day one? | fix the signatures and tell their TL before go-live |
| D7 | Dispute roles and routing (assumed to copy the chat flow) | confirm |
