/**
 * GET /api/quality/export
 * Returns ALL IQS scores ever stored as a CSV file download.
 * Supports optional filters: agent, dateFrom, dateTo, tag
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-guard';
import { ALL_DB_KEY_TO_PASCAL } from '@/lib/param-keys';
import { getAllScoredConversations, getAgentNamesByTL, getAgentNamesByQA, type GetScoredConversationsOptions } from '@/lib/robylon/db';
import { PARAM_ORDER, PARAM_NAMES } from '@/lib/quality';
import type { IQSScoreEntry } from '@/lib/quality';

function escapeCSV(v: unknown): string {
  return `"${String(v ?? '').replace(/"/g, '""')}"`;
}

// ── Convert PostgreSQL row → IQSScoreEntry ────────────────────────────────────
function toIQSScoreEntry(row: any): IQSScoreEntry {
  const rawParams = row.parameters || {};
  const isBotRow = row.conversationType === 'bot' || (!rawParams.__agent_parameters && Boolean(rawParams.__bot_parameters));
  const targetParams = isBotRow
    ? (rawParams.__bot_parameters || rawParams)
    : (rawParams.__agent_parameters || rawParams);

  const scores: Record<string, string> = {};
  const reasoning: Record<string, string> = {};
  for (const [key, val] of Object.entries(targetParams) as [string, any][]) {
    if (key.startsWith('__')) continue;
    const k = ALL_DB_KEY_TO_PASCAL[key] ?? (key.charAt(0).toUpperCase() + key.slice(1));
    const sc = val?.score;
    scores[k]    = (sc === true || sc === 1 || sc === 'Yes' || sc === 'pass') ? 'Yes'
      : (sc === 0.5 || sc === 'Half' || sc === 'half') ? 'Half'
      : (sc === false || sc === 0 || sc === 'No' || sc === 'fail') ? 'No'
      : 'NA';
    reasoning[k] = val?.reasoning || val?.comment || '';
  }
  const csatStr = row.csat_score ? String(row.csat_score) : '';
  const tags = row.tags || {};
  return {
    id:              `${row.scoredAt}-${row.chatId}`,
    chatId:          row.chatId,
    scoredAt:        row.scoredAt,
    agentName:       row.agentName || '',
    date:            row.date ? String(row.date).slice(0, 10) : '',
    iqs:             rawParams?.__scores?.agent_iqs ?? row.iqs,
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
  const { session, response } = await requireRole(['admin', 'quality', 'tl']);
  if (response) return response;

  const role = (session.user as any)?.role;
  const email = (session.user as any)?.email || '';

  let selfAgentName = '';
  let scopedAgentNames: string[] | null = null;
  let strictDispositions: string[] | null = null;

  if (['agent', 'tl', 'quality', 'admin'].includes(role)) {
    const { readConfig } = await import('@/lib/config');
    const config = await readConfig();
    const configUser = config.users.find(u => (u.email || u.username || '').toLowerCase() === email.toLowerCase());
    selfAgentName = configUser?.agentName || '';
    if (!selfAgentName && email) {
      const { getUserByEmail } = await import('@/lib/users');
      const dbUser = await getUserByEmail(email).catch(() => null);
      if (dbUser?.name) selfAgentName = dbUser.name;
    }
    
    const qaMapEntry = (config.qaDispositionMap ?? []).find(e => e.email.toLowerCase() === email.toLowerCase());
    const userDisps = qaMapEntry?.dispositions ?? configUser?.assignedDispositions;

    if (['quality', 'admin'].includes(role) && userDisps?.length) {
      if (email.toLowerCase() !== 'manorathi@wintwealth.com' && email.toLowerCase() !== 'manorathi.t@wintwealth.com') {
        strictDispositions = userDisps;
      }
    }
  }

  if (role === 'tl' && selfAgentName) {
    scopedAgentNames = await getAgentNamesByTL(selfAgentName);
  } else if (role === 'quality' && selfAgentName) {
    scopedAgentNames = await getAgentNamesByQA(selfAgentName);
  }

  const { searchParams } = new URL(req.url);
  const agentFilter    = searchParams.get('agent') || '';
  const tagFilter      = searchParams.get('tag') || '';
  const subTagFilter   = searchParams.get('subTag') || '';
  const csatFilter     = searchParams.get('csat') || '';
  const dateFrom       = searchParams.get('dateFrom') || '';
  const dateTo         = searchParams.get('dateTo') || '';
  const typeFilter     = searchParams.get('type') || '';

  const dbOpts: GetScoredConversationsOptions = { limit: 10000 };
  
  if (scopedAgentNames !== null) {
    if (agentFilter) dbOpts.agentName = agentFilter;
    else dbOpts.agentNames = scopedAgentNames;
  } else if (agentFilter) {
    dbOpts.agentName = agentFilter;
  }

  if (strictDispositions) {
    if (tagFilter) {
      if (strictDispositions.includes(tagFilter)) {
        dbOpts.disposition = tagFilter;
      } else {
        dbOpts.disposition = '__UNAUTHORIZED__';
      }
    } else {
      dbOpts.dispositions = strictDispositions;
    }
  } else {
    if (tagFilter) dbOpts.disposition = tagFilter;
  }

  if (subTagFilter) dbOpts.subDisposition = subTagFilter;
  if (csatFilter)   dbOpts.csat = csatFilter;
  if (dateFrom)     dbOpts.dateFrom = dateFrom;
  if (dateTo)       dbOpts.dateTo = dateTo;
  if (typeFilter)   dbOpts.conversationType = typeFilter;

  const { rows: rawRows } = await getAllScoredConversations(dbOpts);
  let entries: IQSScoreEntry[] = rawRows.map(row => {
    try { return toIQSScoreEntry(row); } catch { return null; }
  }).filter(Boolean) as IQSScoreEntry[];

  const ROBYLON_BASE = 'https://app.robylon.ai/unified-inbox/share';

  // CSV headers
  const paramCols = PARAM_ORDER.map(p => PARAM_NAMES[p]);
  const headers = [
    'Chat ID', 'Chat Link', 'Agent', 'Date', 'Disposition', 'Sub-Disposition', 'CSAT', 'IQS',
    ...paramCols,
    'Summary', 'Scored At', 'Model',
    'Conversation Type', 'FRT secs', 'B→T secs', 'Resolution secs',
  ];

  const rows = entries.map(e => [
    e.chatId,
    /^\d+$/.test((e.chatId || '').trim()) ? `${ROBYLON_BASE}/${e.chatId}` : '',
    e.agentName || '',
    e.date || e.scoredAt?.slice(0, 10) || '',
    e.disposition || '',
    (e as any).subDisposition || '',
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
