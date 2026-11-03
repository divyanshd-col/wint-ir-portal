import { query } from '@/lib/cx/db';

export const PCG_INACTIVITY_HOURS = 48;
export const PCG_INACTIVITY_MS = PCG_INACTIVITY_HOURS * 60 * 60 * 1000;

export interface DoubleTickTranscriptItem {
  message_id: string | null;
  event_type: 'message_received' | 'status_update';
  direction: 'inbound' | 'outbound';
  speaker: 'Customer' | 'RM';
  text: string | null;
  status: string | null; // 'SENT', 'DELIVERED', 'READ', 'FAILED', or null
  type: string;          // 'TEXT', 'IMAGE', 'AUDIO', 'DOCUMENT', 'template'
  media_url?: string | null;
  template_name?: string | null;
  timestamp: string;
  delivered_at?: string | null;
  read_at?: string | null;
}

/**
 * Checks whether a conversation has had no message activity for >= 48 hours.
 */
export function isConversationInactive(
  lastMessageAt: string | Date | null | undefined,
  referenceTime: Date = new Date()
): boolean {
  if (!lastMessageAt) return false;
  const lastTime = new Date(lastMessageAt).getTime();
  if (isNaN(lastTime)) return false;
  return referenceTime.getTime() - lastTime >= PCG_INACTIVITY_MS;
}

/**
 * Closes all OPEN pcg_conversations that have had no message activity for >= 48 hours.
 * Sets status = 'CLOSED' and closed_at = last_message_at + 48 hours (or created_at + 48 hours).
 * Returns the count and identifiers of updated conversations.
 */
export async function closeInactivePcgConversations(
  inactivityHours: number = PCG_INACTIVITY_HOURS
): Promise<{ closedCount: number; closed: { customer_phone: string; waba_number: string }[] }> {
  try {
    const res = await query<{ customer_phone: string; waba_number: string }>(
      `UPDATE pcg_conversations
       SET status = 'CLOSED',
           closed_at = COALESCE(last_message_at + ($1 || ' hours')::interval, created_at + ($1 || ' hours')::interval, NOW()),
           updated_at = NOW()
       WHERE (status IS NULL OR status = 'OPEN')
         AND COALESCE(last_message_at, created_at) < NOW() - ($1 || ' hours')::interval
       RETURNING customer_phone, waba_number`,
      [inactivityHours.toString()]
    );

    return {
      closedCount: res.length,
      closed: res,
    };
  } catch (err: any) {
    console.error('[pcg/doubletick] Failed to close inactive PCG conversations:', err?.message || err);
    return { closedCount: 0, closed: [] };
  }
}

/**
 * Ingests incoming DoubleTick webhook payload into `pcg_conversations`.
 * Handles:
 *  - Inbound messages from customers (`message_received`)
 *  - Outbound messages from RMs (`status_update`)
 *  - Real-time status transitions (`SENT` -> `DELIVERED` -> `READ`) without duplicating turns
 */
