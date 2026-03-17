import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import Anthropic from '@anthropic-ai/sdk';
import { fetchKnowledgeChunks, retrieveRelevantChunks } from '@/lib/drive';
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
      'gemini-2.5-pro',
      [{
        role: 'user',
        parts: [{
          text: `You are a search query expander for an internal Wint Wealth CX knowledge base.
The KB uses operational/fintech terminology that may differ from how agents phrase questions.

Given this query, return 8–12 space-separated search keywords that would match the relevant KB sections.
Include: synonyms, related internal terms, fintech jargon, and alternative phrasings.

Examples of the kind of mapping needed:
- "pledge bonds" → pledge lien hypothecation collateral margin encumber securities
- "cancel SIP" → cancel pause stop deactivate SIP mandate autopay instalment
- "joint account" → joint family co-applicant co-holder member
- "transfer bonds" → transfer demat off-market delivery instruction DIS CDSL NSDL
- "interest payout" → repayment coupon interest credit payout record date
- "account closure" → closure delete deactivate demat account terminate

Query: ${query}

Return ONLY the keywords, space-separated, nothing else.`,
        }],
      }]
    );
    const expanded = result.trim();
    console.log(`[chat] Query expansion: "${query}" → "${expanded}"`);
    return `${query} ${expanded}`;
  } catch {
    return query;
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { messages, formAnswers, queryType } = await req.json();
  const latestUserMessage = [...messages].reverse().find((m: any) => m.role === 'user');
  const query = latestUserMessage?.content || '';

  const config = await readConfig();
  const provider = config.llmProvider || 'gemini';
  // Final answers always use the most capable model per provider
  const modelName = provider === 'claude' ? 'claude-sonnet-4-6' : 'gemini-2.5-pro';
  const geminiKeys = getOrderedGeminiKeys(config);

  if (provider === 'gemini' && geminiKeys.length === 0) {
    return NextResponse.json({ error: 'Gemini API key not configured.' }, { status: 500 });
  }
  if (provider === 'claude' && !config.anthropicApiKey) {
    return NextResponse.json({ error: 'Anthropic API key not configured.' }, { status: 500 });
  }

  let context = '';
  let sources: { fileId: string; fileName: string; excerpt: string }[] = [];

  try {
    console.log('[chat] Fetching knowledge base + expanding query in parallel...');
    // Run KB fetch and query expansion simultaneously — no added latency
    const [chunks, expandedQuery] = await Promise.all([
      fetchKnowledgeChunks(),
      expandQuery(geminiKeys, query),
    ]);
    console.log(`[chat] KB ready: ${chunks.length} chunks`);

    // For process queries: also append form answer values as search terms
    // (e.g. "after 9pm no holiday" pulls repayment section; "failed razorpay" pulls payment section)
    const formTerms = (formAnswers && Object.keys(formAnswers).length > 0)
      ? ' ' + Object.values(formAnswers as Record<string, string>).join(' ')
      : '';
    const searchQuery = expandedQuery + formTerms;

    // Direct queries get more chunks — broader context needed for educational answers
    // Process queries stay tighter — form answers already narrow the scenario
    const topK = queryType === 'direct' ? 15 : 10;
    const relevant = retrieveRelevantChunks(chunks, searchQuery, topK);
    console.log(`[chat] Relevant chunks: ${relevant.length} (topK=${topK})`);
    if (relevant.length > 0) {
      context = relevant.map((c, i) => `[Source ${i + 1}: ${c.fileName}]\n${c.content}`).join('\n\n---\n\n');
      sources = relevant.map(c => ({ fileId: c.fileId, fileName: c.fileName, excerpt: c.content.slice(0, 200) + '...' }));
    }
  } catch (err) {
    console.error('[chat] KB error:', err);
  }

  await logChatMessage(session.user?.name || 'unknown', query, modelName);

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

The confirmed field names and values are navigation keys. Use them like this:

Field NAMES tell you the KB section:
  aof_status / sebi_kyc_status / kra_status / which_kra → KYC Process Guide
  holding_on_record_date / contacted_on_repayment_date / recent_bank_change / change_before_or_after_record_date / bank_statement_check → Repayment Process Guide
  mandate_status / payment_method / mandate_type / sip_amount_over_10k / active_sip_on_finder → SIP Process Guide
  ddpi_signed / ddpi_activation_status / sell_order_placed / t1_elapsed_since_order → Sell / DDPI Process Guide
  payment_mode / gateway / payment_status / first_investment / before_or_after_t3_working_days → Payment & Buy Order Process Guide
  referee_kyc_complete / reward_status_on_finder / signup_method → Referral Process Guide

Field VALUES tell you the exact scenario:

REPAYMENT:
  holding_on_record_date=no → Scenario 1: not entitled — not holding on record date
  contacted_on_repayment_date=yes → Scenario 3: still processing — wait until EOD
  recent_bank_change=yes + change_before_or_after_record_date=after record date → Scenario 2: sent to old bank; share last 4 digits of old account; escalate #asset-repayment-issues if amount not found
  recent_bank_change=no + bank_statement_check=provided and IFSC does NOT match → Scenario 4 Case 2: IFSC mismatch; ask user to update bank details
  recent_bank_change=no + bank_statement_check=provided and IFSC matches → Scenario 4 Case 1: details match; escalate #asset-repayment-issues with CMR + bank statement

KYC:
  aof_status=blank → user has not started KYC
  aof_status=pending → eSign link sent, user has not signed yet
  aof_status=expired → eSign link expired; needs reset
  aof_status=signed → check KRA, AML, Insta Demat, UCC in Finder
  kra_status=approved + aml_status=approved + insta_demat_status=completed + ucc_status=blank → UCC pending; request self-attested PAN; raise #ucc-coordination
  which_kra=CVL → CVL KRA template; check CVL portal and KRA mod sheet; escalate #bond-kyc-discrepancies @dpops
  which_kra=NDML → NDML template with T+4 expected resolution

PAYMENTS (B3 — payment not going through):
  payment_error_type=bank website redirect failed → known intermittent bank error; ask user to retry or switch to UPI
  payment_error_type=UPI transaction declined → check Cashfree portal for failure reason; guide retry
  payment_error_type=error message shown on screen → get screenshot; check gateway (Razorpay for Net Banking, Cashfree for UPI); if URL rejected error → known bank-end issue, retry or switch method
  payment_error_type=amount deducted but no order placed + order_visible_on_finder=yes → order exists, settlement delay — check RFQ tab status
  payment_error_type=amount deducted but no order placed + order_visible_on_finder=no → deduction without order — raise on #cx-email-coordination, tag @email; 10–15 day SLA
  retried=no → guide user to retry or try alternate payment method first before escalating
  retried=yes → check gateway portal for failure reason; raise on #cx-email-coordination, tag @email; share 10–15 day resolution SLA with user

GATEWAY CHECKS (internal — agent only):
  UPI payments → Cashfree portal; confirm valid UPI account
  Net Banking via Razorpay → Razorpay portal
  Net Banking via Cashfree → wint_cashfree profile on Cashfree

SIP:
  active_sip_on_finder=no → debit may be from old cancelled mandate or bank error — not a Wint SIP
  mandate_type=UPI AutoPay + amount change requested → cancel and re-setup SIP (UPI mandate cannot be modified mid-flight)
  mandate_type=eNACH + amount change requested → raise in SIP modification sheet; tag Shaurya Agarwal / Hrithik

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

${context ? `KNOWLEDGE BASE:\n${context}` : `KNOWLEDGE BASE: No relevant documents found. Please connect with CX-TL or Divyansh.`}

---

Produce only the final briefing. No preamble, no labels, no summary. Just what the agent needs right now.`;

  const kbSection = context
    ? `KNOWLEDGE BASE:\n${context}`
    : `KNOWLEDGE BASE: No relevant documents found.`;

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
      try {
        console.log(`[chat] Calling ${provider} (${modelName})...`);

        if (provider === 'claude') {
          const client = new Anthropic({ apiKey: config.anthropicApiKey });
          const anthropicMessages = messages.map((m: any) => ({
            role: m.role === 'assistant' ? 'assistant' : 'user',
            content: m.content,
          }));
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
              if (text) controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'text', text })}\n\n`));
            }
          }
        } else {
          const history = messages.slice(0, -1).map((m: any) => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }],
          }));
          const response = await geminiStream(
            geminiKeys,
            modelName,
            [...history, { role: 'user', parts: [{ text: query }] }],
            systemPromptWithAnswers
          );
          for await (const chunk of response) {
            const text = chunk.text;
            if (text) controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'text', text })}\n\n`));
          }
        }

        console.log('[chat] Stream complete');
      } catch (err: any) {
        console.error('[chat] LLM error:', err?.message, err?.status);
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'text', text: `Error: ${err.message}` })}\n\n`));
      }
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
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
