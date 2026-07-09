const ROUTE = 'cx/admin/team-structure';
import { log, withLogging } from '@/lib/log';
import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-guard';
import { query } from '@/lib/cx/db';

async function _GET() {
  const { session, response } = await requireRole('admin');
  if (response) return response;

  // Teams from new schema
  const teams = await query<{ id: number; name: string; type: string }>(
    `SELECT id, name, type FROM teams ORDER BY name`
  );

  // Agents with their team assignment
  const agents = await query<{ id: number; name: string; team_id: number | null; status: string }>(
    `SELECT id, name, team_id, status FROM agents ORDER BY name`
  );

  // TL assignments from cx_teams / cx_users (old CX schema — still used for quality metrics)
  const tlRows = await query<{ team_id: string; team_name: string; tl_name: string }>(
    `SELECT t.team_id, t.team_name, u.name AS tl_name
     FROM cx_teams t
     LEFT JOIN cx_users u ON u.user_id = t.tl_id`
  ).catch(() => []);

  // QA assignments from cx_agents (old CX schema)
  const qaRows = await query<{ agent_name: string; qa_name: string }>(
    `SELECT u_agent.name AS agent_name, u_qa.name AS qa_name
     FROM cx_agents ca
     JOIN cx_users u_agent ON u_agent.user_id = ca.user_id
     JOIN cx_users u_qa    ON u_qa.user_id    = ca.qa_id`
  ).catch(() => []);

  const qaByAgent: Record<string, string> = {};
  for (const r of qaRows) qaByAgent[r.agent_name] = r.qa_name;

  const tlByCxTeam: Record<string, string> = {};
  for (const r of tlRows) tlByCxTeam[r.team_name] = r.tl_name;

  // Build response: team → agents list
  const result = teams.map(team => ({
    team_id:    team.id,
    team_name:  team.name,
    team_type:  team.type,
    tl_name:    tlByCxTeam[team.name] || null,
    agents: agents
      .filter(a => a.team_id === team.id)
      .map(a => ({
        agent_id:   a.id,
        agent_name: a.name,
        status:     a.status,
        qa_name:    qaByAgent[a.name] || null,
      })),
  }));

  // Also include unassigned agents (no team)
  const unassigned = agents.filter(a => !a.team_id).map(a => ({
    agent_id:   a.id,
    agent_name: a.name,
    status:     a.status,
    qa_name:    qaByAgent[a.name] || null,
  }));

  return NextResponse.json({ teams: result, unassigned });
}

// PATCH — assign agent to team
async function _PATCH(req: NextRequest) {
  const { session, response } = await requireRole('admin');
  if (response) return response;

  const { agent_id, team_id } = await req.json();
  if (!agent_id) return NextResponse.json({ error: 'agent_id required' }, { status: 400 });

  await query(
    `UPDATE agents SET team_id = $1 WHERE id = $2`,
    [team_id ?? null, agent_id]
  );
  return NextResponse.json({ ok: true });
}

export const GET = withLogging(ROUTE, _GET);
export const PATCH = withLogging(ROUTE, _PATCH);
