import { NextRequest, NextResponse } from 'next/server';
import { withTransaction } from '@/lib/cx/db';
import { rosterActor, assertCanEdit, audit, HttpError, withRosterErrors } from '@/lib/roster-server';
import { applyReconciled, planMutation } from '@/lib/leave-server';
import { fmtDayLong } from '@/lib/leave';
import { todayIST, isIsoDate } from '@/lib/ist';
import { asId, cleanText } from '@/lib/roster';

/** Schedule a roster type change. Body: { userId, toPattern, start, reason, expectedFingerprint } */
const POST_ = async (req: NextRequest) => {
  const { actor, response } = await rosterActor('roster:manage:access');
  if (response) return response;
  const b = await req.json().catch(() => ({}));
  const userId = asId(b.userId), toPattern = asId(b.toPattern);
  if (userId === null || toPattern === null || !isIsoDate(b.start)) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  if (typeof b.expectedFingerprint !== 'string') return NextResponse.json({ error: 'Preview the change first.' }, { status: 400 });
  const today = todayIST();
  const denied = await assertCanEdit(actor, userId, today);
  if (denied) return denied;
  const reason = cleanText(b.reason);

  const id = await withTransaction(async tx => {
    await tx.query(`SELECT 1 FROM users WHERE user_id = $1 FOR UPDATE`, [userId]); // one person's changes are applied one after another
    const plan = await planMutation(tx, userId, { kind: 'create', toPattern, start: b.start, reason }, today, true);
    if (plan.fingerprint !== b.expectedFingerprint) throw new HttpError(409, 'Leave changed since you previewed, review again.');
    let newId: number;
    try {
      const ins = await tx.query<{ id: number }>(`INSERT INTO roster_assignments (user_id, pattern_id, effective_from, reason, set_by_user_id) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [userId, toPattern, b.start, reason, actor.userId]);
      newId = ins[0].id;
    } catch (e) {
      if ((e as { code?: string })?.code === '23505') throw new HttpError(409, 'A change already exists for that date.');
      throw e;
    }
    await applyReconciled(tx, actor.userId, userId, plan, `Pattern change: Type ${toPattern} from ${fmtDayLong(b.start)}`);
    await audit(actor.userId, 'roster_pattern_scheduled', userId, { toPattern, start: b.start, reason, leaveChanges: plan.reconciled.changes.length, net: plan.reconciled.net }, tx);
    return newId;
  });
  return NextResponse.json({ id: Number(id) });
};
export const POST = withRosterErrors(POST_);
