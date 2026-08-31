# Release Branch — Code Cleanup & Optimization Review

**Date:** 2026-07-09
**Branch reviewed:** `release` @ `5452361` (verified content-identical to `main` @ `a67d989` — every release-only commit is a merge of `main` into `release`)
**Scope:** Full-codebase deep dive into code health, duplication, and performance. Two questions: (1) what cleanup/optimization work is *currently being done* in this codebase, and (2) what we *can do* next. Security context comes from `AUDIT_REPORT.md` (2026-06-22) and is revisited only where items were open.

**Codebase snapshot:** ~48,100 lines of TS/TSX across ~200 source files. Next.js 16 App Router, React 19, TypeScript (strict), PostgreSQL (`pg`), Upstash Redis REST, Gemini + Anthropic SDKs, NextAuth v4, Tailwind, Vercel. 88 API routes, ~60 client components, 12 SQL migrations. CI (lint + build) exists; **no test suite**.

---

## Part 1 — What is currently being done

Cleanup is an active, ongoing effort in this repo — not a one-off. Three distinct waves are visible in the history, and the most recent one (last two weeks) closed out the majority of the June audit and the 2026-07-07 cleanup review.

### 1.1 The cleanup/optimization program to date

| Wave | PRs | What was done |
|---|---|---|
| Phase cleanup (May–June) | #27, #29, #31 | `cleanup/phase-1-vars`, `phase-2-admin-endpoints`, `phase-3-unused-ui-cx` — unused vars, dead admin endpoints, unused CX UI removed |
| Security audit fixes | #55, #64 | Settings endpoint hardening; **all three P0s from the June audit fixed**: `POST /api/config` now requires an admin session (`app/api/config/route.ts:72-75`), and both webhooks fail **closed** when `WEBHOOK_SECRET` is unset (`app/api/webhooks/chat/route.ts:62-66`) |
| Refactor & perf wave (July) | #59, #61, #62, #63 | The large-scale structural work described below |

### 1.2 Architecture & duplication — done in the July wave

- **Scoring engine extracted out of route files** — `lib/scoring/engine.ts` (`scoreLinkedCallsForChat`, `executeScoring`, `getKbContextForScoring`) and `lib/scoring/transcript.ts` (single transcript normalizer). No file imports from `app/api/webhooks/chat/route.ts` anymore; the webhook route is down to 661 lines of typed handlers.
- **Webhook payloads are typed** — a `RobylonWebhookEvent` discriminated union (`TicketClosedEvent`, `ClassificationUpdatedEvent`, `CsatSubmittedEvent`, `CcVoiceCallCompleteEvent`, `LegacyWebhookEvent`) replaces the old `body: any` handling.
- **Shared `requireRole` guard** — `lib/api-guard.ts`, adopted by 29 route files, replacing the 14+ copy-pasted `qualityAccess()` checks.
- **Centralized shared modules** — `lib/param-keys.ts` (DB↔legacy↔Pascal key maps, used by 10 files including client components), `lib/stats.ts` (avg/CSAT/week helpers), `lib/models.ts` (`DEFAULT_GEMINI_MODEL`, `DEFAULT_CLAUDE_MODEL`), `lib/prompts.ts` (chat prompts as exported constants).
- **Logger consolidated** — legacy `lib/logger.ts` deleted; `lib/log.ts` (structured JSON lines + `withLogging` wrapper) is the single logger, and `withLogging` now wraps virtually every route.
- **Shells unified** — one `components/RoleShell.tsx` behind `QualityShell`/`TLShell`/`IRShell`.
- **KV boilerplate collapsed** — `kv_pipeline()` in `lib/store.ts` replaced ~15 hand-rolled Upstash fetch blocks.

### 1.3 Backend performance — done

- **Real pagination + SQL aggregation on the hottest endpoint.** `GET /api/quality/scores` now uses `getAllScoredConversations` with `LIMIT/OFFSET` + `COUNT(*)`, computes summary/agent stats/param fails/weekly trends via SQL aggregates (`getScoredConversationsSummary` uses `COUNT(*) FILTER`/`AVG` — `lib/robylon/db.ts:519`), fetches filter-dropdown values with a cheap `SELECT DISTINCT` (`getScoredConversationsFilterOptions`), runs the three stats queries in `Promise.all`, and sets `Cache-Control: private, max-age=30`. `team-avg` no longer fetches the full table.
- **Scores and flags migrated from Redis lists to Postgres.** `iqs_flags` reads/updates are single-row SQL (`storeUpdateIQSFlag` is now an `UPDATE ... WHERE id`, `lib/store.ts:321`); the old O(n) list scans are gone. Remaining KV lists are all `LTRIM`-capped (logs 500, audit 2000, corrections 200, skipped-calls 1000).
- **Batch inserts** — `insertCallTranscriptChunks` builds one multi-row `INSERT` (`lib/robylon/db.ts:1128`).
- **Parallel call scoring** — `Promise.allSettled` in `lib/scoring/engine.ts:165` replaced the sequential per-call loop.
- **Gemini Files API for audio** — `fetchAndTranscribeAudio` uploads once and references by URI instead of inlining base64 bodies (`lib/gemini.ts:245`), removing the 20 MB inline ceiling.
- **Analytics query layer hardened & cached** — DML keyword blocklist even inside CTEs, `BLOCKED_PATTERNS`, 30 s query timeout, 10,000-row cap, and a 5-minute Redis result cache (`lib/analytics/executor.ts`).
- **Double-write on classification removed**; `waitUntil` keeps webhook responses fast while transcription runs in the background.

