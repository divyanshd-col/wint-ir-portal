/**
 * lib/email/ingest.ts
 *
 * Ingestion and queueing pipeline for Robylon Email Replies.
 * Extracts email conversation and reply metadata from incoming webhooks,
 * ensures conversation persistence, and queues replies for automated quality evaluation.
 */

import { query } from '@/lib/cx/db';

export interface IngestReplyResult {
  inserted: boolean;
  messageId: string | null;
  ticketId?: string;
  reason?: string;
}

/**
 * Ingests an email reply event into email_conversations and email_reply_evaluations.
 * Sets initial status to 'Pending' so it is queued for automated evaluation.
 */
export async function ingestEmailReply(body: any): Promise<IngestReplyResult> {
  const eventType = body?.event_type || 'UNKNOWN';
  if (eventType !== 'REPLY_SENT') {
    return { inserted: false, messageId: null, reason: 'NOT_REPLY_SENT' };
  }

  const handledBy = String(body?.handled_by || body?.data?.message?.author_type || '').toUpperCase();
  if (handledBy === 'AI') {
    return { inserted: false, messageId: null, reason: 'AI_REPLY' };
  }

  const chatId = String(body?.chat_id || body?.ticket_id || body?.data?.ticket_id || `email_${Date.now()}`);
  const ticketId = String(body?.ticket_id || body?.data?.ticket_id || chatId);

  const rawContent = String(
    body?.data?.message?.content ||
    body?.data?.content ||
    body?.content ||
    ''
  ).trim();

  if (!rawContent) {
    return { inserted: false, messageId: null, reason: 'EMPTY_CONTENT' };
  }

  const agentName = String(
    body?.data?.message?.sender ||
    body?.data?.message?.sender_name ||
    body?.human_agent_info?.name ||
    body?.handled_by_name ||
    body?.data?.handled_by_name ||
    body?.agent_name ||
    ''
  ).trim();

  if (!agentName) {
    return { inserted: false, messageId: null, reason: 'NO_AGENT_NAME' };
  }

  const messageId = String(
    body?.data?.message?.message_id ||
    body?.data?.message_id ||
    body?.message_id ||
    body?.event_id ||
    `msg_${ticketId}_${Date.now()}`
  );

  const createdAt = body?.created_at || body?.data?.created_at || new Date().toISOString();
  const sentAt = new Date(
    body?.data?.message?.created_at ||
    createdAt
  ).toISOString();

  const customerEmail = body?.requester_info?.email || body?.data?.requester_info?.email || body?.user_email || '';
  const customerPhone = body?.requester_info?.phone_number || body?.data?.requester_info?.phone_number || '';
  const subjectLine = body?.data?.subject || body?.subject || body?.data?.message?.subject || '';

  const props = Array.isArray(body?.data?.properties)
    ? body.data.properties
    : (Array.isArray(body?.properties) ? body.properties : []);
  const intentProp = props.find((p: any) => p?.name === 'Intents_L1');
  const intentL1 = intentProp ? (intentProp.snapshot_value || intentProp.selected_value || null) : null;

  // 1. Ensure conversation row exists in email_conversations
  await query(
    `INSERT INTO email_conversations 
       (id, chat_id, subject_line, customer_email, customer_phone, status, created_at, raw_payload, intent_l1, agent_name, first_response_at)
     VALUES ($1, $2, $3, $4, $5, 'RESOLVED', $6, $7, $8, $9, $10)
     ON CONFLICT (id) DO UPDATE SET
       status = 'RESOLVED',
       first_response_at = COALESCE(email_conversations.first_response_at, EXCLUDED.first_response_at),
       agent_name = COALESCE(EXCLUDED.agent_name, email_conversations.agent_name),
       customer_email = COALESCE(EXCLUDED.customer_email, email_conversations.customer_email),
       intent_l1 = COALESCE(EXCLUDED.intent_l1, email_conversations.intent_l1),
       updated_at = NOW()`,
    [ticketId, chatId, subjectLine, customerEmail, customerPhone, createdAt, JSON.stringify(body), intentL1, agentName, sentAt]
  );

  // 2. Resolve Agent ID
  let agentId: string | null = body?.human_agent_info?.agent_id || body?.handled_by_id || null;
  if (!agentId) {
    try {
      const matchedAgent = await query(
        `SELECT id, name FROM agents WHERE LOWER(TRIM(name)) = LOWER(TRIM($1)) LIMIT 1`,
        [agentName]
      );
      if (matchedAgent && matchedAgent.length > 0) {
        agentId = matchedAgent[0].id;
      }
    } catch {
      // agent lookup is best-effort
    }
  }

  // 3. Resolve most recent customer message
  let customerMessage = subjectLine;
  try {
    const priorCustomerEvents = await query(
      `SELECT payload
       FROM robylon_webhook_payloads
       WHERE chat_id = $1
         AND event_type IN ('NEW_MESSAGE', 'TICKET_CREATED')
         AND received_at <= $2
       ORDER BY received_at DESC
       LIMIT 1`,
      [chatId, sentAt]
    );

    if (priorCustomerEvents && priorCustomerEvents.length > 0) {
      const p = priorCustomerEvents[0].payload || {};
      const msgContent = p.data?.message?.content || p.data?.content || p.content || p.data?.message?.subject || p.subject;
      if (msgContent && typeof msgContent === 'string' && msgContent.trim().length > 0) {
        customerMessage = msgContent.trim();
      }
    }
  } catch (err: any) {
    console.warn(`[email-ingest] Could not fetch prior customer message for ${chatId}:`, err.message);
  }

  // 4. Insert into email_reply_evaluations
  const insertRes = await query(
    `INSERT INTO email_reply_evaluations
       (ticket_id, message_id, agent_id, agent_name, sent_at, customer_message, agent_reply_text, raw_reply_payload, evaluation_status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'Pending')
     ON CONFLICT (message_id) DO UPDATE SET
       customer_message = COALESCE(email_reply_evaluations.customer_message, EXCLUDED.customer_message),
       agent_reply_text = EXCLUDED.agent_reply_text,
       agent_name = COALESCE(EXCLUDED.agent_name, email_reply_evaluations.agent_name),
       updated_at = NOW()
     WHERE email_reply_evaluations.evaluation_status != 'Completed'
     RETURNING id, message_id, evaluation_status`,
    [
      ticketId,
      messageId,
      agentId,
      agentName,
      sentAt,
      customerMessage,
      rawContent,
      JSON.stringify(body),
    ]
  );

  const insertedRow = insertRes && insertRes[0];
  return {
    inserted: true,
    messageId: insertedRow?.message_id || messageId,
    ticketId,
    reason: insertedRow?.evaluation_status || 'Pending',
  };
}

