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

Plus brand: `--accent` (light `#1f7a4d`, dark `#4cc287`), `--accent-hover`, `--accent-active`, `--accent-weak`, `--accent-on`.

Semantic status tokens (Chat Evaluation reference, both themes): `--pass` / `--pass-soft`, `--fail` / `--fail-soft`, `--marker` / `--marker-fg` (blue: **focus outlines and change markers only**), `--ink` / `--ink-fg` (primary action and active chips: use this pair instead of `#fff` on a `--qa-gray-700` fill), `--sunk` (recessed filter bars and notes), `--line` / `--line-strong`, `--faint` (low-priority text).

Light values: muted gray-green `#f5f6f4` for `--page-bg`, `--tb-bg`, `--sb-bg` (top bar, sidebar and page blend as one surface), white `--qa-card` / `--color-background-primary` for cards. Muted / faint text are `#4f584f` / `#667066` (the reference's `#5f685f` / `#8a938a` measured 2.8-3.2:1 on white; these pass AA and stay three distinct tiers). Dark values live under `[data-theme="dark"]` (below).

### Dark palette (Chat Evaluation reference)
Dark mode is a deep green-black with green-tinted surface steps and a brighter green accent, taken from `Chat Evaluation Redesign.html`. Values live in `[data-theme="dark"]` in `app/dark-theme.css`. (This replaces the earlier brand-black scheme; green = pass, red = breach, blue = focus/markers.)

| Role | Value | Notes |
|---|---|---|
| Page background (`--page-bg`, `--qa-bg`, `--background`) | `#121512` | darkest |
| Sunk / sidebar (`--sunk`, `--sb-bg`) | `#151815` | filter bars, internal notes |
| Card / top bar (`--qa-card`, `--color-background-primary`, `--tb-bg`) | `#1a1e1a` | |
| Raised (`--qa-gray-50`) | `#1e231e` | table headers, drawers |
| Fill (`--qa-fill-light`, `--qa-gray-100`, `--color-background-secondary`) | `#222722` | |
| Hover (`--color-background-tertiary`) | `#272d27` | |
| Lines (`--line`, `--qa-border`) / strong (`--line-strong`) | `#2b312b` / `#3c443c` | |
| Text / muted / faint | `#e7ebe6` / `#a3ada2` / `#818b80` | faint nudged from the reference `#7a8479` to stay >= 4.5:1 on a card. `--qa-text-4` (disabled) is `#5a645a`. |
| Accent (`--accent`) / links (`--accent-active`) | `#4cc287` / `#7be0a8` | |
| Accent hover / tint (`--accent-hover`, `--accent-weak`) | `#62cf98` / `#1c3326` | |
| Text on green (`--accent-on`) | `#0b1a11` | |
| Pass / fail (+ soft) | `#4cc287` `#1c3326` / `#f07167` `#3a1d1a` | |
| Marker (blue) | `#7c94f5` | focus ring + change markers |

### Why old pages work in dark mode (what `dark-theme.css` covers)
Most pages predate the tokens and hard-code light colours, so the dark layer catches them. Know what exists before adding more:
- **Tailwind classes:** `bg-white`, `bg-gray/slate/stone-50..200`, borders, text greys, status tints, hover variants, `disabled:` variants, plus every colour family (indigo, violet, pink, teal, cyan, sky, lime, orange ... shades 50-950 and their `/50`-style opacity variants).
- **Inline styles in two forms:** the hex form (`background:#fff`, as server-rendered) **and** the `rgb(r, g, b)` form (what the browser writes back once React updates an element). A rule for only one form silently misses half the elements.
- **Filled controls:** anything filled with `--qa-gray-700` or `--qa-text` (a light fill in dark) gets `--qa-on-text` text, so hard-coded white labels on active tabs, Submit buttons and selected answers stay readable. Count badges inside them get a dark tint.
- **Transcript bubbles** filled with `--qa-gray-700` keep a light fill with dark text (the executive side), investor bubbles stay dark.
- **HTML email bodies** (`.email-html-body`) have the sender's own colours neutralised (transparent backgrounds, light text, accent links), since emails ship dark text and white boxes.
- **Internal Slack notes** (`.email-internal-note-content`) use the warning tint with warm text.

To check a page: toggle dark, open each tab and expand a row, and look for light surfaces and text below ~3:1 contrast against its background (the dark sweep did this with a small script over `getComputedStyle`). New code should still use tokens instead of relying on these catch-alls.

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
- **Responsive:** <=1100px the sidebar is a 64px icon rail (labels stay in the DOM as `.quality-shell-sidebar-label`, visually hidden, plus a `title` tooltip); <=560px it becomes a scrolling icon strip above the content (the reference hides it; the strip keeps every page reachable).
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
| `PeriodFilter` (+ `DEFAULT_PERIOD`, `PeriodState`) | `components/quality/PeriodFilter.tsx` | All / 7 days / 30 days / Custom range control (opens `DateRangePicker`). Controlled: `value`, `onChange`. Default All (`'all'`). Pair with `periodBounds()` from `lib/email/ui.ts` to build query params. |
| `TicketLinkButton` | `components/quality/TicketLinkButton.tsx` | Ticket/chat id rendered as a bordered blue "Show chat ↗"-style button that opens `https://app.robylon.ai/unified-inbox/share/{id}` in a new tab. Props: `id` (used for the URL), optional `label` (display text, e.g. a shortened id). Stops click propagation so the row doesn't expand. |
| `EmailMessageView`, `CustomerCoreQueryCard`, `CustomerEmailThreadCard`, `CustomerSummaryBlock`, `EmailHistoryPanel`, `stripHtml`, `sanitizeEmailHtml` | `components/quality/EmailContentRenderer.tsx` | Email body rendering. `EmailMessageView` runs content through `trimEmailBody` (no trailing blank lines/empty blocks) and uses the `.email-html-body` rules in `app/globals.css` (tight paragraphs, no trailing margin). `CustomerCoreQueryCard` renders the prominent, synthesized user intent; `CustomerEmailThreadCard` renders the inbound email thread separately with proper spacing and collapsible controls; `CustomerSummaryBlock` is the composite wrapper; `EmailHistoryPanel` shows prior-interaction history. |
| `usePaging`, `ShowingCount`, `Pager` | `components/quality/TablePaging.tsx` | Client-side paging for the email tables, same look as the chat tables: `ShowingCount` = "Showing X of N" + rows-per-page button (20/50/100) at the right end of the filter bar; `Pager` = "Page x of y" + Prev/Next footer (hidden on one page); `usePaging(items, resetKey)` slices the rows and returns to page 1 when `resetKey` changes. Pure helpers `pageSlice` / `pageCount` live in `lib/email/ui.ts`. |
| `ParamScoreRow` | `components/quality/ParamScoreRow.tsx` | One evaluation parameter laid out like the chat evaluation panel: name on the left, Yes / Half / No (/ NA) buttons and the weight (`25%`) on the same line, the AI reasoning underneath (no description; it is the name's tooltip). Pass `onChange` to make it editable (QA email drawer); without it the buttons are a read-only display with the selected answer highlighted and the rest dimmed (TL and agent drawers). A value that is none of the four (missing, numeric) shows as text. Used for every parameter list on the email pages. |
| `ScoreRing` | `components/quality/ScoreRing.tsx` | Neutral IQS ring (64px, whole-number score, dash when unscored) used in the agent and TL email detail panels; token colours so it works in dark mode. The QA email page keeps its own colour-coded ring. |
| `DateRangePicker` | `components/quality/DateRangePicker.tsx` | Calendar popover used by `PeriodFilter` and the chat/call/email tables. |
| `DisputeStatusPill` | exported from `components/tl/QualityChatsPage.tsx` | Dispute label for chats/calls (shared by TL chats, TL calls, My Quality Chats/Calls). Now **plain text**, despite the name. |
| `ParamBadge`, `IQSRing`, `IQSRingCard`, `EvalPanel`, `CallEvalPanel` | `components/quality/` | Older chat/call scoring pieces; not used by the email pages. |

### Helpers: `lib/email/ui.ts` (pure, tested in `scripts/email-ui.test.ts`)

| Function | Purpose |
|---|---|
| `robylonTicketUrl(id)` | Robylon unified-inbox link |
| `Period` (`'all'\|'7'\|'30'\|'custom'`), `resolveDateRange(period, from?, to?, now?)` | Inclusive local calendar days; 'all' returns empty bounds; custom without both dates falls back to 7 days |
| `dayBoundsISO(from, to)` | local day start / day end as ISO instants (so "today" is the viewer's today, not UTC's) |
| `periodBounds(period, from?, to?)` | `resolveDateRange` + `dayBoundsISO`; what pages send as `from`/`to` (empty if 'all') |
| `intentLabel(v)` | Intent L1 for a cell; "—" for empty, "None" or a raw UUID |
| `paramLabel(v)` | Plain label for a stored parameter value: Yes / Half / No / NA, numeric -> `NN%`, missing -> "—" |
| `paramChoice(v)` | Which button a stored value selects: `'yes' \| 'half' \| 'no' \| 'na'` (accepts pass/partial/fail/n/a), else `null` |
| `pageSlice(items, page, size)`, `pageCount(total, size)` | One page of rows (1-based, out-of-range clamps to the last page) and the page count (min 1) |
| `trimEmailBody(raw)` | Collapse 3+ newlines, drop trailing blank lines / empty `<p>`/`<div>`/`<br>` |
| `disputeLabel(status)` | `Raised` -> "Raised by agent", `Under_Review` -> "Forwarded to QA", `TL_Resolved` -> "Resolved by TL", `Resolved` -> "Resolved by QA", `Rejected` -> "Rejected by QA", else "—" |

---

## 4a. Page layout template (all quality list pages)

Every chat, call and email page, for every persona (QA, TL, agent), uses the same vertical order and slots. Email pages follow it too:

```
1. Header        h1 (24px / 600), optional subtitle (13px --qa-text-2). No controls here.
2. Tab row       tabs on the LEFT; ONE control on the RIGHT
                   chats/calls: the Interaction / agent dropdown
                   emails:      PeriodFilter (7 days / 30 days / Custom)
3. KPI cards     emails only (TL and agent), Evaluated tab only, between the tab row and the table
4. One card      [ filter bar | table | pager ]  in a single bordered card
                   filter bar: filters on the left; "Showing X of N" + rows-per-page button at the right
                   table:      ID, Agent, ..., Action (see section 4)
                   footer:     Pager (Prev / Next), only when more than one page
```

**Detail drawer (row expansion):** the evaluation is on the **left** (score ring/header, parameter list with values, weights and reasoning, QA notes / override) and the conversation is on the **right** (customer context, the agent's reply, history). This is how chat and call evaluations lay out, and it applies to the QA, TL and agent email drawers alike (QA/TL grid is `1fr 1.2fr`, agent left pane is a fixed 480px). Don't put the conversation on the left.

How each email page maps to it:

| Page | Header | Tabs (left) | Right slot | Card |
|---|---|---|---|---|
| QA `Email Evaluation` | title only (like Chat/Call Evaluation) | Pending Review, Disputes, Reviewed Emails, Unscored Emails | PeriodFilter | search + agent select + Reset Filters, count, table, pager |
| TL `Quality Emails` | title + subtitle | Evaluated Emails, Disputes Raised, Reviewed Disputes | PeriodFilter | Evaluated tab: KPI cards, member table (email-specific), then card with agent select, count, table, pager. Dispute tabs: agent/outcome filters, count, table, pager |
| Agent `My Quality Emails` | title + subtitle | Evaluated Emails, Disputes Raised, Reviewed Disputes | PeriodFilter | KPI cards (Evaluated tab), then search + compliance select, count, table, pager |

Page wrappers: QA and TL pages are a plain `<div>` (full width of `<main>`, same left edge as the chat pages; no max-width or extra padding). The agent pages keep their shared wrapper (`padding: 24`), as the agent chat/call pages do.

**Rename rule:** this layout is UI only. Never rename API actions or params, DB columns/statuses, tab state keys (`'pending' | 'reviewed' | 'disputes' | 'unscored'`, `'evaluated' | 'raised' | 'reviewed'`), prop names or exported component/function names to "match" the chats; only the visible text and placement change. (Example: the QA tab keyed `unscored` is labelled "Unscored Emails"; the page title "Email Evaluation" matches the sidebar item.)

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
8. **Period filter** sits at the right of the tab row (the slot the chat pages use for their dropdown) and drives the cards, tab counts and rows together.
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
- **QA** (evaluation left, conversation right): IQS ring, compliance badge and breaches, the seven parameters with buttons and AI reasoning, QA override form; on the right the customer summary + history, agent outbound reply, compliance badge and breaches, the seven parameters with Yes/Half/No(/NA) buttons and AI reasoning, QA override form, dispute note and resolve controls.
- **TL / agent:** a header card (ring via `ScoreRing`, agent name, ticket id and date), then the same seven parameters via `DEFAULT_EMAIL_PARAMETERS` (`lib/email/context-builder.ts`: name, description, aliases, weight) as `ParamScoreRow`s (read-only buttons with the selected answer highlighted, the weight `defaultWeight` shown as `25%`, the seven add up to 100, and the AI reasoning underneath) (`parameter_scores.__reasoning[key]`). Never print raw stored keys.
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

QA only sees disputes after the TL forwards them. Not built for email (exists for chats): dispute comment thread.

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
| `c5eb13b`, `6f2acba` | Parameter weights (%) and the IQS ring + header card in the TL detail panel (shared `ScoreRing`) |
| `ec215c7` | Email pages follow the chat/call page template: title/subtitle only, tabs left + PeriodFilter right, one card with filter bar + table + pager, KPI cards on the Evaluated tab, QA tab order and labels as in chats, client-side paging (`TablePaging`) |
| `9e10b3a` | Email detail drawers: evaluation (ring + parameters) on the left, conversation on the right, as in chats (QA and TL swapped; agent already matched) |
| `521766c` | Parameter rows in all three email drawers use the chat layout via the shared `ParamScoreRow` (name + buttons + weight on one line, reasoning below; QA editable, TL/agent read-only) |
| `17d82f5` | QA Accept / Reject Dispute buttons now show on forwarded (`Under_Review`) disputes; `resolve_dispute` SQL got explicit type casts (it failed with "inconsistent types deduced for parameter $1", so QA could never resolve an email dispute) |
| `5f2b68b` | Member Analytics "Viewing" dropdown: height capped and scrolls inside (167 agents ran off the page); active period pill text uses `--qa-on-text` so it shows in dark mode |
| `399312f` | Dark mode uses the Wint brand scheme: neutral black surface steps, brand green `#05a54b` accent with black text on green, old hard-coded green remapped in dark (see "Dark palette") |
| (this change) | Dark-mode sweep of every Quality page (QA, TL, agent) and their tabs/drawers: rgb-form inline catch-alls, filled-control text, HTML email and note callouts, Tailwind colour families, disabled states, readable faint text |

Behaviour changes worth knowing: QA's email Disputes tab no longer lists agent-raised disputes until forwarded; `Under_Review` is shown as "Forwarded to QA" (it used to read "Pending TL Review" on the agent page); the Run Gemini Batch / per-row Eval buttons are gone from the QA page.

---

## 7a. Evaluation panel and queue pattern (`GO` branch)

Source of truth: `Chat Evaluation Redesign.html`. Classes live in the "Evaluation panel" block of `app/globals.css`.

- **Panel layout** (`EvalPanel.tsx`): `.eval-wrap` is a grid, transcript left (1.35fr) and scoring right (1fr), DOM order = visual order. Below 980px the panes stack (transcript capped at 440px) and `.eval-panel-cell` stops clipping so the footer can stick to the page. `CallEvalPanel.tsx` already had transcript-left and only adopts the gates/footer pattern.
- **Gates**: `.eval-gates` (+ `.failed`), rows `.eval-gate`, control `.eval-seg.gate` with `Pass` / `Breach` / `NA` (values stay `pass` / `fail` / `not_applicable`). Any breach: card + footer turn red, chip reads `GATE BREACHED`, submit reads `Submit as failed`. In chat evaluation the displayed Agent IQS drops to 0 while editing (display only; the stored score is still the computed one).
- **Graded parameters**: neutral `.eval-seg` (selected = `--ink`), weight as `.eval-weight`.
- **Sticky footer**: `.eval-foot` at the bottom of the scoring pane: score + gate chip, optional "Mark for KB change", Submit. Close is the icon button in the scoring header, away from Submit.
- **Internal notes**: `<details class="eval-note">`, collapsed, `--sunk`, secrets masked by `maskText` / `renderMasked` (`ck_live_...`, JWTs).
- **Rubric tabs**: `.eval-rtab[aria-selected]` (underline uses `--qa-text`; the old `--qa-primary` was never defined, so no underline rendered).
- **Queue pages**: tabs are underlined (`tabStyle` in each page, hairline tab bar, count chip on `--ink`); the interaction select is `AgentFilterSelect` rendered through each table's `leadingFilter` slot; filter bars sit on `--sunk`; chat tables show Agent IQS first (bold) and Bot IQS muted; the Status column only shows when a re-opened chat is listed.

## 8. Do / Don't (for AI assistants editing the UI)

- **Do** use `var(--ink)` / `var(--ink-fg)` for filled neutral chips and buttons, `--pass` / `--fail` for status, and `--marker` only for focus and change markers.
- **Do** use tokens, `TicketLinkButton`, `PeriodFilter`, `paramLabel`, `disputeLabel`, `intentLabel`; reuse the column/tab/drawer patterns above.
- **Do** round numeric scores from the API (`numeric` arrives as a string).
- **Do** keep `colSpan` and `<colgroup>` in step with the column list.
- **Do** keep a sidebar item's `section` contiguous in `NAV_ALL`.
- **Don't** add coloured pills/badges to tables, or emoji to UI text.
- **Don't** hard-code `#fff`/`#111` text or backgrounds in new UI; dark mode will break. (Some older files, notably parts of `MyQualityEmailsPage.tsx` and the call pages, still use fixed light hex colours and rely on the dark-theme inline-style overrides.)
- **Do** cap any dropdown/popover list that can grow (agents, dispositions): `maxHeight: 'min(360px, calc(100vh - 220px))'`, `overflowY: 'auto'`, `overscrollBehavior: 'contain'`, so it scrolls inside the panel instead of running off the page (the Member Analytics "Viewing" agent list has ~170 entries).
- **Don't** make the chat sidebar expand on hover.
- **Don't** put `/agent/*` pages back under `IRShell` for admins.
- **Known leftovers:** coloured pills may remain on TL Quality Chats (IQS cells), My Quality Chats and My Quality Calls; email tables page client-side over at most 500 rows (the API cap), not server-side; email CSAT is a placeholder; the `027` migration number is duplicated between the email and another migration (owner: email backend).

---

## 9. Testing and local verification

- `npx tsc --noEmit`, `npm test` (node:test via tsx; includes `scripts/nav.test.ts`, `scripts/auth-cookie.test.ts`, `scripts/email-ui.test.ts`), `npm run build`. `npm test` currently has 2 known failing tests (SBAC skills) that predate this work.
- Pure UI logic goes in `lib/` with a test in `scripts/`; add it to the `test` script in `package.json`.
- Local dev: `npm run dev` on port 3000. `.env.development.local` should set `AUTH_TRUST_HOST=true` and `NEXTAUTH_URL=http://localhost:3000` (`.env.local` may point `NEXTAUTH_URL` at production, which sends logins to the wrong host). Login rate limiting needs Redis; with Redis blanked the limiter fails closed.
- Tunnels (https): the route guard in `middleware.ts` picks the secure session cookie name from the request protocol (`lib/auth-cookie.ts`); don't revert that.
- UI checks: look at light and dark, a ~375px phone width and ~1360px desktop; read table headers/cells from the DOM when a screenshot is too small; scan for leftover pills by looking for small rounded elements with a non-transparent background inside `tbody`.
