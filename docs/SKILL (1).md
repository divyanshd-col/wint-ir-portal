---
name: code-reviewer
description: Performs a rigorous, evidence-backed code review of a branch, diff, or module — hunting correctness bugs, security holes, architectural mistakes, and missing test coverage, then reporting P0/P1/P2-ranked findings with file:line, fix effort, and a scored 1-10 readiness scorecard. Use this skill whenever the user asks to review code, check a diff, look over a PR or branch, sanity-check changes before merging, asks "does this look right", "any bugs here", "is this safe to ship", "what am I missing", or hands over code for feedback of any kind — even casually, and even if they don't say the word "review".
---

# Code Reviewer

A review is only worth the reader's attention if every finding is real. This skill trades breadth for evidence: fewer findings, each one verified, each one actionable.

## Core contract

1. **Never report a finding you have not verified.** Reading the diff is not verification. See "Verification gate".
2. **Never report style, naming, or formatting.** Not as P2, not as an improvement, not as a footnote. It is deliberately out of scope.
3. **Separate what you proved from what you suspect.** Two different sections. Never blur them.
4. **Every finding carries a fix.** If you cannot articulate the fix, you do not understand the problem well enough to report it.

---

## Step 1 — Resolve scope

Default: **the current branch against its merge base with `main`** (i.e. the full PR scope, not just the last commit).

```bash
git rev-parse --abbrev-ref HEAD
git merge-base HEAD main            # try 'master' / 'develop' if main is absent
git diff --stat $(git merge-base HEAD main)...HEAD
```

Override the default only when the user names something specific ("review `auth/session.py`", "review my uncommitted work" → `git diff`).

If the diff exceeds ~1500 changed lines, do not review it all at equal depth. Rank files by risk — auth, payments, data access, migrations, anything touching user input or external boundaries — review those deeply, and tell the user explicitly which files you reviewed deeply and which you skimmed. Silent partial coverage is worse than no review.

## Step 2 — Establish intent before judgment

You cannot tell whether code is wrong until you know what it is trying to do.

```bash
git log $(git merge-base HEAD main)..HEAD --oneline
```

Read the **full contents** of every changed file, not the diff hunks alone. A hunk shows what changed; only the whole file shows what it broke. Note the intent in one sentence for yourself. If the diff does something the commit messages don't explain, that gap is itself a finding worth raising as a question.

## Step 3 — Hunt

Work through these four lenses. They are ordered by how expensive the bugs are to find later.

### Correctness & edge cases
- Null / undefined / empty-collection paths through new branches
- Off-by-one, boundary conditions, inclusive-vs-exclusive ranges
- Error paths: what happens when the call fails, times out, or returns partial data? Is the failure swallowed?
- Concurrency: shared mutable state, missing await, race between check and use, non-atomic read-modify-write
- Type coercion and implicit conversions at boundaries (see the language references)
- **Behaviour change for existing callers** — the most commonly missed class. See the verification gate.

### Security & data exposure
- Untrusted input reaching a query, command, path, template, or deserializer
- AuthZ checks: is the *object-level* permission checked, not just "is logged in"?
- Secrets, tokens, PII, or internal identifiers appearing in logs, errors, or API responses
- New dependencies, new network egress, new file writes
- See `references/security.md` for the full checklist and the verification technique for each.

### Architecture & design
- Does this change put logic in a layer that will make the next change harder?
- Duplicated logic that now has two sources of truth (grep to confirm the duplicate exists)
- Leaky abstraction: does the caller now need to know internals it shouldn't?
- Coupling introduced across module boundaries that were previously clean
- Reversibility: is this a one-way door (schema, public API, data migration) being walked through casually?

Architectural findings are the ones most likely to be wrong in a way that wastes the author's time. Hold them to a higher bar: state the concrete future change that becomes expensive, not a principle.

### Test coverage & testability
- Which new branches have no test exercising them? Name them specifically.
- Do the new tests assert on behaviour, or do they assert the implementation back to itself (mocks returning the value being tested)?
- Is the failure path tested, or only the happy path?
- Is the new code testable at all — hard-coded clock, direct instantiation, hidden I/O?

## Step 4 — Verification gate

**No finding leaves this step without evidence.** For each candidate finding, run the check that could disprove it:

| Candidate finding | Required verification |
|---|---|
| "This breaks existing callers" | `grep`/`rg` for every call site; read them; confirm the breakage |
| "This value can be null/None here" | Trace the value to its origin; confirm no guard exists upstream |
| "This isn't covered by tests" | Search the test suite for the symbol/branch before claiming it |
| "This duplicates logic in X" | Open X and confirm the logic is genuinely the same |
| "This is a security hole" | Trace the untrusted input from entry point to sink, naming each hop |
| "This is slower / N+1" | Find the loop and the call inside it; confirm it's per-iteration |
| Anything the test suite can settle | Run the relevant tests, targeted — not the whole suite |

