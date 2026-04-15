/**
 * POST /api/webhooks/chat
 *
 * Webhook endpoint for Robylon events. Routes by event_type:
 *
 *   TICKET_CLOSED   — transcript lives at body.data.transcript.messages
 *                     Scores via IQS pipeline and stores the result.
 *
 *   CSAT_SUBMITTED  — rating lives at body.data.rating (integer 1/3/5)
 *                     Updates the matching IQS score entry, or stores as
 *                     pending to be merged when the ticket closes.
 *
 *   (any other)     — legacy flat transcript / messages format (backward compat)
 *
 * Authentication: Bearer token in Authorization header
 *   Authorization: Bearer <WEBHOOK_SECRET>
 * Or as a query param: ?secret=<WEBHOOK_SECRET>
 */

import { NextRequest, NextResponse } from 'next/server';
import { readConfig } from '@/lib/config';
import { geminiGenerate, getOrderedGeminiKeys } from '@/lib/gemini';
import {
  IQS_SYSTEM_PROMPT, buildScoringPrompt, parseScoringResponse,
  analyzeConversationTiming,
} from '@/lib/quality';
import type { IQSScoreEntry, TimedMessage } from '@/lib/quality';
import {
  storeAppendIQSScore,
  storePendingCsat,
  storeGetAndClearPendingCsat,
  storeUpdateIQSScoreCsat,
  storePendingTags,
  storeGetAndClearPendingTags,
  storeUpdateIQSScoreTags,
} from '@/lib/store';
import Anthropic from '@anthropic-ai/sdk';

// ── CSAT normalisation ────────────────────────────────────────────────────────
function normaliseCsat(raw: string | undefined): string {
  if (!raw) return '';
  const v = String(raw).trim().toLowerCase();
  if (v === 'good' || v === '5') return '5';
  if (v === 'could be better' || v === 'ok' || v === 'okay' || v === '3') return '3';
  if (v === 'bad' || v === '1') return '1';
  return raw;
}

// ── Messages → transcript text ────────────────────────────────────────────────
interface RobyMessage { sender?: string; content?: string; role?: string; text?: string; timestamp?: string; }

function messagesToTranscript(messages: RobyMessage[]): string {
  const lines: string[] = [];
  for (const m of messages) {
    const sender = m.sender || m.role || '';
    const content = (m.content || m.text || '').trim();
    if (!content) continue;
    const low = content.toLowerCase();
    if (low.includes('auto-assigned') || low.includes('assigned by') ||
        low.includes('waiting to assign') || low.includes('please rate your experience') ||
        (m as any).buttons) continue;
    const role = sender === 'User' || sender === 'user' || sender === 'customer'
      ? 'Customer'
      : sender === 'Bot' || sender === 'bot'
      ? 'Bot'
      : 'Agent';
    lines.push(`${role}: ${content}`);
  }
  return lines.join('\n');
}

// ── Parse Robylon timestamp "Apr 15, 10:51 AM" → ISO (assumes IST = UTC+5:30) ─
function parseRobyTimestamp(ts: string, year: number): string {
  try {
    const match = ts.match(/^(\w+)\s+(\d+),\s+(\d+):(\d+)\s+(AM|PM)$/);
    if (!match) return '';
    const [, mon, day, hr, min, ampm] = match;
    let hour = parseInt(hr, 10);
    if (ampm === 'PM' && hour !== 12) hour += 12;
    if (ampm === 'AM' && hour === 12) hour = 0;
    const months: Record<string, number> = {
      Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
      Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
    };
    const monthIdx = months[mon];
    if (monthIdx === undefined) return '';
    // Build UTC date, then subtract IST offset (5h 30m = 330 min)
    const d = new Date(Date.UTC(year, monthIdx, parseInt(day, 10), hour, parseInt(min, 10)));
    d.setMinutes(d.getMinutes() - 330);
    return d.toISOString();
  } catch {
    return '';
  }
}

// ── Extract first human agent name from messages ──────────────────────────────
function extractAgentName(messages: any[]): string {
  const nonAgents = new Set(['user', 'bot', 'myra', 'system', '']);
  for (const m of messages) {
    const sender = (m.sender || m.role || '').trim();
    if (nonAgents.has(sender.toLowerCase())) continue;
    const content = (m.content || m.text || '').toLowerCase();
    if (content.includes('auto-assigned') || content.includes('assigned by')) continue;
    return sender;
  }
  return '';
}

