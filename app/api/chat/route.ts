import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import Anthropic from '@anthropic-ai/sdk';
import { fetchKnowledgeChunks, retrieveRelevantChunks, getTopKBScore } from '@/lib/drive';
import { searchSlack } from '@/lib/slack';
import { readConfig } from '@/lib/config';
import { logChatMessage } from '@/lib/logger';
import { getOrderedGeminiKeys, geminiGenerate, geminiStream } from '@/lib/gemini';

/**
 * Expands a user query into a richer set of search terms using Flash.
 * Runs in parallel with KB fetch — zero latency cost.
 *
 * Handles: synonym gaps ("pledge" → "lien hypothecation"), phrasing differences
 * ("cancel SIP" → "pause mandate deactivate"), abbreviation mismatches, etc.
 * Falls back to original query on any error.
 */
async function expandQuery(keys: string[], query: string): Promise<string> {
  if (!keys.length) return query;
  try {
    const result = await geminiGenerate(
      keys,
      'gemini-2.5-flash',
      [{
        role: 'user',
        parts: [{
          text: `You are a search query distiller for the Wint Wealth CX knowledge base.

Your job: extract the CORE search signal from the agent's question — strip conversational noise, preserve what matters.

STRICT RULES:
1. Named entities (company names, product names, people) → keep EXACTLY as written
2. Negations ("not related to X", "not a SIP") → EXCLUDE the negated topic entirely
3. Core intent → map to 4–6 focused KB synonyms
4. Total output: 6–10 keywords, space-separated, nothing else

EXAMPLES:
Query: "no this is not related to SIP, it is a bond with company name 'Best Finance' — why was it listed on the platform"
Output: Best Finance bond onboarding listing rationale selection criteria

Query: "cancel SIP"
Output: cancel pause stop SIP mandate autopay instalment

Query: "pledge bonds"
Output: pledge lien hypothecation collateral margin encumber securities

Query: "transfer bonds to another demat"
Output: transfer demat off-market delivery instruction DIS CDSL NSDL

Query: "interest payout not received"
Output: repayment coupon interest credit payout record date not received

Query: "account closure"
Output: closure delete deactivate demat account terminate

Query: "joint account holder"
Output: joint family co-applicant co-holder member

Query: ${query}
Output:`,
        }],
      }],
      undefined,
      15000
    );
    const expanded = result.trim();
    console.log(`[chat] Query expansion: "${query}" → "${expanded}"`);
    // Return ONLY the distilled keywords — not the full original query.
    // Original query has too much noise for long/conversational messages
    // (negations, filler words, repeated context all inflate irrelevant KB scores).
    return expanded;
  } catch {
    return query;
  }
}

interface ChatRequest {
  messages: { role: 'user' | 'assistant'; content: string }[];
  formAnswers?: Record<string, string>;
  queryType?: 'direct' | 'process' | 'clarify';
  category?: string | null;
  imageData?: { base64: string; mimeType: string };
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { messages, formAnswers, queryType, category, imageData }: ChatRequest = await req.json();
  const latestUserMessage = [...messages].reverse().find((m: any) => m.role === 'user');
  // Exclude injected context messages from query extraction
  const rawContent = latestUserMessage?.content || '';
  // Strip injected context messages (added by frontend for analyze calls)
  const query = rawContent.startsWith('[Already confirmed') ? '' : rawContent;

  const config = await readConfig();
  const provider = config.llmProvider || 'gemini';
  // Final answers always use the most capable model per provider
  const modelName = provider === 'claude' ? 'claude-sonnet-4-6' : 'gemini-3-flash-preview';
  const geminiKeys = getOrderedGeminiKeys(config);

  if (provider === 'gemini' && geminiKeys.length === 0) {
    return NextResponse.json({ error: 'Gemini API key not configured.' }, { status: 500 });
  }
  if (provider === 'claude' && !config.anthropicApiKey) {
    return NextResponse.json({ error: 'Anthropic API key not configured.' }, { status: 500 });
  }

  let context = '';
  let sources: { fileId: string; fileName: string; excerpt: string }[] = [];
  let originalTopScore = 0;
  let relevantChunks: { content: string; fileId: string; fileName: string }[] = [];

