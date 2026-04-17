import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { query } from '@/lib/cx/db';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { agent_id, to_team_id } = await req.json();
  if (!agent_id || !to_team_id) return NextResponse.json({ error: 'agent_id and to_team_id required' }, { status: 400 });

  const agentRows = await query<{ name: string; team_id: string }>(
    `SELECT u.name, a.team_id FROM cx_agents a JOIN cx_users u ON u.user_id = a.user_id WHERE a.agent_id = $1`,
    [agent_id]
  );
  if (!agentRows.length) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });

  const fromTeamRows = await query<{ team_name: string }>(`SELECT team_name FROM cx_teams WHERE team_id = $1`, [agentRows[0].team_id]);
  const toTeamRows   = await query<{ team_name: string }>(`SELECT team_name FROM cx_teams WHERE team_id = $1`, [to_team_id]);

  await query(`UPDATE cx_agents SET team_id = $1 WHERE agent_id = $2`, [to_team_id, agent_id]);

  return NextResponse.json({
    agent_name:     agentRows[0].name,
    from_team:      fromTeamRows[0]?.team_name ?? agentRows[0].team_id,
    to_team:        toTeamRows[0]?.team_name ?? to_team_id,
    effective_date: new Date().toISOString().slice(0, 10),
  });
}
