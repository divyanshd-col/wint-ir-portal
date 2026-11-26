import { NextRequest, NextResponse } from 'next/server';
import { query, withTransaction } from '@/lib/cx/db';
import { leaveActor, withLeaveErrors } from '@/lib/leave-api';
import { requestsReady, sweepDue } from '@/lib/leave-requests';
import { listNotifications } from '@/lib/leave-views';

/** The bell. Anyone who uses or approves leave. */
const GET_ = async () => {
  const { actor, response } = await leaveActor(['leave:use:access', 'leave:approve:access']);
  if (response) return response;
  if (!(await requestsReady({ query }))) return NextResponse.json({ items: [], unread: 0 });
  await sweepDue(withTransaction, { query });
  return NextResponse.json(await listNotifications({ query }, actor.userId));
};
export const GET = withLeaveErrors(GET_);

/** Body: { action: 'read_all' } */
const POST_ = async (req: NextRequest) => {
  const { actor, response } = await leaveActor(['leave:use:access', 'leave:approve:access']);
  if (response) return response;
  const b = await req.json().catch(() => ({}));
  if (b.action === 'read_all') await query(`UPDATE notifications SET read_at = NOW() WHERE user_id = $1 AND read_at IS NULL`, [actor.userId]);
  return NextResponse.json({ ok: true });
};
export const POST = withLeaveErrors(POST_);
