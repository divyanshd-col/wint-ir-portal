import { NextRequest, NextResponse } from 'next/server';
import { query, withClient } from '@/lib/cx/db';
import { rosterActor, withRosterErrors } from '@/lib/roster-server';
import { todayIST, isIsoDate } from '@/lib/ist';
import { leaveReady } from '@/lib/leave-server';
import { LIVE_STATUSES, leaveByDay, type LeaveLine } from '@/lib/leave';
import { cycleOf, canSeeBalance, clampAnchor, periodDays, isRosterView, cellKind, patternOn, ROSTER_START, type Assignment, type CellKind, type ExtraMark, type Pattern } from '@/lib/roster';

interface CachedRoster {
  data: any;
  time: number;
}
const rosterCache = new Map<string, CachedRoster>();

export function invalidateRosterCache() {
  rosterCache.clear();
}

const GET_ = async (req: NextRequest) => {
  const { actor, response } = await rosterActor('roster:view:access');
  if (response) return response;
  const today = todayIST();
  const qv = req.nextUrl.searchParams.get('view');
  const qd = req.nextUrl.searchParams.get('date');
  const view = isRosterView(qv) ? qv : 'week';
  const anchor = clampAnchor(isIsoDate(qd) ? qd : today, today);
  const cacheKey = `${view}:${anchor}:${actor.userId}`;
  const cached = rosterCache.get(cacheKey);

  if (cached && Date.now() - cached.time < 30_000) {
    return NextResponse.json(cached.data);
  }

  const days = periodDays(view, anchor);
  const start = days[0];
  const last = days[days.length - 1];

  let queryResult;
  try {
    queryResult = await withClient(async (db) => {
      const patterns = await db.query<Pattern>(`SELECT id, label, off_weekdays, rotates FROM roster_patterns ORDER BY id`);
      const people = await db.query<{ user_id: number; name: string; role: string }>(`SELECT user_id, name, role FROM users WHERE status = 'active' AND platform_domain <> 'pcg'
                AND (role IN ('agent','tl') OR user_id IN (SELECT user_id FROM roster_assignments WHERE cancelled_at IS NULL)) ORDER BY name`);
      const assigns = await db.query<Assignment & { user_id: number }>(`SELECT id, user_id, pattern_id, to_char(effective_from,'YYYY-MM-DD') AS effective_from, cancelled_at FROM roster_assignments WHERE cancelled_at IS NULL`);
      const marks = await db.query<ExtraMark & { user_id: number }>(`SELECT user_id, to_char(day,'YYYY-MM-DD') AS day, half FROM roster_extra_marks WHERE reversed_at IS NULL AND day BETWEEN $1 AND $2`, [start, last]);
      const lines = await db.query<{ user_id: number; tl_user_id: number; effective_from: string }>(`SELECT DISTINCT ON (user_id) user_id, tl_user_id, to_char(effective_from,'YYYY-MM-DD') AS effective_from FROM reporting_lines WHERE effective_from <= $1 ORDER BY user_id, effective_from DESC`, [today]);
      const scheduled = await db.query(`SELECT a.id, a.user_id, a.pattern_id AS to_pattern, to_char(a.effective_from,'YYYY-MM-DD') AS starts_on, a.reason, a.set_at, a.updated_at, s.name AS set_by
             FROM roster_assignments a LEFT JOIN users s ON s.user_id = a.set_by_user_id
             WHERE a.cancelled_at IS NULL AND a.effective_from > $1 ORDER BY a.effective_from`, [today]);
      const channels = await db.query<{ user_id: number; channel: string }>(`SELECT user_id, channel FROM work_channels`);

      // leave, holidays and balances (empty until migration 038 is applied)
      const hasLeave = await leaveReady(db).catch(() => false);
      const leaveRows = hasLeave ? await db.query<LeaveLine & { user_id: number; charge: string }>(
        `SELECT r.user_id, d.leave_id, to_char(d.day,'YYYY-MM-DD') AS day, d.kind, d.half, d.state, d.charge
           FROM leave_days d JOIN leave_requests r ON r.leave_id = d.leave_id
          WHERE d.day BETWEEN $1 AND $2 AND d.state <> 'cancelled' AND r.status = ANY($3::text[])`, [start, last, [...LIVE_STATUSES]]).catch(() => []) : [];
      const holidayRows = hasLeave ? await db.query<{ day: string; name: string }>(`SELECT to_char(day,'YYYY-MM-DD') AS day, name FROM holidays WHERE day BETWEEN $1 AND $2`, [start, last]).catch(() => []) : [];
      const balances = hasLeave ? new Map((await db.query<{ user_id: number; b: string }>(`SELECT user_id, SUM(amount) AS b FROM leave_ledger GROUP BY user_id`).catch(() => [])).map(r => [r.user_id, Number(r.b)])) : new Map<number, number>();

      return { patterns, people, assigns, marks, lines, scheduled, channels, hasLeave, leaveRows, holidayRows, balances };
    });
  } catch (err) {
    if (cached) {
      console.warn('[roster] DB error while fetching fresh roster, returning last cached state:', (err as Error)?.message);
      return NextResponse.json(cached.data);
    }
    throw err;
  }

  const {
    patterns,
    people,
    assigns,
    marks,
    lines,
    scheduled,
    channels,
    hasLeave,
    leaveRows,
    holidayRows,
    balances,
  } = queryResult;

  const holidaySet = new Set(holidayRows.map(h => h.day));

  const tlByUser = new Map(lines.map(l => [l.user_id, l.tl_user_id]));
  const nameById = new Map(people.map(p => [p.user_id, p.name]));
  const canEdit = (uid: number) => actor.role === 'admin' || (actor.role === 'tl' && uid !== actor.userId && tlByUser.get(uid) === actor.userId);

  const rows = people.map(p => {
    const a = assigns.filter(x => x.user_id === p.user_id);
    const m = marks.filter(x => x.user_id === p.user_id);
    const ctx = { leave: leaveByDay(leaveRows.filter(l => l.user_id === p.user_id).map(l => ({ ...l, charge: Number(l.charge) }))), holidays: holidaySet };
    return {
      userId: p.user_id, name: p.name, role: p.role, tlUserId: tlByUser.get(p.user_id) ?? null,
      tlName: nameById.get(tlByUser.get(p.user_id) ?? -1) ?? null,
      pattern: patternOn(a, view === 'month' ? anchor : days[0], cycleOf(patterns)), // the type for the period on screen
      cells: days.map((d): CellKind => d < ROSTER_START ? 'none' : cellKind(patterns, a, m, d, ctx)),
      channels: channels.filter(c => c.user_id === p.user_id).map(c => c.channel),
      canEdit: canEdit(p.user_id),
      balance: hasLeave && canSeeBalance(actor, p.user_id, tlByUser.get(p.user_id) ?? null) && balances.has(p.user_id) ? balances.get(p.user_id)! : null, // no ledger yet = no balance loaded
    };
  });
  const scheduledOut = (scheduled as { id: number; user_id: number; starts_on: string }[]).map(s => {
    // the type they'd be on that week without this change (the rotation carries on from their other row)
    const cur = patternOn(assigns.filter(x => x.user_id === s.user_id && x.id !== s.id), s.starts_on, cycleOf(patterns));
    return { ...s, from_pattern: cur, name: nameById.get(s.user_id) ?? '', canEdit: canEdit(s.user_id) };
  });
  const resultData = { today, view, anchor, days, patterns, people: rows, scheduled: scheduledOut, holidays: holidayRows, leaveReady: hasLeave, viewer: actor };
  rosterCache.set(cacheKey, { data: resultData, time: Date.now() });
  return NextResponse.json(resultData);
}
export const GET = withRosterErrors(GET_);
