# Weekly IR Quality Scorecard — Build Requirements (Team Handoff)

**Status:** Feasibility confirmed against the live codebase. Ready to build.
**Repo:** `wint-ir-portal` (Next.js 16 App Router, Postgres via raw `pg`, deployed on Vercel).
**One-line goal:** An automated weekly quality report — one Google Doc per IR person — generated from already-scored chat data, shared with that person + their TL, showing where quality dipped that week and what to do about it.

> This document is the single source of truth for the build. Where it says **MUST**, getting it wrong produces a wrong or unfair report — do not deviate without sign-off. Every file path, table, and column below was verified in the current repo.

---

## 0. Ground rules (do not violate)

- **Read-only on scoring.** Every chat is already scored. This job **only reads, aggregates, and synthesises. It NEVER re-scores.** The authoritative score is `iqs_scores.parameters.__scores.agent_iqs`.
- **No new infrastructure.** Reuse the existing Vercel cron, Google service account, Anthropic (Haiku) SDK, and Slack integration. The only net-new code is Google Docs *write* helpers (§7).
- **The word "Agent" MUST NEVER appear** in any report output. Use the person's name throughout. Source `reasoning` text uses "agent" — strip it on pass-through.
- **Judge the human leg only.** Chats are hybrid (bot + human). Use `__agent_parameters` / `agent_iqs`. **Ignore `__bot_parameters` / `bot_iqs` entirely.**
- **Scope v1:** chats only (calls out of scope). One person per report.

---

## 1. Data source (production)

Postgres, raw `pg`, hand-written SQL. Helpers: `lib/cx/db.ts` (`query()`), `lib/robylon/db.ts`. **No ORM.**

