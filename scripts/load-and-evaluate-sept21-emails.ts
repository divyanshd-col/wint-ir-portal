/**
 * scripts/load-and-evaluate-sept21-emails.ts
 *
 * Loads and prepares email evaluations starting from 21 September 2026 (IST).
 * Strict constraint: Only keep conversations that originated on or after 21 September.
 * Any continuations of conversations that began before 21 September are strictly excluded.
 *
 * Submits all eligible loaded email replies to Gemini Batch API for automated quality evaluation.
 */

import './_load-env';
import { query } from '@/lib/cx/db';
import { submitPendingEmailBatchJob } from '@/lib/email/gemini-batch-evaluator';

// 21 September 2026 00:00:00 IST = 2026-09-20 18:30:00 UTC
const SEPT_21_IST_CUTOFF = '2026-09-20T18:30:00.000Z';

interface EmailConversationRow {
  ticketId: string;
  chatId: string;
  subject: string;
  customerEmail: string;
  customerPhone: string | null;
  agentName: string | null;
  createdAt: string;
  rawPayload: any;
}

interface EmailReplyRow {
  ticketId: string;
  messageId: string;
  agentId: string | null;
  agentName: string;
  sentAt: string;
  customerMessage: string;
  agentReplyText: string;
  rawReplyPayload: any;
}

