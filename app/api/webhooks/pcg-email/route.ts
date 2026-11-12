/**
 * POST /api/webhooks/pcg-email
 *
 * Robylon email webhook for PCG. Same payload shape as /api/webhooks/email (CX),
 * but store-only: the raw event goes to `pcg_webhook_payloads`
 * (source='robylon_email', channel='email'). No conversation/evaluation tables yet.
 *
 * Auth: Authorization: Bearer <secret> or ?secret=<secret>, where secret is
 * WEBHOOK_SECRET (same token as the CX email webhook).
 */

import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/cx/db';

export const dynamic = 'force-dynamic';

function isAuthorised(req: NextRequest): boolean {
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret) {
    console.warn('[pcg-email-webhook] No webhook secret set — accepting all requests');
    return true;
  }
  if (req.headers.get('authorization') === `Bearer ${secret}`) return true;
  return new URL(req.url).searchParams.get('secret') === secret;
}

function sanitizeHeaders(req: NextRequest): Record<string, string> {
  const out: Record<string, string> = {};
  req.headers.forEach((val, key) => {
    const k = key.toLowerCase();
    if (k !== 'authorization' && k !== 'cookie' && k !== 'x-api-key') out[key] = val;
  });
  return out;
}

export async function GET() {
  return NextResponse.json({
    status: 'online',
    endpoint: '/api/webhooks/pcg-email',
    supportedMethod: 'POST',
  });
}

export async function POST(req: NextRequest) {
  if (!isAuthorised(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Payload must be a JSON object' }, { status: 400 });
  }

  const eventType = body.event_type ? String(body.event_type) : 'UNKNOWN';
  const eventId = body.event_id ? String(body.event_id) : null;
  const chatId = body.chat_id || body.ticket_id || body.data?.ticket_id;
  const ticketId = body.ticket_id || body.data?.ticket_id || null;

  // Direct insert (not savePcgWebhookPayload, which swallows errors): if the
  // write fails we return 500 so Robylon can retry instead of losing the event.
  try {
    await query(
      `INSERT INTO pcg_webhook_payloads (source, channel, event_type, event_id, chat_id, payload, headers)
       VALUES ('robylon_email', 'email', $1, $2, $3, $4, $5)`,
      [eventType, eventId, chatId ? String(chatId) : null, JSON.stringify(body), JSON.stringify(sanitizeHeaders(req))]
    );
  } catch (err: any) {
    console.error('[pcg-email-webhook] Failed to store payload:', err?.message || err);
    return NextResponse.json({ error: 'Failed to store payload' }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    channel: 'EMAIL',
    event_type: eventType,
    ticket_id: ticketId ? String(ticketId) : null,
  });
}
