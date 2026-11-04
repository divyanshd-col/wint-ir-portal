import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/cx/db';
import { rosterActor, assertCanEdit, audit } from '@/lib/roster-server';
import { todayIST, isIsoDate } from '@/lib/ist';

async function load(id: number, today: string) {
  const r = await query<{ id: number; user_id: number; pattern_id: number; effective_from: string; updated_at: string }>(
    `SELECT id, user_id, pattern_id, to_char(effective_from,'YYYY-MM-DD') AS effective_from, updated_at FROM roster_assignments WHERE id = $1 AND cancelled_at IS NULL`, [id]);
  const row = r[0];
  return row && row.effective_from > today ? row : null; // only future rows can change
}

/** Edit a scheduled change. Body: { toPattern, start, reason, expectedUpdatedAt } — 409 if edited since loaded. */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { actor, response } = await rosterActor('roster:manage:access');
  if (response) return response;
  const id = Number((await ctx.params).id), today = todayIST();
  const b = await req.json().catch(() => ({}));
  const row = await load(id, today);
  if (!row) return NextResponse.json({ error: 'This change has already started or was cancelled.' }, { status: 404 });
  const denied = await assertCanEdit(actor, row.user_id, today);
  if (denied) return denied;
  const toPattern = Number(b.toPattern);
  if (!isIsoDate(b.start) || b.start <= today || !Number.isInteger(toPattern) || !String(b.reason ?? '').trim())
    return NextResponse.json({ error: 'Pick a pattern, a start date from tomorrow, and give a reason.' }, { status: 400 });
  if (!b.expectedUpdatedAt || new Date(b.expectedUpdatedAt).getTime() !== new Date(row.updated_at).getTime())
    return NextResponse.json({ error: 'This change was edited by someone else. Reload and try again.' }, { status: 409 });
  try {
    await query(`UPDATE roster_assignments SET pattern_id=$2, effective_from=$3, reason=$4, set_by_user_id=$5, updated_at=NOW() WHERE id=$1`,
      [id, toPattern, b.start, String(b.reason).trim(), actor.userId]);
  } catch (e) {
    if ((e as { code?: string })?.code === '23505') return NextResponse.json({ error: 'A change already exists for that date.' }, { status: 409 });
    throw e;
  }
  await audit(actor.userId, 'roster_pattern_edited', row.user_id, { id, toPattern, start: b.start, reason: b.reason });
  return NextResponse.json({ ok: true });
}

/** Cancel a scheduled change (reason required). The prior pattern simply stays in force. */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { actor, response } = await rosterActor('roster:manage:access');
  if (response) return response;
  const id = Number((await ctx.params).id), today = todayIST();
  const b = await req.json().catch(() => ({}));
  const row = await load(id, today);
  if (!row) return NextResponse.json({ error: 'This change has already started or was cancelled.' }, { status: 404 });
  const denied = await assertCanEdit(actor, row.user_id, today);
  if (denied) return denied;
  if (!String(b.reason ?? '').trim()) return NextResponse.json({ error: 'A reason is required.' }, { status: 400 });
  await query(`UPDATE roster_assignments SET cancelled_at=NOW(), cancelled_by_user_id=$2, cancel_reason=$3 WHERE id=$1`, [id, actor.userId, String(b.reason).trim()]);
  await audit(actor.userId, 'roster_pattern_cancelled', row.user_id, { id, reason: b.reason });
  return NextResponse.json({ ok: true });
}
