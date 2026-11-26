import { NextRequest, NextResponse } from 'next/server';
import { query, withTransaction } from '@/lib/cx/db';
import { leaveActor, withLeaveErrors } from '@/lib/leave-api';
import { createRequest, sweepDue, type ApplyInput } from '@/lib/leave-requests';

/** My requests, newest first. */
const GET_ = async (req: NextRequest) => {
  const { actor, response } = await leaveActor('leave:use:access');
  if (response) return response;
  await sweepDue(withTransaction, { query });
  const status = req.nextUrl.searchParams.get('status');
  const rows = await query(
    `SELECT r.leave_id, r.type, r.status, r.applied_at, r.reason, to_char(r.start_date,'YYYY-MM-DD') AS start_date, to_char(r.end_date,'YYYY-MM-DD') AS end_date,
            r.start_half, r.end_half, r.with_level, r.reject_code, r.reject_note, r.cancel_deadline, r.window_ends_at,
            COALESCE((SELECT SUM(charge) FROM leave_days d WHERE d.leave_id = r.leave_id AND d.kind = 'leave' AND d.state <> 'cancelled'), 0) AS leave_days,
            COALESCE((SELECT SUM(charge) FROM leave_days d WHERE d.leave_id = r.leave_id AND d.kind = 'lop' AND d.state <> 'cancelled'), 0) AS lop_days,
            (SELECT u.name FROM reporting_lines l JOIN users u ON u.user_id = l.tl_user_id WHERE l.user_id = r.user_id ORDER BY l.effective_from DESC LIMIT 1) AS tl_name
       FROM leave_requests r WHERE r.user_id = $1 AND ($2::text IS NULL OR r.status = $2) ORDER BY r.applied_at DESC, r.leave_id DESC LIMIT 200`, [actor.userId, status]);
  return NextResponse.json({ requests: rows.map(r => ({ ...r, leave_days: Number(r.leave_days), lop_days: Number(r.lop_days) })) });
};
export const GET = withLeaveErrors(GET_);

/** Apply. Body: { start, startHalf, end, endHalf, reason }. It waits 5 minutes before anything happens. */
const POST_ = async (req: NextRequest) => {
  const { actor, response } = await leaveActor('leave:use:access');
  if (response) return response;
  const b = await req.json().catch(() => ({}));
  const input: ApplyInput = { start: String(b.start ?? ''), startHalf: b.startHalf ?? 'full', end: String(b.end ?? b.start ?? ''), endHalf: b.endHalf ?? 'full' };
  const id = await withTransaction(tx => createRequest(tx, actor.userId, input, String(b.reason ?? '')));
  return NextResponse.json({ id });
};
export const POST = withLeaveErrors(POST_);
