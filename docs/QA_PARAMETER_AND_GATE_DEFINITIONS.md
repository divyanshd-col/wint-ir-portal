# IQS Parameters & Compliance Gate — As Currently Built

**Scope:** exactly what the system on `main` uses today to score chats (agent leg + BOT leg) and calls, and how the compliance gate decides YES / NA / FAIL.
**Purpose:** QA reads this end to end and comments where the definition should change.
**Nothing in this document is a proposal.** It is a readout of the code as it stands.

**How to comment:** every section has a § number. Reference it in your comment (e.g. "§4.3 — this bar is too strict") so changes can be traced back to a single definition.

**Where this comes from in the backend:**

| Area | File |
|---|---|
| Chat scoring — agent + BOT parameters, chat compliance | `lib/scoring/prompt_v4.ts` |
| Chat scoring orchestration | `lib/scoring/engine.ts` |
| Call compliance gate (G1/G2/G3) + call parameters | `lib/scoring/call-pipeline.ts` |
| Legacy prompt (still used for one path, see §9.6) | `lib/quality.ts` |
| Parameter name mapping | `lib/param-keys.ts` |

---

## §1 How a chat gets scored

A chat is classified into one of three types, and each **leg** is scored separately by its own prompt pass.

| Type | What happened | Scores produced |
|---|---|---|
| **Type 1** | BOT handled and closed the chat, no human | 1 score — BOT rubric, *full chat* mode |
| **Type 2** | BOT started, transferred to a human, resolved over text | 2 scores — BOT rubric (*escalated leg*) + Agent rubric |
| **Type 3** | BOT + human + one or more voice calls | The 2 above, **plus one separate Call IQS per call** |

Key rules that follow from this:

- The **agent is scored only on their own text turns, from handover onward.** The BOT's earlier messages are context, not the agent's responsibility.
- The **BOT is scored only up to and including the transfer.** Automated follow-up nudges sent after the transfer are treated as system plumbing and are never scored for or against the BOT.
- **Calls are never scored inside the chat rubric.** Call transcripts are passed in as context only. Call quality is a separate score (§8).
- The overall IQS **percentage is calculated in code, not by the model.** The model only returns per-parameter scores; the maths is deterministic (§5).
- If there is no substantive interaction (a customer message with no reply, an instant drop, only system lines), **every parameter is set to NA** and no score is fabricated.

---

## §2 The three states every parameter ends in

This is the single most important section for reading a scorecard correctly, because **two different things both display as "NA".**

| State | What it means | Displays as | Needs QA to check? |
|---|---|---|---|
| **Scored** | The evaluator could judge it | Yes / Half / No | No |
| **Not Applicable** | The parameter genuinely does not apply — its trigger never fired | NA | **No** |
| **Unsure** | The parameter *does* apply, but the evidence isn't in the chat | NA (flagged) | **Yes** |

- *Not Applicable* examples: Empathy on a calm chat, DissatisfactionHandling on a happy customer, PostCallRecap when no call happened.
- *Unsure* examples: a call happened but no call transcript is available; a claim depends on system data the evaluator cannot see. In this case the comment must contain **a specific question a human QA reviewer can actually answer**, not "was this okay".
- **Both NA states are excluded from the score entirely** — from the numerator *and* the denominator. An NA never helps and never hurts.
- "Unsure" is only for *"I cannot evaluate this at all."* If the evaluator is merely unsure **how good** something was, the instruction is to **give benefit of the doubt and score higher** — not to mark NA.
- Unsure is only raised when the answer would actually change the score. If even the worst-case answer wouldn't lower it, it gets scored and moves on.

Parameters flagged Unsure are listed in `review_parameters`, which is what drives the "needs review" queue.

---

## §3 Rules that apply to every parameter (chat)

These guardrails sit above the individual definitions and override them.

