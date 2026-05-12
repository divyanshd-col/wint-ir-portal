import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { getConversationHistory } from '@/lib/robylon/db';

function qualityAccess(role: string | undefined) {
  return !!role && ['admin', 'quality', 'tl', 'agent'].includes(role);
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const role = (session.user as any)?.role;
  if (!qualityAccess(role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

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
    console.error('[quality/history] GET error:', err?.message ?? err);
    return NextResponse.json({ error: err?.message || 'Database error' }, { status: 500 });
  }
}
