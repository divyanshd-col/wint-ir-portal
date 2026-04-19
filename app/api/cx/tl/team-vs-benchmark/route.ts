import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { query } from '@/lib/cx/db';
import { getCxBenchmark } from '@/lib/cx/benchmark';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const role = session.user.role;
  if (role !== 'tl' && role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const weekStart = searchParams.get('week_start');
  const tlIdParam = searchParams.get('tl_id'); // admin drill-down

  if (!weekStart) return NextResponse.json({ error: 'week_start required' }, { status: 400 });

  // Resolve TL's user_id — for tl role use session email; admin can pass tl_id directly
  let tlUserId: string;
  if (role === 'admin' && tlIdParam) {
    tlUserId = tlIdParam;
  } else {
    const userRows = await query<{ user_id: string }>(
      `SELECT user_id FROM cx_users WHERE name = $1 OR user_id::text = $1 LIMIT 1`,
      [session.user.email || '']
    );
    if (!userRows.length) return NextResponse.json({ error: 'TL not found in CX users' }, { status: 404 });
    tlUserId = userRows[0].user_id;
  }

  // Get team for this TL
  const teamRows = await query<{ team_id: string }>(`SELECT team_id FROM cx_teams WHERE tl_id = $1 LIMIT 1`, [tlUserId]);
  if (!teamRows.length) return NextResponse.json({ error: 'No team found for TL' }, { status: 404 });
  const teamId = teamRows[0].team_id;

  // Team agents
  const agentRows = await query<{ agent_id: string }>(
    `SELECT agent_id FROM cx_agents WHERE team_id = $1 AND status = 'active'`,
    [teamId]
  );
  const agentIds = agentRows.map(r => r.agent_id);
  if (!agentIds.length) {
    return NextResponse.json({ week_start: weekStart, team_agent_count: 0, metrics: { qa: { team_avg: null, cx_avg: null, delta: null }, csat: { team_avg: null, cx_avg: null, delta: null }, volume: { team_avg: null, cx_avg: null, delta: null } } });
  }

  // Team QA avg (most recent audit per agent per week)
  const qaRows = await query<{ avg_score: string }>(
    `SELECT AVG(score) AS avg_score FROM (
       SELECT DISTINCT ON (agent_id, week_start) score
       FROM cx_qa_audits WHERE agent_id = ANY($1) AND week_start = $2
       ORDER BY agent_id, week_start, audited_at DESC
     ) sub`,
    [agentIds, weekStart]
  );

  // Team CSAT avg
  const csatRows = await query<{ csat_avg: string }>(
    `SELECT AVG(sub.agent_csat) AS csat_avg FROM (
       SELECT agent_id, AVG(rating) AS agent_csat FROM cx_csat_responses
       WHERE agent_id = ANY($1) AND week_start = $2 GROUP BY agent_id
     ) sub`,
    [agentIds, weekStart]
  );

  // Team volume avg
  const volRows = await query<{ vol_avg: string }>(
    `SELECT AVG(sub.vol) AS vol_avg FROM (
       SELECT agent_id, COUNT(ticket_id) AS vol FROM cx_tickets
       WHERE agent_id = ANY($1) AND week_start = $2 GROUP BY agent_id
     ) sub`,
    [agentIds, weekStart]
  );

  const cx = await getCxBenchmark(weekStart);

  const teamQa   = qaRows[0]?.avg_score   != null ? parseFloat(qaRows[0].avg_score)   : null;
  const teamCsat = csatRows[0]?.csat_avg  != null ? parseFloat(csatRows[0].csat_avg)  : null;
  const teamVol  = volRows[0]?.vol_avg    != null ? parseFloat(volRows[0].vol_avg)    : null;

  return NextResponse.json({
    week_start: weekStart,
    team_agent_count: agentIds.length,
    metrics: {
      qa:     { team_avg: teamQa,   cx_avg: cx.qa,     delta: teamQa   != null && cx.qa     != null ? parseFloat((teamQa   - cx.qa).toFixed(2))   : null },
      csat:   { team_avg: teamCsat, cx_avg: cx.csat,   delta: teamCsat != null && cx.csat   != null ? parseFloat((teamCsat - cx.csat).toFixed(2)) : null },
      volume: { team_avg: teamVol,  cx_avg: cx.volume, delta: teamVol  != null && cx.volume != null ? parseFloat((teamVol  - cx.volume).toFixed(2)): null },
    },
  });
}
