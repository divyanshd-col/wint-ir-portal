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
  callId?:      string;
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
  gates?:       any;
  tlForwarded:  boolean;
  conversationType?: 'bot' | 'agent' | 'hybrid';
  reviewedBy?:  string | null;
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

  // Resolve QA's dispositions and assigned agents
  // admin and quality both see ALL disputes across all dispositions (unscoped)
  const config = await readConfig();
  let dispositions: string[] = [];
  let myAgents: Set<string> | null = null;
  const me = config.users.find(u => (u.email || u.username)?.toLowerCase() === email.toLowerCase());
  const myQAName = me?.agentName || email.split('@')[0];
  
  const map = config.qaDispositionMap ?? [];
  const qaEntry = map.find(e => e.email.toLowerCase() === email.toLowerCase());
  const configUser = me;

  if (email.toLowerCase() === 'manorathi@wintwealth.com' || email.toLowerCase() === 'manorathi.t@wintwealth.com') {
    const rows = await query<{ d: string }>(
      `SELECT DISTINCT tags->>'disposition' AS d FROM conversations
       WHERE tags->>'disposition' IS NOT NULL AND tags->>'disposition' != ''`
    );
    dispositions = rows.map(r => r.d);
  } else if (qaEntry && qaEntry.dispositions.length > 0) {
    dispositions = qaEntry.dispositions;
  } else if (role === 'admin') {
    const rows = await query<{ d: string }>(
      `SELECT DISTINCT tags->>'disposition' AS d FROM conversations
       WHERE tags->>'disposition' IS NOT NULL AND tags->>'disposition' != ''`
    );
    dispositions = rows.map(r => r.d);
  } else if (role === 'quality') {
    dispositions = configUser?.assignedDispositions ?? [];
    
    try {
      const rows = await query<{ name: string }>(
        `SELECT name FROM agents WHERE LOWER(qa_name) = LOWER($1)`,
        [myQAName],
      );
      if (rows.length > 0) {
        myAgents = new Set(rows.map((r: any) => (r.name || '').toLowerCase()));
      }
    } catch {
      // CX DB unavailable
    }
  }

  // QA only sees disputes once TL has forwarded them — 'pending'/'ir_pending_tl'
  // are still awaiting TL review and stay off QA's queue until forwarded.
  const rawFlags = await storeGetIQSFlags();
  const pendingFlags: IQSFlag[] = rawFlags
    .map(r => { try { return JSON.parse(r) as IQSFlag; } catch { return null; } })
    .filter((f): f is IQSFlag => f !== null && f.status === 'tl_forwarded');

  log.info(ROUTE, 'flags', { total: rawFlags.length, pending: pendingFlags.length });

  if (!pendingFlags.length) return NextResponse.json({ disputes: [] });

  // Bulk-fetch DB rows for these chat IDs
  const chatIds = [...new Set(pendingFlags.map(f => f.chatId).filter(Boolean))];
  const targetCallIds = [...new Set(pendingFlags.map(f => f.callId || f.chatId).filter(Boolean))];

  const dbRows = chatIds.length > 0 ? await query<{
    chat_id: string;
    agent_id: number | null;
    agent_name: string | null;
    closed_at: string;
    disposition: string;
    sub_disposition: string | null;
    iqs_score: string | null;
    call_iqs_score: string | null;
    parameters: any;
    chat_reviewed_by: string | null;
    call_reviewed_by: string | null;
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
            i.reviewed_by AS chat_reviewed_by,
            (SELECT reviewed_by FROM call_evaluations ce WHERE ce.chat_id = c.id AND reviewed_by IS NOT NULL AND reviewed_by != '' LIMIT 1) AS call_reviewed_by,
            c.csat_score,
            ct.phone AS mobile_number,
            c.contact_id, c.started_at, c.conversation_type
     FROM conversations c
     LEFT JOIN iqs_scores i ON i.chat_id = c.id
     LEFT JOIN agents a ON a.id = c.agent_id
     LEFT JOIN contacts ct ON ct.id = c.contact_id
     WHERE c.id = ANY($1)`,
    [chatIds]
  ) : [];

  // Bulk-fetch call data
  let callDbRows: any[] = [];
  if (targetCallIds.length > 0) {
    try {
      callDbRows = await query<{
        call_id: string; chat_id: string | null; agent_name: string | null;
        called_at: string; disposition: string; sub_disposition: string | null;
        iqs_percent: string | null; parameters: any; gates: any; reviewed_by: string | null;
        duration_seconds: number | null;
      }>(
        `SELECT ce.call_id, ce.chat_id, COALESCE(a.name, '') AS agent_name,
                cr.called_at, cr.call_disposition AS disposition,
                cr.call_sub_disposition AS sub_disposition,
                ce.iqs_percent, ce.iqs_scores AS parameters,
                ce.gates,
                ce.reviewed_by, cr.duration_seconds
         FROM call_evaluations ce
         JOIN call_recordings cr ON cr.id = ce.call_id
         LEFT JOIN agents a ON a.id = ce.agent_id
         WHERE ce.call_id = ANY($1) OR ce.chat_id = ANY($1)`,
        [targetCallIds]
      );
    } catch {}
  }
  const callDbMap = new Map<string, any>();
  callDbRows.forEach(r => {
    if (r.call_id) callDbMap.set(r.call_id, r);
    if (r.chat_id) callDbMap.set(r.chat_id, r);
  });

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
    const callDb = callDbMap.get(flag.callId || flag.chatId);
    if (!db && !callDb) continue;

    const chatReviewer = (db?.chat_reviewed_by || db?.call_reviewed_by || callDb?.reviewed_by || '').trim();
    const effectiveDisposition = db?.disposition || callDb?.disposition || '';
    const effectiveAgentName = db?.agent_name || callDb?.agent_name || flag.agentName;

    // Scope-check: disputes should be sent to the QA who reviewed it; otherwise based on disposition
    if (role === 'quality' || (role === 'admin' && dispositions.length > 0)) {
      let isReviewedByQA = false;
      if (chatReviewer) {
        const revLower = chatReviewer.toLowerCase();
        const reviewerUser = config.users?.find((u: any) =>
          (u.email || u.username)?.toLowerCase() === revLower ||
          u.agentName?.toLowerCase() === revLower
        );

        if (reviewerUser?.role === 'quality') {
          isReviewedByQA = true;
          const emailLower = email.toLowerCase();
          const qaNameLower = (myQAName || '').toLowerCase();
          const usernameLower = (me?.username || '').toLowerCase();

          const isReviewer =
            revLower === emailLower ||
            (qaNameLower && revLower === qaNameLower) ||
            (usernameLower && revLower === usernameLower) ||
            (emailLower.includes('@') && revLower === emailLower.split('@')[0]);

          if (!isReviewer) {
            continue;
          }
        }
      }

      if (!isReviewedByQA) {
        // Chat/Call was not reviewed by a specific QA — fallback to mapped dispositions or assigned agents
        const agentMatches = myAgents && effectiveAgentName && myAgents.has(effectiveAgentName.toLowerCase());
        const dispositionMatches = dispositions.length > 0 && effectiveDisposition && dispositions.includes(effectiveDisposition);

        if (dispositions.length > 0) {
          if (!dispositionMatches) continue;
        } else if (myAgents && myAgents.size > 0) {
          if (!agentMatches) continue;
        }
      }
    }

    // Robylon AI / Bot check
    const isBot = flag.agentName === 'Robylon AI' || db?.agent_name === 'Robylon AI' || (db?.agent_id !== null && [15, 447, 784].includes(Number(db?.agent_id)));
    if (agentFilter === 'human_only' && isBot) {
      continue;
    }
    if (agentFilter === 'bot_only' && !isBot) {
      continue;
    }

    const isCallFlag = Boolean(flag.callId || callDb?.call_id || flag.challengedParams?.some(p => p.param.startsWith('P')));
    let params = isCallFlag ? (callDb?.parameters ?? db?.parameters ?? {}) : (db?.parameters ?? callDb?.parameters ?? {});
    if (typeof params === 'string') { try { params = JSON.parse(params); } catch { params = {}; } }

    const callInfo = db ? getCallInfo(db.chat_id, db.contact_id, db.started_at, db.closed_at) : { status: 'transcribed' as const, label: 'Call' };

    let botIqsScore: number | null = null;
    let iqsScore: number | null = null;
    let callIqsScore: number | null = null;

    if (params.__scores) {
      botIqsScore = params.__scores.bot_iqs !== undefined && params.__scores.bot_iqs !== null ? parseFloat(params.__scores.bot_iqs) : null;
      iqsScore = params.__scores.agent_iqs !== undefined && params.__scores.agent_iqs !== null ? parseFloat(params.__scores.agent_iqs) : null;
      callIqsScore = params.__scores.call_iqs !== undefined && params.__scores.call_iqs !== null ? parseFloat(params.__scores.call_iqs) : null;
    }

    if (callDb?.iqs_percent != null) {
      callIqsScore = parseFloat(callDb.iqs_percent);
      if (iqsScore === null) iqsScore = callIqsScore;
    }

    if (iqsScore === null && !isBot && !callDb) {
      iqsScore = computeIqsFromRawParams(params, false);
    }
    if (botIqsScore === null && !callDb) {
      botIqsScore = computeIqsFromRawParams(params, true);
    }
    if (botIqsScore === null && db?.iqs_score !== null && db?.iqs_score !== undefined) {
      botIqsScore = parseFloat(db.iqs_score);
    }
    if (isBot) {
      iqsScore = null;
    }

    disputes.push({
      flagId:           flag.id,
      chatId:           flag.chatId,
      callId:           flag.callId || callDb?.call_id,
      agentName:        effectiveAgentName,
      agentEmail:       flag.agentEmail,
      raisedBy:         raisedByLabel(flag.agentEmail),
      raisedByName:     flag.agentName,
      iqsScore,
      botIqsScore,
      callIqsScore,
      callTranscriptStatus: callInfo.status,
      callTranscriptLabel: callInfo.label,
      closedAt:         db?.closed_at ? new Date(db.closed_at).toISOString() : (callDb?.called_at ? new Date(callDb.called_at).toISOString() : flag.flaggedAt || ''),
      csatScore:        db?.csat_score ? parseInt(db.csat_score) : null,
      mobileNumber:     db?.mobile_number ?? null,
      disposition:      effectiveDisposition,
      subDisposition:   db?.sub_disposition || callDb?.sub_disposition || null,
      agentNote:        flag.agentNote,
      challengedParams: flag.challengedParams ?? [],
      parameters:       params,
      gates:            callDb?.gates ?? null,
      tlForwarded:      flag.status === 'tl_forwarded',
      conversationType: (db?.conversation_type ?? null) as any,
      reviewedBy:       chatReviewer || null,
    } as any);
  }

  // Filter by type (calls vs chats) if provided
  const typeParam = searchParams.get('type');
  let finalDisputes = disputes;
  if (typeParam === 'calls') {
    finalDisputes = disputes.filter(d => Boolean(d.callId || d.callIqsScore != null || d.challengedParams?.some(p => p.param.startsWith('P'))));
  } else if (typeParam === 'chats') {
    finalDisputes = disputes.filter(d => !d.callId && !d.challengedParams?.some(p => p.param.startsWith('P')));
  }

  // Filter by agent_filter or has_calls if provided
  const hasCallsParam = searchParams.get('has_calls') || searchParams.get('call_filter');
  if (agentFilter === 'has_calls' || hasCallsParam === 'has_calls' || hasCallsParam === 'true' || hasCallsParam === 'yes') {
    finalDisputes = finalDisputes.filter(d => d.callTranscriptStatus !== 'no_call');
  } else if (hasCallsParam === 'no_calls' || hasCallsParam === 'false' || hasCallsParam === 'no') {
    finalDisputes = finalDisputes.filter(d => d.callTranscriptStatus === 'no_call');
  }

  // Sort by closedAt desc safely
  finalDisputes.sort((a, b) => new Date(b.closedAt || 0).getTime() - new Date(a.closedAt || 0).getTime());

  log.info(ROUTE, 'result', {
    flagCount: pendingFlags.length,
    filteredCount: finalDisputes.length,
    dispositionCount: dispositions.length,
    durationMs: Date.now() - t0,
  });

  return NextResponse.json({ disputes: finalDisputes });
});
