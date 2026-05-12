import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { readConfig } from '@/lib/config';
import { geminiGenerate, getIQSGeminiKeys } from '@/lib/gemini';
import { CALL_TRANSCRIPTION_PROMPT, parseTranscriptionResponse } from '@/lib/call-quality';
import { upsertContact, insertCallRecording, updateCallRecordingMetrics } from '@/lib/robylon/db';

function mimeFromUrl(url: string): string {
  const ext = url.split('?')[0].split('.').pop()?.toLowerCase();
  if (ext === 'mp3') return 'audio/mpeg';
  if (ext === 'wav') return 'audio/wav';
  if (ext === 'ogg') return 'audio/ogg';
  if (ext === 'webm') return 'audio/webm';
  if (ext === 'm4a') return 'audio/mp4';
  return 'audio/mpeg';
}

/**
 * POST /api/admin/retranscribe-call
 * Manually triggers transcription for a call recording URL.
 * Use this to re-process calls that failed before migration 005 was applied.
 *
 * Body: { callId, recordingUrl, phone?, calledAt?, durationSeconds? }
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as any).role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const { callId, recordingUrl, phone, calledAt, durationSeconds } = body;

  if (!callId || !recordingUrl) {
    return NextResponse.json({ error: 'callId and recordingUrl are required' }, { status: 400 });
  }

  const config = await readConfig();
  const geminiKeys = getIQSGeminiKeys(config);
  if (!geminiKeys.length) {
    return NextResponse.json({ error: 'No Gemini API key configured (IQS_GEMINI_API_KEY or GEMINI_API_KEY)' }, { status: 500 });
  }

  try {
    const contactId = phone ? await upsertContact(phone) : null;
    const effectiveCalledAt = calledAt || new Date().toISOString();
    const effectiveDuration = durationSeconds && durationSeconds > 0 ? Math.round(durationSeconds) : null;

    // Upsert placeholder row so the call is tracked even if transcription fails mid-way
    await insertCallRecording({
      id: callId,
      chatId: null,
      agentId: null,
      contactId,
      recordingUrl,
      durationSeconds: effectiveDuration,
      calledAt: effectiveCalledAt,
      language: null,
      transcript: [],
    });

    // Fetch audio from URL into memory
    let mimeType = mimeFromUrl(recordingUrl);
    const audioRes = await fetch(recordingUrl);
    if (!audioRes.ok) {
      return NextResponse.json({ error: `Failed to fetch recording: HTTP ${audioRes.status}` }, { status: 502 });
    }
    const ct = audioRes.headers.get('content-type')?.split(';')[0].trim() || '';
    // Only use Content-Type if it's a specific audio type — ignore generic binary responses
    if (ct && ct.startsWith('audio/') && ct !== 'audio/octet-stream') mimeType = ct;
    const audioBase64 = Buffer.from(await audioRes.arrayBuffer()).toString('base64');

    // Send to Gemini multimodal for transcription
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
    const interruptionCount = segments.filter((s: any) => s.type === 'interruption').length;
    const deadAirCount      = segments.filter((s: any) => s.type === 'dead_air').length;

    // Update row with real transcript
    await insertCallRecording({
      id: callId,
      chatId: null,
      agentId: null,
      contactId,
      recordingUrl,
      durationSeconds: effectiveDuration,
      calledAt: effectiveCalledAt,
      language,
      transcript: segments,
    });
    await updateCallRecordingMetrics({ id: callId, interruptionCount, deadAirCount, status: 'pending_link' });

    console.log(`[retranscribe-call] ${callId} — ${segments.length} segments (${language}), interruptions=${interruptionCount}, dead_air=${deadAirCount}`);

    return NextResponse.json({
      ok: true,
      callId,
      language,
      segmentCount: segments.length,
      interruptionCount,
      deadAirCount,
      segments,
    });
  } catch (err: any) {
    console.error('[retranscribe-call] error:', err?.message ?? err);
    return NextResponse.json({ ok: false, error: err?.message || 'Transcription failed' }, { status: 500 });
  }
}
