import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-guard';
import { query } from '@/lib/cx/db';
import { withLogging } from '@/lib/log';

const ROUTE = 'admin/pcg-calls';

export const GET = withLogging(ROUTE, async (req: NextRequest) => {
  const { session, response } = await requireRole(['admin']);
  if (response) return response;

  const { searchParams } = new URL(req.url);
  const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '20')));
  const offset = (page - 1) * limit;

  const agentFilter = searchParams.get('agent_name')?.trim();
  const searchFilter = searchParams.get('search')?.trim();

  // Base WHERE clause: strictly complete calls with valid audio, agent name, phone, and duration > 0
  const whereClauses = [
    `recording_url IS NOT NULL`,
    `recording_url != ''`,
    `agent_name IS NOT NULL`,
    `agent_name != ''`,
    `LOWER(agent_name) != 'unknown'`,
    `duration_seconds > 0`,
  ];

  const sqlParams: any[] = [];
  let paramIdx = 1;

  if (agentFilter && agentFilter !== 'all') {
    whereClauses.push(`agent_name = $${paramIdx++}`);
    sqlParams.push(agentFilter);
  }

  if (searchFilter) {
    whereClauses.push(`(phone_number LIKE $${paramIdx} OR call_id LIKE $${paramIdx})`);
    sqlParams.push(`%${searchFilter}%`);
    paramIdx++;
  }

  const whereSql = whereClauses.join(' AND ');

  try {
    // 1. Fetch total count
    const countResult = await query<{ total: string }>(
      `SELECT COUNT(*) as total FROM pcg_call_recordings WHERE ${whereSql}`,
      sqlParams
    );
    const total = parseInt(countResult[0]?.total || '0', 10);

    // 2. Fetch distinct complete agents list for filter dropdown
    const agentsResult = await query<{ agent_name: string; count: string }>(
      `SELECT agent_name, COUNT(*) as count 
       FROM pcg_call_recordings 
       WHERE recording_url IS NOT NULL 
         AND agent_name IS NOT NULL 
         AND agent_name != '' 
         AND LOWER(agent_name) != 'unknown'
         AND duration_seconds > 0
       GROUP BY agent_name 
       ORDER BY agent_name ASC`
    );

    // 3. Fetch summary metrics
    const summaryResult = await query<{ total_duration: string; total_calls: string }>(
      `SELECT COALESCE(SUM(duration_seconds), 0) as total_duration, COUNT(*) as total_calls
       FROM pcg_call_recordings 
       WHERE recording_url IS NOT NULL 
         AND agent_name IS NOT NULL 
         AND agent_name != '' 
         AND LOWER(agent_name) != 'unknown'
         AND duration_seconds > 0`
    );

    // 4. Fetch paginated calls data
    const dataSqlParams = [...sqlParams, limit, offset];
    const rows = await query<{
      id: string;
      call_id: string;
      agent_name: string;
      phone_number: string | null;
      user_phone: string | null;
      call_type: string | null;
      tag: string | null;
      duration_seconds: number;
      start_time: string | null;
      recording_url: string;
    }>(
      `SELECT id, call_id, agent_name, phone_number, user_phone, call_type, tag, duration_seconds, start_time, recording_url
       FROM pcg_call_recordings
       WHERE ${whereSql}
       ORDER BY start_time DESC NULLS LAST, id DESC
       LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
      dataSqlParams
    );

    return NextResponse.json({
      success: true,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      agents: agentsResult.map(a => ({ name: a.agent_name, count: parseInt(a.count, 10) })),
      summary: {
        totalCalls: parseInt(summaryResult[0]?.total_calls || '0', 10),
        totalDurationSeconds: parseInt(summaryResult[0]?.total_duration || '0', 10),
        activeAgentsCount: agentsResult.length,
      },
      calls: rows.map(r => ({
        id: r.id,
        callId: r.call_id,
        agentName: r.agent_name,
        phoneNumber: r.phone_number || r.user_phone || 'N/A',
        callType: r.call_type || 'N/A',
        tag: r.tag || null,
        durationSeconds: r.duration_seconds || 0,
        startTime: r.start_time,
        hasRecording: !!r.recording_url,
      })),
    });
  } catch (error: any) {
    console.error('[admin/pcg-calls] Error fetching PCG calls:', error);
    return NextResponse.json({ error: 'Failed to fetch PCG calls' }, { status: 500 });
  }
});
