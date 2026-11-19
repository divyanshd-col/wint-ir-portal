import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/cx/db';
import { leaveActor, withLeaveErrors } from '@/lib/leave-api';
import { ackNotification } from '@/lib/leave-views';

/** The TL clicks Okay on "a team member cancelled". */
const POST_ = async (_req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const { actor, response } = await leaveActor(['leave:use:access', 'leave:approve:access']);
  if (response) return response;
  await ackNotification({ query }, actor.userId, Number((await ctx.params).id));
  return NextResponse.json({ ok: true });
};
export const POST = withLeaveErrors(POST_);
