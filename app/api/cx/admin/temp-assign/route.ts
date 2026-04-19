import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { query } from '@/lib/cx/db';
import { setTempAssignment, deleteTempAssignment } from '@/lib/cx/temp-assign';

function sessionId(req: NextRequest): string {
  return req.cookies.get('next-auth.session-token')?.value
      || req.cookies.get('__Secure-next-auth.session-token')?.value
      || 'anon';
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { agent_id, to_team_id } = await req.json();
  if (!agent_id || !to_team_id) return NextResponse.json({ error: 'agent_id and to_team_id required' }, { status: 400 });

  const agentRows = await query<{ team_id: string }>(`SELECT team_id FROM cx_agents WHERE agent_id = $1`, [agent_id]);
  if (!agentRows.length) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });

  const ta = await setTempAssignment(sessionId(req), agent_id, agentRows[0].team_id, to_team_id);
  return NextResponse.json({ success: true, expires_at: ta.expiresAt });
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const agentId = searchParams.get('agent_id');
  if (!agentId) return NextResponse.json({ error: 'agent_id required' }, { status: 400 });

  await deleteTempAssignment(sessionId(req), agentId);
  return NextResponse.json({ success: true });
}
