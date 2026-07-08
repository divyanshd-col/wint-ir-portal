import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import Anthropic from '@anthropic-ai/sdk';
import { fetchKnowledgeChunks, retrieveRelevantChunks, getTopKBScore } from '@/lib/drive';
import { searchSlack } from '@/lib/slack';
import { readConfig } from '@/lib/config';
import { logChatMessage } from '@/lib/logger';
import { getOrderedGeminiKeys, geminiGenerate, geminiStream } from '@/lib/gemini';
import { DEFAULT_CHAT_PROCESS_PROMPT } from '@/lib/prompts';


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

  const defaultSystemPrompt = `${DEFAULT_CHAT_PROCESS_PROMPT}

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
