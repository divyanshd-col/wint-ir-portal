/**
 * Wint Wealth IQS evaluator, v4
 *
 * Scoring legs per interaction type:
 *   Type 1 (bot only)            -> 1 score:  BOT rubric, FULL CHAT mode.
 *   Type 2 (bot + human text)    -> 2 scores: BOT rubric ESCALATED LEG (bot's portion,
 *                                  up to the transfer) + HUMAN rubric (agent's text turns).
 *   Type 3 (bot + human + calls) -> 3 scores: the two above + one Call IQS PER CALL
 *                                  from the separate call QA system (not this module).
 * Call buildScoringPrompt once per leg (opts.leg = 'bot' | 'human').
 *
 * v4 logic (per Apoorv's decisions):
 *  - Bot escalated leg: a transfer made correctly per the HANDOVER_CRITERIA scores
 *    IssueResolution "NA" (not a failure, resolution does not apply). Bot hallucination
 *    or failure to follow the handover logic scores 0. CorrectEscalation is judged
 *    against the criteria. Auto-followups after transfer are plumbing, never scored.
 *  - Internal notes: stripped COMPLETELY. Not scored, not even context. The pipeline
 *    strips them before scoring; the prompt ignores any that slip through.
 *  - Answer changes: changing our answer/process/definition is NOT an Accuracy failure.
 *    Accuracy judges the FINAL answer per KB. Every change is recorded in the
 *    ANSWER CHANGE GATE (visibility-only list: topic, first answer + where, revised
 *    answer + where, final correct per KB). Human quality only.
 *  - Call-only error cap: an uncorrected error appearing only in a call transcript,
 *    uncorroborated and unrepeated, caps Accuracy at 0.5 with unsure=true (transcripts
 *    are AI-generated and imperfect). Corroborated/repeated errors take full penalty.
 *  - Unrelated-call flag: a call about something unrelated to the chat context sets
 *    unrelated_call_flag, EXCEPT when the customer intentionally raised a new topic.
 *  - Multiple calls supported: opts.callTranscripts is an ordered array, labelled
 *    CALL 1, CALL 2 ... in order of occurrence. All are context in the human leg;
 *    each is scored individually by call QA with prior calls + chat as its context.
 *
 * Carried from v3:
 *  - Graded soft dimensions (0/0.5/1), binary mechanics, conditional dims -> "NA"
 *    excluded from numerator AND denominator, score computed in code (computeIQS).
 *  - Compliance gate lists EVERY breach instance (chat + calls), visibility only.
 *  - Agent Quality and CSAT reported separately, never fused.
 *  - WINT_POLICY (facts) and HANDOVER_CRITERIA (transfer rules) are ops-editable
 *    constants injected at build time; both can be overridden per call.
 *
 * HUMAN rubric: IssueResolution, Accuracy, ExpectationFollowThrough, Personalization,
 *   DissatisfactionHandling (cond), Empathy (cond), EscalationDecision (cond),
 *   PostCallRecap (cond), Readability, GreetingHandover. + compliance gate + answer change gate.
 * BOT rubric: IssueResolution (NA on correct transfer), Accuracy, CorrectEscalation,
 *   NoRepetition, Personalization (cond), ExpectationSetting (cond), Clarity. + compliance gate.
 */

// ── Weights (provisional, validate once Quality and CSAT are reported separately) ──
export const HUMAN_WEIGHTS: Record<string, number> = {
  IssueResolution: 25,
  Accuracy: 20,
  ExpectationFollowThrough: 20,
  DissatisfactionHandling: 10, // counts only when triggered, else NA (was 15, 5 moved to EscalationDecision)
  Personalization: 10,
  Empathy: 5,                  // counts only when applicable, else NA
  EscalationDecision: 5,       // chat-leg call decision. Now scored: a bad decision lowers IQS. Also flagged. Conditional, NA when no call question
  Readability: 3,
  GreetingHandover: 2,
  PostCallRecap: 5,            // only applies when a call happened (else NA and excluded)
}

export const BOT_WEIGHTS: Record<string, number> = {
  IssueResolution: 25,     // resolved the request + answered all questions
  Accuracy: 20,
  CorrectEscalation: 20,
  NoRepetition: 10,
  Personalization: 10,     // data + context-aware framing. Conditional, NA on generic policy
  ExpectationSetting: 8,   // conditional, NA when resolved on the spot
  Clarity: 7,
}

// ── Wint policy facts (OPS-EDITABLE) ──────────────────────────────────────────
/**
 * Volatile business facts, NOT scoring logic. Ops or compliance can edit this block
 * when policy changes (a new settlement timeline, a new tax form, a changed rule)
 * WITHOUT touching any scoring code. It is injected into the prompt at build time via
 * the {{WINT_POLICY}} marker in SHARED_RULES. Keep it to plain factual bullets.
 * Do not put scoring instructions here, those live in SHARED_RULES.
 * You can also override this per call by passing opts.policy to buildScoringPrompt,
 * for example if you load the current policy from a database or CMS.
 */
export const WINT_POLICY = `- Settlement timelines that are CORRECT and must not be marked wrong: first investment or first payment T+3 working days, all subsequent investments T+1 working days. Working days are Monday to Friday only, weekends do not count. Only lower Accuracy if a materially different timeline is quoted.
- Form 121 is the current TDS declaration form and has replaced Form 15G/H. For many NBFCs the form is submitted through the Wint app. For some entities it must be submitted directly with that entity, not through Wint. An agent directing the customer to submit directly with the entity is CORRECT. Never lower Accuracy for this.
- Skip Instalment before cancellation is optional. An agent going straight to cancellation without offering Skip Instalment is not a failure.`

// ── Bot handover criteria (OPS-EDITABLE) ──────────────────────────────────────
/**
 * The rules the bot is instructed to follow when transferring a chat to a human.
 * Used by the bot rubric to judge whether a transfer was correct. Keep in sync with
 * the bot's own HUMAN HANDOVER LOGIC. Injected via {{HANDOVER_CRITERIA}}.
 */
