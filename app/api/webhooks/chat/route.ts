/**
 * POST /api/webhooks/chat
 *
 * Robylon webhook. Three events drive PostgreSQL-backed conversation state:
 *
 *   TICKET_CLOSED          — transcript + agent name + timing → upsert conversation
 *   CLASSIFICATION_UPDATED — disposition (l1) + sub-disposition (l2) → update tags
 *   CSAT_SUBMITTED         — customer rating → update csat_score on conversations
 *
 * Scoring is triggered when:
 *   1. TICKET_CLOSED fires and tags already exist  → score immediately
 *   2. CLASSIFICATION_UPDATED fires and transcript already exists → score immediately
 *   3. Transcript + tags present, no score for ≥ 12 h → scored by hourly cron
 *      (/api/cron/process-pending-scores)
 *
 * Authentication: Authorization: Bearer <WEBHOOK_SECRET>
 * or ?secret=<WEBHOOK_SECRET>
 */

import { NextRequest, NextResponse } from 'next/server';
import { readConfig } from '@/lib/config';
import { geminiGenerate, getIQSGeminiKeys } from '@/lib/gemini';
import { fetchKnowledgeChunks, retrieveRelevantChunks } from '@/lib/drive';
import { hasCallInteraction, fireQualityAlert } from '@/lib/quality-alert';
import {
  IQS_SYSTEM_PROMPT, buildScoringPrompt, parseScoringResponse,
  analyzeConversationTiming,
} from '@/lib/quality';
import type { TimedMessage } from '@/lib/quality';
import {
  CALL_IQS_SYSTEM_PROMPT,
  CALL_TRANSCRIPTION_PROMPT,
  buildCallScoringPrompt,
  parseCallScoringResponse,
  parseTranscriptionResponse,
  insertPoorListeningFlags,
  segmentsToText,
} from '@/lib/call-quality';
import type { CallParamScore, CallSegment } from '@/lib/call-quality';
import {
  upsertAgent,
  upsertContact,
  upsertConversation,
  updateConversationCsat,
  updateConversationTags,
  getConversation,
  isScored,
  insertIQSScore,
  updateCallIQSScore,
  getUnlinkedCallsForContact,
  linkCallToChat,
  getLinkedUnscoredCallsForChat,
  updateCallRecordingStatus,
  insertCallRecording,
  updateCallRecordingMetrics,
  type ConversationRow,
  type IQSParameterResult,
} from '@/lib/robylon/db';
import { storeHasProcessedEvent, storeMarkProcessedEvent, storeAcquireScoringLock } from '@/lib/store';
import Anthropic from '@anthropic-ai/sdk';
import type { ParamScore } from '@/lib/quality';

// ── CSAT normalisation ────────────────────────────────────────────────────────
function normaliseCsat(raw: string | undefined): { score: number; label: string } | null {
  if (!raw) return null;
  const v = String(raw).trim().toLowerCase();
  if (v === 'good'             || v === '5') return { score: 5, label: 'good' };
  if (v === 'could be better'  || v === 'ok' || v === 'okay' || v === '3') return { score: 3, label: 'could_be_better' };
  if (v === 'bad'              || v === '1') return { score: 1, label: 'bad' };
  return null;
}

// ── Messages → transcript text ────────────────────────────────────────────────────
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

// ── Build transcript text from JSONB array stored in conversations.transcript ──
function transcriptFromJsonb(messages: any[]): string {
  if (!Array.isArray(messages)) return '';
  const lines: string[] = [];
  for (const m of messages) {
    const role = m.sender_type === 'customer' ? 'Customer'
               : m.sender_type === 'bot'      ? 'Bot'
               : 'Agent';
    const content = (m.content || '').trim();
    if (content) lines.push(`${role}: ${content}`);
  }
  return lines.join('\n');
}

// ── Parse "Apr 15, 10:51 AM" → ISO (IST = UTC+5:30) ───────────────────────────
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

