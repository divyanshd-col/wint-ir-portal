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
import { waitUntil } from '@vercel/functions';
import { readConfig } from '@/lib/config';
import { callGeminiForCall, getIQSGeminiKeys, fetchAndTranscribeAudio } from '@/lib/gemini';
import {
  CALL_TRANSCRIPTION_PROMPT,
  CALL_DISPOSITION_CLASSIFY_PROMPT,
  parseTranscriptionResponse,
  parseCallDispositionClassified,
  segmentsToText,
} from '@/lib/call-quality';
import {
  upsertAgent,
  upsertContact,
  upsertConversation,
  updateConversationCsat,
  updateConversationTags,
  getConversation,
  isScored,
  getUnlinkedCallsForContact,
  linkCallToChat,
  insertCallRecording,
  updateCallRecordingMetrics,
  updateCallDisposition,
} from '@/lib/robylon/db';
import { storeHasProcessedEvent, storeMarkProcessedEvent } from '@/lib/store';
import { query } from '@/lib/cx/db';
import { executeScoring, scoreLinkedCallsForChat } from '@/lib/scoring/engine';
import {
  messagesToTranscript,
  transcriptFromJsonb,
  parseRobyTimestamp,
  extractAgentName,
  normalizeRobylonMessages,
  type RobyMessage,
} from '@/lib/scoring/transcript';
import { analyzeConversationTiming, type TimedMessage } from '@/lib/quality';

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

// ── CSAT normalisation ────────────────────────────────────────────────────────
function normaliseCsat(raw: string | undefined): { score: number; label: string } | null {
  if (!raw) return null;
  const v = String(raw).trim().toLowerCase();
  if (v === 'good'             || v === '5') return { score: 5, label: 'good' };
  if (v === 'could be better'  || v === 'ok' || v === 'okay' || v === '3') return { score: 3, label: 'could_be_better' };
  if (v === 'bad'              || v === '1') return { score: 1, label: 'bad' };
  return null;
}