export const HANDOVER_CRITERIA = `The bot MUST transfer to a human (without asking permission, pacifying first if the customer is frustrated, and setting the out-of-office expectation when agents are unavailable) in any of these cases:
- The customer explicitly asks for a human agent or for the customer support number.
- The customer is frustrated, angry, urgent, or complains, or responds negatively to a satisfaction check in any language ("Nahi", "Illa", "I don't understand", asks to switch language, or repeats the same question because the answer was not understood).
- Multiple failed resolution attempts on the same issue.
- Legal threats, fraud or scam concerns, identity theft, regulatory complaints, account frozen or under investigation, SEBI interpretation for a specific case.
- Complaint escalation: dissatisfaction with previous support, unresolved after multiple attempts, formal complaint, escalation to senior management or a regulator.
- The customer asks why Fixed Deposits were discontinued (any phrasing, any language, including a bare "why" right after the bot mentions FD discontinuation).
- Physical delivery of documents.
- The customer asks for a specific bond or for bond names by payout structure (monthly payment, maturity repayment, and so on).
- TDS deducted by a company but not reflecting in the customer's income statement or Form 16, or any issuing-entity coordination.
- Insta Payment refund not received beyond 7 to 10 working days after KYC rejection.
- Joint account holder issues (not the first holder).
- A KYC technical failure mid-process (app crash, step not loading, documents not uploading).
- The KB agent could not find an answer to the question.
Before handover the bot should send the transfer message ("I'm transferring your chat to one of our executives...") and call the handover tool in the same turn, without asking "should I connect you".`

// ── Shared rules used by both rubrics ─────────────────────────────────────────
const SHARED_RULES = `
## READ THE COMPLETE TRANSCRIPT FIRST
Read every message from first to last before scoring anything. Decisive details often appear late (a closing, a correction, a follow-up). Do not begin scoring until you have read the whole conversation.

## LANGUAGE
Chats are often in Hinglish or Hindi, or mix scripts. Do NOT lower any dimension for language mix, transliteration, or non-English phrasing. Judge clarity of meaning and correctness, never English purity.

## EMPTY OR NON-CHATS
If there is no substantive interaction (a customer message with no agent reply, an instant drop, only system or activity lines, or no real question or resolution), set every score to "NA", explain in summary, and do not fabricate scores.
IMPORTANT: Do NOT apply this rule when the customer raised a query or issue at any point in the chat (including during the bot phase) that the agent failed to address. A chat where the customer asked a question and the agent only greeted and closed is not an empty chat — it is a scored chat where IssueResolution must be 0.

## HOW TO GRADE THE SOFT DIMENSIONS (0 / 0.5 / 1)
Decide in this order for each graded dimension:
1. Did this dimension's core purpose succeed with no gap a QA reviewer would coach? Score 1.
2. Was the core handled but with ONE specific, nameable gap, short of a real failure? Score 0.5.
3. Did the core purpose clearly fail in a specific, nameable way? Score 0.
You MUST state the exact gap for a 0.5 and the exact failure for a 0 in the reasoning. If you cannot name it, score 1.
Judge ONLY this dimension's core purpose. Never lower a score for a problem that belongs to another dimension.
When you are unsure of the DEGREE (not whether the dimension applies), give the benefit of the doubt and score higher.

## THREE STATES: SCORED, NOT APPLICABLE, OR UNSURE
Every dimension ends in one of three states. Use the "unsure" flag to separate the last two, because only one of them needs a human.
1. SCORED. You can judge it. Give the number (0 / 0.5 / 1, or 0 / 1 for binary). Set unsure = false.
2. NOT APPLICABLE. The dimension genuinely does not apply, for example a conditional whose trigger did not fire (Empathy on a calm chat, DissatisfactionHandling on a happy customer, PostCallRecap when no call happened, EscalationDecision when no call question arises). Set score = "NA" and unsure = false. In the comment, briefly say why it does not apply. This does NOT need QA review.
3. UNSURE. The dimension applies but you cannot judge it because the evidence is not in the chat, for example a call happened but you have no call transcript, or a claim depends on data you cannot see. Set score = "NA" and unsure = true. In the comment, write a precise question a human QA reviewer with call recordings and system access can answer, not a vague "was this okay". This DOES need QA review.
Do NOT use "NA" merely because you are unsure how GOOD something was. Uncertainty about degree is handled by scoring higher (benefit of the doubt), not by NA and not by the unsure flag. Unsure is only for "I cannot evaluate this at all from what I can see".
Only set unsure = true when the answer would actually change the score, meaning resolving it could turn this dimension from NA into a real fail. If even the worst-case answer would not lower the score, do not flag it, just score it and move on.
Both NA states are excluded from the score. The unsure flag is what tells QA which dimensions to go and check.

## KEEP DIMENSIONS INDEPENDENT
Do NOT let one problem cascade into many low scores. A factual error lowers Accuracy only, not four other dimensions.

## DATE AWARENESS
Today's date is in CHAT METADATA. A date on or before today has already happened. Never treat a past date as a missed future commitment.

## COMPLIANCE FLAGS (separate from the score)
Independently of the quality dimensions, capture EVERY compliance breach that occurred ANYWHERE in the interaction, as a list. Read the whole interaction: the chat, and if a CALL TRANSCRIPT is present in context, the call too. A breach is a breach wherever it happened. Do not trace who said it or which leg it came from, the flags are about the interaction, not about blaming an agent. This does NOT change the quality score. It marks the interaction for separate compliance or QA review.
List one entry per instance, even if the same type happens more than once. If guaranteed-returns language appears in two different messages, that is two entries, each with its own quote, so a reviewer can see every mistake. Breach types:
- advisory: gave a personalised investment recommendation ("you should invest in X bond") or acted as an investment advisor.
- guaranteed_returns: implied or stated assured or guaranteed returns.
- data_handling: shared a personal, KYC, or internal document over WhatsApp, see the data-handling rule below.
- misleading_error: a factual error serious enough to push the customer toward a wrong financial decision.
Put each breach in the breaches array with its type, the exact offending quote, and a one-line note. If there are none, breaches is an empty array and breach is false.
Note: a misleading_error breach in the CHAT also lowers Accuracy when it stands as the final answer (if it was later corrected and the final answer is right, Accuracy follows the final answer and the change goes to the ANSWER CHANGE GATE, but the breach entry stays in this list). A breach that happened only on a CALL does not affect any chat quality parameter, since call quality is scored separately. Either way it goes in the list.

### Data handling over WhatsApp
Documents may be shared over WhatsApp only if they carry no personal and no internal information.
- BREACH if the agent shares over WhatsApp any document containing a user's personal, investment, or KYC information. Examples: CMR (client master report), holding statement, investment report, taxation report, any KYC or identity proof, account opening or closing forms, or any file or screenshot showing PAN, Aadhaar, or bank details. Also a breach: any internal company material, Slack link, internal policy document, or internal SOP.
- NOT a breach: informational or how-to documents (how to file taxes, how to set up a SIP, how to raise a request on a website), any purely informational document, a return or reward calculation shared as an Excel file or a Google Sheets link (referral reward, YTM or XIRR calculation, bond pricing sheet, bond issuer document), and website or internet screenshots that do NOT show any personal data.
- A screenshot is a breach only if PAN, Aadhaar, bank details, or other user information is visible in it.
- When you cannot tell whether a shared document carried personal or internal information, treat it as a breach and note the ambiguity in compliance.note.

## WINT POLICY FACTS (current, apply mainly to Accuracy and IssueResolution)
{{WINT_POLICY}}

## SCORING GUARDRAILS (how to handle what you see, applies to Accuracy and IssueResolution)
- Internal checks (Finder, order status, account or SIP state) are not visible to you and agents do not narrate them to customers. Do NOT assume a check was skipped, and do NOT lower Accuracy just because the agent did not say "I checked and confirmed X". The fact that a response could have been improved by a tool check is NOT enough to fail anything. Example: if the process KB says "check if there is an active SIP" and the agent proceeds with cancellation without stating "I verified you have an active SIP", that is NOT an error, the check is internal. Only lower Accuracy if the visible answer or action is provably wrong, for example the agent says a repayment was not processed but the transcript shows it was credited, or the agent gives a wrong fact or wrong process step.
- Internal notes, Slack links, internal tool URLs, and any internal system references that appear in the transcript are NOT part of the conversation. Ignore them COMPLETELY. Do not use them as context, do not use them to explain or justify an agent's action, and never score anything based on them. Evaluate only what was communicated to the customer. (The pipeline should strip internal notes before scoring; if any slip through, treat them as if they do not exist.)
- If the chat references a prior conversation (phrases such as "previous chat", "previous conversation", "previous text", "last time", "last conversation", "earlier ticket", "as discussed before", "as discussed earlier", "as mentioned earlier", "referred earlier", "as per our last chat", "continuing from before"), note it in summary and be lenient on Accuracy and IssueResolution. Missing context may live in that earlier chat. Do not fail for information gaps a prior chat could explain.

## MEDIA IN CHAT
Screenshots or documents shared in the chat are evidence.
- Accuracy: check whether the agent's guidance matches what a screenshot actually shows.
- Personalization: check whether a shared image or document fits this customer's specific situation rather than being a generic screenshot.
- Internal-tool screenshots (Finder, order status, a backend record, any internal system UI) must NOT be sent to the customer. If the agent shares one in the customer chat, that is an error. If it exposes any customer personal data (PAN, Aadhaar, bank details, holdings, KYC), it is a data-handling breach, raise the compliance flag. If it exposes no personal data, it is still a professionalism error, lower IssueResolution (or Accuracy if the screenshot also misinforms) and note it in the comment.
- If an image is unreadable or unclear, ignore it and score on the text alone.
- Document excerpts shown in a media or attachments section are trimmed previews, not the full file. Use them for context only, and do not fail a dimension because a preview looks incomplete.

## REASONING ISOLATION
Each dimension's reasoning must discuss only that dimension's own criteria. Never name another dimension inside a reasoning field. Examples of what NOT to do: writing about the greeting inside IssueResolution reasoning, writing about unanswered questions inside ExpectationFollowThrough reasoning, or writing about a factual error inside Empathy reasoning. Factual errors belong to Accuracy only. Score each dimension as if filling a separate form with no view of the others.
`

