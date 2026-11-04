import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/cx/db';
import { rosterActor, withRosterErrors } from '@/lib/roster-server';
import { todayIST, addDays, isIsoDate } from '@/lib/ist';
import { clampAnchor, periodDays, isRosterView, cellKind, patternOn, ROSTER_START, type Assignment, type CellKind, type ExtraMark, type Pattern } from '@/lib/roster';

const GET_ = async (req: NextRequest) => {
  const { actor, response } = await rosterActor('roster:view:access');
  if (response) return response;
  const today = todayIST();
  const qv = req.nextUrl.searchParams.get('view');
  const qd = req.nextUrl.searchParams.get('date');
  const view = isRosterView(qv) ? qv : 'week';
  const anchor = clampAnchor(isIsoDate(qd) ? qd : today, today);
  const days = periodDays(view, anchor);
  const start = days[0];
  const last = days[days.length - 1];

  const [patterns, people, assigns, marks, lines, scheduled, channels] = await Promise.all([
    query<Pattern>(`SELECT id, label, off_weekdays FROM roster_patterns ORDER BY id`),
    query<{ user_id: number; name: string; role: string }>(`SELECT user_id, name, role FROM users WHERE status = 'active' AND role IN ('agent','tl') ORDER BY name`),
    query<Assignment & { user_id: number }>(`SELECT user_id, pattern_id, to_char(effective_from,'YYYY-MM-DD') AS effective_from, cancelled_at FROM roster_assignments WHERE cancelled_at IS NULL`),
    query<ExtraMark & { user_id: number }>(`SELECT user_id, to_char(day,'YYYY-MM-DD') AS day, half FROM roster_extra_marks WHERE reversed_at IS NULL AND day BETWEEN $1 AND $2`, [start, last]),
    query<{ user_id: number; tl_user_id: number; effective_from: string }>(`SELECT DISTINCT ON (user_id) user_id, tl_user_id, to_char(effective_from,'YYYY-MM-DD') AS effective_from FROM reporting_lines WHERE effective_from <= $1 ORDER BY user_id, effective_from DESC`, [today]),
    query(`SELECT a.id, a.user_id, a.pattern_id AS to_pattern, to_char(a.effective_from,'YYYY-MM-DD') AS starts_on, a.reason, a.set_at, a.updated_at, s.name AS set_by
           FROM roster_assignments a LEFT JOIN users s ON s.user_id = a.set_by_user_id
           WHERE a.cancelled_at IS NULL AND a.effective_from > $1 ORDER BY a.effective_from`, [today]),
    query<{ user_id: number; channel: string }>(`SELECT user_id, channel FROM work_channels`),
  ]);

  const tlByUser = new Map(lines.map(l => [l.user_id, l.tl_user_id]));
  const nameById = new Map(people.map(p => [p.user_id, p.name]));
  const canEdit = (uid: number) => actor.role === 'admin' || (actor.role === 'tl' && uid !== actor.userId && tlByUser.get(uid) === actor.userId);

  const rows = people.map(p => {
    const a = assigns.filter(x => x.user_id === p.user_id);
    const m = marks.filter(x => x.user_id === p.user_id);
    return {
      userId: p.user_id, name: p.name, role: p.role, tlUserId: tlByUser.get(p.user_id) ?? null,
      tlName: nameById.get(tlByUser.get(p.user_id) ?? -1) ?? null,
      pattern: patternOn(a, today),
      cells: days.map((d): CellKind => d < ROSTER_START ? 'none' : cellKind(patterns, a, m, d)),
      channels: channels.filter(c => c.user_id === p.user_id).map(c => c.channel),
      canEdit: canEdit(p.user_id),
    };
  });
  const scheduledOut = (scheduled as { id: number; user_id: number; starts_on: string }[]).map(s => {
    const cur = patternOn(assigns.filter(x => x.user_id === s.user_id), addDays(s.starts_on, -1));
    return { ...s, from_pattern: cur, name: nameById.get(s.user_id) ?? '', canEdit: canEdit(s.user_id) };
  });
  return NextResponse.json({ today, view, anchor, days, patterns, people: rows, scheduled: scheduledOut, viewer: actor });
}
export const GET = withRosterErrors(GET_);
