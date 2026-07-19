import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import Anthropic from '@anthropic-ai/sdk';
import { readConfig } from '@/lib/config';
import { getOrderedGeminiKeys, geminiGenerate } from '@/lib/gemini';
import fs from 'fs';
import path from 'path';

interface AnalyzeRequest {
  messages: { role: string; content: string }[];
  allAnswers?: Record<string, string>;
  imageData?: { base64: string; mimeType: string };
}

// Monolithic schemas map for fallback and categories other than repayment
const CATEGORY_SCHEMAS: Record<string, string> = {
  repayment: `Step 1 — id: holding_on_record_date
  label: "Was the user holding this bond on the record date? (Check bond history in Finder)"
  type: select | options: ["Yes", "No"]
  → If No: STOP. Return {"questions":[]}. (Scenario: not entitled — not holding on record date)

Step 1.5 — id: repayment_issue_type
  label: "What is the repayment issue?"
  type: select | options: ["Repayment not received at all", "Received a repayment but the amount is wrong"]
  → If "Received a repayment but the amount is wrong": ask Step 1.6 next, skip Steps 2–4.

Step 1.6 — id: repayment_amount_direction (ONLY if repayment_issue_type = "Received a repayment but the amount is wrong")
  label: "Which direction is the amount wrong?"
  type: select | options: ["Received more than expected", "Received less than expected"]
  → STOP after answer. Scenario identified.

Step 2 — (ONLY if repayment_issue_type = "Repayment not received at all")
  id: contacted_on_repayment_date
  label: "Is the user contacting on the repayment date itself, or has the date already passed?"
  type: select | options: ["Today is the repayment date — user hasn't received it yet", "The repayment date has passed"]
  → If "Today is the repayment date": STOP. Return {"questions":[]}. (Scenario: still processing today — wait EOD)

Step 3 — id: recent_bank_change
  label: "Has the user's linked bank account in Finder been changed recently?"
  type: select | options: ["Yes", "No"]

Step 4a — ONLY if recent_bank_change=Yes:
  id: change_before_or_after_record_date
  label: "Was the bank account change made before or after the record date for this repayment?"
  type: select | options: ["Before the record date", "After the record date"]
  → STOP after answer. (Scenario 2 identified)

Step 4b — ONLY if recent_bank_change=No:
  id: bank_ifsc_check
  label: "Check the IFSC linked to the user's bank account in Finder. Does it match the IFSC the user says is correct for their bank?"
  type: select | options: ["Yes — IFSC in Finder matches what user expects", "No — IFSC in Finder does not match what user expects"]
  → STOP after answer. (Scenario 4a or 4b identified)`,

  kyc: `Step 1 — id: kyc_layer
  label: "Which stage is the KYC issue at?"
  type: select | options: [
    "A step is failing during KYC submission (e.g. penny test, OTP, selfie, proceed button)",
    "KYC was submitted and eSigned but account is still not active",
    "Nominee update or form signing issue"
  ]

LAYER 1 path (kyc_layer = step failing during submission):
Step 2a — id: kyc_failing_step
  label: "Which specific step in the KYC flow is failing?"
  type: select | options: [
    "Proceed button not responding",
    "Bank details already linked to another account",
    "Penny test failed",
    "Penny test refund not received",
    "Aadhaar OTP not received",
    "PAN or Aadhaar already linked to another Wint account",
    "PAN and Aadhaar are not linked on the IT portal",
    "Date of birth mismatch",
    "Selfie / liveliness check failing"
  ]
  → STOP after answer. Scenario identified.

LAYER 2 path (kyc_layer = submitted and esigned, account not active):
Step 2b — ask all four together (same Finder screen, independent of each other):
  id: kra_status | label: "KRA status in Finder" | type: select | options: ["Approved", "Issue / Pending / Rejected"]
  id: aml_status | label: "AML status in Finder" | type: select | options: ["Approved", "Issue / Pending"]
  id: insta_demat_status | label: "Insta Demat status in Finder" | type: select | options: ["Completed", "Issue / Pending"]
  id: ucc_status | label: "UCC status in Finder" | type: select | options: ["Active", "Blank / Pending"]

Step 3b — ONLY if kra_status=Issue / Pending / Rejected:
  id: which_kra
  label: "Which KRA is shown in Finder for this user?"
  type: select | options: ["CVL", "NDML", "Other / Unknown"]
  → STOP after answer. Scenario identified.

If ucc_status=Blank and kra/aml/insta all OK → STOP. (UCC scenario identified)
If any of kra/aml/insta has issue and which_kra is answered → STOP.

LAYER 3 path (kyc_layer = nominee or form signing):
Step 2c — id: nominee_or_signing_issue
  label: "What is the specific issue?"
  type: select | options: [
    "Nominee update — only 1 nominee",
    "Nominee update — multiple nominees",
    "Signing error on a form (DDPI, 15G/H, Nominee, Bank, or Closure form)"
  ]
  → STOP after answer. Scenario identified.`,

  payment: `Step 1 — id: payment_situation
  label: "What is the actual situation with the payment or order?"
  type: select | options: [
    "Payment went through but bond is not showing in portfolio",
    "Payment keeps failing or not completing",
    "Cannot buy more than a fixed number of units",
    "Refund expected but not received"
  ]

PATH A/B — payment went through, bond not showing:
Step 2a — id: first_investment
  label: "Is this the user's very first investment ever on Wint? (Check Finder)"
  type: select | options: ["Yes — first investment ever", "No — has invested before"]
  → If first_investment=Yes: STOP. Return {"questions":[]}. (Stage 2 handles the demat/KYC creation check)

Step 3b — ONLY if first_investment=No:
  id: payment_status_confirmed
  label: "Check Finder RFQ tab: what is the payment status for this order?"
  type: select | options: ["Success", "Failed", "Pending"]
  → STOP after answer. Scenario identified.

PATH C — payment failing:
Step 2c — id: payment_error_type
  label: "What type of failure is the user experiencing?"
  type: select | options: [
    "Amount was deducted from bank but no order was placed",
    "Payment page keeps failing or showing an error",
    "Bank website redirect failed",
    "UPI transaction declined"
  ]

Step 3c-i — ONLY if payment_error_type = amount deducted but no order:
  id: order_visible_on_finder
  label: "Check Finder RFQ tab: is the order visible there despite no confirmation?"
  type: select | options: ["Yes — order is visible in Finder", "No — no order in Finder at all"]
  → STOP after answer. Scenario identified.

Step 3c-ii — ONLY if payment_error_type = page failing or error shown:
  id: retried
  label: "Has the user already tried retrying or switching to a different payment method?"
  type: select | options: ["No — has not retried yet", "Yes — retried, still failing"]
  → STOP after answer. Scenario identified.

Step 3c-iii — ONLY if payment_error_type = bank redirect failed OR UPI declined:
  → STOP immediately. Return {"questions":[]}. Scenario identified.

PATH D — unit limit:
  → STOP immediately. Return {"questions":[]}. Scenario identified (purchase limit / seller assignment).

PATH E — refund not received:
Step 2e — id: refund_trigger
  label: "What triggered the expected refund?"
  type: select | options: [
    "Failed payment — investment didn't go through",
    "KYC was rejected after order was placed",
    "Order was cancelled"
  ]
  → STOP after answer. Scenario identified.`,

  sip: `Step 1 — id: sip_issue_type
  label: "What type of SIP issue is this?"
  type: select | options: [
    "Cannot set up SIP",
    "Want to change SIP date or amount",
    "Money deducted from bank but no bond appeared",
    "Cancel the SIP entirely",
    "Skip just this month's instalment"
  ]

PATH A — cannot set up SIP:
Step 2a — id: completed_one_investment
  label: "Has the user completed at least one prior investment on Wint? (Check Finder)"
  type: select | options: ["Yes — has invested before", "No — no prior investments"]
  → If No: STOP. (Scenario: not eligible — SIP requires prior investment)

Step 3a — ONLY if completed_one_investment=Yes:
  id: mandate_type
  label: "What payment method is the user trying to set up for the SIP?"
  type: select | options: ["UPI AutoPay", "eNACH / NACH"]
  → STOP after answer. Scenario identified.

PATH B — change SIP date or amount:
Step 2b — id: active_sip_on_finder
  label: "Check Finder: is there an active SIP showing for this user?"
  type: select | options: ["Yes — active SIP in Finder", "No — no active SIP"]

Step 3b — ONLY if active_sip_on_finder=Yes:
  id: mandate_type
  label: "What is the mandate type for this SIP? (Check Finder)"
  type: select | options: ["UPI AutoPay", "eNACH / NACH"]
  → STOP after answer. Scenario identified.

PATH C — money deducted, no bond:
Step 2c — id: active_sip_on_finder
  label: "Check Finder: is there an active SIP showing for this user? (A bank debit alone does not confirm this — check Finder directly)"
  type: select | options: ["Yes — active SIP shown in Finder", "No — no active SIP in Finder"]
  → STOP after answer. Scenario identified.

PATH D — cancel SIP:
Step 2d — id: active_sip_on_finder
  label: "Check Finder: is there an active SIP showing?"
  type: select | options: ["Yes", "No"]
  → If No: STOP. (No active SIP to cancel)

Step 3d — ONLY if active_sip_on_finder=Yes:
  id: upcoming_order_placed
  label: "Check Finder: is there an upcoming SIP order already placed for this cycle?"
  type: select | options: ["Yes — order already placed", "No — no upcoming order yet"]

Step 4d — ONLY if upcoming_order_placed=Yes:
  id: t_minus_1_check
  label: "Is the SIP deduction date tomorrow? (T-1 means autopay has already been raised to NPCI)"
  type: select | options: ["Yes — deduction is tomorrow (T-1)", "No — deduction is more than 1 day away"]
  → STOP after answer. Scenario identified.

PATH E — skip instalment:
Step 2e — id: t_minus_1_check
  label: "Is the SIP deduction date tomorrow? (If yes, autopay is already raised to NPCI and cannot be stopped)"
  type: select | options: ["Yes — deduction is tomorrow", "No — more than 1 day away"]
  → STOP after answer. Scenario identified.`,

  sell: `Step 1 — id: sell_situation
  label: "What is the actual sell or DDPI situation?"
  type: select | options: [
    "DDPI not set up or user wants to activate DDPI",
    "DDPI is active but sell button is greyed out or unavailable",
    "Sell order placed but proceeds not received",
    "User wants to deactivate DDPI",
    "User wants to cancel a sell order"
  ]

PATH: DDPI not set up / activation query:
Step 2a — id: ddpi_activation_status
  label: "Check Finder: what is the current DDPI status for this user?"
  type: select | options: ["Inactive — not signed yet", "Pending — signed but not yet active", "Active"]
  → STOP after answer. Scenario identified.

PATH: DDPI active but sell unavailable:
Step 2b — id: sell_blocked_reason
  label: "Check in Finder and context: what might be blocking the sell option?"
  type: select | options: [
    "Near or on the record date for this bond",
    "Bond has been flagged or negative news",
    "Flexi tenure bond — checking exit date constraints",
    "Other reason — not any of the above"
  ]
  → STOP after answer. Scenario identified.

PATH: Sell proceeds not received:
Step 2c — id: t1_elapsed_since_order
  label: "Has 1 full working day elapsed since the sell order was placed?"
  type: select | options: ["Yes — more than 1 working day has passed", "No — less than 1 working day"]
  → STOP after answer. Scenario identified.

PATH: Deactivation request OR sell order cancellation:
  → STOP immediately. Return {"questions":[]}. Scenario identified (offline process).`,

  referral: `Step 1 — id: referral_issue_type
  label: "What is the referral issue?"
  type: select | options: [
    "Referral reward not credited or not showing",
    "Referral was not mapped to the referrer",
    "Dispute about reward amount or calculation",
    "Want to remove or replace an existing referee"
  ]

PATH A — reward not credited:
Step 2a — ask the 3 prerequisites together (all from Finder, independent of each other):
  id: referee_kyc_complete | label: "Referee KYC status in Finder" | type: select | options: ["KYC complete", "KYC not complete"]
  id: referee_demat_created | label: "Referee demat account created in Finder?" | type: select | options: ["Yes", "No"]
  id: first_order_settled | label: "Has referee's first bond order settled in demat? (Check Finder)" | type: select | options: ["Yes", "No / Not yet"]

Step 3a — ONLY if all three are complete/yes:
  id: reward_status_on_finder
  label: "Check Finder: what is the referral reward status for this referrer?"
  type: select | options: ["Transferred", "Pending", "Not found / Not showing"]
  → STOP after answer. Scenario identified.

If any prerequisite is not met → STOP. Return {"questions":[]}. (Prerequisites not fulfilled scenario)

PATH B — referral not mapped:
Step 2b — id: signup_method
  label: "How did the referee sign up for Wint? (Check Mixpanel or ask the agent to clarify)"
  type: select | options: ["Via the referral link on the web", "Downloaded the app independently (no referral link)"]
  → STOP after answer. Scenario identified.

PATH C — calculation dispute:
  → STOP immediately. Return {"questions":[]}. Scenario identified (educational — explain calculation).

PATH D — remove or replace referee:
Step 2d — id: referee_has_investments
  label: "Check Finder: does the existing referee have any investments on Wint?"
  type: select | options: ["Yes — has investments", "No — no investments"]
  → STOP after answer. Scenario identified.`,

  taxation: `Step 1 — id: tax_issue_type
  label: "What is the taxation issue?"
  type: select | options: [
    "Question about TDS rate or how TDS is calculated",
    "How to submit Form 15G or 15H",
    "TDS was deducted even though 15G/15H was submitted",
    "Capital gains on bond sale (LTCG or STCG)",
    "TDS not appearing in Form 26AS"
  ]
  → Types 1, 2, 4: STOP immediately. Scenario is educational/direct.

PATH: TDS despite 15G/H:
Step 2 — id: submitted_15_days_before
  label: "Was Form 15G/H submitted at least 15 days before the record date?"
  type: select | options: ["Yes — submitted 15+ days before record date", "No — submitted less than 15 days before"]
  → STOP after answer. Scenario identified.

PATH: 26AS not updated:
Step 2 — id: quarterly_deadline_passed
  label: "Has the quarterly TDS filing deadline passed for the relevant quarter? (Q1: 15 Aug, Q2: 15 Nov, Q3: 15 Feb, Q4: 15 Jun)"
  type: select | options: ["Yes — deadline has passed", "No — deadline has not passed yet"]
  → STOP after answer. Scenario identified.`,

  dashboard: `Step 1 — id: profile_issue_type
  label: "What type of dashboard or profile issue is this?"
  type: select | options: [
    "Bond not showing in portfolio after payment",
    "Current value or gains dropped unexpectedly",
    "Past investments or old bonds not visible",
    "Bank account update",
    "Mobile number or email address update",
    "Family account issue",
    "Account deletion request"
  ]
  → Types: value dropped, past bonds not visible, mobile/email update → STOP. Educational/standard process.
  → Family account → STOP. Scenario identified (family account rules).

PATH: Bond not showing:
Step 2a — id: payment_status_confirmed
  label: "Check Finder RFQ tab: what is the payment status for this order?"
  type: select | options: ["Success", "Failed", "Pending"]
  → If Failed or Pending: STOP. (Payment issue, not portfolio issue — re-route to payment category)

Step 3a — ONLY if payment_status_confirmed=Success:
  id: t1_elapsed_since_payment
  label: "Has 1 full working day passed since the payment was made?"
  type: select | options: ["Yes — more than 1 working day", "No — less than 1 working day"]
  → STOP after answer. Scenario identified.

PATH: Bank account update:
Step 2b — id: bank_update_submitted
  label: "Has the user already submitted the bank account change request in the Wint app?"
  type: select | options: ["Yes — already submitted in app", "No — hasn't submitted yet"]
  → STOP after answer. Scenario identified.

PATH: Account deletion:
Step 2h — id: active_holdings_check
  label: "Check Finder: does the user have any active bond holdings or active FD investments?"
  type: select | options: ["Yes — has active holdings or FDs", "No — portfolio is empty"]
  → STOP after answer. Scenario identified.`,

  fd: `Premature withdrawal or visibility issue. No questions needed. All FD scenarios are directly mapped to static policies in Stage 2.`,
  
  huf: `Step 1 — id: huf_in_tracking_sheet
  label: "Check the HUF tracking sheet: is this user already in the sheet?"
  type: select | options: ["Yes — already in tracking sheet", "No — not in tracking sheet"]
  → STOP after answer. Scenario identified.`
};

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { messages, allAnswers, imageData }: AnalyzeRequest = await req.json();
  const latestUserMessage = [...messages].reverse().find((m: any) => m.role === 'user');
  const query = latestUserMessage?.content || '';

  const config = await readConfig();
  const provider = config.llmProvider || 'gemini';
  const geminiKeys = getOrderedGeminiKeys(config);

  const conversationHistory = messages
    .slice(0, -1)
    .filter((m: any) => !m.content?.startsWith('[Already confirmed'))
    .map((m: any) => `${m.role.toUpperCase()}: ${m.content}`)
    .join('\n');

  const existingAnswersJson = JSON.stringify(allAnswers || {}, null, 2);
  const answeredIds = Object.keys(allAnswers || {});

  try {
    // --- STAGE 0: ROUTING ---
    let routerPrompt = '';
    const routerPath = path.join(process.cwd(), 'PROMPT_router.txt');
    try {
      routerPrompt = fs.readFileSync(routerPath, 'utf-8');
    } catch (err) {
      console.warn('[analyze] Failed to read PROMPT_router.txt from disk, using fallback.');
      routerPrompt = `You are the intelligent router for the Wint Wealth CX support system.
Determine the correct product category. Do NOT answer the user.
RETURN FORMAT — return ONLY valid JSON:
{"category":"repayment"|"kyc"|"payment"|"sip"|"sell"|"referral"|"taxation"|"dashboard"|"fd"|"huf"|"out_of_domain","queryType":"direct"|"process"|"clarify","confidence":0.0 to 1.0}`;
    }

    const routerInput = `${routerPrompt}\n[LATEST USER MESSAGE]\nUser: ${query}`;
    const routerParts: any[] = [{ text: routerInput }];
    if (imageData) {
      routerParts.push({ inline_data: { mime_type: imageData.mimeType, data: imageData.base64 } });
    }

    let routerRaw = '';
    if (provider === 'claude') {
      const client = new Anthropic({ apiKey: config.anthropicApiKey });
      const claudeContent: Anthropic.MessageParam['content'] = imageData
        ? [
            { type: 'image', source: { type: 'base64', media_type: imageData.mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp', data: imageData.base64 } },
            { type: 'text', text: routerInput }
          ]
        : routerInput;
      const response = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 256,
        messages: [{ role: 'user', content: claudeContent }],
      });
      routerRaw = response.content[0].type === 'text' ? response.content[0].text : '';
    } else {
      routerRaw = await geminiGenerate(
        geminiKeys,
        'gemini-3.5-flash',
        [{ role: 'user', parts: routerParts }],
        { config: { responseMimeType: 'application/json' } },
        15000
      );
    }

    const cleanedRoute = routerRaw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const routeResult = JSON.parse(cleanedRoute);

    // If out of domain, stop and clarify
    if (routeResult.category === 'out_of_domain') {
      return NextResponse.json({
        queryType: 'clarify',
        category: null,
        questions: [],
        stepTitle: '',
        reasoning: 'Inquiry is outside Wint Wealth domain.',
        extractedFacts: {},
        clarificationMessage: 'I am here to help you with Wint Wealth inquiries. Please ask about your KYC, SIPs, repayments, or dashboard issues.'
      });
    }

    // Direct / Clarification responses
    if (routeResult.queryType === 'direct' || routeResult.queryType === 'clarify') {
      return NextResponse.json({
        queryType: routeResult.queryType,
        category: null,
        questions: [],
        stepTitle: '',
        reasoning: '',
        extractedFacts: {},
        clarificationMessage: routeResult.clarificationMessage || (routeResult.queryType === 'clarify' ? 'Could you provide more context about your issue?' : '')
      });
    }

    // --- STAGE 1: EXTRACTION ---
    const targetCategory = routeResult.category || 'repayment';
    let extractPrompt = '';

    if (targetCategory === 'repayment') {
      const repaymentPath = path.join(process.cwd(), 'PROMPT_extract_repayment.txt');
      try {
        extractPrompt = fs.readFileSync(repaymentPath, 'utf-8');
      } catch {
        extractPrompt = '';
      }
    }

    // Dynamic generation if file not found or for other categories
    if (!extractPrompt) {
      const schema = CATEGORY_SCHEMAS[targetCategory] || '';
      extractPrompt = `You are the triage layer of a Wint Wealth support system for the category: "${targetCategory}".
Determine what information the support agent still needs to look up in Finder, then ask for it one step at a time using the exact field schemas below.
The field IDs you generate MUST match the canonical IDs in the schemas below.

RETURN FORMAT — return ONLY valid JSON, no markdown, no explanation:

When asking a question (process, has questions):
{"queryType":"process","category":"${targetCategory}","questions":[{"id":"field_id","label":"Question label","options":["opt1","opt2"],"type":"select"|"text"}],"stepTitle":"Step N: Description","reasoning":"One sentence reasoning why we need this information","extractedFacts":{}}

When all facts are known and scenario is resolved (process, no questions):
{"queryType":"process","category":"${targetCategory}","questions":[],"stepTitle":"Resolution","reasoning":"","extractedFacts":{"<canonical_field_id>":"<value>"}}

EXISTING CONFIRMED ANSWERS (already collected — never re-ask):
${existingAnswersJson}
${answeredIds.length > 0 ? `\nALREADY ANSWERED IDs — do NOT generate any question with these IDs:\n${answeredIds.join(', ')}` : ''}

CONVERSATION HISTORY:
${conversationHistory || 'None'}

LATEST MESSAGE:
${query}

---
SCHEMA & LOGIC TREE (Walk top-to-bottom. Return only the FIRST unanswered step):

${schema}`;
    } else {
      // Repayment prompt structure from filesystem has its own placeholder format, inject data:
      extractPrompt = extractPrompt
        .replace('[EXISTING CONFIRMED ANSWERS]', `EXISTING CONFIRMED ANSWERS:\n${existingAnswersJson}`)
        .replace('[LATEST MESSAGE]', `LATEST MESSAGE:\nUser: ${query}`);
    }

    const extractParts: any[] = [{ text: extractPrompt }];
    if (imageData) {
      extractParts.push({ inline_data: { mime_type: imageData.mimeType, data: imageData.base64 } });
    }

    let extractRaw = '';
    if (provider === 'claude') {
      const client = new Anthropic({ apiKey: config.anthropicApiKey });
      const claudeContent: Anthropic.MessageParam['content'] = imageData
        ? [
            { type: 'image', source: { type: 'base64', media_type: imageData.mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp', data: imageData.base64 } },
            { type: 'text', text: extractPrompt }
          ]
        : extractPrompt;
      const response = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        messages: [{ role: 'user', content: claudeContent }],
      });
      extractRaw = response.content[0].type === 'text' ? response.content[0].text : '';
    } else {
      extractRaw = await geminiGenerate(
        geminiKeys,
        'gemini-3.5-flash',
        [{ role: 'user', parts: extractParts }],
        { config: { responseMimeType: 'application/json' } },
        40000
      );
    }

    const cleanedExtract = extractRaw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const parsed = JSON.parse(cleanedExtract);

    // Apply answered filter as fallback duplicate protection
    if (answeredIds.length && Array.isArray(parsed.questions)) {
      const before = parsed.questions.length;
      parsed.questions = parsed.questions.filter(
        (q: { id: string }) => !answeredIds.includes(q.id)
      );
      if (parsed.questions.length < before) {
        console.warn(`[analyze] Filtered ${before - parsed.questions.length} duplicate question(s)`);
      }
    }

    return NextResponse.json(parsed);

  } catch (err) {
    console.error('[analyze] Error:', err);
    return NextResponse.json({ questions: [], queryType: 'direct', fallback: true });
  }
}