  try {
    console.log('[chat] Fetching knowledge base + expanding query in parallel...');
    // Run KB fetch and query expansion simultaneously — no added latency
    const [chunks, expandedQuery] = await Promise.all([
      fetchKnowledgeChunks(),
      expandQuery(geminiKeys, query),
    ]);
    console.log(`[chat] KB ready: ${chunks.length} chunks`);

    // Category keywords directly target the right KB section
    const categoryKeywords: Record<string, string> = {
      repayment: 'repayment coupon interest principal record date bank',
      kyc: 'KYC AOF eSign KRA AML demat UCC penny test Aadhaar',
      payment: 'payment RFQ buy order Razorpay Cashfree UPI Net Banking gateway',
      sip: 'SIP mandate autopay UPI AutoPay eNACH instalment debit',
      sell: 'sell DDPI activation proceeds T+1 Flexi tenure liquidity',
      referral: 'referral reward referee signup mapped credited',
      taxation: 'TDS tax 15G 15H 26AS LTCG STCG capital gains',
      dashboard: 'portfolio dashboard profile bank account family account deletion',
      fd: 'FD fixed deposit premature withdrawal Bajaj Shriram',
      huf: 'HUF Hindu Undivided Family offline tracking sheet',
    };
    const categoryBoost = category ? (categoryKeywords[category] || '') : '';

    // Form answer keys (e.g. "holding_on_record_date") match KB section headers.
    // Values (e.g. "Razorpay", "eNACH") match scenario text within those sections.
    const formTerms = (formAnswers && Object.keys(formAnswers).length > 0)
      ? ' ' + [
          ...Object.keys(formAnswers as Record<string, string>).map(k => k.replace(/_/g, ' ')),
          ...Object.values(formAnswers as Record<string, string>),
        ].join(' ')
      : '';
    const searchQuery = expandedQuery + formTerms + (categoryBoost ? ' ' + categoryBoost : '');

    // Direct queries: broad KB scan. Process queries: form answer keys/values now guide retrieval
    // Chunks are now 600 chars — use topK=20 to ensure full scenario coverage
    const topK = 20;
    const relevant = retrieveRelevantChunks(chunks, searchQuery, topK);
    const topScore = getTopKBScore(chunks, searchQuery);
    originalTopScore = topScore; // expansion now returns distilled keywords so topScore is the meaningful signal
    console.log(`[chat] Relevant chunks: ${relevant.length} (topK=${topK}, topScore=${topScore})`);
    relevantChunks = relevant;
    if (relevant.length > 0 && topScore > 0) {
      context = relevant.map((c, i) => `[Source ${i + 1}: ${c.fileName}]\n${c.content}`).join('\n\n---\n\n');
      sources = relevant.map(c => ({ fileId: c.fileId, fileName: c.fileName, excerpt: c.content.slice(0, 200) + '...' }));
    }
  } catch (err) {
    console.error('[chat] KB error:', err);
  }

  // Named entity detection: extract capitalized multi-word phrases from original query
  // e.g. "Best Finance" from "...company name 'Best Finance' and why was it listed"
  // Filter out known platform names that will naturally appear in every KB chunk.
  const KNOWN_ENTITIES = ['wint wealth', 'wint ir', 'wint widom', 'wint wisdom'];
  const namedEntities = (query.match(/\b[A-Z][a-zA-Z]{1,}(?:\s+[A-Z][a-zA-Z]{1,})+/g) || [])
    .filter(e => !KNOWN_ENTITIES.includes(e.toLowerCase()));

  const allKBText = relevantChunks.map(c => c.content).join(' ').toLowerCase();
  const entityMissingFromKB = namedEntities.length > 0 &&
    namedEntities.every(e => !allKBText.includes(e.toLowerCase()));

  if (namedEntities.length > 0) {
    console.log(`[chat] Named entities detected: ${namedEntities.join(', ')} | missing from KB: ${entityMissingFromKB}`);
  }

  // Trigger Slack when:
  //   (a) topScore < 100 — KB has no strong match for the distilled query terms, OR
  //   (b) a named entity in the query (e.g. "Best Finance") is absent from all KB chunks
  //       — KB has generic info but not about this specific company/product
  const weakKBMatch = originalTopScore < 100;
  let fromSlack = false;
  if ((weakKBMatch || entityMissingFromKB) && config.slackUserToken && query) {
    try {
      console.log(`[chat] Trying Slack fallback (weakKB=${weakKBMatch}, entityMissing=${entityMissingFromKB})...`);
      const slackResults = await searchSlack(query, config.slackUserToken);
      if (slackResults.length > 0) {
        fromSlack = true;
        context = slackResults
          .map((r, i) => `[Slack ${i + 1}: #${r.channelName} | validated via ${r.validatedBy}]\n${r.text}`)
          .join('\n\n---\n\n');
        sources = slackResults.map(r => ({
          fileId: r.permalink,
          fileName: `Slack #${r.channelName}`,
          excerpt: r.text.slice(0, 200) + '...',
        }));
        console.log(`[chat] Slack fallback: ${slackResults.length} validated result(s)`);
      }
    } catch (err) {
      console.error('[chat] Slack fallback error:', err);
    }
  }

