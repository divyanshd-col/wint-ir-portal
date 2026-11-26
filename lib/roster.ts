import { addDays, weekday } from '@/lib/ist';

export interface Pattern { id: number; label: string; off_weekdays: number[]; rotates?: boolean }
export interface Assignment { id?: number; pattern_id: number; effective_from: string; cancelled_at?: string | null }
export interface ExtraMark { day: string; half: 'full' | 'first' | 'second'; reversed_at?: string | null }
export type CellKind = 'work' | 'off' | 'extra' | 'none' | 'leave' | 'leave-half' | 'lop' | 'lop-half' | 'hol'; // 'none' = no roster type or before the roster starts
export const CHANNELS = ['Chats', 'Calls', 'Emails', 'ORM'] as const;

/** An id from a request body or URL: a positive whole number, or its digits as text. null, true, [], '', 1.5, 'abc', -3 and huge numbers are not ids. */
export function asId(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d{1,15}$/.test(v) ? Number(v) : NaN;
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}
/** Free text from a request body: only real strings count (an object must not turn into "[object Object]"). */
export const cleanText = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
export const REASON_MAX = 500;
export const reasonTooLong = (reason: string): string | null => (reason.length > REASON_MAX ? `Keep the reason under ${REASON_MAX} characters.` : null);
/** How far ahead a roster type change may be scheduled (the calendar goes the same distance). */
export const MAX_AHEAD_DAYS = 365;

/** Number of types in the rotation (Type 1 -> 2 -> 3 -> 4 -> back to 1). Types after those are fixed and never rotate. */
export const ROTATION_TYPES = 4;
export const cycleOf = (patterns: Pattern[]) => patterns.filter(p => p.rotates !== false).length || ROTATION_TYPES;

/** Whole weeks between the Monday of `from` and the Monday of `to`. */
const weeksBetween = (from: string, to: string) => Math.round((Date.parse(mondayOf(to)) - Date.parse(mondayOf(from))) / (7 * 86400000));

/**
 * The roster type a person is on for a given date. Each assignment row is an anchor: "this person is on type N
 * in the week of effective_from". Everyone moves to the next type every Monday, wrapping after the last type,
 * so the type for any later date is the anchor's type advanced by the weeks since. The latest non-cancelled
 * anchor starting on or before the date wins. No anchor means no type is known (null).
 */
export function patternOn(assignments: Assignment[], date: string, cycle: number = ROTATION_TYPES): number | null {
  let best: Assignment | null = null;
  for (const a of assignments) {
    if (a.cancelled_at || a.effective_from > date) continue;
    if (!best || a.effective_from > best.effective_from) best = a;
  }
  if (!best) return null;
  if (best.pattern_id > cycle) return best.pattern_id; // a fixed type (e.g. Mon-Fri): same every week
  const weeks = weeksBetween(best.effective_from, date);
  return ((((best.pattern_id - 1 + weeks) % cycle) + cycle) % cycle) + 1;
}

export function isOff(patterns: Pattern[], patternId: number | null, date: string): boolean {
  const p = patterns.find(x => x.id === patternId);
  return !!p && p.off_weekdays.includes(weekday(date));
}

export interface CellContext { leave?: Map<string, { leave: number; lop: number }>; holidays?: Set<string> }

/** One day on the grid: week-off (or extra) first, then leave / LOP, then a holiday, then working. */
export function cellKind(patterns: Pattern[], assignments: Assignment[], marks: ExtraMark[], date: string, ctx: CellContext = {}): CellKind {
  const type = patternOn(assignments, date, cycleOf(patterns));
  if (type === null) return 'none'; // no roster type set for this person yet
  if (isOff(patterns, type, date)) return marks.some(m => m.day === date && !m.reversed_at) ? 'extra' : 'off';
  const l = ctx.leave?.get(date);
  if (l && (l.leave > 0 || l.lop > 0)) {
    const total = l.leave + l.lop;
    if (l.lop > 0) return total >= 1 ? 'lop' : 'lop-half';
    return total >= 1 ? 'leave' : 'leave-half';
  }
  return ctx.holidays?.has(date) ? 'hol' : 'work';
}

