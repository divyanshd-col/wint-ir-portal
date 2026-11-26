import { NextRequest, NextResponse } from 'next/server';
import { query, withTransaction } from '@/lib/cx/db';
import { leaveReady } from '@/lib/leave-server';
import { fmtDayLong } from '@/lib/leave';
import { rosterActor, assertCanEdit, audit, withRosterErrors } from '@/lib/roster-server';
import { todayIST, isIsoDate, addDays } from '@/lib/ist';
import { asId, cleanText, cycleOf, extraDayNote, isOff, patternOn, ROSTER_START, validateExtraDay, type Pattern } from '@/lib/roster';

/** The week-offs someone can be marked as having worked: today and earlier since the roster started, not already marked. Newest first. */
const GET_ = async (req: NextRequest) => {
  const { actor, response } = await rosterActor('roster:manage:access');
  if (response) return response;
  const userId = asId(req.nextUrl.searchParams.get('userId'));
  if (userId === null) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  const today = todayIST();
  const denied = await assertCanEdit(actor, userId, today);
  if (denied) return denied;
  const [patterns, assigns, marked] = await Promise.all([
    query<Pattern>(`SELECT id, label, off_weekdays, rotates FROM roster_patterns`),
    query<{ pattern_id: number; effective_from: string }>(`SELECT pattern_id, to_char(effective_from,'YYYY-MM-DD') AS effective_from FROM roster_assignments WHERE user_id=$1 AND cancelled_at IS NULL`, [userId]),
    query<{ day: string }>(`SELECT to_char(day,'YYYY-MM-DD') AS day FROM roster_extra_marks WHERE user_id=$1 AND reversed_at IS NULL`, [userId]),
  ]);
  const taken = new Set(marked.map(m => m.day)), cycle = cycleOf(patterns), days: string[] = [];
  for (let d = today; d >= ROSTER_START; d = addDays(d, -1)) if (!taken.has(d) && isOff(patterns, patternOn(assigns, d, cycle), d)) days.push(d);
  return NextResponse.json({ days });
};
export const GET = withRosterErrors(GET_);

const POST_ = async (req: NextRequest) => {
  const { actor, response } = await rosterActor('roster:manage:access');
  if (response) return response;
  const b = await req.json().catch(() => ({}));
  const userId = asId(b.userId), half = b.half ?? 'full';
  if (userId === null || !isIsoDate(b.day) || !['full', 'first', 'second'].includes(half)) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  const today = todayIST();
  const denied = await assertCanEdit(actor, userId, today);
  if (denied) return denied;
  const [patterns, assigns, dup] = await Promise.all([
    query<Pattern>(`SELECT id, label, off_weekdays, rotates FROM roster_patterns`),
    query<{ pattern_id: number; effective_from: string }>(`SELECT pattern_id, to_char(effective_from,'YYYY-MM-DD') AS effective_from FROM roster_assignments WHERE user_id=$1 AND cancelled_at IS NULL`, [userId]),
    query(`SELECT 1 FROM roster_extra_marks WHERE user_id=$1 AND day=$2 AND reversed_at IS NULL`, [userId, b.day]),
  ]);
  const err = validateExtraDay({ today, day: b.day, isWeekOff: isOff(patterns, patternOn(assigns, b.day, cycleOf(patterns)), b.day), hasActive: dup.length > 0, reason: cleanText(b.reason) });
  if (err) return NextResponse.json({ error: err }, { status: 400 });
  const reason = cleanText(b.reason);
  const note = extraDayNote(b.day, today);
  const credit = half === 'full' ? 1 : 0.5;
  try {
    await withTransaction(async tx => {
      await tx.query(`INSERT INTO roster_extra_marks (user_id, day, half, reason, marked_by_user_id) VALUES ($1,$2,$3,$4,$5)`, [userId, b.day, half, [reason, note].filter(Boolean).join(' · '), actor.userId]);
      // a mark by a team lead or admin adds the day straight away (+1 for a full day, +0.5 for a half), one ledger line, nothing to approve
      if (await leaveReady(tx)) {
        await tx.query(`INSERT INTO leave_ledger (user_id, entry_type, amount, leave_id, description, created_by_user_id) VALUES ($1,'Extra day worked',$2,NULL,$3,$4)`,
          [userId, credit, `Extra day worked${half === 'full' ? '' : `, ${half} half`}: ${fmtDayLong(b.day)}${note ? `. ${note}` : ''}`, actor.userId]);
      }
      await audit(actor.userId, 'roster_extra_marked', userId, { day: b.day, half, reason, credited: credit }, tx);
    });
  } catch (e) {
    if ((e as { code?: string })?.code === '23505') return NextResponse.json({ error: 'This person already has an extra day on that date.' }, { status: 409 });
    throw e;
  }
  return NextResponse.json({ ok: true });
}
export const POST = withRosterErrors(POST_);
