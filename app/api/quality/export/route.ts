/**
 * GET /api/quality/export
 * Returns ALL IQS scores ever stored as a CSV file download.
 * Supports optional filters: agent, dateFrom, dateTo, tag
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { storeGetAllIQSScores } from '@/lib/store';
import { PARAM_ORDER, PARAM_NAMES } from '@/lib/quality';
import type { IQSScoreEntry } from '@/lib/quality';

function qualityAccess(session: any) {
  const role = session?.user?.role;
  return !!role && ['admin', 'quality', 'tl'].includes(role);
}

function escapeCSV(v: unknown): string {
  return `"${String(v ?? '').replace(/"/g, '""')}"`;
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !qualityAccess(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const agentFilter  = searchParams.get('agent') || '';
  const tagFilter    = searchParams.get('tag') || '';
  const subTagFilter = searchParams.get('subTag') || '';
  const csatFilter   = searchParams.get('csat') || '';
  const dateFrom     = searchParams.get('dateFrom') || '';
  const dateTo       = searchParams.get('dateTo') || '';
  const typeFilter   = searchParams.get('type') || '';

  const raw = await storeGetAllIQSScores(); // parallel 500-entry batches — all entries, safe under 1 MB each
  let entries: IQSScoreEntry[] = raw.map(r => {
    try { return JSON.parse(r); } catch { return null; }
  }).filter(Boolean);

  if (agentFilter)  entries = entries.filter(e => e.agentName === agentFilter);
  if (tagFilter)    entries = entries.filter(e => (e.disposition || '').toLowerCase() === tagFilter.toLowerCase());
  if (subTagFilter) entries = entries.filter(e => (e.subDisposition || '').toLowerCase() === subTagFilter.toLowerCase());
  if (csatFilter)   entries = entries.filter(e => e.csat === csatFilter);
  if (dateFrom)     entries = entries.filter(e => (e.scoredAt || '').slice(0, 10) >= dateFrom || (e.date || '') >= dateFrom);
  if (dateTo)       entries = entries.filter(e => (e.scoredAt || '').slice(0, 10) <= dateTo   || (e.date || '') <= dateTo);
  if (typeFilter)   entries = entries.filter(e => (e.conversationType || 'agent') === typeFilter);

  // CSV headers
  const paramCols = PARAM_ORDER.map(p => PARAM_NAMES[p]);
  const headers = [
    'Chat ID', 'Agent', 'Date', 'Tags', 'CSAT', 'IQS',
    ...paramCols,
    'Summary', 'Scored At', 'Scored By', 'Model', 'Channel',
    'Conversation Type', 'FRT secs (I→T)', 'B→T secs', 'Resolution secs', 'Closure secs',
  ];

  const rows = entries.map(e => [
    e.chatId,
    e.agentName || '',
    e.date || e.scoredAt?.slice(0, 10) || '',
    e.tags || '',
    e.csat || '',
    e.iqs,
    ...PARAM_ORDER.map(p => e.scores?.[p] || ''),
    (e.summary || '').replace(/\n/g, ' '),
    e.scoredAt || '',
    (e.scoredBy || '').replace('webhook:', 'auto:'),
    e.model || '',
    (e.scoredBy || '').startsWith('webhook:') ? (e.scoredBy || '').replace('webhook:', '') : 'manual',
    e.conversationType || '',
    e.frt != null ? e.frt : '',
    e.botToTeamSecs != null ? e.botToTeamSecs : '',
    e.resolutionTime != null ? e.resolutionTime : '',
    e.closureTime != null ? e.closureTime : '',
  ]);

  const csv = [headers, ...rows]
    .map(row => row.map(escapeCSV).join(','))
    .join('\n');

  const filename = `wint_iqs_export_${new Date().toISOString().slice(0, 10)}.csv`;

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
