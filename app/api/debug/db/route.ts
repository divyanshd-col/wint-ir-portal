import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';

export async function GET() {
  // Admin-only diagnostic endpoint
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const result: Record<string, any> = {
    env: {
      POSTGRES_URL:              !!process.env.POSTGRES_URL,
      POSTGRES_URL_NON_POOLING:  !!process.env.POSTGRES_URL_NON_POOLING,
      POSTGRES_PRISMA_URL:       !!process.env.POSTGRES_PRISMA_URL,
      url_prefix: (process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL || '').slice(0, 30) || '(not set)',
    },
    db: null as any,
    error: null as any,
  };

  try {
    const { query } = await import('@/lib/cx/db');

    const counts = await query(`
      SELECT
        (SELECT COUNT(*) FROM conversations)  AS conversations,
        (SELECT COUNT(*) FROM iqs_scores)     AS iqs_scores,
        (SELECT COUNT(*) FROM agents)         AS agents,
        (SELECT COUNT(*) FROM contacts)       AS contacts
    `);

    const sample = await query(`
      SELECT c.id AS chat_id, a.name AS agent_name, s.iqs_score, s.scored_at
      FROM conversations c
      JOIN iqs_scores s ON s.chat_id = c.id
      LEFT JOIN agents a ON a.id = c.agent_id
      ORDER BY s.scored_at DESC
      LIMIT 3
    `);

    const agentCols = await query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'agents' ORDER BY ordinal_position
    `);

    result.db = {
      counts: counts[0],
      sample_rows: sample,
      agent_columns: agentCols.map((r: any) => r.column_name),
    };
  } catch (err: any) {
    result.error = err?.message ?? String(err);
  }

  return NextResponse.json(result, { status: 200 });
}