### 1.4 Frontend performance — done

- **`QualityClient.tsx` split from 4,321 lines / 133 useState into a 548-line shell** with lazy-loaded tab components under `components/quality/` (PerformanceTab, ScoreLogTab, UploadTab, ReportsTab, PendingChatsTab, CallQueueTab, …), shared state in `QualityContext` (SWR-based).
- **`React.memo` on the heavy tables** (`ChatEvalTable`, `ReviewedChatsTable`, `DispositionTreeTable`).
- **`next/dynamic` for below-the-fold widgets** in `QualityClient`, `InsightsChatClient`, `AnalyticsClient`, `AgentDashboard` (charts, modals).
- **`xlsx` dynamically imported on the client** — only loads when someone clicks Export (`components/quality/helpers.tsx:212`).

### 1.5 Hygiene, reliability & process — done

- **CI pipeline** — `.github/workflows/ci.yml` runs ESLint (`--max-warnings 0`) and a production `next build` on pushes/PRs to `main` and `UAT`.
- **ESLint bans bare `console.log` in `app/api`** (`no-console` allowing only warn/error) — there are now **zero** bare `console.log` calls in API routes.
- **Dependency hygiene** — the `vercel` CLI and build-only packages were removed from `dependencies`; build tooling lives in `devDependencies`; `swr` added deliberately.
- **Concurrency safety preserved** — Redis `SET NX EX` scoring locks that fail closed, webhook event dedup with TTL, atomic call-claiming with stale-claim recovery (30-min reset), idempotent `ON CONFLICT` upserts everywhere.
- **LLM resilience** — key rotation across up to 5 keys, model fallback chains with cycle detection, dedicated IQS keys for spend separation, dual Gemini client paths now *documented* in a file-header comment explaining why the raw-fetch path exists (`lib/gemini.ts:11-22`).
- **Rate limiter warns loudly when disabled** (`lib/rate-limit.ts:13`) instead of silently allowing everything.
- **Release process** — `main` is promoted to `release` via merge PRs (#45→#65); `UAT` branch is CI-covered.

### 1.6 Verified fixed from the June audit

| Audit item | Status on release |
|---|---|
| P0 `POST /api/config` unauthenticated | ✅ Fixed — admin session guard present |
| P0 webhooks fail-open without `WEBHOOK_SECRET` | ✅ Fixed — logs an error and rejects |
| P1 `rejectUnauthorized: false` on DB TLS | ✅ Fixed |
| P1 cron fail-open | ✅ Fixed (secret checked) |
| P1 LLM-generated SQL unguarded | ✅ Substantially mitigated (DML blocklist, timeout, row cap) — see §2.6 for the residual |
| P2 orphan `transcribe-calls` cron | ✅ Fixed |
| P1 no tests | ❌ **Still open** — see §2.3 |

---

## Part 2 — What we can do

Ordered by priority: **P1** = real risk or large payoff this sprint; **P2** = planned cleanup; **P3** = opportunistic.

### 2.1 Close the last fail-open endpoint — P1 (one line)

`GET /api/cx/ticket-status` is **wide open when `CX_API_KEY` is not set** (`app/api/cx/ticket-status/route.ts:15-21` — "or open if not configured"). It exposes phone-number → chat/agent lookups. This is the exact fail-open class the P0 webhook fixes eliminated; make it fail closed the same way (reject with 401 when the env var is absent).

### 2.2 Finish the `requireRole` sweep — P1

29 route files use the shared guard, but ~21 still hand-roll `getServerSession` + inline role checks — including most of `app/api/cx/qa/*` and `app/api/cx/tl/*` (`disputes`, `wow-trend`, `analytics`, `overview`, `team-analytics`, `member-analytics`, `quality/overview`) and `app/api/call-quality/transcript`. Hand-rolled checks are where the next "forgot the guard" bug will come from. Mechanical change, low risk, and it deletes ~10 lines per route.

### 2.3 Add the first tests + wire them into CI — P1

Still zero test files. The extraction work already done makes this cheap now: the highest-value targets are pure functions with no I/O — `parseScoringResponse`, `robustJsonParse`, `sanitizeJson`, `calculateIQS` (`lib/quality.ts`), `calculateCallIQS`, `parseTranscriptionResponse` (`lib/call-quality.ts`), `analyzeConversationTiming`, `normaliseCsat`, the transcript normalizer (`lib/scoring/transcript.ts`), and `lib/stats.ts`. A day of Vitest with fixture payloads guards every future refactor; add `npm test` to `ci.yml`. Every subsequent item in this list becomes safer once this exists.

### 2.4 Parallelize independent SQL in dashboard routes — P1 (biggest latency win left)

Dashboard routes run independent aggregate queries **sequentially**:

| Route | Sequential `await query(...)` calls |
|---|---|
| `app/api/cx/tl/team-analytics/route.ts` | **13** |
| `app/api/cx/qa/analytics/route.ts` | 5 |
| `app/api/cx/tl/overview/route.ts` | 5 |
| `app/api/cx/admin/breakdown/route.ts` | 3 |

With ~40–150 ms per Neon round-trip, team-analytics pays ~13× that serially on every load. `quality/scores` already demonstrates the fix (`Promise.all` over the stats queries); apply the same pattern here. Pool `max` is 5, so batch in groups if needed.

### 2.5 Abortable LLM/HTTP timeouts + keys out of URLs — P1

- Both Gemini paths implement timeouts as `Promise.race` (`lib/gemini.ts:89-91,160-163`). The race rejects, but **the underlying fetch/SDK call keeps running** — consuming quota, connections, and lambda time, and the retry that follows can double-spend against a request that eventually succeeds. Use `AbortController` (`signal` is supported by both `fetch` and `@google/genai`) so a timeout actually cancels the request.
- `callGeminiForCall` puts the API key in the URL query string (`?key=...`, `lib/gemini.ts:153`) where it can leak into logs/traces; move it to the `x-goog-api-key` header.

### 2.6 Prune the dead-model fallback chain — P2

`CALL_MODEL_CHAIN` (`lib/gemini.ts:121-127`) still lists `gemini-2.5-flash-preview-05-20`, `gemini-1.5-pro`, `gemini-1.5-flash` — retired models that will 404 into the "deprecated" branch. Combined with the retry policy (5 attempts × 10 s sleeps × keys × models), the worst-case hang for a genuinely down service is minutes long inside a webhook-triggered lambda. Prune the chain to live models and consider driving it from `lib/models.ts`/config. Also: one hardcoded `claude-haiku-4-5-20251001` remains in `app/api/quality/my-analytics/ai/route.ts:227` — use `lib/models.ts`.

### 2.7 Split the remaining frontend monoliths — P2

`QualityClient` proved the pattern; four components still need it:

| Component | Lines | useState |
|---|---|---|
| `components/SettingsClient.tsx` | 1,653 | **83** |
| `components/InsightsChatClient.tsx` | 1,646 | 33 |
| `components/ChatInterface.tsx` | 1,226 | 15 |
| `components/AgentQualityClient.tsx` | 1,195 | 37 |
| `components/ir/MyQualityChatsPage.tsx` | 804 | 28 |

`SettingsClient` is the worst offender (83 state hooks → any keystroke re-renders the whole settings tree); split by settings section with lazy tabs. Also: SWR is adopted only in `QualityContext` — 112 raw `fetch()` calls remain across components, each hand-rolling loading/error/refresh state. Extending SWR to the dashboards deletes state code and gives dedup/cache for free.

### 2.8 Bound the remaining heavy reads — P2

- `app/api/quality/pending-review/route.ts:91` still fetches up to **1,000 full rows** (including `parameters` JSONB) and filters in JS. Push the pending-review predicate into SQL and paginate.
- `app/api/quality/export/route.ts:66` pulls **10,000 rows** into lambda memory before building the workbook. Acceptable today; if exports grow, stream rows in pages into the sheet builder.
- Cache headers exist on only 9 routes; most CX dashboard GETs recompute on every poll. Extend `Cache-Control: private, max-age=30` (or SWR `s-maxage`) to the read-heavy `cx/*` endpoints once §2.4 lands.

### 2.9 Consolidate the three overlapping route trees — P2

`app/api/quality/*` (14 routes), `app/api/call-quality/*` (8), and `app/api/cx/qa|tl/*` (13) still overlap: `scores`, `transcript`, and `pending-review` each exist in two trees mapping the same `iqs_scores` data. The shared modules (§1.2) removed the logic duplication; the remaining cost is navigational confusion and doubled guard/caching surface. Either merge `call-quality` into `quality` or add a routing map to `docs/` declaring which tree owns what. Related deletions: `app/api/call-analysis/route.ts` is a tombstone that only returns 410 — delete it and its client callers; gate `app/api/debug/db|keys` behind an env flag; consider whether the `link-test` tooling (~980 lines across page/component/route) still needs to ship to production.

### 2.10 Dead code & root-directory hygiene — P2

- **`lib/media-context.ts` — 234 lines, zero importers.** Delete (also flagged 2026-07-07; still present).
- `mimeFromUrl` exists twice: `lib/gemini.ts:235` and `app/api/webhooks/chat/route.ts:491`. Keep one.
- Root clutter: `AUDIT_REPORT.md`, `wint-cx-api.json`, five `PROMPT_*.txt`. Two prompts are still **read from disk at runtime** (`app/api/chat/analyze/route.ts:396,472` — `PROMPT_router.txt`, `PROMPT_extract_repayment.txt`) with silent fallbacks if missing on serverless; `lib/prompts.ts` already exists — finish the migration and move the rest to `docs/`.
- `README.md` is 1,546 lines / 61 KB — split into `docs/` topic files, keep README to setup + architecture map.

### 2.11 Ratchet lint & type safety back up — P2

The eslint config currently disables `no-explicit-any`, `no-unused-vars`, `prefer-const`, `react-hooks/exhaustive-deps`, `set-state-in-effect`, `purity`, and `use-memo` (`eslint.config.mjs:9-19`). These were presumably switched off to get CI green; they now hide real issues — there are **413 `: any` annotations** and **77 silent `catch {}` blocks** in source. Suggested ratchet, one rule per PR: (1) `prefer-const` + `no-unused-vars` (autofixable), (2) `no-explicit-any` as `warn` with per-file suppressions, then burn down starting with `lib/robylon/db.ts` row mappers and `lib/config.ts` (a `PortalConfig` type already exists), (3) `exhaustive-deps` as `warn`. Also extend the `no-console` rule from `app/api/**` to `lib/**` — 61 `console.*` calls in `lib/` bypass the structured logger the API layer now uses.

### 2.12 Dependency risk — P2

`xlsx@0.18.5` (SheetJS on npm) is unmaintained with known CVEs (prototype pollution / ReDoS). Client-side it's already lazy-loaded; it also parses **untrusted uploads** server-side. Move to `exceljs` or SheetJS's maintained CDN distribution, and add `npm audit --omit=dev --audit-level=high` to CI so the next one is caught automatically.

### 2.13 Opportunistic — P3

- CSP still allows `'unsafe-inline'` for scripts (`next.config.ts:22`); Next.js supports nonce-based CSP via middleware if the team wants to close it.
- `kv_get`/`kv_lrange` interpolate keys into the Upstash URL without `encodeURIComponent` (fine for current fixed keys; `executor.ts` already encodes — mirror that).
- `storeAcquireScoringLock` uses `console.warn` while the rest of `lib/store.ts` uses `log.warn` (`lib/store.ts:95`).
- The 2026-07-07 review doc on the unmerged `claude/code-cleanup-optimization-r6wuf3` branch is now largely stale (most findings shipped); this document supersedes it — close that branch to avoid confusion.

---

## Suggested sequence

**Quick wins (≤1 hour each):**
1. Fail-close `cx/ticket-status` (§2.1)
2. Delete `lib/media-context.ts`, the `call-analysis` tombstone, and the duplicate `mimeFromUrl` (§2.9, §2.10)
3. Replace the hardcoded Claude model ID; prune `CALL_MODEL_CHAIN` (§2.6)

**This sprint:**
4. Finish the `requireRole` sweep across `cx/*` (§2.2)
5. `Promise.all` the dashboard queries — start with `tl/team-analytics` (§2.4)
6. Vitest + fixtures for the pure scoring/parsing functions; add to CI (§2.3)
7. `AbortController` timeouts + header-based API keys in `lib/gemini.ts` (§2.5)

**Next:**
8. Split `SettingsClient` / `InsightsChatClient`; extend SWR to the dashboards (§2.7)
9. SQL-side filtering for `pending-review`; cache headers on CX reads (§2.8)
10. Lint ratchet PRs + `no-console` in `lib/` (§2.11); `xlsx` replacement + `npm audit` in CI (§2.12)
11. Route-tree consolidation decision + docs routing map (§2.9); README split (§2.10)
