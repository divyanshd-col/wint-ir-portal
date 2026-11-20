/**
 * POST /api/webhooks/email
 *
 * Email webhook for Robylon, for both workspaces: Robylon sends every email event here.
 *  - CX (the default): saves the raw payload to robylon_webhook_payloads, updates email_conversations and
 *    automatically triggers quality evaluation for outbound agent replies.
 *  - PCG: an event from a PCG inbox (lib/email/inbox.ts, editable in Settings → PCG → Email Inbox) is stored as-is in
 *    pcg_webhook_payloads and skips all CX processing. An event that names no inbox follows its ticket.
 */

import { NextRequest, NextResponse } from 'next/server';
import { waitUntil } from '@vercel/functions';
import { saveRobylonWebhookPayload } from '@/lib/robylon/db';
import { query } from '@/lib/cx/db';
import { ingestEmailReply } from '@/lib/email/ingest';
import { evaluateSingleReplySync } from '@/lib/email/gemini-batch-evaluator';
import { evaluatePcgEmailReplySync } from '@/lib/scoring/pcg-email-pipeline';
import { emailInboxOf, getPcgEmailInboxes, isPcgInbox } from '@/lib/email/inbox';
import { adoptCxEmailTicketIntoPcg, ingestPcgEmailEvent, isKnownPcgEmailTicket, savePcgEmailEvent } from '@/lib/pcg/db';

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

  // 0. PCG or CX? A config that cannot be read answers 5xx (Robylon retries) rather than sending PCG emails through the CX pipeline.
  let pcgInboxes: string[];
  try {
    pcgInboxes = await getPcgEmailInboxes();
  } catch (err: any) {
    console.error(`[email-webhook] Could not read the PCG inbox list for ${eventType} ${eventId ?? ''}:`, err?.message || err);
    return NextResponse.json({ error: 'Failed to route payload' }, { status: 500 });
  }
  if (pcgInboxes.length) {
    try {
      const inbox = emailInboxOf(body);
      // An event with no inbox (some NEW_MESSAGE / INTERNAL_NOTE_ADDED) follows its ticket.
      const toPcg = isPcgInbox(inbox, pcgInboxes) || (!inbox && await isKnownPcgEmailTicket(chatId));
      if (toPcg) {
        const knownBefore = await isKnownPcgEmailTicket(chatId);
        const saved = await savePcgEmailEvent({ eventType, eventId, chatId, payload: body });
        if (saved === 'duplicate') return NextResponse.json({ ok: true, duplicate: true, workspace: 'pcg', event_type: eventType, ticket_id: ticketId });

        // 2. Dual-storage: ingest/update into pcg_email_conversations and auto-evaluate outbound RM replies
        try {
          const ingestRes = await ingestPcgEmailEvent(body);
          if (ingestRes?.evaluationQueued && ingestRes?.evaluatedMessageId) {
            try {
              waitUntil(
                evaluatePcgEmailReplySync(ingestRes.evaluatedMessageId).catch((evalErr) => {
                  console.error(`[email-webhook] Error during auto-evaluation of PCG reply ${ingestRes.evaluatedMessageId}:`, evalErr);
                })
              );
            } catch (wErr: any) {
              console.warn(`[email-webhook] waitUntil not available, PCG reply queued for batch eval:`, wErr.message);
            }
          }
        } catch (ingestErr: any) {
          console.error(`[email-webhook] Error ingesting PCG email ticket ${ticketId} into pcg_email_conversations:`, ingestErr?.message || ingestErr);
        }

        if (!knownBefore) {
          // First PCG event of this ticket: an earlier inbox-less event may already have gone through the CX pipeline. Move it out.
          try {
            const moved = await adoptCxEmailTicketIntoPcg(chatId);
            if (moved) console.warn(`[email-webhook] Moved ${moved} earlier event(s) of PCG ticket ${chatId} out of CX`);
          } catch (err: any) {
            console.error(`[email-webhook] Could not move earlier CX rows of PCG ticket ${chatId} to PCG:`, err?.message || err);
          }
        }
        return NextResponse.json({ ok: true, channel: 'EMAIL', workspace: 'pcg', event_type: eventType, ticket_id: ticketId });
      }
    } catch (err: any) {
      console.error(`[email-webhook] Failed to store PCG ${eventType} ${eventId ?? ''} for ticket ${chatId}:`, err?.message || err);
      return NextResponse.json({ error: 'Failed to store payload' }, { status: 500 });
    }
  }

  // 1. Save the raw payload first. If that fails, answer 500 so Robylon retries (it retries non-2xx for ~2 minutes with the same
  //    event_id). A retry of an event we already stored is acknowledged and not processed twice.
  let saved: 'stored' | 'duplicate';
  try {
    saved = await saveRobylonWebhookPayload({ source: 'email', eventType, eventId, chatId, payload: body });
  } catch (err: any) {
    console.error(`[email-webhook] Failed to store ${eventType} ${eventId ?? ''} for ticket ${chatId}:`, err?.message || err);
    return NextResponse.json({ error: 'Failed to store payload' }, { status: 500 });
  }
  if (saved === 'duplicate') {
    return NextResponse.json({ ok: true, duplicate: true, event_type: eventType, ticket_id: ticketId });
  }

  let messageId: string | null = null;

  try {
    const createdAt = body?.created_at || body?.data?.created_at || new Date().toISOString();
    const customerEmail = body?.requester_info?.email || body?.data?.requester_info?.email || body?.user_email || '';
    const customerPhone = body?.requester_info?.phone_number || body?.data?.requester_info?.phone_number || '';
    const subjectLine = body?.data?.subject || body?.subject || '';

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
      // Ingest reply into email_conversations and email_reply_evaluations
      const ingestRes = await ingestEmailReply(body);
      messageId = ingestRes.messageId;

      if (ingestRes.inserted && ingestRes.messageId) {
        // Automatically evaluate in the background without holding the webhook HTTP response
        try {
          waitUntil(
            evaluateSingleReplySync(ingestRes.messageId).catch(err => {
              console.error(`[email-webhook] Error during auto-evaluation of reply ${ingestRes.messageId}:`, err);
            })
          );
        } catch (wErr: any) {
          console.warn(`[email-webhook] waitUntil not available, reply queued for batch:`, wErr.message);
        }
      }
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
    console.error(`[email-webhook] Error updating email tables for ticket ${ticketId}:`, err);
  }

  // An event with no inbox was just processed as CX. If a PCG event of the same ticket landed while we did that (both can be in
  // flight at once), the ticket is PCG after all: move what we just wrote out of CX.
  if (pcgInboxes.length && !emailInboxOf(body)) {
    try {
      if (await isKnownPcgEmailTicket(chatId)) await adoptCxEmailTicketIntoPcg(chatId);
    } catch (err: any) {
      console.error(`[email-webhook] Could not re-check ticket ${chatId} against PCG:`, err?.message || err);
    }
  }

  return NextResponse.json({
    ok: true,
    channel: 'EMAIL',
    event_type: eventType,
    ticket_id: ticketId,
    message_id: messageId,
  });
}