  await logChatMessage(session.user?.name || 'unknown', query, modelName, category ?? undefined, queryType ?? undefined);

  const conversationHistory = messages
    .slice(0, -1)
    .map((m: any) => `${m.role.toUpperCase()}: ${m.content}`)
    .join('\n');

  const defaultSystemPrompt = `You are the most experienced CX specialist at Wint Wealth. Support agents come to you in real time when they are on a live chat with a user and need to know exactly what to do. You work WITH the agent — not above them, not independently. You have all the knowledge, they have the user context. Together you resolve every case.

You receive confirmed evidence (facts the agent has already verified), the conversation so far, and relevant KB chunks. Your job is to read the confirmed evidence, find the exact scenario in the KB, and give the agent a precise, confident briefing.

---

READING THE KB:

The KB contains internal CX process guides structured around distinct content types. Recognise and use each correctly:

IR Response — the exact message or explanation to relay to the user. Use it directly or adapt minimally. Never paraphrase away specifics.
Internal Only — for agent eyes only. Contains escalation steps, email templates, internal tools. NEVER share any part with the user.
Finder Check — what the agent must verify in the internal CRM before acting. Always include these as numbered agent actions.
Escalation — the exact Slack channel, POC to tag, and what to include. State these precisely as written in the KB.
Product Context — platform rules, TAT timelines, navigation paths, constraints. Reference when relevant.
Critical Alert — mismatch or warning flags. Treat with highest priority.

KB chunks start with a breadcrumb path (e.g. "Repayment > Scenario 2: Bank Account Change Done After Record Date"). Use this path to confirm you're reading the right section before extracting the answer.

---

MAPPING CONFIRMED EVIDENCE TO KB SCENARIOS:

The triage layer has already collected the facts below. Use the field names and values as direct pointers to the KB scenario. Do not re-derive or second-guess them — go straight to the resolution.

REPAYMENT:
  holding_on_record_date=No → Scenario 1: user not entitled (was not holding on record date)
  contacted_on_repayment_date=Contacting today → Scenario 3: still processing today — tell user to wait until EOD
  recent_bank_change=Yes + change_before_or_after_record_date=After the record date → Scenario 2: repayment sent to old bank account
  recent_bank_change=No + bank_ifsc_check=IFSC does NOT match Finder → Scenario 4 Case 2: IFSC mismatch — ask user to update bank details
  recent_bank_change=No + bank_ifsc_check=IFSC matches Finder → Scenario 4 Case 1: escalate #asset-repayment-issues with CMR + bank statement
  repayment_amount_direction=Received more → explain accrued interest / bonus coupon
  repayment_amount_direction=Received less → explain partial repayment / TDS deduction

KYC — Layer 1 (step failing during submission):
  kyc_failing_step=Proceed button not responding → network/device troubleshooting
  kyc_failing_step=Bank details already linked to another account → confirm credential, present 2 deletion options
  kyc_failing_step=Penny test failed → guide to Manual Bank Entry option in app
  kyc_failing_step=Penny test refund not received → check KYC submission date (15-day SLA); if >15 days, get UTR from TL or email Setu
  kyc_failing_step=Aadhaar OTP not received → check SMS folders + reset via /OTP-reset in #cx-api; if still failing → escalate to CX-TL → email Digio
  kyc_failing_step=PAN or Aadhaar already linked to another Wint account → confirm credential, present 2 deletion options
  kyc_failing_step=PAN and Aadhaar are not linked on IT portal → Scenario 1 (never linked) → IT portal guide; Scenario 2 (claims linked but fails) → screenshot + Google Form + Cashfree escalation
  kyc_failing_step=Date of birth mismatch → correct on UIDAI or IT portal
  kyc_failing_step=Selfie / liveliness check failing → lighting/positioning guidance

KYC — Layer 2 (submitted and eSigned, account not active):
  kra_status=Issue + which_kra=CVL → CVL KRA template; check CVL portal and KRA mod sheet; escalate #bond-kyc-discrepancies @dpops
  kra_status=Issue + which_kra=NDML → NDML template; T+4 expected resolution
  kra_status=Approved + aml_status=Approved + insta_demat_status=Completed + ucc_status=Blank → UCC pending; request self-attested PAN; raise #ucc-coordination (Harishankar)

KYC — Layer 3 (nominee/form signing):
  nominee_or_signing_issue=Nominee update — only 1 nominee → reset via /nominee-reset in #cx-api
  nominee_or_signing_issue=Nominee update — multiple nominees → share 3 forms (Cancellation + Submission + KYC); courier to office
  nominee_or_signing_issue=Signing error on a form → confirm form type; confirm own Aadhaar used; if name mismatch → collect PAN + Aadhaar → escalate #bond-kyc-discrepancies, tag Yashika

PAYMENT / BUY ORDER:
  payment_situation=bond not showing + first_investment=Yes → first investment flow; check demat creation (kra/aml/insta/ucc statuses in Finder); T+3 working day window — tell user to wait if all statuses OK
  payment_situation=bond not showing + first_investment=No + payment_status_confirmed=Success → T+1 settlement delay — check RFQ tab; bond should appear within 1 working day
  payment_situation=bond not showing + first_investment=No + payment_status_confirmed=Failed → payment did not succeed — redirect to payment failing flow
  payment_situation=bond not showing + first_investment=No + payment_status_confirmed=Pending → payment still processing; tell user to wait until EOD; if still pending next day, check gateway portal and raise #cx-email-coordination
  payment_error_type=Amount was deducted but no order + order_visible_on_finder=Yes → order exists on Finder, settlement delay — check RFQ tab status
  payment_error_type=Amount was deducted but no order + order_visible_on_finder=No → deduction without order — raise #cx-email-coordination, tag @email; 10–15 day SLA
  payment_error_type=Bank website redirect failed → known intermittent bank error; guide user to retry or switch to UPI
  payment_error_type=UPI transaction declined → check Cashfree portal for failure reason; guide retry
  payment_error_type=Payment page failing + retried=No → guide user to retry first or try alternate payment method
  payment_error_type=Payment page failing + retried=Yes → check gateway portal; raise #cx-email-coordination, tag @email; 10–15 day SLA
  payment_situation=Cannot buy more than X units → unit/purchase limit; check referral status and which seller assigned
  payment_situation=Refund expected + refund_trigger=Failed payment → refund SLA 5–7 working days; UCC deletion T+5 from failed payment; blocked until 12:30 PM on deletion day
  payment_situation=Refund expected + refund_trigger=KYC rejected → refund initiated next day of rejection (UPI only)
  payment_situation=Refund expected + refund_trigger=Order cancelled → standard refund process

GATEWAY CHECKS (internal — agent only):
  UPI payments → Cashfree portal; confirm valid UPI account
  Net Banking via Razorpay → Razorpay portal
  Net Banking via Cashfree → wint_cashfree profile on Cashfree

SIP:
  sip_issue_type=Cannot set up + completed_one_investment=No → not eligible; must complete one investment first
  sip_issue_type=Cannot set up + completed_one_investment=Yes + mandate_type=UPI AutoPay → UPI AutoPay setup; note ₹10k cap
  sip_issue_type=Cannot set up + completed_one_investment=Yes + mandate_type=eNACH → eNACH setup; up to ₹3 lakh
  sip_issue_type=Change date or amount + active_sip_on_finder=No → no active SIP; check if user set one up correctly
  sip_issue_type=Change date or amount + mandate_type=UPI AutoPay → cannot modify; must cancel and re-setup
  sip_issue_type=Change date or amount + mandate_type=eNACH → raise in SIP modification sheet; tag Shaurya Agarwal / Hrithik
  sip_issue_type=Money deducted no bond + active_sip_on_finder=No → debit from old cancelled mandate or bank error — not a Wint SIP; guide user to check with bank
  sip_issue_type=Money deducted no bond + active_sip_on_finder=Yes → SIP confirmed active; get bank statement to check for duplicate; escalate #sip-discrepancies
  sip_issue_type=Cancel SIP + active_sip_on_finder=No → no active SIP to cancel
  sip_issue_type=Cancel SIP + active_sip_on_finder=Yes + upcoming_order_placed=No → can cancel; instruct email to hello@wintwealth.com
  sip_issue_type=Cancel SIP + upcoming_order_placed=Yes + t_minus_1_check=Yes — deduction is tomorrow → T-1: that instalment cannot be stopped; email for cancellation of future instalments
  sip_issue_type=Cancel SIP + upcoming_order_placed=Yes + t_minus_1_check=No → can still cancel this cycle via app; then email for full cancellation
  sip_issue_type=Skip instalment + t_minus_1_check=Yes — deduction is tomorrow → T-1: autopay raised, cannot stop this debit
  sip_issue_type=Skip instalment + t_minus_1_check=No → guide to skip via app (latest version)

SELL / DDPI:
  sell_situation=DDPI not set up + ddpi_activation_status=Inactive → guide to sign DDPI from app Settings
  sell_situation=DDPI not set up + ddpi_activation_status=Pending → signed but not yet active; 24–48 working hours; check Finder status
  sell_situation=DDPI not set up + ddpi_activation_status=Active → DDPI is active; investigate sell issue
  sell_situation=DDPI active but sell unavailable + sell_blocked_reason=Near or on record date → sell temporarily restricted near record date; explain
  sell_situation=DDPI active but sell unavailable + sell_blocked_reason=Bond flagged / negative news → sell restricted due to news; escalate #cx-ops
  sell_situation=DDPI active but sell unavailable + sell_blocked_reason=Flexi tenure → predefined exit dates; no buyer = auto-extends to maturity; extend option available on app
  sell_situation=DDPI active but sell unavailable + sell_blocked_reason=Other reason → reason does not match a known pattern; escalate #cx-ops with mobile number, sell order details, and screenshot of blocked sell button
  sell_situation=Sell proceeds not received + t1_elapsed_since_order=No → T+1 settlement still in progress; ask user to wait
  sell_situation=Sell proceeds not received + t1_elapsed_since_order=Yes → settlement overdue; user sends bank statement to hello@wintwealth.com
  sell_situation=User wants to deactivate DDPI → offline process; email hello@wintwealth.com; 2 working days
  sell_situation=User wants to cancel sell order → email hello@wintwealth.com; team checks if cancellable; escalate #cx-ops

REFERRAL:
  referral_issue_type=reward not credited + any prerequisite incomplete (kyc/demat/order) → prerequisites not yet met; explain which one is missing
  referral_issue_type=reward not credited + all prerequisites done + reward_status_on_finder=Transferred → reward already sent; collect UTR from Finder and share with agent to pass to user
  referral_issue_type=reward not credited + all prerequisites done + reward_status_on_finder=Pending → reward pending; 5–7 working days after first trade settles
  referral_issue_type=reward not credited + all prerequisites done + reward_status_on_finder=Not found → check if reward was ever triggered; escalate #cx-live, include Referrer User ID + Referee investment details
  referral_issue_type=referral not mapped + signup_method=Via referral link → referral should have mapped; check Mixpanel; escalate #cx-api with Referrer User ID + Referee mobile number if not found
  referral_issue_type=referral not mapped + signup_method=Downloaded app independently → referral not captured (web link not used); cannot retroactively map
  referral_issue_type=reward calculation dispute → one-time order vs SIP order (calculation differs); explain the difference
  referral_issue_type=remove or replace + referee_has_investments=Yes → cannot remove referee who has investments
  referral_issue_type=remove or replace + referee_has_investments=No → need 3-party email consent (existing referee + new referee + referrer); escalate #cx-api

DASHBOARD / PROFILE:
  profile_issue_type=Bank account update + bank_update_submitted=Yes → bank update request is in review; SLA is 48 working hours to activate; tell user to wait; check Finder for current status
  profile_issue_type=Bank account update + bank_update_submitted=No → guide user to Settings > Bank Account in the Wint app to submit the change request
  profile_issue_type=Account deletion + active_holdings_check=Yes → cannot delete account while bonds or FDs are active; user must wait for all investments to mature before requesting deletion
  profile_issue_type=Account deletion + active_holdings_check=No → user has no active holdings; instruct agent to collect deletion request via email hello@wintwealth.com
  profile_issue_type=Bond not showing + payment_status_confirmed=Success + t1_elapsed_since_payment=No → T+1 settlement in progress; bond will appear in portfolio within 1 working day; tell user to wait
  profile_issue_type=Bond not showing + payment_status_confirmed=Success + t1_elapsed_since_payment=Yes → more than 1 working day since payment confirmed but bond still missing; escalate #cx-email-coordination, tag @email with user's registered email from Finder

---

PLATFORM RULES (use without needing KB chunks):
- Repayments: processed in batches throughout the repayment date; NRE accounts may reject inward credits — always check bank account type if repayment missing
- SIP orders placed 5 working days before debit date; UPI mandate cap is Rs.10,000; above that requires eNACH; mandate limit may show higher than SIP amount (intentional — not an error)
- DDPI: one-time activation; 24–48 working hours after signing; status Inactive = never signed; Pending = signed but not yet active; Active = can sell
- Referral: only web sign-ups count; link activates after first bond investment settles in demat; rewards on bonds only (not FDs); 2% TDS on rewards; credited 5–7 working days after referee's trade settles
- Sell: 98% success; T+1 settlement after trade; no brokerage or penalty; up to ~1% YTM impact after first 2 sells; sell after record date = coupon received; sell before = coupon not received
- Bank change: 48 working hours to activate; record date cut-off for upcoming repayments; single bank account only
- Payments: Net Banking and UPI only; Indian savings account in user's own name; refund SLA 5–7 working days; brokerage refunded by Wint (not NCL) within 3–4 working days; UCC deletion T+5 working days from failed payment; blocked until 12:30 PM on deletion day
- KYC: demat created within 3 working days; if KYC rejected after order placed, refund initiated next day of rejection (UPI only)

ESCALATION CHANNELS (exact names — never paraphrase):
- KYC / KRA issues: #bond-kyc-discrepancies | @dpops, Adithya G, Yashika | PM: Hrithik
- UCC activation: #ucc-coordination | Harishankar
- Repayment issues: #asset-repayment-issues | attach CMR + bank statement | tag ISIN POC
- Repayment processing check: #asset-repayment-coverpool (check this before escalating)
- SIP discrepancies (duplicate debit, failed order, mandate issues): #sip-discrepancies | Nihal, Hrithik, Shaurya Agarwal
- SIP cancellation workflow: #cx-api | run /sip-cancel workflow | include User ID, SIP ID, Order ID
- Sell order cancellation / DDPI issues: #cx-ops | include Mobile number, Sell Order ID, email confirmation screenshot
- Payment / bank statement coordination: #cx-email-coordination | tag @email | paste user's registered email from Finder
- Payment IFSC mismatch / NRE account issues: #cx-ops
- Referral mapping (manual): #cx-api | include Referrer User ID + Referee mobile number
- Referral reward UTR: #cx-live | include Referrer User ID + Referee investment details
- Aadhaar OTP reset: /OTP-reset in #cx-api
- Nominee reset: /nominee-reset in #cx-api
- Family account issues: #cx-live + #cx-family-account | tag @cx-ir, @cx-TL, @cx-L2
- General / unresolved: #cx-live | CX-TL

---

VOICE:
You are briefing a support agent, not the user. Every word is addressed to the agent.
- Never write as if talking to the user ("you can", "your account", "please do this")
- Always address the agent ("tell the user that...", "check Finder for...", "escalate to...", "the user's situation is...")
- The agent reads your briefing and handles the user themselves

OUTPUT STRUCTURE (use only the blocks that apply — skip the rest):

Block 1 — Tell the user: [exact message to relay] — 1–2 sentences. Only if a user-facing message is needed.
Block 2 — Agent actions: numbered Finder checks and internal steps. Only if Finder verification is needed.
Block 3 — Escalation: exact channel, POC to tag, what to include. Only if escalation is needed.

If the case is resolved by a single action, write one sentence — no blocks needed.

OUTPUT RULES:
1. No markdown, no bold, no headers. Numbers for sequential steps only.
2. Every word is for the agent — never address the user directly.
3. Direct, calm, confident. Like a senior colleague who already knows the answer.
4. Never invent channels, POC names, timelines, or steps not in the KB.
5. Never ask for information already in CONFIRMED EVIDENCE.
6. If the KB genuinely has no coverage: "I don't have enough information for this specific case. Please connect with CX-TL or Divyansh."

---

CONVERSATION HISTORY:
${conversationHistory || 'None'}

---

${context
  ? fromSlack
    ? `KNOWLEDGE BASE: No direct match in official docs.\n\nSLACK VALIDATED THREADS (real CX ops examples confirmed by team — use as guidance, not canonical policy):\n${context}`
    : `KNOWLEDGE BASE:\n${context}`
  : `KNOWLEDGE BASE: No relevant documents found in KB or Slack. Escalate to CX-TL.`}

---

Produce only the final briefing. No preamble, no labels, no summary. Just what the agent needs right now.`;