// ── Human rubric ──────────────────────────────────────────────────────────────
const HUMAN_RUBRIC = `
## RUBRIC: HUMAN AGENT (the bot escalated, a human took over)
Score ONLY the human agent's text turns, from handover onward. Everything else in the interaction is context: the bot's earlier messages, and any voice call transcripts. There may be MULTIPLE calls, interleaved with text (text, then a call, then text, then another call). Read everything in order of occurrence to understand the full flow, but score only the agent's text messages.
Calls are scored by a separate call QA system, NOT here. Call transcripts are AI-generated and imperfect: speaker attribution and individual words can be wrong, so treat call content as approximate evidence, never as certain. Use call context to: (1) avoid penalizing IssueResolution or ExpectationFollowThrough for something that was resolved or explained on a call, (2) verify the PostCallRecap, (3) detect answer changes for the ANSWER CHANGE GATE below, and (4) apply the capped call-only accuracy rule inside Accuracy. Never score call quality or tone.
UNRELATED-CALL FLAG: if a call transcript is about something unrelated to the chat context, set unrelated_call_flag = true and explain, EXCEPT when it is clearly the customer choosing to raise a different question on the call, which is intended behaviour and not flagged.

### IssueResolution (graded 0 / 0.5 / 1)
Did the agent address every question the customer raised (including questions raised during the bot phase and left unanswered) and either resolve the issue or correctly move it forward.
- 1: all questions handled, issue resolved or correctly progressed (ticket raised, escalated, call arranged).
- 0.5: main issue handled but a secondary question dropped, or progressed with no clear next step.
- 0: the core question went unanswered, or an open issue was closed without resolving or escalating it.
- CRITICAL: if resolution moved to a call or an offline step, that is a valid resolution. Do NOT lower this because the outcome is not fully visible in the chat text.
- STRICT RULE — Greeting-only close: If the customer raised a question or issue anywhere in the interaction (including during the bot phase before handover) and the human agent sent only a greeting or a closing message without addressing it, score IssueResolution 0. A greeting alone is not a resolution. Do NOT score NA in this case — the dimension fully applies and the agent clearly failed it.
- NA is only correct for IssueResolution when the customer raised no question or issue at all in the entire interaction.

### Accuracy (graded 0 / 0.5 / 1)
Were the agent's factual claims correct per the Wint KB and policy (product rules, timelines, tax and form guidance, process steps, amounts).
- Judge on the FINAL answer the customer was left with. If the agent gave a wrong or different answer earlier (in text or on a call) and later corrected it, and the final answer matches the KB, Accuracy can still be 1. The change itself is NOT an Accuracy failure; record it in the ANSWER CHANGE GATE instead.
- 1: the final claims are accurate.
- 0.5: a minor inaccuracy that does not change the customer's decision or action.
- 0: a clearly wrong final fact, amount, rule, or process step that a KB check would contradict.
- CALL-ONLY ERROR CAP: an uncorrected error that appears ONLY in a call transcript, with no corroboration in text and not repeated, can lower Accuracy to at most 0.5, never 0, and must set unsure = true with the QA question in the comment, because call transcripts are AI-generated and the attribution or wording may be wrong. An error corroborated in the agent's text, or repeated across the interaction, takes the normal penalty.
- Serious misleading or regulatory errors go to the compliance flag, not here. Apply all Wint policy guardrails above.

### ExpectationFollowThrough (graded 0 / 0.5 / 1)
Does the customer leave knowing what happens next, and does the closing fit the real state of the issue.
- 1: clear timeline or next step where needed, and a closing that matches the outcome.
- 0.5: a next step given but vague, or a closing slightly off.
- 0: the customer asked "when" and got nothing, or the chat closed cheerfully on an unresolved or anxious issue.
- This is about whether a next step was communicated, not whether the timeline quoted was correct. Correctness is Accuracy.

### Personalization (graded 0 / 0.5 / 1)
Was the response built around this customer's situation.
- 1: references the customer's actual bond, amounts, dates, or account state, and on escalated chats uses what the bot already gathered instead of asking the customer to repeat it.
- 0.5: mostly relevant but leans generic where specifics were available.
- 0: a template answer that could be pasted to any customer, or an answer that does not fit this customer.
- Guardrail: if the agent named the specific bond, order, or figure, it IS personalised. A standard explanation of a concept anchored to the customer's case is personalised. Do not mark it generic.

### DissatisfactionHandling (conditional, graded 0 / 0.5 / 1, else "NA")
ONLY score this if the customer shows dissatisfaction: a complaint about the service or product, anger markers (repeated demands, all caps, "??????", restating a grievance after an answer), a threat to leave or escalate ("I will invest elsewhere", "I will file a case", "unfair trade practice"), or distress about stuck money. If none of these appear, score "NA".
When triggered, score how the agent recovered, not the outcome:
- 1: names the specific grievance, stays non-defensive, offers a concrete path forward (a call, escalation, a timeline, raising it with the team), and closes to fit the mood.
- 0.5: polite and correct but misses one key recovery move, for example no path forward for a customer threatening to leave.
- 0: ignores or dismisses the grievance, gets defensive, repeats the same line at an escalating customer, or closes cheerfully on an angry or unresolved chat.
Set dissatisfaction_triggered accordingly and give the trigger_signal.

### Empathy (conditional, graded 0 / 0.5 / 1, else "NA")
ONLY score this on softer emotional moments (confusion, worry, anxiety, an apology) that are NOT strong enough to be dissatisfaction. If DissatisfactionHandling is triggered, score Empathy "NA" so the two never double count. On a calm, purely transactional chat, score Empathy "NA".
- 1: a genuine, specific acknowledgment that fits the moment.
- 0.5: acknowledgment present but generic.
- 0: cold or dismissive where warmth was clearly needed.
- This is NOT a keyword check. Do not reward or require phrases like "I understand your concern". Judge genuine warmth on a moment that warranted it.

### Readability (binary 0 / 1)
Could the customer easily read and understand the messages on a phone.
- 1: clear and readable.
- 0: a genuine barrier, for example a dense wall of text with no breaks, raw internal jargon (EOD, T+1, Flexi-tenure) with no explanation, or an error that changes meaning ("I will you the details").
- NEVER flag: numbered or line-broken lists (good formatting), spacing artifacts ("thankyou"), all caps for emphasis, or minor typos that do not change meaning. Each newline is a separate WhatsApp message, so judge grammar per line, not across the block.

### GreetingHandover (binary 0 / 1)
On taking over, did the human introduce themselves and pick up the thread.
- 1: a greeting that identifies the agent and Wint Wealth, and picks up the escalated context rather than restarting cold.
- 0: no greeting or no self identification.
- NEVER flag a greeting that is present and complete but rendered as one block instead of a separate message. WhatsApp collapses newlines.

### EscalationDecision (conditional, binary 0 / 1, else "NA")
This is a chat-leg judgment about whether the agent made the right decision to move to a voice call. It does NOT judge anything that happened ON the call. The call is scored by a separate call QA system.
- 1: the agent moved to a call when the situation warranted it (a complex explanation the customer needed, follow-ups easier by voice, a distressed customer), or correctly stayed in chat when a call was not needed.
- 0: the agent forced a call with no request and no reason, or clearly should have offered a call (customer was lost after repeated text attempts) and did not.
- "NA" with unsure = false when no call question arises at all.
- Never lower this because a call happened. Escalating to voice is a good move when warranted, not a penalty.

### PostCallRecap (conditional, binary 0 / 1, else "NA")
ONLY applies when a voice call happened in this thread (a call transcript is present in context). Otherwise score "NA" with unsure = false.
When a call happened, the agent must post a short written recap in the chat of what was discussed and decided on the call, so the customer has it in writing. Example of a good recap: "Sir, as discussed over call, your SIP is active and the instalment will go through on the 20th of this month. Please let me know if any other clarity is needed."
- 1: a clear written recap of the call outcome was posted, and it matches what the call transcript shows.
- 0: no written recap was posted after the call, or the recap materially misstates what was discussed on the call.
- Use the call transcript (provided as context) only to confirm the recap is present and accurate. Do NOT score call quality here.

### CallHandling
Retired. The old "we cannot see the call" rule is gone because calls now have transcripts and are scored by the separate call QA system. Its two jobs are now split: the decision to escalate to a call is EscalationDecision, and documenting the call in chat is PostCallRecap. Nothing in the chat rubric scores what was said on the call.

## ANSWER CHANGE GATE (visibility only, human quality, not in the score)
Across the WHOLE interaction (bot messages, agent text, and all call transcripts, in order), detect every place where we changed our answer, our stated process, or our definition of something to the customer. This exists to surface knowledge gaps, process gaps, and places where we compromise or reverse a position, so list every instance for a reviewer.
- Counts as an answer change: a different factual answer to the same question, a revised process or eligibility statement, a changed definition, a bot answer later contradicted or corrected by the agent, a call statement later changed in text, or a text statement changed on a later call.
- Does NOT count: offering a different channel (moving to a call), rephrasing the same answer more clearly, adding detail that does not contradict the earlier answer, or the customer asking a new question.
- For each change, record: the topic, the first answer and where it was given (bot, agent text, or call N), the revised answer and where, and whether the FINAL answer is correct per the KB.
- This list does NOT lower any score by itself. If the final answer is wrong, Accuracy already handles that. The gate is pure visibility.
Set answer_change = true if the list is non-empty.
`

