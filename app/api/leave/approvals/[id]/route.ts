import { NextRequest, NextResponse } from 'next/server';
import { withTransaction } from '@/lib/cx/db';
import { leaveActor, withLeaveErrors } from '@/lib/leave-api';
import { cleanText } from '@/lib/roster';
import { HttpError } from '@/lib/roster-server';
import { decideRequest, type DecideAction } from '@/lib/leave-requests';

/** Body: { action: 'approve' | 'reject' | 'forward', reason, overLimitOk? }. Every action needs a reason. */
const POST_ = async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const { actor, response } = await leaveActor('leave:approve:access');
  if (response) return response;
  const b = await req.json().catch(() => ({}));
  if (!['approve', 'reject', 'forward'].includes(b.action)) throw new HttpError(400, 'Invalid request.');
  const id = (await ctx.params).id;
  const r = await withTransaction(tx => decideRequest(tx, id, { userId: actor.userId, role: actor.role }, b.action as DecideAction, cleanText(b.reason), b.overLimitOk === true));
  return NextResponse.json({ ok: true, ...r });
};
export const POST = withLeaveErrors(POST_);
