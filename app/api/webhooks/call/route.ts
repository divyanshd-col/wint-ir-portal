/**
 * POST /api/webhooks/call
 *
 * Receives call recording webhooks from the telephony system.
 * Expected payload:
 *   { call_id, chat_id?, recording_url, agent_name?, duration_seconds?, called_at?, customer_phone? }
 *
 * Processing steps (async after 202 response):
 *   Step 1 — Transcribe: fetch audio → Gemini multimodal → segment JSON → INSERT call_recordings
 *   Step 2 — Metrics: count interruptions/dead_air → UPDATE call_recordings, fetch KB chunks
 *   Step 3 — Dual scoring (parallel):
 *     2a. Chat IQS: re-score the linked chat via existing executeScoring (if chat_id provided)
 *     2b. Call IQS: score call segments → INSERT call_iqs_scores
 *
 * Auth: Authorization: Bearer <WEBHOOK_SECRET>  OR  ?secret=<WEBHOOK_SECRET>
 */

import { NextRequest, NextResponse } from 'next/server';
import { readConfig } from '@/lib/config';
import { geminiGenerate, getIQSGeminiKeys } from '@/lib/gemini';
import { fetchKnowledgeChunks, retrieveRelevantChunks } from '@/lib/drive';
import {
  CALL_TRANSCRIPTION_PROMPT,
  CALL_IQS_SYSTEM_PROMPT,
  buildCallScoringPrompt,
  parseTranscriptionResponse,
  parseCallScoringResponse,
  segmentsToText,
} from '@/lib/call-quality';
import type { CallParamScore } from '@/lib/call-quality';
import {
  storeHasProcessedEvent,
  storeMarkProcessedEvent,
  storeAcquireScoringLock,
} from '@/lib/store';
import {
  upsertAgent,
  upsertContact,
  getConversation,
  insertCallRecording,
  updateCallRecordingMetrics,
  insertCallIQSScore,
  type IQSParameterResult,
} from '@/lib/robylon/db';
import {
  IQS_SYSTEM_PROMPT,
  buildScoringPrompt,
  parseScoringResponse,
} from '@/lib/quality';
import type { ParamScore } from '@/lib/quality';
import { hasCallInteraction, fireQualityAlert } from '@/lib/quality-alert';
import Anthropic from '@anthropic-ai/sdk';

// ── Auth ──────────────────────────────────────────────────────────────────────
function isAuthorised(req: NextRequest): boolean {
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret) return true; // dev mode — no secret set
  const header = req.headers.get('authorization') ?? '';
  if (header === `Bearer ${secret}`) return true;
  const url = new URL(req.url);
  if (url.searchParams.get('secret') === secret) return true;
  return false;
}

// ── Convert ParamScore → IQSParameterResult ───────────────────────────────────
function toParamResult(score: string, reasoning: string): IQSParameterResult {
  return {
    score: score === 'Yes' ? true : score === 'No' ? false : null,
    reasoning,
  };
}

// ── Determine MIME type from URL ──────────────────────────────────────────────
function mimeFromUrl(url: string): string {
  const u = url.toLowerCase().split('?')[0];
  if (u.endsWith('.mp3'))  return 'audio/mpeg';
  if (u.endsWith('.wav'))  return 'audio/wav';
  if (u.endsWith('.m4a'))  return 'audio/mp4';
  if (u.endsWith('.ogg'))  return 'audio/ogg';
  if (u.endsWith('.flac')) return 'audio/flac';
  return 'audio/mpeg'; // default — most telephony providers use MP3
}

// ── Re-score the linked chat (LLM Call #2a) ───────────────────────────────────
async function rescoreChatIQS(
  chatId: string,
  config: any,
): Promise<{ iqs: number } | null> {
  const conv = await getConversation(chatId);
  if (!conv?.transcript) return null;

  let transcriptMessages: any[] = [];
  if (Array.isArray(conv.transcript)) {
    transcriptMessages = conv.transcript;
  } else if (Array.isArray((conv.transcript as any).messages)) {
    transcriptMessages = (conv.transcript as any).messages;
  }
  if (!transcriptMessages.length) return null;

  const lines: string[] = [];
  for (const m of transcriptMessages) {
    const role = m.sender_type === 'customer' ? 'Customer'
               : m.sender_type === 'bot'      ? 'Bot'
               : 'Agent';
    const content = (m.content || '').trim();
    if (content) lines.push(`${role}: ${content}`);
  }
  const transcriptText = lines.join('\n');
  if (!transcriptText) return null;

  if (hasCallInteraction(transcriptText, conv.tags)) return null;

  const disposition    = (conv.tags as any)?.disposition    || '';
  const subDisposition = (conv.tags as any)?.sub_disposition || '';

  let kbContext = '';
  try {
    const allChunks = await fetchKnowledgeChunks();
    const relevant  = retrieveRelevantChunks(allChunks, `${disposition} ${subDisposition}`.trim() || transcriptText.slice(0, 100), 5);
    if (relevant.length) kbContext = relevant.map(c => `[${c.fileName}]\n${c.content}`).join('\n---\n');
  } catch {}

  const userPrompt = buildScoringPrompt(transcriptText, disposition, chatId, '', kbContext, subDisposition);
  const iqsSystemPrompt = config.iqsScoringPrompt?.trim() || IQS_SYSTEM_PROMPT;
  const provider = config.llmProvider || 'gemini';
  const geminiKeys = getIQSGeminiKeys(config);
  const anthropicKey = config.iqsAnthropicApiKey || config.anthropicApiKey;

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
    return null;
  }

  const parsed = parseScoringResponse(rawResponse, chatId);
  const { insertIQSScore } = await import('@/lib/robylon/db');
  const parameters: Record<string, IQSParameterResult> = {};
  for (const [key, val] of Object.entries(parsed.scores || {})) {
    parameters[key] = toParamResult(val as ParamScore, (parsed.reasoning || {})[key] || '');
  }
  await insertIQSScore({ chatId, iqsScore: parsed.iqs, parameters, modelVersion: provider === 'claude' ? 'claude-sonnet-4-6' : 'gemini-2.5-flash' });
  return { iqs: parsed.iqs };
}