async function main() {
  console.log('========================================================================');
  console.log('     EMAIL INGESTION & EVALUATION: SEPT 21 ONWARDS (NO CONTINUATIONS)    ');
  console.log('========================================================================');
  console.log(`Cutoff timestamp: ${SEPT_21_IST_CUTOFF} (2026-09-21 00:00:00 IST)\n`);

  // Step 1: Identify all conversations (chat_id) that had ANY event before Sept 21.
  console.log('1. Finding conversations that started before 21 September to exclude...');
  const excludedRows = await query(`
    SELECT DISTINCT chat_id
    FROM robylon_webhook_payloads
    WHERE received_at < $1
      AND chat_id IS NOT NULL
  `, [SEPT_21_IST_CUTOFF]);

  const excludedChatIds = new Set<string>(excludedRows.map((r: any) => String(r.chat_id)));
  console.log(`   Found ${excludedChatIds.size} older conversations. All their continuations will be excluded.`);

  // Step 2: Fetch all events for ROBYLON_EMAIL received from Sept 21 onwards
  console.log('\n2. Fetching email events from 21 September onwards...');
  const events = await query(`
    SELECT 
      id,
      chat_id,
      event_type,
      received_at,
      payload
    FROM robylon_webhook_payloads
    WHERE received_at >= $1
      AND payload->>'ticket_provider' = 'ROBYLON_EMAIL'
      AND chat_id IS NOT NULL
    ORDER BY id ASC
  `, [SEPT_21_IST_CUTOFF]);

  console.log(`   Fetched ${events.length} total email events.`);

  // Step 3: Filter by eligible conversations and organize conversation threads
  const convMap = new Map<string, {
    chatId: string;
    ticketId: string;
    subject: string;
    customerEmail: string;
    customerPhone: string | null;
    createdAt: string;
    earliestReceived: string;
    firstPayload: any;
    customerMessages: { text: string; time: string }[];
    replies: EmailReplyRow[];
  }>();

  let skippedOlderContinuations = 0;

  for (const ev of events) {
    const chatId = String(ev.chat_id);
    if (excludedChatIds.has(chatId)) {
      skippedOlderContinuations++;
      continue;
    }

    const payload = ev.payload || {};
    const ticketId = String(payload.ticket_id || payload.data?.ticket_id || `ticket_${chatId}`);

    if (!convMap.has(chatId)) {
      const subject = String(
        payload.data?.message?.subject ||
        payload.subject ||
        payload.data?.subject ||
        'Email Support Request'
      );
      const customerEmail = String(
        payload.requester_info?.email ||
        payload.data?.message?.from_email ||
        payload.user_email ||
        'customer@wintwealth.com'
      );
      const customerPhone = payload.requester_info?.phone_number || payload.data?.requester_info?.phone_number || null;
      const createdAt = payload.created_at || payload.data?.created_at || ev.received_at;

      convMap.set(chatId, {
        chatId,
        ticketId,
        subject,
        customerEmail,
        customerPhone,
        createdAt: new Date(createdAt).toISOString(),
        earliestReceived: ev.received_at,
        firstPayload: payload,
        customerMessages: [],
        replies: [],
      });
    }

    const conv = convMap.get(chatId)!;

    // Track customer messages
    if (ev.event_type === 'NEW_MESSAGE' || ev.event_type === 'TICKET_CREATED') {
      const msgContent = payload.data?.message?.content || payload.data?.content || payload.data?.message?.subject;
      if (msgContent && typeof msgContent === 'string' && msgContent.trim().length > 0) {
        conv.customerMessages.push({
          text: msgContent.trim(),
          time: new Date(payload.data?.message?.created_at || ev.received_at).toISOString(),
        });
      }
    }

    // Track agent replies
    if (ev.event_type === 'REPLY_SENT') {
      const agentName = String(
        payload.human_agent_info?.name ||
        payload.handled_by_name ||
        payload.data?.handled_by_name ||
        ''
      ).trim();

      // Only evaluate human agent replies with actual content
      const replyContent = String(
        payload.data?.message?.content ||
        payload.data?.content ||
        ''
      ).trim();

      if (agentName && replyContent.length > 0) {
        const messageId = String(
          payload.data?.message?.message_id ||
          payload.data?.message_id ||
          `msg_${chatId}_${ev.id}`
        );
        const agentId = String(payload.human_agent_info?.agent_id || payload.handled_by_id || '');
        const sentAt = new Date(
          payload.data?.message?.created_at ||
          payload.created_at ||
          ev.received_at
        ).toISOString();

        // Pair with the most recent customer message before this reply
        let customerMsg = conv.subject;
        if (conv.customerMessages.length > 0) {
          const priorCustomerMsgs = conv.customerMessages.filter(m => m.time <= sentAt);
          if (priorCustomerMsgs.length > 0) {
            customerMsg = priorCustomerMsgs[priorCustomerMsgs.length - 1].text;
          } else {
            customerMsg = conv.customerMessages[0].text;
          }
        }

        conv.replies.push({
          ticketId: conv.ticketId,
          messageId,
          agentId: agentId || null,
          agentName,
          sentAt,
          customerMessage: customerMsg,
          agentReplyText: replyContent,
          rawReplyPayload: payload,
        });
      }
    }
  }

  console.log(`   Skipped ${skippedOlderContinuations} event records belonging to older threads (prior to Sept 21).`);
  console.log(`   Eligible conversations starting >= Sept 21: ${convMap.size}`);

  // Collect all conversations and replies
  const allConversations: EmailConversationRow[] = [];
  const allReplies: EmailReplyRow[] = [];

  for (const conv of convMap.values()) {
    if (conv.replies.length > 0) {
      allConversations.push({
        ticketId: conv.ticketId,
        chatId: conv.chatId,
        subject: conv.subject,
        customerEmail: conv.customerEmail,
        customerPhone: conv.customerPhone,
        agentName: conv.replies[0]?.agentName || null,
        createdAt: conv.createdAt,
        rawPayload: conv.firstPayload,
      });

      for (const r of conv.replies) {
        allReplies.push(r);
      }
    }
  }

  console.log(`   Conversations with evaluated replies: ${allConversations.length}`);
  console.log(`   Total human agent replies to insert/evaluate: ${allReplies.length}`);

  // Agent breakdown
  const agentCounts: Record<string, number> = {};
  for (const r of allReplies) {
    agentCounts[r.agentName] = (agentCounts[r.agentName] || 0) + 1;
  }
  console.log('\nAgent distribution:', agentCounts);

  // Step 4: Upsert conversations into email_conversations in batches
  console.log('\n3. Upserting email_conversations into database...');
  const BATCH_SIZE = 100;
  for (let i = 0; i < allConversations.length; i += BATCH_SIZE) {
    const chunk = allConversations.slice(i, i + BATCH_SIZE);
    for (const c of chunk) {
      await query(`
        INSERT INTO email_conversations
          (id, chat_id, subject_line, customer_email, customer_phone, agent_name, status, created_at, raw_payload)
        VALUES ($1, $2, $3, $4, $5, $6, 'OPEN', $7, $8)
        ON CONFLICT (id) DO UPDATE SET
          subject_line = EXCLUDED.subject_line,
          customer_email = EXCLUDED.customer_email,
          agent_name = COALESCE(EXCLUDED.agent_name, email_conversations.agent_name),
          updated_at = NOW()
      `, [
        c.ticketId,
        c.chatId,
        c.subject,
        c.customerEmail,
        c.customerPhone,
        c.agentName,
        c.createdAt,
        JSON.stringify(c.rawPayload),
      ]);
    }
    process.stdout.write(`   Saved conversations: ${Math.min(i + BATCH_SIZE, allConversations.length)} / ${allConversations.length}\r`);
  }
  console.log(`\n   ✓ Saved ${allConversations.length} email conversations.`);

  // Step 5: Upsert replies into email_reply_evaluations
  console.log('\n4. Upserting email_reply_evaluations with status "Pending"...');
  let insertedCount = 0;
  for (let i = 0; i < allReplies.length; i += BATCH_SIZE) {
    const chunk = allReplies.slice(i, i + BATCH_SIZE);
    for (const r of chunk) {
      await query(`
        INSERT INTO email_reply_evaluations
          (ticket_id, message_id, agent_id, agent_name, sent_at, customer_message, agent_reply_text, raw_reply_payload, evaluation_status)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'Pending')
        ON CONFLICT (message_id) DO UPDATE SET
          customer_message = EXCLUDED.customer_message,
          agent_reply_text = EXCLUDED.agent_reply_text,
          agent_name = EXCLUDED.agent_name,
          updated_at = NOW()
        WHERE email_reply_evaluations.evaluation_status != 'Completed'
      `, [
        r.ticketId,
        r.messageId,
        r.agentId,
        r.agentName,
        r.sentAt,
        r.customerMessage,
        r.agentReplyText,
        JSON.stringify(r.rawReplyPayload),
      ]);
      insertedCount++;
    }
    process.stdout.write(`   Saved replies: ${Math.min(i + BATCH_SIZE, allReplies.length)} / ${allReplies.length}\r`);
  }
  console.log(`\n   ✓ Processed ${insertedCount} email replies.`);

  // Check how many are currently Pending
  const pendingCheck = await query(`
    SELECT COUNT(*) as pending_count
    FROM email_reply_evaluations
    WHERE evaluation_status = 'Pending'
  `);
  const pendingTotal = Number(pendingCheck[0]?.pending_count || 0);
  console.log(`\n   Total pending replies awaiting evaluation in database: ${pendingTotal}`);

  if (pendingTotal === 0) {
    console.log('No pending replies to submit to Gemini Batch.');
    return;
  }

  // Step 6: Submit to Gemini Batch API in chunks of up to 1,000
  console.log('\n5. Submitting pending evaluations to Gemini Batch API...');
  const GEMINI_CHUNK_SIZE = 1000;
  const createdBatchJobs: { jobName: string; count: number }[] = [];

  let remaining = pendingTotal;
  let batchNumber = 1;

  while (remaining > 0) {
    const currentLimit = Math.min(remaining, GEMINI_CHUNK_SIZE);
    console.log(`\n   Submitting Gemini Batch Job #${batchNumber} (limit: ${currentLimit})...`);

    const result = await submitPendingEmailBatchJob({ limit: currentLimit });
    if (!result.success || result.count === 0) {
      console.warn(`   Notice: ${result.message || 'No batch job created'}`);
      break;
    }

    createdBatchJobs.push({
      jobName: result.batchJobName || `batch_${batchNumber}`,
      count: result.count,
    });
    console.log(`   ✓ Batch #${batchNumber} submitted successfully!`);
    console.log(`     Batch ID: ${result.batchJobName}`);
    console.log(`     Items in batch: ${result.count}`);

    remaining -= result.count;
    batchNumber++;
  }

  // Summary
  console.log('\n========================================================================');
  console.log('                          EXECUTION SUMMARY                             ');
  console.log('========================================================================');
  console.log(`Conversations starting >= Sept 21: ${allConversations.length}`);
  console.log(`Total Email Replies Loaded:        ${allReplies.length}`);
  console.log(`Batches Submitted to Gemini:      ${createdBatchJobs.length}`);
  for (const b of createdBatchJobs) {
    console.log(`  • ${b.jobName}: ${b.count} replies`);
  }
  console.log('\nAll eligible emails starting from 21 Sept are now loaded and in-batch processing!');
}

main().catch(err => {
  console.error('\n❌ Ingestion error:', err);
  process.exit(1);
});
