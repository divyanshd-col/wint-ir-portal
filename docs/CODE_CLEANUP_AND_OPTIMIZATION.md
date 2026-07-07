# Code Cleanup & Optimization Review

**Date:** 2026-07-07
**Repo:** wint-ir-portal
**Scope:** Full-codebase deep dive focused on code health, duplication, and performance — what the codebase currently does well, and what we can improve. Security was covered separately in `AUDIT_REPORT.md` (2026-06-22); this doc only revisits security where an audit item is still open or has been fixed since.

**Codebase snapshot:** ~47,200 lines of TS/TSX across 196 source files. Next.js 16 App Router, React 19, TypeScript (strict), PostgreSQL (`pg`), Upstash Redis REST, Gemini + Anthropic SDKs, NextAuth v4, Tailwind, Vercel. ~90 API routes, ~50 client components, no test suite, no CI.

---

## Part 1 — What is currently being done (worth keeping)

These are deliberate, good patterns already in the codebase. Any cleanup work should preserve them.

### Data layer
- **Singleton `pg` Pool with sane limits** — `lib/cx/db.ts:21-27` creates one pool (`max: 5`, idle/connection timeouts), recreates on pool error, and prefers the non-pooling Neon URL to avoid PgBouncer transaction-mode issues.
- **TLS verification is on in production** (`lib/cx/db.ts:23`, `rejectUnauthorized: true`) — this fixes P1 #3 from the June audit.
- **Slow-query logging** — every query over 500 ms is logged with a sanitized SQL preview (`lib/cx/db.ts:37-50`).
- **Filter push-down into SQL** — `getAllScoredConversations` (`lib/robylon/db.ts:262`) builds parameterized WHERE clauses for date, agent, disposition, and score range instead of filtering in JS; `getAllScoredCalls` (`lib/robylon/db.ts:628`) does proper `COUNT(*)` + `LIMIT/OFFSET` pagination.
- **Idempotent upserts everywhere** — conversations, agents, contacts, call recordings, and IQS scores all use `ON CONFLICT ... DO UPDATE` with `COALESCE` merge semantics, so webhook retries and out-of-order events don't corrupt data.
- **Numbered SQL migrations** in `db/migrations/` (001–010).

### Concurrency & reliability
- **Distributed scoring lock** — `storeAcquireScoringLock` (`lib/store.ts:82`) uses Redis `SET NX EX 1800` and **fails closed** on KV errors, preventing duplicate LLM scoring when Robylon fires overlapping events.
- **Webhook event dedup** — event IDs are marked in KV with a 2 h TTL, keyed by `eventType:eventId` to avoid dropping distinct events sharing an ID (`app/api/webhooks/chat/route.ts:1060-1073`).
- **Stale-claim recovery** — calls stuck in `scoring` for 30+ minutes are reset to `linked` (`lib/robylon/db.ts:206-209`); `claimCallForScoring` is an atomic conditional UPDATE.
- **`waitUntil` for background work** — call transcription runs after the webhook response is sent (`app/api/webhooks/chat/route.ts:943`), so Robylon isn't kept waiting 10–30 s.
- **Upstash 1 MB response limit handled** — `storeGetAllIQSScores` (`lib/store.ts:256`) reads the list in parallel 500-entry batches instead of one `LRANGE 0 -1`.

### LLM integration
- **Key rotation + model fallback chains with timeouts** — `geminiGenerate` / `geminiStream` rotate across up to 5 keys on 429/503 and walk a fallback model chain with cycle detection (`lib/gemini.ts:33-95`); `callGeminiForCall` adds deprecation detection and bounded retries.
- **Dedicated IQS API keys** for spend tracking, separate from chat keys (`lib/gemini.ts:8-11`).
- **Two-tier KB cache** — in-memory (30 min TTL, survives warm lambdas via `global`) plus KV, with `fetchWithTimeout` on all external doc fetches (`lib/drive.ts`).
- **Editable prompts with hardcoded fallbacks** — scoring/planner prompts can be overridden from config without a deploy (`lib/config.ts:36-38`).