// ── Auth check ────────────────────────────────────────────────────────────────
function isAuthorised(req: NextRequest): boolean {
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret) {
    console.warn('[webhook] WEBHOOK_SECRET not set — accepting all requests');
    return true;
  }
  const authHeader = req.headers.get('authorization') || '';
  if (authHeader === `Bearer ${secret}`) return true;
  const url = new URL(req.url);
  if (url.searchParams.get('secret') === secret) return true;
  return false;
}

// ── Shared LLM scorer ─────────────────────────────────────────────────────────
async function scoreTranscript(transcript: string, chatId: string) {
  const config = await readConfig();
  const provider = config.llmProvider || 'gemini';
  const geminiKeys = getOrderedGeminiKeys(config);
  const userPrompt = buildScoringPrompt(transcript, '', chatId);

  let rawResponse: string;
  if (provider === 'claude' && config.anthropicApiKey) {
    const client = new Anthropic({ apiKey: config.anthropicApiKey });
    const resp = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      system: IQS_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    });
    rawResponse = resp.content[0].type === 'text' ? resp.content[0].text : '';
  } else if (geminiKeys.length) {
    rawResponse = await geminiGenerate(
      geminiKeys, 'gemini-2.5-flash',
      [{ role: 'user', parts: [{ text: IQS_SYSTEM_PROMPT + '\n\n' + userPrompt }] }],
      {}, 60000
    );
  } else {
    throw new Error('No LLM API key configured');
  }

  const config2 = await readConfig(); // re-read to get latest provider
  return {
    parsed: parseScoringResponse(rawResponse, chatId),
    provider,
    model: provider === 'claude' ? 'claude-sonnet-4-6' : 'gemini-2.5-flash',
  };
}

// ── Handler: CLASSIFICATION_UPDATED ──────────────────────────────────────────
async function handleClassificationUpdated(body: any): Promise<NextResponse> {
  const chatId = String(body.chat_id || '');
  const classifications: any[] = body.data?.classifications || [];

  // Pick the classification with the deepest level (prefer l2 over l1-only)
  const primary = classifications.sort((a, b) => (b.level_number ?? 0) - (a.level_number ?? 0))[0];
  if (!primary) {
    return NextResponse.json({ ok: true, scored: false, reason: 'No classifications in payload' });
  }

  const disposition    = primary.names?.l1 || '';
  const subDisposition = primary.names?.l2 || '';

  // Try to update an existing IQS score entry first (ticket already closed)
  const updated = await storeUpdateIQSScoreTags(chatId, disposition, subDisposition);
  if (updated) {
    console.log(`[webhook] Tags updated for chat ${chatId} → ${disposition} > ${subDisposition}`);
    return NextResponse.json({ ok: true, event: 'tags_updated', chat_id: chatId, disposition, subDisposition });
  }

  // Ticket not scored yet — park until TICKET_CLOSED arrives
  await storePendingTags(chatId, disposition, subDisposition);
  console.log(`[webhook] Tags stored as pending for chat ${chatId} → ${disposition} > ${subDisposition}`);
  return NextResponse.json({ ok: true, event: 'tags_pending', chat_id: chatId, disposition, subDisposition });
}

// ── Handler: CSAT_SUBMITTED ───────────────────────────────────────────────────
async function handleCsatEvent(body: any): Promise<NextResponse> {
  const chatId = String(body.chat_id || '');
  const rating = body.data?.rating;
  if (!rating) {
    return NextResponse.json({ ok: true, scored: false, reason: 'No rating field in CSAT event' });
  }

  const csat = normaliseCsat(String(rating));

  // Try to update an existing IQS score first
  const updated = await storeUpdateIQSScoreCsat(chatId, csat);
  if (updated) {
    console.log(`[webhook] CSAT updated inline for chat ${chatId} → ${csat}`);
    return NextResponse.json({ ok: true, event: 'csat_updated', chat_id: chatId, csat });
  }

  // Ticket not scored yet — park the CSAT until TICKET_CLOSED arrives
  await storePendingCsat(chatId, csat);
  console.log(`[webhook] CSAT stored as pending for chat ${chatId} → ${csat}`);
  return NextResponse.json({ ok: true, event: 'csat_pending', chat_id: chatId, csat });
}

