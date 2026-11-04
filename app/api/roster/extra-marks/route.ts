import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/cx/db';
import { rosterActor, assertCanEdit, audit } from '@/lib/roster-server';
import { todayIST, isIsoDate } from '@/lib/ist';
import { isOff, patternOn, validateExtraDay, type Pattern } from '@/lib/roster';

export async function POST(req: NextRequest) {
  const { actor, response } = await rosterActor('roster:manage:access');
  if (response) return response;
  const b = await req.json().catch(() => ({}));
  const userId = Number(b.userId), half = b.half ?? 'full';
  if (!Number.isInteger(userId) || !isIsoDate(b.day) || !['full', 'first', 'second'].includes(half)) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  const today = todayIST();
  const denied = await assertCanEdit(actor, userId, today);
  if (denied) return denied;
  const [patterns, assigns, dup] = await Promise.all([
    query<Pattern>(`SELECT id, label, off_weekdays FROM roster_patterns`),
    query<{ pattern_id: number; effective_from: string }>(`SELECT pattern_id, to_char(effective_from,'YYYY-MM-DD') AS effective_from FROM roster_assignments WHERE user_id=$1 AND cancelled_at IS NULL`, [userId]),
    query(`SELECT 1 FROM roster_extra_marks WHERE user_id=$1 AND day=$2 AND reversed_at IS NULL`, [userId, b.day]),
  ]);
  const err = validateExtraDay({ today, day: b.day, isWeekOff: isOff(patterns, patternOn(assigns, b.day), b.day), hasActive: dup.length > 0, reason: String(b.reason ?? '') });
  if (err) return NextResponse.json({ error: err }, { status: 400 });
  try {
    await query(`INSERT INTO roster_extra_marks (user_id, day, half, reason, marked_by_user_id) VALUES ($1,$2,$3,$4,$5)`, [userId, b.day, half, String(b.reason).trim(), actor.userId]);
  } catch (e) {
    if ((e as { code?: string })?.code === '23505') return NextResponse.json({ error: 'This person already has an extra day on that date.' }, { status: 409 });
    throw e;
  }
  await audit(actor.userId, 'roster_extra_marked', userId, { day: b.day, half, reason: b.reason });
  return NextResponse.json({ ok: true });
}
