import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import Anthropic from '@anthropic-ai/sdk';
import { readConfig } from '@/lib/config';
import { getOrderedGeminiKeys, geminiGenerate } from '@/lib/gemini';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { messages, allAnswers } = await req.json();
  const latestUserMessage = [...messages].reverse().find((m: any) => m.role === 'user');
  const query = latestUserMessage?.content || '';

  const config = await readConfig();
  const provider = config.llmProvider || 'gemini';
  // Analyze always uses Flash — fast, cheap, sufficient for JSON classification
  const geminiKeys = getOrderedGeminiKeys(config);

  const conversationHistory = messages
    .slice(0, -1)
    .map((m: any) => `${m.role.toUpperCase()}: ${m.content}`)
    .join('\n');

  const existingAnswersJson = JSON.stringify(allAnswers || {}, null, 2);

  const analyzePrompt = `You are a query classifier and step-by-step diagnostic router for Wint Wealth CX support.

EXISTING CONFIRMED ANSWERS (already collected in previous steps):
${existingAnswersJson}

CONVERSATION HISTORY:
${conversationHistory || 'None'}

LATEST QUERY:
${query}

---

RETURN FORMAT — return ONLY valid JSON, no markdown, no explanation:
{"queryType":"direct"|"process","questions":[{"id":"field_id","label":"Short question for agent","options":["opt1","opt2"]}],"stepTitle":"Step N: Description"}

---

STEP 0 — CLASSIFY THE QUERY FIRST. DO THIS BEFORE ANYTHING ELSE.

Classify the query as one of two types:

DIRECT — educational or informational. The answer is the same regardless of any specific user's data.
Examples:
- "How do I sell bonds on the platform?"
- "What documents are needed for HUF KYC?"
- "What is the UPI limit for SIP?"
- "Explain DDPI"
- "How does Form 15G work?"
- "What is the process for nominee update?"
- "What is TDS on bond investments?"
- "How does repayment work?"
- Any "how to", "what is", "explain", "what are the steps for", "what is the policy on" question
→ Return: {"queryType":"direct","questions":[],"stepTitle":""}

PROCESS — diagnostic or user-specific. The answer depends on the specific user's situation and state.
Examples:
- "User's KYC is still pending"
- "Bond not showing in portfolio after payment"
- "User wants to sell but button is greyed out"
- "SIP not setting up"
- "Repayment not received"
- "Payment failed"
- "User is facing [any problem]"
- Any query where you need to investigate the user's specific data before answering
→ Proceed to the decision tree below and return: {"queryType":"process","questions":[...],"stepTitle":"..."}

CONVERSATIONAL — greeting, acknowledgment, follow-up with no new query
→ Return: {"queryType":"direct","questions":[],"stepTitle":""}

If DIRECT or CONVERSATIONAL: stop here, return immediately. Do NOT run the decision tree.
If PROCESS: continue to STEP 1 below.

---

STEP 0B — EXTRACT EXPLICITLY STATED FACTS FROM THE QUERY:

Before running the decision tree, scan the query for field values that are DIRECTLY AND UNAMBIGUOUSLY STATED — not guessed, not inferred, but explicitly said.

The rule: if removing the fact from the query would change its meaning, it is explicitly stated.

Examples of EXPLICIT facts (treat as pre-filled):
- "user is unable to pay using netbanking" → payment_mode = Net Banking
- "payment failed on Razorpay" → gateway = Razorpay
- "user's AOF has expired" → aof_status = expired
- "DDPI is active but sell button is greyed out" → ddpi_signed = yes, ddpi_activation_status = active
- "user hasn't made any investment yet" → completed_one_investment = no
- "payment was successful but bond not showing" → payment_status = success
- "user is on UPI AutoPay" → payment_method = UPI AutoPay
- "repayment date falls on a holiday" → falls_on_holiday = yes

Examples of VAGUE inferences (do NOT pre-fill — still ask):
- "user wants to sell bonds" → does NOT confirm ddpi_signed, sell_order_placed, or any other field
- "user's KYC is stuck" → does NOT confirm aof_status value
- "payment not going through" → does NOT confirm payment_status value (could be failed or pending on Finder — must check)

Add extracted explicit facts to a working set called EXTRACTED FACTS. Treat them exactly like EXISTING CONFIRMED ANSWERS — do not ask for any field whose value is already in EXTRACTED FACTS.

---

MANDATORY PRE-CHECK — DO THIS BEFORE ANYTHING ELSE:

Combine EXISTING CONFIRMED ANSWERS + EXTRACTED FACTS into one set of known values.
- Any field ID present in this combined set is DONE — never ask it again.
- If every field needed for a step is in the combined set, that step is DONE — move to the next.
- If every step is DONE or SKIPPED → return {"questions":[]}.
- If a step's branch condition is not met by the combined set — skip that step entirely.

---

CORE RULES:
1. Walk the decision tree for the detected query type top-to-bottom
2. A step is DONE if ALL its question IDs are in EXISTING CONFIRMED ANSWERS + EXTRACTED FACTS
3. A conditional step is SKIPPED if its condition is not met by the combined known values
4. Return ONLY the questions for the FIRST step that is neither DONE nor SKIPPED
5. If all steps are DONE or SKIPPED → return {"questions":[]}
6. Also check CONVERSATION HISTORY — if a value was explicitly stated by the agent in a previous turn, treat it as confirmed
7. NEVER return a question whose id is already in the combined known set
8. NEVER ask free-text fields — all questions must have discrete options
9. NEVER invent option values — use ONLY the exact options listed in each step
10. NEVER infer vague or assumed answers from the query. Only extract what is directly and unambiguously stated (see STEP 0B above).
11. ALWAYS start from STEP 1 of the matched tree and walk forward. Never skip ahead based on implied context — only skip steps whose questions are already answered in the combined known set.

---

DECISION TREES:

════════════════════════════════════════════
KYC — TYPES A1 & A2
════════════════════════════════════════════

=== A1/A2 — KYC Submission / KYC Still Pending ===
Triggers: Any KYC-related query — KYC not submitted, KYC pending, KYC stuck, KYC not approved

AOF STATUS IS THE FIRST AND MANDATORY GATE. Nothing else is asked until AOF status is known.

STEP 1 — stepTitle: "Step 1: AOF Status"
  Ask: aof_status (blank / pending / expired / signed)
  Meaning of each option:
    blank   = user has not started KYC at all (form not submitted)
    pending = user submitted KYC but has NOT yet eSigned the AOF (eSign link sent but not completed)
    expired = eSign link has expired (needs to be reset)
    signed  = user has successfully eSigned the AOF — KYC is in progress
  → aof_status = blank   → RESOLVED immediately (user has not started KYC)
  → aof_status = expired → RESOLVED immediately (AOF expired, needs reset)
  → aof_status = pending → RESOLVED immediately (user needs to eSign — send them the eSign link)
  → aof_status = signed  → STEP 2

STEP 2 [only if aof_status = signed] — stepTitle: "Step 2: SEBI KYC Status"
  Ask: sebi_kyc_status (blank / pending / approved)
  → sebi_kyc_status = blank   → RESOLVED (form submitted, SEBI not yet updated — wait)
  → sebi_kyc_status = pending → RESOLVED (under SEBI KRA review, 3 working days)
  → sebi_kyc_status = approved → STEP 3

STEP 3 [only if sebi_kyc_status = approved] — stepTitle: "Step 3: Individual KYC Check Statuses"
  Ask ALL FOUR together (they are all checked simultaneously from Finder):
    kra_status (approved / blank / pending)
    aml_status (approved / blank / pending)
    insta_demat_status (completed / blank / pending)
    ucc_status (active / blank / pending)
  → Evaluate all four answers together:
    If kra_status != approved → STEP 4a
    If kra_status = approved AND aml_status != approved → STEP 4a
    If kra_status = approved AND aml_status = approved AND insta_demat_status != completed → STEP 4a
    If kra_status = approved AND aml_status = approved AND insta_demat_status = completed AND ucc_status = blank → STEP 4b
    If all four = approved/completed/active → RESOLVED (KYC fully complete)

STEP 4a [only if KRA or AML or Insta Demat is not cleared] — stepTitle: "Step 4: KRA Issue Details"
  Ask:
    payment_awaiting_settlement (yes / no)
    kra_in_tracking_sheet (yes / no / not checked yet)
    which_kra (CVL / NDML / other)
  → RESOLVED

STEP 4b [only if all three approved/completed but ucc_status = blank] — stepTitle: "Step 4: UCC Activation — PAN Check"
  Ask: pan_card_self_attested_shared (yes / no)
  → RESOLVED

---

=== A3a — KYC Proceed Button Not Working ===
Triggers: Button not working on any KYC screen, stuck on a KYC step

STEP 1 — stepTitle: "Step 1: Which KYC Step Is Failing"
  Ask: failing_step (PAN upload / selfie / Aadhaar / signature / AOF)
  → STEP 2

STEP 2 — stepTitle: "Step 2: Troubleshooting Attempts"
  Ask: tried_switching_network_or_device (yes / no)
  → RESOLVED

---

=== A3b — Credential Already Linked to Another Account ===
Triggers: Aadhaar, PAN, or bank account already linked to a different Wint account

STEP 1 — stepTitle: "Step 1: Conflict Details"
  Ask: conflicting_credential (Aadhaar / PAN / bank account)
  → STEP 2

STEP 2 — stepTitle: "Step 2: User's Decision"
  Ask: user_decision (keep new account / keep old account)
  → RESOLVED

---

=== A3c — PAN and Aadhaar Not Linked ===
Triggers: KYC failing because PAN-Aadhaar are not linked

STEP 1 — stepTitle: "Step 1: PAN-Aadhaar Linking Status"
  Ask: linking_attempted (yes / no / says already linked)
  → linking_attempted = yes → RESOLVED
  → linking_attempted = no → RESOLVED
  → linking_attempted = says already linked → STEP 2

STEP 2 [only if says already linked] — stepTitle: "Step 2: Proof of Linking"
  Ask: screenshot_received (yes / no)
  → RESOLVED

---

=== A3d — OTP Not Received (Aadhaar KYC) ===
Triggers: OTP for Aadhaar verification not received during KYC

STEP 1 — stepTitle: "Step 1: SMS Checks Completed"
  Ask:
    checked_sms_folders (yes / no)
    sms_limit_checked (yes / no)
  → STEP 2

STEP 2 — stepTitle: "Step 2: Retry After Checks"
  Ask: retried_after_check (yes / no)
  → RESOLVED

---

=== A3e — Date of Birth Mismatch ===
Triggers: DOB mismatch between Aadhaar and PAN during KYC

STEP 1 — stepTitle: "Step 1: DOB Mismatch — Document and Status"
  Ask:
    incorrect_dob_document (Aadhaar / PAN)
    correction_initiated (yes / no)
  → RESOLVED

---

=== A3f — Selfie / Image Capture Issues ===
Triggers: Selfie failing, liveliness check failing, image capture problems

STEP 1 — stepTitle: "Step 1: Standard Troubleshooting Attempted"
  Ask: tried_standard_fixes (yes / no)
  → RESOLVED

---

=== A4 — Penny Test Refund Not Received ===
Triggers: Rs.1 bank verification refund not received
→ No discrete option fields exist for this type. Return {"questions":[]} — resolve directly from conversation.

---

=== A5 — Nominee Update ===
Triggers: Adding, changing, or updating nominee on demat account

STEP 1 — stepTitle: "Step 1: Nominee Change Type"
  Ask: replacing_or_adding (replacing / adding)
  → STEP 2

STEP 2 — stepTitle: "Step 2: Number of Nominees Desired"
  Ask: nominee_count_desired (1 / more than 1)
  → RESOLVED

---

=== A6 — Signing Error on Forms ===
Triggers: Error while e-signing DDPI, 15G/H, Nominee, Bank Change, or Account Closure form

STEP 1 — stepTitle: "Step 1: Error Screenshot Received"
  Ask: screenshot_received (yes / no)
  → STEP 2

STEP 2 — stepTitle: "Step 2: Aadhaar Being Used for Signing"
  Ask: whose_aadhaar (own / nominee or another person)
  → whose_aadhaar = nominee or another person → RESOLVED
  → whose_aadhaar = own → STEP 3

STEP 3 [only if own Aadhaar, name mismatch suspected] — stepTitle: "Step 3: PAN-Aadhaar Name Match"
  Ask: pan_aadhaar_linked (yes / no)
  → RESOLVED

---

=== A7 — HUF KYC ===
Triggers: HUF account KYC query or initiation

STEP 1 — stepTitle: "Step 1: HUF Tracking Sheet Status"
  Ask: in_huf_tracking_sheet (yes / no)
  → RESOLVED

---

════════════════════════════════════════════
PAYMENTS & ORDERS — TYPES B1–B5
════════════════════════════════════════════

=== B1 — First Investment / Insta Payment ===
Triggers: User made first-ever payment (before demat), asks about order status

STEP 1 — stepTitle: "Step 1: Payment Status"
  Ask: payment_status (success / failed / pending)
  → payment_status = failed → RESOLVED (payment not confirmed, no order placed)
  → payment_status = pending → RESOLVED (payment pending, no order yet)
  → payment_status = success → STEP 2

STEP 2 [only if payment_status = success] — stepTitle: "Step 2: KYC Approval Status"
  Ask ALL FOUR:
    kra_status (approved / blank / pending)
    aml_status (approved / blank / pending)
    insta_demat_status (completed / blank / pending)
    ucc_status (active / blank / pending)
  → STEP 3

STEP 3 — stepTitle: "Step 3: T+3 Working Day Window"
  Ask: before_or_after_t3_working_days (before T+3 / after T+3)
  → RESOLVED

---

=== B2 — Normal Buy Order Settlement Delay ===
Triggers: Bond not showing in portfolio after payment, order taking too long

STEP 1 — stepTitle: "Step 1: Payment and Order Basics"
  Ask:
    payment_status (success / failed / pending)
    first_investment (yes / no)
  → payment_status = failed or pending → RESOLVED (payment issue, not settlement)
  → payment_status = success AND first_investment = yes → RESOLVED (first investment before demat — handle as B1 Insta Payment flow)
  → payment_status = success AND first_investment = no → STEP 2

STEP 2 [only if payment_status = success] — stepTitle: "Step 2: Referral Status"
  Ask: referred_user (yes / no)
  → referred_user = no → RESOLVED (standard T+1 settlement)
  → referred_user = yes → STEP 3

STEP 3 [only if referred_user = yes] — stepTitle: "Step 3: Referral Reward Limit"
  Ask: referral_limit_exhausted (yes / no)
  → RESOLVED

---

=== B3 — Payment Failed / Not Going Through ===
Triggers: Payment failed, amount deducted but order not placed, payment not completing

STEP 1 — stepTitle: "Step 1: Payment Status on Finder"
  Ask: payment_status (success / failed / pending)
  → payment_status = success → RESOLVED (payment confirmed, handle as settlement delay B2)
  → payment_status = failed or pending → STEP 2

STEP 2 [only if payment failed or pending] — stepTitle: "Step 2: Payment Method and Gateway"
  Ask:
    payment_mode (UPI / Net Banking)
    gateway (Razorpay / Cashfree)
  → STEP 3

STEP 3 — stepTitle: "Step 3: Retry Attempt"
  Ask: retried (yes / no)
  → RESOLVED

---

=== B4 — Bond Units / Purchase Limit ===
Triggers: Cannot buy certain units, limit differs, bond shows unavailable

STEP 1 — stepTitle: "Step 1: Referral and Seller Assignment"
  Ask:
    referred_user (yes / no)
    seller_assigned (Ambium Finserv / Fourdegree Water Services)
  → RESOLVED

---

=== B5 — Refund Not Received ===
Triggers: Refund not received after failed investment, KYC rejection, cancelled order

STEP 1 — stepTitle: "Step 1: Bank Account and Refund Status"
  Ask:
    bank_account_active (yes / no)
    principal_received (yes / no)
    brokerage_paid (yes / no)
  → STEP 2

STEP 2 — stepTitle: "Step 2: New Payment Attempt After Failure"
  Ask: trying_new_payment_after_failure (yes / no)
  → trying_new_payment_after_failure = no → RESOLVED
  → trying_new_payment_after_failure = yes → STEP 3

STEP 3 [only if trying_new_payment_after_failure = yes] — stepTitle: "Step 3: UCC Deletion Timeline"
  Ask:
    t5_working_days_elapsed (yes / no)
    after_1230pm_on_deletion_date (yes / no)
  → RESOLVED

---

════════════════════════════════════════════
REPAYMENTS — TYPES C1–C2
════════════════════════════════════════════

=== C1 — Repayment Not Received ===
Triggers: Scheduled interest or principal repayment not credited to bank

STEP 1 — stepTitle: "Step 1: Repayment Date — Holiday Check"
  Ask: falls_on_holiday (yes / no)
  → falls_on_holiday = yes → RESOLVED (next working day — no action needed)
  → falls_on_holiday = no → STEP 2

STEP 2 [only if not a holiday] — stepTitle: "Step 2: Current Time Check"
  Ask: current_time_vs_9pm (before 9pm / after 9pm)
  → current_time_vs_9pm = before 9pm → RESOLVED (repayments process until 9 PM — ask user to wait)
  → current_time_vs_9pm = after 9pm → STEP 3

STEP 3 [only if after 9pm and not a holiday] — stepTitle: "Step 3: Recent Bank Account Change"
  Ask: recent_bank_change (yes / no)
  → recent_bank_change = no → RESOLVED (repayment overdue — escalate)
  → recent_bank_change = yes → STEP 4

STEP 4 [only if recent_bank_change = yes] — stepTitle: "Step 4: Bank Change Timing vs Record Date"
  Ask:
    change_before_or_after_record_date (before record date / after record date)
    old_account_access_if_applicable (yes / no)
  → RESOLVED

---

=== C2 — Repayment Amount Mismatch ===
Triggers: Amount received differs from what dashboard shows

STEP 1 — stepTitle: "Step 1: Mismatch Direction"
  Ask: difference_direction (receiving more than expected / receiving less than expected)
  → RESOLVED

---

════════════════════════════════════════════
SELL & DDPI — TYPES D1–D2
════════════════════════════════════════════

=== D1 — Sell Order / Liquidity ===
Triggers: User wants to sell bonds, Sell Anytime query, sell option disabled, sell proceeds not received

STEP 1 — stepTitle: "Step 1: DDPI Signing Status"
  Ask: ddpi_signed (yes / no / in progress)
  → ddpi_signed = no → RESOLVED (cannot sell without DDPI — guide user to sign)
  → ddpi_signed = yes or in progress → STEP 2

STEP 2 [only if DDPI signed or in progress] — stepTitle: "Step 2: DDPI Activation Status"
  Ask: ddpi_activation_status (active / pending)
  → ddpi_activation_status = pending → RESOLVED (activation in progress, 24–48 working hours)
  → ddpi_activation_status = active → STEP 3

STEP 3 [only if DDPI active] — stepTitle: "Step 3: Sell Order and Bond Details"
  Ask:
    sell_order_placed (yes / no)
    flexi_tenure_bond (yes / no)
    record_date_or_negative_news (yes / no)
  → sell_order_placed = yes → STEP 4
  → sell_order_placed = no → RESOLVED (check if restriction applies)

STEP 4 [only if sell_order_placed = yes] — stepTitle: "Step 4: Settlement Timeline Check"
  Ask: t1_elapsed_since_order (yes / no)
  → RESOLVED

---

=== D2 — DDPI Signing or Deactivation ===
Triggers: DDPI questions, wanting to deactivate DDPI, DDPI not activating

STEP 1 — stepTitle: "Step 1: DDPI Current Status and Request Type"
  Ask:
    current_ddpi_status (not signed / signed — pending activation / active)
    activation_or_deactivation (activation / deactivation)
  → activation_or_deactivation = activation → RESOLVED (guide based on current_ddpi_status)
  → activation_or_deactivation = deactivation → STEP 2

STEP 2 [only if deactivation requested] — stepTitle: "Step 2: Deactivation Email Sent"
  Ask: emailed_hello_for_deactivation (yes / no)
  → RESOLVED

---

════════════════════════════════════════════
SIP — TYPES E1–E5
════════════════════════════════════════════

=== E1 — SIP Setup Issues ===
Triggers: Cannot set up SIP, AutoPay not working, mandate failing to set up

STEP 1 — stepTitle: "Step 1: SIP Eligibility"
  Ask: completed_one_investment (yes / no)
  → completed_one_investment = no → RESOLVED (not eligible — must complete one investment first)
  → completed_one_investment = yes → STEP 2

STEP 2 [only if eligible] — stepTitle: "Step 2: Payment Method Being Set Up"
  Ask: payment_method (UPI AutoPay / eNACH)
  → STEP 3

STEP 3 — stepTitle: "Step 3: Mandate Status"
  Ask: mandate_status (active / pending activation / failed / not set up)
  → mandate_status = pending activation → RESOLVED (mandate submitted, awaiting activation — standard wait time)
  → mandate_status = active AND payment_method = UPI AutoPay → STEP 4a
  → mandate_status = active AND payment_method = eNACH → STEP 4b
  → mandate_status = failed → STEP 4b
  → mandate_status = not set up → STEP 4b

STEP 4a [only if active UPI AutoPay mandate] — stepTitle: "Step 4: UPI Amount Limit Check"
  Ask: sip_amount_over_10k (yes / no)
  → sip_amount_over_10k = yes → RESOLVED (UPI AutoPay capped at Rs.10,000 — must switch to eNACH)
  → sip_amount_over_10k = no → STEP 4b

STEP 4b — stepTitle: "Step 4: Error Recording"
  Ask: screen_recording_received (yes / no)
  → RESOLVED

---

=== E2 — SIP Date or Amount Change ===
Triggers: User wants to change SIP date or SIP amount

STEP 1 — stepTitle: "Step 1: Active SIP and Upcoming Order"
  Ask:
    active_sip_on_finder (yes / no)
    upcoming_sip_order_placed (yes / no)
  → active_sip_on_finder = no → RESOLVED (no active SIP found — verify user ID)
  → active_sip_on_finder = yes AND upcoming_sip_order_placed = yes → RESOLVED (upcoming instalment already placed — change will apply from next cycle, inform user)
  → active_sip_on_finder = yes AND upcoming_sip_order_placed = no → STEP 2

STEP 2 [only if active SIP confirmed] — stepTitle: "Step 2: Mandate Type and Email Confirmation"
  Ask:
    mandate_type (UPI AutoPay / eNACH)
    email_confirmation_received (yes / no)
  → mandate_type = UPI AutoPay → STEP 3
  → mandate_type = eNACH → RESOLVED (eNACH supports any amount — process change via CX-TL)

STEP 3 [only if mandate_type = UPI AutoPay] — stepTitle: "Step 3: New Amount vs UPI Limit"
  Ask: new_sip_amount_over_10k (yes / no)
  → RESOLVED

---

=== E3 — SIP Deducted but Bond Not Visible / Duplicate SIP Debit ===
Triggers: SIP amount debited but no bond showing, duplicate SIP deduction reported

STEP 1 — stepTitle: "Step 1: SIP Active Status on Finder"
  Ask: active_sip_on_finder (yes / no)
  → active_sip_on_finder = no → RESOLVED (SIP not found on Finder — debit may be from a cancelled mandate or bank error, not a Wint SIP)
  → active_sip_on_finder = yes → STEP 2

STEP 2 [only if active SIP confirmed on Finder] — stepTitle: "Step 2: Duplicate Confirmation — Bank Statement"
  Ask: bank_statement_confirming_duplicate (yes / no)
  → RESOLVED

---

=== E4 — SIP Cancellation ===
Triggers: User wants to cancel SIP entirely

STEP 1 — stepTitle: "Step 1: Active SIP Confirmation"
  Ask: active_sip_confirmed (yes / no)
  → active_sip_confirmed = no → RESOLVED (no active SIP — verify user ID)
  → active_sip_confirmed = yes → STEP 2

STEP 2 [only if active SIP confirmed] — stepTitle: "Step 2: Skip Alternative Offered and Upcoming Order"
  Ask:
    skip_instalment_offered_first (yes / no)
    upcoming_sip_order_placed (yes / no)
  → STEP 3

STEP 3 — stepTitle: "Step 3: Email Confirmation"
  Ask: email_confirmation_received (yes / no)
  → RESOLVED

---

=== E5 — SIP Order Skip / Specific Instalment Cancellation ===
Triggers: User wants to skip or cancel a specific SIP instalment (not the full SIP)

STEP 1 — stepTitle: "Step 1: AutoPay Raised to NPCI"
  Ask: autopay_raised_to_npci (yes / no)
  → autopay_raised_to_npci = yes → RESOLVED (cannot cancel — debit will proceed this cycle)
  → autopay_raised_to_npci = no → STEP 2

STEP 2 [only if not yet raised to NPCI] — stepTitle: "Step 2: App Version and Skip Guidance"
  Ask:
    on_latest_app_version (yes / no)
    guided_to_skip_instalment (yes / no)
  → RESOLVED

---

════════════════════════════════════════════
REFERRALS — TYPES F1–F4
════════════════════════════════════════════

=== F1 — Referral Reward Not Received ===
Triggers: Referral reward not credited, not visible, referral not tracked

STEP 1 — stepTitle: "Step 1: Referee Prerequisites"
  Ask:
    referee_kyc_complete (yes / no)
    referee_demat_created (yes / no)
    referee_order_settled (yes / no)
  → If ANY = no → RESOLVED (prerequisite not met — reward not yet triggered)
  → All three = yes → STEP 2

STEP 2 [only if all prerequisites met] — stepTitle: "Step 2: Reward Status on Finder"
  Ask: reward_status_on_finder (transferred / pending / not found)
  → reward_status_on_finder = pending or not found → RESOLVED
  → reward_status_on_finder = transferred → STEP 3

STEP 3 [only if transferred] — stepTitle: "Step 3: UTR Obtained"
  Ask: utr_obtained_if_transferred (yes / no)
  → RESOLVED

---

=== F2 — Referral Not Mapped / Manual Mapping ===
Triggers: Referral link used but mapping failed, signed up without link

STEP 1 — stepTitle: "Step 1: Signup Method"
  Ask: signup_method (via referral link / downloaded independently)
  → STEP 2

STEP 2 — stepTitle: "Step 2: Investment History and Mixpanel"
  Ask:
    referee_has_investments (yes / no)
    mixpanel_reviewed (yes / no)
  → RESOLVED

---

=== F3 — Referral Reward Calculation Query ===
Triggers: User questions how referral reward was calculated or why it is lower

STEP 1 — stepTitle: "Step 1: Order Type"
  Ask:
    order_type (one-time / SIP)
  → RESOLVED

---

=== F4 — Referral Removal and Replacement ===
Triggers: Referrer wants to remove existing referee and add a different one

STEP 1 — stepTitle: "Step 1: Existing Referee Investment Status"
  Ask: existing_referee_has_investments (yes / no)
  → existing_referee_has_investments = yes → RESOLVED (change not possible — investments exist)
  → existing_referee_has_investments = no → STEP 2

STEP 2 [only if no investments by existing referee] — stepTitle: "Step 2: Three-Party Email Confirmations"
  Ask:
    existing_referee_email_consent (yes / no)
    new_referee_email_consent (yes / no)
    referrer_email_confirmation (yes / no)
  → RESOLVED

---

════════════════════════════════════════════
ACCOUNT UPDATES — TYPES G1–G2
════════════════════════════════════════════

=== G1 — Bank Account Update ===
Triggers: User wants to change linked bank account for repayments

STEP 1 — stepTitle: "Step 1: Change Already Submitted"
  Ask: change_already_submitted (yes / no)
  → change_already_submitted = no → RESOLVED (guide user to submit via app)
  → change_already_submitted = yes → STEP 2

STEP 2 [only if change submitted] — stepTitle: "Step 2: Upcoming Repayment"
  Ask: upcoming_repayment (yes / no)
  → upcoming_repayment = no → RESOLVED (change will apply to future repayments)
  → upcoming_repayment = yes → STEP 3

STEP 3 [only if upcoming repayment exists] — stepTitle: "Step 3: Change Timing vs Record Date"
  Ask: change_before_or_after_record_date (before record date / after record date)
  → RESOLVED

---

=== G2 — Mobile Number or Email ID Update ===
Triggers: User wants to change registered mobile number or email ID

STEP 1 — stepTitle: "Step 1: Detail to Change"
  Ask: detail_to_change (mobile number / email ID / both)
  → RESOLVED

---

════════════════════════════════════════════
TDS / FORMS — TYPES H1–H2
════════════════════════════════════════════

=== H1 — Form 15G / 15H Submission ===
Triggers: User wants to submit Form 15G or 15H for TDS exemption

STEP 1 — stepTitle: "Step 1: Income Eligibility"
  Ask: income_below_taxable_limit (yes / no)
  → income_below_taxable_limit = no → RESOLVED (not eligible — 15G/H cannot be submitted)
  → income_below_taxable_limit = yes → STEP 2

STEP 2 [only if income eligible] — stepTitle: "Step 2: NBFC Support and Submission Timing"
  Ask:
    nbfc_on_22_list (yes / no)
    submitting_15_days_before_record_date (yes / no)
  → RESOLVED

---

=== H2 — TDS Deducted Despite 15G/H Submission ===
Triggers: User submitted Form 15G/H but TDS was still deducted

STEP 1 — stepTitle: "Step 1: Submission Timing"
  Ask: submitted_15_days_before_record_date (yes / no)
  → submitted_15_days_before_record_date = no → RESOLVED (deduction is valid — late submission)
  → submitted_15_days_before_record_date = yes → STEP 2

STEP 2 [only if submitted on time] — stepTitle: "Step 2: Processing Period Elapsed"
  Ask: fifteen_to_20_days_elapsed_since_submission (yes / no)
  → RESOLVED

---

════════════════════════════════════════════
ACCOUNT & DASHBOARD — TYPES I1, J1, K1
════════════════════════════════════════════

=== I1 — Account Deletion ===
Triggers: User wants to delete Wint account and/or demat account

STEP 1 — stepTitle: "Step 1: Active Holdings Check"
  Ask:
    active_bond_holdings (yes / no)
    active_fd_investments (yes / no)
  → active_bond_holdings = yes OR active_fd_investments = yes → STEP 2
  → active_bond_holdings = no AND active_fd_investments = no → STEP 3

STEP 2 [only if active bond holdings or FD investments exist] — stepTitle: "Step 2: Holdings Liquidated"
  Ask: holdings_liquidated_or_transferred (yes / no)
  → holdings_liquidated_or_transferred = no → RESOLVED (cannot delete until bonds are sold/transferred and FDs are closed/matured)
  → holdings_liquidated_or_transferred = yes → STEP 3

STEP 3 — stepTitle: "Step 3: Demat Closure Awareness"
  Ask: user_informed_about_demat_closure (confirmed / not yet informed)
  → RESOLVED

---

=== J1 — Dashboard / Portfolio Display Issues ===
Triggers: Bond not showing, value incorrect, gains dropped, past bonds query

STEP 1 — stepTitle: "Step 1: Type of Display Issue"
  Ask: display_issue_type (bond not showing in portfolio / gains reduced unexpectedly / current value dropped / past bonds not visible)
  → display_issue_type = bond not showing in portfolio → STEP 2a
  → display_issue_type = gains reduced unexpectedly → STEP 2b
  → display_issue_type = current value dropped → RESOLVED (mark-to-market pricing — explain)
  → display_issue_type = past bonds not visible → RESOLVED (guide to Past Investments section)

STEP 2a [only if bond not showing] — stepTitle: "Step 2: Settlement T+1 Elapsed"
  Ask: t1_elapsed_since_settlement (yes / no)
  → RESOLVED

STEP 2b [only if gains reduced] — stepTitle: "Step 2: Record Date Proximity"
  Ask: near_record_date (yes / no)
  → RESOLVED

---

=== K1 — Family Account ===
Triggers: Family account setup, viewing another member's portfolio, sharing member info

STEP 1 — stepTitle: "Step 1: Nature of Query"
  Ask: query_type (viewing a member portfolio / adding or removing a member)
  → query_type = adding or removing a member → RESOLVED (guide through app process)
  → query_type = viewing a member portfolio → STEP 2

STEP 2 [only if viewing portfolio] — stepTitle: "Step 2: Member Eligibility"
  Ask:
    member_in_family_account_on_finder (yes / no)
    member_has_completed_investment (yes / no)
  → RESOLVED

---

=== L1 — General Policy / Process Question ===
Triggers: Agent asking about a rule, process, or policy — no specific user case involved
→ No form needed. Return {"questions":[]} — answer directly from knowledge base.

---

Now apply the decision trees above:
- Identify the query type
- Read the tree for that type
- Check EXISTING CONFIRMED ANSWERS to find the current step
- Return ONLY the current unanswered step's questions
- If all steps answered → return {"questions":[]}`;

  try {
    let text = '{"questions":[]}';

    if (provider === 'claude') {
      const client = new Anthropic({ apiKey: config.anthropicApiKey });
      const response = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        messages: [{ role: 'user', content: analyzePrompt }],
      });
      text = response.content[0].type === 'text' ? response.content[0].text : text;
    } else {
      text = await geminiGenerate(
        geminiKeys,
        'gemini-2.5-flash',
        [{ role: 'user', parts: [{ text: analyzePrompt }] }]
      );
    }

    const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const parsed = JSON.parse(cleaned);
    return NextResponse.json(parsed);
  } catch (err) {
    console.error('[analyze] Error:', err);
    return NextResponse.json({ questions: [] });
  }
}
