import { NextRequest, NextResponse } from 'next/server';
import { saveRobylonWebhookPayload } from '@/lib/robylon/db';
import { query } from '@/lib/cx/db';

export const dynamic = 'force-dynamic';

/**
 * Runo PCG Call Webhook / Ingestion Route
 * POST /api/webhooks/runo
 *
 * Dedicated endpoint for Runo PCG call events & S3 recording URL webhooks.
 * Stores raw payloads into `robylon_webhook_payloads` (source='runo')
 * and populates the dedicated `pcg_call_recordings` table.
 */

function isAuthorised(req: NextRequest): boolean {
  const secret = process.env.RUNO_WEBHOOK_SECRET || process.env.WEBHOOK_SECRET;
  if (!secret) return true;
  const authHeader = req.headers.get('authorization') || '';
  if (authHeader === `Bearer ${secret}`) return true;
  const url = new URL(req.url);
  if (url.searchParams.get('secret') === secret) return true;
  return false;
}

function parseEpochTime(val: any): string | null {
  if (!val) return null;
  const num = Number(val);
  if (isNaN(num) || num <= 0) return null;
  // Handle both epoch seconds (10 digits) and milliseconds (13 digits)
  const ms = num < 1e11 ? num * 1000 : num;
  return new Date(ms).toISOString();
}

function sanitizeHeaders(req: NextRequest): Record<string, string> {
  const headersObj: Record<string, string> = {};
  req.headers.forEach((val, key) => {
    const lowerKey = key.toLowerCase();
    if (lowerKey !== 'authorization' && lowerKey !== 'cookie' && lowerKey !== 'x-api-key') {
      headersObj[key] = val;
    }
  });
  return headersObj;
}

export async function GET() {
  return NextResponse.json({
    status: 'online',
    provider: 'runo',
    message: 'Runo PCG Call Ingestion Endpoint is active and listening for POST requests.',
    endpoint: '/api/webhooks/runo',
    supportedMethod: 'POST',
  }, { status: 200 });
}

export async function POST(req: NextRequest) {
  if (!isAuthorised(req)) {
    return NextResponse.json({ error: 'Unauthorized: Invalid webhook secret' }, { status: 401 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid or empty JSON body' }, { status: 400 });
  }

  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Payload must be a JSON object' }, { status: 400 });
  }

  const callId = String(body.callId || body.call_id || body.id || '').trim();
  if (!callId) {
    return NextResponse.json({ error: 'Missing required field: callId' }, { status: 400 });
  }

  const recordingUrl = body.recordingUrl || body.recording_url || null;
  const callType = body.type || body.call_type || (recordingUrl ? 'audio_recording' : 'call_event');
  const headers = sanitizeHeaders(req);

  // 1. Instantly store raw payload into robylon_webhook_payloads
  try {
    await saveRobylonWebhookPayload({
      source: 'runo',
      eventType: callType.toUpperCase(),
      eventId: callId,
      chatId: callId,
      payload: body,
      headers: headers,
    });
  } catch (err: any) {
    console.warn('[runo-webhook] Non-critical warning saving raw payload:', err.message);
  }

  // 2. Process & Upsert into dedicated `pcg_call_recordings` table
  try {
    const callerId     = body.callerId ? String(body.callerId).trim() : null;
    const calledBy     = body.calledBy ? String(body.calledBy).trim() : null;
    const agentName    = body.name ? String(body.name).trim() : null;
    const customerId   = body.customerId ? String(body.customerId).trim() : null;
    const phoneNumber  = body.phoneNumber ? String(body.phoneNumber).trim() : null;
    const userPhone    = body.userPhone ? String(body.userPhone).trim() : null;
    const processId    = body.processId ? String(body.processId).trim() : null;
    const tag          = body.tag ? String(body.tag).trim() : null;
    const duration     = body.duration != null ? Math.max(0, parseInt(body.duration, 10) || 0) : 0;
    const startTime    = parseEpochTime(body.startTime);
    const createdAtTime = parseEpochTime(body.createdAt);

    if (recordingUrl) {
      // Audio Recording URL Payload
      await query(`
        INSERT INTO pcg_call_recordings (call_id, recording_url, raw_payload)
        VALUES ($1, $2, $3::jsonb)
        ON CONFLICT (call_id) DO UPDATE SET
          recording_url = EXCLUDED.recording_url,
          raw_payload   = pcg_call_recordings.raw_payload || EXCLUDED.raw_payload,
          updated_at    = NOW()
      `, [callId, String(recordingUrl).trim(), JSON.stringify(body)]);

      console.log(`[runo-webhook] S3 Recording URL saved for PCG call ${callId}`);
    } else {
      // Call Event Payload (Outgoing Answered, Unanswered, Incoming Missed, etc.)
      await query(`
        INSERT INTO pcg_call_recordings (
          call_id, caller_id, called_by, agent_name, customer_id,
          phone_number, user_phone, process_id, call_type, tag,
          duration_seconds, start_time, created_at_time, raw_payload
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb)
        ON CONFLICT (call_id) DO UPDATE SET
          caller_id        = COALESCE(EXCLUDED.caller_id, pcg_call_recordings.caller_id),
          called_by        = COALESCE(EXCLUDED.called_by, pcg_call_recordings.called_by),
          agent_name       = COALESCE(EXCLUDED.agent_name, pcg_call_recordings.agent_name),
          customer_id      = COALESCE(EXCLUDED.customer_id, pcg_call_recordings.customer_id),
          phone_number     = COALESCE(EXCLUDED.phone_number, pcg_call_recordings.phone_number),
          user_phone       = COALESCE(EXCLUDED.user_phone, pcg_call_recordings.user_phone),
          process_id       = COALESCE(EXCLUDED.process_id, pcg_call_recordings.process_id),
          call_type        = COALESCE(EXCLUDED.call_type, pcg_call_recordings.call_type),
          tag              = COALESCE(EXCLUDED.tag, pcg_call_recordings.tag),
          duration_seconds = COALESCE(EXCLUDED.duration_seconds, pcg_call_recordings.duration_seconds),
          start_time       = COALESCE(EXCLUDED.start_time, pcg_call_recordings.start_time),
          created_at_time  = COALESCE(EXCLUDED.created_at_time, pcg_call_recordings.created_at_time),
          raw_payload      = pcg_call_recordings.raw_payload || EXCLUDED.raw_payload,
          updated_at       = NOW()
      `, [
        callId,
        callerId,
        calledBy,
        agentName,
        customerId,
        phoneNumber,
        userPhone,
        processId,
        callType,
        tag,
        duration,
        startTime,
        createdAtTime,
        JSON.stringify(body),
      ]);

      console.log(`[runo-webhook] Call event (${callType}) stored for PCG call ${callId}`);
    }

    return NextResponse.json({
      success: true,
      message: 'Runo PCG call payload ingested successfully',
      callId: callId,
      callType: callType,
      receivedAt: new Date().toISOString(),
    }, { status: 200 });

  } catch (err: any) {
    console.error(`[runo-webhook] Error processing PCG call ${callId}:`, err?.message || err);
    return NextResponse.json({ error: 'Failed to process Runo call payload' }, { status: 500 });
  }
}