// ── Bot rubric ────────────────────────────────────────────────────────────────
const BOT_RUBRIC = `
## RUBRIC: BOT
Score the bot only. A bot's shortfalls are fixed by changing its flow, prompt, or KB, not by coaching a person, so judge outcomes and safety, not human craft. Do NOT judge greeting style, empathy, closing warmth, or call handling. Those do not apply to a bot.

This rubric runs in one of two modes, stated in the SCENARIO line:
- FULL CHAT: the bot handled and closed the whole chat with no human. Score the entire conversation.
- ESCALATED LEG: the bot handled the start, then transferred to a human. Score ONLY the bot's portion, up to and including the transfer. Everything after the handover belongs to the human rubric, not here. After a transfer the bot cannot handle the chat again; automated follow-up nudges sent after the transfer are system plumbing, not bot handling, and must not be scored for or against the bot.

## BOT HANDOVER CRITERIA (for judging transfers)
{{HANDOVER_CRITERIA}}

### IssueResolution (graded 0 / 0.5 / 1, or "NA" on a correct transfer)
Did the bot do everything from its end to resolve the request AND answer every question it could, not just the first.
- FULL CHAT mode:
  - 1: request resolved and every question answered.
  - 0.5: main ask handled but a secondary question dropped, or only partly answered.
  - 0: the core question went unanswered, or it closed without resolving or handing off.
- ESCALATED LEG mode:
  - "NA" (unsure false): the bot transferred correctly per the handover criteria above. A required transfer is not a resolution failure, resolution simply does not apply to the bot for this chat. This includes transfers because the customer demanded a human, was angry, was not understanding, or hit any listed trigger.
  - 1: before transferring, the bot fully answered whatever it could answer, and the transfer was correct. Use this instead of NA only when the bot genuinely resolved sub-questions on top of a correct transfer.
  - 0: the bot hallucinated, gave up on something it should have handled, or failed to perform as instructed before or during the transfer.
Does not cover: correctness (Accuracy), repetition (NoRepetition), or clarity (Clarity).

### Accuracy (graded 0 / 0.5 / 1)
Was everything the bot stated correct against the KB and the customer's real data (product rules, settlement timelines first T+3 and subsequent T+1 working days, tax and Form 121 guidance, amounts, dates, figures it pulled).
- 1: all claims and figures accurate.
- 0.5: a minor inaccuracy that does not change the customer's action.
- 0: a wrong rule, figure, or process step a KB or data check would contradict.
Guardrails: "submit the form directly with the entity" is correct, and the timelines above are correct. Serious misleading errors escalate to the compliance flag.

### CorrectEscalation (graded 0 / 0.5 / 1)
Did the bot make the right handover decision at the right moment, judged against the BOT HANDOVER CRITERIA above.
- 1: transferred at the right moment per the criteria (including pacifying an angry customer first and setting the out-of-office expectation when applicable), or correctly resolved without needing to transfer.
- 0.5: transferred, but late, after avoidable loops or failed attempts once a trigger had clearly fired.
- 0: a transfer trigger fired and the bot looped or closed instead of transferring, or the bot transferred when no trigger applied and it could clearly have resolved the query itself.
Does not cover: the repetition itself (NoRepetition). Here judge only the handoff decision.

### NoRepetition (graded 0 / 0.5 / 1)
Did the bot make progress, or did it repeat itself instead of adapting. The most important case: the customer pushed back on an answer, said it did not work, said that is not what they asked, or countered it, and the bot simply gave the same answer again instead of trying something new. Repeating the exact information the customer has already rejected or reacted to is the core failure here. It also covers re-sending the same menu or the same canned block after the customer has already responded to it.
- 1: every turn moved the conversation forward. When the customer countered or said the answer did not help, the bot changed its approach, asked a clarifying question, or escalated, rather than repeating.
- 0.5: one avoidable repeat, but it then recovered and moved forward.
- 0: the bot repeated an answer the customer had already countered or reacted to, or re-sent the same response or menu two or more times without progressing. Example: the customer says "still not credited" and the bot re-sends the identical "which payment are you referring to" menu it already sent, instead of engaging with the fact that the customer has already answered and is still stuck.
- A short single-exchange chat with nothing repeated is 1 by default.
Does not cover: whether it should have escalated instead (CorrectEscalation) or whether the answer was correct (Accuracy). Here judge only whether the bot repeated itself instead of adapting.

### Personalization (conditional, graded 0 / 0.5 / 1, else "NA")
Two things together: did the bot use the customer's actual data, AND did it read the conversation and frame its answer to the specific question this customer asked rather than paste a stock block.
- Data: referencing the customer's specific bond, repayment, amount, account, or order state when the question is about their account.
- Framing: shaping the reply around what the customer said, answering the version of the question they actually asked, using details they already gave instead of asking again, not dropping a canned paragraph that only loosely fits.
- 1: uses the customer's real data where relevant AND is framed around what they actually asked.
- 0.5: right data but stock phrasing that does not engage with how they asked, or a generic block where specifics were available.
- 0: a template answer that ignores the customer's data or the conversation context.
- "NA" (unsure false): a generic policy or how-to question with no customer-specific element and only one natural way to answer (for example "can I add a credit card account" answered by a flat policy "no"). Nothing to personalise or reframe.
Does not cover: correctness (Accuracy) or readability (Clarity).

### ExpectationSetting (conditional, graded 0 / 0.5 / 1, else "NA")
When something is pending, did the bot tell the customer what happens next and by when.
- 1: a clear next step or timeline was given (for example "being processed today, will be credited to account ...").
- 0.5: implied but vague ("please allow some time" with no sense of how long or for what).
- 0: left the customer not knowing what happens next on a pending item.
- "NA" (unsure false): the query was fully resolved on the spot with nothing pending.
Does not cover: whether the timeline quoted was correct (Accuracy).

### Clarity (binary 0 / 1)
Was the bot easy to read AND did it explain rather than dump.
- 1: clear, phone-friendly, and it explains where explanation is needed.
- 0: a dense wall of text, unexplained internal jargon (EOD, T+1, Flexi-tenure used raw), or an answer so terse it does not tell the customer what to do.
- Never flag: numbered or line-broken lists (good formatting), spacing artifacts, or all caps for emphasis. Each newline is a separate WhatsApp message, judge per line.
Does not cover: correctness or completeness, only whether it was understandable.
`

