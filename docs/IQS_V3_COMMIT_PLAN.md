# IQS v3 Rollout — Commit-by-Commit Guide

This guide turns the IQS v3 change list into simple, ordered steps. Each step tells you
**what to change, which files to touch, how to check your work, and what commit message
to use**. Work through the steps in order — later steps depend on earlier ones.

## Ground rules (read once before starting)

1. **Work on a feature branch**, never directly on `main`. One branch per phase is fine
   (for example `feat/iqs-v3-p0-fixes`, `feat/iqs-v3-engine`, and so on).
2. **One change = one commit.** Do not mix two unrelated changes in the same commit.
   Small commits are easy to review and easy to revert.
3. **Before every commit**, run the project checks: `npm run lint` and `npm run build`
   (or `npx tsc --noEmit` for a quick type check). Only commit when they pass.
4. **Commit message format**: a short first line saying what changed and why, for example
   `fix(iqs-v3): allow NA in both output schemas`. Use the messages suggested below.
5. **Do not push a step until its "Check" instruction passes.**
6. Step 0 and Step 9 are not code commits — read them anyway, they gate everything else.

---

## Phase 0 — Setup

### Step 0: Put the v3 prompt/helper file into the repo

The v3 evaluator (two rubrics, prompt builders, `prepTranscript`, `detectChannel`,
`parseAndScore`, `computeIQS`) currently lives outside the repo as a handoff file.

- **Do**: Copy it into the repo as a new file, for example `lib/scoring/iqs-v3.ts`.
  Add it exactly as handed off — do **not** fix anything in it yet. The fixes are
  Steps 1–8, each as its own commit, so every fix is reviewable on its own.
- **Check**: The project still builds. The new file compiles (it does not need to be
  wired into anything yet).
- **Commit message**: `feat(iqs-v3): add v3 evaluator prompt/helper file (unmodified handoff)`

---

## Phase 1 — P0 fixes inside the v3 file (do these first, they block correctness)

All of these edit only the file added in Step 0 (plus one small touch elsewhere in
Steps 6–7). One commit each.

### Step 1: Allow "NA" everywhere in both output schemas

- **Problem**: The rules tell the model to answer "NA" on any dimension (empty chats,
  unsure cases), but the JSON schemas only allow "NA" on a few conditional dimensions.
  The model will either invent a score or produce invalid JSON.
- **Do**: In both the HUMAN output schema and the BOT output schema, add `"NA"` as an
  allowed value for **every** parameter's score, not just the conditional ones.
- **Check**: Read through both schemas and confirm every single parameter accepts
  `0`, `0.5`, `1`, and `"NA"`.
- **Commit message**: `fix(iqs-v3): allow NA on every parameter in both output schemas`

### Step 2: Fix the contradiction about misleading errors

- **Problem**: The compliance section says a misleading chat error "also lowers
  Accuracy", but the Accuracy rubric says those errors go "to the compliance flag,
  not here". The two statements fight each other.
- **Do**: In the HUMAN Accuracy rubric and the BOT Accuracy rubric, change the wording
  so it says the error "…also raises the compliance flag" (instead of lowering Accuracy).
- **Check**: Search the file for "misleading" and confirm all mentions now agree with
  each other.
- **Commit message**: `fix(iqs-v3): resolve misleading-error contradiction between compliance and Accuracy rubrics`

### Step 3: Soften the Type 2 scenario wording

- **Problem**: The Type 2 scenario line says "No voice call took place." That can be
  false — a call may exist but not be transcribed yet, so the prompt would lie.
- **Do**: In the scenario line builder, change the text to: "no call transcript is
  available; if the chat clearly references a call, mark affected dimensions unsure".
- **Check**: The old sentence "No voice call took place" no longer appears anywhere.
- **Commit message**: `fix(iqs-v3): soften Type 2 wording to "no call transcript available"`

### Step 4: Remove hardcoded policy facts from the BOT Accuracy rubric

- **Problem**: The BOT Accuracy rubric hardcodes specific policy facts (T+3/T+1
  timelines, Form 121). Ops can edit the policy block, but the rubric would keep
  asserting the old, stale facts.
- **Do**: Delete the specific facts from the BOT Accuracy rubric text and replace them
  with a pointer like "check against the WINT POLICY FACTS above".