// ── Link unscored calls to a chat, then score them if disposition is known ────
async function linkAndScoreCallsForChat(
  chatId: string,
  contactId: number,
  startedAt: string,
  closedAt: string,
  chatTranscriptText: string,
  disposition: string,
  subDisposition: string,
  config: any,
): Promise<void> {
  const unlinked = await getUnlinkedCallsForContact(contactId, startedAt, closedAt);
  if (!unlinked.length) return;

  await Promise.all(unlinked.map(c => linkCallToChat(c.id, chatId)));
  console.log(`[webhook] Linked ${unlinked.length} call(s) to chat ${chatId}`);

  if (disposition) {
    await scoreLinkedCallsForChat(chatId, chatTranscriptText, disposition, subDisposition, config);
  }
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
  const convEnded   = transcriptObj.conversation_ended || body.data?.closed_at || body.data?.ended_at || body.created_at || new Date().toISOString();
  const chatId      = String(body.chat_id || transcriptObj.chat_id || `wh_${Date.now()}`);
  const year        = convStarted ? new Date(convStarted).getUTCFullYear() : new Date().getUTCFullYear();
  const agentName   = extractAgentName(rawMessages);

  // Extract mobile/phone number — check all known Robylon field locations
  const mobileNumber: string | undefined =
    body.data?.requester_info?.phone_number ||
    body.requester_info?.phone_number       ||
    transcriptObj?.requester_info?.phone_number ||
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

  // Build timedMessages and filtered transcript array for storage using the unified normalizer
  const { transcriptText, timedMessages, transcriptForStorage } = normalizeRobylonMessages(rawMessages, year);

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
      convStarted,
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

  console.log(`[webhook][CLASSIFICATION_UPDATED] chat=${chatId} count=${classifications.length}`);

  // Sort by level_number desc to pick the most specific classification (l2 > l1)
  const primary = [...classifications].sort((a, b) => (b.level_number ?? 0) - (a.level_number ?? 0))[0];
  if (!primary) {
    console.log(`[webhook][CLASSIFICATION_UPDATED] chat=${chatId} — no classifications in payload, skipping tags`);
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
  let timedMessages: TimedMessage[] = [];
  let transcriptForStorage: any[] = [];

  if (rawTranscript) {
    transcriptText = String(rawTranscript).trim();
    transcriptForStorage = [{ sender_type: 'agent', content: transcriptText }];
  } else if (Array.isArray(messages) && messages.length) {
    const norm = normalizeRobylonMessages(messages);
    transcriptText = norm.transcriptText;
    timedMessages = norm.timedMessages;
    transcriptForStorage = norm.transcriptForStorage;
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

  // Derive duration: prefer call_duration field, fall back to ended_at − started_at
  let durationSeconds: number | null = null;
  if (body.data?.call_duration > 0) {
    durationSeconds = Math.round(body.data.call_duration);
  } else if (body.data?.started_at && body.data?.ended_at) {
    const diff = Math.round((new Date(body.data.ended_at).getTime() - new Date(body.data.started_at).getTime()) / 1000);
    if (diff > 0) durationSeconds = diff;
  }

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
    transcript: null,
  });

  // Keep the function alive after responding so Vercel doesn't kill the background work
  waitUntil((async () => {
    try {
      const config = await readConfig();
      const geminiKeys = getIQSGeminiKeys(config);
      if (!geminiKeys.length) {
        console.error(`[webhook] No Gemini key — cannot transcribe call ${callId}`);
        return;
      }

      const { language, segments } = await fetchAndTranscribeAudio(recordingUrl, geminiKeys);
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

      // ── Step 4: Classify disposition (constrained to official 14-category list) ──
      const callTranscriptText = segmentsToText(segments);
      let disposition = '';
      let subDisposition = '';
      if (callTranscriptText) {
        try {
          const rawDisp = await callGeminiForCall(
            geminiKeys,
            [{ role: 'user', parts: [{ text: CALL_DISPOSITION_CLASSIFY_PROMPT + '\n\n## CALL TRANSCRIPT\n' + callTranscriptText }] }],
            undefined,
            30_000,
          );
          const classified = parseCallDispositionClassified(rawDisp);
          disposition    = classified.disposition;
          subDisposition = classified.subDisposition;
        } catch (err: any) {
          console.error(`[webhook] Disposition classify failed for call ${callId}:`, err.message);
        }

        // ── Step 5: Store disposition ───────────────────────────────────────────
        if (disposition) {
          try {
            await updateCallDisposition(callId, disposition, subDisposition);
            console.log(`[webhook] Call ${callId} classified — ${disposition} > ${subDisposition}`);
          } catch (err: any) {
            console.error(`[webhook] Failed to store disposition for call ${callId}:`, err.message);
          }
        }

        // ── Step 6: Chunking removed ─────────────────────────────────────────
      }
    } catch (err: any) {
      console.error(`[webhook] CC_VOICE_CALL_COMPLETE transcription failed for call ${callId}:`, err.message);
      try {
        await query(`UPDATE call_recordings SET transcript = NULL, status = 'failed' WHERE id = $1`, [callId]);
      } catch (dbErr: any) {
        console.error(`[webhook] Failed to update failed call status for ${callId}:`, dbErr.message);
      }
    }
  })());

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

  const eventType = String(body.event_type || '');

  // Deduplicate by event_type + event_id — Robylon retries on timeout, both can arrive
  // before scoring finishes, resulting in two scores for the same chat.
  // IMPORTANT: include eventType in the key — Robylon may send the same event_id for
  // TICKET_CLOSED and CLASSIFICATION_UPDATED of the same ticket, and without the type
  // prefix the second event would be silently dropped as a duplicate.
  const eventId = String(body.event_id || '');
  if (eventId) {
    const dedupKey = eventType ? `${eventType}:${eventId}` : eventId;
    if (await storeHasProcessedEvent(dedupKey)) {
      console.log(`[webhook] Duplicate ${dedupKey} — skipping`);
      return NextResponse.json({ ok: true, skipped: true, reason: 'duplicate_event_id' });
    }
    await storeMarkProcessedEvent(dedupKey);
  }

  if (eventType === 'TICKET_CLOSED')           return handleTicketClosed(body);
  if (eventType === 'CLASSIFICATION_UPDATED')  return handleClassificationUpdated(body);
  if (eventType === 'CSAT_SUBMITTED')          return handleCsatEvent(body);
  if (eventType === 'CC_VOICE_CALL_COMPLETE')  return handleCallComplete(body);
  return handleLegacyPayload(body);
}
