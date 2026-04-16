/**
 * POST /api/webhooks/chat
 *
 * Robylon webhook. Three events feed a per-chat pending state:
 *
 *   TICKET_CLOSED          — transcript + agent name + timing
 *   CLASSIFICATION_UPDATED — disposition (l1) + sub-disposition (l2)
 *   CSAT_SUBMITTED         — customer rating
 *
 * Scoring is triggered when:
 *   1. All three signals are present  → score immediately
 *   2. Transcript + tags present, no CSAT for ≥ 12 h → scored by hourly cron
 *      (/api/cron/process-pending-scores)
 *
 * Authentication: Authorization: Bearer <WEBHOOK_SECRET>
 * or ?secret=<WEBHOOK_SECRET>
 */

import { NextRequest, NextResponse } from 'next/server';
import { readConfig } from '@/lib/config';
import { geminiGenerate, getIQSGeminiKeys } from '@/lib/gemini';
import { fetchKnowledgeChunks, retrieveRelevantChunks } from '@/lib/drive';
import {
  IQS_SYSTEM_PROMPT, buildScoringPrompt, parseScoringResponse,
  analyzeConversationTiming,
} from '@/lib/quality';
import type { IQSScoreEntry, TimedMessage } from '@/lib/quality';
import {
  storeAppendIQSScore,
  storeSavePendingScore,
  storeGetPendingScore,
  storeDeletePendingScore,
  storeSetTranscript,
  storeGetTranscript,
  storeGetAndClearPendingCsat,
  storePendingCsat,
  type PendingScoreState,
} from '@/lib/store';
import Anthropic from '@anthropic-ai/sdk';

// ── CSAT normalisation ────────────────────────────────────────────────────────
function normaliseCsat(raw: string | undefined): string {
  if (!raw) return '';
  const v = String(raw).trim().toLowerCase();
  if (v === 'good'              || v === '5') return '5';
  if (v === 'could be better'  || v === 'ok' || v === 'okay' || v === '3') return '3';
  if (v === 'bad'              || v === '1') return '1';
  return raw;
}

// ── Messages → transcript text ────────────────────────────────────────────────
interface RobyMessage { sender?: string; content?: string; role?: string; text?: string; timestamp?: string; }

function messagesToTranscript(messages: RobyMessage[]): string {
  const lines: string[] = [];
  for (const m of messages) {
    const sender  = m.sender || m.role || '';
    const content = (m.content || m.text || '').trim();
    if (!content) continue;
    const low = content.toLowerCase();
    if (low.includes('auto-assigned') || low.includes('assigned by') ||
        low.includes('waiting to assign') || low.includes('please rate your experience') ||
        (m as any).buttons) continue;
    const role = sender === 'User' || sender === 'user' || sender === 'customer' ? 'Customer'
               : sender === 'Bot'  || sender === 'bot'                           ? 'Bot'
               : 'Agent';
    lines.push(`${role}: ${content}`);
  }
  return lines.join('\n');
}

// ── Parse "Apr 15, 10:51 AM" → ISO (IST = UTC+5:30) ─────────────────────────
function parseRobyTimestamp(ts: string, year: number): string {
  try {
    const match = ts.match(/^(\w+)\s+(\d+),\s+(\d+):(\d+)\s+(AM|PM)$/);
    if (!match) return '';
    const [, mon, day, hr, min, ampm] = match;
    let hour = parseInt(hr, 10);
    if (ampm === 'PM' && hour !== 12) hour += 12;
    if (ampm === 'AM' && hour === 12) hour = 0;
    const months: Record<string, number> = {
      Jan:0, Feb:1, Mar:2, Apr:3, May:4, Jun:5,
      Jul:6, Aug:7, Sep:8, Oct:9, Nov:10, Dec:11,
    };
    const monthIdx = months[mon];
    if (monthIdx === undefined) return '';
    const d = new Date(Date.UTC(year, monthIdx, parseInt(day, 10), hour, parseInt(min, 10)));
    d.setMinutes(d.getMinutes() - 330); // IST → UTC
    return d.toISOString();
  } catch { return ''; }
}

// ── Extract last human agent name ────────────────────────────────────────────
function extractAgentName(messages: any[]): string {
  const nonAgents = new Set(['user', 'bot', 'myra', 'system', '']);
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    const sender  = (m.sender || m.role || '').trim();
    if (nonAgents.has(sender.toLowerCase())) continue;
    const content = (m.content || m.text || '').toLowerCase();
    if (content.includes('auto-assigned') || content.includes('assigned by')) continue;
    return sender;
  }
  return '';
}