- **Check**: Search the file for "T+3", "T+1", and "Form 121" — they should only appear
  inside the ops-editable policy block, not in any rubric text.
- **Commit message**: `fix(iqs-v3): point BOT Accuracy rubric at policy block instead of hardcoded facts`

### Step 5: Fix the stale header comment about EscalationDecision

- **Problem**: The file header comment says "EscalationDecision = 0 (flag only)", but
  the real weight is 5 and it is both scored and flagged.
- **Do**: Update the header comment to match reality.
- **Check**: Header comment matches the actual weights table in the file.
- **Commit message**: `docs(iqs-v3): fix stale header comment on EscalationDecision weight`

### Step 6: Stop `prepTranscript` from silently deleting repeated lines

- **Problem**: The transcript cleaner removes repeated identical lines. But repeated
  lines are exactly the evidence needed to score "NoRepetition" and to spot a customer
  restating a grievance (a dissatisfaction trigger).
- **Do**: Instead of dropping repeats, replace them with a visible marker like
  `[message repeated 2 more times]`. Add one line to SHARED_RULES explaining what
  the marker means so the model understands it.
- **Check**: Feed a test transcript with 3 identical messages through `prepTranscript`
  and confirm the output shows the marker instead of losing the messages.
- **Commit message**: `fix(iqs-v3): mark repeated transcript lines instead of deleting them`

### Step 7: Harden `parseAndScore` and `computeIQS`

- **Problem** (three parts): (a) the parser trusts the model's self-reported channel;
  (b) a parameter marked `unsure: true` but carrying a number still counts toward the
  score; (c) if the model wraps its JSON in extra text, parsing fails.
- **Do**:
  1. Give `parseAndScore` a `channel` argument and use it — ignore whatever channel
     the model claims in its output. The caller passes the channel determined in code.
  2. In `computeIQS`, treat any parameter with `unsure: true` as "NA" (skip it),
     even if it has a numeric score.
  3. Copy the brace-extraction JSON fallback from `robustJsonParse` in
     `lib/scoring/call-pipeline.ts` so the parser can dig JSON out of a messy response.
- **Check**: Test with (a) a response claiming the wrong channel, (b) a response with
  `unsure: true` plus a score, and (c) a response with prose around the JSON. All three
  should be handled correctly.
- **Commit message**: `fix(iqs-v3): harden parseAndScore (trusted channel, unsure=NA, robust JSON extraction)`

### Step 8: Make caller-supplied channel the primary path in `detectChannel`

- **Problem**: `detectChannel` matches sender names exactly (fragile) and expects JSON
  while the rest of the pipeline works on plain text.
- **Do**: Change the function (and its callers) so a channel value supplied by the
  caller — computed from structured message data — is always used when available.
  Name-based detection stays only as a last-resort fallback.
- **Check**: Calling with an explicit channel never runs the name-matching logic.
- **Commit message**: `fix(iqs-v3): make caller-supplied channel primary, name detection fallback only`

### Step 9: Get written sign-off on the WhatsApp document rule (NOT a code commit)

- **Problem**: The v3 rules allow sending non-personal documents over WhatsApp.
  Production policy in `lib/quality.ts` says documents go ONLY via email, never
  WhatsApp. These directly contradict each other.
- **Do**: Do not change any code. Send the question to the compliance/policy owner and
  get a **written** answer before v3 goes live. If policy changes, update whichever
  side is wrong in a separate commit with the sign-off referenced in the message.
- **Check**: A written confirmation exists (email or ticket link) before Phase 5.

---

## Phase 2 — Architecture decision + scoring engine (P1)

### Step 10: Decide how Type 2 chats get upgraded to Type 3 (decision, then a small commit)

- **Problem**: Chats are scored the moment they close, but call transcription finishes
  later. Scenario selection needs to know about the call transcript.
- **Do**: Get the team to pick a strategy. Recommended: **score immediately as Type 2,
  then automatically re-score as Type 3 when the linked call transcript arrives**
  (triggered from the webhook / unified-score paths). Once decided, write the decision
  down in a short doc or code comment and commit it, so later steps can reference it.
- **Check**: The decision is written somewhere in the repo, not just in chat.
- **Commit message**: `docs(iqs-v3): record Type 2 → Type 3 re-scoring strategy decision`

### Step 11: Determine the channel in code, before building the prompt