/** Monday on or before `date`. */
export function mondayOf(date: string): string {
  return addDays(date, -((weekday(date) + 6) % 7));
}
export function gridDays(start: string, n = 7): string[] {
  return Array.from({ length: n }, (_, i) => addDays(start, i));
}

/** Earliest day the roster shows: launch date, no backfill before it. */
export const ROSTER_START = '2026-11-01';

export type RosterView = 'day' | 'week' | 'month';
export const isRosterView = (v: unknown): v is RosterView => v === 'day' || v === 'week' || v === 'month';

/** Anchor date kept inside ROSTER_START … 12 months ahead. */
export function clampAnchor(anchor: string, today: string): string {
  const max = addDays(today, 365);
  return anchor < ROSTER_START ? ROSTER_START : anchor > max ? max : anchor;
}

const daysInMonth = (ym: string) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };

/** Days the calendar shows for a view: one day; Monday-to-Sunday week; or the month's full Monday-aligned weeks. */
export function periodDays(view: RosterView, anchor: string): string[] {
  if (view === 'day') return [anchor];
  if (view === 'week') return gridDays(mondayOf(anchor), 7);
  const first = `${anchor.slice(0, 7)}-01`;
  const lead = (weekday(first) + 6) % 7;
  const weeks = Math.ceil((lead + daysInMonth(anchor.slice(0, 7))) / 7);
  return gridDays(mondayOf(first), weeks * 7);
}

/** Move the calendar one step back (-1) or forward (+1). A month step lands on the 1st. */
export function shiftAnchor(view: RosterView, anchor: string, dir: -1 | 1): string {
  if (view === 'day') return addDays(anchor, dir);
  if (view === 'week') return addDays(anchor, 7 * dir);
  const [y, m] = anchor.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + dir, 1));
  return d.toISOString().slice(0, 10);
}

/** Can the calendar still go back without showing only pre-launch days? */
export function canGoPrev(view: RosterView, anchor: string): boolean {
  if (view === 'month') return anchor.slice(0, 7) > ROSTER_START.slice(0, 7);
  const days = periodDays(view, shiftAnchor(view, anchor, -1));
  return days[days.length - 1] >= ROSTER_START;
}

// ---- Calendar filters (client side: the page already holds everyone) ----
export interface RosterFilter { q: string; team: string; type: string; role: string; status: string }
/** 'all' = no filter. team: 'none' (no team lead) or a team lead's user id. type: 'unset' or the type id. */
export const NO_FILTER: RosterFilter = { q: '', team: 'all', type: 'all', role: 'all', status: 'all' };
export const isFiltered = (f: RosterFilter) => f.q.trim() !== '' || f.team !== 'all' || f.type !== 'all' || f.role !== 'all' || f.status !== 'all';
export interface FilterRow { name: string; role: string; tlUserId: number | null; pattern: number | null; cells: CellKind[] }
export const STATUS_FILTERS: Record<string, CellKind[]> = {
  working: ['work'], off: ['off'], extra: ['extra'], leave: ['leave', 'leave-half', 'lop', 'lop-half'], hol: ['hol'],
};

/**
 * People matching every active filter. Search matches every word anywhere in the name, ignoring case and extra spaces.
 * Status looks at the days on screen: in the Day view that is that day, in Week and Month anyone who has that status
 * on at least one of the shown days.
 */
