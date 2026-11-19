import { NextRequest, NextResponse } from 'next/server';
import { query, withTransaction } from '@/lib/cx/db';
import { rosterActor, assertCanEdit, audit, HttpError, withRosterErrors } from '@/lib/roster-server';
import { applyReconciled, planMutation, scheduledRow } from '@/lib/leave-server';
import { fmtDayLong } from '@/lib/leave';
import { todayIST, isIsoDate } from '@/lib/ist';

/** Edit a scheduled change. Body: { toPattern, start, reason, expectedUpdatedAt, expectedFingerprint } */
const PATCH_ = async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const { actor, response } = await rosterActor('roster:manage:access');
  if (response) return response;
  const id = Number((await ctx.params).id), today = todayIST();
  const b = await req.json().catch(() => ({}));
  const row = await scheduledRow({ query }, id, today);
  if (!row) return NextResponse.json({ error: 'This change has already started or was cancelled.' }, { status: 404 });
  const denied = await assertCanEdit(actor, row.user_id, today);
  if (denied) return denied;
  const toPattern = Number(b.toPattern);
  const reason = String(b.reason ?? '').trim();
  if (!isIsoDate(b.start) || !Number.isInteger(toPattern) || !reason) return NextResponse.json({ error: 'Pick a roster type, a start date from tomorrow, and give a reason.' }, { status: 400 });
  if (typeof b.expectedFingerprint !== 'string') return NextResponse.json({ error: 'Preview the change first.' }, { status: 400 });

  await withTransaction(async tx => {
    await tx.query(`SELECT 1 FROM users WHERE user_id = $1 FOR UPDATE`, [row.user_id]);
    const plan = await planMutation(tx, row.user_id, { kind: 'edit', id, toPattern, start: b.start, reason, expectedUpdatedAt: b.expectedUpdatedAt }, today, true);
    if (plan.fingerprint !== b.expectedFingerprint) throw new HttpError(409, 'Leave changed since you previewed, review again.');
    try {
      await tx.query(`UPDATE roster_assignments SET pattern_id=$2, effective_from=$3, reason=$4, set_by_user_id=$5, updated_at=NOW() WHERE id=$1`, [id, toPattern, b.start, reason, actor.userId]);
    } catch (e) {
      if ((e as { code?: string })?.code === '23505') throw new HttpError(409, 'A change already exists for that date.');
      throw e;
    }
    await applyReconciled(tx, actor.userId, row.user_id, plan, `Scheduled change edited: Type ${toPattern} from ${fmtDayLong(b.start)}`);
    await audit(actor.userId, 'roster_pattern_edited', row.user_id, { id, toPattern, start: b.start, reason, leaveChanges: plan.reconciled.changes.length, net: plan.reconciled.net }, tx);
  });
  return NextResponse.json({ ok: true });
};
export const PATCH = withRosterErrors(PATCH_);

/** Cancel a scheduled change (reason required). The rotation carries on as before and any leave it moved is put back. */
const DELETE_ = async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const { actor, response } = await rosterActor('roster:manage:access');
  if (response) return response;
  const id = Number((await ctx.params).id), today = todayIST();
  const b = await req.json().catch(() => ({}));
  const row = await scheduledRow({ query }, id, today);
  if (!row) return NextResponse.json({ error: 'This change has already started or was cancelled.' }, { status: 404 });
  const denied = await assertCanEdit(actor, row.user_id, today);
  if (denied) return denied;
  const reason = String(b.reason ?? '').trim();
  if (!reason) return NextResponse.json({ error: 'A reason is required.' }, { status: 400 });
  if (typeof b.expectedFingerprint !== 'string') return NextResponse.json({ error: 'Preview the change first.' }, { status: 400 });

  await withTransaction(async tx => {
    await tx.query(`SELECT 1 FROM users WHERE user_id = $1 FOR UPDATE`, [row.user_id]);
    const plan = await planMutation(tx, row.user_id, { kind: 'cancel', id, reason }, today, true);
    if (plan.fingerprint !== b.expectedFingerprint) throw new HttpError(409, 'Leave changed since you previewed, review again.');
    await tx.query(`UPDATE roster_assignments SET cancelled_at=NOW(), cancelled_by_user_id=$2, cancel_reason=$3 WHERE id=$1`, [id, actor.userId, reason]);
    await applyReconciled(tx, actor.userId, row.user_id, plan, `Scheduled change cancelled (from ${fmtDayLong(row.effective_from)})`);
    await audit(actor.userId, 'roster_pattern_cancelled', row.user_id, { id, reason, leaveChanges: plan.reconciled.changes.length, net: plan.reconciled.net }, tx);
  });
  return NextResponse.json({ ok: true });
};
export const DELETE = withRosterErrors(DELETE_);
