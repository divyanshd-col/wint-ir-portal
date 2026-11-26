import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/cx/db';
import { leaveActor, withLeaveErrors } from '@/lib/leave-api';
import { requestsReady } from '@/lib/leave-requests';
import { calendarFor } from '@/lib/leave-views';

/** One month for the apply calendar: ?month=YYYY-MM. Week-offs, holidays, your own leave, and halves already full for your role. */
const GET_ = async (req: NextRequest) => {
  const { actor, response } = await leaveActor('leave:use:access');
  if (response) return response;
  const month = req.nextUrl.searchParams.get('month') ?? '';
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return NextResponse.json({ error: 'Pick a month, like 2026-12.' }, { status: 400 });
  if (!(await requestsReady({ query }))) return NextResponse.json({ month, days: [] });
  return NextResponse.json(await calendarFor({ query }, actor.userId, month));
};
export const GET = withLeaveErrors(GET_);