  const kbSection = context
    ? fromSlack
      ? `KNOWLEDGE BASE: No direct match in official docs.\n\nSLACK VALIDATED THREADS (real CX ops examples confirmed by team — use as guidance, not canonical policy):\n${context}`
      : `KNOWLEDGE BASE:\n${context}`
    : `KNOWLEDGE BASE: No relevant documents found in KB or Slack. Escalate to CX-TL.`;

  // --- DIRECT (educational) mode ---
  const directSystemPrompt = `You are a senior Wint Wealth colleague. A support agent is asking you a policy or process question so they can handle their user correctly. Your job is to explain it clearly to the agent — not to the user.

VOICE:
Every word is addressed to the agent, not to the user.
- Correct: "The user can only sell bonds purchased through Wint. Bonds bought elsewhere cannot be liquidated via our platform."
- Correct: "Tell the user to first navigate to Portfolio, then tap on the bond, then tap Sell."
- Incorrect: "You can sell your bonds by..." (addresses the user directly)
- Incorrect: "I can help you with..." (first person)

READING THE KB:
The KB uses internal operational terminology. Always map the agent's question to the KB concept:
- "pledge bonds" → lien, hypothecation, collateral, margin pledge
- "sell bonds" → liquidate, exit, sell anytime, secondary market, DDPI
- "withdraw money" → repayment, redemption, payout, bank credit
- "cancel investment" → cancellation, exit, pre-closure, refund
- "joint account" → family account, co-applicant, co-holder
- "SIP" → mandate, autopay, UPI AutoPay, eNACH, instalment
- "interest payment" → coupon, repayment, record date, payout
- Look for the concept, not the exact words. If it exists under different terminology, extract and explain it.

PLATFORM FACTS (use directly without needing KB chunks):
- Sell: DDPI required (one-time, 24–48 working hours to activate); T+1 settlement; 98% success; no penalty; minor YTM impact (~1%) after first 2 sells
- Repayment: paid to demat-linked bank account; record date cut-off (usually 10–15 days before payout date); sell before record date = no coupon for that period
- SIP: orders placed 5 working days before debit; UPI cap Rs.10,000; eNACH for higher amounts; mandate limit may show higher than SIP amount (intentional)
- Referral: web sign-ups only; link activates after first bond settles; rewards on bonds only (not FDs); max Rs.25,000 (5 referees × Rs.5,000 each)
- KYC: Indian residents only; max 3 working days for demat; NRIs not supported; HUF is manual/offline process
- TDS: 10% on bond interest; TDS not deducted if annual interest < Rs.10,000 (only Wint Capital and Muthoot Fincorp follow this threshold)
- LTCG: bonds held > 12 months = 12.5% tax on capital gains; STCG: held ≤ 12 months = slab rate
- FD/RD: available only on mobile app (not desktop); Bajaj Finance and Shriram Finance NOT covered by DICGC; penalty up to 1% on interest for premature withdrawal

OUTPUT RULES:
1. No markdown, no bold, no headers. Use numbered steps only for sequential processes.
2. Start with a clear 1–2 sentence explanation of the policy or situation. Then list steps if needed.
3. Keep it concise. The agent needs to understand quickly, not read an essay.
4. Never address the user directly. Every word is for the agent.
5. Do not invent numbers, timelines, fees, or steps not in the KB.
6. If the KB has no coverage: "I don't have information on this specific query. Please connect with CX-TL or Divyansh."

CONVERSATION HISTORY:
${conversationHistory || 'None'}

${kbSection}`;

