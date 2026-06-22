# Repo Audit Report

**Date:** 2026-06-22
**Repo:** wint-ir-portal
**Stack detected:** Next.js 16.1.6 (App Router), TypeScript (strict), React 19, PostgreSQL (Neon via `pg`), Upstash Redis REST, Anthropic Claude SDK, Google GenAI SDK, NextAuth.js v4, Tailwind CSS, Vercel deployment — **No test framework of any kind**
**Files scanned:** 46 non-trivial source files (full read), plus skipped: package-lock.json, public assets, migration SQL files, postcss/tailwind configs, most frontend-only component files
**Issues found:** 17 — 🔴 P0: 3 | ⚠️ P1: 7 | 💡 P2: 7

---

## Executive Summary

The most severe risk in this repo is an **unauthenticated write endpoint** at `POST /api/config` that allows any anonymous HTTP request to replace the entire portal configuration — including user accounts and LLM API keys. This is a full authentication bypass that is made structurally possible because **all `/api/*` routes are excluded from the auth middleware**, delegating every auth check to individual route handlers. A second serious risk is that both webhook endpoints (`/api/webhooks/chat` and `/api/webhooks/call`) **accept all requests when `WEBHOOK_SECRET` is not set**, meaning a missing environment variable silently removes all ingestion security. On the positive side: the rest of the auth pattern (session checks, role enforcement, bcrypt passwords, rate-limiting on login/register) is well-implemented, security headers are comprehensive, and secrets are not hardcoded anywhere in source.

---

## 🔴 P0 — Fix Before This Branch Merges

> These will break things: CI failures, security risks, test suite collapse, or data leaks.

| # | File | Issue | Fix |
|---|------|-------|-----|
| 1 | `app/api/config/route.ts:67` | `POST /api/config` has **no authentication check**. Any unauthenticated HTTP request can overwrite the entire portal configuration — replacing API keys, the full user list, and knowledge-base URLs. The `PATCH` handler on the same file correctly requires admin, but `POST` has no guard at all. | Add the same `if (!await getAdminSession()) return ...` guard that `PATCH` already has at line 38, immediately inside the `POST` function body. |
| 2 | `app/api/webhooks/chat/route.ts:148-151` | When `WEBHOOK_SECRET` env var is not set, the chat webhook **accepts every request** with a console warning and `return true`. Any attacker who discovers the URL can inject arbitrary transcripts, trigger LLM scoring, and corrupt conversation records. | Change the guard to deny when the secret is absent: if `!secret` return a `401`. Set `WEBHOOK_SECRET` as a required env var in deployment docs. |
| 3 | `app/api/webhooks/call/route.ts:37-39` | Identical fail-open pattern as P0 #2: `if (!secret) return true` allows all call webhook requests when the env var is unset. | Same fix: deny when secret is absent rather than allowing all requests. |

---

## ⚠️ P1 — Fix This Sprint

> These work now but will cause problems as the codebase or team grows.

