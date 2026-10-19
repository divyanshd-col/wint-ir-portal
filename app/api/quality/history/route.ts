import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-guard';
import { getConversationHistory } from '@/lib/robylon/db';
import { query } from '@/lib/cx/db';

export async function GET(req: NextRequest) {
  const { session, response } = await requireRole(['admin', 'quality', 'tl', 'agent']);
  if (response) return response;

  const url = new URL(req.url);
  const chatId = (url.searchParams.get('chatId') || '').trim();
  let customerEmail = (url.searchParams.get('customerEmail') || url.searchParams.get('email') || '').trim();
  const ticketId = (url.searchParams.get('ticketId') || '').trim();
  let customerPhone = (url.searchParams.get('phone') || '').trim();

  // If customerEmail is missing but ticketId or chatId is provided, look up in email_conversations
  if (!customerEmail && (ticketId || chatId)) {
    try {
      const ticketRes = await query<{ customer_email: string; customer_phone: string; chat_id: string }>(
        `SELECT customer_email, customer_phone, chat_id 
         FROM email_conversations 
         WHERE id = $1 OR chat_id = $1 
         LIMIT 1`,
        [ticketId || chatId]
      );
      if (ticketRes[0]?.customer_email) {
        customerEmail = ticketRes[0].customer_email.trim();
      }
      if (ticketRes[0]?.customer_phone && !customerPhone) {
        customerPhone = ticketRes[0].customer_phone.trim();
      }
    } catch {}
  }

  // Also lookup customerPhone from email_conversations if missing
  if (!customerPhone && customerEmail) {
    try {
      const phoneRes = await query<{ customer_phone: string }>(
        `SELECT customer_phone FROM email_conversations 
         WHERE customer_phone IS NOT NULL AND customer_phone <> ''
           AND LOWER(TRIM(customer_email)) = LOWER(TRIM($1))
         LIMIT 1`,
        [customerEmail]
      );
      if (phoneRes[0]?.customer_phone) {
        customerPhone = phoneRes[0].customer_phone.trim();
      }
    } catch {}
  }

  if (!chatId && !customerEmail && !ticketId) {
    return NextResponse.json({ error: 'chatId or customerEmail or ticketId required' }, { status: 400 });
  }

  try {
    const combinedHistory: any[] = [];
    const seenKeys = new Set<string>();

    // 1. Fetch email interaction history
    if (customerEmail || ticketId || chatId) {
      try {
        const emailRows = await query<any>(
          `SELECT 
             e.id AS "evalId",
             e.message_id AS "messageId",
             c.id AS "ticketId",
             c.chat_id AS "chatId",
             COALESCE(e.sent_at, c.created_at)::text AS "date",
             COALESCE(e.agent_name, c.agent_name, 'IR Specialist') AS "agentName",
             COALESCE(NULLIF(c.subject_line, ''), 'Email Support Request') AS "subject",
             c.status AS "convStatus",
             e.evaluation_status AS "evalStatus",
             COALESCE(e.qa_override_score, e.quality_score) AS "iqs",
             e.customer_message AS "customerMessage",
             e.agent_reply_text AS "agentReply"
           FROM email_conversations c
           LEFT JOIN email_reply_evaluations e ON e.ticket_id = c.id
           WHERE (
             ($1 <> '' AND LOWER(TRIM(c.customer_email)) = LOWER(TRIM($1)))
             OR ($2 <> '' AND (c.id = $2 OR c.chat_id = $2))
             OR ($3 <> '' AND (c.id = $3 OR c.chat_id = $3))
           )
           ORDER BY COALESCE(e.sent_at, c.created_at) DESC
           LIMIT 50`,
          [customerEmail, ticketId, chatId]
        );

        for (const er of emailRows) {
          const key = `email_${er.messageId || er.evalId || er.ticketId}`;
          if (seenKeys.has(key)) continue;
          seenKeys.add(key);

          combinedHistory.push({
            id: er.messageId || er.evalId || er.ticketId,
            messageId: er.messageId || null,
            ticketId: er.ticketId,
            chatId: er.chatId || er.ticketId,
            channel: 'email',
            date: er.date ? String(er.date).slice(0, 10) : '',
            agentName: er.agentName || 'Agent',
            subject: er.subject || 'Email Support',
            disposition: er.subject || 'Email Support',
            subDisposition: '',
            iqs: er.iqs != null ? Number(er.iqs) : null,
            csat: er.evalStatus || er.convStatus || 'Completed',
            status: er.evalStatus || er.convStatus || 'Completed',
            customerMessage: er.customerMessage || null,
            agentReply: er.agentReply || null,
          });
        }
      } catch (err: any) {
        console.error('[quality/history] Email query error:', err?.message ?? err);
      }
    }

    // 2. Fetch chat interaction history by chatId
    if (chatId) {
      try {
        const chatRows = await getConversationHistory(chatId, 10).catch(() => []);
        for (const r of chatRows) {
          const key = `chat_${r.chatId}`;
          if (seenKeys.has(key)) continue;
          seenKeys.add(key);

          const tags = r.tags || {};
          combinedHistory.push({
            id: String(r.chatId),
            chatId: String(r.chatId),
            channel: 'chat',
            date: r.date ? String(r.date).slice(0, 10) : '',
            agentName: r.agentName || 'Agent',
            subject: tags.disposition || 'Chat Support',
            disposition: tags.disposition || '',
            subDisposition: tags.sub_disposition || '',
            iqs: r.iqs != null ? Number(r.iqs) : null,
            conversationType: r.conversationType || 'agent',
            csat: r.csat_score ? String(r.csat_score) : '',
            status: 'Closed',
            scoredAt: r.scoredAt,
          });
        }
      } catch (err: any) {
        console.error('[quality/history] Chat query error:', err?.message ?? err);
      }
    }

    // 3. Fetch chat interaction history by phone number if known
    if (customerPhone) {
      try {
        const last10 = customerPhone.replace(/\D/g, '').slice(-10);
        if (last10.length === 10) {
          const phoneChatRows = await query<any>(
            `SELECT c.id AS "chatId", COALESCE(c.closed_at, c.started_at)::date::text AS "date",
                    c.conversation_type AS "conversationType", c.csat_score, c.tags,
                    a.name AS "agentName", s.iqs_score AS "iqs", s.scored_at AS "scoredAt"
             FROM conversations c
             JOIN contacts ct ON ct.id = c.contact_id
             LEFT JOIN iqs_scores s ON s.chat_id = c.id
             LEFT JOIN agents a ON a.id = c.agent_id
             WHERE RIGHT(REPLACE(REPLACE(ct.phone, '+', ''), ' ', ''), 10) = $1
             ORDER BY COALESCE(c.closed_at, c.started_at) DESC NULLS LAST
             LIMIT 10`,
            [last10]
          );

          for (const r of phoneChatRows) {
            const key = `chat_${r.chatId}`;
            if (seenKeys.has(key)) continue;
            seenKeys.add(key);

            const tags = r.tags || {};
            combinedHistory.push({
              id: String(r.chatId),
              chatId: String(r.chatId),
              channel: 'chat',
              date: r.date ? String(r.date).slice(0, 10) : '',
              agentName: r.agentName || 'Agent',
              subject: tags.disposition || 'Chat Support',
              disposition: tags.disposition || '',
              subDisposition: tags.sub_disposition || '',
              iqs: r.iqs != null ? Number(r.iqs) : null,
              conversationType: r.conversationType || 'agent',
              csat: r.csat_score ? String(r.csat_score) : '',
              status: 'Closed',
              scoredAt: r.scoredAt,
            });
          }
        }
      } catch (err: any) {
        console.error('[quality/history] Phone chat query error:', err?.message ?? err);
      }
    }

    // Sort by date descending
    combinedHistory.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    return NextResponse.json({ ok: true, history: combinedHistory, customerEmail, customerPhone });
  } catch (err: any) {
    console.error('[quality/history] GET error:', err?.message ?? err);
    return NextResponse.json({ error: err?.message || 'Database error' }, { status: 500 });
  }
}
