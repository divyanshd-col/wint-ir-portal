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

  try {
    const createdAt = body?.created_at || body?.data?.created_at || new Date().toISOString();
    const customerEmail = body?.requester_info?.email || body?.data?.requester_info?.email || body?.user_email || '';
    const customerPhone = body?.requester_info?.phone_number || body?.data?.requester_info?.phone_number || '';
    const subjectLine = body?.data?.subject || body?.subject || '';
    const agentName =
      body?.data?.message?.sender ||
      body?.data?.message?.sender_name ||
      body?.human_agent_info?.name ||
      body?.handled_by_name ||
      body?.data?.handled_by_name ||
      body?.agent_name ||
      null;

    const props = Array.isArray(body?.data?.properties) ? body.data.properties : (Array.isArray(body?.properties) ? body.properties : []);
    const intentProp = props.find((p: any) => p?.name === 'Intents_L1');
    const intentL1 = intentProp ? (intentProp.snapshot_value || intentProp.selected_value || null) : null;

    if (eventType === 'TICKET_CREATED' || eventType === 'NEW_MESSAGE') {
      await query(
        `INSERT INTO email_conversations 
         (id, chat_id, subject_line, customer_email, customer_phone, status, created_at, raw_payload, intent_l1)
         VALUES ($1, $2, $3, $4, $5, 'OPEN', $6, $7, $8)
         ON CONFLICT (id) DO UPDATE SET
           status = 'OPEN',
           customer_email = COALESCE(EXCLUDED.customer_email, email_conversations.customer_email),
           intent_l1 = COALESCE(EXCLUDED.intent_l1, email_conversations.intent_l1),
           updated_at = NOW()`,
        [ticketId, chatId, subjectLine, customerEmail, customerPhone, createdAt, JSON.stringify(body), intentL1]
      );
    } else if (eventType === 'REPLY_SENT') {
      await query(
        `UPDATE email_conversations SET
           first_response_at = COALESCE(first_response_at, $1),
           status = 'RESOLVED',
           agent_name = COALESCE($2, agent_name),
           intent_l1 = COALESCE($3, intent_l1),
           updated_at = NOW()
         WHERE id = $4`,
        [createdAt, agentName, intentL1, ticketId]
      );
    } else if (eventType === 'TICKET_CLOSED') {
      await query(
        `UPDATE email_conversations SET
           closed_at = $1,
           status = 'CLOSED',
           intent_l1 = COALESCE($2, intent_l1),
           updated_at = NOW()
         WHERE id = $3`,
        [createdAt, intentL1, ticketId]
      );
    } else if (intentL1) {
      await query(
        `UPDATE email_conversations SET
           intent_l1 = $1,
           updated_at = NOW()
         WHERE id = $2 OR chat_id = $2`,
        [intentL1, ticketId]
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
