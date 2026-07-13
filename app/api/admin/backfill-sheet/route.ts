import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { query } from '@/lib/cx/db';
import { appendQualityAlertToSheet } from '@/lib/quality-sheet';

// Scores are stored with PascalCase keys (Technical, AllQuestions, Process)
// matching the LLM output format. Support both casing for safety.
const CRITICAL_PARAMS = [
  { keys: ['Technical', 'technical'],       label: 'Technically / Legally Incorrect' },
  { keys: ['AllQuestions', 'all_questions'], label: 'All Questions Not Answered' },
  { keys: ['Process', 'process'],           label: 'Process Incorrect' },
];

function getParam(params: Record<string, any>, keys: string[]) {
  for (const k of keys) {
    if (params[k] !== undefined) return params[k];
  }
  return undefined;
}

export async function POST() {
  const session = await getServerSession(authOptions);
  if ((session?.user as any)?.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Use IST (UTC+5:30) date so "today" matches the user's calendar day
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istNow = new Date(Date.now() + istOffset);
  const today = istNow.toISOString().slice(0, 10);

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
    WHERE (c.closed_at AT TIME ZONE 'Asia/Kolkata')::date = $1
      AND (
        (s.parameters->'Technical'->>'score')     = 'false'
        OR (s.parameters->'technical'->>'score')     = 'false'
        OR (s.parameters->'AllQuestions'->>'score') = 'false'
        OR (s.parameters->'all_questions'->>'score') = 'false'
        OR (s.parameters->'Process'->>'score')    = 'false'
        OR (s.parameters->'process'->>'score')    = 'false'
      )
    ORDER BY c.closed_at ASC
  `, [today]);

  let sent = 0;
  let errors = 0;

  for (const row of rows) {
    const params = row.parameters || {};
    const failedParams = CRITICAL_PARAMS
      .filter(p => getParam(params, p.keys)?.score === false)
      .map(p => ({
        label:     p.label,
        reasoning: getParam(params, p.keys)?.reasoning || 'No reasoning provided',
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
