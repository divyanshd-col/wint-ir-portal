const ROUTE = 'quality/history';
import { log, withLogging } from '@/lib/log';
import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-guard';
import { getConversationHistory } from '@/lib/robylon/db';

async function _GET(req: NextRequest) {
  const { session, response } = await requireRole(['admin', 'quality', 'tl', 'agent']);
  if (response) return response;

  const chatId = new URL(req.url).searchParams.get('chatId') || '';
  if (!chatId) return NextResponse.json({ error: 'chatId required' }, { status: 400 });

  try {
    const rows = await getConversationHistory(chatId, 10);
    const history = rows.map((r: any) => {
      const tags = r.tags || {};
      return {
        chatId:           String(r.chatId),
        date:             r.date ? String(r.date).slice(0, 10) : '',
        agentName:        r.agentName || '',
        iqs:              r.iqs,
        conversationType: r.conversationType || 'agent',
        csat:             r.csat_score ? String(r.csat_score) : '',
        disposition:      tags.disposition || '',
        subDisposition:   tags.sub_disposition || '',
        scoredAt:         r.scoredAt,
      };
    });
    return NextResponse.json({ history });
  } catch (err: any) {
    log.error(ROUTE, '[quality/history] GET error:', err?.message ?? err);
    return NextResponse.json({ error: err?.message || 'Database error' }, { status: 500 });
  }
}

export const GET = withLogging(ROUTE, _GET);
