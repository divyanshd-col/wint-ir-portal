const ROUTE = 'analytics/export-transcripts';
import { log, withLogging } from '@/lib/log';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { query } from '@/lib/cx/db';
import * as XLSX from 'xlsx';
import type { AnalyticsFilters } from '@/lib/analytics/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

const MAX_ROWS = 2000;

function buildWhere(f: AnalyticsFilters, alias = 'c', startIdx = 1) {
  const clauses: string[] = [];
  const params: any[] = [];
  let i = startIdx;

  clauses.push(`${alias}.closed_at >= $${i++}::timestamptz`);
  params.push(f.dateFrom + 'T00:00:00Z');
  clauses.push(`${alias}.closed_at < $${i++}::timestamptz`);
  params.push(f.dateTo + 'T23:59:59.999Z');

  if (f.dispositions?.length) {
    clauses.push(`${alias}.tags->>'disposition' = ANY($${i++}::text[])`);
    params.push(f.dispositions);
  }
  if (f.subDispositions?.length) {
    clauses.push(`${alias}.tags->>'sub_disposition' = ANY($${i++}::text[])`);
    params.push(f.subDispositions);
  }
  if (f.csatLabels?.length) {
    clauses.push(`${alias}.csat_label = ANY($${i++}::text[])`);
    params.push(f.csatLabels);
  }
  if (f.conversationTypes?.length) {
    clauses.push(`${alias}.conversation_type = ANY($${i++}::text[])`);
    params.push(f.conversationTypes);
  }
  if (f.agentIds?.length) {
    clauses.push(`${alias}.agent_id = ANY($${i++}::int[])`);
    params.push(f.agentIds);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return { where, params };
}

function transcriptToText(transcript: any): string {
  if (!Array.isArray(transcript)) return '';
  return transcript
    .map((m: any) => {
      const role =
        m.sender_type === 'customer' ? 'Customer'
        : m.sender_type === 'bot' ? 'Bot'
        : 'Agent';
      const content = (m.content || '').trim();
      return content ? `${role}: ${content}` : '';
    })
    .filter(Boolean)
    .join('\n');
}

async function _POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!(session?.user as any)?.isAdmin) {
    return new Response('Forbidden', { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const filters: AnalyticsFilters = body.filters ?? {
    dateFrom: new Date(Date.now() - 6 * 86400_000).toISOString().slice(0, 10),
    dateTo: new Date().toISOString().slice(0, 10),
    dispositions: [],
    subDispositions: [],
    teams: [],
    csatLabels: [],
    conversationTypes: [],
    agentIds: [],
  };

  const { where, params } = buildWhere(filters);

  const sql = `
    SELECT
      c.id                          AS chat_id,
      c.phone_number,
      c.closed_at::date             AS date,
      a.name                        AS agent,
      c.tags->>'disposition'        AS disposition,
      c.tags->>'sub_disposition'    AS sub_disposition,
      c.csat_label                  AS csat,
      c.csat_score                  AS csat_score,
      c.conversation_type,
      s.iqs_score,
      c.transcript
    FROM conversations c
    LEFT JOIN agents a ON a.id = c.agent_id
    LEFT JOIN iqs_scores s ON s.chat_id = c.id
    ${where}
    ORDER BY c.closed_at DESC
    LIMIT ${MAX_ROWS}
  `;

  let rows: any[];
  try {
    rows = await query(sql, params);
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }

  const ROBYLON_BASE = 'https://app.robylon.ai/unified-inbox/share';

  const sheetData = rows.map(row => ({
    'Chat ID':         row.chat_id,
    'Chat Link':       /^\d+$/.test(String(row.chat_id || '').trim()) ? `${ROBYLON_BASE}/${row.chat_id}` : '',
    'Phone':           row.phone_number || '',
    'Date':            row.date ? String(row.date).slice(0, 10) : '',
    'Agent':           row.agent || '',
    'Disposition':     row.disposition || '',
    'Sub-Disposition': row.sub_disposition || '',
    'Conv Type':       row.conversation_type || '',
    'CSAT':            row.csat || '',
    'IQS Score':       row.iqs_score != null ? row.iqs_score : '',
    'Transcript':      transcriptToText(row.transcript),
  }));

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(sheetData);

  ws['!cols'] = [
    { wch: 20 },  // Chat ID
    { wch: 48 },  // Chat Link
    { wch: 16 },  // Phone
    { wch: 12 },  // Date
    { wch: 20 },  // Agent
    { wch: 22 },  // Disposition
    { wch: 25 },  // Sub-Disposition
    { wch: 12 },  // Conv Type
    { wch: 14 },  // CSAT
    { wch: 10 },  // IQS Score
    { wch: 80 },  // Transcript
  ];

  XLSX.utils.book_append_sheet(wb, ws, 'Transcripts');

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  const label = filters.dispositions?.length
    ? filters.dispositions.join('+').replace(/\s+/g, '_').slice(0, 60)
    : 'all';
  const filename = `transcripts_${label}_${filters.dateFrom}_to_${filters.dateTo}.xlsx`;

  return new Response(buf, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}

export const POST = withLogging(ROUTE, _POST);
