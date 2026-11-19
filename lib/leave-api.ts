import { NextResponse } from 'next/server';
import { query } from '@/lib/cx/db';
import { requireSkillCheck } from '@/lib/api-guard';
import { withRosterErrors } from '@/lib/roster-server';
import { isCxDomain } from '@/lib/roster';

export type LeaveSkill = 'leave:use:access' | 'leave:approve:access';
export interface LeaveActor { userId: number; role: string; name: string; email: string }

/** Signed in, active, on the CX side, and holding one of the skills. Skills are what switch the leave pages on for a group. */
export async function leaveActor(skill: LeaveSkill | LeaveSkill[]): Promise<{ actor: LeaveActor; response: null } | { actor: null; response: NextResponse }> {
  const { session, response } = await requireSkillCheck(skill);
  if (response || !session) return { actor: null, response: response ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  const email = String(session.user?.email ?? '').toLowerCase();
  const rows = await query<{ user_id: number; role: string; name: string; platform_domain: string }>(
    `SELECT user_id, role, name, platform_domain FROM users WHERE LOWER(email) = $1 AND status = 'active'`, [email]);
  if (!rows[0] || !isCxDomain(rows[0].platform_domain)) return { actor: null, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  return { actor: { userId: rows[0].user_id, role: rows[0].role, name: rows[0].name, email }, response: null };
}

export const MISSING = 'Leave tables are missing. Run migrations 038 and 039 on this database.';
export const withLeaveErrors = <A extends unknown[]>(fn: (...args: A) => Promise<NextResponse>) => withRosterErrors(fn, MISSING);
