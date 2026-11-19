import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/cx/db';
import { leaveActor, withLeaveErrors } from '@/lib/leave-api';
import { computeRequest, type ApplyInput } from '@/lib/leave-requests';
import { sweepDue } from '@/lib/leave-requests';
import { withTransaction } from '@/lib/cx/db';

/** What a request would do, before it is sent. Body: { start, startHalf, end, endHalf } */
const POST_ = async (req: NextRequest) => {
  const { actor, response } = await leaveActor('leave:use:access');
  if (response) return response;
  const b = await req.json().catch(() => ({}));
  const input: ApplyInput = { start: String(b.start ?? ''), startHalf: b.startHalf ?? 'full', end: String(b.end ?? b.start ?? ''), endHalf: b.endHalf ?? 'full' };
  await sweepDue(withTransaction, { query });
  const p = await computeRequest({ query }, actor.userId, input, { appliedAt: new Date() });
  return NextResponse.json({
    days: p.days, leave: p.leave, lop: p.lop, stretch: p.stretch, run: p.run, noticeNeeded: p.noticeNeeded, noticeGiven: p.noticeGiven,
    outcome: p.decision.outcome, deciderText: p.deciderText, why: p.why, balance: p.balance, held: p.held, available: p.available, balanceAfter: p.balanceAfter,
    fullHalves: p.fullHalves, lopWarning: p.lopWarning, rejectCode: p.decision.outcome === 'reject' ? p.decision.code : null,
    tooLong: p.stretch > p.rules.maxLength, maxLength: p.rules.maxLength,
  });
};
export const POST = withLeaveErrors(POST_);
