import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { readConfig } from '@/lib/config';
import { query } from '@/lib/cx/db';
import { storeGetIQSFlags } from '@/lib/store';
import type { IQSFlag } from '@/lib/store';
import { log, withLogging } from '@/lib/log';
import { computeIqsFromRawParams } from '@/lib/quality';

const ROUTE = 'cx/qa/disputes';

export interface DisputeRow {
  flagId:       string;
  chatId:       string;
  agentName:    string;
  agentEmail:   string;
  raisedBy:     string;   // 'IR' | 'TL' | role label
  raisedByName: string;
  iqsScore:     number | null;
  botIqsScore:  number | null;
  callIqsScore:  number | null;
  callTranscriptStatus: 'no_call' | 'pending' | 'transcribed';
  callTranscriptLabel: string;
  closedAt:     string;
  csatScore:    number | null;
  mobileNumber: string | null;
  disposition:  string;
  subDisposition: string | null;
  agentNote:    string;
  challengedParams: { param: string; note: string }[];
  parameters:   Record<string, { score: boolean | null; reasoning: string }>;
  tlForwarded:  boolean;
  conversationType?: 'bot' | 'agent' | 'hybrid';
}

export const GET = withLogging(ROUTE, async (req: NextRequest) => {
  const { searchParams } = new URL(req.url);
  const agentFilter = searchParams.get('agent_filter') || 'human_only';

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

  // Fetch all open flags. QA is the only dispute resolver now:
  //  - 'pending'       — every new agent-raised dispute (goes straight to QA)
  //  - 'tl_forwarded'  — historical, forwarded by TL before the TL stage was removed
  //  - 'ir_pending_tl' — historical, was waiting on TL; TL can no longer action
  //    disputes, so surface these to QA too or they stay pending forever.
  const rawFlags = await storeGetIQSFlags();
  const pendingFlags: IQSFlag[] = rawFlags
    .map(r => { try { return JSON.parse(r) as IQSFlag; } catch { return null; } })
    .filter((f): f is IQSFlag => f !== null && (f.status === 'tl_forwarded' || f.status === 'pending' || f.status === 'ir_pending_tl'));

  log.info(ROUTE, 'flags', { total: rawFlags.length, pending: pendingFlags.length });

  if (!pendingFlags.length) return NextResponse.json({ disputes: [] });

  // Bulk-fetch DB rows for these chat IDs
  const chatIds = [...new Set(pendingFlags.map(f => f.chatId))];
  const dbRows = await query<{
    chat_id: string;
    agent_id: number | null;
    agent_name: string | null;
    closed_at: string;
    disposition: string;
    sub_disposition: string | null;
    iqs_score: string | null;
    call_iqs_score: string | null;
    parameters: any;
    csat_score: string | null;
    mobile_number: string | null;
    contact_id: number | null;
    started_at: string | null;
    conversation_type: string | null;
  }>(
    `SELECT c.id AS chat_id, c.agent_id, a.name AS agent_name,
            c.closed_at,
            c.tags->>'disposition'     AS disposition,
            c.tags->>'sub_disposition' AS sub_disposition,
            i.iqs_score, i.call_iqs_score, i.parameters,
            c.csat_score,
            ct.phone AS mobile_number,
            c.contact_id, c.started_at, c.conversation_type
     FROM conversations c
     JOIN iqs_scores i ON i.chat_id = c.id
     LEFT JOIN agents a ON a.id = c.agent_id
     LEFT JOIN contacts ct ON ct.id = c.contact_id
     WHERE c.id = ANY($1)`,
    [chatIds]
  );

  // Query call recordings for these chats to check transcript statuses
  const contactIds = dbRows.map(r => r.contact_id).filter(Boolean);
  let callRecordings: any[] = [];
  if (chatIds.length > 0) {
    const sql = `
      SELECT id, chat_id, contact_id, called_at, transcript, recording_url
      FROM call_recordings
      WHERE chat_id = ANY($1)
         ${contactIds.length > 0 ? `OR contact_id = ANY($2)` : ''}
    `;
    const params = contactIds.length > 0 ? [chatIds, contactIds] : [chatIds];
    try {
      callRecordings = await query<any>(sql, params);
    } catch (e) {
      console.error('[disputes] Failed to fetch call recordings for status check', e);
    }
  }

  // 3-stage lookup mapper to check call transcript status
  const getCallInfo = (chatId: string, contactId: number | null, startedAtStr: string | null, closedAtStr: string | null) => {
    const matched = callRecordings.filter(rec => {
      if (rec.chat_id === chatId) return true;
      if (contactId && rec.contact_id === contactId) {
        const calledAt = rec.called_at ? new Date(rec.called_at).getTime() : null;
        if (calledAt) {
          const startedAt = startedAtStr ? new Date(startedAtStr).getTime() : 0;
          const closedAt = closedAtStr ? new Date(closedAtStr).getTime() : Date.now();
          const oneHour = 60 * 60 * 1000;
          return calledAt >= (startedAt - oneHour) && calledAt <= (closedAt + oneHour);
        }
      }
      return false;
    });

    if (matched.length === 0) {
      return { status: 'no_call' as const, label: 'No Call' };
    }

    const hasUntranscribed = matched.some(rec => {
      let isTranscribed = false;
      if (rec.transcript) {
        try {
          const parsed = typeof rec.transcript === 'string' ? JSON.parse(rec.transcript) : rec.transcript;
          isTranscribed = Array.isArray(parsed) && parsed.length > 0;
        } catch {}
      }
      return !isTranscribed && rec.recording_url;
    });

    if (hasUntranscribed) {
      return { status: 'pending' as const, label: 'Pending Transcription' };
    } else {
      return { status: 'transcribed' as const, label: 'Transcribed' };
    }
  };

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

    // Robylon AI / Bot check
    const isBot = flag.agentName === 'Robylon AI' || db.agent_name === 'Robylon AI' || (db.agent_id !== null && [15, 447, 784].includes(Number(db.agent_id)));
    if (agentFilter === 'human_only' && isBot) {
      continue;
    }
    if (agentFilter === 'bot_only' && !isBot) {
      continue;
    }

    let params = db.parameters ?? {};
    if (typeof params === 'string') { try { params = JSON.parse(params); } catch { params = {}; } }

    const callInfo = getCallInfo(db.chat_id, db.contact_id, db.started_at, db.closed_at);

    let botIqsScore: number | null = null;
    let iqsScore: number | null = null;
    let callIqsScore: number | null = null;

    if (params.__scores) {
      botIqsScore = params.__scores.bot_iqs !== undefined && params.__scores.bot_iqs !== null ? parseFloat(params.__scores.bot_iqs) : null;
      iqsScore = params.__scores.agent_iqs !== undefined && params.__scores.agent_iqs !== null ? parseFloat(params.__scores.agent_iqs) : null;
      callIqsScore = params.__scores.call_iqs !== undefined && params.__scores.call_iqs !== null ? parseFloat(params.__scores.call_iqs) : null;
    }

    if (iqsScore === null) {
      iqsScore = computeIqsFromRawParams(params, false);
    }
    if (botIqsScore === null) {
      botIqsScore = computeIqsFromRawParams(params, true);
    }
    if (botIqsScore === null && db.iqs_score !== null && db.iqs_score !== undefined) {
      botIqsScore = parseFloat(db.iqs_score);
    }

    disputes.push({
      flagId:           flag.id,
      chatId:           flag.chatId,
      agentName:        flag.agentName,
      agentEmail:       flag.agentEmail,
      raisedBy:         raisedByLabel(flag.agentEmail),
      raisedByName:     flag.agentName,
      iqsScore,
      botIqsScore,
      callIqsScore,
      callTranscriptStatus: callInfo.status,
      callTranscriptLabel: callInfo.label,
      closedAt:         db.closed_at,
      csatScore:        db.csat_score ? parseInt(db.csat_score) : null,
      mobileNumber:     db.mobile_number ?? null,
      disposition:      db.disposition,
      subDisposition:   db.sub_disposition,
      agentNote:        flag.agentNote,
      challengedParams: flag.challengedParams ?? [],
      parameters:       params,
      tlForwarded:      flag.status === 'tl_forwarded',
      conversationType: db.conversation_type as any,
    });
  }

  // Filter by agent_filter or has_calls if provided
  const hasCallsParam = searchParams.get('has_calls') || searchParams.get('call_filter');
  let finalDisputes = disputes;
  if (agentFilter === 'has_calls' || hasCallsParam === 'has_calls' || hasCallsParam === 'true' || hasCallsParam === 'yes') {
    finalDisputes = disputes.filter(d => d.callTranscriptStatus !== 'no_call');
  } else if (hasCallsParam === 'no_calls' || hasCallsParam === 'false' || hasCallsParam === 'no') {
    finalDisputes = disputes.filter(d => d.callTranscriptStatus === 'no_call');
  }

  // Sort by closedAt desc
  finalDisputes.sort((a, b) => b.closedAt.localeCompare(a.closedAt));

  log.info(ROUTE, 'result', {
    flagCount: pendingFlags.length,
    filteredCount: finalDisputes.length,
    dispositionCount: dispositions.length,
    durationMs: Date.now() - t0,
  });

  return NextResponse.json({ disputes: finalDisputes });
});