// ── Auth ────────────────────────────────────────────────────────────────────────────
function isAuthorised(req: NextRequest): boolean {
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret) { console.warn('[webhook] WEBHOOK_SECRET not set — accepting all requests'); return true; }
  const authHeader = req.headers.get('authorization') || '';
  if (authHeader === `Bearer ${secret}`) return true;
  const url = new URL(req.url);
  if (url.searchParams.get('secret') === secret) return true;
  return false;
}

// ── Extract a search query from the transcript (fallback when no disposition) ──
function extractQueryFromTranscript(transcript: string): string {
  return transcript.split('\n')
    .filter(l => l.startsWith('Customer:'))
    .slice(0, 3)
    .map(l => l.replace('Customer:', '').trim())
    .join(' ');
}

// ── Convert ParamScore → IQSParameterResult ───────────────────────────────────────────
function toParamResult(score: ParamScore, reasoning: string): IQSParameterResult {
  return {
    score: score === 'Yes' ? true : score === 'No' ? false : null,
    reasoning,
  };
}

// ── Call IQS scoring for calls linked to a chat ─────────────────────────────────────
async function scoreLinkedCallsForChat(
  chatId: string,
  chatTranscriptText: string,
  disposition: string,
  subDisposition: string,
  config: any,
): Promise<void> {
  const calls = await getLinkedUnscoredCallsForChat(chatId);
  if (!calls.length) return;

  const geminiKeys = getIQSGeminiKeys(config);
  if (!geminiKeys.length) return;

  let kbContext = '';
  try {
    const searchQuery = disposition ? `${disposition} ${subDisposition}`.trim() : '';
    if (searchQuery) {
      const allChunks = await fetchKnowledgeChunks();
      const relevant  = retrieveRelevantChunks(allChunks, searchQuery, 5);
      if (relevant.length) kbContext = relevant.map(c => `[${c.fileName}]\n${c.content}`).join('\n---\n');
    }
  } catch {}

  for (const call of calls) {
    const segments = Array.isArray(call.transcript) ? call.transcript : [];
    const callText  = segmentsToText(segments);
    if (!callText) {
      await updateCallRecordingStatus(call.id, 'scored');
      continue;
    }

    const scoringPrompt = buildCallScoringPrompt(
      callText,
      chatTranscriptText,
      call.id,
      call.interruption_count ?? 0,
      call.dead_air_count ?? 0,
      '',
      `${disposition} ${subDisposition}`.trim(),
      kbContext,
    );

    try {
      const raw = await geminiGenerate(
        geminiKeys,
        'gemini-2.5-flash',
        [{ role: 'user', parts: [{ text: CALL_IQS_SYSTEM_PROMPT + '\n\n' + scoringPrompt }] }],
        {},
        60_000,
      );

      const { scores, reasoning, poorListeningSegments, iqs } = parseCallScoringResponse(raw);
      const finalSegments = insertPoorListeningFlags(segments, poorListeningSegments);

      const parameters: Record<string, IQSParameterResult> = {};
      for (const [key, val] of Object.entries(scores)) {
        parameters[key] = {
          score: val === 'Yes' ? true : val === 'No' ? false : null,
          reasoning: reasoning[key] || '',
        };
      }

      // Persist updated transcript with poor_listening flags
      await insertCallRecording({
        id: call.id,
        transcript: finalSegments,
      });

      await updateCallIQSScore({ chatId, callIqsScore: iqs, callParameters: parameters, callModelVersion: 'gemini-2.5-flash' });
      await updateCallRecordingStatus(call.id, 'scored');
      console.log(`[webhook] Scored call ${call.id} → IQS ${iqs} for chat ${chatId}`);
    } catch (err: any) {
      console.error(`[webhook] Call IQS scoring failed for call ${call.id}:`, err.message);
    }
  }
}

// ── Link unscored calls to a chat, then score them if disposition is known ────
async function linkAndScoreCallsForChat(
  chatId: string,
  contactId: number,
  closedAt: string,
  chatTranscriptText: string,
  disposition: string,
  subDisposition: string,
  config: any,
): Promise<void> {
  const unlinked = await getUnlinkedCallsForContact(contactId, closedAt);
  if (!unlinked.length) return;

  await Promise.all(unlinked.map(c => linkCallToChat(c.id, chatId)));
  console.log(`[webhook] Linked ${unlinked.length} call(s) to chat ${chatId}`);

  if (disposition) {
    await scoreLinkedCallsForChat(chatId, chatTranscriptText, disposition, subDisposition, config);
  }
}

