import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-guard';
import { query } from '@/lib/cx/db';
import { getCompositeRankings } from '@/lib/cx/composite';

export async function GET(req: NextRequest) {
  const { session, response } = await requireRole('agent');
  if (response) return response;

  const { searchParams } = new URL(req.url);
  const weekStart = searchParams.get('week_start');
  if (!weekStart) return NextResponse.json({ error: 'week_start required' }, { status: 400 });

  const userRows = await query<{ user_id: string }>(
    `SELECT user_id FROM cx_users WHERE name = $1 OR user_id::text = $1 LIMIT 1`,
    [session.user.email || '']
  );
  if (!userRows.length) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });

  const agentRows = await query<{ agent_id: string }>(
    `SELECT agent_id FROM cx_agents WHERE user_id = $1 LIMIT 1`,
    [userRows[0].user_id]
  );
  if (!agentRows.length) return NextResponse.json({ error: 'Agent record not found' }, { status: 404 });
  const myAgentId = agentRows[0].agent_id;

  const rankings = await getCompositeRankings(weekStart);
  const top3 = rankings.slice(0, 3).map(r => ({ rank: r.rank, composite_score: r.composite }));
  const mine = rankings.find(r => r.agentId === myAgentId);

  return NextResponse.json({
    week_start: weekStart,
    top3,
    my_rank: mine?.rank ?? null,
    my_composite_score: mine?.composite ?? null,
    my_metrics_used: mine?.metricsUsed ?? [],
  });
}
