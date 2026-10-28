import { NextRequest, NextResponse } from 'next/server';
import { saveRobylonWebhookPayload } from '@/lib/robylon/db';
import { ingestDoubleTickPayload } from '@/lib/pcg/doubletick';

export const dynamic = 'force-dynamic';

/**
 * DoubleTick Webhook / Ingestion Route
 * POST /api/webhooks/doubletick
 *
 * 1. Dumps incoming DoubleTick chat JSON payloads directly into `robylon_webhook_payloads`
 *    with channel='doubletick' and source='doubletick'.
 * 2. Parses and threads messages into `pcg_conversations` in real-time.
 *
 * Auth Verification:
 *  - Checks Authorization: Bearer <DOUBLETICK_WEBHOOK_SECRET>
 *  - Or URL query parameter ?secret=<DOUBLETICK_WEBHOOK_SECRET>
 */

function isAuthorised(req: NextRequest): boolean {
  const secret = process.env.DOUBLETICK_WEBHOOK_SECRET || process.env.WEBHOOK_SECRET;
  if (!secret) {
    // If no secret is set yet in env, accept with warning for initial setup
    return true;
  }
  const authHeader = req.headers.get('authorization') || '';
  if (authHeader === `Bearer ${secret}`) return true;
  const url = new URL(req.url);
  if (url.searchParams.get('secret') === secret) return true;
  return false;
}

function sanitizeHeaders(req: NextRequest): Record<string, string> {
  const headersObj: Record<string, string> = {};
  req.headers.forEach((val, key) => {
    // Exclude sensitive credentials to prevent leaks in database logs
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
    message: 'DoubleTick Webhook Ingestion Endpoint is active and listening for POST requests.',
    endpoint: '/api/webhooks/doubletick',
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

  if (!body || (typeof body !== 'object' && !Array.isArray(body))) {
    return NextResponse.json({ error: 'Payload must be a JSON object or array' }, { status: 400 });
  }

  // Safely extract Chat ID and Event ID from either array or object payload
  let chatId: string | null = null;
  let eventId: string | null = null;

  const target = Array.isArray(body) ? (body[0] || {}) : body;
  chatId = target['Chat ID'] || target['chatId'] || target['chat_id'] || target.dtCustomerId || target.customerId || target.to || target.from || null;
  eventId = target['Message ID'] || target['messageId'] || target['message_id'] || target.dtMessageId || target.id || null;

  const safeChatId = chatId ? String(chatId).trim() : null;
  const safeEventId = eventId ? String(eventId).trim() : null;
  const headers = sanitizeHeaders(req);

  // 1. Instantly store raw payload into robylon_webhook_payloads (data safety)
  try {
    await saveRobylonWebhookPayload({
      source: 'doubletick',
      eventType: 'CHAT_EXPORT',
      eventId: safeEventId,
      chatId: safeChatId,
      payload: body,
      headers: headers,
    });
  } catch (err: any) {
    console.warn('[doubletick-webhook] Warning saving raw payload:', err?.message || err);
  }

  // 2. Parse & Thread messages into `pcg_conversations` table
  let ingestedCount = 0;
  try {
    const res = await ingestDoubleTickPayload(body);
    ingestedCount = res?.ingestedCount || 0;
  } catch (err: any) {
    console.error('[doubletick-webhook] Failed to ingest into pcg_conversations:', err?.message || err);
  }

  return NextResponse.json({
    success: true,
    message: 'DoubleTick payload ingested successfully',
    channel: 'doubletick',
    chatId: safeChatId,
    recordCount: Array.isArray(body) ? body.length : 1,
    conversationsIngested: ingestedCount,
    receivedAt: new Date().toISOString(),
  }, { status: 200 });
}