### API & app structure
- **Structured logging exists** — `lib/log.ts` emits one JSON line per event and provides a `withLogging` route wrapper that logs request/response/duration/reqId.
- **Long-running routes declare `runtime` and `maxDuration`** (analytics, call-analysis, retranscribe: 60–300 s).
- **Comprehensive security headers + CSP** in `next.config.ts`, source maps disabled in production.
- **Auth fundamentals are solid** — bcrypt, per-IP login rate limiting, domain-restricted emails, JWT sessions with 8 h expiry, role claims in the token (`auth.ts`).
- **Page-level role gating in middleware** for `/quality`, `/analytics`, `/call-analysis` (`middleware.ts:28-47`).
- **Cron endpoints registered in `vercel.json`** and the orphan `transcribe-calls` cron from the June audit has been removed.

---

## Part 2 — What we can do

Findings are grouped by theme. Each has a priority: **P1** (do this sprint — real risk or large payoff), **P2** (planned cleanup), **P3** (opportunistic).

### A. Architecture: business logic lives inside route files — P1

Six modules import core scoring logic **from a route file**:

```
app/api/quality/transcript/route.ts:14   import { scoreLinkedCallsForChat, transcriptFromJsonb } from '@/app/api/webhooks/chat/route';
app/api/admin/run-pending-scores/route.ts:5    import { executeScoring } from '@/app/api/webhooks/chat/route';
app/api/cron/process-pending-scores/route.ts:13-14  (both, plus transcriptFromJsonb)
app/api/call-quality/unified-score/route.ts:30 import { scoreLinkedCallsForChat } ...
app/settings/page.tsx:6                  import { DEFAULT_CHAT_PROCESS_PROMPT } from '@/app/api/chat/route';
```

