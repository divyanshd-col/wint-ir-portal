import { NextResponse } from 'next/server';
import { query, withTransaction } from '@/lib/cx/db';
import { leaveActor, withLeaveErrors } from '@/lib/leave-api';
import { requestsReady, sweepDue } from '@/lib/leave-requests';
import { leaveMe } from '@/lib/leave-views';

const GET_ = async () => {
  const { actor, response } = await leaveActor(['leave:use:access', 'leave:approve:access']);
  if (response) return response;
  if (await requestsReady({ query })) await sweepDue(withTransaction, { query });
  return NextResponse.json({ ...(await leaveMe({ query }, actor.userId)), can: actor.can });
};
export const GET = withLeaveErrors(GET_);