| # | File | Issue | Fix |
|---|------|-------|-----|
| 1 | `middleware.ts:7-9` | All `/api/*` routes are **excluded from auth middleware** with a blanket pass-through. Auth is delegated entirely to individual route handlers. One missed check (the P0 above is a direct consequence) exposes that route to anonymous access with no safety net. | At minimum remove the blanket `/api/` exclusion and handle auth in middleware for all non-webhook API routes; or add a mandatory auth utility that throws rather than returning a value so it cannot accidentally be omitted. |
| 2 | `app/api/cron/process-pending-scores/route.ts:16-24` | When `CRON_SECRET` env var is absent, the endpoint allows all requests through. Anyone who finds the URL can trigger expensive batch LLM scoring of all unscored conversations. `sync-logs` cron does this correctly — it explicitly checks both a Vercel header and the secret. | Apply the same pattern as `sync-logs`: require `CRON_SECRET` to be set and reject if neither the Vercel cron header nor the bearer token is present. |
| 3 | `lib/cx/db.ts:24` | `ssl: { rejectUnauthorized: false }` in production. This disables TLS certificate verification on PostgreSQL connections, making all DB traffic vulnerable to man-in-the-middle interception. The `pg` library supports proper certificate validation. | Use `ssl: { rejectUnauthorized: true }` in production. For Neon/Vercel Postgres, the CA cert is available; or set `PGSSLMODE=require` and let the driver verify properly. |
| 4 | `lib/analytics/text-to-sql.ts` + `lib/analytics/executor.ts` | The analytics agent asks an LLM to write arbitrary SQL which is then executed directly on the production database. The only safeguard is `isReadQuery()` (checks if SQL starts with `SELECT` or `WITH`), which can be bypassed via `WITH DELETE ... RETURNING` or by prompt-injecting `'; DROP TABLE...'` into a crafted message. Even without destructive queries, a malicious prompt can exfiltrate all conversation transcripts through SELECT. | Enforce a strict allowlist of parameterized query templates (`templates.ts` already exists for this purpose) and never pass raw LLM-generated SQL to the database. If text-to-sql must be supported, sandbox it with a read-only database user with column-level restrictions. |
| 5 | `lib/logger.ts:21` | `logChatMessage` emits `console.log('[IR_LOG]', JSON.stringify(entry))` where `entry.query` contains the agent's full question text. Agents routinely include customer details (mobile numbers, names, order IDs) in their queries. These are written unredacted to Vercel's centralized log stream and to Upstash KV and synced to a Google Sheet accessible by multiple users. | Strip or hash PII fields before logging; at minimum log only the query category and length, not the full text. Apply the same scrub before writing to KV and the sync sheet. |
| 6 | `app/api/admin/reset-password/route.ts:17` | Admin-initiated password reset requires only 6 characters (`newPassword.length < 6`), while the user self-service change endpoint (`app/api/users/me/password/route.ts:13`) requires 8. Inconsistent policy means admin resets can create weaker passwords than self-service. | Centralise password validation in one utility function and enforce a single minimum (8 chars minimum, align both endpoints). |
| 7 | *(entire repo)* | **No test suite of any kind.** Zero `.spec.ts`, `.test.ts`, Jest, Vitest, or Playwright files exist. The codebase handles authentication, role-based access control, LLM-driven scoring, webhook processing, and database writes — all without any automated verification. Regressions in any of these flows are invisible until they reach production. | Add at minimum: unit tests for `auth.ts`, `lib/quality.ts` scoring logic, and `lib/rate-limit.ts`; integration tests for the webhook handlers and config POST/PATCH. A Playwright smoke test for login + chat flow would cover the golden path. |

---

## 💡 P2 — Backlog (Quality & Maintainability)

> Low urgency. Won't break anything today but degrades code health over time.

| # | File | Issue | Fix |
|---|------|-------|-----|
| 1 | `app/api/cron/sync-logs/route.ts:8` | Google Sheet ID `1d8LE5opfdIDdsHYZ9AxaX1Z7TImUwAW_Kzk29xtzOTA` is hardcoded in source. Changing the log sheet requires a code deploy, and the ID is visible to anyone with repo access. | Move to an env var `LOGS_SHEET_ID` read at runtime. |
| 2 | `next.config.ts:22-23` | CSP `script-src` allows both `'unsafe-inline'` and `'unsafe-eval'`. The comment acknowledges this ("nonces would be ideal") but doesn't resolve it. This negates much of the XSS protection that the rest of the CSP provides. | Implement nonce-based CSP for Next.js (supported natively via `next/headers`). Remove `unsafe-eval`; most React production builds don't need it. |
| 3 | `lib/config.ts:83` | The file-based config load has a bare `catch {}` that silently returns `DEFAULT_CONFIG` on any error. If `portal-config.json` contains invalid JSON (corrupted write), the app silently falls back to an unconfigured state with no error surfaced to operators. | Log the error and/or surface it in the response from `readConfig()` so operators can detect corruption. |
| 4 | `app/api/config/route.ts:32` | `GET /api/config` returns the full list of usernames (`config.users.map(u => ({ username: u.username, ... }))`) to any authenticated user, not just admins. Any agent can discover all other users' email addresses. | Return the users list only when `session.user.isAdmin` is true; for non-admins, return only a count or omit the field. |
| 5 | `README.md:97-99` | Documents `IR_USERS=alice:Pass123,bob:Pass456` as the way to add users. The actual code reads `IR_USERS_JSON` (a JSON array) — this format doesn't exist. Any developer following the README will configure a non-functioning env var and not understand why users can't log in. | Update README to document `IR_USERS_JSON` with a valid JSON example; remove the `IR_USERS=` format entirely. |
| 6 | `vercel.json:11-14` | `crons` references `/api/cron/transcribe-calls` at schedule `0 3 * * *`. This route **does not exist** in the codebase. Vercel will attempt to call it nightly and receive a 404 — a silent operational failure that will appear in Vercel cron logs as recurring errors. | Remove the orphan cron entry or implement the route. |
| 7 | `lib/rate-limit.ts:10-12` | Rate limiter returns `false` (allow all) when `UPSTASH_REDIS_REST_URL`/`TOKEN` are not configured: `if (!ready()) return false`. On local dev, this means login and registration have zero rate limiting. If deployed to Vercel without Upstash configured by mistake, the brute-force protection silently disappears. | Add a log warning when the rate limiter is disabled so operators know protection is off; consider an in-memory fallback limiter for local dev. |