**Tables:**
- `conversations` — one row per closed chat. PK `id` = chat_id. Columns used: `agent_id` (→ `agents.id`), `closed_at`, `conversation_type`, `csat_score`, `csat_label`, `disposition`, `sub_disposition`, `frt_seconds` (INTEGER, nullable), `resolution_seconds` (**INTEGER, confirmed numeric** — the CSV parse issue was a CSV artifact only), `transcript` (JSONB).
- `iqs_scores` — one row per scored chat. PK `chat_id` (→ `conversations.id`). Columns used: `iqs_score` (SMALLINT 0–100), `parameters` (JSONB — the `__`-structure, see §2), `model_version`, and QA-review columns `reviewed_by`, `reviewed_at`, `review_note`, `status` (see §5).
- `agents` — `id`, `name` (the person's name), `team_id`, and **`tl_name`** / `qa_name` (denormalized strings; TL mapping lives here).
- `iqs_flags` — disputes/overrides table (`status`, `reviewed_by`, `review_note`, `challenged_params`). Used for override detection (§5).

**Person identity (critical):** the CSV has no person column. In production, key every query on **`conversations.agent_id`**, and get the display name from **`agents.name`**. The report for a person = all their chats in the week window (`closed_at` within the week), joined `conversations.agent_id = agents.id`.

**⚠️ Pre-build confirmation against the live DB (5 minutes):** the `agents.tl_name` column and the `iqs_scores.status` column were added out-of-band (by scripts, not numbered migrations). Confirm they exist and are populated before go-live.

---

## 2. The stored JSON (`iqs_scores.parameters`)

Written by `insertIQSScore` (`lib/robylon/db.ts`). Top-level keys:
- `__scores`: `{ agent_iqs, bot_iqs }` — **use `agent_iqs` ONLY.**
- `__breaches`: list of compliance flags (e.g. `data_handling`). Can be empty.
- `__answerChanges`: currently `undefined: undefined` — **treat as empty, ignore.**
- `__agent_parameters`: the 10 human-leg params. Each cell = `{ score, reasoning }`.
- `__bot_parameters`, `__bot_model_version` — **ignore.**

**Param cell score is stored as `true` (=1.0), `false` (=0.0), `0.5`, or `null` (not applicable).**

---

## 3. The score computation (already authoritative — for methodology text + reproduction)

Engine: `computeIQS` in `lib/scoring/prompt_v4.ts`. **Do not reimplement the math loosely — restate it exactly if you print methodology.**

```
10 human parameters, each score in {1, 0.5, 0, NA}, stored true/false/0.5/null.

WEIGHTS (points):
  IssueResolution 25, Accuracy 20, ExpectationFollowThrough 20,
  DissatisfactionHandling 10, Personalization 10, Empathy 5,
  EscalationDecision 5, Readability 3, GreetingHandover 2, PostCallRecap 5
  (sum = 105; the denominator is NOT fixed to 100)

normalise: true/1 -> 1.0 ; 0.5 -> 0.5 ; false/0 -> 0.0 ; NA/null/absent -> EXCLUDE from num AND den
num = sum(weight * score) over included params
den = sum(weight) over included params
agent_iqs = round(num/den * 100), or null if den == 0

POST-AVERAGE: NONE. No breach cap, no critical-parameter ceiling, no penalty, no floor.
Breaches / escalation / answer-changes are visibility-only and NEVER change the score.
```

For AI-scored, never-reviewed chats the score is fully reproducible from `__agent_parameters`. For QA-overridden chats it is NOT (see §5) — the report MUST NOT try to derive those from params.

### 3.1 ⚠️ Parameter-key spelling (MUST use the existing reader)

Older chats stored 5 params with a no-underscore spelling (`escalationdecision`), newer chats use snake_case (`escalation_decision`). **The write-time fix landed 2026-07-25 (deployed ~27 Jul), so chats after that cutoff are clean.** Older rows were NOT rewritten — a translator reads both.

**MUST:** every query/read of params goes through the existing dialect-tolerant helpers — `resolveParamCell` / `ALL_DB_KEY_TO_PASCAL` (`lib/param-keys.ts`) and the `COALESCE` templates in `lib/analytics/templates.ts`. **NEVER** read `parameters->'escalation_decision'` directly, or pre-cutoff chats are silently dropped.

---

## 4. Selection logic (three INDEPENDENT selectors — do not merge)

Keyed by `chat_id` everywhere (also the shareable-link key).

1. **Review set:** every chat with `agent_iqs < 85`.
2. **Breach set:** every chat with a non-empty `__breaches`, **regardless of score.** MUST be independent — a breach on a score-100 chat MUST still surface. **NEVER gate breaches behind the 85 threshold.**
3. **Override flag ("score adjusted by QA"):** any chat where `review_note` is non-empty OR `reviewed_by` is set OR an `iqs_flags` row exists OR stored `iqs_score` ≠ `__scores.agent_iqs`. These are flagged, and their score is **NOT** reconstructed from visible params.

**Confirmed product decision:** **KEEP** `Junk Chats` and `Calls_Directly` dispositions IN the review set (do not exclude).

---

## 5. QA-override handling (real bug — must handle even if 0 in current data)

The QA override tool records only pass/fail/NA — it cannot store 0.5. So if a reviewer touches a param the AI scored 0.5, it collapses and the stored score no longer matches the visible params. **Handling:** the override flag (§4.3) tags these "score adjusted by QA"; the report shows the stored score and does NOT derive it from params. In current data this never fires, but the logic MUST exist.

---

## 6. Report layout — one Doc per person, weekly dated subsection appended

Five sections. Sections 1, 2, 4, 5 are **deterministic SQL, no LLM.** Section 3 is the **only** LLM part.

**Section 1 — The numbers [SQL]**
- Chats handled (count).
- Average score = mean of `agent_iqs` across all their chats that week.
- Chats below 85 (= review-set size).
- CSAT: **good / total-rated**, shown as "X% positive (G of T rated good)". **Neutral (score 3) counts in the DENOMINATOR only, never the numerator.** If 0 rated → "no ratings this week".
- Compliance breaches this week (count, links to Section 4).
- Scores adjusted by QA review (count).
- FRT: `frt_seconds` is null on ~12–15% of chats. If shown, **footnote it as computed on the rated subset — never silently average over nulls.** (Open decision §9.)

**Section 2 — What went well [SQL]**
One short plain-language line naming the person's 2–3 highest-passing parameters across the **full week** (not just the review set), from param pass-rates. Required — a promotion-linked report cannot be all failures.

**Section 3 — Discussion points for the 1-on-1 [LLM — see §8] ⚠️**
Grouped coaching themes across the review set (no hard cap; group so one issue = one theme with several example chats). Each theme: the pattern in plain behavioural language; backing `chat_ids` (2–4, all from the review set); why it matters (tied to rubric weight); an **Actionable:** line (specific behaviour, not a character judgement). Ranking = (# chats showing the theme) × (highest rubric weight among its failing params). Any theme rooted in a breach or critical-failure bucket pins to the top.

**Section 4 — Compliance breaches, needs TL review [SQL] ⚠️ HIGH PRIORITY**
Every breach chat: `chat_id`, score, flagged content in one line. Framed as **"flagged for a human to check, not proven violations"** (the classifier over-fires on normal file-sharing — Slack links, TDS summaries). **Explicitly note when a breach chat scored well**, so it's clear why it's surfaced separately.

**Section 5 — Full evidence list [SQL]**
Table of every review-set chat, **worst first**: `chat_id` (clickable link), score, topic (`disposition`), one-line main issue. The lookup layer so every Section 3 claim is checkable in one click.

---

## 7. Google Docs render (the only net-new code)

Current state: `lib/gdocs.ts` uses the Google service account (`GOOGLE_SERVICE_ACCOUNT_JSON`, `documents` + `spreadsheets` scopes) but only does `replaceAllText` on an existing Doc. There is **no** create / insert-append / share code, and `lib/drive.ts` is read-only scoped.

Add write helpers to `lib/gdocs.ts` using the already-installed `googleapis` client + same credential (no new infra/secrets). **Pick ONE delivery model (open decision §9):**

- **Option A — Pre-created shared Docs (simplest, recommended to ship first).** A human creates one Doc per person, shares with person + TL, grants the service-account email Editor. Job only *appends* a dated section via `documents.batchUpdate` `insertText`. Needs only the `documents` scope already granted.
- **Option B — Fully automatic.** Job creates the Doc (`documents.create`) and shares it (`drive.permissions.create`) itself. Requires broadening the service account's Drive scope to writable + extra code. Same credential, no new infra.

Output: append a dated subsection to the person's Doc. One persistent Doc per person; IR oversight has access to all.

---

## 8. Section-3 synthesis step (LLM — exact spec)

- **Model & SDK:** copy `callLLM` from `app/api/quality/my-analytics/ai/route.ts`. `@anthropic-ai/sdk`, model **`claude-haiku-4-5-20251001`**, `client.messages.create`. Key resolution: `config.iqsAnthropicApiKey || config.anthropicApiKey || process.env.ANTHROPIC_API_KEY`. **One call per person per week.**
- **Input:** the review-set chats, each as `chat_id` + score + **only the failing/half params** with their `{score, reasoning}` (drop passing params), disposition, breach flags. Plus rubric weights. Plus **per-parameter failure counts precomputed in SQL** (do the COUNTING in SQL, not the LLM — that's where LLMs drift).
- **Instructions to the model:** cluster into themes; cite ONLY `chat_ids` from the input set; never invent a `chat_id` or a score; rank by the impact formula (§6 Section 3); write each Actionable as specific behaviour; output strict JSON.
- **⚠️ Anti-hallucination validation (MANDATORY):**
  ```
  allowedIds = set(inputChats.chat_id)
  citedIds   = flatten(themes[].chat_ids)
  invented   = [id for id in citedIds if id not in allowedIds]
  if invented: retry once with a corrective note
  if it fails twice: HOLD for human review, DO NOT SEND
  ```
- **Strip the word "agent"** from any reasoning text pulled through.

---

## 9. Open decisions needing a human answer before/at build

1. **Doc delivery:** Option A (pre-created shared) or Option B (fully automatic)? — Recommend A to ship, B later.
2. **FRT in header:** keep as a footnoted subset figure, or drop it? — either is fine; must not average over nulls.
3. **Neutral CSAT:** confirm neutral (score 3) counts in the denominator only. (Assumed yes.)
4. **Live-DB confirm:** `agents.tl_name` populated, `iqs_scores.status` exists (§1).

(Resolved already: non-coachable dispositions KEPT IN; person identity = `conversations.agent_id`→`agents.name`; TL = `agents.tl_name`; param-drift handled by existing reader; `resolution_seconds` numeric; override detection via `review_note`/`reviewed_by`/`iqs_flags`/score-mismatch.)

---

## 10. Delivery & automation

- **Trigger:** new weekly Vercel cron in `vercel.json` (e.g. `0 6 * * 1`). Reuse the existing cron-auth pattern (`x-vercel-cron` header / `CRON_SECRET`). New route: `app/api/cron/weekly-scorecard/route.ts`.
- **Per person:** run selection (§4) → precompute counts + header numbers (SQL) → one synthesis call (§8) + validation → render Doc section (§7). **Batch/limit like existing crons** to respect the Vercel function timeout.
- **Failure path:** if a person's synthesis fails validation twice, **skip that person, post a note to Slack** (`lib/slack.ts` → `sendSlackMessage`; env `SLACK_BOT_TOKEN` + `QUALITY_SLACK_CHANNEL`), **do not block the batch.**

## 11. Files to touch / reuse

- **New:** `app/api/cron/weekly-scorecard/route.ts`; one line in `vercel.json`.
- **Extend:** `lib/gdocs.ts` (append via `insertText`; + create/share for Option B).
- **Reuse (do not rebuild):** `lib/cx/db.ts` / `lib/robylon/db.ts` (SQL), `lib/param-keys.ts` + `lib/analytics/templates.ts` (dialect-safe param reads — MANDATORY), `app/api/quality/my-analytics/ai/route.ts` (`callLLM` pattern), `lib/slack.ts` (failure path), `lib/config.ts` (keys), `lib/scoring/prompt_v4.ts` (weights / methodology, read-only).

---

## 12. Acceptance test (must pass before rollout)

Run the new cron route against the dev DB for person **"Dhanush", week 30 Jul – 5 Aug 2026**, and match the approved sample:
- Section 1: **41 chats, avg 84.1, 10 below 85, CSAT 85% positive (11 of 13 good), 4 breaches, 0 QA adjustments.**
- Section 3: **≈4 themes**, dominated by **"chats closed before the customer's real question is answered" (8 of 10 low chats).**
- Section 4: **4 `data_handling` breaches, one on a score-100 chat** (surfaced separately, noted as high-scoring).
- Validation loop: plant a bogus `chat_id` in a synthesis response and confirm it triggers the retry, then the hold-for-human path.

## 13. Cost & rollout

- **Cost:** one Haiku call/person/week over precomputed stats ≈ a fraction of a cent/person/week. Negligible at 50+ people.
- **Rollout (phased):** **Shadow** (Doc shared with TL/IR only) → **Pilot** one team → **Full**.

---

### Feasibility verdict
Buildable end-to-end on existing cron + Google service account + Haiku + Slack. The only net-new code is Google Docs write/append (+ share for Option B), using the already-installed library and existing credential — **no new infrastructure, packages, or secrets.**
