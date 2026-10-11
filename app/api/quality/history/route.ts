import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-guard';
import { getConversationHistory } from '@/lib/robylon/db';
import { query } from '@/lib/cx/db';

export async function GET(req: NextRequest) {
  const { session, response } = await requireRole(['admin', 'quality', 'tl', 'agent']);
  if (response) return response;

  const url = new URL(req.url);
  const chatId = url.searchParams.get('chatId') || '';
  let customerEmail = url.searchParams.get('customerEmail') || url.searchParams.get('email') || '';
  const ticketId = url.searchParams.get('ticketId') || '';

  // If customerEmail is missing but ticketId is provided, look up customerEmail & chatId
  if (!customerEmail && ticketId) {
    try {
      const ticketRes = await query<{ customer_email: string; chat_id: string }>(
        `SELECT customer_email, chat_id FROM email_conversations WHERE id = $1`,
        [ticketId]
      );
      if (ticketRes[0]?.customer_email) {
        customerEmail = ticketRes[0].customer_email;
      }
    } catch {}
  }

  if (!chatId && !customerEmail && !ticketId) {
    return NextResponse.json({ error: 'chatId or customerEmail or ticketId required' }, { status: 400 });
  }

  try {
    const combinedHistory: any[] = [];

    // 1. Fetch email interaction history if customerEmail is present
    if (customerEmail) {
      const emailRows = await query<any>(
        `SELECT 
           c.id AS "ticketId",
           c.chat_id AS "chatId",
           COALESCE(e.sent_at, c.created_at)::text AS "date",
           COALESCE(e.agent_name, c.agent_name, 'IR Specialist') AS "agentName",
           c.subject_line AS "subject",
           c.status AS "convStatus",
           e.evaluation_status AS "evalStatus",
           COALESCE(e.qa_override_score, e.quality_score) AS "iqs"
         FROM email_conversations c
         LEFT JOIN email_reply_evaluations e ON e.ticket_id = c.id
         WHERE c.customer_email = $1
         ORDER BY COALESCE(e.sent_at, c.created_at) DESC
         LIMIT 15`,
        [customerEmail]
      );

      for (const er of emailRows) {
        // Exclude the currently opened ticket if there are other history entries
        combinedHistory.push({
          id: er.ticketId,
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
        });
      }
    }

    // 2. Fetch chat interaction history if chatId is present
    if (chatId) {
      const chatRows = await getConversationHistory(chatId, 10).catch(() => []);
      for (const r of chatRows) {
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

    // Sort by date descending
    combinedHistory.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    return NextResponse.json({ ok: true, history: combinedHistory });
  } catch (err: any) {
    console.error('[quality/history] GET error:', err?.message ?? err);
    return NextResponse.json({ error: err?.message || 'Database error' }, { status: 500 });
  }
}