- **§3.1 Read the whole transcript first.** Decisive details often appear late — a correction, a closing, a follow-up.
- **§3.2 Language is never penalised.** Hinglish, Hindi, mixed scripts, transliteration — no parameter is lowered for language mix. Only clarity of meaning is judged, never English purity.
- **§3.3 Parameters stay independent.** One problem must not cascade into several low scores. A factual error lowers Accuracy *only*. Each parameter's reasoning may discuss only its own criteria, and may not name another parameter.
- **§3.4 Internal checks are invisible and are not penalised.** Agents don't narrate internal tool checks (Finder, order status, SIP state) to customers. Accuracy is **not** lowered because the agent didn't say "I checked and confirmed X". Only a provably wrong visible answer or action lowers Accuracy.
- **§3.5 Internal notes are not scored.** Internal notes, Slack links and internal tool URLs are not part of the customer conversation. On `main` the instruction is to **ignore them completely — not even as context**, and the pipeline strips them before scoring.
- **§3.6 Prior conversations earn leniency.** If the chat references an earlier conversation ("previous chat", "as discussed earlier", "last time"), Accuracy and IssueResolution are judged leniently, because the missing context may live in that earlier chat.
- **§3.7 Media is evidence.** Screenshots are checked against the agent's guidance. An unreadable image is ignored. **Internal-tool screenshots sent to a customer are an error** — a compliance breach if they expose personal data, otherwise a professionalism error lowering IssueResolution.
- **§3.8 Dates.** Today's date is supplied. A date on or before today has already happened and must not be treated as a missed future commitment.
- **§3.9 Grading the 0 / 0.5 / 1 parameters** — decided in this order:
  1. Core purpose succeeded with no gap a QA reviewer would coach → **1**
  2. Core handled but with **one specific, nameable gap** → **0.5**
  3. Core purpose clearly failed in a specific, nameable way → **0**

  The exact gap (for 0.5) or failure (for 0) **must be stated in the comment. If it cannot be named, the score is 1.**

---

## §4 Agent (human) chat parameters

Ten parameters. Weights are relative, not percentages — see §5.

| # | Parameter | Weight | Scale | Conditional? |
|---|---|---|---|---|
| 4.1 | IssueResolution | 25 | 0 / 0.5 / 1 | No |
| 4.2 | Accuracy | 20 | 0 / 0.5 / 1 | No |
| 4.3 | ExpectationFollowThrough | 20 | 0 / 0.5 / 1 | No |
| 4.4 | Personalization | 10 | 0 / 0.5 / 1 | No |
| 4.5 | DissatisfactionHandling | 10 | 0 / 0.5 / 1 | Yes → NA |
| 4.6 | Empathy | 5 | 0 / 0.5 / 1 | Yes → NA |
| 4.7 | EscalationDecision | 5 | 0 / 1 | Yes → NA |
| 4.8 | PostCallRecap | 5 | 0 / 1 | Yes → NA |
| 4.9 | Readability | 3 | 0 / 1 | No |
| 4.10 | GreetingHandover | 2 | 0 / 1 | No |

### §4.1 IssueResolution — 25
Did the agent address **every** question raised (including questions raised during the BOT phase and left unanswered) and either resolve the issue or correctly move it forward.
- **1** — all questions handled; issue resolved or correctly progressed (ticket raised, escalated, call arranged)
- **0.5** — main issue handled but a secondary question dropped, or progressed with no clear next step
- **0** — the core question went unanswered, or an open issue was closed without resolving or escalating
- **Critical:** if resolution moved to a call or an offline step, **that is a valid resolution.** Not lowered because the outcome isn't visible in the chat text.

### §4.2 Accuracy — 20
Were the factual claims correct per the Wint KB and policy (product rules, timelines, tax and form guidance, process steps, amounts).
- **Judged on the FINAL answer the customer was left with.** If the agent said something wrong earlier and corrected it, and the final answer matches KB, **Accuracy can still be 1.** The change itself is not an Accuracy failure — it is recorded in the Answer Change Gate (§6.3).
- **1** — final claims accurate
- **0.5** — minor inaccuracy that does not change the customer's decision or action
- **0** — a clearly wrong final fact, amount, rule or process step that a KB check would contradict
- **Call-only error cap:** an uncorrected error appearing **only** in a call transcript, not corroborated in text and not repeated, **caps Accuracy at 0.5 — never 0 — and must be flagged Unsure.** Reason: call transcripts are AI-generated and may misattribute speakers or words. An error corroborated in the agent's text, or repeated, takes the full penalty.
- Serious misleading or regulatory errors go to the compliance breach list (§6), not here.

### §4.3 ExpectationFollowThrough — 20
Does the customer leave knowing what happens next, and does the closing fit the real state of the issue.
- **1** — clear timeline or next step where needed, closing matches the outcome
- **0.5** — next step given but vague, or closing slightly off
- **0** — customer asked "when" and got nothing, or the chat closed cheerfully on an unresolved or anxious issue
- **Scope:** this is about *whether* a next step was communicated. Whether the timeline quoted was **correct** is Accuracy.

### §4.4 Personalization — 10
Was the response built around this customer's situation.
- **1** — references the customer's actual bond, amounts, dates or account state; on escalated chats, uses what the BOT already gathered instead of asking the customer to repeat it
- **0.5** — mostly relevant but leans generic where specifics were available
- **0** — a template answer that could be pasted to any customer
- **Guardrail:** if the agent named the specific bond, order or figure, **it IS personalised.** A standard explanation anchored to the customer's case counts as personalised.