---

## Fix Priority Plan

### Now — P0s (fix before merge)

**Theme: Authentication Bypass on Write Endpoints**
All three P0 issues share the same root cause: a missing or fail-open authentication check on endpoints that accept external or unauthenticated input.

- **P0 #1 — Unauthenticated config write:** An anonymous user can replace the entire portal config including API keys and user accounts. One-line fix: add the `getAdminSession()` guard already used by `PATCH`. **Effort: Low**
- **P0 #2 & #3 — Fail-open webhook auth:** Both webhook routes accept all traffic when `WEBHOOK_SECRET` is absent. Fix is a one-line change to invert the allow-all: deny when secret is absent. Document `WEBHOOK_SECRET` as a required production env var. **Effort: Low**

---

### This Sprint — P1s

**Theme: Structural Auth Weakness**
P1 #1 (middleware bypass) and P1 #2 (cron fail-open) are the same architectural pattern as the P0s — security that only works when env vars are set and every developer remembers to add guards. Address by inverting the defaults.

**Effort: Medium**

**Theme: Database Security**
P1 #3 (SSL cert validation) and P1 #4 (LLM-generated SQL) are independent database risks. The SSL fix is a single config change. The LLM SQL issue requires replacing the text-to-sql path with template enforcement — this requires more design work.

**Effort: Low (SSL fix) | High (SQL sandboxing)**

**Theme: PII in Logs**
P1 #5 (agent query logging) needs a scrubbing pass before writing to KV and sheets. Define what fields are safe to log (category, timestamp, username, query length) and strip the rest.

**Effort: Medium**

**Theme: Missing Tests**
P1 #7 is a medium-to-high effort investment but critical for long-term reliability. Start with auth unit tests and webhook handler tests as they cover the highest-risk paths.

**Effort: High**

---

### Backlog — P2s

**Theme: Hardcoded Config**
P2 #1 (Sheet ID) and P2 #6 (orphan cron) are simple cleanup tasks.

**Effort: Low each**

**Theme: Security Hardening**
P2 #2 (CSP nonce) and P2 #7 (rate-limit fallback) improve defence-in-depth but require more careful implementation.

**Effort: Medium each**

**Theme: Documentation & Consistency**
P2 #3 (silent config errors), P2 #4 (username list exposure), P2 #5 (README accuracy) are straightforward fixes that reduce operator confusion and accidental misconfiguration.

**Effort: Low each**

---

## Files Scanned

