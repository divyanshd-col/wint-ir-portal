import { NextResponse } from 'next/server';
import { query } from '@/lib/cx/db';
import { requireSkillCheck } from '@/lib/api-guard';
import { canEditTarget, type Actor } from '@/lib/roster';

export async function rosterActor(skill: 'roster:view:access' | 'roster:manage:access'):
  Promise<{ actor: Actor; response: null } | { actor: null; response: NextResponse }> {
  const { session, response } = await requireSkillCheck(skill);
  if (response || !session) return { actor: null, response: response ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  const email = String(session.user?.email ?? '').toLowerCase();
  const rows = await query<{ user_id: number; role: string }>(
    `SELECT user_id, role FROM users WHERE LOWER(email) = $1 AND status = 'active'`, [email]);
  if (!rows[0]) return { actor: null, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  return { actor: { userId: rows[0].user_id, role: rows[0].role }, response: null };
}

/** The TL a member reports to on a given date, by user id. */
export async function tlOf(userId: number, today: string): Promise<number | null> {
  const r = await query<{ tl_user_id: number }>(
    `SELECT tl_user_id FROM reporting_lines WHERE user_id = $1 AND effective_from <= $2 ORDER BY effective_from DESC LIMIT 1`, [userId, today]);
  return r[0]?.tl_user_id ?? null;
}

/** 403 response unless the actor may edit this target. */
export async function assertCanEdit(actor: Actor, targetUserId: number, today: string): Promise<NextResponse | null> {
  const ok = canEditTarget(actor, targetUserId, actor.role === 'admin' ? null : await tlOf(targetUserId, today));
  return ok ? null : NextResponse.json({ error: 'Forbidden. You can only change people who report to you.' }, { status: 403 });
}

export async function audit(actorId: number, action: string, targetId: number | null, detail: unknown) {
  await query(`INSERT INTO hrms_audit (actor_user_id, action, target_user_id, detail) VALUES ($1,$2,$3,$4)`,
    [actorId, action, targetId, JSON.stringify(detail)]);
}
