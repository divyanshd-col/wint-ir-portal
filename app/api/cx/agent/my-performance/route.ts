const ROUTE = 'cx/agent/my-performance';
import { log, withLogging } from '@/lib/log';
import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-guard';
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
  const { session, response } = await requireRole('agent');
  if (response) return response;

  const { searchParams } = new URL(req.url);
  const from = searchParams.get('from');
  const to   = searchParams.get('to');
  if (!from || !to) return NextResponse.json({ error: 'from and to required' }, { status: 400 });

  // Resolve agent_id from session email
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
  const agentId = agentRows[0].agent_id;

  const currentWeek = getWeekStart();
  const weeks = weeksInRange(from, to);
  const results: any[] = [];

  for (let i = 0; i < weeks.length; i++) {
    const w = weeks[i];
    const inProgress = w === currentWeek;

    const qaRows = await query<{ score: string }>(
      `SELECT score FROM (
         SELECT DISTINCT ON (agent_id, week_start) score FROM cx_qa_audits
         WHERE agent_id = $1 AND week_start = $2 ORDER BY agent_id, week_start, audited_at DESC
       ) sub`,
      [agentId, w]
    );
    const csatRows = await query<{ csat_avg: string }>(
      `SELECT AVG(rating) AS csat_avg FROM cx_csat_responses WHERE agent_id = $1 AND week_start = $2`,
      [agentId, w]
    );
    const volRows = await query<{ vol: string }>(
      `SELECT COUNT(ticket_id)::text AS vol FROM cx_tickets WHERE agent_id = $1 AND week_start = $2`,
      [agentId, w]
    );

    const cx = await getCxBenchmark(w);
    const myQa   = qaRows[0]?.score    != null ? parseFloat(qaRows[0].score)    : null;
    const myCsat = csatRows[0]?.csat_avg != null ? parseFloat(csatRows[0].csat_avg) : null;
    const myVol  = volRows[0]?.vol ? parseInt(volRows[0].vol) : 0;

    const prev = i > 0 ? results[i - 1] : null;
    results.push({
      week_start: w,
      in_progress: inProgress,
      qa_score: myQa,
      csat_avg: myCsat,
      volume: myVol,
      cx_benchmark: cx,
      wow_delta: prev && !inProgress ? {
        qa:     myQa   != null && prev.qa_score != null ? parseFloat((myQa   - prev.qa_score).toFixed(2)) : null,
        csat:   myCsat != null && prev.csat_avg != null ? parseFloat((myCsat - prev.csat_avg).toFixed(2)) : null,
        volume: parseFloat((myVol - prev.volume).toFixed(0)),
      } : null,
    });
  }

  return NextResponse.json(results);
}

export const GET = withLogging(ROUTE, _GET);