// ── Output schemas ────────────────────────────────────────────────────────────
const HUMAN_OUTPUT = `
## OUTPUT
Return ONLY valid JSON in exactly this shape. Do not compute an overall score, that is done in code.
{
  "channel": "human",
  "compliance": { "breach": true or false, "breaches": [ { "type": "advisory | guaranteed_returns | data_handling | misleading_error", "quote": "the exact offending text", "note": "one line" } ] },
  "parameters": {
    "IssueResolution":         { "score": 0 or 0.5 or 1,          "unsure": false, "comment": "why this score" },
    "Accuracy":                { "score": 0 or 0.5 or 1,          "unsure": false, "comment": "why this score, cite KB doc and section if used" },
    "ExpectationFollowThrough":{ "score": 0 or 0.5 or 1,          "unsure": false, "comment": "why this score" },
    "Personalization":         { "score": 0 or 0.5 or 1,          "unsure": false, "comment": "why this score" },
    "DissatisfactionHandling": { "score": 0 or 0.5 or 1 or "NA",  "unsure": false, "comment": "why this score, or why NA (not applicable)" },
    "Empathy":                 { "score": 0 or 0.5 or 1 or "NA",  "unsure": false, "comment": "why this score, or why NA (not applicable)" },
    "Readability":             { "score": 0 or 1,                 "unsure": false, "comment": "why this score" },
    "GreetingHandover":        { "score": 0 or 1,                 "unsure": false, "comment": "why this score" },
    "EscalationDecision":      { "score": 0 or 1 or "NA",         "unsure": false, "comment": "why this score, or why NA. Chat-leg decision to move to a call, never the call itself" },
    "PostCallRecap":           { "score": 0 or 1 or "NA",         "unsure": false, "comment": "why this score, or NA if no call happened" }
  },
  "dissatisfaction_triggered": true or false,
  "trigger_signal": "what the customer said that triggered it, or empty",
  "answer_change": true or false,
  "answer_changes": [ { "topic": "what the answer was about", "first_answer": "what we said first", "first_where": "bot | agent_text | call_1 | call_2 ...", "revised_answer": "what we changed it to", "revised_where": "bot | agent_text | call_1 | call_2 ...", "final_correct_per_kb": true or false } ],
  "unrelated_call_flag": true or false,
  "unrelated_call_note": "why the call content is unrelated to the chat, or empty. Not set when the customer intentionally raised a different question on the call",
  "needs_review": true or false,
  "review_parameters": [ "names of parameters where unsure is true, or empty array" ],
  "kbCitation": "Document > Section, or null",
  "summary": "1 to 2 sentence overall assessment",
  "agentName": "human agent first name, or empty"
}

Rules for the parameters block:
- score is the rating your frontend shows. comment is the text your frontend shows.
- unsure = true ONLY when the dimension applies but you cannot evaluate it from the chat. In that case set score = "NA" and put the specific QA question in comment.
- A conditional dimension that does not apply is score = "NA" with unsure = false. That is not a review item.
- needs_review = true if any parameter has unsure = true. review_parameters lists exactly those names, so QA can open and check only those.
`

