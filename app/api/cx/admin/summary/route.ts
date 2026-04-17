import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { query } from '@/lib/cx/db';
import { getCxBenchmark } from '@/lib/cx/benchmark';
import { getCompositeRankings } from '@/lib/cx/composite';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.user.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const view      = (searchParams.get('view') as 'tl' | 'qa') || 'tl';
  const weekStart = searchParams.get('week_start');
  if (!weekStart) return NextResponse.json({ error: 'week_start required' }, { status: 400 });

  const cx = await getCxBenchmark(weekStart);
  const allComposites = await getCompositeRankings(weekStart);
  const compositeByAgent = Object.fromEntries(allComposites.map(r => [r.agentId, r.composite]));

  if (view === 'tl') {
    const tls = await query<{ user_id: string; name: string }>(
      `SELECT user_id, name FROM cx_users WHERE role = 'tl'`
    );
    const rows = await Promise.all(tls.map(async tl => {
      const teamRows = await query<{ team_id: string }>(`SELECT team_id FROM cx_teams WHERE tl_id = $1 LIMIT 1`, [tl.user_id]);
      if (!teamRows.length) return null;
      const teamId = teamRows[0].team_id;
      const agents = await query<{ agent_id: string }>(`SELECT agent_id FROM cx_agents WHERE team_id = $1 AND status = 'active'`, [teamId]);
      const agentIds = agents.map(a => a.agent_id);
      if (!agentIds.length) return null;

      const qaRow   = await query<{ v: string }>(`SELECT AVG(score) AS v FROM (SELECT DISTINCT ON (agent_id, week_start) score FROM cx_qa_audits WHERE agent_id = ANY($1) AND week_start = $2 ORDER BY agent_id, week_start, audited_at DESC) s`, [agentIds, weekStart]);
      const csatRow = await query<{ v: string }>(`SELECT AVG(s.a) AS v FROM (SELECT agent_id, AVG(rating) AS a FROM cx_csat_responses WHERE agent_id = ANY($1) AND week_start = $2 GROUP BY agent_id) s`, [agentIds, weekStart]);
      const volRow  = await query<{ v: string }>(`SELECT AVG(s.c) AS v FROM (SELECT agent_id, COUNT(ticket_id)::FLOAT AS c FROM cx_tickets WHERE agent_id = ANY($1) AND week_start = $2 GROUP BY agent_id) s`, [agentIds, weekStart]);

      const qa   = qaRow[0]?.v   != null ? parseFloat(qaRow[0].v)   : null;
      const csat = csatRow[0]?.v != null ? parseFloat(csatRow[0].v) : null;
      const vol  = volRow[0]?.v  != null ? parseFloat(volRow[0].v)  : null;

      const compositeVals = agentIds.map(id => compositeByAgent[id]).filter((v): v is number => v != null);
      const compositeAvg = compositeVals.length ? compositeVals.reduce((a, b) => a + b, 0) / compositeVals.length : null;

      return {
        entity_id:     tl.user_id,
        entity_name:   tl.name,
        agent_count:   agentIds.length,
        qa:            { avg: qa,   delta_vs_cx: qa   != null && cx.qa     != null ? parseFloat((qa   - cx.qa).toFixed(2))   : null },
        csat:          { avg: csat, delta_vs_cx: csat != null && cx.csat   != null ? parseFloat((csat - cx.csat).toFixed(2)) : null },
        volume:        { avg: vol,  delta_vs_cx: vol  != null && cx.volume != null ? parseFloat((vol  - cx.volume).toFixed(2)): null },
        composite_avg: compositeAvg != null ? parseFloat(compositeAvg.toFixed(4)) : null,
      };
    }));
    return NextResponse.json(rows.filter(Boolean));
  }

  // view === 'qa'
  const qas = await query<{ user_id: string; name: string }>(
    `SELECT user_id, name FROM cx_users WHERE role = 'qa'`
  );
  const rows = await Promise.all(qas.map(async qa => {
    const agents = await query<{ agent_id: string }>(`SELECT agent_id FROM cx_agents WHERE qa_id = $1 AND status = 'active'`, [qa.user_id]);
    const agentIds = agents.map(a => a.agent_id);
    if (!agentIds.length) return null;

    const qaRow   = await query<{ v: string }>(`SELECT AVG(score) AS v FROM (SELECT DISTINCT ON (agent_id, week_start) score FROM cx_qa_audits WHERE agent_id = ANY($1) AND qa_id = $2 AND week_start = $3 ORDER BY agent_id, week_start, audited_at DESC) s`, [agentIds, qa.user_id, weekStart]);
    const csatRow = await query<{ v: string }>(`SELECT AVG(s.a) AS v FROM (SELECT agent_id, AVG(rating) AS a FROM cx_csat_responses WHERE agent_id = ANY($1) AND week_start = $2 GROUP BY agent_id) s`, [agentIds, weekStart]);
    const volRow  = await query<{ v: string }>(`SELECT AVG(s.c) AS v FROM (SELECT agent_id, COUNT(ticket_id)::FLOAT AS c FROM cx_tickets WHERE agent_id = ANY($1) AND week_start = $2 GROUP BY agent_id) s`, [agentIds, weekStart]);

    const qaAvg  = qaRow[0]?.v   != null ? parseFloat(qaRow[0].v)   : null;
    const csat   = csatRow[0]?.v != null ? parseFloat(csatRow[0].v) : null;
    const vol    = volRow[0]?.v  != null ? parseFloat(volRow[0].v)  : null;

    const compositeVals = agentIds.map(id => compositeByAgent[id]).filter((v): v is number => v != null);
    const compositeAvg = compositeVals.length ? compositeVals.reduce((a, b) => a + b, 0) / compositeVals.length : null;

    return {
      entity_id:     qa.user_id,
      entity_name:   qa.name,
      agent_count:   agentIds.length,
      qa:            { avg: qaAvg, delta_vs_cx: qaAvg != null && cx.qa     != null ? parseFloat((qaAvg - cx.qa).toFixed(2))   : null },
      csat:          { avg: csat,  delta_vs_cx: csat  != null && cx.csat   != null ? parseFloat((csat  - cx.csat).toFixed(2)) : null },
      volume:        { avg: vol,   delta_vs_cx: vol   != null && cx.volume != null ? parseFloat((vol   - cx.volume).toFixed(2)): null },
      composite_avg: compositeAvg != null ? parseFloat(compositeAvg.toFixed(4)) : null,
    };
  }));
  return NextResponse.json(rows.filter(Boolean));
}
