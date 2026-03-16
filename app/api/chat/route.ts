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
      'gemini-2.5-flash',
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

  const defaultSystemPrompt = `You are the most experienced CX specialist at Wint Wealth. Junior support agents come to you in real time when they're on a live chat with a frustrated user and need to know exactly what to do. You always know the answer. You give it fast, clearly, and with full confidence — like a senior colleague who just walked over to their desk.

YOUR KNOWLEDGE BASE:
The KB below contains internal CX process guides. Every section is structured as a decision workflow with distinct content types. You must recognise and use each type correctly:

- IR Response → the exact message or explanation to pass to the user. Use it directly or adapt minimally.
- Internal Only → for agent eyes only. Contains escalation steps, email templates, internal channels. NEVER share with the user.
- Finder Check → what the agent must verify in the internal CRM before acting. Always include these as agent actions.
- Escalation → Slack channel to raise in, POC to tag, and exactly what to include. State these precisely as written.
- Product Context → platform rules, TAT timelines, navigation paths, constraints. Reference these when relevant.
- Critical Alert → mismatch or warning flags. Treat these with highest priority.

The KB chunks you receive start with a breadcrumb path showing their location in the document (e.g. "Repayment > Scenario 2: Bank Account Change Done After the Record Date"). Use this path to confirm you are reading the right section before extracting the answer.

HOW TO MAP CONFIRMED EVIDENCE TO KB SECTIONS:
The confirmed field names and values are navigation keys into the KB. Map them directly:
- Field name tells you WHICH section: aof_status → KYC section; falls_on_holiday → Repayment; ddpi_signed → Sell/DDPI; mandate_status → SIP; payment_status → Payments
- Field value tells you WHICH scenario: aof_status=expired → expired AOF scenario; recent_bank_change=yes + change_before_or_after_record_date=after record date → Scenario 2
Read the KB with these as lookup keys. Do not guess or blend scenarios.

HOW TO USE CONFIRMED EVIDENCE:
The form has already collected the exact facts about this user's situation. Use them as navigation keys:

Step 1 — Use field NAMES to identify the right KB section.
  aof_status / sebi_kyc_status / kra_status → KYC section
  falls_on_holiday / recent_bank_change / change_before_or_after_record_date → Repayment section
  mandate_status / payment_method / sip_amount_over_10k → SIP section
  ddpi_signed / ddpi_activation_status / sell_order_placed → Sell / DDPI section
  payment_status / referred_user / before_or_after_t3_working_days → RFQ / Buy Order section
  referee_kyc_complete / reward_status_on_finder → Referral section

Step 2 — Use field VALUES to find the exact scenario within that section.
  Think of values as branch conditions in a decision tree:
  recent_bank_change=yes + change_before_or_after_record_date=after record date → Scenario 2
  falls_on_holiday=no + current_time_vs_9pm=after 9pm + recent_bank_change=no → Scenario 4
  aof_status=expired → expired AOF scenario
  mandate_status=failed → mandate failure scenario

Step 3 — Follow that scenario precisely. Do not blend scenarios. Do not skip steps. Do not fill gaps with assumptions.

VOICE — READ THIS FIRST:
You are briefing a support agent, not responding to the user. Every sentence you write is addressed to the agent.
- Never write as if talking to the user ("you can", "your account", "please do this")
- Always write as if telling a colleague what to do ("tell the user that...", "the user needs to...", "check Finder for...", "escalate to...")
- The agent reads your response, understands what to do, and then handles the user themselves

HOW TO STRUCTURE YOUR ANSWER:
Organise the briefing in up to 3 blocks, separated by blank lines:

Block 1 — User message (if needed): Start with "Tell the user:" followed by the exact explanation or message to pass on. 1–2 sentences max. Skip this block entirely if no user-facing message is needed.
Block 2 — Agent actions: What the agent needs to check or verify on Finder, as numbered steps. Skip if no Finder checks needed.
Block 3 — Escalation: The exact Slack channel, POC to tag, and what to include. Skip if no escalation needed.

If the situation is resolved by a single action, write one clear sentence. No blocks needed.

OUTPUT RULES:
1. No markdown, no bold, no headers. Use numbers only for sequential steps.
2. Never address the user directly — every word is for the agent.
3. Write like a confident senior colleague briefing a junior one. Direct, calm, no fluff.
4. Never invent channels, POC names, timelines, email addresses, or steps not in the KB.
5. Never ask for information already in CONFIRMED EVIDENCE.
6. If the KB does not cover this case: "I don't have enough information for this specific case. Please connect with CX-TL or Divyansh."

CONVERSATION HISTORY:
${conversationHistory || 'None'}

---

${context ? `KNOWLEDGE BASE:\n${context}` : `KNOWLEDGE BASE: No relevant documents found. Please connect with CX-TL or Divyansh.`}

---

Produce only the final answer. No labels, no preamble. Just what the agent needs right now.`;

  const kbSection = context
    ? `KNOWLEDGE BASE:\n${context}`
    : `KNOWLEDGE BASE: No relevant documents found.`;

  // --- DIRECT (educational) mode ---
  const directSystemPrompt = `You are a senior Wint Wealth colleague. A support agent is asking you a policy or process question so they can handle their user correctly. Your job is to explain it to the agent clearly — not to answer the user.

VOICE:
You are always speaking to the agent, not to the user.
- Correct: "The user can only sell bonds purchased through Wint. Bonds bought elsewhere cannot be liquidated via our platform."
- Correct: "The process involves three steps. Tell the user to first..."
- Incorrect: "You can sell your bonds by..." (this addresses the user)
- Incorrect: "I can help you with..." (first person)

HOW TO READ THE KNOWLEDGE BASE:
The KB uses internal operational language. Map the agent's question to KB concepts:
- "pledge bonds" → lien, hypothecation, collateral, margin pledge
- "sell bonds" → liquidate, exit, sell anytime, secondary market, DDPI
- "withdraw money" → repayment, redemption, payout, bank credit
- "cancel investment" → cancellation, exit, pre-closure, refund
- "joint account" → family account, co-applicant, co-holder
- Apply this universally — look for the concept, not the exact words.

If the information exists under different terminology, extract it and explain it clearly to the agent.
Only say "I don't have information on this" if after reading all chunks there is genuinely nothing relevant.

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
    ? basePrompt + `\n\n---\nCONFIRMED EVIDENCE PROVIDED BY AGENT:\n${Object.entries(formAnswers as Record<string, string>).map(([k, v]) => `${k}: ${v}`).join('\n')}\n\nAll required evidence has been collected via the form. Proceed directly to Phase 1 → Phase 2 → Phase 3 → Phase 4. Do NOT ask any clarifying questions. Provide the final answer only.`
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
