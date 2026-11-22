import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/cx/db';
import { leaveActor, withLeaveErrors } from '@/lib/leave-api';
import { ackNotification } from '@/lib/leave-views';
import { asId } from '@/lib/roster';

/** The TL clicks Okay on "a team member cancelled". */
const POST_ = async (_req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const { actor, response } = await leaveActor(['leave:use:access', 'leave:approve:access']);
  if (response) return response;
  const id = asId((await ctx.params).id);
  if (id === null) return NextResponse.json({ error: 'Notification not found.' }, { status: 404 });
  await ackNotification({ query }, actor.userId, id);
  return NextResponse.json({ ok: true });
};
export const POST = withLeaveErrors(POST_);
