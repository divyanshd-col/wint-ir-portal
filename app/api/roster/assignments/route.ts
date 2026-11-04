import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/cx/db';
import { rosterActor, assertCanEdit, audit } from '@/lib/roster-server';
import { todayIST, isIsoDate } from '@/lib/ist';
import { patternOn, validateNewChange } from '@/lib/roster';

export async function POST(req: NextRequest) {
  const { actor, response } = await rosterActor('roster:manage:access');
  if (response) return response;
  const b = await req.json().catch(() => ({}));
  const userId = Number(b.userId), toPattern = Number(b.toPattern);
  if (!Number.isInteger(userId) || !Number.isInteger(toPattern) || !isIsoDate(b.start)) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  const today = todayIST();
  const denied = await assertCanEdit(actor, userId, today);
  if (denied) return denied;
  if (!(await query(`SELECT 1 FROM roster_patterns WHERE id = $1`, [toPattern]))[0]) return NextResponse.json({ error: 'Unknown pattern.' }, { status: 400 });

  const rows = await query<{ pattern_id: number; effective_from: string }>(
    `SELECT pattern_id, to_char(effective_from,'YYYY-MM-DD') AS effective_from FROM roster_assignments WHERE user_id = $1 AND cancelled_at IS NULL`, [userId]);
  const err = validateNewChange({
    today, start: b.start, reason: String(b.reason ?? ''), toPattern,
    current: patternOn(rows, today), hasFuture: rows.some(r => r.effective_from > today),
  });
  if (err) return NextResponse.json({ error: err }, { status: 400 });

  try {
    const ins = await query(`INSERT INTO roster_assignments (user_id, pattern_id, effective_from, reason, set_by_user_id) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [userId, toPattern, b.start, String(b.reason).trim(), actor.userId]);
    await audit(actor.userId, 'roster_pattern_scheduled', userId, { toPattern, start: b.start, reason: b.reason });
    return NextResponse.json({ id: ins[0].id });
  } catch (e) {
    if ((e as { code?: string })?.code === '23505') return NextResponse.json({ error: 'A change already exists for that date.' }, { status: 409 });
    throw e;
  }
}