// ── Handler: TICKET_CLOSED ────────────────────────────────────────────────────
async function handleTicketClosed(body: any): Promise<NextResponse> {
  const transcriptObj = body.data?.transcript;
  if (!transcriptObj || !Array.isArray(transcriptObj.messages) || !transcriptObj.messages.length) {
    console.log('[webhook] TICKET_CLOSED — no messages found in data.transcript');
    return NextResponse.json({ ok: true, scored: false, reason: 'No messages in data.transcript' });
  }

  const rawMessages: any[] = transcriptObj.messages;
  const convStarted: string = transcriptObj.conversation_started || body.created_at || '';
  const convEnded: string   = body.created_at || '';  // ticket close time = conversation end
  const chatId              = String(body.chat_id || transcriptObj.chat_id || `wh_${Date.now()}`);
  const year                = convStarted ? new Date(convStarted).getUTCFullYear() : new Date().getUTCFullYear();
  const agentName           = extractAgentName(rawMessages);
  const date                = convStarted ? convStarted.slice(0, 10) : new Date().toISOString().slice(0, 10);

  // Build typed message lists
  const timedMessages: TimedMessage[] = [];
  const robyMessages: RobyMessage[]   = [];

  for (const m of rawMessages) {
    const sender  = (m.sender || m.role || '').trim();
    const content = (m.content || m.text || '').trim();
    if (!content) continue;
    const low = content.toLowerCase();
    if (low.includes('auto-assigned') || low.includes('assigned by') ||
        low.includes('waiting to assign') || low.includes('please rate your experience') ||
        m.buttons) continue;
    const isoTs = m.timestamp ? parseRobyTimestamp(m.timestamp, year) : undefined;
    timedMessages.push({ sender, content, timestamp: isoTs });
    robyMessages.push({ sender, content, timestamp: m.timestamp });
  }

  const transcript = messagesToTranscript(robyMessages);
  if (!transcript) {
    return NextResponse.json({ ok: true, scored: false, reason: 'Transcript empty after filtering' });
  }

  // Timing metrics
  const timing = timedMessages.length
    ? analyzeConversationTiming(timedMessages, convEnded)
    : { conversationType: 'agent' as const, frt: undefined, botToTeamSecs: undefined, resolutionTime: undefined, closureTime: undefined };

  // Merge any pending CSAT / tags from earlier events
  const pendingCsat = await storeGetAndClearPendingCsat(chatId);
  const pendingTags = await storeGetAndClearPendingTags(chatId);

  // Score
  let scoreResult: Awaited<ReturnType<typeof scoreTranscript>>;
  try {
    scoreResult = await scoreTranscript(transcript, chatId);
  } catch (err: any) {
    console.error('[webhook] LLM error:', err.message);
    return NextResponse.json({ error: `LLM error: ${err.message}` }, { status: 500 });
  }

  try {
    const { parsed, provider, model } = scoreResult;
    const entry: IQSScoreEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      scoredAt: new Date().toISOString(),
      provider,
      model,
      scoredBy: 'webhook:robylon',
      agentName,
      date,
      tags: pendingTags?.disposition || '',
      disposition: pendingTags?.disposition || '',
      subDisposition: pendingTags?.subDisposition || '',
      csat: pendingCsat || '',
      slackUrl: '',
      transcript,
      conversationType: timing.conversationType,
      frt: timing.frt,
      botToTeamSecs: timing.botToTeamSecs,
      resolutionTime: timing.resolutionTime,
      closureTime: timing.closureTime,
      conversationStarted: convStarted,
      conversationEnded: convEnded,
      ...parsed,
      // Ensure our chatId wins over anything in parsed
      chatId,
    };

    await storeAppendIQSScore(entry);
    console.log(`[webhook] Scored chat ${chatId} → IQS ${entry.iqs}% (${agentName || 'unknown'}) type=${timing.conversationType}${pendingCsat ? ` csat=${pendingCsat}` : ''}`);

    return NextResponse.json({
      ok: true,
      chat_id: chatId,
      iqs: entry.iqs,
      agent: agentName,
      conversation_type: timing.conversationType,
      frt_secs: timing.frt,
      b_to_t_secs: timing.botToTeamSecs,
      resolution_secs: timing.resolutionTime,
      closure_secs: timing.closureTime,
      csat: entry.csat || undefined,
      scored_at: entry.scoredAt,
    });
  } catch (err: any) {
    console.error('[webhook] Parse error:', err.message);
    return NextResponse.json({ error: `Parse error: ${err.message}` }, { status: 500 });
  }
}

