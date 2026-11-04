import { NextResponse } from 'next/server';
import { query } from '@/lib/cx/db';
import { requireSkillCheck } from '@/lib/api-guard';
import { canEditTarget, isCxDomain, type Actor } from '@/lib/roster';

export async function rosterActor(skill: 'roster:view:access' | 'roster:manage:access'):
  Promise<{ actor: Actor; response: null } | { actor: null; response: NextResponse }> {
  const { session, response } = await requireSkillCheck(skill);
  if (response || !session) return { actor: null, response: response ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  const email = String(session.user?.email ?? '').toLowerCase();
  const rows = await query<{ user_id: number; role: string; platform_domain: string }>(
    `SELECT user_id, role, platform_domain FROM users WHERE LOWER(email) = $1 AND status = 'active'`, [email]);
  // The roster is for the Wint CX team only; PCG-only accounts don't get in.
  if (!rows[0] || !isCxDomain(rows[0].platform_domain)) return { actor: null, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
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
  const t = await query<{ platform_domain: string }>(`SELECT platform_domain FROM users WHERE user_id = $1`, [targetUserId]);
  if (!t[0] || !isCxDomain(t[0].platform_domain)) return NextResponse.json({ error: 'That person isn’t on the CX roster.' }, { status: 404 });
  const ok = canEditTarget(actor, targetUserId, actor.role === 'admin' ? null : await tlOf(targetUserId, today));
  return ok ? null : NextResponse.json({ error: 'Forbidden. You can only change people who report to you.' }, { status: 403 });
}

export async function audit(actorId: number, action: string, targetId: number | null, detail: unknown) {
  await query(`INSERT INTO hrms_audit (actor_user_id, action, target_user_id, detail) VALUES ($1,$2,$3,$4)`,
    [actorId, action, targetId, JSON.stringify(detail)]);
}

/** Postgres "undefined_table": migration 035 hasn't been applied to this database. */
export function isMissingTable(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === '42P01';
}

/** Wrap a route handler so DB failures return a clear JSON error instead of an opaque 500. */
export function withRosterErrors<A extends unknown[]>(fn: (...args: A) => Promise<NextResponse>) {
  return async (...args: A): Promise<NextResponse> => {
    try {
      return await fn(...args);
    } catch (err) {
      console.error('[roster]', (err as Error)?.message);
      if (isMissingTable(err)) {
        return NextResponse.json({ error: 'Roster tables are missing. Run migration 035 on this database.' }, { status: 503 });
      }
      return NextResponse.json({ error: 'Something went wrong loading the roster.' }, { status: 500 });
    }
  };
}