export async function ingestDoubleTickPayload(rawBody: any): Promise<{ ingestedCount: number }> {
  if (!rawBody || (typeof rawBody !== 'object' && !Array.isArray(rawBody))) {
    return { ingestedCount: 0 };
  }

  let items: any[] = [];
  if (Array.isArray(rawBody)) {
    items = rawBody;
  } else if (rawBody && Array.isArray(rawBody.data)) {
    items = rawBody.data;
  } else if (rawBody && typeof rawBody === 'object') {
    items = [rawBody];
  }

  let ingestedCount = 0;

  for (const item of items) {
    if (!item || typeof item !== 'object') continue;

    // 1. Detect Event Type, Direction & Speaker
    const isStatusUpdate = !!(item.status || item.statusTimestamp);
    let direction: 'inbound' | 'outbound' = 'inbound';
    let speaker: 'Customer' | 'RM' = 'Customer';
    let eventType: 'message_received' | 'status_update' = isStatusUpdate ? 'status_update' : 'message_received';

    if (item.Direction) {
      const dirStr = String(item.Direction).toLowerCase();
      if (dirStr.includes('agent') || dirStr.includes('outbound')) {
        direction = 'outbound';
        speaker = 'RM';
      } else {
        direction = 'inbound';
        speaker = 'Customer';
      }
    } else if (isStatusUpdate) {
      direction = 'outbound';
      speaker = 'RM';
    } else {
      direction = 'inbound';
      speaker = 'Customer';
    }

    // 2. Extract Phone Numbers (Customer & WABA)
    let rawCustomerPhone = item['Customer Phone'] || (direction === 'outbound' ? item.to : item.from) || item.phone || null;
    let rawWabaNumber = item['WABA Number'] || item['wabaNumber'] || (direction === 'outbound' ? (item.sentBy || item.assignedTo || item.from) : item.to) || null;

    if (!rawCustomerPhone || !rawWabaNumber) {
      continue;
    }

    const customerPhone = String(rawCustomerPhone).trim().replace(/^\+/, '');
    const wabaNumber = String(rawWabaNumber).trim().replace(/^\+/, '');

    // 3. Extract Metadata & Identifiers
    const customerName = item.contact?.name || item.customerName || item['Customer Name'] || item.name || null;
    const customerId = item.customerId || item.dtCustomerId || null;
    const assignedRmId = item.assignedTo || item.sentBy || item.userId || null;
    const rmName = item['Sent By'] || item['Assigned Agent'] || null;
    const messageId = item.dtMessageId || item.messageId || item['Message ID'] || item.id || null;
    const status = item.status ? String(item.status).toUpperCase() : null;

    // 4. Extract Text & Media
    let text = item.message?.text || item.message?.caption || item['Content'] || null;
    if (!text && item.message?.templateMessage?.body?.text) {
      text = item.message.templateMessage.body.text;
    }
    const mediaUrl = item.message?.url || null;
    const messageType = item.message?.type || item['Message Type'] || (item.message?.templateName ? 'template' : 'TEXT');
    const templateName = item.message?.templateName || null;
    const messageTime = item.statusTimestamp || item.receivedAt || item['Sent At'] || new Date().toISOString();

    try {
      // 5. Query Existing Ongoing Conversation
      const existingRows = await query<{
        transcript: DoubleTickTranscriptItem[];
        total_messages: number;
        customer_name: string | null;
        customer_id: string | null;
        assigned_rm_id: string | null;
        last_status: string | null;
        status?: string | null;
        closed_at?: string | null;
        last_message_at?: string | null;
      }>(
        `SELECT transcript, total_messages, customer_name, customer_id, assigned_rm_id, last_status, status, closed_at, last_message_at
         FROM pcg_conversations
         WHERE customer_phone = $1 AND waba_number = $2`,
        [customerPhone, wabaNumber]
      );

      if (existingRows.length === 0) {
        // Create New Conversation Thread
        const initialTurn: DoubleTickTranscriptItem = {
          message_id: messageId,
          event_type: eventType,
          direction: direction,
          speaker: speaker,
          text: text,
          status: status,
          type: messageType,
          media_url: mediaUrl,
          template_name: templateName,
          timestamp: messageTime,
          delivered_at: status === 'DELIVERED' ? messageTime : null,
          read_at: status === 'READ' ? messageTime : null,
        };

        const msgDate = new Date(messageTime);
        const isOld = !isNaN(msgDate.getTime()) && (Date.now() - msgDate.getTime() >= PCG_INACTIVITY_MS);
        const initialStatus = isOld ? 'CLOSED' : 'OPEN';
        const initialClosedAt = isOld && !isNaN(msgDate.getTime())
          ? new Date(msgDate.getTime() + PCG_INACTIVITY_MS).toISOString()
          : null;

        await query(
          `INSERT INTO pcg_conversations (
            customer_phone, waba_number, customer_name, customer_id, assigned_rm_id, rm_name,
            transcript, total_messages, last_message_text, last_event_type, last_direction,
            last_status, last_message_at, raw_payload, status, closed_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, 1, $8, $9, $10, $11, $12, $13, $14, $15)`,
          [
            customerPhone,
            wabaNumber,
            customerName,
            customerId,
            assignedRmId,
            rmName,
            JSON.stringify([initialTurn]),
            text,
            eventType,
            direction,
            status,
            messageTime,
            JSON.stringify(item),
            initialStatus,
            initialClosedAt,
          ]
        );
      } else {
        // Conversation already exists -> Append or Update existing message status
        const row = existingRows[0];
        let currentTranscript: DoubleTickTranscriptItem[] = Array.isArray(row.transcript) ? row.transcript : [];
        let totalMessages = row.total_messages || currentTranscript.length;

        // Check if messageId is already in transcript
        const existingIdx = messageId ? currentTranscript.findIndex(t => t.message_id === messageId) : -1;

        if (existingIdx !== -1) {
          // Status Transition (e.g. SENT -> DELIVERED -> READ)
          const targetTurn = currentTranscript[existingIdx];
          if (status) targetTurn.status = status;
          if (status === 'DELIVERED' && !targetTurn.delivered_at) targetTurn.delivered_at = messageTime;
          if (status === 'READ' && !targetTurn.read_at) targetTurn.read_at = messageTime;
          if (text && !targetTurn.text) targetTurn.text = text;

          const isInactive = isConversationInactive(row.last_message_at);
          const targetStatus = isInactive ? 'CLOSED' : (row.status || 'OPEN');
          const targetClosedAt = isInactive
            ? (row.last_message_at ? new Date(new Date(row.last_message_at).getTime() + PCG_INACTIVITY_MS).toISOString() : new Date().toISOString())
            : (row.status === 'CLOSED' ? (row.closed_at || null) : null);

          await query(
            `UPDATE pcg_conversations
             SET transcript = $1,
                 last_status = COALESCE($2, last_status),
                 customer_name = COALESCE($3, customer_name),
                 customer_id = COALESCE($4, customer_id),
                 assigned_rm_id = COALESCE($5, assigned_rm_id),
                 rm_name = COALESCE($6, rm_name),
                 status = $7,
                 closed_at = $8,
                 updated_at = NOW(),
                 raw_payload = $9
             WHERE customer_phone = $10 AND waba_number = $11`,
            [
              JSON.stringify(currentTranscript),
              status,
              customerName,
              customerId,
              assignedRmId,
              rmName,
              targetStatus,
              targetClosedAt,
              JSON.stringify(item),
              customerPhone,
              wabaNumber,
            ]
          );
        } else {
          // New dialogue turn -> Append to transcript
          const newTurn: DoubleTickTranscriptItem = {
            message_id: messageId,
            event_type: eventType,
            direction: direction,
            speaker: speaker,
            text: text,
            status: status,
            type: messageType,
            media_url: mediaUrl,
            template_name: templateName,
            timestamp: messageTime,
            delivered_at: status === 'DELIVERED' ? messageTime : null,
            read_at: status === 'READ' ? messageTime : null,
          };

          currentTranscript.push(newTurn);
          totalMessages += 1;

          const msgDate = new Date(messageTime);
          const isOld = !isNaN(msgDate.getTime()) && (Date.now() - msgDate.getTime() >= PCG_INACTIVITY_MS);
          const convStatus = isOld ? 'CLOSED' : 'OPEN';
          const convClosedAt = isOld && !isNaN(msgDate.getTime())
            ? new Date(msgDate.getTime() + PCG_INACTIVITY_MS).toISOString()
            : null;

          await query(
            `UPDATE pcg_conversations
             SET transcript = $1,
                 total_messages = $2,
                 last_message_text = COALESCE($3, last_message_text),
                 last_event_type = $4,
                 last_direction = $5,
                 last_status = COALESCE($6, last_status),
                 last_message_at = $7,
                 customer_name = COALESCE($8, customer_name),
                 customer_id = COALESCE($9, customer_id),
                 assigned_rm_id = COALESCE($10, assigned_rm_id),
                 rm_name = COALESCE($11, rm_name),
                 status = $12,
                 closed_at = $13,
                 updated_at = NOW(),
                 raw_payload = $14
             WHERE customer_phone = $15 AND waba_number = $16`,
            [
              JSON.stringify(currentTranscript),
              totalMessages,
              text,
              eventType,
              direction,
              status,
              messageTime,
              customerName,
              customerId,
              assignedRmId,
              rmName,
              convStatus,
              convClosedAt,
              JSON.stringify(item),
              customerPhone,
              wabaNumber,
            ]
          );
        }
      }

      ingestedCount++;
    } catch (dbErr: any) {
      console.error('[DoubleTick Ingest Error]', dbErr?.message || dbErr);
    }
  }

  return { ingestedCount };
}
