import { NextRequest, NextResponse } from 'next/server';
import { query, withTransaction } from '@/lib/cx/db';
import { leaveActor, withLeaveErrors } from '@/lib/leave-api';
import { HttpError } from '@/lib/roster-server';
import { cancelRequest, editRequest, sendToTl, sweepDue, type ApplyInput } from '@/lib/leave-requests';
import { requestDetail } from '@/lib/leave-views';

/** One request with its timeline and day-by-day lines. The person it belongs to, their TL, or an admin. */
const GET_ = async (_req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const { actor, response } = await leaveActor(['leave:use:access', 'leave:approve:access']);
  if (response) return response;
  await sweepDue(withTransaction, { query });
  const d = await requestDetail({ query }, (await ctx.params).id, actor);
  if (!d) return NextResponse.json({ error: 'Request not found.' }, { status: 404 });
  return NextResponse.json(d);
};
export const GET = withLeaveErrors(GET_);

/** Edit while it is still waiting. Body: { start, startHalf, end, endHalf, reason } */
const PATCH_ = async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const { actor, response } = await leaveActor('leave:use:access');
  if (response) return response;
  const b = await req.json().catch(() => ({}));
  const input: ApplyInput = { start: String(b.start ?? ''), startHalf: b.startHalf ?? 'full', end: String(b.end ?? b.start ?? ''), endHalf: b.endHalf ?? 'full' };
  const id = (await ctx.params).id;
  await withTransaction(tx => editRequest(tx, id, actor.userId, input, String(b.reason ?? '')));
  return NextResponse.json({ ok: true });
};
export const PATCH = withLeaveErrors(PATCH_);

/** Body: { action: 'cancel' | 'send_to_tl' } */
const POST_ = async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const { actor, response } = await leaveActor('leave:use:access');
  if (response) return response;
  const b = await req.json().catch(() => ({}));
  const id = (await ctx.params).id;
  if (b.action === 'cancel') await withTransaction(tx => cancelRequest(tx, id, actor.userId));
  else if (b.action === 'send_to_tl') await withTransaction(tx => sendToTl(tx, id, actor.userId));
  else throw new HttpError(400, 'Invalid request.');
  return NextResponse.json({ ok: true });
};
export const POST = withLeaveErrors(POST_);