| File | Category | Issues Found |
|------|----------|-------------|
| `package.json` | Config | P2: 0 (no test script, but intentional for this project type) |
| `tsconfig.json` | Config | None — strict mode enabled ✅ |
| `README.md` | Docs | P2: 1 (stale IR_USERS format) |
| `.gitignore` | Config | None — .env* excluded ✅ |
| `auth.ts` | Source | None — bcrypt, rate-limit, JWT session well-implemented ✅ |
| `middleware.ts` | Source | P1: 1 (blanket /api/ exclusion) |
| `next.config.ts` | Config | P2: 1 (unsafe-inline/unsafe-eval in CSP) |
| `vercel.json` | Config | P2: 1 (orphan cron route) |
| `next-auth.d.ts` | Source | None ✅ |
| `eslint.config.mjs` | Config | None ✅ |
| `lib/config.ts` | Source | P2: 1 (silent catch{}) |
| `lib/types.ts` | Source | None ✅ |
| `lib/store.ts` | Source | None ✅ |
| `lib/log.ts` | Source | None ✅ |
| `lib/logger.ts` | Source | P1: 1 (full query text logged including potential PII) |
| `lib/rate-limit.ts` | Source | P2: 1 (fail-open when KV not configured) |
| `lib/drive.ts` | Source | None ✅ |
| `lib/gemini.ts` | Source | None ✅ |
| `lib/quality.ts` | Source | None ✅ |
| `lib/cx/db.ts` | Source | P1: 1 (rejectUnauthorized: false in production) |
| `lib/analytics/text-to-sql.ts` | Source | P1: 1 (LLM-generated SQL executed on DB) |
| `lib/analytics/executor.ts` | Source | P1: 1 (shared with text-to-sql issue above) |
| `app/api/config/route.ts` | Source | P0: 1 (POST no auth), P2: 1 (username list to all auth users) |
| `app/api/chat/route.ts` | Source | None ✅ |
| `app/api/users/route.ts` | Source | None ✅ |
| `app/api/register/route.ts` | Source | None ✅ |
| `app/api/users/me/password/route.ts` | Source | None ✅ |
| `app/api/admin/reset-password/route.ts` | Source | P1: 1 (6-char minimum vs 8 elsewhere) |
| `app/api/admin/migrate/route.ts` | Source | None ✅ |
| `app/api/admin/run-pending-scores/route.ts` | Source | None ✅ |
| `app/api/admin/retranscribe-calls/route.ts` | Source | None ✅ |
| `app/api/seed/route.ts` | Source | None ✅ |
| `app/api/debug/keys/route.ts` | Source | None ✅ (masked keys, admin-only) |
| `app/api/debug/db/route.ts` | Source | None ✅ |
| `app/api/webhooks/chat/route.ts` | Source | P0: 1 (fail-open when WEBHOOK_SECRET absent) |
| `app/api/webhooks/call/route.ts` | Source | P0: 1 (fail-open when WEBHOOK_SECRET absent) |
| `app/api/analytics/route.ts` | Source | None ✅ |
| `app/api/analytics/query/route.ts` | Source | None ✅ |
| `app/api/cron/process-pending-scores/route.ts` | Source | P1: 1 (fail-open when CRON_SECRET absent) |
| `app/api/cron/sync-logs/route.ts` | Source | P2: 1 (hardcoded Sheet ID) |
| `app/api/quality/score/route.ts` | Source | None ✅ |
| `app/api/quality/flag/route.ts` | Source | None ✅ |
| `app/api/cx/qa/review/[chatId]/route.ts` | Source | None ✅ |
| `app/api/quality/my-analytics/ai/route.ts` | Source | None ✅ |
| `scripts/manage-users.mjs` | Source | None ✅ |
| `PROMPT_analysis_meta.txt` | Docs | Skipped — internal documentation, no code |
| `package-lock.json` | Config | Skipped — auto-generated lock file |
| `public/*` | Assets | Skipped — static files |
| `db/migrations/*.sql` | DDL | Skipped — schema migrations, no issues in scope |
| `docs/quality-alert-appscript.*` | Docs | Skipped — external Apps Script, not deployed here |
| `tailwind.config.js`, `postcss.config.mjs` | Config | Skipped — build tooling only |
| `app/globals.css` | Styles | Skipped — CSS |
| Frontend components (`components/**/*.tsx`, `app/**/*.tsx`) | Source | Skipped — UI-only files with no auth/security logic |
