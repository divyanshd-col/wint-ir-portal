const ROUTE = 'cx/tl/wow-trend';
import { log, withLogging } from '@/lib/log';
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { query } from '@/lib/cx/db';
import { getCxBenchmark } from '@/lib/cx/benchmark';
import { getWeekStart } from '@/lib/cx/week';

function weeksInRange(from: string, to: string): string[] {
  const weeks: string[] = [];
  let cur = new Date(from);
  const end = new Date(to);
  while (cur <= end) {
    weeks.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 7);
  }
  return weeks;
}

async function _GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const role = session.user.role;
  if (role !== 'tl' && role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const from = searchParams.get('from');
  const to   = searchParams.get('to');
  const tlIdParam = searchParams.get('tl_id');

  if (!from || !to) return NextResponse.json({ error: 'from and to required' }, { status: 400 });

  let tlUserId: string;
  if (role === 'admin' && tlIdParam) {
    tlUserId = tlIdParam;
  } else {
    const userRows = await query<{ user_id: string }>(
      `SELECT user_id FROM cx_users WHERE name = $1 OR user_id::text = $1 LIMIT 1`,
      [session.user.email || '']
    );
    if (!userRows.length) return NextResponse.json({ error: 'TL not found' }, { status: 404 });
    tlUserId = userRows[0].user_id;
  }

  const teamRows = await query<{ team_id: string }>(`SELECT team_id FROM cx_teams WHERE tl_id = $1 LIMIT 1`, [tlUserId]);
  if (!teamRows.length) return NextResponse.json({ error: 'No team' }, { status: 404 });
  const teamId = teamRows[0].team_id;

  const agentRows = await query<{ agent_id: string }>(`SELECT agent_id FROM cx_agents WHERE team_id = $1 AND status = 'active'`, [teamId]);
  const agentIds = agentRows.map(r => r.agent_id);

  const currentWeek = getWeekStart();
  const weeks = weeksInRange(from, to);
  const results: any[] = [];

  for (let i = 0; i < weeks.length; i++) {
    const w = weeks[i];
    const inProgress = w === currentWeek;

    const qaRows = await query<{ avg_score: string }>(
      `SELECT AVG(score) AS avg_score FROM (
         SELECT DISTINCT ON (agent_id, week_start) score FROM cx_qa_audits
         WHERE agent_id = ANY($1) AND week_start = $2
         ORDER BY agent_id, week_start, audited_at DESC
       ) sub`,
      [agentIds, w]
    );
    const csatRows = await query<{ csat_avg: string }>(
      `SELECT AVG(sub.a) AS csat_avg FROM (
         SELECT agent_id, AVG(rating) AS a FROM cx_csat_responses WHERE agent_id = ANY($1) AND week_start = $2 GROUP BY agent_id
       ) sub`,
      [agentIds, w]
    );
    const volRows = await query<{ vol_avg: string }>(
      `SELECT AVG(sub.v) AS vol_avg FROM (
         SELECT agent_id, COUNT(ticket_id)::FLOAT AS v FROM cx_tickets WHERE agent_id = ANY($1) AND week_start = $2 GROUP BY agent_id
       ) sub`,
      [agentIds, w]
    );

    const cx = await getCxBenchmark(w);
    const teamQa   = qaRows[0]?.avg_score  != null ? parseFloat(qaRows[0].avg_score)  : null;
    const teamCsat = csatRows[0]?.csat_avg != null ? parseFloat(csatRows[0].csat_avg) : null;
    const teamVol  = volRows[0]?.vol_avg   != null ? parseFloat(volRows[0].vol_avg)   : null;

    const prevWeekData = i > 0 ? results[i - 1] : null;
    results.push({
      week_start: w,
      in_progress: inProgress,
      team_agent_count: agentIds.length,
      metrics: {
        qa:     { team_avg: teamQa,   cx_avg: cx.qa,     delta: teamQa   != null && cx.qa     != null ? parseFloat((teamQa   - cx.qa).toFixed(2))   : null },
        csat:   { team_avg: teamCsat, cx_avg: cx.csat,   delta: teamCsat != null && cx.csat   != null ? parseFloat((teamCsat - cx.csat).toFixed(2)) : null },
        volume: { team_avg: teamVol,  cx_avg: cx.volume, delta: teamVol  != null && cx.volume != null ? parseFloat((teamVol  - cx.volume).toFixed(2)): null },
      },
      wow_delta: prevWeekData && !inProgress ? {
        qa:     teamQa   != null && prevWeekData.metrics.qa.team_avg   != null ? parseFloat((teamQa   - prevWeekData.metrics.qa.team_avg).toFixed(2))   : null,
        csat:   teamCsat != null && prevWeekData.metrics.csat.team_avg != null ? parseFloat((teamCsat - prevWeekData.metrics.csat.team_avg).toFixed(2)) : null,
        volume: teamVol  != null && prevWeekData.metrics.volume.team_avg != null ? parseFloat((teamVol - prevWeekData.metrics.volume.team_avg).toFixed(2)) : null,
      } : null,
    });
  }

  return NextResponse.json(results);
}

export const GET = withLogging(ROUTE, _GET);
