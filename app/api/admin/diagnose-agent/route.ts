/**
 * TEMPORARY DIAGNOSTIC — READ-ONLY. No writes. Delete after use.
 * GET /api/admin/diagnose-agent?name=Aditya
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { query } from '@/lib/cx/db';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!(session?.user as any)?.isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const name = new URL(req.url).searchParams.get('name') || 'Aditya';

  // 1. All agent rows matching the search name
  const agentRows = await query(`
    SELECT id, name
    FROM agents
    WHERE name ILIKE $1
    ORDER BY name
  `, [`%${name}%`]);

  // 2. Per-agent-row: conversation count, scored count, CSAT count
  const perAgent = await Promise.all(agentRows.map(async (a: any) => {
    const [totals] = await query(`
      SELECT
        COUNT(*)::int                                          AS total_conversations,
        COUNT(*) FILTER (WHERE c.csat_score IS NOT NULL)::int AS conversations_with_csat,
        MIN(c.started_at)                                     AS earliest_chat,
        MAX(c.started_at)                                     AS latest_chat
      FROM conversations c
      WHERE c.agent_id = $1
    `, [a.id]);

    const [scored] = await query(`
      SELECT
        COUNT(*)::int                                          AS scored_conversations,
        COUNT(*) FILTER (WHERE c.csat_score IS NOT NULL)::int AS scored_with_csat
      FROM conversations c
      JOIN iqs_scores s ON s.chat_id = c.id
      WHERE c.agent_id = $1
    `, [a.id]);

    // CSAT breakdown
    const csatBreakdown = await query(`
      SELECT csat_score, csat_label, COUNT(*)::int AS count
      FROM conversations
      WHERE agent_id = $1 AND csat_score IS NOT NULL
      GROUP BY csat_score, csat_label
      ORDER BY csat_score DESC
    `, [a.id]);

    // Recent scored conversations sample
    const sample = await query(`
      SELECT c.id, c.started_at, c.csat_score, c.csat_label,
             s.iqs_score, s.reviewed_by
      FROM conversations c
      JOIN iqs_scores s ON s.chat_id = c.id
      WHERE c.agent_id = $1
      ORDER BY c.started_at DESC
      LIMIT 5
    `, [a.id]);

    return {
      agent_id: a.id,
      agent_name: a.name,
      ...totals,
      ...scored,
      csat_breakdown: csatBreakdown,
      recent_scored_sample: sample,
    };
  }));

  return NextResponse.json({
    searched_for: name,
    agent_rows_found: agentRows.length,
    results: perAgent,
  }, { status: 200 });
}
