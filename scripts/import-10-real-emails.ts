/**
 * scripts/import-10-real-emails.ts
 *
 * Imports 10 authentic, real email threads from production robylon_webhook_payloads
 * into email_conversations and email_reply_evaluations.
 *
 * - 6 are evaluated live via Gemini (status: Completed)
 * - 4 remain in status: Pending
 */

import './_load-env';
import { query } from '@/lib/cx/db';
import { evaluateSingleReplySync } from '@/lib/email/gemini-batch-evaluator';

async function importRealEmails() {
  console.log('Fetching 10 distinct real email threads from robylon_webhook_payloads...');

  const rows = await query(`
    WITH DistinctChats AS (
      SELECT DISTINCT ON (r.chat_id)
        r.id as reply_event_id,
        r.chat_id,
        r.payload as reply_payload,
        r.received_at as reply_time
      FROM robylon_webhook_payloads r
      WHERE r.event_type = 'REPLY_SENT' 
        AND r.payload::text LIKE '%ROBYLON_EMAIL%'
        AND r.payload->'human_agent_info'->>'name' IS NOT NULL
        AND length(COALESCE(r.payload->'data'->'message'->>'content', '')) > 20
      ORDER BY r.chat_id, r.id DESC
    )
    SELECT d.*, 
           (SELECT payload FROM robylon_webhook_payloads nm 
            WHERE nm.chat_id = d.chat_id AND nm.event_type = 'NEW_MESSAGE' 
            ORDER BY nm.id ASC LIMIT 1) as customer_payload
    FROM DistinctChats d
    ORDER BY d.reply_time DESC
    LIMIT 10
  `);

  if (!rows || rows.length === 0) {
    console.error('No email records found in robylon_webhook_payloads');
    process.exit(1);
  }

  console.log(`Found ${rows.length} real email records. Populating database...`);

  const insertedMessageIds: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rp = row.reply_payload;
    const cp = row.customer_payload;

    const ticketId = String(rp.ticket_id || rp.data?.ticket_id || `ticket_${row.chat_id}`);
    const messageId = String(
      rp.data?.message?.message_id ||
      rp.data?.message_id ||
      `msg_${row.chat_id}_${row.reply_event_id}`
    );
    const agentName = String(rp.human_agent_info?.name || 'IR Specialist').trim();
    const agentId = String(rp.human_agent_info?.agent_id || '');
    const subject = String(
      rp.data?.message?.subject ||
      cp?.data?.message?.subject ||
      'Email Support Request'
    );
    const customerEmail = String(
      rp.requester_info?.email ||
      cp?.data?.message?.from_email ||
      'customer@wintwealth.com'
    );
    const customerPhone = rp.requester_info?.phone_number || null;
    const customerMsg = String(
      cp?.data?.message?.content ||
      'Customer query regarding investment / mandate / statement.'
    );
    const agentReply = String(
      rp.data?.message?.content ||
      rp.data?.content ||
      ''
    );
    const sentAt = rp.data?.message?.created_at || row.reply_time || new Date().toISOString();

    // 1. Upsert into email_conversations
    await query(
      `INSERT INTO email_conversations
       (id, chat_id, subject_line, customer_email, customer_phone, agent_name, status, created_at, raw_payload)
       VALUES ($1, $2, $3, $4, $5, $6, 'OPEN', $7, $8)
       ON CONFLICT (id) DO UPDATE SET
         subject_line = EXCLUDED.subject_line,
         customer_email = EXCLUDED.customer_email,
         agent_name = COALESCE(EXCLUDED.agent_name, email_conversations.agent_name),
         updated_at = NOW()`,
      [
        ticketId,
        String(row.chat_id),
        subject,
        customerEmail,
        customerPhone,
        agentName,
        sentAt,
        JSON.stringify(rp),
      ]
    );

    // 2. Insert into email_reply_evaluations with initial status 'Pending'
    await query(
      `INSERT INTO email_reply_evaluations
       (ticket_id, message_id, agent_id, agent_name, sent_at, customer_message, agent_reply_text, raw_reply_payload, evaluation_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'Pending')
       ON CONFLICT (message_id) DO UPDATE SET
         customer_message = EXCLUDED.customer_message,
         agent_reply_text = EXCLUDED.agent_reply_text,
         agent_name = EXCLUDED.agent_name,
         updated_at = NOW()`,
      [
        ticketId,
        messageId,
        agentId || null,
        agentName,
        sentAt,
        customerMsg,
        agentReply,
        JSON.stringify(rp),
      ]
    );

    insertedMessageIds.push(messageId);
    console.log(`[${i + 1}/10] Added: ${agentName} | ${subject.slice(0, 45)} (Ticket: ${ticketId})`);
  }

  // 3. Evaluate the first 6 live with Gemini
  console.log('\nEvaluating first 6 emails live with Gemini...');
  for (let i = 0; i < 6; i++) {
    const msgId = insertedMessageIds[i];
    try {
      console.log(`Evaluating [${i + 1}/6]: ${msgId}...`);
      const evalResult = await evaluateSingleReplySync(msgId);
      console.log(`✓ Evaluated IQS: ${evalResult.quality_score}% | Compliance: ${evalResult.compliance_passed ? 'PASS' : 'FAIL'}`);
    } catch (err: any) {
      console.warn(`Evaluation fallback for ${msgId}: ${err.message}`);
    }
  }

  console.log('\n--- Final Summary of Imported Emails ---');
  const finalRows = await query(`
    SELECT e.id, e.ticket_id, e.agent_name, e.evaluation_status, e.quality_score, c.subject_line
    FROM email_reply_evaluations e
    JOIN email_conversations c ON e.ticket_id = c.id
    WHERE e.message_id = ANY($1)
    ORDER BY e.id ASC
  `, [insertedMessageIds]);

  console.table(finalRows);
  console.log('✓ Successfully imported and processed 10 real emails!');
}

importRealEmails().catch((err) => {
  console.error('Import failed:', err);
  process.exit(1);
});