### §4.5 DissatisfactionHandling — 10 (conditional)
**Only scored if the customer shows dissatisfaction:** a complaint about service or product, anger markers (repeated demands, all caps, "??????", restating a grievance after an answer), a threat to leave or escalate ("I will invest elsewhere", "I will file a case", "unfair trade practice"), or distress about stuck money. **If none appear → NA.**

When triggered, scores **how the agent recovered, not the outcome**:
- **1** — names the specific grievance, stays non-defensive, offers a concrete path forward (a call, escalation, a timeline, raising it with the team), closes to fit the mood
- **0.5** — polite and correct but misses one key recovery move (e.g. no path forward for a customer threatening to leave)
- **0** — ignores or dismisses the grievance, gets defensive, repeats the same line at an escalating customer, or closes cheerfully on an angry chat

### §4.6 Empathy — 5 (conditional)
**Only scored on softer emotional moments** (confusion, worry, anxiety, an apology) that are not strong enough to be dissatisfaction.
- **If DissatisfactionHandling triggered → Empathy is NA**, so the two never double-count.
- **On a calm, transactional chat → NA.**
- **1** — genuine, specific acknowledgment fitting the moment
- **0.5** — acknowledgment present but generic
- **0** — cold or dismissive where warmth was clearly needed
- **Not a keyword check.** Phrases like "I understand your concern" are neither required nor rewarded.

### §4.7 EscalationDecision — 5 (conditional, binary)
A **chat-leg judgment about whether moving to a voice call was the right decision.** It does not judge anything that happened *on* the call.
- **1** — moved to a call when warranted (complex explanation, follow-ups easier by voice, distressed customer), **or** correctly stayed in chat when a call wasn't needed
- **0** — forced a call with no request and no reason, **or** clearly should have offered a call (customer lost after repeated text attempts) and didn't
- **NA** — no call question arises at all
- **Never lowered simply because a call happened.** Escalating to voice is a good move when warranted.

### §4.8 PostCallRecap — 5 (conditional, binary)
**Only applies when a voice call happened in this thread.** Otherwise **NA**.
When a call happened, the agent must post a short written recap in the chat of what was discussed and decided, so the customer has it in writing.
- **1** — clear written recap posted, and it matches what the call transcript shows
- **0** — no written recap posted after the call, or the recap materially misstates the call
- Example of a good recap: *"Sir, as discussed over call, your SIP is active and the instalment will go through on the 20th of this month. Please let me know if any other clarity is needed."*

### §4.9 Readability — 3 (binary)
Could the customer easily read and understand the messages on a phone.
- **1** — clear and readable
- **0** — a genuine barrier: a dense wall of text with no breaks, raw internal jargon (EOD, T+1, Flexi-tenure) with no explanation, or an error that changes meaning ("I will you the details")
- **Never flagged:** numbered or line-broken lists, spacing artifacts ("thankyou"), all caps for emphasis, or minor typos that don't change meaning. Each newline is a separate WhatsApp message, so grammar is judged **per line**, not across the block.

### §4.10 GreetingHandover — 2 (binary)
On taking over, did the human introduce themselves and pick up the thread.
- **1** — a greeting that identifies the agent **and** Wint Wealth, and picks up the escalated context rather than restarting cold
- **0** — no greeting, or no self-identification
- **Never flagged** when the greeting is present and complete but rendered as one block instead of separate messages.

> **Retired:** the old `CallHandling` parameter no longer exists. Its two jobs are now split into EscalationDecision (§4.7) and PostCallRecap (§4.8).

---

## §5 How the IQS percentage is calculated

```
IQS % = round( Σ(weight × score) / Σ(weight of scored parameters) × 100 )
```

