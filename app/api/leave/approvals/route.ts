import { NextRequest, NextResponse } from 'next/server';
import { query, withTransaction } from '@/lib/cx/db';
import { leaveActor, withLeaveErrors } from '@/lib/leave-api';
import { sweepDue } from '@/lib/leave-requests';
import { approvalsList } from '@/lib/leave-views';

/** Waiting for me, or done. An admin sees everything, a TL their own team. */
const GET_ = async (req: NextRequest) => {
  const { actor, response } = await leaveActor('leave:approve:access');
  if (response) return response;
  if (actor.role !== 'admin' && actor.role !== 'tl') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  await sweepDue(withTransaction, { query });
  const tab = req.nextUrl.searchParams.get('tab') === 'done' ? 'done' : 'waiting';
  return NextResponse.json({ tab, items: await approvalsList({ query }, actor, tab) });
};
export const GET = withLeaveErrors(GET_);