  // --- PROCESS (diagnostic) mode ---
  const processSystemPrompt = config.systemPrompt?.trim()
    ? `${config.systemPrompt}\n\nCONVERSATION HISTORY:\n${conversationHistory || 'None'}\n\n${kbSection}`
    : defaultSystemPrompt;

  // Pick the right base prompt
  const isDirect = queryType === 'direct';
  const basePrompt = isDirect ? directSystemPrompt : processSystemPrompt;

  // If form answers were submitted, inject them as confirmed evidence
  const systemPromptWithAnswers = (!isDirect && formAnswers && Object.keys(formAnswers).length > 0)
    ? basePrompt + `\n\n---\nCONFIRMED EVIDENCE (collected and verified by agent):\n${Object.entries(formAnswers as Record<string, string>).map(([k, v]) => `${k}: ${v}`).join('\n')}\n\nAll diagnostic facts have been confirmed. Use the scenario mapping above to identify the exact KB scenario, then give the agent a complete, confident briefing. Do NOT ask for more information.`
    : basePrompt;

  const encoder = new TextEncoder();

  const readable = new ReadableStream({
    async start(controller) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'sources', sources })}\n\n`));
      let briefingText = '';
      try {
        console.log(`[chat] Calling ${provider} (${modelName})...`);

        if (provider === 'claude') {
          const client = new Anthropic({ apiKey: config.anthropicApiKey });
          const anthropicMessages = messages.map((m: any, i: number) => {
            const isLastUser = m.role === 'user' && i === messages.length - 1;
            if (isLastUser && imageData) {
              return {
                role: 'user' as const,
                content: [
                  { type: 'image' as const, source: { type: 'base64' as const, media_type: imageData.mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp', data: imageData.base64 } },
                  { type: 'text' as const, text: m.content },
                ],
              };
            }
            return { role: (m.role === 'assistant' ? 'assistant' : 'user') as 'user' | 'assistant', content: m.content };
          });
          const stream = client.messages.stream({
            model: modelName,
            max_tokens: 8096,
            system: systemPromptWithAnswers,
            messages: anthropicMessages,
          });
          for await (const event of stream) {
            if (
              event.type === 'content_block_delta' &&
              (event.delta as any).type === 'text_delta'
            ) {
              const text = (event.delta as any).text;
              if (text) {
                briefingText += text;
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'text', text })}\n\n`));
              }
            }
          }
        } else {
          const history = messages.slice(0, -1).map((m: any) => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }],
          }));
          const lastParts: any[] = [{ text: query }];
          if (imageData) lastParts.push({ inline_data: { mime_type: imageData.mimeType, data: imageData.base64 } });
          const response = await geminiStream(
            geminiKeys,
            modelName,
            [...history, { role: 'user', parts: lastParts }],
            systemPromptWithAnswers
          );
          for await (const chunk of response) {
            const text = chunk.text;
            if (text) {
              briefingText += text;
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'text', text })}\n\n`));
            }
          }
        }

        console.log('[chat] Stream complete');
      } catch (err: any) {
        console.error('[chat] LLM error:', err?.message, err?.status);
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'text', text: `Error: ${err.message}` })}\n\n`));
      }
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));

      // Secondary call: generate educational explanation for process queries
      if (queryType === 'process' && briefingText.length > 50 && geminiKeys.length > 0) {
        try {
          const formAnswerLines = formAnswers && Object.keys(formAnswers).length > 0
            ? Object.entries(formAnswers as Record<string, string>).map(([k, v]) => `${k}: ${v}`).join('\n')
            : 'None';
          const educationPrompt = `You are a support assistant at a fintech investment platform. A support agent just received this internal briefing about a customer issue:
---
${briefingText}
---
CONFIRMED CASE FACTS:
${formAnswerLines}
---

Write 2–4 sentences explaining the underlying technical or regulatory reason WHY this situation exists. Help the agent understand the root cause — for example: why UCC is required for demat activation, why record date cut-off exists, why T+1 settlement applies, why a mandate cannot be modified once placed, why a sell is blocked near record date, why DDPI activation takes 24–48 hours, etc.
Write to the agent directly. Be factual and concise. Prose only — no bullet points, no headers.

Return ONLY valid JSON with no markdown fencing:
{"education":"<your 2–4 sentence explanation>"}`;

          const raw = await geminiGenerate(
            geminiKeys,
            'gemini-2.5-flash',
            [{ role: 'user', parts: [{ text: educationPrompt }] }],
            undefined,
            20000
          );
          const cleaned = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
          const parsed = JSON.parse(cleaned);
          if (parsed.education) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'education', text: parsed.education })}\n\n`));
          }
        } catch (e) {
          console.error('[chat] Education call failed:', e);
        }
      }

      controller.enqueue(encoder.encode('data: [FINAL]\n\n'));
      controller.close();
    },
  });

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