- **Do**: In `lib/scoring/engine.ts`, work out whether the chat was handled by a bot or
  a human by reading the sender metadata (`sender_type` / `sender_name`) from the
  messages/conversations tables. Pass that channel value explicitly into the prompt
  builder and into the parser (from Step 7).
- **Check**: Score a known bot chat and a known human chat; each picks the right rubric
  without relying on the model's guess.
- **Commit message**: `feat(iqs-v3): determine channel from message metadata in the engine`

### Step 12: Swap in the two v3 system prompts

- **Do**: In `lib/quality.ts`, replace the single `IQS_SYSTEM_PROMPT` with the two v3
  system prompts (human and bot), plus a builder that injects the ops-editable policy
  block wherever `{{WINT_POLICY}}` appears.
- **Check**: Build both prompts in a test; the placeholder is replaced and no old
  prompt text remains.
- **Commit message**: `feat(iqs-v3): replace single system prompt with human/bot v3 prompts + policy injection`

### Step 13: Build the new user message

- **Do**: In `lib/quality.ts`, write the new user-message builder containing: the
  scenario line, the scoring date, the knowledge-base block, the full transcript
  (through `prepTranscript`), and — when a call is linked — a CALL TRANSCRIPT context
  block. Delete the old `buildScoringPrompt(transcript, tags, chatId, slackThread, …)`
  signature.
- **Check**: No callers of the old signature remain (`grep buildScoringPrompt` across
  the repo).
- **Commit message**: `feat(iqs-v3): new user-message builder; retire old buildScoringPrompt`

### Step 14: Write the new response parser

- **Do**: Replace `parseScoringResponse` with a parser that reads, per parameter,
  `{score: 0|0.5|1|"NA", unsure, comment}`, plus the top-level fields:
  `compliance.breaches[]`, `needs_review`, `review_parameters`,
  `dissatisfaction_triggered`, `trigger_signal`, `kbCitation`, `agentName`. Derive
  `escalation_flag` and `missing_recap_flag` in code from the parsed data.
- **Check**: Unit-test the parser with a full valid v3 response for each channel.
- **Commit message**: `feat(iqs-v3): new response parser for v3 output shape`

### Step 15: Compute the IQS score in code, never trust the model's number

- **Do**: Add `HUMAN_WEIGHTS` and `BOT_WEIGHTS` tables and a `computeIQS` function that
  skips NA parameters from both the top and the bottom of the weighted average. Add a
  guard: if the total weight of applicable parameters is very low (for example under
  20), return `null` (or a low-confidence marker) instead of a score, so a chat with
  only 2 scoreable dimensions can't swing between 0 and 100.
- **Check**: Unit tests: all-1 scores → 100; all-NA → null; a mix with NA excluded
  correctly; a low-weight case returning null.
- **Commit message**: `feat(iqs-v3): code-computed IQS with NA exclusion and minimum-weight guard`

### Step 16: Stop cutting transcripts at 5,000 characters

- **Do**: In `app/api/call-quality/unified-score/route.ts`, remove the 5,000-character
  trim. Use the full-transcript preparation instead (about a 40,000-character cap, with
  a visible marker where the middle was cut, if it ever is).
- **Check**: A long transcript goes through whole; a very long one shows the middle-cut
  marker instead of a silent chop.
- **Commit message**: `fix(iqs-v3): full transcript in unified-score path, no 5k trim`

---

## Phase 3 — Database migration (P2)

### Step 17 + 18: One migration commit covering both items

These two belong in the **same commit** because they touch the same migration file.