// ── Handler: legacy flat payload (backward compat) ────────────────────────────
async function handleLegacyPayload(body: any): Promise<NextResponse> {
  const {
    chat_id, conversation_id, agent_name,
    tags = '', csat, conversation_started, conversation_ended,
    channel = 'chat', messages, transcript: rawTranscript,
  } = body;

  let transcript = '';
  const timedMessages: TimedMessage[] = [];

  if (rawTranscript) {
    transcript = String(rawTranscript).trim();
  } else if (Array.isArray(messages) && messages.length) {
    transcript = messagesToTranscript(messages);
    for (const m of messages as RobyMessage[]) {
      const sender  = m.sender || m.role || '';
      const content = (m.content || m.text || '').trim();
      if (!content) continue;
      const low = content.toLowerCase();
      if (low.includes('auto-assigned') || low.includes('assigned by') ||
          low.includes('waiting to assign') || low.includes('please rate your experience') ||
          (m as any).buttons) continue;
      timedMessages.push({ sender, content, timestamp: m.timestamp });
    }
  }

  if (!transcript) {
    console.log('[webhook] No transcript extracted. received_keys:', Object.keys(body));
    return NextResponse.json({
      ok: true,
      scored: false,
      reason: 'No transcript extracted — raw payload logged for inspection',
      received_keys: Object.keys(body),
    });
  }

  const chatId    = String(chat_id || conversation_id || `wh_${Date.now()}`);
  const agentName = String(agent_name || '');
  const csatNorm  = normaliseCsat(csat);
  const date      = conversation_started
    ? String(conversation_started).slice(0, 10)
    : new Date().toISOString().slice(0, 10);

  const timing = timedMessages.length
    ? analyzeConversationTiming(timedMessages, conversation_ended)
    : { conversationType: 'agent' as const, frt: undefined, botToTeamSecs: undefined, resolutionTime: undefined, closureTime: undefined };

  const transcriptForScoring = channel === 'call' ? `[CHANNEL: PHONE CALL]\n${transcript}` : transcript;

  let scoreResult: Awaited<ReturnType<typeof scoreTranscript>>;
  try {
    scoreResult = await scoreTranscript(transcriptForScoring, chatId);
  } catch (err: any) {
    console.error('[webhook] LLM error:', err.message);
    return NextResponse.json({ error: `LLM error: ${err.message}` }, { status: 500 });
  }

  try {
    const { parsed, provider, model } = scoreResult;
    const entry: IQSScoreEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      scoredAt: new Date().toISOString(),
      provider,
      model,
      scoredBy: `webhook:${channel}`,
      agentName: agentName || (parsed as any).extractedAgentName || '',
      date,
      tags,
      csat: csatNorm,
      slackUrl: '',
      transcript,
      conversationType: timing.conversationType,
      frt: timing.frt,
      botToTeamSecs: timing.botToTeamSecs,
      resolutionTime: timing.resolutionTime,
      closureTime: timing.closureTime,
      conversationStarted: conversation_started,
      conversationEnded: conversation_ended,
      ...parsed,
    };

    await storeAppendIQSScore(entry);
    console.log(`[webhook] Scored chat ${chatId} → IQS ${entry.iqs}% (${agentName || 'unknown'}) type=${timing.conversationType}`);

    return NextResponse.json({
      ok: true,
      chat_id: chatId,
      iqs: entry.iqs,
      agent: agentName,
      conversation_type: timing.conversationType,
      frt_secs: timing.frt,
      b_to_t_secs: timing.botToTeamSecs,
      resolution_secs: timing.resolutionTime,
      closure_secs: timing.closureTime,
      scored_at: entry.scoredAt,
    });
  } catch (err: any) {
    console.error('[webhook] Parse error:', err.message);
    return NextResponse.json({ error: `Parse error: ${err.message}` }, { status: 500 });
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  if (!isAuthorised(req)) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // Always log the full raw payload so we can inspect what Robylon actually sends
  console.log('[webhook] Incoming payload:', JSON.stringify(body, null, 2));

  const eventType = String(body.event_type || '');

  if (eventType === 'CSAT_SUBMITTED')        return handleCsatEvent(body);
  if (eventType === 'TICKET_CLOSED')          return handleTicketClosed(body);
  if (eventType === 'CLASSIFICATION_UPDATED') return handleClassificationUpdated(body);
  return handleLegacyPayload(body);
}