- Only parameters that received an actual score enter the calculation. **Every NA is dropped from both the numerator and the denominator.**
- Because of that, weights are **relative importance, not percentage points.** Agent weights sum to **105** (PostCallRecap's 5 only applies when a call happened); BOT weights sum to 100.
- If no parameter was scoreable, the result is **null** — not zero.
- A half score contributes exactly half of that parameter's weight.

**Worked example (agent leg, no call, calm chat):**

| Parameter | Weight | Score | Contributes |
|---|---|---|---|
| IssueResolution | 25 | 1 | 25 |
| Accuracy | 20 | 0.5 | 10 |
| ExpectationFollowThrough | 20 | 1 | 20 |
| Personalization | 10 | 1 | 10 |
| DissatisfactionHandling | 10 | NA | excluded |
| Empathy | 5 | NA | excluded |
| EscalationDecision | 5 | NA | excluded |
| PostCallRecap | 5 | NA | excluded |
| Readability | 3 | 1 | 3 |
| GreetingHandover | 2 | 1 | 2 |
| **Total** | **80 applicable** | | **70** |

IQS = 70 / 80 = **88%**

---

## §6 Compliance on chats — the breach list

**Important:** on chats, compliance is **not** a YES/NA/FAIL gate. It is a **list of breach instances**, and it is **visibility only — it does not change the IQS score.** The YES/NA/FAIL gate (G1/G2/G3) applies to **calls** — see §7.

### §6.1 The four breach types

| Type | Definition |
|---|---|
| `advisory` | Gave a personalised investment recommendation ("you should invest in X bond") or acted as an investment advisor |
| `guaranteed_returns` | Implied or stated assured or guaranteed returns |
| `data_handling` | Shared a personal, KYC or internal document over WhatsApp — see §6.2 |
| `misleading_error` | A factual error serious enough to push the customer toward a wrong financial decision |

Rules:
- The **whole interaction** is read — the chat, and the call transcript if present. A breach is a breach wherever it happened.
- **One entry per instance.** If guaranteed-returns language appears in two messages, that is **two entries**, each with its own quote, so a reviewer can see every mistake.
- Each entry carries the **type, the exact offending quote, and a one-line note**.
- Who said it is **not** traced — the flags describe the interaction, not the individual.
- A `misleading_error` in the **chat** also lowers Accuracy *when it stands as the final answer*. If it was corrected and the final answer is right, Accuracy follows the final answer, but **the breach entry still stays in the list.**
- A breach that happened **only on a call** does not affect any chat parameter, because call quality is scored separately. It still goes in the list.

### §6.2 Data handling over WhatsApp
Documents may be shared over WhatsApp **only if they carry no personal and no internal information.**

**Breach:** any document containing a user's personal, investment or KYC information — CMR (client master report), holding statement, investment report, taxation report, any KYC or identity proof, account opening or closing forms, or any file/screenshot showing PAN, Aadhaar or bank details. Also a breach: internal company material, Slack links, internal policy documents, internal SOPs.

**Not a breach:** informational or how-to documents (how to file taxes, how to set up a SIP, how to raise a request on a website); any purely informational document; a return or reward calculation shared as Excel or a Google Sheets link (referral reward, YTM or XIRR calculation, bond pricing sheet, bond issuer document); website or internet screenshots showing no personal data.

**Screenshots** are a breach **only if** PAN, Aadhaar, bank details or other user information is visible.

**When it can't be determined** whether a shared document carried personal or internal information, it is **treated as a breach** and the ambiguity noted.

### §6.3 Answer Change Gate (visibility only, agent leg)
Across the **whole** interaction — BOT messages, agent text, and all call transcripts — every place where **we changed our answer, our stated process, or our definition** is recorded. This exists to surface knowledge and process gaps.

- **Counts:** a different factual answer to the same question; a revised process or eligibility statement; a changed definition; a BOT answer later contradicted by the agent; a call statement later changed in text, or vice versa.
- **Does not count:** offering a different channel (moving to a call); rephrasing the same answer more clearly; adding non-contradicting detail; the customer asking a new question.
- Each entry records: the topic, the first answer and where it was given, the revised answer and where, and **whether the final answer is correct per KB**.
- **This list never lowers a score by itself.** If the final answer is wrong, Accuracy already handles it.

### §6.4 Unrelated-call flag
If a call transcript is about something unrelated to the chat context, the chat is flagged — **except** when the customer clearly chose to raise a different question on the call, which is intended behaviour and is not flagged.

---

## §7 The Compliance Gate — G1 / G2 / G3 (calls)

This is the **YES / NA / FAIL gate.** It runs as a **separate first pass over a call**, before any quality scoring, against three critical gates.

### §7.1 How the three states work

Gates are **tripwires.** A gate binds **only when its triggering content actually occurs on the call.** If the content never occurs, the gate **passes vacuously**.

| Internal status | Shown in portal as | Meaning |
|---|---|---|
| `pass` | **YES** | The gate's content occurred and the rep handled it correctly |
| `not_applicable` | **NA** | The triggering content never occurred — the gate never bound |
| `fail` | **FAIL / No** | The gate's rule was broken |

**A gate is never marked failed merely because its topic was absent.** Absent topic = NA, not FAIL.

Two further rules:
- **Only the rep's words are judged**, never the customer's. Every finding must cite the exact turn.
- **Borderline items do not fail the call.** When a claim is ambiguous between fact and advice, it is quoted and marked `borderline`, which **routes it to human review** instead of failing the gate.

### §7.2 Gate definitions with examples

#### GATE G1 — NO ADVICE
*The rep states verified facts only.* Fails if the rep, anywhere on the call:
- **(a)** recommends whether, what, when or how much to invest, **or**
- **(b)** guarantees or assures returns or safety, **or**
- **(c)** interprets tax treatment beyond what the KB states — explains how the customer should treat something in their filing, or reasons about deduction rules, rates or 26AS mechanics not in the KB, without explicitly escalating.

Reason codes: `advice_investment` for (a)/(b), `advice_tax` for (c).
**Binding:** (a) and (b) can occur on any call. **(c) binds only if tax/TDS is discussed.**

| State | Example |
|---|---|
| **YES** (pass) | Tax comes up. The rep reads the KB answer on TDS and says *"I can't advise on how to file this, but factually the TDS shown is X — let me connect you with the team for the filing question."* Gate bound and handled correctly. |
| **NA** | A call purely about when a repayment will be credited. Investment advice and tax never come up, so nothing to judge. |
| **FAIL** | *"Sir, this bond is a good time to buy — you should put your money here, returns are guaranteed and there's zero risk."* → both (a) and (b). |
| **FAIL** | Customer asks how to treat interest in their return; rep reasons through deduction rules not present in the KB without escalating → (c) `advice_tax`. |

**Explicitly not violations:** stating verified product facts, reading the KB answer, saying *"I cannot advise on that, but factually X"*, escalating a tax question.

#### GATE G2 — NO FABRICATED FACTS
*Every specific figure, rate, date or timeline the rep states must trace to the KB or to information present in the call itself* (e.g. reading back something the system or customer provided).

**Fails if** the rep states a specific number, date, rate or timeline that appears in **neither** the KB **nor** the call context.
**Binding:** any call where the rep states at least one specific claim.

| State | Example |
|---|---|
| **YES** (pass) | Rep quotes the settlement timeline as T+1 working days, which the KB confirms; and reads back the customer's own order date from what the customer just said. |
| **YES** (pass) | Rep doesn't know and says *"I will confirm this and get back to you."* **Vague honesty is explicitly correct behaviour, not a violation.** |
| **NA** | The rep makes no specific factual claim at all — e.g. a short call that is only identity confirmation and a promise to call back. |
| **FAIL** | Rep says *"your money will be credited by Thursday, 3 pm"* when no such timeline exists in the KB and nothing in the call supports it. |
| **FAIL** | Rep invents a rate — *"you'll get around 11.2% on this"* — with no KB or call basis. |

#### GATE G3 — IDENTITY VERIFIED FIRST
*No account-specific information* (holdings, amounts, dates of the customer's own transactions, KYC status, bank details) *may be disclosed before an identity verification exchange occurs earlier in turn order.*

Accepted verification: registered mobile, email, PAN, DOB, or explicit name confirmation.
**Binding:** only calls where account-specific information is actually disclosed. **General product questions pass vacuously.**

| State | Example |
|---|---|
| **YES** (pass) | Rep confirms registered mobile and PAN at turn 3, then discloses the customer's holdings at turn 9. Verification precedes disclosure. |
| **NA** | Customer only asks *"what is the minimum investment in a bond?"* — a general product question. No account data disclosed, so the gate never binds. |
| **FAIL** | Rep opens with *"your ₹2 lakh investment in X matures on the 14th"* before any identity check. |
| **FAIL** | Rep confirms identity **after** already disclosing KYC status. Order matters — verification must come earlier in turn order. |

### §7.3 What a gate FAIL does to the call score

The gate verdict overrides the quality score entirely:

| Gate result | Call IQS % | Final verdict |
|---|---|---|
| **FAIL** | *(ignored)* | **FAILED_CRITICAL** |
| PASS | null (nothing scoreable) | NOT_SCOREABLE |
| PASS | ≥ 90 | excellent |
| PASS | 75–89 | meets_expectations |
| PASS | 60–74 | coaching |
| PASS | < 60 | remediation |

A single gate FAIL makes the whole call **FAILED_CRITICAL regardless of how well it scored on the ten quality parameters.**

The gate pass also returns **`kb_gaps`** — topics the rep was asked about that the KB does not cover. This is a KB backlog signal, not an agent fault.

---

## §8 Call quality parameters

Scored in a **second, separate pass** after the gate. Ten parameters, each **0 (not met) / 1 (partially met) / 2 (fully met) / NA**. Only the rep is judged, and every score must cite turn indices.

> Note: the parameters are numbered P1–P11 **with no P4** — that number is unused in the current set.

| ID | Parameter | Weight | 2 = fully met | 1 = partial | 0 = not met | NA when |
|---|---|---|---|---|---|---|
| **P1** | Factual correctness | 20 | All claims match KB | Minor imprecision, no material impact | Any materially wrong answer | KB has no entry covering the topics answered (logged as a KB gap, **never scored against the rep**) |
| **P2** | All questions addressed | 15 | All addressed | Exactly one dropped or part-addressed | More than one dropped | — |
| **P3** | Expectation setting & follow-up specificity | 15 | Every open item has a specific timeline/TAT and named owner where relevant | Commitments exist but vague, or one open item lacks one | Open items left with nothing | No open items — everything resolved live |
| **P5** | Call opening | 5 | Name + "Wint Wealth" as a statement, early | Partial (brand without name, or late) | No proper introduction | — |
| **P6** | Call closing | 5 | Summary + anything-else + greeting | Greeting without summary or anything-else | Abrupt or no close | Customer hung up mid-call / call cut |
| **P7** | Pre-check, no repeat asks | 5 | No repeat asks | One repeat ask | Multiple | — |
| **P8** | Simplifying & jargon handling | 8 | Jargon matched to customer level | Some unexplained jargon or mismatched depth | Heavy unexplained jargon to a confused customer | No financial jargon occurred |
| **P9** | Active listening & interruptions | 9 | Zero IR interruptions AND no repeat-forced moments AND acknowledgement present | 1–2 interruptions OR one repeat-forced moment OR weak acknowledgement | Habitual talk-over, or no acknowledgement on a frustrated call | — |
| **P10** | Fillers & dead air | 6 | Filler rate under ~1/min AND zero dead-air events | Under ~3/min, or one short dead air | Heavy fillers or repeated unexplained dead air | — |
| **P11** | Energy, warmth & pace *(audio-derived)* | 12 | Confidence ≥7 AND empathy ≥7 AND normal pace AND sentiment not declining | Either signal in the 4–6 band, or mixed speed | Either below 4, or sustained fast speech with declining sentiment | **Transcript-only call (no audio tone data).** Tone is never inferred from text |

Call-specific rules worth knowing:

- **P2** requires first enumerating every distinct customer question — calls are often multi-topic. An issue handled by struggling through an evident **language barrier**, instead of offering a language-matched callback, counts as only **partially** addressed.
- **P3** — vague assurances ("soon", "shortly", "someone will look into it") are explicitly **not** specific.
- **P7** — "already available" means stated earlier on this call, **or in the originating chat, or on any prior call in the same thread.** If there's no chat context and no prior calls, only same-call repeats are checked.
- **P8** is calibrated to the customer: if the customer demonstrably knows the terms, **over-explaining scores 1, not 2.**
- **P10** — a silence the rep announces ("please stay on the line, I'm checking") is a **hold and is never penalised.** Only true dead air counts.
- **Speaker-ID confidence is informational only.** Calls are audited and scored as normal at every confidence level.
- Also extracted without affecting scores: **`breach_mentions`** — every customer statement implying a previously promised action wasn't done ("I was told this would be resolved last week"), matched against commitments made on prior calls where possible.

Call IQS uses the same normalisation as §5 (NA excluded both sides); call weights sum to 100.

---

## §9 BOT chat parameters

Seven parameters. The BOT is judged on **outcomes and safety, not human craft** — a BOT's shortfalls are fixed by changing its flow, prompt or KB, not by coaching a person.

**Explicitly not judged for the BOT:** greeting style, empathy, closing warmth, call handling.

| # | Parameter | Weight | Scale | Conditional? |
|---|---|---|---|---|
| 9.1 | IssueResolution | 25 | 0 / 0.5 / 1 or NA | NA on a correct transfer |
| 9.2 | Accuracy | 20 | 0 / 0.5 / 1 | No |
| 9.3 | CorrectEscalation | 20 | 0 / 0.5 / 1 | No |
| 9.4 | NoRepetition | 10 | 0 / 0.5 / 1 | No |
| 9.5 | Personalization | 10 | 0 / 0.5 / 1 or NA | Yes → NA |
| 9.6 | ExpectationSetting | 8 | 0 / 0.5 / 1 or NA | Yes → NA |
| 9.7 | Clarity | 7 | 0 / 1 | No |

### §9.1 IssueResolution — 25
Did the BOT do everything from its end to resolve the request **and answer every question it could, not just the first.**

**Full-chat mode** (BOT handled the whole chat):
- **1** — request resolved and every question answered
- **0.5** — main ask handled but a secondary question dropped, or only partly answered
- **0** — core question unanswered, or closed without resolving or handing off

**Escalated-leg mode** (BOT transferred to a human):
- **NA** — **the BOT transferred correctly per the handover criteria.** A required transfer is *not* a resolution failure; resolution simply does not apply to the BOT for this chat. **This includes transfers because the customer demanded a human, was angry, or was not understanding.**
- **1** — before transferring, the BOT fully answered whatever it could, and the transfer was correct. Used instead of NA only when the BOT genuinely resolved sub-questions on top of a correct transfer.
- **0** — the BOT hallucinated, gave up on something it should have handled, or failed to perform as instructed before or during the transfer.

### §9.2 Accuracy — 20
Was everything the BOT stated correct against the KB and the customer's real data (product rules, settlement timelines, tax and Form 121 guidance, amounts, dates, figures it pulled).
- **1** — all claims and figures accurate
- **0.5** — minor inaccuracy that does not change the customer's action
- **0** — a wrong rule, figure or process step a KB or data check would contradict
- Serious misleading errors escalate to the compliance breach list.

### §9.3 CorrectEscalation — 20
Did the BOT make the right handover decision at the right moment, judged against the handover criteria (§10.2).
- **1** — transferred at the right moment per the criteria (including pacifying an angry customer first and setting the out-of-office expectation where applicable), **or** correctly resolved without needing to transfer
- **0.5** — transferred, but **late** — after avoidable loops or failed attempts once a trigger had clearly fired
- **0** — a trigger fired and the BOT looped or closed instead of transferring, **or** it transferred when no trigger applied and could clearly have resolved the query itself

### §9.4 NoRepetition — 10
Did the BOT make progress, or repeat itself instead of adapting.

**The most important case:** the customer pushed back, said it didn't work, said that's not what they asked, or countered the answer — and the BOT **gave the same answer again** instead of trying something new.
- **1** — every turn moved forward; when countered, the BOT changed approach, asked a clarifying question, or escalated
- **0.5** — one avoidable repeat, but it recovered and moved forward
- **0** — repeated an answer the customer had already countered, or re-sent the same response or menu two or more times without progressing
- A short single-exchange chat with nothing repeated is **1 by default**.
- *Example of 0:* customer says "still not credited" and the BOT re-sends the identical "which payment are you referring to" menu it already sent.

### §9.5 Personalization — 10 (conditional)
Two things together: did the BOT use the customer's **actual data**, and did it **read the conversation** and frame its answer to the specific question asked.
- **1** — uses the customer's real data where relevant **and** is framed around what they actually asked
- **0.5** — right data but stock phrasing that doesn't engage with how they asked, or a generic block where specifics were available
- **0** — a template answer that ignores the customer's data or the conversation context
- **NA** — a generic policy or how-to question with no customer-specific element and only one natural way to answer (e.g. "can I add a credit card account" answered by a flat policy "no"). Nothing to personalise.

### §9.6 ExpectationSetting — 8 (conditional)
When something is pending, did the BOT say what happens next and by when.
- **1** — clear next step or timeline given (e.g. "being processed today, will be credited to account ...")
- **0.5** — implied but vague ("please allow some time", with no sense of how long or for what)
- **0** — left the customer not knowing what happens next on a pending item
- **NA** — the query was fully resolved on the spot with nothing pending
- Whether the timeline quoted was **correct** is Accuracy, not this.

### §9.7 Clarity — 7 (binary)
Was the BOT easy to read **and** did it explain rather than dump.
- **1** — clear, phone-friendly, explains where explanation is needed
- **0** — a dense wall of text, unexplained internal jargon (EOD, T+1, Flexi-tenure used raw), or an answer so terse it doesn't tell the customer what to do
- **Never flagged:** numbered or line-broken lists, spacing artifacts, all caps for emphasis. Judged per line.

---

## §10 The two ops-editable blocks

These are **business facts and rules injected into the prompt**, deliberately separated from scoring logic so they can be updated without touching code. **QA should review these as closely as the parameters** — they directly decide pass/fail outcomes.

### §10.1 Wint policy facts (applied mainly to Accuracy)

- **Settlement timelines that are CORRECT and must not be marked wrong:** first investment or first payment **T+3 working days**; all subsequent investments **T+1 working days**. Working days are Monday–Friday only; weekends don't count. Accuracy is lowered only if a *materially different* timeline is quoted.
- **Form 121** is the current TDS declaration form and has **replaced Form 15G/H**. For many NBFCs it is submitted through the Wint app; for some entities it must be submitted **directly with that entity**, not through Wint. An agent directing the customer to submit directly with the entity is **CORRECT** — never lower Accuracy for this.
- **Skip Instalment before cancellation is optional.** An agent going straight to cancellation without offering Skip Instalment is **not** a failure.

### §10.2 BOT handover criteria

The BOT **must** transfer to a human — without asking permission, pacifying first if the customer is frustrated, and setting the out-of-office expectation when agents are unavailable — in any of these cases:

- The customer explicitly asks for a human agent or the support number
- The customer is frustrated, angry, urgent, or complains, **or responds negatively to a satisfaction check in any language** ("Nahi", "Illa", "I don't understand"), asks to switch language, or repeats the same question because the answer wasn't understood
- Multiple failed resolution attempts on the same issue
- Legal threats, fraud or scam concerns, identity theft, regulatory complaints, account frozen or under investigation, SEBI interpretation for a specific case
- Complaint escalation: dissatisfaction with previous support, unresolved after multiple attempts, formal complaint, escalation to senior management or a regulator
- The customer asks **why Fixed Deposits were discontinued** (any phrasing, any language, including a bare "why" right after the BOT mentions FD discontinuation)
- Physical delivery of documents
- The customer asks for a **specific bond**, or for bond names by payout structure (monthly payment, maturity repayment, etc.)
- **TDS deducted by a company but not reflecting** in the customer's income statement or Form 16, or any issuing-entity coordination
- **Insta Payment refund not received** beyond 7–10 working days after KYC rejection
- **Joint account holder issues** (not the first holder)
- A **KYC technical failure mid-process** (app crash, step not loading, documents not uploading)
- **The KB agent could not find an answer** to the question

Before handover the BOT should send the transfer message and call the handover tool **in the same turn**, without asking "should I connect you".

---

## §11 Observations QA should be aware of before commenting

These are **factual notes on how the current build behaves**, recorded so nobody spends review time on something already known. No changes have been made.

**§11.1 — The "Compliance Gates" strip on the chat evaluation screen is not driven by the chat evaluation.**
G1/G2/G3 are produced **only by the call pipeline** (§7). The chat scoring pass produces the breach list (§6), not gates. Chat records therefore carry no gate data, and the chat panel falls back to **hardcoded placeholder values on every chat**: G1 = Yes, G2 = No, G3 = NA, overall = PASS. These values are identical on every chat and reflect nothing about that conversation.

**§11.2 — This is why "Fabrication shows as failed on most chats."**
Because of §11.1, the G2 Fabrication badge renders as **"No" in red on every chat**, since "No" is its hardcoded default. It is a placeholder being displayed, not a fabrication finding.

**§11.3 — G2's pass/fail direction is inconsistent between the two screens.**
On the call screen, `pass` → "Yes". In the chat screen's overall-result fallback, **G2 = "Yes" is treated as a FAIL condition.** The two readings are opposites, so if real gate data were ever attached to a chat, a G2 *pass* would be read as a gate *failure*.

**§11.4 — Chat compliance breaches are recorded but not shown on the chat evaluation screen.**
The breach list from §6 is stored against the chat and is read by the **weekly scorecard generator**, but the chat evaluation panel has no UI for it. QA reviewing a chat in the portal currently cannot see the breach quotes the evaluator produced.

**§11.5 — Answer Change Gate entries are stored in the wrong shape.**
The evaluator returns each answer change as `topic / first_answer / revised_answer / …`, but the storage step reads `type` and `quote` from it — fields those entries don't have. Stored answer-change records are therefore not usable as written.

**§11.6 — Two prompt generations are live at once.**
Chat scoring uses the current v4 prompt. One older path — the combined chat-plus-call scoring triggered for calls linked to a chat — still uses the **previous-generation prompt** in `lib/quality.ts`, which has a different parameter set (Technical, AllQuestions, Opening, Call, Grammar, Tags…) and a different compliance model (a single flag rather than a breach list). Its rules also differ in ways that matter: it says **"NA parameters are treated as Yes (pass)"** and instructs "always score Call as NA", neither of which is true of v4. Scores produced through that path are not directly comparable to v4 scores.

**§11.7 — Internal-note handling is stricter on `main` than in the newer branch.**
On `main`, internal notes are **stripped and ignored entirely — not even used as context** (§3.5). Worth confirming this is the behaviour QA wants, since internal notes often explain *why* an agent acted as they did.

---

## §12 Suggested review order for QA

1. **§2** — the two meanings of NA. Everything else reads wrong if this isn't clear.
2. **§7.2** — the three gate definitions and their YES/NA/FAIL examples. Highest consequence: a gate FAIL overrides the entire call score.
3. **§4** and **§9** — the per-parameter bars for agent and BOT. This is where most disagreements will be.
4. **§10** — the policy facts and handover criteria. Wrong entries here cause systematic mis-scoring across every chat.
5. **§6** — breach types and the WhatsApp data-handling boundary.
6. **§8** — call parameters, if the call flow is in scope for your review.

When commenting, please state **the section number, the current wording, and what it should be instead** — that way each change maps to one definition in the backend.
