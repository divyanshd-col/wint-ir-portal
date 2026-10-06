import { NextRequest, NextResponse } from 'next/server';
import { saveRobylonWebhookPayload } from '@/lib/robylon/db';

export const dynamic = 'force-dynamic';

/**
 * DoubleTick Webhook / Ingestion Route
 * POST /api/webhooks/doubletick
 *
 * Dumps incoming DoubleTick chat JSON payloads directly into `robylon_webhook_payloads`
 * with channel='doubletick' and source='doubletick'.
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

  // Safely extract Chat ID from either array or object payload
  let chatId: string | null = null;
  let eventId: string | null = null;

  if (Array.isArray(body)) {
    if (body.length === 0) {
      return NextResponse.json({ error: 'Empty JSON array payload' }, { status: 400 });
    }
    const firstItem = body[0] || {};
    chatId = firstItem['Chat ID'] || firstItem['chatId'] || firstItem['chat_id'] || null;
    eventId = firstItem['Message ID'] || firstItem['messageId'] || firstItem['message_id'] || null;
  } else {
    chatId = body['Chat ID'] || body['chatId'] || body['chat_id'] || null;
    eventId = body['Message ID'] || body['messageId'] || body['message_id'] || null;
  }

  const safeChatId = chatId ? String(chatId).trim() : null;
  const safeEventId = eventId ? String(eventId).trim() : null;
  const headers = sanitizeHeaders(req);

  try {
    await saveRobylonWebhookPayload({
      source: 'doubletick',
      eventType: 'CHAT_EXPORT',
      eventId: safeEventId,
      chatId: safeChatId,
      payload: body,
      headers: headers,
    });

    return NextResponse.json({
      success: true,
      message: 'DoubleTick payload ingested successfully',
      channel: 'doubletick',
      chatId: safeChatId,
      recordCount: Array.isArray(body) ? body.length : 1,
      receivedAt: new Date().toISOString(),
    }, { status: 200 });

  } catch (err: any) {
    console.error('[doubletick-webhook] Failed to save payload:', err?.message || err);
    return NextResponse.json({ error: 'Failed to ingest payload' }, { status: 500 });
  }
}