export function filterPeople<P extends FilterRow>(people: P[], f: RosterFilter): P[] {
  const words = f.q.toLowerCase().split(/\s+/).filter(Boolean);
  const kinds = STATUS_FILTERS[f.status];
  return people.filter(p => {
    const name = p.name.toLowerCase();
    if (!words.every(w => name.includes(w))) return false;
    if (f.team === 'none' ? p.tlUserId !== null : f.team !== 'all' && String(p.tlUserId) !== f.team) return false;
    if (f.type === 'unset' ? p.pattern !== null : f.type !== 'all' && String(p.pattern) !== f.type) return false;
    if (f.role !== 'all' && p.role !== f.role) return false;
    if (f.status !== 'all' && (!kinds || !p.cells.some(c => kinds.includes(c)))) return false;
    return true;
  });
}

/** The roster covers the Wint CX team only. PCG-only users are excluded; 'both' (cross-workspace admins) are in. */
export const isCxDomain = (platformDomain: string | null | undefined) => platformDomain !== 'pcg';

export interface Actor { userId: number; role: string }

/** Balances and statements: admins see everyone, a TL sees their own team, anyone sees their own. */
export function canSeeBalance(actor: Actor, targetUserId: number, tlOfTarget: number | null): boolean {
  if (actor.role === 'admin' || actor.userId === targetUserId) return true;
  return actor.role === 'tl' && tlOfTarget === actor.userId;
}
/** Who may change a target. Admin: anyone. TL: only members reporting to them by user id, never themselves. */
export function canEditTarget(actor: Actor, targetUserId: number, tlOfTarget: number | null): boolean {
  if (actor.role === 'admin') return true;
  if (actor.role !== 'tl') return false;
  return targetUserId !== actor.userId && tlOfTarget === actor.userId;
}

/** Validation for a new scheduled change. Returns an error message or null. */
export function validateNewChange(a: { today: string; start: string; reason: string; toPattern: number; current: number | null; hasFuture: boolean }): string | null {
  if (!a.reason.trim()) return 'A reason is required.';
  if (reasonTooLong(a.reason)) return reasonTooLong(a.reason);
  if (a.start <= a.today) return 'The change must start tomorrow or later. Past days never change.';
  if (a.start > addDays(a.today, MAX_AHEAD_DAYS)) return 'A change can be scheduled up to 12 months ahead.';
  if (weekday(a.start) !== 1) return 'The rotation moves on Mondays, so a change must start on a Monday.';
  if (a.toPattern === a.current) return 'That’s already the type they’ll be on that week. Pick a different one.';
  if (a.hasFuture) return 'This person already has a scheduled change. Edit or cancel it first.';
  return null;
}
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthName = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;

/** A day from an earlier month is added in the current month, with a note of the original date. Null for this month. */
export function extraDayNote(day: string, today: string): string | null {
  return day.slice(0, 7) === today.slice(0, 7) ? null : `Worked on ${day}, added in ${monthName(today)}`;
}

export function validateExtraDay(a: { today: string; day: string; isWeekOff: boolean; hasActive: boolean; reason: string }): string | null {
  if (!a.reason.trim()) return 'A reason is required.';
  if (reasonTooLong(a.reason)) return reasonTooLong(a.reason);
  if (a.day > a.today) return 'Only today or past week-offs can be marked.';
  if (a.day < ROSTER_START) return 'The roster starts on 1 Nov 2026, so earlier days can’t be marked.';
  if (!a.isWeekOff) return 'That day is not a week-off for this person.';
  if (a.hasActive) return 'This person already has an extra day on that date.';
  return null;
}

/** Changing who someone reports to: admins only, agents only, to an active team lead, never your own record. */
export function validateReportingLine(a: { actorUserId: number; userId: number; tlUserId: number; reason: string; personRole: string; tlRole: string }): string | null {
  if (!a.reason.trim()) return 'A reason is required.';
  if (reasonTooLong(a.reason)) return reasonTooLong(a.reason);
  if (a.actorUserId === a.userId) return 'Nobody changes their own team lead.';
  if (a.personRole !== 'agent') return 'Only agents report to a team lead.';
  if (a.tlRole !== 'tl') return 'Pick a team lead.';
  if (a.userId === a.tlUserId) return 'Nobody can be their own team lead.';
  return null;
}