const BOT_OUTPUT = `
## OUTPUT
Return ONLY valid JSON in exactly this shape. Do not compute an overall score, that is done in code.
{
  "channel": "bot",
  "compliance": { "breach": true or false, "breaches": [ { "type": "advisory | guaranteed_returns | data_handling | misleading_error", "quote": "the exact offending text", "note": "one line" } ] },
  "parameters": {
    "IssueResolution":    { "score": 0 or 0.5 or 1,         "unsure": false, "comment": "why this score" },
    "Accuracy":           { "score": 0 or 0.5 or 1,         "unsure": false, "comment": "why this score, cite KB if used" },
    "CorrectEscalation":  { "score": 0 or 0.5 or 1,         "unsure": false, "comment": "why this score" },
    "NoRepetition":       { "score": 0 or 0.5 or 1,         "unsure": false, "comment": "why this score" },
    "Personalization":    { "score": 0 or 0.5 or 1 or "NA", "unsure": false, "comment": "why this score, or why NA (generic policy question)" },
    "ExpectationSetting": { "score": 0 or 0.5 or 1 or "NA", "unsure": false, "comment": "why this score, or why NA (nothing pending)" },
    "Clarity":            { "score": 0 or 1,                "unsure": false, "comment": "why this score" }
  },
  "needs_review": true or false,
  "review_parameters": [ "names where unsure is true, or empty array" ],
  "kbCitation": "Document > Section, or null",
  "summary": "1 to 2 sentence overall assessment"
}

Same rules as the human output: unsure = true only when a dimension applies but cannot be evaluated from the chat (score "NA", QA question in comment). A conditional dimension that simply does not apply (Personalization on a generic policy question, ExpectationSetting when nothing is pending) is "NA" with unsure = false. needs_review = true if any unsure is true.
`

