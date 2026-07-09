import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { query } from '@/lib/cx/db';

/**
 * POST /api/admin/migrate
 * One-time migration: adds tl_name + qa_name columns to the agents table
 * and back-fills from cx_agents/cx_teams/cx_users. Idempotent.
 */
export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const steps: string[] = [];

  try {
    // 1. Add columns if missing
    await query(`ALTER TABLE agents ADD COLUMN IF NOT EXISTS tl_name TEXT`);
    await query(`ALTER TABLE agents ADD COLUMN IF NOT EXISTS qa_name TEXT`);
    steps.push('tl_name and qa_name columns ensured');

    // 2. Back-fill qa_name from cx_agents
    const qa = await query(`
      UPDATE agents a
      SET qa_name = u_qa.name
      FROM cx_agents ca
      JOIN cx_users u_agent ON u_agent.user_id = ca.user_id
      JOIN cx_users u_qa    ON u_qa.user_id    = ca.qa_id
      WHERE u_agent.name = a.name
        AND a.qa_name IS NULL
      RETURNING a.name
    `);
    steps.push(`qa_name populated for ${qa.length} agents`);

    // 3. Back-fill tl_name from cx_teams
    const tl = await query(`
      UPDATE agents a
      SET tl_name = u_tl.name
      FROM cx_agents ca
      JOIN cx_users u_agent ON u_agent.user_id = ca.user_id
      JOIN cx_teams t        ON t.team_id       = ca.team_id
      JOIN cx_users u_tl     ON u_tl.user_id    = t.tl_id
      WHERE u_agent.name = a.name
        AND a.tl_name IS NULL
      RETURNING a.name
    `);
    steps.push(`tl_name populated for ${tl.length} agents`);

    // 4. Return current state
    const agents = await query(`
      SELECT name, tl_name, qa_name, status FROM agents ORDER BY name
    `);

    return NextResponse.json({ ok: true, steps, agents });
  } catch (err: any) {
    return NextResponse.json({ ok: false, steps, error: err?.message }, { status: 500 });
  }
}
