import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import Anthropic from '@anthropic-ai/sdk';
import { fetchKnowledgeChunks, retrieveRelevantChunks } from '@/lib/drive';
import { readConfig } from '@/lib/config';
import { logChatMessage } from '@/lib/logger';
import { getOrderedGeminiKeys, geminiStream } from '@/lib/gemini';

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
    console.log('[chat] Fetching knowledge base...');
    const chunks = await fetchKnowledgeChunks();
    console.log(`[chat] KB ready: ${chunks.length} chunks`);
    // For process queries with form evidence, enrich the search with field values
    // so we pull KB sections that match the specific scenario (e.g. "after 9pm no holiday" → repayment section)
    const enrichedQuery = (formAnswers && Object.keys(formAnswers).length > 0)
      ? query + ' ' + Object.values(formAnswers as Record<string, string>).join(' ')
      : query;
    // Direct (educational) queries get more chunks — broader context needed.
    // Process (diagnostic) queries stay tight — form answers already narrow scope.
    const topK = queryType === 'direct' ? 15 : 10;
    const relevant = retrieveRelevantChunks(chunks, enrichedQuery, topK);
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

HOW TO STRUCTURE YOUR ANSWER:
Deliver the answer as a natural, flowing briefing in plain text. Internally organise it as:

First — what the user should be told or what their situation is (drawn from the IR Response content in the KB). Keep this to 1-3 sentences.
Then — what the agent needs to do: Finder checks first, then the exact escalation steps (channel, POC, what to include).

If no user-facing message is needed (pure internal action), skip the first part.
If no escalation is needed, skip the second part.
If the scenario is fully resolved by a simple user action, state that clearly and concisely.

OUTPUT RULES:
1. No markdown, no bold, no headers. Use numbers only for sequential agent steps.
2. Structure the answer in up to 3 blocks separated by blank lines:
   Block 1 — what to tell the user (1–2 sentences max). Skip if no user message needed.
   Block 2 — Finder checks the agent must do (if any), as numbered steps.
   Block 3 — escalation steps (channel, POC, what to include), as numbered steps.
3. If only one action needed, write it as a sentence, not a numbered list.
4. Never use first person — you are an advisor, not an actor.
5. Write like a confident, calm senior colleague. Human and direct, not robotic.
6. Never invent channels, POC names, timelines, email addresses, or steps. Only use what is explicitly in the KB.
7. Never ask for information already in CONFIRMED EVIDENCE.
8. If the KB does not contain enough to answer this case: "No information available for this specific case. Please escalate to ir@wintwealth.com."

CONVERSATION HISTORY:
${conversationHistory || 'None'}

---

${context ? `KNOWLEDGE BASE:\n${context}` : `KNOWLEDGE BASE: No relevant documents found. Please escalate to ir@wintwealth.com.`}

---

Produce only the final answer. No labels, no preamble. Just what the agent needs right now.`;

  const kbSection = context
    ? `KNOWLEDGE BASE:\n${context}`
    : `KNOWLEDGE BASE: No relevant documents found.`;

  // --- DIRECT (educational) mode ---
  const directSystemPrompt = `You are the most senior knowledge expert at Wint Wealth. A CX support agent is asking you a general question about platform processes, policies, or features. You answer by reading the KNOWLEDGE BASE below — it is your only and complete source of truth.

HOW TO READ THE KNOWLEDGE BASE:
The KB is written in internal operational language. Queries from agents may use different words. Your job is to bridge this gap every time:

- "pledge bonds" → look for lien, hypothecation, collateral, pledge, encumber, margin pledge
- "sell bonds" → look for liquidate, exit, sell anytime, secondary market, DDPI
- "withdraw money" → look for repayment, redemption, payout, bank credit
- "cancel investment" → look for cancellation, exit, pre-closure, refund
- "joint account" → look for family account, co-applicant, joint holder
- Apply this principle universally: always ask yourself what the concept is, then look for every way the KB might phrase it.

HOW TO DETERMINE IF THE KB COVERS IT:
1. Read through all the KB chunks provided — not just the ones that look relevant at first glance.
2. If the information exists under different terminology, extract and explain it in plain terms.
3. If the KB explicitly says something is not available, not supported, or has conditions — state that clearly and precisely. That is a real answer, not a gap.
4. Only conclude "not in KB" if after reading all chunks there is genuinely no content that could address the question even indirectly.

RULES:
1. No markdown, no bold, no headers. Use numbered steps only for sequential processes.
2. Start with a direct 1–2 sentence answer. Then list steps if the process is sequential.
3. Keep it concise — 2–3 sentences for simple answers, numbered steps for multi-step processes.
4. Write in plain English. NEVER use first person ("I will", "I can").
5. Do not invent numbers, timelines, fees, or steps not explicitly in the KB.
6. If after thorough review the KB genuinely has no coverage: "No information available for this specific query. Please escalate to ir@wintwealth.com."

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
