import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { readConfig } from '@/lib/config';
import { query } from '@/lib/cx/db';
import { storeGetIQSFlags } from '@/lib/store';
import type { IQSFlag } from '@/lib/store';
import { log, withLogging } from '@/lib/log';

const ROUTE = 'cx/qa/disputes';

export interface DisputeRow {
  flagId:       string;
  chatId:       string;
  agentName:    string;
  agentEmail:   string;
  raisedBy:     string;   // 'IR' | 'TL' | role label
  raisedByName: string;
  iqsScore:     number;
  closedAt:     string;
  disposition:  string;
  subDisposition: string | null;
  agentNote:    string;
  challengedParams: { param: string; note: string }[];
  parameters:   Record<string, { score: boolean | null; reasoning: string }>;
}

export const GET = withLogging(ROUTE, async (req: NextRequest) => {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const role  = (session.user as any).role as string;
  const email = ((session.user as any).email || '') as string;

  if (!['quality', 'admin'].includes(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const t0 = Date.now();

  // Resolve QA's dispositions
  const config = await readConfig();
  let dispositions: string[];
  if (role === 'admin') {
    const rows = await query<{ d: string }>(
      `SELECT DISTINCT tags->>'disposition' AS d FROM conversations
       WHERE tags->>'disposition' IS NOT NULL AND tags->>'disposition' != ''`
    );
    dispositions = rows.map(r => r.d);
  } else {
    const map = config.qaDispositionMap ?? [];
    const entry = map.find(e => e.email.toLowerCase() === email.toLowerCase());
    dispositions = entry?.dispositions ?? [];
  }

  if (!dispositions.length) {
    log.warn(ROUTE, 'no dispositions', { email, role });
    return NextResponse.json({ disputes: [] });
  }

  // Fetch all pending flags from KV
  const rawFlags = await storeGetIQSFlags();
  const pendingFlags: IQSFlag[] = rawFlags
    .map(r => { try { return JSON.parse(r) as IQSFlag; } catch { return null; } })
    .filter((f): f is IQSFlag => f !== null && f.status === 'pending');

  log.info(ROUTE, 'flags', { total: rawFlags.length, pending: pendingFlags.length });

  if (!pendingFlags.length) return NextResponse.json({ disputes: [] });

  // Bulk-fetch DB rows for these chat IDs
  const chatIds = [...new Set(pendingFlags.map(f => f.chatId))];
  const dbRows = await query<{
    chat_id: string;
    agent_name: string | null;
    closed_at: string;
    disposition: string;
    sub_disposition: string | null;
    iqs_score: string;
    parameters: any;
  }>(
    `SELECT c.id AS chat_id, a.name AS agent_name,
            c.closed_at,
            c.tags->>'disposition'     AS disposition,
            c.tags->>'sub_disposition' AS sub_disposition,
            i.iqs_score, i.parameters
     FROM conversations c
     JOIN iqs_scores i ON i.chat_id = c.id
     LEFT JOIN agents a ON a.id = c.agent_id
     WHERE c.id = ANY($1)`,
    [chatIds]
  );

  // Index DB rows by chatId
  const dbMap = new Map(dbRows.map(r => [r.chat_id, r]));

  // Build email → role map from config users for IR/TL labelling
  const roleMap: Record<string, string> = {};
  for (const u of config.users ?? []) {
    const key = (u.email || u.username || '').toLowerCase();
    if (key) roleMap[key] = u.role ?? 'agent';
  }
  function raisedByLabel(email: string): string {
    const r = roleMap[email.toLowerCase()] ?? 'agent';
    if (r === 'tl') return 'TL';
    return 'IR'; // agent / unknown → IR (Individual Representative)
  }

  const disputes: DisputeRow[] = [];
  for (const flag of pendingFlags) {
    const db = dbMap.get(flag.chatId);
    if (!db) continue;

    // Scope-check: only disputes in QA's dispositions
    if (!dispositions.includes(db.disposition)) continue;

    let params = db.parameters ?? {};
    if (typeof params === 'string') { try { params = JSON.parse(params); } catch { params = {}; } }

    disputes.push({
      flagId:           flag.id,
      chatId:           flag.chatId,
      agentName:        flag.agentName,
      agentEmail:       flag.agentEmail,
      raisedBy:         raisedByLabel(flag.agentEmail),
      raisedByName:     flag.agentName,
      iqsScore:         parseInt(db.iqs_score),
      closedAt:         db.closed_at,
      disposition:      db.disposition,
      subDisposition:   db.sub_disposition,
      agentNote:        flag.agentNote,
      challengedParams: flag.challengedParams ?? [],
      parameters:       params,
    });
  }

  // Sort by closedAt desc
  disputes.sort((a, b) => b.closedAt.localeCompare(a.closedAt));

  log.info(ROUTE, 'result', {
    flagCount: pendingFlags.length,
    filteredCount: disputes.length,
    dispositionCount: dispositions.length,
    durationMs: Date.now() - t0,
  });

  return NextResponse.json({ disputes });
});
