/**
 * GET /api/quality/export
 * Returns ALL IQS scores ever stored as a CSV file download.
 * Supports optional filters: agent, dateFrom, dateTo, tag
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { getAllScoredConversations } from '@/lib/robylon/db';
import { PARAM_ORDER, PARAM_NAMES } from '@/lib/quality';
import type { IQSScoreEntry } from '@/lib/quality';

function qualityAccess(session: any) {
  const role = session?.user?.role;
  return !!role && ['admin', 'quality', 'tl'].includes(role);
}

function escapeCSV(v: unknown): string {
  return `"${String(v ?? '').replace(/"/g, '""')}"`;
}

// ── Convert PostgreSQL row → IQSScoreEntry ────────────────────────────────────
function toIQSScoreEntry(row: any): IQSScoreEntry {
  const params = row.parameters || {};
  const scores: Record<string, string> = {};
  const reasoning: Record<string, string> = {};
  for (const [key, val] of Object.entries(params) as [string, any][]) {
    const k = key.charAt(0).toUpperCase() + key.slice(1);
    scores[k]    = val.score === true ? 'Yes' : val.score === false ? 'No' : 'NA';
    reasoning[k] = val.reasoning || '';
  }
  const csatStr = row.csat_score ? String(row.csat_score) : '';
  const tags = row.tags || {};
  return {
    id:              `${row.scoredAt}-${row.chatId}`,
    chatId:          row.chatId,
    scoredAt:        row.scoredAt,
    agentName:       row.agentName || '',
    date:            row.date ? String(row.date).slice(0, 10) : '',
    iqs:             row.iqs,
    csat:            csatStr,
    scores:          scores as Record<string, any>,
    reasoning,
    summary:         '',
    provider:        row.modelVersion?.includes('gemini') ? 'gemini' : 'claude',
    model:           row.modelVersion || '',
    conversationType: row.conversationType || 'agent',
    frt:             row.frt ?? undefined,
    botToTeamSecs:   row.botToTeamSecs ?? undefined,
    resolutionTime:  row.resolutionTime ?? undefined,
    disposition:     tags.disposition || '',
    subDisposition:  tags.sub_disposition || '',
  } as IQSScoreEntry;
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

  const rawRows = await getAllScoredConversations(10000); // higher limit for full export
  let entries: IQSScoreEntry[] = rawRows.map(row => {
    try { return toIQSScoreEntry(row); } catch { return null; }
  }).filter(Boolean) as IQSScoreEntry[];

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
    'Summary', 'Scored At', 'Model',
    'Conversation Type', 'FRT secs (I→T)', 'B→T secs', 'Resolution secs',
  ];

  const rows = entries.map(e => [
    e.chatId,
    e.agentName || '',
    e.date || e.scoredAt?.slice(0, 10) || '',
    e.disposition || '',
    e.csat || '',
    e.iqs,
    ...PARAM_ORDER.map(p => e.scores?.[p] || ''),
    (e.summary || '').replace(/\n/g, ' '),
    e.scoredAt || '',
    e.model || '',
    e.conversationType || '',
    e.frt != null ? e.frt : '',
    e.botToTeamSecs != null ? e.botToTeamSecs : '',
    e.resolutionTime != null ? e.resolutionTime : '',
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
