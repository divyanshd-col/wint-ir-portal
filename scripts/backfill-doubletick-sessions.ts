import './_load-env';
import { query } from '../lib/cx/db';
import { type DoubleTickTranscriptItem, PCG_INACTIVITY_MS } from '../lib/pcg/doubletick';

function toIso(ts: any): string {
  if (!ts) return new Date(0).toISOString();
  if (ts instanceof Date) return ts.toISOString();
  if (typeof ts === 'number') return new Date(ts).toISOString();
  const s = String(ts).trim();
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString();
  return s;
}

async function runSessionBackfill() {
  console.log('=====================================================');
  console.log(' Starting 48-Hour Session-Based DoubleTick Backfill');
  console.log('=====================================================');

  // 1. Fetch all DoubleTick payloads chronologically
  console.log('Fetching all raw DoubleTick payloads from DB...');
  const rows = await query<{ id: number; payload: any; received_at: string }>(
    `SELECT id, payload, received_at 
     FROM pcg_webhook_payloads 
     WHERE source = 'doubletick' 
     ORDER BY id ASC`
  );

  console.log(`Fetched ${rows.length} payloads. Grouping into customer threads in memory...`);

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
  }

  const convMap = new Map<string, ConvAccumulator>();
  let totalParsedItems = 0;

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
      const rawTime = item.statusTimestamp || item.receivedAt || item['Sent At'] || r.received_at || new Date().toISOString();
      const messageTime = toIso(rawTime);

      if (messageId && acc.turnsMap.has(messageId)) {
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

  console.log(`Parsed ${totalParsedItems} message events into ${convMap.size} customer contacts.`);

  // 2. Clear existing pcg_conversations to rebuild with distinct session rows
  console.log('Truncating pcg_conversations to repopulate session records...');
  await query('TRUNCATE pcg_conversations RESTART IDENTITY CASCADE');

  interface SessionToInsert {
    customerPhone: string;
    wabaNumber: string;
    customerName: string | null;
    customerId: string | null;
    assignedRmId: string | null;
    rmName: string | null;
    sessionTurns: DoubleTickTranscriptItem[];
    totalMessages: number;
    lastTurn: DoubleTickTranscriptItem | null;
    sessionLastTime: string;
    rawPayload: any;
    convStatus: string;
    closedAt: string | null;
    sessionFirstTime: string;
  }

  const allSessionsToInsert: SessionToInsert[] = [];
  let closedSessions = 0;
  let openSessions = 0;

  for (const acc of convMap.values()) {
    const allTurns = [...Array.from(acc.turnsMap.values()), ...acc.unkeyedTurns];
    allTurns.sort((a, b) => toIso(a.timestamp).localeCompare(toIso(b.timestamp)));

    // Segment into 48-hour sessions
    const sessions: DoubleTickTranscriptItem[][] = [];
    let currentSession: DoubleTickTranscriptItem[] = [];

    for (let i = 0; i < allTurns.length; i++) {
      const turn = allTurns[i];
      if (currentSession.length === 0) {
        currentSession.push(turn);
      } else {
        const prev = currentSession[currentSession.length - 1];
        const prevTime = new Date(toIso(prev.timestamp)).getTime();
        const curTime = new Date(toIso(turn.timestamp)).getTime();
        const gapMs = !isNaN(prevTime) && !isNaN(curTime) ? curTime - prevTime : 0;

        if (gapMs >= PCG_INACTIVITY_MS) {
          sessions.push(currentSession);
          currentSession = [turn];
        } else {
          currentSession.push(turn);
        }
      }
    }
    if (currentSession.length > 0) {
      sessions.push(currentSession);
    }

    // Prepare each session for insertion
    for (const sessionTurns of sessions) {
      const firstTurn = sessionTurns[0];
      const lastTurn = sessionTurns[sessionTurns.length - 1];
      const totalMessages = sessionTurns.length;
      const sessionFirstTime = toIso(firstTurn.timestamp);
      const sessionLastTime = toIso(lastTurn.timestamp);

      const lastMs = new Date(sessionLastTime).getTime();
      const isOld = !isNaN(lastMs) && (Date.now() - lastMs >= PCG_INACTIVITY_MS);
      const convStatus = isOld ? 'CLOSED' : 'OPEN';
      const closedAt = isOld && !isNaN(lastMs)
        ? new Date(lastMs + PCG_INACTIVITY_MS).toISOString()
        : null;

      if (convStatus === 'CLOSED') closedSessions++; else openSessions++;

      allSessionsToInsert.push({
        customerPhone: acc.customerPhone,
        wabaNumber: acc.wabaNumber,
        customerName: acc.customerName,
        customerId: acc.customerId,
        assignedRmId: acc.assignedRmId,
        rmName: acc.rmName,
        sessionTurns,
        totalMessages,
        lastTurn: lastTurn || null,
        sessionLastTime,
        rawPayload: acc.lastPayload,
        convStatus,
        closedAt,
        sessionFirstTime,
      });
    }
  }

  console.log(`Total sessions to insert: ${allSessionsToInsert.length} (${closedSessions} CLOSED, ${openSessions} OPEN)`);
  console.log('Inserting sessions in batches of 50...');

  const BATCH_SIZE = 50;
  for (let i = 0; i < allSessionsToInsert.length; i += BATCH_SIZE) {
    const batch = allSessionsToInsert.slice(i, i + BATCH_SIZE);
    const values: any[] = [];
    const valueClauses: string[] = [];

    batch.forEach((item, rowIdx) => {
      const offset = rowIdx * 17;
      valueClauses.push(
        `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}, $${offset + 11}, $${offset + 12}, $${offset + 13}, $${offset + 14}, $${offset + 15}, $${offset + 16}, $${offset + 17}, NOW())`
      );
      values.push(
        item.customerPhone,
        item.wabaNumber,
        item.customerName,
        item.customerId,
        item.assignedRmId,
        item.rmName,
        JSON.stringify(item.sessionTurns),
        item.totalMessages,
        item.lastTurn?.text || null,
        item.lastTurn?.event_type || 'message_received',
        item.lastTurn?.direction || 'inbound',
        item.lastTurn?.status || null,
        item.sessionLastTime,
        item.rawPayload ? JSON.stringify(item.rawPayload) : '{}',
        item.convStatus,
        item.closedAt,
        item.sessionFirstTime
      );
    });

    const sql = `
      INSERT INTO pcg_conversations (
        customer_phone, waba_number, customer_name, customer_id, assigned_rm_id, rm_name,
        transcript, total_messages, last_message_text, last_event_type, last_direction,
        last_status, last_message_at, raw_payload, status, closed_at, created_at, updated_at
      ) VALUES ${valueClauses.join(', ')}
    `;

    await query(sql, values);
    const progress = Math.min(i + BATCH_SIZE, allSessionsToInsert.length);
    if (progress % 250 === 0 || progress === allSessionsToInsert.length) {
      console.log(`  Inserted ${progress} / ${allSessionsToInsert.length} sessions...`);
    }
  }

  console.log(`\n=====================================================`);
  console.log(`🎉 48-Hour Session Backfill Complete!`);
  console.log(`   - Total Conversation Sessions: ${allSessionsToInsert.length}`);
  console.log(`   - CLOSED Sessions: ${closedSessions}`);
  console.log(`   - OPEN Sessions:   ${openSessions}`);
  console.log(`=====================================================`);
}

runSessionBackfill()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('❌ Error during backfill:', e);
    process.exit(1);
  });