// ── Main async processing ─────────────────────────────────────────────────────
async function processCallWebhook(body: any): Promise<void> {
  const callId   = String(body.call_id || `call_${Date.now()}`);
  const chatId   = body.chat_id ? String(body.chat_id) : null;
  const recordingUrl = body.recording_url || body.recording_link || '';
  const agentName = String(body.agent_name || '');
  const durationSeconds = body.duration_seconds ? Number(body.duration_seconds) : null;
  const calledAt  = body.called_at || body.timestamp || new Date().toISOString();
  const customerPhone = body.customer_phone || body.phone || undefined;

  if (!recordingUrl) {
    console.warn(`[call-webhook] call_id=${callId} has no recording_url — skipping`);
    return;
  }

  // ── Upsert agent + contact ──────────────────────────────────────────────────
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
    const buffer = await audioRes.arrayBuffer();
    audioBase64 = Buffer.from(buffer).toString('base64');
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
      'gemini-2.5-flash',
      [{
        role: 'user',
        parts: [
          { inlineData: { mimeType, data: audioBase64 } },
          { text: CALL_TRANSCRIPTION_PROMPT },
        ],
      }],
      {},
      120000, // 2 min timeout for audio transcription
    );
  } catch (err: any) {
    console.error(`[call-webhook] Transcription failed for call ${callId}:`, err.message);
    return;
  }

  const { language, segments } = parseTranscriptionResponse(transcriptionRaw);
  console.log(`[call-webhook] Transcribed call ${callId} → ${segments.length} segments (${language})`);

  // INSERT call_recordings row (Step 1 complete)
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

  // ── STEP 2: Derive metrics + prep scoring ──────────────────────────────────
  const interruptionCount = segments.filter(s => s.type === 'interruption').length;
  const deadAirCount      = segments.filter(s => s.type === 'dead_air').length;

  await updateCallRecordingMetrics({
    id: callId,
    interruptionCount,
    deadAirCount,
    status: 'scoring',
  });

  // Fetch KB chunks for scoring context
  let kbContext = '';
  try {
    const allChunks = await fetchKnowledgeChunks();
    const relevant  = retrieveRelevantChunks(allChunks, segmentsToText(segments).slice(0, 200), 5);
    if (relevant.length) kbContext = relevant.map(c => `[${c.fileName}]\n${c.content}`).join('\n---\n');
  } catch {}

  // Acquire scoring lock (prevent duplicate scoring if webhook fires twice)
  const lockKey = `call_${callId}`;
  const acquired = await storeAcquireScoringLock(lockKey);
  if (!acquired) {
    console.log(`[call-webhook] Scoring lock held for call ${callId} — skipping`);
    return;
  }

  // ── STEP 3: Dual scoring in parallel ──────────────────────────────────────
  const transcriptText = segmentsToText(segments);
  const callScoringPrompt = buildCallScoringPrompt(transcriptText, callId, interruptionCount, deadAirCount, kbContext);
  const callScoringContent = [{ role: 'user', parts: [{ text: CALL_IQS_SYSTEM_PROMPT + '\n\n' + callScoringPrompt }] }];

  const [chatResult, callRaw] = await Promise.allSettled([
    chatId ? rescoreChatIQS(chatId, config) : Promise.resolve(null),
    geminiGenerate(geminiKeys, 'gemini-2.5-flash', callScoringContent, {}, 60000),
  ]);

  if (chatResult.status === 'fulfilled' && chatResult.value) {
    console.log(`[call-webhook] Re-scored chat ${chatId} → IQS ${chatResult.value.iqs}`);
  } else if (chatResult.status === 'rejected') {
    console.warn(`[call-webhook] Chat IQS re-score failed:`, (chatResult as any).reason?.message);
  }

  if (callRaw.status === 'rejected') {
    console.error(`[call-webhook] Call IQS scoring failed for ${callId}:`, (callRaw as any).reason?.message);
    return;
  }

  const { scores, reasoning, iqs, summary } = parseCallScoringResponse(
    callRaw.value,
    interruptionCount,
    deadAirCount,
  );

  const parameters: Record<string, IQSParameterResult> = {};
  for (const [key, val] of Object.entries(scores)) {
    parameters[key] = toParamResult(val as CallParamScore, reasoning[key] || '');
  }

  await insertCallIQSScore({
    callId,
    iqsScore: iqs,
    parameters,
    modelVersion: 'gemini-2.5-flash',
  });

  console.log(`[call-webhook] Scored call ${callId} → IQS ${iqs} (${agentName || 'unknown'}) interruptions=${interruptionCount} dead_air=${deadAirCount}`);
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

  // Dedup — same event_id check as chat webhook
  const eventId = body.event_id || callId;
  if (await storeHasProcessedEvent(`call_${eventId}`)) {
    console.log(`[call-webhook] Duplicate event ${eventId} — skipped`);
    return NextResponse.json({ ok: true, duplicate: true });
  }
  await storeMarkProcessedEvent(`call_${eventId}`);

  // Fire-and-forget async processing — return 202 immediately
  processCallWebhook(body).catch(err =>
    console.error(`[call-webhook] processCallWebhook error for ${callId}:`, err),
  );

  return NextResponse.json({ ok: true, call_id: callId, status: 'processing' }, { status: 202 });
}