If verification disproves the candidate, drop it silently. Do not report it hedged.
If verification is **impossible** (needs runtime data, needs product context, needs the author's intent), the item does not become a finding — it moves to the **Open questions** section as a question addressed to the author.

## Step 5 — Assign priority

Priority is set by **consequence alone** — what happens if this ships unfixed. Fix effort is reported separately as a tag so the reader can make their own opportunity-cost call; effort never moves the P-level, because effort cannot be verified the way consequence can.

- **P0 — fix now, before merge.** Will cause incorrect behaviour, data loss, or security exposure in production. Reachable on a path real users take. Merging this is a mistake.
- **P1 — fix this sprint.** Real defect, bounded blast radius: rare path, degraded performance, missing coverage on meaningful logic, or a one-way-door design choice that gets more expensive the longer it sits. Ships, but does not sit in the backlog.
- **P2 — backlog.** Genuine and worth doing eventually; nothing breaks if it never happens this quarter. **Cap at five.** More than five means you are reporting noise — keep the five that matter, drop the rest.

Decision rule when torn between two levels: ask *what breaks if this ships*. If the answer needs a hypothetical the code does not support, drop a level. If it needs no hypothetical at all, raise one.

Tag each finding with fix effort: **trivial** (a few lines, localized), **moderate** (one module, needs tests), **large** (cross-cutting or schema/API change). State it plainly; do not estimate in hours.

Format each finding exactly like this:

```
[P0] [effort: trivial] src/api/orders.ts:142
Refund amount is not clamped to the original charge

A negative `amount` in the request body passes validation (schema only checks
`typeof number`) and reaches `stripe.refunds.create`, which will reject it — but
the local ledger row at :158 is written first and is not rolled back.

Evidence: traced `amount` from the handler at :121 through `validateRefund`
(src/api/validators.ts:44) — no lower-bound check. `ledger.insert` at :158
precedes the Stripe call at :163 with no transaction wrapping the two.

Fix: validate `amount > 0 && amount <= charge.amount` in `validateRefund`, and
move the ledger write after a successful Stripe response (or wrap both in a
transaction with compensating rollback).
```

## Step 6 — Score

Score the change on four dimensions, then derive one overall number. The question being scored is **"is this safe and maintainable as merged"** — not "is this beautiful," not "how does it compare to ideal code."

Score each of the four hunt lenses out of 10 using these anchors:

| Range | Meaning |
|---|---|
| 9–10 | No findings on this dimension. Edge cases and failure paths handled deliberately, and you can point to where. |
| 7–8 | Sound. At most P2 findings here. Nothing a reader needs to act on this sprint. |
| 5–6 | One or more P1s. Works for the expected path; will need attention. |
| 3–4 | A P0, or several P1s clustering into one weak area. |
| 1–2 | Multiple P0s on this dimension, or the dimension is simply absent (e.g. no tests at all on new logic). |

**Floor rules — these override the anchors, always:**
- Any P0 anywhere caps the **overall** score at 4.
- Any P0 on a dimension caps **that dimension** at 3.
- Three or more P1s cap the overall at 6.
- No dimension you could not assess scores above 7 — mark it `n/a` instead and say why. Never award points for something you did not check.

Overall = the mean of the four, then apply the floor rules. Show your arithmetic in one line so the number is auditable rather than vibes.

```
Correctness 4/10 · Security 8/10 · Architecture 7/10 · Tests 5/10
Overall 4/10 — mean 6.0, capped at 4 by the P0 at orders.ts:142
```

If you find yourself wanting to award a 7 to everything, that is the failure mode this rubric exists to prevent. Pick the anchor that matches the findings you actually wrote down.

## Step 7 — Improvements

Separate from findings. Findings are defects; improvements are things that are not wrong but would raise a dimension score. Strict rules, because this section is the most likely place for noise to re-enter:

- **Maximum three.** Not a list of everything possible — the three with the best ratio of score gained to effort spent.
- Each must **name the dimension it raises and the new score**, e.g. "Tests 5 → 8". If you cannot say which number moves, it is not an improvement, it is an opinion. Drop it.
- Each must state the effort tag, same scale as findings.
- **Nothing that is purely taste.** Renaming, extraction for its own sake, formatting, structure preferences — still out of scope here, exactly as in the findings.
- If the code is already 8+ across the board, write "none worth the effort" and stop. Manufacturing improvements to fill the section is the same failure as manufacturing findings.

Order them by score-gained-per-effort, best first, so the top of the list is the thing worth doing today.

## Step 8 — Report structure

1. **Verdict** — one line: what this change does, and whether it is safe to merge as-is.
2. **Scorecard** — the four dimensions, the overall, and the one-line arithmetic.
3. **P0**, **P1**, **P2** — findings in the format above, each with its effort tag.
4. **Improvements** — up to three, each with the score it moves.
5. **Open questions** — unverifiable concerns, phrased as questions to the author. Clearly marked as *not* findings and *not* scored.
6. **What I checked and didn't flag** — 2–4 lines. Name the risky areas you examined that turned out fine, and any files you only skimmed. This is what makes a clean review trustworthy rather than lazy-looking.

If the change is genuinely sound, say so plainly, score it honestly high, and keep section 6. Do not manufacture findings to justify the review.

---

## Anti-patterns — do not do these

- Restating what the code does back to the author as though it were insight
- "Consider adding error handling" with no specific failure named
- Flagging a missing null check without tracing whether null can actually arrive
- Hedged findings: "this might potentially cause issues in some cases"
- Style, naming, formatting, import order, comment density — out of scope, always
- Suggesting a rewrite of code that works, on taste grounds
- Padding a clean review with P2s so it looks thorough
- Scoring 7/10 by default because it feels safe — the anchors exist to stop this
- A scorecard that does not move when a P0 is present
- Using the Improvements section to smuggle in style, naming, or extraction preferences
- Letting fix effort change a finding's P-level

## Language references

Read the one that matches the diff — do not read both:

- `references/typescript.md` — TS/JS-specific failure modes and verification commands
- `references/python.md` — Python-specific failure modes and verification commands
- `references/security.md` — read whenever the diff touches input handling, auth, queries, files, or external calls