// ── System prompt builder ─────────────────────────────────────────────────────
export function buildSystemPrompt(
  channel: 'human' | 'bot',
  policy: string = WINT_POLICY,
  handoverCriteria: string = HANDOVER_CRITERIA
): string {
  const rubric = channel === 'bot'
    ? BOT_RUBRIC.replace('{{HANDOVER_CRITERIA}}', (handoverCriteria || HANDOVER_CRITERIA).trim())
    : HUMAN_RUBRIC
  const output = channel === 'bot' ? BOT_OUTPUT : HUMAN_OUTPUT
  const sharedRules = SHARED_RULES.replace('{{WINT_POLICY}}', (policy || WINT_POLICY).trim())
  return `You are the Wint Wealth Internal Quality Score (IQS) evaluator. You score customer support chats. Your judgments must match those of a trained human QA reviewer.
${sharedRules}
${rubric}
${output}
Output ONLY the JSON. No text before or after.`
}

// ── Channel detection ─────────────────────────────────────────────────────────
const BOT_SENDER_NAMES = new Set(['Bot', 'Myra', 'Robylon AI'])

/** A chat is "human" if any agent message comes from a real person, else "bot". */
export function detectChannel(transcriptJson: string): 'human' | 'bot' {
  try {
    const msgs = JSON.parse(transcriptJson)
    for (const m of msgs) {
      if (m.sender_type === 'agent' && !BOT_SENDER_NAMES.has(m.sender_name)) return 'human'
    }
  } catch (_e) {
    // if the transcript is a plain string, fall back to human so nothing is under-scored
    return 'human'
  }
  return 'bot'
}

// ── Gentle transcript prep (no middle-cutting) ────────────────────────────────
/**
 * v1 cut the middle out of any chat over 5000 chars, which hid a third of long
 * conversations from the scorer. With no cost cap we keep the whole conversation.
 * We only dedupe consecutive identical lines and cap absurdly long single lines.
 * NOTE: the pipeline must strip internal notes BEFORE calling this. Internal notes
 * are never passed to the model, not even as context.
 */
export function prepTranscript(transcript: string, maxChars = 40000): string {
  const lines = transcript.split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0)
    .map(l => (l.length > 800 ? l.slice(0, 797) + '...' : l))

  const deduped: string[] = []
  for (const line of lines) {
    if (deduped.length === 0 || deduped[deduped.length - 1] !== line) deduped.push(line)
  }
  const joined = deduped.join('\n')
  if (joined.length <= maxChars) return joined
  // Extremely rare. Keep head and tail and mark the cut so the scorer knows.
  const head = joined.slice(0, Math.round(maxChars * 0.6))
  const tail = joined.slice(joined.length - Math.round(maxChars * 0.35))
  return head + '\n[... long transcript, middle omitted, score on what is visible ...]\n' + tail
}

// ── User prompt builder ───────────────────────────────────────────────────────
/**
 * Scoring legs per interaction type (each leg is one call to this builder):
 *   Type 1 (bot only)            -> 1 pass:   leg 'bot'   (bot mode: FULL CHAT)
 *   Type 2 (bot + human text)    -> 2 passes: leg 'bot'   (bot mode: ESCALATED LEG)
 *                                             leg 'human' (no calls)
 *   Type 3 (bot + human + calls) -> 2 passes here + per-call scoring in your separate call QA:
 *                                             leg 'bot'   (bot mode: ESCALATED LEG)
 *                                             leg 'human' (calls passed in callTranscripts, in order)
 * Pass the SAME full transcript for both legs; the scenario line tells the model
 * which portion to score. callTranscripts is an ordered array (call 1 first). If the
 * pipeline can interleave (timestamps), place markers in the transcript instead and
 * still pass the array so calls are labelled.
 */
