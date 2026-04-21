import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { query } from '@/lib/cx/db';
import { getCxBenchmark } from '@/lib/cx/benchmark';
import { getCompositeRankings } from '@/lib/cx/composite';
import { prevWeek } from '@/lib/cx/week';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.user.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const weekStart = searchParams.get('week_start');

  // If no week_start, return simple agent list with tl/qa assignment columns
  if (!weekStart) {
    const agents = await query(`SELECT id, name, tl_name, qa_name, status FROM agents ORDER BY name`);
    return NextResponse.json(agents);
  }

  const teamId    = searchParams.get('team_id');
  const tlId      = searchParams.get('tl_id');
  const qaId      = searchParams.get('qa_id');

  let agentQuery = `
    SELECT a.agent_id, u.name,
           t.team_name, tlu.name AS tl_name, qau.name AS qa_name
    FROM cx_agents a
    JOIN cx_users u   ON u.user_id = a.user_id
    JOIN cx_teams t   ON t.team_id = a.team_id
    JOIN cx_users tlu ON tlu.user_id = t.tl_id
    JOIN cx_users qau ON qau.user_id = a.qa_id
    WHERE a.status = 'active'
  `;
  const params: unknown[] = [];
  if (teamId) { params.push(teamId); agentQuery += ` AND a.team_id = $${params.length}`; }
  if (tlId)   { params.push(tlId);   agentQuery += ` AND t.tl_id = $${params.length}`; }
  if (qaId)   { params.push(qaId);   agentQuery += ` AND a.qa_id = $${params.length}`; }

  const agents = await query<{ agent_id: string; name: string; team_name: string; tl_name: string; qa_name: string }>(agentQuery, params);
  if (!agents.length) return NextResponse.json([]);

  const agentIds = agents.map(a => a.agent_id);
  const cx = await getCxBenchmark(weekStart);
  const allComposites = await getCompositeRankings(weekStart);
  const compositeMap  = Object.fromEntries(allComposites.map(r => [r.agentId, r]));

  const prevW = prevWeek(weekStart);
  await getCxBenchmark(prevW); // pre-warm (not used directly here)

  const rows = await Promise.all(agents.map(async agent => {
    const aid = agent.agent_id;

    const getQa = async (w: string) => {
      const r = await query<{ score: string }>(`SELECT score FROM (SELECT DISTINCT ON (agent_id, week_start) score FROM cx_qa_audits WHERE agent_id = $1 AND week_start = $2 ORDER BY agent_id, week_start, audited_at DESC) s`, [aid, w]);
      return r[0]?.score != null ? parseFloat(r[0].score) : null;
    };
    const getCsat = async (w: string) => {
      const r = await query<{ v: string }>(`SELECT AVG(rating) AS v FROM cx_csat_responses WHERE agent_id = $1 AND week_start = $2`, [aid, w]);
      return r[0]?.v != null ? parseFloat(r[0].v) : null;
    };
    const getVol = async (w: string) => {
      const r = await query<{ v: string }>(`SELECT COUNT(ticket_id)::text AS v FROM cx_tickets WHERE agent_id = $1 AND week_start = $2`, [aid, w]);
      return r[0]?.v ? parseInt(r[0].v) : 0;
    };

    const [qa, csat, vol, qaP, csatP, volP] = await Promise.all([
      getQa(weekStart), getCsat(weekStart), getVol(weekStart),
      getQa(prevW),     getCsat(prevW),     getVol(prevW),
    ]);

    const comp = compositeMap[aid];
    return {
      agent_id:        aid,
      name:            agent.name,
      team_name:       agent.team_name,
      tl_name:         agent.tl_name,
      qa_name:         agent.qa_name,
      qa_score:        qa,
      csat_avg:        csat,
      volume:          vol,
      composite_score: comp?.composite ?? null,
      rank:            comp?.rank ?? null,
      wow_delta: {
        qa:     qa   != null && qaP   != null ? parseFloat((qa   - qaP).toFixed(2))   : null,
        csat:   csat != null && csatP != null ? parseFloat((csat - csatP).toFixed(2)) : null,
        volume: parseFloat((vol - volP).toFixed(0)),
      },
      delta_vs_cx: {
        qa:     qa   != null && cx.qa     != null ? parseFloat((qa   - cx.qa).toFixed(2))   : null,
        csat:   csat != null && cx.csat   != null ? parseFloat((csat - cx.csat).toFixed(2)) : null,
        volume: vol  != null && cx.volume != null ? parseFloat((vol  - cx.volume).toFixed(2)) : null,
      },
    };
  }));

  // suppress unused variable warning
  void agentIds;

  return NextResponse.json(rows);
}

// PATCH — update tl_name and/or qa_name by agent name
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== 'admin')
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { agent_name, tl_name, qa_name } = await req.json();
  if (!agent_name) return NextResponse.json({ error: 'agent_name required' }, { status: 400 });

  // Only update columns that were passed
  if (tl_name !== undefined) {
    await query(`UPDATE agents SET tl_name = $1 WHERE LOWER(name) = LOWER($2)`, [tl_name || null, agent_name]);
  }
  if (qa_name !== undefined) {
    await query(`UPDATE agents SET qa_name = $1 WHERE LOWER(name) = LOWER($2)`, [qa_name || null, agent_name]);
  }
  return NextResponse.json({ ok: true });
}
