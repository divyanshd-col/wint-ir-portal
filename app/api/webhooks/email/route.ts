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
           status = CASE WHEN email_conversations.status = 'MERGED' THEN 'MERGED' ELSE 'OPEN' END,
           customer_email = COALESCE(EXCLUDED.customer_email, email_conversations.customer_email),
           updated_at = NOW()`,
        [ticketId, chatId, subjectLine, customerEmail, customerPhone, createdAt, JSON.stringify(body)]
      );
    } else if (eventType === 'REPLY_SENT') {
      // 1. Update overall conversation container
      await query(
        `UPDATE email_conversations SET
           first_response_at = COALESCE(first_response_at, $1),
           status = CASE WHEN status = 'MERGED' THEN 'MERGED' ELSE 'RESOLVED' END,
           agent_name = COALESCE($2, agent_name),
           updated_at = NOW()
         WHERE id = $3`,
        [createdAt, agentName, ticketId]
      );

      // 2. Step 2 of Implementation Plan: Store each outbound reply in email_reply_evaluations with status Pending
      const messageId = String(
        body?.data?.message?.message_id ||
        body?.data?.message_id ||
        body?.message?.message_id ||
        body?.message_id ||
        `msg_${ticketId}_${Date.now()}`
      );
      const agentId = String(
        body?.data?.human_agent_info?.agent_id ||
        body?.human_agent_info?.agent_id ||
        body?.agent_id ||
        ''
      );
      const replyContent = String(
        body?.data?.message?.content ||
        body?.data?.content ||
        body?.message?.content ||
        body?.content ||
        ''
      );
      const customerMsg = String(
        body?.data?.previous_message ||
        body?.data?.customer_message ||
        body?.data?.ticket?.latest_customer_message ||
        ''
      );

      await query(
        `INSERT INTO email_reply_evaluations
         (ticket_id, message_id, agent_id, agent_name, sent_at, customer_message, agent_reply_text, raw_reply_payload, evaluation_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'Pending')
         ON CONFLICT (message_id) DO UPDATE SET
           agent_name = COALESCE(EXCLUDED.agent_name, email_reply_evaluations.agent_name),
           agent_reply_text = COALESCE(EXCLUDED.agent_reply_text, email_reply_evaluations.agent_reply_text),
           updated_at = NOW()`,
        [
          ticketId,
          messageId,
          agentId || null,
          agentName || null,
          createdAt,
          customerMsg || null,
          replyContent || null,
          JSON.stringify(body),
        ]
      );
    } else if (eventType === 'TICKET_MERGED') {
      // Merged tickets handling per Step 2 & Section 2
      const primaryTicketId = String(
        body?.data?.merged_into_ticket_id ||
        body?.data?.primary_ticket_id ||
        body?.merged_into ||
        body?.data?.target_ticket_id ||
        ''
      );

      if (primaryTicketId) {
        await query(
          `UPDATE email_conversations SET
             status = 'MERGED',
             merged_into_ticket_id = $1,
             updated_at = NOW()
           WHERE id = $2`,
          [primaryTicketId, ticketId]
        );

        // Mark any pending evaluations under merged Ticket B as Skipped
        await query(
          `UPDATE email_reply_evaluations SET
             evaluation_status = 'Skipped',
             qa_notes = COALESCE(qa_notes, '') || ' [Skipped: ticket merged into ' || $1 || ']',
             updated_at = NOW()
           WHERE ticket_id = $2 AND evaluation_status = 'Pending'`,
          [primaryTicketId, ticketId]
        );
      }
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
