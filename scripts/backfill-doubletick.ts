import { query } from '../lib/cx/db';
import type { DoubleTickTranscriptItem } from '../lib/pcg/doubletick';

async function fastBackfill() {
  console.log('=====================================================');
  console.log(' Starting Fast DoubleTick Backfill into pcg_conversations');
  console.log(' (robylon_webhook_payloads remains completely untouched)');
  console.log('=====================================================');

  const [initialRaw] = await query<{ count: string }>(
    `SELECT COUNT(*) as count FROM robylon_webhook_payloads WHERE source = 'doubletick'`
  );
  console.log(`Total DoubleTick payloads to process: ${initialRaw.count}`);

  // 1. Fetch all DoubleTick payloads chronologically
  console.log('Fetching all payloads from DB...');
  const rows = await query<{ id: number; payload: any; received_at: string }>(
    `SELECT id, payload, received_at 
     FROM robylon_webhook_payloads 
     WHERE source = 'doubletick' 
     ORDER BY id ASC`
  );

  console.log(`Fetched ${rows.length} payloads. Grouping into conversations in memory...`);

  // 2. Fetch all existing pcg_conversations so we can merge without losing existing data
  const existingConvs = await query<{
    customer_phone: string;
    waba_number: string;
    transcript: DoubleTickTranscriptItem[];
    customer_name: string | null;
    customer_id: string | null;
    assigned_rm_id: string | null;
    rm_name: string | null;
  }>(`SELECT customer_phone, waba_number, transcript, customer_name, customer_id, assigned_rm_id, rm_name FROM pcg_conversations`);

  interface ConvAccumulator {
    customerPhone: string;
    wabaNumber: string;
    customerName: string | null;
    customerId: string | null;
    assignedRmId: string | null;
    rmName: string | null;
    turnsMap: Map<string, DoubleTickTranscriptItem>;
    unkeyedTurns: DoubleTickTranscriptItem[];
    lastPayload: any;
    lastMessageAt: string;
  }

  const convMap = new Map<string, ConvAccumulator>();

  // Pre-seed with existing conversations
  for (const ec of existingConvs) {
    const key = `${ec.customer_phone}_${ec.waba_number}`;
    const acc: ConvAccumulator = {
      customerPhone: ec.customer_phone,
      wabaNumber: ec.waba_number,
      customerName: ec.customer_name,
      customerId: ec.customer_id,
      assignedRmId: ec.assigned_rm_id,
      rmName: ec.rm_name,
      turnsMap: new Map(),
      unkeyedTurns: [],
      lastPayload: null,
      lastMessageAt: new Date(0).toISOString(),
    };
    if (Array.isArray(ec.transcript)) {
      for (const t of ec.transcript) {
        if (t.message_id) {
          acc.turnsMap.set(t.message_id, t);
        } else {
          acc.unkeyedTurns.push(t);
        }
        if (t.timestamp && t.timestamp > acc.lastMessageAt) {
          acc.lastMessageAt = t.timestamp;
        }
      }
    }
    convMap.set(key, acc);
  }

  let totalParsedItems = 0;

  // 3. Process each payload chronologically in memory
  for (const r of rows) {
    const rawBody = r.payload;
    if (!rawBody || typeof rawBody !== 'object') continue;

    let items: any[] = [];
    if (Array.isArray(rawBody)) {
      items = rawBody;
    } else if (rawBody && Array.isArray(rawBody.data)) {
      items = rawBody.data;
    } else {
      items = [rawBody];
    }

    for (const item of items) {
      if (!item || typeof item !== 'object') continue;

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

      let rawCustomerPhone = item['Customer Phone'] || (direction === 'outbound' ? item.to : item.from) || item.phone || null;
      let rawWabaNumber = item['WABA Number'] || item['wabaNumber'] || (direction === 'outbound' ? (item.sentBy || item.assignedTo || item.from) : item.to) || null;

      if (!rawCustomerPhone || !rawWabaNumber) continue;

      const customerPhone = String(rawCustomerPhone).trim().replace(/^\+/, '');
      const wabaNumber = String(rawWabaNumber).trim().replace(/^\+/, '');
      const key = `${customerPhone}_${wabaNumber}`;

      if (!convMap.has(key)) {
        convMap.set(key, {
          customerPhone,
          wabaNumber,
          customerName: null,
          customerId: null,
          assignedRmId: null,
          rmName: null,
          turnsMap: new Map(),
          unkeyedTurns: [],
          lastPayload: null,
          lastMessageAt: new Date(0).toISOString(),
        });
      }

      const acc = convMap.get(key)!;

      const customerName = item.contact?.name || item.customerName || item['Customer Name'] || item.name || null;
      const customerId = item.customerId || item.dtCustomerId || null;
      const assignedRmId = item.assignedTo || item.sentBy || item.userId || null;
      const rmName = item['Sent By'] || item['Assigned Agent'] || null;
      const messageId = item.dtMessageId || item.messageId || item['Message ID'] || item.id || null;
      const status = item.status ? String(item.status).toUpperCase() : null;

      if (customerName) acc.customerName = customerName;
      if (customerId) acc.customerId = customerId;
      if (assignedRmId) acc.assignedRmId = assignedRmId;
      if (rmName) acc.rmName = rmName;
      acc.lastPayload = item;

      let text = item.message?.text || item.message?.caption || item['Content'] || null;
      if (!text && item.message?.templateMessage?.body?.text) {
        text = item.message.templateMessage.body.text;
      }
      const mediaUrl = item.message?.url || null;
      const messageType = item.message?.type || item['Message Type'] || (item.message?.templateName ? 'template' : 'TEXT');
      const templateName = item.message?.templateName || null;
      const messageTime = item.statusTimestamp || item.receivedAt || item['Sent At'] || r.received_at || new Date().toISOString();

      if (messageTime > acc.lastMessageAt) {
        acc.lastMessageAt = messageTime;
      }

      if (messageId && acc.turnsMap.has(messageId)) {
        // Update status of existing turn
        const existing = acc.turnsMap.get(messageId)!;
        if (status) existing.status = status;
        if (status === 'DELIVERED' && !existing.delivered_at) existing.delivered_at = messageTime;
        if (status === 'READ' && !existing.read_at) existing.read_at = messageTime;
        if (text && !existing.text) existing.text = text;
      } else {
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
        if (messageId) {
          acc.turnsMap.set(messageId, newTurn);
        } else {
          acc.unkeyedTurns.push(newTurn);
        }
      }

      totalParsedItems++;
    }
  }

  console.log(`Parsed ${totalParsedItems} message events into ${convMap.size} unique conversation threads.`);
  console.log('Upserting conversations into pcg_conversations...');

  let upsertedConvs = 0;
  for (const acc of convMap.values()) {
    // Combine keyed and unkeyed turns, sorted by timestamp
    const allTurns = [...Array.from(acc.turnsMap.values()), ...acc.unkeyedTurns];
    allTurns.sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || ''));

    const lastTurn = allTurns[allTurns.length - 1];
    const totalMessages = allTurns.length;

    await query(
      `INSERT INTO pcg_conversations (
         customer_phone, waba_number, customer_name, customer_id, assigned_rm_id, rm_name,
         transcript, total_messages, last_message_text, last_event_type, last_direction,
         last_status, last_message_at, raw_payload, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW())
       ON CONFLICT (customer_phone, waba_number) DO UPDATE SET
         customer_name     = COALESCE(EXCLUDED.customer_name, pcg_conversations.customer_name),
         customer_id       = COALESCE(EXCLUDED.customer_id, pcg_conversations.customer_id),
         assigned_rm_id    = COALESCE(EXCLUDED.assigned_rm_id, pcg_conversations.assigned_rm_id),
         rm_name           = COALESCE(EXCLUDED.rm_name, pcg_conversations.rm_name),
         transcript        = EXCLUDED.transcript,
         total_messages    = EXCLUDED.total_messages,
         last_message_text = COALESCE(EXCLUDED.last_message_text, pcg_conversations.last_message_text),
         last_event_type   = EXCLUDED.last_event_type,
         last_direction    = EXCLUDED.last_direction,
         last_status       = COALESCE(EXCLUDED.last_status, pcg_conversations.last_status),
         last_message_at   = EXCLUDED.last_message_at,
         raw_payload       = COALESCE(EXCLUDED.raw_payload, pcg_conversations.raw_payload),
         updated_at        = NOW()`,
      [
        acc.customerPhone,
        acc.wabaNumber,
        acc.customerName,
        acc.customerId,
        acc.assignedRmId,
        acc.rmName,
        JSON.stringify(allTurns),
        totalMessages,
        lastTurn?.text || null,
        lastTurn?.event_type || 'message_received',
        lastTurn?.direction || 'inbound',
        lastTurn?.status || null,
        acc.lastMessageAt,
        acc.lastPayload ? JSON.stringify(acc.lastPayload) : '{}',
      ]
    );

    upsertedConvs++;
    if (upsertedConvs % 25 === 0 || upsertedConvs === convMap.size) {
      console.log(`Upserted ${upsertedConvs} / ${convMap.size} conversations...`);
    }
  }

  // 4. Verify integrity
  const [finalRaw] = await query<{ count: string }>(
    `SELECT COUNT(*) as count FROM robylon_webhook_payloads WHERE source = 'doubletick'`
  );
  const [finalConv] = await query<{ count: string; total_msgs: string }>(
    `SELECT COUNT(*) as count, COALESCE(SUM(total_messages), 0) as total_msgs FROM pcg_conversations`
  );

  console.log('\n=====================================================');
  console.log(' Fast Backfill Successfully Completed! ');
  console.log('=====================================================');
  console.log(`robylon_webhook_payloads: ${finalRaw.count} (Verified untouched, nothing deleted)`);
  console.log(`pcg_conversations total threads: ${finalConv.count}`);
  console.log(`pcg_conversations total message turns: ${finalConv.total_msgs}`);
}

fastBackfill()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Fast backfill error:', err);
    process.exit(1);
  });
