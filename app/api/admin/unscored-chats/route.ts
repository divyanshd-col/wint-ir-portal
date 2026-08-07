import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { query } from '@/lib/cx/db';
import { executeScoring } from '@/lib/scoring/engine';
import { getAgentName } from '@/lib/robylon/db';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const userAny = session?.user as any;
  const role = userAny?.role || (userAny?.isAdmin ? 'admin' : '');
  if (role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '20', 10)));
  const offset = (page - 1) * limit;
  const chatIdSearch = searchParams.get('chat_id')?.trim() || '';
  const agentFilter = searchParams.get('agent_filter') || 'all';
  const statusFilter = searchParams.get('status_filter') || 'all';
  const from = searchParams.get('from') || '';
  const to = searchParams.get('to') || '';

  const whereConditions: string[] = [];
  const params: any[] = [];

  if (statusFilter === 'no_iqs_row') {
    whereConditions.push('s.chat_id IS NULL');
  } else if (statusFilter === 'skipped') {
    whereConditions.push("s.status = 'skipped'");
  } else {
    whereConditions.push("(s.chat_id IS NULL OR s.status = 'skipped')");
  }

  if (agentFilter === 'human_only') {
    whereConditions.push("c.conversation_type <> 'bot'");
  } else if (agentFilter === 'bot_only') {
    whereConditions.push("c.conversation_type = 'bot'");
  }

  if (chatIdSearch) {
    params.push(`%${chatIdSearch}%`);
    whereConditions.push(`c.id::text LIKE $${params.length}`);
  }

  if (from) {
    params.push(from);
    whereConditions.push(`c.started_at >= $${params.length}::date`);
  }
  if (to) {
    params.push(to);
    whereConditions.push(`c.started_at < ($${params.length}::date + INTERVAL '1 day')`);
  }

  const whereClause = whereConditions.join(' AND ');

  const countSql = `
    SELECT 
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE s.chat_id IS NULL) AS unscored_count,
      COUNT(*) FILTER (WHERE s.status = 'skipped') AS skipped_count
    FROM conversations c
    LEFT JOIN iqs_scores s ON s.chat_id = c.id
    WHERE ${whereClause}
  `;

  const counts = await query<any>(countSql, params);
  const total = parseInt(counts[0]?.total || '0', 10);
  const unscoredCount = parseInt(counts[0]?.unscored_count || '0', 10);
  const skippedCount = parseInt(counts[0]?.skipped_count || '0', 10);

  const dataParams = [...params, limit, offset];
  const listSql = `
    SELECT 
      c.id,
      c.started_at,
      c.closed_at,
      c.agent_id,
      c.conversation_type,
      c.tags,
      c.transcript,
      a.name AS agent_name,
      s.status AS iqs_status,
      s.model_version,
      s.call_iqs_score
    FROM conversations c
    LEFT JOIN iqs_scores s ON s.chat_id = c.id
    LEFT JOIN agents a ON a.id = c.agent_id
    WHERE ${whereClause}
    ORDER BY c.started_at DESC
    LIMIT $${params.length + 1} OFFSET $${params.length + 2}
  `;

  const rows = await query<any>(listSql, dataParams);

  const chatIds = rows.map(r => String(r.id));
  let callsByChat: Record<string, any[]> = {};
  if (chatIds.length > 0) {
    try {
      const callRows = await query<any>(
        `SELECT id, chat_id, recording_url, duration_seconds, called_at, language, transcript, interruption_count, dead_air_count
         FROM call_recordings WHERE chat_id = ANY($1)`,
        [chatIds]
      );
      for (const call of callRows) {
        if (!call.chat_id) continue;
        const key = String(call.chat_id);
        if (!callsByChat[key]) callsByChat[key] = [];
        const segments = typeof call.transcript === 'string' ? JSON.parse(call.transcript) : (call.transcript || []);
        callsByChat[key].push({
          id: call.id,
          recordingUrl: call.recording_url,
          durationSeconds: call.duration_seconds,
          calledAt: call.called_at,
          language: call.language,
          segments: Array.isArray(segments) ? segments : [],
          interruptionCount: call.interruption_count || 0,
          deadAirCount: call.dead_air_count || 0,
        });
      }
    } catch (err) {
      console.warn('[unscored-chats] Failed to fetch call recordings:', err);
    }
  }

  const chats = rows.map(r => {
    const rawMsgs = Array.isArray(r.transcript) 
      ? r.transcript 
      : Array.isArray(r.transcript?.messages) ? r.transcript.messages : [];
    const tags = r.tags || {};

    const messages = rawMsgs.map((m: any) => ({
      sender: m.sender_type === 'customer' || m.sender_type === 'user' ? 'Customer'
            : m.sender_type === 'bot' ? 'Myra'
            : m.sender_name || m.sender || 'Agent',
      content: m.content || m.text || '',
      timestamp: m.timestamp || m.created_at || m.ts || undefined,
    }));

    let details = '';
    if (r.iqs_status === 'skipped') {
      if (r.model_version && r.model_version.startsWith('skipped:')) {
        details = r.model_version.replace('skipped:', '').trim();
      } else if (r.call_iqs_score !== null && r.call_iqs_score !== undefined) {
        details = 'Call interaction evaluated (Chat skipped)';
      } else {
        details = 'Call interaction / Skipped from text scoring';
      }
    } else {
      if (rawMsgs.length === 0) {
        details = 'No transcript messages';
      } else if (!tags.disposition) {
        details = 'Untagged (waiting for disposition)';
      } else {
        details = 'Pending automated evaluation';
      }
    }

    return {
      id: String(r.id),
      startedAt: r.started_at,
      closedAt: r.closed_at,
      agentId: r.agent_id,
      agentName: r.agent_name || (r.conversation_type === 'bot' ? 'Myra (Bot)' : 'Unassigned'),
      conversationType: r.conversation_type || 'agent',
      disposition: tags.disposition || 'Untagged',
      subDisposition: tags.sub_disposition || '',
      msgCount: rawMsgs.length,
      iqsStatus: r.iqs_status === 'skipped' ? 'skipped' : 'unscored',
      skipReason: details,
      messages,
      callRecordings: callsByChat[String(r.id)] || [],
    };
  });

  return NextResponse.json({
    ok: true,
    total,
    unscoredCount,
    skippedCount,
    page,
    limit,
    chats,
  });
}

export async function POST(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const auth = req.headers.get('authorization') || '';
  const { searchParams } = new URL(req.url);
  const isSecretAuth = cronSecret && (auth === `Bearer ${cronSecret}` || searchParams.get('secret') === cronSecret);

  const session = await getServerSession(authOptions);
  const userAny = session?.user as any;
  const role = userAny?.role || (userAny?.isAdmin ? 'admin' : '');

  if (role !== 'admin' && !isSecretAuth) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const chatId = body.chatId ? String(body.chatId) : null;

  if (!chatId) {
    return NextResponse.json({ error: 'chatId is required' }, { status: 400 });
  }

  const convRows = await query<any>('SELECT * FROM conversations WHERE id = $1', [chatId]);
  const conv = convRows[0];
  if (!conv) {
    return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
  }

  const tags = conv.tags || {};
  const disposition = tags.disposition || '';
  const subDisposition = tags.sub_disposition || '';
  const agentName = conv.agent_id ? await getAgentName(conv.agent_id) : '';

  const scored = await executeScoring(conv, agentName, disposition, subDisposition);
  if (!scored) {
    return NextResponse.json({ ok: false, message: 'Scoring lock held or unscoreable content' });
  }

  return NextResponse.json({ ok: true, chatId, iqs: scored.iqs });
}