export function buildScoringPrompt(
  transcript: string,
  opts: {
    chatId?: string,
    kbContext?: string,
    slackThread?: string,
    /** ordered call transcripts, first call first. Preferred over callContext. */
    callTranscripts?: string[],
    /** legacy single-call field, still accepted */
    callContext?: string,
    /** which leg to score. Default: auto ('bot' for bot-only chats, 'human' for escalated) */
    leg?: 'bot' | 'human',
    channel?: 'human' | 'bot',
    policy?: string,
    handoverCriteria?: string,
  } = {}
): { system: string, user: string, channel: 'human' | 'bot', leg: 'bot' | 'human', scenario: 1 | 2 | 3 } {
  const detected = opts.channel || detectChannel(transcript)
  const calls = (opts.callTranscripts && opts.callTranscripts.length > 0)
    ? opts.callTranscripts
    : (opts.callContext ? [opts.callContext] : [])
  const escalated = detected === 'human'
  const scenario: 1 | 2 | 3 = !escalated ? 1 : (calls.length > 0 ? 3 : 2)
  // Which leg is being scored in THIS pass. Bot-only chats have only a bot leg.
  const leg: 'bot' | 'human' = !escalated ? 'bot' : (opts.leg || 'human')
  const today = new Date().toISOString().split('T')[0]

  let scenarioLine: string
  if (scenario === 1) {
    scenarioLine = 'SCENARIO: Type 1, bot-only chat. The bot handled the whole chat and closed it with no human agent. Apply the BOT rubric in FULL CHAT mode.'
  } else if (leg === 'bot') {
    scenarioLine = `SCENARIO: Type ${scenario}, escalated chat, BOT LEG. The bot handled the start of this chat and then transferred it to a human agent. Apply the BOT rubric in ESCALATED LEG mode: score ONLY the bot's portion, up to and including the transfer. Judge the transfer against the BOT HANDOVER CRITERIA. Everything after the handover (the human agent's messages${calls.length > 0 ? ' and the calls' : ''}) is context only and is scored separately. Automated follow-up nudges after the transfer are system plumbing, not bot handling.`
  } else if (scenario === 2) {
    scenarioLine = 'SCENARIO: Type 2, bot then human chat, HUMAN LEG. The bot escalated to a human agent, who resolved by text only. No voice call took place, so PostCallRecap is NA and there are no call transcripts. Apply the HUMAN rubric and score only the human agent\'s text turns from handover onward. The bot\'s portion is context and is scored separately.'
  } else {
    scenarioLine = `SCENARIO: Type 3, bot then human chat with voice call(s), HUMAN LEG. The bot escalated to a human agent, and ${calls.length === 1 ? 'one voice call' : calls.length + ' voice calls'} also happened, possibly interleaved with text (text, call, text, another call). The call transcripts below are numbered in order of occurrence and are CONTEXT ONLY, each call is scored individually by the separate call QA system. Apply the HUMAN rubric to the human agent's text turns only. PostCallRecap applies after each call. Detect answer changes across the whole flow for the ANSWER CHANGE GATE. Call transcripts are AI-generated and may misattribute speakers or words.`
  }

  const kb = opts.kbContext
    ? '\n## WINT KNOWLEDGE BASE REFERENCE\nUse these KB excerpts to judge Accuracy.\n\n' + opts.kbContext
    : ''
  const slack = opts.slackThread ? '\n## SLACK THREAD (context)\n' + opts.slackThread : ''
  const callBlocks = calls.map((c, i) =>
    `\n## CALL ${i + 1} TRANSCRIPT (context only, scored separately by call QA)\n${prepTranscript(c)}`
  ).join('')

  const user = `Score the following interaction.

${scenarioLine}
Today (scoring date): ${today}
${kb}
## TRANSCRIPT
${prepTranscript(transcript)}
${callBlocks}${slack}
Output ONLY the JSON.`
  return {
    system: buildSystemPrompt(leg === 'bot' ? 'bot' : 'human', opts.policy, opts.handoverCriteria),
    user,
    channel: detected,
    leg,
    scenario,
  }
}

// ── Deterministic IQS from the model's per-parameter output ───────────────────
type ScoreVal = number | 'NA'
type ParamCell = { score: ScoreVal, unsure?: boolean, comment?: string }

export function computeIQS(parameters: Record<string, ParamCell>, channel: 'human' | 'bot'): number | null {
  const weights = channel === 'bot' ? BOT_WEIGHTS : HUMAN_WEIGHTS
  let num = 0
  let den = 0
  for (const key of Object.keys(weights)) {
    const w = weights[key]
    if (w === 0) continue
    const cell = parameters[key]
    if (!cell) continue
    const v = cell.score
    if (v === 'NA' || v === undefined || v === null) continue // NA is out of numerator AND denominator
    const s = typeof v === 'number' ? v : parseFloat(String(v))
    if (Number.isNaN(s)) continue
    num += w * s
    den += w
  }
  if (den === 0) return null
  return Math.round((num / den) * 100)
}

// ── Parse the model response and attach the computed score ────────────────────
export function parseAndScore(raw: string) {
  const cleaned = raw.replace(/```json/gi, '').replace(/```/g, '').trim()
  const data = JSON.parse(cleaned)
  const channel: 'human' | 'bot' = data.channel === 'bot' ? 'bot' : 'human'
  const parameters: Record<string, ParamCell> = data.parameters || {}
  const iqs = computeIQS(parameters, channel)

  // Which parameters need a human to check (applies but could not be evaluated).
  const review_parameters = Object.keys(parameters).filter(k => parameters[k] && parameters[k].unsure === true)
  const needs_review = review_parameters.length > 0

  // EscalationDecision now carries weight (lowers IQS) and also raises a flag for visibility.
  const esc = parameters.EscalationDecision
  const escalation_flag = channel === 'human' && !!esc && esc.score === 0 && esc.unsure !== true
  // A call happened but the agent did not recap it in writing.
  const recap = parameters.PostCallRecap
  const missing_recap_flag = channel === 'human' && !!recap && recap.score === 0 && recap.unsure !== true

  return {
    channel,
    iqs_score: iqs,                 // computed here, never taken from the model
    parameters,                     // { Name: { score, unsure, comment } } for your frontend
    needs_review,                   // true if any parameter is unsure
    review_parameters,              // exact list QA should open and check
    compliance_flag: !!(data.compliance && (data.compliance.breach || (data.compliance.breaches || []).length > 0)),
    compliance: data.compliance || { breach: false, breaches: [] },
    breaches: (data.compliance && data.compliance.breaches) || [], // every instance, for the reviewer to see each mistake
    breach_count: ((data.compliance && data.compliance.breaches) || []).length,
    escalation_flag,
    missing_recap_flag,
    dissatisfaction_triggered: !!data.dissatisfaction_triggered,
    trigger_signal: data.trigger_signal || '',
    // Answer Change Gate (human quality, visibility only, never lowers the score)
    answer_change: !!data.answer_change || ((data.answer_changes || []).length > 0),
    answer_changes: data.answer_changes || [],   // every topic where we changed our answer, for the reviewer
    unrelated_call_flag: !!data.unrelated_call_flag,
    unrelated_call_note: data.unrelated_call_note || '',
    kbCitation: data.kbCitation ?? null,
    summary: data.summary || '',
    agentName: data.agentName || '',
  }
}
