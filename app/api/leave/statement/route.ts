import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/cx/db';
import { leaveActor, withLeaveErrors } from '@/lib/leave-api';
import { tlOf } from '@/lib/roster-server';
import { canSeeBalance } from '@/lib/roster';
import { todayIST } from '@/lib/ist';
import { requestsReady } from '@/lib/leave-requests';
import { statementFor } from '@/lib/leave-views';

/** Your own statement, like a bank statement. Admins can open anyone's, a TL their own team's. */
const GET_ = async (req: NextRequest) => {
  const { actor, response } = await leaveActor(['leave:use:access', 'leave:approve:access']);
  if (response) return response;
  const asked = req.nextUrl.searchParams.get('userId');
  const userId = asked ? Number(asked) : actor.userId;
  if (!Number.isInteger(userId)) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  const tl = actor.role === 'admin' || actor.userId === userId ? null : await tlOf(userId, todayIST());
  if (!canSeeBalance(actor, userId, tl)) return NextResponse.json({ error: 'Forbidden. You can only see your own team’s statements.' }, { status: 403 });
  const u = await query<{ name: string }>(`SELECT name FROM users WHERE user_id = $1`, [userId]);
  if (!u[0]) return NextResponse.json({ error: 'Person not found.' }, { status: 404 });
  if (!(await requestsReady({ query }))) return NextResponse.json({ name: u[0].name, balance: 0, held: 0, entries: [] });
  return NextResponse.json({ name: u[0].name, ...(await statementFor({ query }, userId)) });
};
export const GET = withLeaveErrors(GET_);
