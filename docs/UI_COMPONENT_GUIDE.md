# UI Component Guide (context for humans and AI assistants)

How the Wint IR Portal UI is built, which shared pieces exist, and the conventions every page follows. Read this before changing any screen. It also records what changed in the UI overhaul + Email Quality work (branch `feat/ui-overhaul-email-quality`).

- Stack: Next.js 16 App Router, React, Tailwind 3 (utility classes) plus inline `style={{}}` with CSS variables, next-auth session (`role`, `skills`).
- Styling is token based. **Never hard-code a hex colour in new UI**; use a token so light/dark mode works.
- Verify with `npx tsc --noEmit`, `npm test`, `npm run build`. Pure UI logic lives in `lib/` and has `node:test` tests in `scripts/` (see [Testing](#testing-and-local-verification)).

---

## 1. Design tokens

Defined in `app/globals.css` (light defaults) and `app/dark-theme.css` (shell tokens + dark values). Three families, one per surface:

| Family | Used by | Tokens |
|---|---|---|
| Shell | top bar, sidebars, page ground | `--page-bg`, `--tb-bg`, `--tb-border`, `--tb-capsule`, `--tb-pill`, `--sb-bg`, `--sb-border`, `--sb-text`, `--sb-text-muted`, `--sb-hover`, `--sb-active-bg`, `--sb-active-text`, `--sb-active-shadow` |
| Quality (`--qa-*`) | Quality / TL / agent pages and tables | `--qa-bg`, `--qa-card`, `--qa-border`, `--qa-border-sub`, `--qa-fill-light`, `--qa-fill-med`, `--qa-text`, `--qa-text-2`, `--qa-text-3`, `--qa-text-4`, `--qa-gray-50`, `--qa-gray-100`, `--qa-gray-700`, `--qa-on-text` |
| Global (`--color-*`) | everything else, Tailwind-style pages, chat | `--color-background-primary/secondary/tertiary` (+ `-danger/-warning/-success/-info`), `--color-text-primary/secondary/tertiary` (+ status), `--color-border-tertiary/secondary` |

Plus brand: `--accent` (#2d9e4f), `--accent-hover`, `--accent-active`, `--accent-weak`, `--accent-on`.

Light values: eggshell `#f5f3ee` for `--page-bg`, `--tb-bg`, `--sb-bg` (top bar, sidebar and page blend as one surface), white `--qa-card` / `--color-background-primary` for cards. Dark values live under `[data-theme="dark"]`.

Rules of thumb:
- Page ground = `var(--page-bg)`; cards/tables = `var(--qa-card)` (quality pages) or `var(--color-background-primary)`; muted text = `--qa-text-2` / `--qa-text-3`; borders = `--qa-border` / `--qa-border-sub`.
- `--qa-on-text` is the text colour **on top of** a filled `--qa-text` surface (active period pill, primary dark buttons). Don't use `#fff` there: in dark mode `--qa-text` is light, so white text vanishes.
- A filled dark control in both modes: `background: var(--color-text-primary); color: var(--color-background-primary)` (the chat send button does this).

### Theme switching
- `<html data-theme="light|dark">`. Set before first paint by an inline script in `app/layout.tsx` (saved choice in `localStorage['wint_theme']`, else the OS setting). The toggle is in the top bar.
- `app/dark-theme.css` also remaps common Tailwind colour classes (`bg-white`, `bg-gray-50`, `border-gray-200`, status tints, `hover:` variants) and inline styles with fixed light hex values (`style*="background:#fff"` etc.) so older pages work in dark. New code should use tokens and not rely on these catch-alls.

---

## 2. App shell and navigation

```
app/layout.tsx  ->  <Providers><TopBar/>{children}</Providers>
                    each section layout adds its own sidebar shell
```

### Top bar: `components/shell/TopBar.tsx` + `app/topbar.css`
- Three-column grid (`minmax(0,1fr) auto minmax(0,1fr)`): logo left, **tab pill centred**, theme toggle + account menu right. On phones (<=640px) it becomes `auto 1fr auto` and the pill scrolls horizontally.
- Tabs come from `lib/nav.ts` (pure, unit-tested in `scripts/nav.test.ts`): `topTabs(role, skills)` returns Chat / Analytics / Quality / Settings filtered by skill (`chat:access`, `analytics:access`, `quality:analytics:access`, `settings:manage:access`; admin sees all). `activeTab(pathname)` maps routes to a tab (`/chat`; `/analytics`, `/call-analysis`, `/cx`; `/quality`, `/tl`, `/agent`; `/settings`, `/tokens`).
- Hidden on `/login`, `/setup`, `/set-password` (`isAuthPath`) and when unauthenticated.
- It injects a small `<style>` that subtracts `--topbar-h` (56px) from Tailwind's `h-screen` / `min-h-screen`, so pages sized with those classes still fit.
- Account menu shows name, email, role chip and Sign out.

### Sidebars: `components/RoleShell.tsx`
`RoleShell` renders the left sidebar + `<main>` for a section. Props: `role`, `skills`, `navItems: NavItem[]`, `roleLabel`.

```ts
interface NavItem { label; href; icon; roles?: string[]; skill?: string; section?: string }
```
- Visibility: admin sees every item; others need `roles` to include their role and, if set, the `skill`.
- **Section headings (admin only):** when `role === 'admin'` and an item has `section`, a heading is rendered whenever the section changes between consecutive visible items. The sidebar title (`Admin`) covers the first group; headings are **QA**, **TL**, **IR Agent**. Keep items of one section contiguous in the array.
- CSS classes (in `app/globals.css`): `.quality-shell-sidebar`, `.quality-shell-sidebar-title` (also used for section headings), `.quality-shell-sidebar-link` (+ `.active`), `.quality-shell-main`.

Shell wrappers and their layouts:

| Layout | Shell | Notes |
|---|---|---|
| `app/quality/layout.tsx` | `QualityShell` (`components/quality/QualityShell.tsx`, exports `NAV_ALL`) | roles admin, quality, tl, agent |
| `app/tl/layout.tsx` | `TLShell` (uses the same `NAV_ALL`) | roles admin, tl, agent |
| `app/agent/layout.tsx` | `IRShell` for agents; **`QualityShell` for admin** | so an admin opening "My Quality Emails" keeps the admin sidebar instead of switching to the IR Agent one |

`NAV_ALL` order (keep contiguous per section): Analytics; **QA**: Chat / Call / Email Evaluation; **TL**: Team Analytics, Member Analytics, Quality Chats, Quality Calls, Quality Emails, IR Reports; **IR Agent**: My Analytics, My Quality Chats, My Quality Calls, My Quality Emails, My Reports. `IRShell` has its own short `NAV` (agent view only, includes My Quality Emails).

---

## 3. Shared components

| Component | File | Use |
|---|---|---|
| `PeriodFilter` (+ `DEFAULT_PERIOD`, `PeriodState`) | `components/quality/PeriodFilter.tsx` | 7 days / 30 days / Custom range control (opens `DateRangePicker`). Controlled: `value`, `onChange`. Default 7 days. Pair with `periodBounds()` from `lib/email/ui.ts` to build query params. |
| `TicketLinkButton` | `components/quality/TicketLinkButton.tsx` | Ticket/chat id rendered as a bordered blue "Show chat ↗"-style button that opens `https://app.robylon.ai/unified-inbox/share/{id}` in a new tab. Props: `id` (used for the URL), optional `label` (display text, e.g. a shortened id). Stops click propagation so the row doesn't expand. |
| `EmailMessageView`, `CustomerSummaryBlock`, `EmailHistoryPanel`, `stripHtml`, `sanitizeEmailHtml` | `components/quality/EmailContentRenderer.tsx` | Email body rendering. `EmailMessageView` runs content through `trimEmailBody` (no trailing blank lines/empty blocks) and uses the `.email-html-body` rules in `app/globals.css` (tight paragraphs, no trailing margin). `CustomerSummaryBlock` shows the 4-point customer summary; `EmailHistoryPanel` the prior-interaction history. |
| `DateRangePicker` | `components/quality/DateRangePicker.tsx` | Calendar popover used by `PeriodFilter` and the chat/call tables. |
| `DisputeStatusPill` | exported from `components/tl/QualityChatsPage.tsx` | Dispute label for chats/calls (shared by TL chats, TL calls, My Quality Chats/Calls). Now **plain text**, despite the name. |
| `ParamBadge`, `IQSRing`, `IQSRingCard`, `EvalPanel`, `CallEvalPanel` | `components/quality/` | Older chat/call scoring pieces; not used by the email pages. |

### Helpers: `lib/email/ui.ts` (pure, tested in `scripts/email-ui.test.ts`)

| Function | Purpose |
|---|---|
| `robylonTicketUrl(id)` | Robylon unified-inbox link |
| `Period` (`'7'|'30'|'custom'`), `resolveDateRange(period, from?, to?, now?)` | Inclusive local calendar days; custom without both dates falls back to 7 days |
| `dayBoundsISO(from, to)` | local day start / day end as ISO instants (so "today" is the viewer's today, not UTC's) |
| `periodBounds(period, from?, to?)` | `resolveDateRange` + `dayBoundsISO`; what pages send as `from`/`to` |
| `intentLabel(v)` | Intent L1 for a cell; "—" for empty, "None" or a raw UUID |
| `paramLabel(v)` | Plain label for a stored parameter value: Yes / Half / No / NA, numeric -> `NN%`, missing -> "—" |
| `trimEmailBody(raw)` | Collapse 3+ newlines, drop trailing blank lines / empty `<p>`/`<div>`/`<br>` |
| `disputeLabel(status)` | `Raised` -> "Raised by agent", `Under_Review` -> "Forwarded to QA", `TL_Resolved` -> "Resolved by TL", `Resolved` -> "Resolved by QA", `Rejected` -> "Rejected by QA", else "—" |

---

## 4. Table and page conventions (chat, call and email views)

Follow these on every quality table so views stay consistent.

1. **No coloured pills.** IQS, status, CSAT, compliance and dispute values are plain text (weight/colour from tokens). Done for the email views, Chat Evaluation, Call Evaluation, TL Quality Calls and the shared dispute label. Colour is allowed only for: the active tab / active filter (dark filled pill), the score ring (a chart), message banners (e.g. the compliance-breach box), the Yes/Half/No scoring buttons in the QA panel (controls), and the blue "Show chat ↗" / ticket link buttons.
2. **Column order:** ID first, then Agent, then the data columns, then Action last (right-aligned). Numeric columns (IQS) are right-aligned.
3. **IQS is a whole number.** Postgres returns `numeric` as strings (`"95.00"`); round with `Math.round(Number(x))` before rendering (rings, labels, "Adjusted from …").
4. **CSAT** column shows "—" for emails until email CSAT exists.
5. **Row expansion:** click a row to open an inline drawer (`<tr><td colSpan={n}>`); `colSpan` must equal the column count. Drawer background `--qa-gray-50`, cards `--qa-card` with `--qa-border`.
6. **Tabs** are a pill group: container `--qa-card` + `--qa-border`, active tab `--qa-gray-700` with `#fff` text, count badge `--qa-gray-100` (active: `rgba(255,255,255,.2)`).
7. **Tables** use `tableLayout: fixed` with a `<colgroup>`; header cells are 12px uppercase, 0.08em tracking, `--qa-text-2`, on `--qa-gray-50`.
8. **Period filter** sits top-right of the page header and drives the cards, tab counts and rows together.
9. Don't use emoji in UI text.

---

## 5. Email Quality

### Routes and components

| Route | Component | Audience |
|---|---|---|
| `/quality/email-evaluation` | `components/quality/EmailEvaluationPage.tsx` | QA (admin, quality): review, override scores, resolve disputes |
| `/tl/quality-emails` | `components/tl/TLEmailQualityPage.tsx` | TL/admin: team cards, member table, replies, disputes |
| `/agent/quality-emails` | `components/ir/MyQualityEmailsPage.tsx` | Agent (and admin via the admin shell): own replies, raise disputes |

Data: `GET/POST /api/email-evaluations` (`app/api/email-evaluations/route.ts`) over `email_reply_evaluations` joined to `email_conversations`, with the latest Robylon `Intents_L1` per ticket (`intent_l1`).

### Table columns

| View | Columns |
|---|---|
| QA, Pending Review | Ticket ID, Agent, Intent, IQS, CSAT, Action |
| QA, Reviewed Emails | Ticket ID, Agent, Intent, IQS, CSAT, Reviewed By, Reviewed At, Action |
| QA, Disputes | Ticket ID, Agent, Intent, IQS, CSAT, Dispute, Action |
| QA, Awaiting AI | Ticket ID, Agent, Intent, Action (no IQS yet) |
| TL, replies | Ticket ID, Agent, Intent, IQS, CSAT, Action |
| TL, members | Agent Name, Replies, Avg Score, Disputes, Action (Filter) |
| TL, Disputes Raised | Ticket ID, Agent, IQS, CSAT, Raised, Status, Action (Resolve, Forward to QA, View) |
| TL, Reviewed Disputes | Ticket ID, Agent, IQS, CSAT, Updated, Outcome, Action (View) |
| Agent | Ticket ID, Agent, Intent, IQS, CSAT, Dispute, Action |

QA columns are driven by `TAB_COLS` / `COL_LABEL` / `COL_WIDTH` in `EmailEvaluationPage.tsx`; Ticket ID, Agent and IQS headers are client-side sortable (like the chat QA table). There is deliberately no Sent/Date column, no Status column and no Compliance column in the tables (compliance details stay in the expanded drawer).

### Expanded drawers
- **QA:** customer summary + history, agent outbound reply, IQS ring, compliance badge and breaches, the seven parameters with Yes/Half/No(/NA) buttons and AI reasoning, QA override form, dispute note and resolve controls.
- **TL / agent:** the same seven parameters via `DEFAULT_EMAIL_PARAMETERS` (`lib/email/context-builder.ts`: name, description, aliases, weight) with the plain value from `paramLabel`, the weight (`defaultWeight`, shown as `25%`; the seven add up to 100) and the AI reasoning (`parameter_scores.__reasoning[key]`). Never print raw stored keys.
- Reply boxes size to their content and scroll only past 420px.

### Date range and cards
- Every page sends `from`/`to` (ISO instants from `periodBounds`). The API applies them to the list, the summary cards / tab counts and the per-agent breakdown, all on `sent_at`.
- Summary cards also follow the `agentName` filter (an agent's banner shows their own numbers); the TL member breakdown stays team-wide. Result counts of 0 with a narrow range are expected.

### API (`/api/email-evaluations`)
GET params: `agentName, status, reviewStatus, tab (pending|reviewed|unscored|disputes), maxScore, minScore, complianceFailed, disputesOnly, disputeStatus, disputeQueue (tl_pending|tl_history), ticketId, search, from, to, limit (max 500), offset`. Response: `items`, `summary` (`totalCount, pendingReviewCount, reviewedCount, unscoredCount, completedCount, avgScore, complianceBreachCount, activeDisputesCount, reviewedDisputesCount, qaDisputesCount, tlPendingDisputesCount, tlHistoryDisputesCount, qaOverridesCount`), `agentBreakdown`.

POST `action`: `submit_review`/`qa_override`, `raise_dispute`, `forward_dispute` (TL -> QA), `tl_resolve_dispute` (admin/tl only), `resolve_dispute` (QA), `evaluate_single`, `trigger_batch`. (The UI no longer exposes evaluate_single / trigger_batch buttons; the cron still runs batches.)

### Dispute lifecycle (mirrors chats)

| `dispute_status` | Meaning / who holds it | Label (`disputeLabel`) | Where it shows |
|---|---|---|---|
| `Raised` | agent raised, waiting for the TL | Raised by agent | TL "Disputes Raised" |
| `Under_Review` | TL forwarded to QA | Forwarded to QA | QA "Disputes" tab; TL "Reviewed Disputes" |
| `TL_Resolved` | TL resolved with a note (no QA) | Resolved by TL | TL "Reviewed Disputes"; agent "Reviewed Disputes" |
| `Resolved` / `Rejected` | QA decision | Resolved by QA / Rejected by QA | TL "Reviewed Disputes"; agent "Reviewed Disputes" |

QA only sees disputes after the TL forwards them. Not built for email (exists for chats): dispute comment thread, rows-per-page / pagination.

---

## 6. Chat page (`/chat`)

Look only; behaviour is unchanged. Files: `app/chat/page.tsx`, `components/HomeClient.tsx`, `components/ChatInterface.tsx`, `components/Sidebar.tsx`.
- Page ground `--page-bg` (eggshell), sidebar `--sb-bg`; the composer card is the surface colour (`--color-background-primary`) so it stands out.
- Empty state: serif title (`ui-serif, Georgia`, 40px), muted subtitle, the **composer centred under the title**, then the suggested questions as light rounded chips. Once a conversation starts the same composer docks at the bottom (`composer` const in `ChatInterface.tsx`).
- Composer: one rounded card (26px radius, soft shadow), borderless textarea, paperclip (screenshot attach) bottom-left, round up-arrow send button bottom-right, caption "Wint Wealth · Internal use only" below.
- Sidebar (`Sidebar.tsx`): panel-toggle icon on top, plain "+ New Chat" row, "Recent chats" list, collapses to an icon rail. **Hover does not expand it**; only the toggle does (state in `localStorage['wint_sidebar_collapsed']`). The old header strip was removed.

---

## 7. What changed on this branch (`feat/ui-overhaul-email-quality`)

Base: `origin/main` at PR #296 (SLA breach alert). Commits, oldest first:

| Commit | Change |
|---|---|
| `4197707`, `9c95b6a` | Email Quality backend + QA workflow (7 parameters, status transitions); table cleanup, L1 intent, Robylon ticket links, 7/30/custom period filter wired through the API |
| `dd31535` | UI overhaul squashed: unified top nav (Chat / Analytics / Quality / Settings), eggshell light theme + dark theme, consistent sidebars, theme toggle, route-guard fix for https tunnels (`lib/auth-cookie.ts`), Email entries in the Quality menu; merges the email branch |
| `2d0909a` | Plain IQS/parameter values, CSAT placeholder, shared parameter panel on TL, tighter email preview, local-day date ranges, agent-scoped summary cards |
| `b2ca763` | Email tables aligned with the chat tables (ID first, per-tab QA columns, sortable QA headers, compact TL rows, Agent column on the agent view) |
| `0372451` | Remaining coloured pills removed (TL avg score, QA compliance chips) |
| `b0909c5` | `TicketLinkButton` on the three email tables |
| `f59ca17` | Nav centred; admin keeps the admin sidebar on `/agent/*`; sidebar section headings (Admin / QA / TL / IR Agent) |
| `53dd271` | Coloured pills removed from Chat Evaluation, Call Evaluation, TL Quality Calls (and the shared dispute label) |
| `275c705`, `a818388`, `5539d2e` | Chat page restyle, no hover-to-expand sidebar, eggshell background |
| `7a438eb` | TL dispute tabs for emails; `TL_Resolved` status and `tl_resolve_dispute`; QA sees only forwarded disputes; `disputeQueue` filter and new counts |
| `84bbc19` | Whole-number IQS in the ring/labels; 💡 removed from parameter reasoning |

Behaviour changes worth knowing: QA's email Disputes tab no longer lists agent-raised disputes until forwarded; `Under_Review` is shown as "Forwarded to QA" (it used to read "Pending TL Review" on the agent page); the Run Gemini Batch / per-row Eval buttons are gone from the QA page.

---

## 8. Do / Don't (for AI assistants editing the UI)

- **Do** use tokens, `TicketLinkButton`, `PeriodFilter`, `paramLabel`, `disputeLabel`, `intentLabel`; reuse the column/tab/drawer patterns above.
- **Do** round numeric scores from the API (`numeric` arrives as a string).
- **Do** keep `colSpan` and `<colgroup>` in step with the column list.
- **Do** keep a sidebar item's `section` contiguous in `NAV_ALL`.
- **Don't** add coloured pills/badges to tables, or emoji to UI text.
- **Don't** hard-code `#fff`/`#111` text or backgrounds in new UI; dark mode will break. (Some older files, notably parts of `MyQualityEmailsPage.tsx` and the call pages, still use fixed light hex colours and rely on the dark-theme inline-style overrides.)
- **Don't** make the chat sidebar expand on hover.
- **Don't** put `/agent/*` pages back under `IRShell` for admins.
- **Known leftovers:** coloured pills may remain on TL Quality Chats (IQS cells), My Quality Chats and My Quality Calls; the QA email table has no pagination (API cap 500 rows); email CSAT is a placeholder; the `027` migration number is duplicated between the email and another migration (owner: email backend).

---

## 9. Testing and local verification

- `npx tsc --noEmit`, `npm test` (node:test via tsx; includes `scripts/nav.test.ts`, `scripts/auth-cookie.test.ts`, `scripts/email-ui.test.ts`), `npm run build`. `npm test` currently has 2 known failing tests (SBAC skills) that predate this work.
- Pure UI logic goes in `lib/` with a test in `scripts/`; add it to the `test` script in `package.json`.
- Local dev: `npm run dev` on port 3000. `.env.development.local` should set `AUTH_TRUST_HOST=true` and `NEXTAUTH_URL=http://localhost:3000` (`.env.local` may point `NEXTAUTH_URL` at production, which sends logins to the wrong host). Login rate limiting needs Redis; with Redis blanked the limiter fails closed.
- Tunnels (https): the route guard in `middleware.ts` picks the secure session cookie name from the request protocol (`lib/auth-cookie.ts`); don't revert that.
- UI checks: look at light and dark, a ~375px phone width and ~1360px desktop; read table headers/cells from the DOM when a screenshot is too small; scan for leftover pills by looking for small rounded elements with a non-transparent background inside `tbody`.
