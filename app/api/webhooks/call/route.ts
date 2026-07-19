/**
 * POST /api/webhooks/call
 *
 * Receives call recording webhooks (e.g. CC_VOICE_CALL_COMPLETE from Robylon).
 * Expected payload:
 *   { call_id, chat_id?, recording_url, agent_name?, duration_seconds?, called_at?, customer_phone? }
 *
 * Processing (fire-and-forget after 202):
 *   1. Fetch audio → Gemini multimodal transcription → INSERT call_recordings (status='pending_link')
 *   2. Count interruptions/dead_air → UPDATE call_recordings metrics
 *
 * Scoring does NOT happen here. It fires from the chat webhook when TICKET_CLOSED
 * links this call to a chat and both transcript + disposition are available.
 *
 * Auth: Authorization: Bearer <WEBHOOK_SECRET>  OR  ?secret=<WEBHOOK_SECRET>
 */

import { NextRequest, NextResponse } from 'next/server';
import { readConfig } from '@/lib/config';
import { geminiGenerate, getIQSGeminiKeys } from '@/lib/gemini';
import {
  CALL_TRANSCRIPTION_PROMPT,
  parseTranscriptionResponse,
} from '@/lib/call-quality';
import {
  storeHasProcessedEvent,
  storeMarkProcessedEvent,
} from '@/lib/store';
import {
  upsertAgent,
  upsertContact,
  insertCallRecording,
  updateCallRecordingMetrics,
  findClosedConversationForCall,
  linkCallToChat,
} from '@/lib/robylon/db';

// ── Auth ──────────────────────────────────────────────────────────────────────
function isAuthorised(req: NextRequest): boolean {
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret) return true;
  const header = req.headers.get('authorization') ?? '';
  if (header === `Bearer ${secret}`) return true;
  const url = new URL(req.url);
  if (url.searchParams.get('secret') === secret) return true;
  return false;
}

// ── Determine MIME type from URL ──────────────────────────────────────────────
function mimeFromUrl(url: string): string {
  const u = url.toLowerCase().split('?')[0];
  if (u.endsWith('.mp3'))  return 'audio/mpeg';
  if (u.endsWith('.wav'))  return 'audio/wav';
  if (u.endsWith('.m4a'))  return 'audio/mp4';
  if (u.endsWith('.ogg'))  return 'audio/ogg';
  if (u.endsWith('.flac')) return 'audio/flac';
  return 'audio/mpeg';
}

// ── Main async processing ─────────────────────────────────────────────────────
async function processCallWebhook(body: any): Promise<void> {
  const callId        = String(body.call_id || `call_${Date.now()}`);
  const chatId        = body.chat_id ? String(body.chat_id) : null;
  const recordingUrl  = body.recording_url || body.recording_link || '';
  const agentName     = String(body.agent_name || '');
  const durationSeconds = body.duration_seconds ? Number(body.duration_seconds) : null;
  const calledAt      = body.called_at || body.timestamp || new Date().toISOString();
  const customerPhone = body.customer_phone || body.phone || undefined;

  if (!recordingUrl) {
    console.warn(`[call-webhook] call_id=${callId} has no recording_url — skipping`);
    return;
  }

  const [agentId, contactId] = await Promise.all([
    upsertAgent(agentName),
    upsertContact(customerPhone),
  ]);

  // ── STEP 1: Fetch audio → Gemini transcription ─────────────────────────────
  let audioBase64 = '';
  let mimeType = mimeFromUrl(recordingUrl);
  try {
    const audioRes = await fetch(recordingUrl);
    if (!audioRes.ok) throw new Error(`HTTP ${audioRes.status}`);
    const contentType = audioRes.headers.get('content-type');
    if (contentType) mimeType = contentType.split(';')[0].trim() || mimeType;
    audioBase64 = Buffer.from(await audioRes.arrayBuffer()).toString('base64');
  } catch (err: any) {
    console.error(`[call-webhook] Failed to fetch audio for call ${callId}:`, err.message);
    return;
  }

  const config = await readConfig();
  const geminiKeys = getIQSGeminiKeys(config);
  if (!geminiKeys.length) {
    console.error('[call-webhook] No Gemini API key configured — cannot transcribe');
    return;
  }

  let transcriptionRaw = '';
  try {
    transcriptionRaw = await geminiGenerate(
      geminiKeys,
      'gemini-3.5-flash',
      [{
        role: 'user',
        parts: [
          { inlineData: { mimeType, data: audioBase64 } },
          { text: CALL_TRANSCRIPTION_PROMPT },
        ],
      }],
      {},
      120_000,
    );
  } catch (err: any) {
    console.error(`[call-webhook] Transcription failed for call ${callId}:`, err.message);
    return;
  }

  const { language, segments } = parseTranscriptionResponse(transcriptionRaw);
  console.log(`[call-webhook] Transcribed call ${callId} → ${segments.length} segments (${language})`);

  await insertCallRecording({
    id: callId,
    chatId,
    agentId,
    contactId,
    recordingUrl,
    durationSeconds,
    calledAt,
    language,
    transcript: segments,
  });

  // ── STEP 2: Derive metrics, advance status to pending_link ─────────────────
  const interruptionCount = segments.filter(s => s.type === 'interruption').length;
  const deadAirCount      = segments.filter(s => s.type === 'dead_air').length;

  // If no chatId from payload, check if the ticket already closed while transcription
  // was in progress (race condition: TICKET_CLOSED fires before call recording exists).
  let resolvedChatId = chatId;
  if (!resolvedChatId && contactId) {
    const conv = await findClosedConversationForCall(contactId, calledAt);
    if (conv) {
      resolvedChatId = conv.id;
      await linkCallToChat(callId, resolvedChatId);
      console.log(`[call-webhook] Late-linked call ${callId} → chat ${resolvedChatId} (ticket closed during transcription)`);
    }
  }

  await updateCallRecordingMetrics({
    id: callId,
    interruptionCount,
    deadAirCount,
    status: resolvedChatId ? 'linked' : 'pending_link',
  });

  console.log(`[call-webhook] Stored call ${callId} — interruptions=${interruptionCount} dead_air=${deadAirCount} status=${resolvedChatId ? 'linked' : 'pending_link'}`);
  // Scoring fires from the chat webhook at TICKET_CLOSED / CLASSIFICATION_UPDATED.
}

// ── Route handler ─────────────────────────────────────────────────────────────
export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!isAuthorised(req)) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const callId = String(body.call_id || '');
  if (!callId) {
    return NextResponse.json({ error: 'call_id required' }, { status: 400 });
  }

  const eventId = body.event_id || callId;
  if (await storeHasProcessedEvent(`call_${eventId}`)) {
    console.log(`[call-webhook] Duplicate event ${eventId} — skipped`);
    return NextResponse.json({ ok: true, duplicate: true });
  }
  await storeMarkProcessedEvent(`call_${eventId}`);

  processCallWebhook(body).catch(err =>
    console.error(`[call-webhook] processCallWebhook error for ${callId}:`, err),
  );

  return NextResponse.json({ ok: true, call_id: callId, status: 'processing' }, { status: 202 });
}
