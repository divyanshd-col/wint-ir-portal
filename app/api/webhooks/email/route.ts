/**
 * POST /api/webhooks/email
 *
 * Dedicated Email Webhook Endpoint for Robylon Email Tickets.
 * Receives email payloads, saves raw payloads, and updates email_conversations table.
 */

import { NextRequest, NextResponse } from 'next/server';
import { saveRobylonWebhookPayload } from '@/lib/robylon/db';
import { query } from '@/lib/cx/db';

// ── Auth ────────────────────────────────────────────────────────────────────────────
function isAuthorised(req: NextRequest): boolean {
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret) {
    console.warn('[email-webhook] WEBHOOK_SECRET not set — accepting all requests');
    return true;
  }
  const authHeader = req.headers.get('authorization') || '';
  if (authHeader === `Bearer ${secret}`) return true;
  const url = new URL(req.url);
  if (url.searchParams.get('secret') === secret) return true;
  return false;
}

// ── Main Endpoint Handler ────────────────────────────────────────────────────────
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

  const eventType = body?.event_type || 'UNKNOWN';
  const eventId   = body?.event_id ? String(body.event_id) : null;
  const chatId    = String(body?.chat_id || body?.ticket_id || body?.data?.ticket_id || `email_${Date.now()}`);
  const ticketId  = String(body?.ticket_id || body?.data?.ticket_id || chatId);

  // 1. Immediately save raw payload to robylon_webhook_payloads
  await saveRobylonWebhookPayload({
    source: 'email',
    eventType,
    eventId,
    chatId,
    payload: body,
  });

  // 2. Insert or update record in email_conversations
  try {
    const createdAt = body?.created_at || body?.data?.created_at || new Date().toISOString();
    const customerEmail = body?.requester_info?.email || body?.data?.requester_info?.email || body?.user_email || '';
    const customerPhone = body?.requester_info?.phone_number || body?.data?.requester_info?.phone_number || '';
    const subjectLine = body?.data?.subject || body?.subject || '';
    const agentName = body?.handled_by_name || body?.data?.handled_by_name || body?.agent_name || null;

    if (eventType === 'TICKET_CREATED' || eventType === 'NEW_MESSAGE') {
      await query(
        `INSERT INTO email_conversations 
         (id, chat_id, subject_line, customer_email, customer_phone, status, created_at, raw_payload)
         VALUES ($1, $2, $3, $4, $5, 'OPEN', $6, $7)
         ON CONFLICT (id) DO UPDATE SET
           status = 'OPEN',
           customer_email = COALESCE(EXCLUDED.customer_email, email_conversations.customer_email),
           updated_at = NOW()`,
        [ticketId, chatId, subjectLine, customerEmail, customerPhone, createdAt, JSON.stringify(body)]
      );
    } else if (eventType === 'REPLY_SENT') {
      await query(
        `UPDATE email_conversations SET
           first_response_at = COALESCE(first_response_at, $1),
           status = 'RESOLVED',
           agent_name = COALESCE($2, agent_name),
           updated_at = NOW()
         WHERE id = $3`,
        [createdAt, agentName, ticketId]
      );
    } else if (eventType === 'TICKET_CLOSED') {
      await query(
        `UPDATE email_conversations SET
           closed_at = $1,
           status = 'CLOSED',
           updated_at = NOW()
         WHERE id = $2`,
        [createdAt, ticketId]
      );
    }
  } catch (err: any) {
    console.error(`[email-webhook] Error updating email_conversations for ticket ${ticketId}:`, err);
  }

  return NextResponse.json({
    ok: true,
    channel: 'EMAIL',
    event_type: eventType,
    ticket_id: ticketId,
  });
}