- **Do**: Create a new file in `db/migrations/` (next number in sequence) that updates
  `iqs_scores`:
  - New `parameters` JSONB shape (new parameter names; each entry holds a numeric or
    "NA" score, an `unsure` flag, and a comment).
  - New columns: `channel`, `scenario`, `compliance` (JSONB), `compliance_flag`
    (boolean, so it's easy to query), `needs_review` (boolean), `review_parameters`
    (JSONB), `dissatisfaction_triggered`, `trigger_signal`, `escalation_flag`,
    `missing_recap_flag`, `kb_citation`.
  - A **`score_version`** column so old v1 rows and new v3 rows can be told apart
    forever.
  - Make `iqs_score` **nullable** (it is currently `SMALLINT NOT NULL CHECK 0–100`),
    because v3 legitimately produces no score for empty or all-NA chats. Keep the
    0–100 check for non-null values.
- **Then**: Go through every place that reads `iqs_score` and make sure a null value
  doesn't crash it (rendering, averages, sorting). Those consumer fixes can be a
  second commit if they are large.
- **Check**: Run the migration on a dev database with `scripts/apply-migration.mjs`;
  insert a v3-shaped row including a null score; confirm nothing errors.
- **Commit message**: `feat(iqs-v3): iqs_scores migration — v3 columns, score_version, nullable score`

---

## Phase 4 — Routes and jobs (P2)

### Step 19: Update the main scoring path

- **Do**: In `app/api/webhooks/chat/route.ts`: determine channel and scenario in code,
  inject the call-transcript context when available, use the new parser, and persist
  using the new columns from Step 17. While here, raise the knowledge-base retrieval
  `topK` from 5 to about 12 (Accuracy carries weight 20 and depends on KB grounding).
- **Check**: End-to-end test — a webhook close produces a v3 row in the database with
  the correct channel, scenario, and `score_version`.
- **Commit message**: `feat(iqs-v3): v3 scoring on chat webhook path; KB topK 5→12`

### Step 20: Update the manual re-score path

- **Do**: Apply the same changes to `app/api/call-quality/unified-score/route.ts`.
  Under the recommended strategy from Step 10, this route also becomes the trigger
  that upgrades a Type 2 score to Type 3 when a call transcript lands.
- **Check**: Re-scoring a chat that now has a call transcript produces a Type 3 score
  replacing the Type 2 one.
- **Commit message**: `feat(iqs-v3): v3 scoring + Type 3 upgrade on unified-score path`

### Step 21: Rename the old parameters everywhere

- **Do**: Find every reference to the old parameter names — Technical, AllQuestions,
  Contextual, FollowUp, Sentences, Opening, Call, Grammar, Empathy, Process — and
  update to the new v3 names. Known places: `app/api/corrections/apply`,
  `app/api/quality/score`, and the backfill/rerun scripts in `scripts/`.
- **Check**: `grep` the repo for each old name; zero hits outside migrations and
  historical-data handling.
- **Commit message**: `refactor(iqs-v3): replace old parameter names with v3 names across routes and scripts`

### Step 22: Feed unsure dimensions into the QA review queue

- **Do**: When a score comes back with `needs_review = true`, put it into the existing
  QA pending-review flow (the migration 009 `reviewed_at` flow), and pass
  `review_parameters` through so QA opens exactly the dimensions the model was unsure
  about.
- **Check**: Score a chat that triggers unsure; it appears in the QA queue showing only
  the unsure dimensions.
- **Commit message**: `feat(iqs-v3): route needs_review scores into QA pending-review queue`

---

## Phase 5 — UI (P2)

### Step 23: Update score rendering

- **Do**: In `ScoreBadge` and `EvalPanel`, replace the Yes/No/NA badges with
  0 / 0.5 / 1 / NA, and add a visible "unsure — needs QA" state.
- **Check**: All five states render correctly in the panel.
- **Commit message**: `feat(iqs-v3): score badges show 0/0.5/1/NA and unsure state`

### Step 24: Branch the parameter list by channel

- **Do**: In `EvalPanel` and the quality tables, show the 10 human dimensions for
  human-handled chats and the 7 bot dimensions for bot chats, with the right names
  for each.
- **Check**: Open one human-scored chat and one bot-scored chat; each shows its own
  dimension list.
- **Commit message**: `feat(iqs-v3): channel-specific parameter lists in EvalPanel`

### Step 25: Show the new v3 signals

- **Do**: Add to `EvalPanel`: the compliance breaches list (each entry with its type,
  the exact quote, and a note — there can be several), the escalation flag, the
  missing-recap flag, and the dissatisfaction trigger signal.
- **Check**: A test row containing all of these renders each one.
- **Commit message**: `feat(iqs-v3): surface compliance breaches, escalation, recap and dissatisfaction signals`

### Step 26: Make the dispute flow channel-aware

- **Do**: The dispute flow validates parameter names in `iqs_flags.challenged_params`.
  Change the allowed set to depend on the chat's channel (human names for human chats,
  bot names for bot chats), in both the UI and the API.
- **Check**: Disputing a bot parameter on a human chat is rejected; the right list is
  offered in the UI.
