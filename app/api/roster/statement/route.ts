import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/cx/db';
import { rosterActor, tlOf, withRosterErrors } from '@/lib/roster-server';
import { leaveReady } from '@/lib/leave-server';
import { todayIST } from '@/lib/ist';
import { canSeeBalance, isCxDomain } from '@/lib/roster';

/** One person's balance statement, newest first, with a running balance. Admins see anyone, a TL their own team, anyone their own. */
const GET_ = async (req: NextRequest) => {
  const { actor, response } = await rosterActor('roster:view:access');
  if (response) return response;
  const userId = Number(req.nextUrl.searchParams.get('userId'));
  if (!Number.isInteger(userId)) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  const u = await query<{ name: string; platform_domain: string }>(`SELECT name, platform_domain FROM users WHERE user_id = $1`, [userId]);
  if (!u[0] || !isCxDomain(u[0].platform_domain)) return NextResponse.json({ error: 'That person isn’t on the CX roster.' }, { status: 404 });
  const tl = actor.role === 'admin' || actor.userId === userId ? null : await tlOf(userId, todayIST());
  if (!canSeeBalance(actor, userId, tl)) return NextResponse.json({ error: 'Forbidden. You can only see your own team’s balances.' }, { status: 403 });
  if (!(await leaveReady({ query }))) return NextResponse.json({ name: u[0].name, balance: 0, entries: [] });

  const rows = await query<{ id: number; at: string; entry_type: string; description: string; leave_id: string | null; amount: string; running: string }>(
    `SELECT id, to_char(entry_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD"T"HH24:MI') AS at, entry_type, description, leave_id, amount,
            SUM(amount) OVER (ORDER BY entry_at, id) AS running
       FROM leave_ledger WHERE user_id = $1 ORDER BY entry_at DESC, id DESC LIMIT 300`, [userId]);
  const bal = await query<{ b: string }>(`SELECT COALESCE(SUM(amount), 0) AS b FROM leave_ledger WHERE user_id = $1`, [userId]);
  return NextResponse.json({
    name: u[0].name, balance: Number(bal[0].b),
    entries: rows.map(r => ({ id: r.id, at: r.at, type: r.entry_type, description: r.description, leaveId: r.leave_id, amount: Number(r.amount), balance: Number(r.running) })),
  });
};
export const GET = withRosterErrors(GET_);
