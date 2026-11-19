import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/cx/db';
import { rosterActor, audit, withRosterErrors } from '@/lib/roster-server';
import { todayIST } from '@/lib/ist';
import { isCxDomain, validateReportingLine } from '@/lib/roster';

/** Set the one team lead a person reports to, from today. Admins only. Body: { userId, tlUserId, reason } */
const POST_ = async (req: NextRequest) => {
  const { actor, response } = await rosterActor('roster:manage:access');
  if (response) return response;
  if (actor.role !== 'admin') return NextResponse.json({ error: 'Only admins can change team leads.' }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  const userId = Number(b.userId), tlUserId = Number(b.tlUserId);
  if (!Number.isInteger(userId) || !Number.isInteger(tlUserId)) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });

  const rows = await query<{ user_id: number; role: string; status: string; platform_domain: string }>(
    `SELECT user_id, role, status, platform_domain FROM users WHERE user_id = ANY($1::int[])`, [[userId, tlUserId]]);
  const person = rows.find(r => r.user_id === userId), tl = rows.find(r => r.user_id === tlUserId);
  if (!person || !tl || person.status !== 'active' || tl.status !== 'active' || !isCxDomain(person.platform_domain) || !isCxDomain(tl.platform_domain))
    return NextResponse.json({ error: 'Both people must be active on the CX roster.' }, { status: 404 });
  const err = validateReportingLine({ actorUserId: actor.userId, userId, tlUserId, reason: String(b.reason ?? ''), personRole: person.role, tlRole: tl.role });
  if (err) return NextResponse.json({ error: err }, { status: 400 });

  const today = todayIST();
  const prev = await query<{ tl_user_id: number }>(`SELECT tl_user_id FROM reporting_lines WHERE user_id = $1 AND effective_from <= $2 ORDER BY effective_from DESC LIMIT 1`, [userId, today]);
  await query(`INSERT INTO reporting_lines (user_id, tl_user_id, effective_from) VALUES ($1, $2, $3)
               ON CONFLICT (user_id, effective_from) DO UPDATE SET tl_user_id = EXCLUDED.tl_user_id`, [userId, tlUserId, today]);
  await audit(actor.userId, 'roster_team_lead_changed', userId, { from: prev[0]?.tl_user_id ?? null, to: tlUserId, reason: String(b.reason).trim() });
  return NextResponse.json({ ok: true });
};
export const POST = withRosterErrors(POST_);