- **Commit message**: `feat(iqs-v3): channel-dependent parameter validation in dispute flow`

---

## Phase 6 — Analytics & config (P3)

### Step 27: Make aggregations handle both score versions

- **Do**: Every per-parameter aggregation (`team-avg`, `my-analytics`, TL member
  analytics, QA analytics under `app/api/quality/*` and `app/api/cx/*`) must either
  filter to one `score_version` or branch on it, so v1 rows and v3 rows are never
  averaged together.
- **Check**: With mixed v1/v3 data in dev, each analytics endpoint returns sensible
  numbers and never mixes versions in one average.
- **Commit message**: `fix(iqs-v3): analytics aggregate per score_version, never mixed`

### Step 28: Keep bot chats out of agent leaderboards

- **Do**: Bot-only chats now get scores but have no agent. Exclude them from agent
  leaderboards and agent averages. Optionally add a separate bot-quality view.
- **Check**: A bot-scored chat does not move any agent's average.
- **Commit message**: `fix(iqs-v3): exclude bot-only chats from agent leaderboards`

### Step 29: Mark the cutover date on trend charts

- **Do**: Add a visible annotation on trend dashboards at the v3 cutover date, because
  v3 numbers are not comparable to v1 (graded 0.5s, NA handling, new weights).
- **Check**: The annotation shows on the trend views.
- **Commit message**: `feat(iqs-v3): annotate v3 cutover date on trend dashboards`

### Step 30: Make the policy block editable by ops

- **Do**: Add a field (for example `wintPolicyPrompt`) to `PortalConfig` in
  `lib/config.ts`, plus a textarea in `SettingsClient`. This text is what gets
  injected at `{{WINT_POLICY}}` (Step 12). Important: this is deterministic injection
  into the prompt — it is **not** part of the RAG retrieval pool.
- **Check**: Edit the policy text in Settings, score a chat, confirm the new text
  appears in the built prompt.
- **Commit message**: `feat(iqs-v3): ops-editable Wint policy block in settings`

### Step 31: Retire or split the single prompt override

- **Do**: The single `iqsScoringPrompt` override can't cover two rubrics. Either split
  it into two override fields (human/bot) or remove it and keep only the policy-block
  override from Step 30. Pick one, update config and Settings accordingly.
- **Check**: No code path still reads the old single override.
- **Commit message**: `refactor(iqs-v3): retire single iqsScoringPrompt override` (or `split into human/bot overrides`)

---

## Phase 7 — RAG improvements (P3, already detailed in docs/RAG_OPTIMIZATION.md)

### Step 32: Bigger chunks + new cache key (one commit)

- **Do**: In `lib/drive.ts`, change the chunk size from 600 to 1,100 characters. In
  `lib/store.ts`, bump the cache key to `wint_kb_cache_v3` so the old cache is not
  reused. These must ship together — do them in the same commit.
- **Check**: After deploy, the KB re-indexes with the new chunk size.
- **Commit message**: `feat(rag): 1100-char chunks + cache key bump to wint_kb_cache_v3`

### Step 33: Expand the retrieval query

- **Do**: In the webhook and unified-score paths, stop querying the KB with just the
  raw disposition tag. Reuse `expandQuery()` (or the category keyword expansion) so
  retrieval sees a richer query.
- **Check**: For a sample chat, the retrieved KB chunks are visibly more relevant than
  before.
- **Commit message**: `feat(rag): expand IQS retrieval query beyond raw disposition tag`

---

## Before flipping the switch (no commits, just discipline)

1. **Shadow run**: score 100–200 recent chats with both v1 and v3. Compare the score
   distributions and have QA spot-check the biggest disagreements.
2. **Re-baseline thresholds**: any alert or "meets expectations" cutoff tied to score
   bands must be recalculated for v3's distribution.
3. **Never touch historical rows**: old rows keep `score_version = 1`. Do not re-score
   history unless the team deliberately decides to.
4. **Keep CSAT separate**: confirm no code path combines CSAT with IQS — the v3 design
   forbids fusing them.

## Order and rough effort

Phase 1 (½ day) → Step 10 decision → Steps 11–16 (2–3 days) → Steps 17–18 (½ day) →
Steps 19–22 (1–2 days) → shadow run → Steps 23–26 (1–2 days) → Steps 27–31 → Steps 32–33.
