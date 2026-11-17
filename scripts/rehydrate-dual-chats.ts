import './_load-env';
import { query } from '../lib/cx/db';
import { STATIC_PCG_DIRECTORY } from '../lib/pcg/rm-directory';
import { isPcgAm, canonicalizePcgRmName } from '../lib/pcg/canonical-names';

interface AgentInfo {
  name: string;
  role: 'rm' | 'am' | 'tl';
  tl: string;
  phone: string;
}

interface WebhookItemMatch {
  agentPhone: string;
  agentName: string;
  role: 'rm' | 'am' | 'tl';
  tl: string;
  msgId: string | null;
  text: string | null;
  time: string;
}

async function main() {
  const isApply = process.argv.includes('--apply');
  console.log('========================================================================');
  console.log(' 🔄 PCG Dual Chats Rehydration & Handoff Detection Script');
  console.log(` 🚀 Mode: ${isApply ? 'APPLY (Writing changes to Neon DB)' : 'DRY RUN (Simulate only)'}`);
  console.log('========================================================================\n');

  // 1. Build Agent Phone Directory
  console.log('Step 1: Loading agent directory...');
  const dirRows = await query<any>('SELECT * FROM pcg_rm_directory');
  const allDir = dirRows.length > 0 ? dirRows : STATIC_PCG_DIRECTORY;

  const phoneToAgent = new Map<string, AgentInfo>();

  function registerAgent(phoneRaw: string | null | undefined, nameRaw: string, tlRaw: string) {
    if (!phoneRaw) return;
    const cleanPhone = String(phoneRaw).replace(/\D/g, '');
    if (!cleanPhone) return;
    const canonicalName = canonicalizePcgRmName(nameRaw);
    const role: 'rm' | 'am' | 'tl' = isPcgAm(canonicalName) ? 'am' : 'rm';
    const tl = tlRaw?.startsWith('Team ') ? tlRaw : `Team ${tlRaw || 'Admin'}`;

    const info: AgentInfo = {
      name: canonicalName,
      role,
      tl,
      phone: cleanPhone,
    };

    phoneToAgent.set(cleanPhone, info);
    if (cleanPhone.length >= 10) {
      phoneToAgent.set(cleanPhone.slice(-10), info);
      phoneToAgent.set('91' + cleanPhone.slice(-10), info);
    }
  }

  for (const entry of allDir) {
    registerAgent(entry.phone_number || entry.phone, entry.rm_name || entry.rm, entry.tl_name || entry.team);
  }
  for (const entry of STATIC_PCG_DIRECTORY) {
    registerAgent(entry.phone_number, entry.rm_name, entry.tl_name);
  }
  console.log(`Indexed ${phoneToAgent.size} phone mappings for RMs, AMs, and TLs.\n`);

  // 2. Load and index all DoubleTick webhook payloads
  console.log('Step 2: Indexing DoubleTick webhook payloads from pcg_webhook_payloads...');
  const webhookRows = await query<any>('SELECT id, payload FROM pcg_webhook_payloads ORDER BY id ASC');
  console.log(`Loaded ${webhookRows.length} raw webhook records.`);

  const byMsgId = new Map<string, WebhookItemMatch>();
  const byCustAndTime = new Map<string, WebhookItemMatch[]>();
  const byCustAndText = new Map<string, WebhookItemMatch[]>();

  for (const row of webhookRows) {
    const raw = row.payload;
    const items = Array.isArray(raw) ? raw : (raw?.data && Array.isArray(raw.data) ? raw.data : [raw]);
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;

      const isStatusUpdate = !!(item.status || item.statusTimestamp);
      const dirStr = String(item.Direction || '').toLowerCase();
      const isOutbound = dirStr.includes('agent') || dirStr.includes('outbound') || isStatusUpdate;
      if (!isOutbound) continue;

      const rawAgentPhone = item.sentBy || item.assignedTo || item['Sent By'] || item['Assigned Agent'] || item.userId || null;
      if (!rawAgentPhone) continue;

      const cleanAgentPhone = String(rawAgentPhone).replace(/\D/g, '');
      const agentInfo = phoneToAgent.get(cleanAgentPhone) || phoneToAgent.get(cleanAgentPhone.slice(-10));
      if (!agentInfo) continue;

      const rawCustPhone = item['Customer Phone'] || item.to || item.phone || null;
      const cleanCustPhone = rawCustPhone ? String(rawCustPhone).replace(/\D/g, '') : '';
      const msgId = item.dtMessageId || item.messageId || item['Message ID'] || item.id || null;
      const text = item.message?.text || item.message?.caption || item['Content'] || (item.message?.templateMessage?.body?.text) || null;
      const time = item.statusTimestamp || item.receivedAt || item['Sent At'] || '';

      const match: WebhookItemMatch = {
        agentPhone: cleanAgentPhone,
        agentName: agentInfo.name,
        role: agentInfo.role,
        tl: agentInfo.tl,
        msgId: msgId ? String(msgId) : null,
        text: text ? String(text).trim() : null,
        time,
      };

      if (msgId) {
        byMsgId.set(String(msgId), match);
      }
      if (cleanCustPhone) {
        const listTime = byCustAndTime.get(cleanCustPhone) || [];
        listTime.push(match);
        byCustAndTime.set(cleanCustPhone, listTime);

        if (text) {
          const listText = byCustAndText.get(cleanCustPhone) || [];
          listText.push(match);
          byCustAndText.set(cleanCustPhone, listText);
        }
      }
    }
  }

  console.log(`Indexed ${byMsgId.size} outbound turns by Message ID.`);
  console.log(`Indexed outbounds for ${byCustAndTime.size} distinct customer phone numbers.\n`);

  // 3. Process all evaluations in pcg_chat_evaluations
  console.log('Step 3: Analyzing all evaluations in pcg_chat_evaluations...');
  const evals = await query<any>(`
    SELECT e.id as eval_id, e.conversation_id, e.customer_phone, e.rm_name, e.tl_name, e.is_am, e.preceding_rm_name,
           c.id as conv_id, c.transcript as conv_transcript, e.transcript_turns, c.rm_name as conv_rm_name,
           c.is_am as conv_is_am
    FROM pcg_chat_evaluations e
    LEFT JOIN pcg_conversations c ON c.id = e.conversation_id
    ORDER BY e.id ASC
  `);

  console.log(`Total evaluations loaded: ${evals.length}`);

  let dualChatsCount = 0;
  const dualChats: Array<{
    evalId: number | string;
    convId: number | string;
    customerPhone: string;
    precedingRm: string;
    assignedAm: string;
    agentsFound: string[];
    turnsCount: number;
  }> = [];

  const updateQueue: Array<() => Promise<void>> = [];

  for (const ev of evals) {
    const rawTurns = ev.conv_transcript || ev.transcript_turns || [];
    const turns: any[] = Array.isArray(rawTurns) ? rawTurns : (typeof rawTurns === 'string' ? JSON.parse(rawTurns) : []);
    if (!turns || turns.length === 0) continue;

    const custPhone = String(ev.customer_phone).replace(/\D/g, '');
    const custTimeList = byCustAndTime.get(custPhone) || [];
    const custTextList = byCustAndText.get(custPhone) || [];

    let hasTurnChanges = false;
    let handoffTurnIndex = -1;
    let detectedPrecedingRm: string | null = null;
    let detectedAm: string | null = null;
    let foundRm: string | null = null;
    let foundAm: string | null = null;
    let priorRmInTurns: string | null = null;
    const agentsInConv = new Set<string>();

    // Pass 1: Match agent metadata
    for (let i = 0; i < turns.length; i++) {
      const t = turns[i];
      const isOutbound = t.direction === 'outbound' || t.speaker === 'RM' || t.speaker === 'AM';
      if (!isOutbound) continue;

      let matchedAgent: WebhookItemMatch | null = null;

      if (t.message_id && byMsgId.has(String(t.message_id))) {
        matchedAgent = byMsgId.get(String(t.message_id))!;
      }
      if (!matchedAgent && t.timestamp && custTimeList.length > 0) {
        const tTime = new Date(t.timestamp).getTime();
        matchedAgent = custTimeList.find(m => Math.abs(new Date(m.time).getTime() - tTime) <= 5000) || null;
      }
      if (!matchedAgent && t.text && custTextList.length > 0) {
        const cleanTText = String(t.text).trim().slice(0, 30);
        matchedAgent = custTextList.find(m => m.text && m.text.startsWith(cleanTText)) || null;
      }

      if (matchedAgent) {
        const agentName = matchedAgent.agentName;
        const role = matchedAgent.role;
        const speaker = role === 'am' ? 'AM' : 'RM';

        if (t.agent_name !== agentName || t.role !== role || t.speaker !== speaker) {
          t.agent_name = agentName;
          t.agent_phone = matchedAgent.agentPhone;
          t.role = role;
          t.speaker = speaker;
          hasTurnChanges = true;
        }
        agentsInConv.add(agentName);
      } else if (t.agent_name) {
        agentsInConv.add(t.agent_name);
      }
    }

    // Pass 2: Detect handoff
    for (let i = 0; i < turns.length; i++) {
      const t = turns[i];
      const isOutbound = t.direction === 'outbound' || t.speaker === 'RM' || t.speaker === 'AM';
      if (!isOutbound) continue;

      const agent = t.agent_name;
      const role = t.role || (agent && isPcgAm(agent) ? 'am' : 'rm');

      if (role === 'rm' && agent) {
        if (!foundRm) foundRm = agent;
        priorRmInTurns = agent;
      } else if (role === 'am' && agent) {
        if (!foundAm) foundAm = agent;
        if (priorRmInTurns && handoffTurnIndex === -1) {
          handoffTurnIndex = i;
          detectedPrecedingRm = priorRmInTurns;
          detectedAm = agent;
          t.is_handoff = true;
          t.handoff_note = `Conversation handed off to AM (${agent})`;
          hasTurnChanges = true;
        }
      }
    }

    if (!handoffTurnIndex && foundAm && foundRm) {
      detectedAm = foundAm;
      detectedPrecedingRm = foundRm;
      for (let i = 0; i < turns.length; i++) {
        const t = turns[i];
        if (t.role === 'am' || t.speaker === 'AM') {
          t.is_handoff = true;
          t.handoff_note = `Co-handled with AM (${foundAm})`;
          hasTurnChanges = true;
          break;
        }
      }
    }

    const isDualChat = (foundRm && foundAm) || (detectedPrecedingRm && detectedAm) || (ev.preceding_rm_name && ev.is_am);

    if (isDualChat) {
      dualChatsCount++;
      const preceding = detectedPrecedingRm || foundRm || ev.preceding_rm_name!;
      const am = detectedAm || foundAm || ev.rm_name;

      dualChats.push({
        evalId: ev.eval_id,
        convId: ev.conv_id || ev.conversation_id,
        customerPhone: ev.customer_phone,
        precedingRm: preceding,
        assignedAm: am,
        agentsFound: Array.from(agentsInConv),
        turnsCount: turns.length,
      });

      if (isApply) {
        updateQueue.push(async () => {
          if (ev.conv_id || ev.conversation_id) {
            const convId = ev.conv_id || ev.conversation_id;
            await query(`
              UPDATE pcg_conversations
              SET transcript = $1,
                  rm_name = $2,
                  is_am = true,
                  updated_at = NOW()
              WHERE id = $3
            `, [JSON.stringify(turns), am, convId]);
          }

          await query(`
            UPDATE pcg_chat_evaluations
            SET transcript_turns = $1,
                rm_name = $2,
                tl_name = 'Team Swetha',
                preceding_rm_name = $3,
                is_am = true,
                updated_at = NOW()
            WHERE id = $4
          `, [JSON.stringify(turns), am, preceding, ev.eval_id]);
        });
      }
    } else if (hasTurnChanges && isApply) {
      updateQueue.push(async () => {
        if (ev.conv_id || ev.conversation_id) {
          await query(`
            UPDATE pcg_conversations
            SET transcript = $1,
                updated_at = NOW()
            WHERE id = $2
          `, [JSON.stringify(turns), ev.conv_id || ev.conversation_id]);
        }
        await query(`
          UPDATE pcg_chat_evaluations
          SET transcript_turns = $1,
              updated_at = NOW()
          WHERE id = $2
        `, [JSON.stringify(turns), ev.eval_id]);
      });
    }
  }

  console.log('========================================================================');
  console.log(` 🎯 Total Evaluated Chats Analyzed:  ${evals.length}`);
  console.log(` 🤝 Total Dual (Co-Handled) Chats:   ${dualChatsCount}`);
  console.log('========================================================================\n');

  console.log('All Identified Dual Chats:');
  console.table(dualChats);

  if (isApply) {
    console.log(`\nStep 4: Writing ${updateQueue.length} database updates in parallel batches...`);
    const batchSize = 10;
    let completed = 0;

    for (let i = 0; i < updateQueue.length; i += batchSize) {
      const batch = updateQueue.slice(i, i + batchSize);
      await Promise.all(batch.map(fn => fn()));
      completed += batch.length;
      if (completed % 50 === 0 || completed === updateQueue.length) {
        process.stdout.write(`\rSaved ${completed} / ${updateQueue.length} records...`);
      }
    }
    console.log('\n\n✅ Successfully updated database for all dual chats and transcripts!');
  } else {
    console.log('\n⚠️ This was a DRY RUN. Run with `--apply` to write updates to database.');
  }

  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error during dual chat rehydration:', err);
  process.exit(1);
});