// ── Core scoring (called from webhook + cron) ────────────────────────────────────
export async function executeScoring(
  conv: ConversationRow,
  agentName: string,
  disposition: string,
  subDisposition: string,
  contactPhone?: string,
): Promise<{ chatId: string; iqs: number } | null> {
  const chatId = conv.id;

  // Atomic lock — prevents concurrent duplicate scorings when Robylon fires
  // multiple CLASSIFICATION_UPDATED events before any LLM call completes.
  const acquired = await storeAcquireScoringLock(chatId);
  if (!acquired) {
    console.log(`[webhook] Scoring lock held for chat ${chatId} — skipping duplicate`);
    return null;
  }

  // Build transcript from JSONB array or fall back to plain text if stored differently
  let transcriptMessages: any[] = [];
  if (Array.isArray(conv.transcript)) {
    transcriptMessages = conv.transcript;
  } else if (conv.transcript && typeof conv.transcript === 'object' && Array.isArray((conv.transcript as any).messages)) {
    transcriptMessages = (conv.transcript as any).messages;
  }

  let transcriptText = transcriptFromJsonb(transcriptMessages);
  if (!transcriptText) {
    console.warn(`[webhook] executeScoring: empty transcript for chat ${chatId}`);
    return null;
  }

  // ── Call detection — skip scoring silently ───────────────────────────────
  if (hasCallInteraction(transcriptText, conv.tags)) {
    console.log(`[webhook] Skipping scoring for chat ${chatId} — call interaction detected`);
    return null;
  }

  // Determine conversation type from stored timed messages
  const timedMessages: TimedMessage[] = transcriptMessages.map((m: any) => ({
    sender: m.sender_type === 'customer' ? 'user'
          : m.sender_type === 'bot'      ? 'bot'
          : (m.sender_name || 'Agent'),
    content: m.content || '',
    timestamp: m.timestamp,
  }));

  const timing = timedMessages.length
    ? analyzeConversationTiming(timedMessages, conv.closed_at ?? undefined)
    : { conversationType: 'agent' as const, frt: undefined, botToTeamSecs: undefined, resolutionTime: undefined, closureTime: undefined };

  const effectiveAgentName = agentName || (timing.conversationType === 'bot' ? 'Myra' : '');
  const effectiveTranscript = timing.conversationType === 'bot'
    ? `[BOT-HANDLED CHAT — No human agent involved. Score Opening, Call, Empathy as NA unless the bot explicitly performed them.]\n\n${transcriptText}`
    : transcriptText;

  const config       = await readConfig();
  const provider     = config.llmProvider || 'gemini';
  const geminiKeys   = getIQSGeminiKeys(config);
  const anthropicKey = config.iqsAnthropicApiKey || config.anthropicApiKey;

  // ── Fetch relevant KB chunks to ground the Technical scoring parameter ──────
  let kbContext = '';
  try {
    const searchQuery = disposition
      ? `${disposition} ${subDisposition}`.trim()
      : extractQueryFromTranscript(transcriptText);

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
    console.warn('[webhook] KB fetch failed, scoring without context:', err.message);
  }

  const userPrompt = buildScoringPrompt(effectiveTranscript, disposition, chatId, '', kbContext, subDisposition, timing.conversationType);
  const iqsSystemPrompt = config.iqsScoringPrompt?.trim() || IQS_SYSTEM_PROMPT;

  let rawResponse: string;
  if (provider === 'claude' && anthropicKey) {
    const client = new Anthropic({ apiKey: anthropicKey });
    const resp = await client.messages.create({
      model: 'claude-sonnet-4-6', max_tokens: 2000,
      system: iqsSystemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });
    rawResponse = resp.content[0].type === 'text' ? resp.content[0].text : '';
  } else if (geminiKeys.length) {
    rawResponse = await geminiGenerate(
      geminiKeys, 'gemini-2.5-flash',
      [{ role: 'user', parts: [{ text: iqsSystemPrompt + '\n\n' + userPrompt }] }],
      {}, 60000,
    );
  } else {
    throw new Error('No LLM API key configured');
  }

  const parsed = parseScoringResponse(rawResponse, chatId, timing.conversationType);
  const modelVersion = provider === 'claude' ? 'claude-sonnet-4-6' : 'gemini-2.5-flash';

  // Convert ParamScore → IQSParameterResult for PostgreSQL storage
  const parameters: Record<string, IQSParameterResult> = {};
  for (const [key, val] of Object.entries(parsed.scores || {})) {
    parameters[key] = toParamResult(val as ParamScore, (parsed.reasoning || {})[key] || '');
  }

  await insertIQSScore({
    chatId,
    iqsScore: parsed.iqs,
    parameters,
    modelVersion,
    uncertainParameters: parsed.uncertainParameters,
  });

  // Update timing on conversation row
  await upsertConversation({
    id: chatId,
    conversationType: timing.conversationType,
    frtSeconds: timing.frt ?? null,
    botToTeamSeconds: timing.botToTeamSecs ?? null,
    resolutionSeconds: timing.resolutionTime ?? null,
  });

  const finalAgentName = effectiveAgentName || (parsed as any).extractedAgentName || '';
  console.log(`[webhook] Scored chat ${chatId} → IQS ${parsed.iqs}% (${finalAgentName || 'unknown'}) type=${timing.conversationType}${timing.conversationType === 'bot' ? ' [bot-handled]' : ''}`);

  // ── Slack + Sheet alert — deduplicated via KV ─────────────────────────────────────────
  fireQualityAlert({
    chatId,
    agentName:           finalAgentName,
    contactPhone,
    scores:              parsed.scores    as Record<string, string>,
    reasoning:           parsed.reasoning as Record<string, string>,
    iqs:                 parsed.iqs,
    disposition,
    subDisposition,
    uncertainParameters: parsed.uncertainParameters,
  }).catch(() => {});

  return { chatId, iqs: parsed.iqs };
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

  // Extract mobile/phone number
  const mobileNumber: string | undefined =
    body.data?.user_phone      || body.data?.customer_phone ||
    body.data?.phone_number    || body.data?.mobile         ||
    body.user_phone            || body.customer_phone       ||
    body.phone_number          || body.mobile               || undefined;

  // Extract assignment timestamp (FRT start)
  // Robylon sends either "assigned by <agent>" or "Auto-Assigned chat to <agent>"
  let transferTimestamp: string | undefined;
  for (const m of rawMessages) {
    const content = (m.content || m.text || '').trim().toLowerCase();
    if ((content.includes('assigned by') || content.includes('auto-assigned')) && m.timestamp) {
      transferTimestamp = parseRobyTimestamp(m.timestamp, year) || undefined;
      break;
    }
  }

  // Build timedMessages and filtered transcript array for storage
  const timedMessages: TimedMessage[] = [];
  const transcriptForStorage: any[] = [];

  for (const m of rawMessages) {
    const sender  = (m.sender || m.role || '').trim();
    const content = (m.content || m.text || '').trim();
    if (!content) continue;
    const low = content.toLowerCase();
    if (low.includes('auto-assigned') || low.includes('assigned by') ||
        low.includes('waiting to assign') || low.includes('please rate your experience') ||
        m.buttons) continue;

    const isoTs = m.timestamp ? parseRobyTimestamp(m.timestamp, year) : undefined;
    const senderLow = sender.toLowerCase();
    const senderType = senderLow === 'user' || senderLow === 'customer' ? 'customer'
                     : senderLow === 'bot' || senderLow === 'myra' ? 'bot'
                     : 'agent';

    timedMessages.push({ sender, content, timestamp: isoTs });
    transcriptForStorage.push({
      sender_type: senderType,
      sender_name: sender,
      content,
      timestamp: isoTs,
    });
  }

  const transcriptText = messagesToTranscript(rawMessages);
  if (!transcriptText) {
    return NextResponse.json({ ok: true, scored: false, reason: 'Transcript empty after filtering' });
  }

  // Compute timing now for immediate storage
  const timing = timedMessages.length
    ? analyzeConversationTiming(timedMessages, convEnded, transferTimestamp)
    : { conversationType: 'agent' as const, frt: undefined, botToTeamSecs: undefined, resolutionTime: undefined, closureTime: undefined };

  // Bot-handled conversations are attributed to Myra (the AI bot)
  const effectiveWebhookAgent = agentName || (timing.conversationType === 'bot' ? 'Myra' : '');

  // Upsert contact + agent
  const [contactId, agentId] = await Promise.all([
    upsertContact(mobileNumber),
    upsertAgent(effectiveWebhookAgent),
  ]);

  // Persist conversation to PostgreSQL
  await upsertConversation({
    id: chatId,
    contactId,
    agentId,
    conversationType: timing.conversationType,
    startedAt: convStarted || undefined,
    closedAt: convEnded || undefined,
    transcript: transcriptForStorage,
    frtSeconds: timing.frt ?? null,
    botToTeamSeconds: timing.botToTeamSecs ?? null,
    resolutionSeconds: timing.resolutionTime ?? null,
    rawPayload: body,
    webhookTrigger: 'TICKET_CLOSED',
  });

  // Check if tags already stored (from a prior CLASSIFICATION_UPDATED)
  const existingConv = await getConversation(chatId);
  const hasTags = !!(existingConv?.tags);
  const config = await readConfig();

  const disposition    = hasTags ? (existingConv!.tags as any)?.disposition    || '' : '';
  const subDisposition = hasTags ? (existingConv!.tags as any)?.sub_disposition || '' : '';

  // Always: link any pending_link calls for this contact to this chat (now that we have chatId + closedAt).
  // Score them in parallel with chat scoring if tags are already available.
  if (contactId && convEnded) {
    const callLinkPromise = linkAndScoreCallsForChat(
      chatId,
      contactId,
      convEnded,
      transcriptText,
      disposition,
      subDisposition,
      config,
    );

    if (hasTags && existingConv) {
      const [scoredResult] = await Promise.allSettled([
        executeScoring(existingConv, effectiveWebhookAgent, disposition, subDisposition, mobileNumber),
        callLinkPromise,
      ]);
      const scored = scoredResult.status === 'fulfilled' ? scoredResult.value : null;
      if (scored) {
        return NextResponse.json({
          ok: true, chat_id: chatId, iqs: scored.iqs, agent: effectiveWebhookAgent,
          conversation_type: timing.conversationType,
          frt_secs: timing.frt, b_to_t_secs: timing.botToTeamSecs,
          resolution_secs: timing.resolutionTime,
        });
      }
    } else {
      // No tags yet — link calls now; scoring fires at CLASSIFICATION_UPDATED
      callLinkPromise.catch(err => console.error('[webhook] Call link error:', err));
    }
  } else if (hasTags && existingConv) {
    const scored = await executeScoring(existingConv, effectiveWebhookAgent, disposition, subDisposition, mobileNumber);
    if (scored) {
      return NextResponse.json({
        ok: true, chat_id: chatId, iqs: scored.iqs, agent: effectiveWebhookAgent,
        conversation_type: timing.conversationType,
        frt_secs: timing.frt, b_to_t_secs: timing.botToTeamSecs,
        resolution_secs: timing.resolutionTime,
      });
    }
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

  // Upsert conversation with tags (will create row if not yet present)
  await upsertConversation({
    id: chatId,
    tags: { disposition, sub_disposition: subDisposition },
    webhookTrigger: 'CLASSIFICATION_UPDATED',
  });

  // Also call updateConversationTags for clarity
  await updateConversationTags(chatId, { disposition, sub_disposition: subDisposition });

  // Check if transcript already stored and not yet scored
  const conv = await getConversation(chatId);
  const alreadyScored = await isScored(chatId);

  if (conv?.transcript && !alreadyScored) {
    const agentId = conv.agent_id;
    const agentName = agentId
      ? (await import('@/lib/robylon/db').then(m => m.getAgentName(agentId)))
      : '';

    // Build chat transcript text for call scoring context
    let chatTranscriptText = '';
    const transcriptMessages = Array.isArray(conv.transcript) ? conv.transcript
      : Array.isArray((conv.transcript as any)?.messages) ? (conv.transcript as any).messages : [];
    chatTranscriptText = transcriptFromJsonb(transcriptMessages);

    const config = await readConfig();
    const [scoredResult] = await Promise.allSettled([
      executeScoring(conv, agentName, disposition, subDisposition),
      scoreLinkedCallsForChat(chatId, chatTranscriptText, disposition, subDisposition, config),
    ]);

    const scored = scoredResult.status === 'fulfilled' ? scoredResult.value : null;
    if (scored) {
      return NextResponse.json({
        ok: true, chat_id: chatId, iqs: scored.iqs,
        disposition, subDisposition,
      });
    }
  }

  console.log(`[webhook] Tags stored for chat ${chatId}: ${disposition} > ${subDisposition}${conv?.transcript ? ' — waiting for scoring' : ' — waiting for transcript'}`);
  return NextResponse.json({ ok: true, event: 'tags_stored', chat_id: chatId, disposition, subDisposition, waiting: conv?.transcript ? 'scoring' : 'transcript' });
}

// ── Handler: CSAT_SUBMITTED — only updates conversation row, never triggers scoring ──
async function handleCsatEvent(body: any): Promise<NextResponse> {
  const chatId = String(body.chat_id || '');
  const rating  = body.data?.rating;
  if (!rating) {
    return NextResponse.json({ ok: true, reason: 'No rating in CSAT event' });
  }

  const normalised = normaliseCsat(String(rating));
  if (!normalised) {
    return NextResponse.json({ ok: true, reason: `Unrecognised rating value: ${rating}` });
  }

  await updateConversationCsat(chatId, normalised.score, normalised.label);
  console.log(`[webhook] CSAT updated for chat ${chatId}: ${normalised.score} (${normalised.label})`);
  return NextResponse.json({ ok: true, event: 'csat_updated', chat_id: chatId, csat: normalised.score });
}

// ── Handler: legacy flat payload (backward compat) ────────────────────────────────
async function handleLegacyPayload(body: any): Promise<NextResponse> {
  const {
    chat_id, conversation_id, agent_name,
    tags = '', csat, conversation_started, conversation_ended,
    channel = 'chat', messages, transcript: rawTranscript,
  } = body;

  let transcriptText = '';
  const timedMessages: TimedMessage[] = [];
  const transcriptForStorage: any[] = [];

  if (rawTranscript) {
    transcriptText = String(rawTranscript).trim();
  } else if (Array.isArray(messages) && messages.length) {
    transcriptText = messagesToTranscript(messages);
    for (const m of messages as RobyMessage[]) {
      const sender  = m.sender || m.role || '';
      const content = (m.content || m.text || '').trim();
      if (!content) continue;
      const low = content.toLowerCase();
      if (low.includes('auto-assigned') || low.includes('assigned by') ||
          low.includes('waiting to assign') || low.includes('please rate your experience') ||
          (m as any).buttons) continue;
      const senderLow = sender.toLowerCase();
      const senderType = senderLow === 'user' || senderLow === 'customer' ? 'customer'
                       : senderLow === 'bot' || senderLow === 'myra' ? 'bot'
                       : 'agent';
      timedMessages.push({ sender, content, timestamp: m.timestamp });
      transcriptForStorage.push({ sender_type: senderType, sender_name: sender, content, timestamp: m.timestamp });
    }
  }

  if (!transcriptText) {
    console.log('[webhook] No transcript extracted. received_keys:', Object.keys(body));
    return NextResponse.json({
      ok: true, scored: false,
      reason: 'No transcript extracted — raw payload logged for inspection',
      received_keys: Object.keys(body),
    });
  }

  const chatId = String(chat_id || conversation_id || `wh_${Date.now()}`);
  const channelPrefix = channel === 'call' ? '[CHANNEL: PHONE CALL]\n' : '';
  const finalTranscriptText = channelPrefix + transcriptText;

  const timing = timedMessages.length
    ? analyzeConversationTiming(timedMessages, conversation_ended)
    : { conversationType: 'agent' as const, frt: undefined, botToTeamSecs: undefined, resolutionTime: undefined, closureTime: undefined };

  const csatNorm = normaliseCsat(csat);
  const agentId = await upsertAgent(String(agent_name || ''));

  await upsertConversation({
    id: chatId,
    agentId,
    conversationType: timing.conversationType,
    startedAt: conversation_started || undefined,
    closedAt: conversation_ended || undefined,
    transcript: transcriptForStorage.length ? transcriptForStorage : [{ sender_type: 'agent', content: finalTranscriptText }],
    tags: tags ? { disposition: tags, sub_disposition: '' } : undefined,
    frtSeconds: timing.frt ?? null,
    botToTeamSeconds: timing.botToTeamSecs ?? null,
    resolutionSeconds: timing.resolutionTime ?? null,
    rawPayload: body,
    webhookTrigger: 'LEGACY',
  });

  if (csatNorm) {
    await updateConversationCsat(chatId, csatNorm.score, csatNorm.label);
  }

  if (!tags) {
    console.log(`[webhook] Legacy payload for chat ${chatId} parked — waiting for tags`);
    return NextResponse.json({ ok: true, event: 'transcript_stored', chat_id: chatId, waiting: 'waiting for tags' });
  }

  const conv = await getConversation(chatId);
  if (conv) {
    const scored = await executeScoring(conv, String(agent_name || ''), tags, '');
    if (scored) {
      return NextResponse.json({
        ok: true, chat_id: chatId, iqs: scored.iqs, agent: String(agent_name || ''),
        conversation_type: timing.conversationType,
        frt_secs: timing.frt, b_to_t_secs: timing.botToTeamSecs,
        resolution_secs: timing.resolutionTime,
      });
    }
  }

  return NextResponse.json({ ok: true, event: 'transcript_stored', chat_id: chatId, waiting: 'scoring' });
}

// ── MIME type from URL ────────────────────────────────────────────────────────────────
function mimeFromUrl(url: string): string {
  const u = url.toLowerCase().split('?')[0];
  if (u.endsWith('.mp3'))  return 'audio/mpeg';
  if (u.endsWith('.wav'))  return 'audio/wav';
  if (u.endsWith('.m4a'))  return 'audio/mp4';
  if (u.endsWith('.ogg'))  return 'audio/ogg';
  if (u.endsWith('.flac')) return 'audio/flac';
  return 'audio/mpeg';
}

// ── Handler: CC_VOICE_CALL_COMPLETE ────────────────────────────────────────────
async function handleCallComplete(body: any): Promise<NextResponse> {
  // In CC_VOICE_CALL_COMPLETE, body.chat_id is the CALL ID (Robylon's voice
  // ticket ID), NOT a WhatsApp chat ID. The real WhatsApp chat_id is only
  // known at TICKET_CLOSED, where we link via phone number.
  const callId       = String(body.chat_id);
  const phone        = body.requester_info?.phone_number || body.data?.phone_number || '';
  const recordingUrl = body.data?.recording_url || '';
  const calledAt     = body.data?.started_at || body.data?.ended_at || body.created_at || new Date().toISOString();
  const durationRaw  = body.data?.call_duration;
  const durationSeconds = durationRaw && durationRaw > 0 ? Math.round(durationRaw) : null;

  if (!recordingUrl) {
    console.warn(`[webhook] CC_VOICE_CALL_COMPLETE call_id=${callId} has no recording_url — skipping`);
    return NextResponse.json({ ok: true, skipped: true, reason: 'no recording_url' });
  }

  // Respond immediately — transcription is slow (10–30s), do it async
  const contactId = await upsertContact(phone);

  // Store a placeholder row now so the call is tracked even if transcription fails
  await insertCallRecording({
    id: callId,
    chatId: null,         // linked at TICKET_CLOSED via phone number
    agentId: null,        // agent name not available in this event
    contactId,
    recordingUrl,         // S3 URL stored permanently for reference / re-transcription
    durationSeconds,
    calledAt,
    language: null,
    transcript: [],
  });

  // Fire-and-forget: fetch audio → Gemini transcription → update DB
  (async () => {
    try {
      const config = await readConfig();
      const geminiKeys = getIQSGeminiKeys(config);
      if (!geminiKeys.length) {
        console.error(`[webhook] No Gemini key — cannot transcribe call ${callId}`);
        return;
      }

      // Fetch audio into memory (never written to disk)
      let audioBase64 = '';
      let mimeType = mimeFromUrl(recordingUrl);
      const audioRes = await fetch(recordingUrl);
      if (!audioRes.ok) throw new Error(`HTTP ${audioRes.status} fetching audio`);
      const ct = audioRes.headers.get('content-type');
      if (ct) mimeType = ct.split(';')[0].trim() || mimeType;
      audioBase64 = Buffer.from(await audioRes.arrayBuffer()).toString('base64');

      // Gemini multimodal: audio → English segments (translates non-English)
      const raw = await geminiGenerate(
        geminiKeys,
        'gemini-2.5-flash',
        [{ role: 'user', parts: [
          { inlineData: { mimeType, data: audioBase64 } },
          { text: CALL_TRANSCRIPTION_PROMPT },
        ]}],
        {},
        120_000,
      );

      const { language, segments } = parseTranscriptionResponse(raw);
      const interruptionCount = segments.filter(s => s.type === 'interruption').length;
      const deadAirCount      = segments.filter(s => s.type === 'dead_air').length;

      // Update the placeholder row with the real transcript
      await insertCallRecording({
        id: callId,
        chatId: null,
        agentId: null,
        contactId,
        recordingUrl,
        durationSeconds,
        calledAt,
        language,
        transcript: segments,
      });
      await updateCallRecordingMetrics({ id: callId, interruptionCount, deadAirCount, status: 'pending_link' });

      console.log(`[webhook] CC_VOICE_CALL_COMPLETE transcribed call ${callId} — ${segments.length} segments (${language}), phone=${phone}, status=pending_link`);
    } catch (err: any) {
      console.error(`[webhook] CC_VOICE_CALL_COMPLETE transcription failed for call ${callId}:`, err.message);
    }
  })();

  console.log(`[webhook] CC_VOICE_CALL_COMPLETE received call ${callId} — transcription started, phone=${phone}`);
  return NextResponse.json({ ok: true, event: 'call_received', call_id: callId, status: 'transcribing' });
}

// ── Main handler ───────────────────────────────────────────────────────────────────
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

  // Log only non-sensitive metadata — never dump full payload in production
  if (process.env.NODE_ENV !== 'production') {
    console.log('[webhook] Incoming payload:', JSON.stringify(body, null, 2));
  } else {
    console.log(`[webhook] Received event_type=${body.event_type || 'unknown'} chat_id=${body.chat_id || 'n/a'}`);
  }

  // Deduplicate by event_id — Robylon retries on timeout, both can arrive
  // before scoring finishes, resulting in two scores for the same chat.
  const eventId = String(body.event_id || '');
  if (eventId) {
    if (await storeHasProcessedEvent(eventId)) {
      console.log(`[webhook] Duplicate event_id ${eventId} — skipping`);
      return NextResponse.json({ ok: true, skipped: true, reason: 'duplicate_event_id' });
    }
    await storeMarkProcessedEvent(eventId);
  }

  const eventType = String(body.event_type || '');

  if (eventType === 'TICKET_CLOSED')           return handleTicketClosed(body);
  if (eventType === 'CLASSIFICATION_UPDATED')  return handleClassificationUpdated(body);
  if (eventType === 'CSAT_SUBMITTED')          return handleCsatEvent(body);
  if (eventType === 'CC_VOICE_CALL_COMPLETE')  return handleCallComplete(body);
  return handleLegacyPayload(body);
}
