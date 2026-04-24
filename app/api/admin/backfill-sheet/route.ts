import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { query } from '@/lib/cx/db';
import { appendQualityAlertToSheet } from '@/lib/quality-sheet';

const CRITICAL_PARAMS = [
  { dbKey: 'technical',     label: 'Technically / Legally Incorrect' },
  { dbKey: 'all_questions', label: 'All Questions Not Answered' },
  { dbKey: 'process',       label: 'Process Incorrect' },
];

export async function POST() {
  const session = await getServerSession(authOptions);
  if ((session?.user as any)?.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const today = new Date().toISOString().slice(0, 10);

  const rows = await query<{
    chat_id: string;
    tags: any;
    csat_score: number | null;
    contact_phone: string | null;
    agent_name: string | null;
    iqs_score: number;
    parameters: Record<string, { score: boolean | null; reasoning: string }>;
  }>(`
    SELECT
      c.id            AS chat_id,
      c.tags,
      c.csat_score,
      ct.phone        AS contact_phone,
      a.name          AS agent_name,
      s.iqs_score,
      s.parameters
    FROM conversations c
    JOIN iqs_scores s ON s.chat_id = c.id
    LEFT JOIN agents a ON a.id = c.agent_id
    LEFT JOIN contacts ct ON ct.id = c.contact_id
    WHERE c.closed_at::date = $1
      AND (
        (s.parameters->'technical'->>'score')     = 'false'
        OR (s.parameters->'all_questions'->>'score') = 'false'
        OR (s.parameters->'process'->>'score')    = 'false'
      )
    ORDER BY c.closed_at ASC
  `, [today]);

  let sent = 0;
  let errors = 0;

  for (const row of rows) {
    const params = row.parameters || {};
    const failedParams = CRITICAL_PARAMS
      .filter(p => params[p.dbKey]?.score === false)
      .map(p => ({
        label:     p.label,
        reasoning: params[p.dbKey]?.reasoning || 'No reasoning provided',
      }));

    if (!failedParams.length) continue;

    const tags = row.tags || {};
    try {
      await appendQualityAlertToSheet({
        chatId:         row.chat_id,
        agentName:      row.agent_name || 'Unknown',
        contactPhone:   row.contact_phone || undefined,
        iqs:            row.iqs_score,
        csat:           row.csat_score ? String(row.csat_score) : undefined,
        disposition:    tags.disposition    || undefined,
        subDisposition: tags.sub_disposition || undefined,
        failedParams,
      });
      sent++;
    } catch {
      errors++;
    }
  }

  return NextResponse.json({ ok: true, total: rows.length, sent, errors });
}