// ── Auth ──────────────────────────────────────────────────────────────────────
function isAuthorised(req: NextRequest): boolean {
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret) { console.warn('[webhook] WEBHOOK_SECRET not set — accepting all requests'); return true; }
  const authHeader = req.headers.get('authorization') || '';
  if (authHeader === `Bearer ${secret}`) return true;
  const url = new URL(req.url);
  if (url.searchParams.get('secret') === secret) return true;
  return false;
}

// ── Get or create a blank pending state for a chat ───────────────────────────
function blankPendingState(chatId: string): PendingScoreState {
  return {
    chatId,
    createdAt: new Date().toISOString(),
    transcript: '', timedMessages: [], agentName: '',
    date: new Date().toISOString().slice(0, 10),
    convStarted: '', convEnded: '',
    hasTranscript: false,
    disposition: '', subDisposition: '', hasTags: false,
    csat: '', hasCsat: false,
  };
}

async function getOrCreate(chatId: string): Promise<PendingScoreState> {
  return (await storeGetPendingScore(chatId)) ?? blankPendingState(chatId);
}

// ── Extract a search query from the transcript (fallback when no disposition) ──
function extractQueryFromTranscript(transcript: string): string {
  return transcript.split('\n')
    .filter(l => l.startsWith('Customer:'))
    .slice(0, 3)
    .map(l => l.replace('Customer:', '').trim())
    .join(' ');
}

