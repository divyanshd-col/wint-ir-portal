import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { query } from '@/lib/cx/db';
import { getCxBenchmark } from '@/lib/cx/benchmark';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const role = session.user.role;
  if (role !== 'quality' && role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const weekStart = searchParams.get('week_start');
  const qaIdParam = searchParams.get('qa_id');
  const agentIdsParam = searchParams.getAll('agent_ids[]');

  if (!weekStart) return NextResponse.json({ error: 'week_start required' }, { status: 400 });

  // Resolve QA user_id
  let qaUserId: string;
  if (role === 'admin' && qaIdParam) {
    qaUserId = qaIdParam;
  } else {
    const userRows = await query<{ user_id: string }>(
      `SELECT user_id FROM cx_users WHERE name = $1 OR user_id::text = $1 LIMIT 1`,
      [session.user.email || '']
    );
    if (!userRows.length) return NextResponse.json({ error: 'QA not found' }, { status: 404 });
    qaUserId = userRows[0].user_id;
  }

  // Agents assigned to this QA (current assignment)
  let agentIds: string[];
  if (agentIdsParam.length) {
    agentIds = agentIdsParam;
  } else {
    const rows = await query<{ agent_id: string }>(
      `SELECT agent_id FROM cx_agents WHERE qa_id = $1 AND status = 'active'`,
      [qaUserId]
    );
    agentIds = rows.map(r => r.agent_id);
  }

  if (!agentIds.length) return NextResponse.json([]);

  const cx = await getCxBenchmark(weekStart);

  const results = await Promise.all(agentIds.map(async agentId => {
    const nameRows = await query<{ name: string }>(`SELECT u.name FROM cx_users u JOIN cx_agents a ON a.user_id = u.user_id WHERE a.agent_id = $1`, [agentId]);
    const displayName = nameRows[0]?.name ?? agentId;

    // QA score: only audits by this QA
    const qaRows = await query<{ score: string }>(
      `SELECT score FROM (
         SELECT DISTINCT ON (agent_id, week_start) score
         FROM cx_qa_audits WHERE agent_id = $1 AND qa_id = $2 AND week_start = $3
         ORDER BY agent_id, week_start, audited_at DESC
       ) sub`,
      [agentId, qaUserId, weekStart]
    );

    const csatRows = await query<{ csat_avg: string; cnt: string }>(
      `SELECT AVG(rating) AS csat_avg, COUNT(*)::text AS cnt FROM cx_csat_responses WHERE agent_id = $1 AND week_start = $2`,
      [agentId, weekStart]
    );

    const volRows = await query<{ vol: string }>(
      `SELECT COUNT(ticket_id)::text AS vol FROM cx_tickets WHERE agent_id = $1 AND week_start = $2`,
      [agentId, weekStart]
    );

    return {
      agent_id:            agentId,
      display_name:        displayName,
      week_start:          weekStart,
      qa_score:            qaRows[0]?.score != null ? parseFloat(qaRows[0].score) : null,
      qa_audit_count:      qaRows.length,
      csat_avg:            csatRows[0]?.csat_avg != null ? parseFloat(csatRows[0].csat_avg) : null,
      csat_response_count: csatRows[0]?.cnt ? parseInt(csatRows[0].cnt) : 0,
      volume:              volRows[0]?.vol ? parseInt(volRows[0].vol) : 0,
      cx_benchmark:        cx,
    };
  }));

  return NextResponse.json(results);
}