`app/api/webhooks/chat/route.ts` is 1,080 lines and doubles as the scoring engine. Next.js route files are supposed to export only HTTP handlers and segment config; extra exports are an antipattern (they can break with stricter route-type validation, and they couple every consumer to a webhook's module-level side effects).

**Recommendation:** extract `executeScoring`, `scoreLinkedCallsForChat`, `transcriptFromJsonb`, and the transcript/timestamp parsing helpers into `lib/scoring/` (e.g. `lib/scoring/engine.ts`, `lib/scoring/transcript.ts`). The webhook route shrinks to event parsing + dispatch. Same for `DEFAULT_CHAT_PROCESS_PROMPT` → `lib/prompts.ts`. This is mechanical, low-risk, and unblocks most of section B.

### B. Duplication — P1/P2

The single biggest cleanup lever. Concrete copy-paste inventory:

| What | Copies | Where |
|---|---|---|
| `qualityAccess()` role check | **14 identical copies** | every `app/api/quality/*` route |
| Inline `session?.user?.role` checks | 14 more variants | `app/api/cx/*` and others |
| `DB_KEY_TO_LEGACY` param-key map | 4 | `quality/scores`, `quality/export`, `quality/pending-review`, `debug/db` routes |
| `PASCAL_TO_DB` (inverse map) | 3 | `cx/qa/chats-to-review`, `cx/tl/chats` routes, `components/quality/EvalPanel.tsx` |
| `avg()` / `avgOrNull()` / `csatScore()` helpers | 3+ | `quality/scores`, `quality/team-avg`, `call-quality/scores`, `analytics` routes |
| Internal-note / system-message transcript filtering | **4 near-identical blocks** | `messagesToTranscript`, `transcriptFromJsonb`, `handleTicketClosed`, `handleLegacyPayload` — all in `app/api/webhooks/chat/route.ts` (lines 80–134, 555–602, 787–828) |
| KB-context retrieval + doc-name labelling | 2 | `scoreLinkedCallsForChat` (route.ts:213-228) and `executeScoring` (route.ts:414-435) |
| Audio fetch → MIME sniff → base64 → transcribe | 2 | `scoreLinkedCallsForChat` (route.ts:234-287) and `handleCallComplete` (route.ts:952-989); `mimeFromUrl` at route.ts:892 duplicates the inline sniffing at 239-248 |
| Upstash REST pipeline `fetch` boilerplate | ~15 blocks | `lib/store.ts` — every write helper re-implements the same POST + headers + catch |
| Role shell components | 3 | `QualityShell` / `TLShell` / `IRShell` (126–139 lines each, near-identical) |
| Loggers | 2 | `lib/log.ts` (structured, current) and `lib/logger.ts` (legacy, still used by 4 routes) |

**Recommendations:**
1. **`lib/api-guard.ts`** — one `requireRole(...roles)` helper that returns the session or throws/returns a 403 response. Replaces all 28 role-check copies and structurally prevents the "forgot the guard" bug class (see §G). This is the highest-value 50 lines you can write in this repo.
2. **`lib/param-keys.ts`** — export `DB_KEY_TO_LEGACY`, `PASCAL_TO_DB` (derived from it, not maintained separately), and share with the client components.
3. **`lib/stats.ts`** — `avg`, `avgOrNull`, `csatScore`, `getWeekKey`, `getWeekLabel`.
4. **One transcript normalizer** — a single `normalizeRobylonMessages(messages)` returning `{ transcriptText, timedMessages, transcriptForStorage }`; all four webhook paths call it. The four blocks have already drifted (e.g. only some check `is_private`), which is exactly how scoring inconsistencies appear.
5. **`kv_pipeline(commands)` helper in `lib/store.ts`** — collapses ~150 lines of repeated fetch boilerplate and gives one place to add retries/metrics.
6. Delete `lib/logger.ts` after migrating its 4 callers to `lib/log.ts` (keep the Sheet-sync formatting where needed).
7. Fold the three shells into one `RoleShell` parameterized by nav items.

### C. Backend performance — P1/P2

1. **Unbounded fetch + in-memory pagination on the hottest endpoint (P1).** `app/api/quality/scores/route.ts:202` calls `getAllScoredConversations(0, …)` — no LIMIT — then paginates to 50 rows in JS (line 243) and computes stats over the full set on every request. `quality/team-avg/route.ts:25` and `quality/pending-review/route.ts:83,115` do the same; `quality/export` pulls 10,000 rows. Every row carries the full `parameters` JSONB. As the table grows this degrades linearly on every dashboard load.
   **Do:** add `COUNT(*)` + `LIMIT/OFFSET` to `getAllScoredConversations` (the pattern already exists in `getAllScoredCalls`), and move the stats to SQL aggregates (`GROUP BY agent`, `AVG`, `FILTER (WHERE …)`). The distinct filter-dropdown values (route.ts:218-231) should be a separate cheap `SELECT DISTINCT` (or cached) instead of a byproduct of fetching everything.

2. **O(n) Redis list scans for single-record updates (P2).** `kv_scanAndUpdate` (`lib/store.ts:286`) walks the entire `wint_iqs_scores` list in sequential 500-entry batches to update one entry; `storeUpdateIQSFlag` (`lib/store.ts:377`) loads **all** flags to find one index. The IQS list is append-forever (`lib/store.ts:236` — "No LTRIM — scores are kept forever"), so these get slower every day. Postgres is already the system of record for scores (`iqs_scores` table).
   **Do:** finish the Redis→Postgres migration for scores/flags (scripts `redis-to-cx.mjs` / `redis-to-robylon.mjs` suggest it's underway), then delete the list-scan helpers. Redis should keep only what it's good at here: locks, dedup markers, pending-state blobs, caches.

3. **N+1 inserts.** `insertCallTranscriptChunks` (`lib/robylon/db.ts:753-763`) inserts row-by-row in a loop. Use one multi-row `INSERT ... VALUES ($1…),(…)` or `UNNEST`. Same audit for other loops writing per-item.

4. **Double write on classification.** `handleClassificationUpdated` calls `upsertConversation({tags…})` then immediately `updateConversationTags` with the same data (`app/api/webhooks/chat/route.ts:713-720` — the comment says "for clarity"). Drop one.

5. **Whole audio files buffered into memory as base64** (`route.ts:250, 959`) — a 30-minute call recording becomes ~1.3× its size in heap inside a lambda. Consider the Gemini Files API (upload once, reference by URI) which also removes the 20 MB inline-data ceiling.

6. **Sequential LLM scoring of multiple calls per chat** (`scoreLinkedCallsForChat` loops one call at a time). If rate limits allow, `Promise.allSettled` with a small concurrency cap; if the serialization is deliberate for quota reasons, say so in a comment.

7. **No HTTP caching on read-heavy GETs.** Dashboard endpoints recompute on every poll. Cheap wins: `Cache-Control: private, max-age=30` (or `s-maxage` + SWR semantics) on scores/analytics reads, or route-segment `revalidate` where the data tolerates 30–60 s staleness.

### D. Frontend performance & bundle size — P1/P2

1. **`components/QualityClient.tsx` is 4,321 lines with 133 `useState` hooks (P1).** It contains the log table, weekly reports, uploads, pending review, calls, unified scoring, and XLSX export in one client component. Any state change re-renders the world; the file is effectively unreviewable and unmergeable (high conflict surface). Split by tab (`QualityTab` union at line 96 already names the seams: performance / log / upload / reports / pending / calls / call-test / unified / call-queue) into lazy-loaded feature components, and move shared filter state into a reducer or context. `InsightsChatClient` (1,660), `SettingsClient` (1,652), `ChatInterface` (1,229), `AgentQualityClient` (1,195) deserve the same treatment after.

2. **`xlsx` is statically imported in a client component** (`components/QualityClient.tsx:5`) — SheetJS is one of the heaviest packages that can land in a browser bundle, and it's only needed when someone clicks Export. Use `await import('xlsx')` inside the export handler (the server route `analytics/export-transcripts` can keep its static import). Also note `xlsx@0.18.5` on npm is unmaintained/known-vulnerable — consider `exceljs` or SheetJS's own CDN releases.

3. **No client data-fetching layer.** 114 raw `fetch()` calls across components, zero SWR/React Query. Each component hand-rolls loading/error/refresh state (part of why QualityClient has 133 states). Adopting SWR (tiny, already fits the polling patterns here) gives request dedup, cache, focus revalidation, and deletes a lot of state code.

4. **Zero memoization on heavy tables.** No `React.memo` anywhere in `components/`; big table rows (ChatEvalTable, ReviewedChatsTable, DispositionTreeTable) re-render on every parent state change. Memoize row components and the derived arrays feeding them.

5. **`recharts` statically imported in 3 dashboards** with no `next/dynamic` — charts are below-the-fold widgets; lazy-load them to cut initial JS for every dashboard page.

6. **9 raw `<img>` tags, `next/image` never used** — minor, but free `eslint`-flagged wins (avatars, logos).

### E. Dependencies & config hygiene — P1 (one item), rest P2

1. **`vercel` (the CLI, ~50 MB+ tree) is in `dependencies`** (`package.json:28`). It is never imported. It inflates every `npm install` and the serverless bundle-analysis surface. Remove it (deploys happen via Vercel's Git integration) or move to `devDependencies`. **P1 because it's a one-line change with a big install-time payoff.**
2. **Build-time-only packages in `dependencies`:** `@types/pg`, `autoprefixer`, `postcss`, `tailwindcss` should be `devDependencies`. `@types/bcryptjs` is a deprecated stub (bcryptjs ≥3 ships its own types) — drop it.
3. **Two Gemini client implementations** — the `@google/genai` SDK (`geminiGenerate`) *and* a raw-fetch path (`callGeminiForCall`) live side by side in `lib/gemini.ts` with separate retry/fallback logic. Converge on the SDK unless the raw path exists for a documented reason (the `thinkingBudget: 0` + JSON-mime combo); if so, document it in the file header.
4. **Hardcoded model IDs scattered in routes** — `'gemini-2.5-flash'` is hardcoded at `app/api/webhooks/chat/route.ts:309,451,460` even though `config.geminiModel` exists; `'claude-sonnet-4-6'` likewise. Centralize model selection in `lib/gemini.ts` / config so a model bump is one change, not a grep hunt.
5. **`lint` script only runs `eslint` with no path/`--max-warnings`**, and there is **no `.github/` — no CI at all**. Even without tests, a CI job running `next build` + `eslint` would catch the type and lint regressions that currently only surface on Vercel deploys.

### F. Dead code & repo hygiene — P2/P3

- **`lib/media-context.ts` has zero importers** — delete it.
- **Root-directory clutter:** `AUDIT_REPORT.md`, `wint-cx-api.json`, and five `PROMPT_*.txt` files sit in the repo root. Caution: `PROMPT_router.txt` and `PROMPT_extract_repayment.txt` are **read from disk at runtime** (`app/api/chat/analyze/route.ts:393,469`), so moving them requires updating those paths — but they'd be better as exported constants in `lib/prompts/` (no fs read, no "file missing on serverless" fallback branch). The rest can move to `docs/`.
- **`README.md` is 1,546 lines / 61 KB** — split into `docs/` topic files, keep the README to setup + architecture map.
- **Debug/one-off endpoints in production:** `app/api/debug/db` (fetches up to 2,000 rows), `app/api/debug/keys`, `app/api/seed`, `app/api/admin/migrate`. They're admin-gated, but consider deleting `seed`/`migrate` (migrations run from `scripts/` now) and putting `debug/*` behind an env flag.
- **`app/api/quality` vs `app/api/call-quality` vs `app/api/cx/qa|tl` trees** partially overlap (scores, transcript, pending-review exist in more than one tree, mapping the same `iqs_scores` data with the same key-map copies). Worth a routing map in docs and a consolidation pass once §B.2's shared modules exist.

### G. Type safety & error handling — P2

- **412 `: any` annotations** across app/lib/components, including load-bearing ones: `config: any` in `lib/gemini.ts:8,14`, `body: any` throughout webhook handlers, `row: any` mappers. Priority order: (1) type the config object (`PortalConfig` already exists — use it), (2) define a `RobylonWebhookEvent` union for the webhook payloads, (3) type DB row mappers with the interfaces already defined in `lib/robylon/db.ts`.
- **Silent `catch {}` blocks** remain in KB fetch (`app/api/webhooks/chat/route.ts:228`) and `writeToFile` (`lib/config.ts:131`) — at minimum `log.warn` them.
- **`console.*` vs structured logging:** 149 raw `console.log/warn/error` calls coexist with `lib/log.ts`; `withLogging` is applied to only a handful of `cx/*` routes. Pick the structured logger, wrap all routes, and lint-ban bare `console.log` in `app/api`.

### H. Still-open items from the June security audit — P0/P1 (flagged, not the focus of this doc)

Re-verified today while reading the code:

| Audit item | Status today |
|---|---|
| P0 #1 `POST /api/config` unauthenticated | **STILL OPEN** — `app/api/config/route.ts:68` has no session check; `PATCH` in the same file has one. Any anonymous request can replace users + API keys. Fix is one line (`getAdminSession()` guard). |
| P0 #2/#3 webhooks fail-open without `WEBHOOK_SECRET` | **STILL OPEN** — `app/api/webhooks/chat/route.ts:174` still `return true` when the secret is unset. |
| P1 SSL `rejectUnauthorized: false` | ✅ Fixed (`lib/cx/db.ts:23`). |
| P2 orphan `transcribe-calls` cron | ✅ Fixed (`vercel.json` now lists only existing routes). |
| P1 no tests | Still true — see §I. |

These two P0s predate this review and remain the most important changes in the repo. The `requireRole` helper from §B.1 is the structural fix that prevents the class.

### I. Testing — P2 (unchanged from audit, scoped for cleanup work)

There is still no test framework. For the cleanup specifically, the extraction work in §A/§B is only safe with characterization tests around: `parseScoringResponse` / `parseCallScoringResponse`, `analyzeConversationTiming`, the transcript normalizer (§B.4), and `normaliseCsat` / `parseRobyTimestamp`. These are pure functions — Vitest can cover them with fixture payloads in a day, and they then guard every subsequent refactor.

---

## Suggested sequence

**Quick wins (hours each):**
1. Add the missing auth guard to `POST /api/config`; make webhooks fail closed (§H).
2. Remove `vercel` from dependencies; move build-only packages to devDependencies (§E.1-2).
3. Dynamic-import `xlsx` in `QualityClient` (§D.2).
4. Delete `lib/media-context.ts`; drop the duplicate `updateConversationTags` call (§C.4); batch `insertCallTranscriptChunks` (§C.3).

**This sprint:**
5. `lib/api-guard.ts` + sweep all 28 role checks (§B.1).
6. Extract the scoring engine out of the webhook route into `lib/scoring/` (§A), adding Vitest characterization tests for the pure parsers first (§I).
7. Shared `param-keys` / `stats` / transcript-normalizer modules (§B.2-4).
8. Real pagination + SQL aggregation for `quality/scores`, `team-avg`, `pending-review` (§C.1).

**Next:**
9. Split `QualityClient.tsx` by tab; introduce SWR; memoize heavy tables (§D.1, D.3, D.4).
10. Finish the Redis-list → Postgres migration for scores/flags and delete the list-scan helpers (§C.2).
11. Minimal CI (`next build` + eslint) (§E.5); consolidate loggers (§B.6); root-dir cleanup (§F).