// ── Core scoring (called from webhook + cron) ─────────────────────────────────
export async function executeScoring(state: PendingScoreState): Promise<IQSScoreEntry> {
  // Hard requirement: never score without transcript AND tags
  if (!state.hasTranscript || !state.hasTags) {
    throw new Error(
      `Scoring blocked for chat ${state.chatId} — missing required signals ` +
      `(hasTranscript=${state.hasTranscript}, hasTags=${state.hasTags}). ` +
      `Scoring requires both transcript and classification tags.`
    );
  }
  const config       = await readConfig();
  const provider     = config.llmProvider || 'gemini';
  const geminiKeys   = getIQSGeminiKeys(config);
  const anthropicKey = config.iqsAnthropicApiKey || config.anthropicApiKey;

  // ── Fetch relevant KB chunks to ground the Technical scoring parameter ──────
  let kbContext = '';
  try {
    const searchQuery = state.disposition
      ? `${state.disposition} ${state.subDisposition}`.trim()
      : extractQueryFromTranscript(state.transcript);

    if (searchQuery) {
      const allChunks = await fetchKnowledgeChunks();
      const relevant  = retrieveRelevantChunks(allChunks, searchQuery, 5);
      if (relevant.length) {
        kbContext = relevant
          .map(c => `[${c.fileName}]\n${c.content}`)
          .join('\n---\n');
        console.log(`[webhook] KB context: ${relevant.length} chunks for query "${searchQuery}"`);
      }
    }
  } catch (err: any) {
    // KB fetch failure should not block scoring — proceed without context
    console.warn('[webhook] KB fetch failed, scoring without context:', err.message);
  }

  const userPrompt = buildScoringPrompt(state.transcript, state.disposition, state.chatId, '', kbContext, state.subDisposition);

  let rawResponse: string;
  if (provider === 'claude' && anthropicKey) {
    const client = new Anthropic({ apiKey: anthropicKey });
    const resp = await client.messages.create({
      model: 'claude-sonnet-4-6', max_tokens: 2000,
      system: IQS_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    });
    rawResponse = resp.content[0].type === 'text' ? resp.content[0].text : '';
  } else if (geminiKeys.length) {
    rawResponse = await geminiGenerate(
      geminiKeys, 'gemini-2.5-flash',
      [{ role: 'user', parts: [{ text: IQS_SYSTEM_PROMPT + '\n\n' + userPrompt }] }],
      {}, 60000,
    );
  } else {
    throw new Error('No LLM API key configured');
  }

  const parsed = parseScoringResponse(rawResponse, state.chatId);

  const timedMessages: TimedMessage[] = state.timedMessages as TimedMessage[];
  const timing = timedMessages.length
    ? analyzeConversationTiming(timedMessages, state.convEnded, state.transferTimestamp)
    : { conversationType: 'agent' as const, frt: undefined, botToTeamSecs: undefined, resolutionTime: undefined, closureTime: undefined };

  const model = provider === 'claude' ? 'claude-sonnet-4-6' : 'gemini-2.5-flash';

  const scoredAt = new Date().toISOString();
  const entry: IQSScoreEntry = {
    id:         `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    scoredAt,
    updatedAt:  scoredAt,
    provider, model,
    scoredBy:   'webhook:robylon',
    agentName:  timing.conversationType === 'bot'
      ? 'Myra'
      : (state.agentName || (parsed as any).extractedAgentName || ''),
    date:       state.date,
    tags:       state.disposition,
    disposition:    state.disposition,
    subDisposition: state.subDisposition,
    csat:       state.csat,
    slackUrl:   '',
    // transcript intentionally omitted — stored separately to keep list entries small
    conversationType: timing.conversationType,
    frt:              timing.frt,
    botToTeamSecs:    timing.botToTeamSecs,
    resolutionTime:   timing.resolutionTime,
    closureTime:      timing.closureTime,
    conversationStarted: state.convStarted,
    conversationEnded:   state.convEnded,
    ...parsed,
    chatId: state.chatId, // ensure our chatId wins
  };

  await storeAppendIQSScore(entry);
  // Save transcript permanently (separate key — doesn't bloat the score list)
  await storeSetTranscript(state.chatId, { timedMessages: state.timedMessages });
  await storeDeletePendingScore(state.chatId);

  console.log(`[webhook] Scored chat ${state.chatId} → IQS ${entry.iqs}% (${entry.agentName || 'unknown'}) type=${timing.conversationType} csat=${state.csat || 'none'}`);
  return entry;
}

// ── Score as soon as transcript + tags arrive — CSAT is not a gate ───────────
async function tryScoreIfReady(state: PendingScoreState): Promise<IQSScoreEntry | null> {
  if (!state.hasTranscript || !state.hasTags) return null;
  return executeScoring(state);
}

// ── Handler: TICKET_CLOSED ────────────────────────────────────────────────────
async function handleTicketClosed(body: any): Promise<NextResponse> {
  const transcriptObj = body.data?.transcript;
  if (!transcriptObj || !Array.isArray(transcriptObj.messages) || !transcriptObj.messages.length) {
    console.log('[webhook] TICKET_CLOSED — no messages in data.transcript');
    return NextResponse.json({ ok: true, scored: false, reason: 'No messages in data.transcript' });
  }

  const rawMessages: any[] = transcriptObj.messages;
  const convStarted = transcriptObj.conversation_started || body.created_at || '';
  const convEnded   = body.created_at || '';
  const chatId      = String(body.chat_id || transcriptObj.chat_id || `wh_${Date.now()}`);
  const year        = convStarted ? new Date(convStarted).getUTCFullYear() : new Date().getUTCFullYear();
  const agentName   = extractAgentName(rawMessages);
  const date        = convStarted ? convStarted.slice(0, 10) : new Date().toISOString().slice(0, 10);

  // Extract assignment timestamp BEFORE the filter loop (the "Assigned by X to Y"
  // system message is filtered from the transcript but its timestamp is the FRT start)
  let transferTimestamp: string | undefined;
  for (const m of rawMessages) {
    const content = (m.content || m.text || '').trim().toLowerCase();
    if (content.includes('assigned by') && m.timestamp) {
      transferTimestamp = parseRobyTimestamp(m.timestamp, year) || undefined;
      break; // first assignment wins
    }
  }

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

  const state = await getOrCreate(chatId);
  Object.assign(state, {
    transcript, timedMessages, agentName, date,
    convStarted, convEnded, hasTranscript: true,
    ...(transferTimestamp && { transferTimestamp }),
  });
  await storeSavePendingScore(state);

  const scored = await tryScoreIfReady(state);
  if (scored) {
    return NextResponse.json({
      ok: true, chat_id: chatId, iqs: scored.iqs, agent: scored.agentName,
      conversation_type: scored.conversationType,
      frt_secs: scored.frt, b_to_t_secs: scored.botToTeamSecs,
      resolution_secs: scored.resolutionTime, closure_secs: scored.closureTime,
      csat: scored.csat || undefined, scored_at: scored.scoredAt,
    });
  }

  console.log(`[webhook] Transcript stored for chat ${chatId} — waiting for classification`);
  return NextResponse.json({ ok: true, event: 'transcript_stored', chat_id: chatId, waiting: 'classification' });
}

// ── Handler: CLASSIFICATION_UPDATED ──────────────────────────────────────────
async function handleClassificationUpdated(body: any): Promise<NextResponse> {
  const chatId          = String(body.chat_id || '');
  const classifications: any[] = body.data?.classifications || [];

  const primary = [...classifications].sort((a, b) => (b.level_number ?? 0) - (a.level_number ?? 0))[0];
  if (!primary) {
    return NextResponse.json({ ok: true, scored: false, reason: 'No classifications in payload' });
  }

  const disposition    = primary.names?.l1 || '';
  const subDisposition = primary.names?.l2 || '';

  const state = await getOrCreate(chatId);

  // Check if we already have a pending CSAT for this chat — carry it in
  const pendingCsat = await storeGetAndClearPendingCsat(chatId);
  if (pendingCsat) {
    Object.assign(state, { csat: pendingCsat, hasCsat: true });
  }

  Object.assign(state, { disposition, subDisposition, hasTags: true });
  await storeSavePendingScore(state);

  // Persist classification alongside the transcript (so it's stored permanently)
  if (state.chatId) {
    const existing = await storeGetTranscript(chatId);
    if (existing) {
      await storeSetTranscript(chatId, { ...existing, disposition, subDisposition });
    }
  }

  // Score immediately — CSAT is no longer a gate
  const scored = await tryScoreIfReady(state);
  if (scored) {
    return NextResponse.json({
      ok: true, chat_id: chatId, iqs: scored.iqs,
      disposition, subDisposition, csat: scored.csat || undefined,
      scored_at: scored.scoredAt,
    });
  }

  console.log(`[webhook] Tags stored for chat ${chatId}: ${disposition} > ${subDisposition} — waiting for transcript`);
  return NextResponse.json({ ok: true, event: 'tags_stored', chat_id: chatId, disposition, subDisposition, waiting: 'transcript' });
}

// ── Handler: CSAT_SUBMITTED — only updates existing score, never triggers scoring ──
async function handleCsatEvent(body: any): Promise<NextResponse> {
  const chatId = String(body.chat_id || '');
  const rating  = body.data?.rating;
  if (!rating) {
    return NextResponse.json({ ok: true, reason: 'No rating in CSAT event' });
  }

  const csat = normaliseCsat(String(rating));

  // Try to update an already-scored entry in the IQS list
  const { storeUpdateIQSScoreCsat } = await import('@/lib/store');
  const updated = await storeUpdateIQSScoreCsat(chatId, csat);
  if (updated) {
    console.log(`[webhook] CSAT updated on scored entry for chat ${chatId}: ${csat}`);
    return NextResponse.json({ ok: true, event: 'csat_updated', chat_id: chatId, csat });
  }

  // Score not found yet — store as pending so classification handler can pick it up
  await storePendingCsat(chatId, csat);
  console.log(`[webhook] CSAT stored pending for chat ${chatId}: ${csat} — no scored entry found yet`);
  return NextResponse.json({ ok: true, event: 'csat_pending', chat_id: chatId, csat });
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
      ok: true, scored: false,
      reason: 'No transcript extracted — raw payload logged for inspection',
      received_keys: Object.keys(body),
    });
  }

  // Legacy path: go through the same pending-state gate — tags still required
  const chatId = String(chat_id || conversation_id || `wh_${Date.now()}`);

  const state: PendingScoreState = {
    chatId,
    createdAt: new Date().toISOString(),
    transcript,
    timedMessages,
    agentName: String(agent_name || ''),
    date: conversation_started
      ? String(conversation_started).slice(0, 10)
      : new Date().toISOString().slice(0, 10),
    convStarted: conversation_started || '',
    convEnded:   conversation_ended   || '',
    hasTranscript: true,
    disposition: tags, subDisposition: '', hasTags: !!tags,
    csat: normaliseCsat(csat), hasCsat: !!csat,
  };

  const channelPrefix = channel === 'call' ? '[CHANNEL: PHONE CALL]\n' : '';
  state.transcript = channelPrefix + transcript;

  await storeSavePendingScore(state);

  const scored = await tryScoreIfReady(state);
  if (scored) {
    return NextResponse.json({
      ok: true, chat_id: chatId, iqs: scored.iqs, agent: scored.agentName,
      conversation_type: scored.conversationType,
      frt_secs: scored.frt, b_to_t_secs: scored.botToTeamSecs,
      resolution_secs: scored.resolutionTime, closure_secs: scored.closureTime,
      scored_at: scored.scoredAt,
    });
  }

  console.log(`[webhook] Legacy payload for chat ${chatId} parked — waiting for tags`);
  return NextResponse.json({ ok: true, event: 'transcript_stored', chat_id: chatId, waiting: 'waiting for tags' });
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

  console.log('[webhook] Incoming payload:', JSON.stringify(body, null, 2));

  const eventType = String(body.event_type || '');

  if (eventType === 'TICKET_CLOSED')          return handleTicketClosed(body);
  if (eventType === 'CLASSIFICATION_UPDATED') return handleClassificationUpdated(body);
  if (eventType === 'CSAT_SUBMITTED')         return handleCsatEvent(body);
  return handleLegacyPayload(body);
}
