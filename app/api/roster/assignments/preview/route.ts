import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/cx/db';
import { rosterActor, assertCanEdit, withRosterErrors } from '@/lib/roster-server';
import { planMutation, scheduledRow, type Mutation } from '@/lib/leave-server';
import { fmtQ } from '@/lib/leave';
import { todayIST, isIsoDate } from '@/lib/ist';
import { asId } from '@/lib/roster';

/**
 * What a change would do to the person's leave, without saving anything.
 * Body: { kind: 'create', userId, toPattern, start } | { kind: 'edit', id, toPattern, start } | { kind: 'cancel', id }
 */
const POST_ = async (req: NextRequest) => {
  const { actor, response } = await rosterActor('roster:manage:access');
  if (response) return response;
  const b = await req.json().catch(() => ({}));
  const today = todayIST();
  let userId: number, m: Mutation;
  if (b.kind === 'create') {
    const uid = asId(b.userId), to = asId(b.toPattern);
    if (uid === null || to === null || !isIsoDate(b.start)) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
    userId = uid; m = { kind: 'create', toPattern: to, start: b.start };
  } else if (b.kind === 'edit' || b.kind === 'cancel') {
    const sid = asId(b.id);
    const row = sid === null ? null : await scheduledRow({ query }, sid, today);
    if (!row) return NextResponse.json({ error: 'This change has already started or was cancelled.' }, { status: 404 });
    userId = row.user_id;
    if (b.kind === 'edit') {
      const to = asId(b.toPattern);
      if (to === null || !isIsoDate(b.start)) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
      m = { kind: 'edit', id: row.id, toPattern: to, start: b.start };
    } else m = { kind: 'cancel', id: row.id };
  } else return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  const denied = await assertCanEdit(actor, userId, today);
  if (denied) return denied;

  const plan = await planMutation({ query }, userId, m, today, false);
  return NextResponse.json({
    changes: plan.reconciled.changes, net: plan.reconciled.net, lopDays: plan.reconciled.lopDays,
    warnings: plan.warnings, fingerprint: plan.fingerprint, balance: plan.balance, balanceAfter: plan.balance + plan.reconciled.net,
    net_text: fmtQ(plan.reconciled.net),
  });
};
export const POST = withRosterErrors(POST_);
