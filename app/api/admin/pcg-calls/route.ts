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

  const rmFilter = searchParams.get('rm_name')?.trim();
  const callStatusFilter = searchParams.get('status')?.trim(); // 'answered' | 'unanswered' | 'all'
  const searchFilter = searchParams.get('search')?.trim();

  // Base WHERE clause
  const whereClauses: string[] = [];
  const sqlParams: any[] = [];
  let paramIdx = 1;

  if (rmFilter && rmFilter !== 'all') {
    whereClauses.push(`COALESCE(NULLIF(called_by, ''), NULLIF(agent_name, ''), 'Unknown RM') = $${paramIdx++}`);
    sqlParams.push(rmFilter);
  }

  if (callStatusFilter === 'answered') {
    whereClauses.push(`duration_seconds > 0 AND recording_url IS NOT NULL AND recording_url != ''`);
  } else if (callStatusFilter === 'unanswered') {
    whereClauses.push(`(duration_seconds = 0 OR duration_seconds IS NULL OR recording_url IS NULL OR recording_url = '')`);
  }

  if (searchFilter) {
    whereClauses.push(`(phone_number LIKE $${paramIdx} OR user_phone LIKE $${paramIdx} OR call_id LIKE $${paramIdx} OR customer_id LIKE $${paramIdx})`);
    sqlParams.push(`%${searchFilter}%`);
    paramIdx++;
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

  try {
    // 1. Fetch total count
    const countResult = await query<{ total: string }>(
      `SELECT COUNT(*) as total FROM pcg_call_recordings ${whereSql}`,
      sqlParams
    );
    const total = parseInt(countResult[0]?.total || '0', 10);

    // 2. Fetch distinct RM list for filter dropdown (sorted alphabetically)
    const rmsResult = await query<{ rm_name: string; count: string }>(
      `SELECT COALESCE(NULLIF(called_by, ''), NULLIF(agent_name, ''), 'Unknown RM') as rm_name, COUNT(*) as count 
       FROM pcg_call_recordings 
       GROUP BY rm_name 
       ORDER BY rm_name ASC`
    );

    // 3. Fetch summary metrics
    const summaryResult = await query<{ total_duration: string; total_calls: string; answered_calls: string; unanswered_calls: string }>(
      `SELECT 
         COALESCE(SUM(duration_seconds), 0) as total_duration, 
         COUNT(*) as total_calls,
         COUNT(CASE WHEN duration_seconds > 0 AND recording_url IS NOT NULL AND recording_url != '' THEN 1 END) as answered_calls,
         COUNT(CASE WHEN duration_seconds = 0 OR duration_seconds IS NULL OR recording_url IS NULL OR recording_url = '' THEN 1 END) as unanswered_calls
       FROM pcg_call_recordings`
    );

    // 4. Fetch paginated calls data
    const dataSqlParams = [...sqlParams, limit, offset];
    const rows = await query<{
      id: string;
      call_id: string;
      called_by: string | null;
      agent_name: string | null;
      phone_number: string | null;
      user_phone: string | null;
      call_type: string | null;
      tag: string | null;
      duration_seconds: number;
      start_time: string | null;
      recording_url: string | null;
    }>(
      `SELECT id, call_id, called_by, agent_name, phone_number, user_phone, call_type, tag, duration_seconds, start_time, recording_url
       FROM pcg_call_recordings
       ${whereSql}
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
      rms: rmsResult.map(r => ({ name: r.rm_name, count: parseInt(r.count, 10) })),
      summary: {
        totalCalls: parseInt(summaryResult[0]?.total_calls || '0', 10),
        answeredCalls: parseInt(summaryResult[0]?.answered_calls || '0', 10),
        unansweredCalls: parseInt(summaryResult[0]?.unanswered_calls || '0', 10),
        totalDurationSeconds: parseInt(summaryResult[0]?.total_duration || '0', 10),
        activeRmsCount: rmsResult.filter(r => r.rm_name !== 'Unknown RM').length,
      },
      calls: rows.map(r => {
        const rmName = r.called_by?.trim() || r.agent_name?.trim() || 'Unknown RM';
        const isAnswered = (r.duration_seconds || 0) > 0 && !!r.recording_url;
        return {
          id: r.id,
          callId: r.call_id,
          rmName,
          phoneNumber: r.phone_number || r.user_phone || 'N/A',
          callType: r.call_type || 'N/A',
          tag: r.tag || null,
          durationSeconds: r.duration_seconds || 0,
          startTime: r.start_time,
          isAnswered,
          hasRecording: !!r.recording_url,
        };
      }),
    });
  } catch (error: any) {
    console.error('[admin/pcg-calls] Error fetching PCG calls:', error);
    return NextResponse.json({ error: 'Failed to fetch PCG calls' }, { status: 500 });
  }
});
