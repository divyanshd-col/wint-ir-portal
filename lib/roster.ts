import { addDays, weekday } from '@/lib/ist';

export interface Pattern { id: number; label: string; off_weekdays: number[] }
export interface Assignment { id?: number; pattern_id: number; effective_from: string; cancelled_at?: string | null }
export interface ExtraMark { day: string; half: 'full' | 'first' | 'second'; reversed_at?: string | null }
export type CellKind = 'work' | 'off' | 'extra' | 'none'; // 'none' = before the roster starts
export const CHANNELS = ['Chats', 'Calls', 'Emails', 'ORM'] as const;

/** The pattern a person is on for one given date: latest non-cancelled row starting on/before it. */
export function patternOn(assignments: Assignment[], date: string): number | null {
  let best: Assignment | null = null;
  for (const a of assignments) {
    if (a.cancelled_at || a.effective_from > date) continue;
    if (!best || a.effective_from > best.effective_from) best = a;
  }
  return best ? best.pattern_id : null;
}

export function isOff(patterns: Pattern[], patternId: number | null, date: string): boolean {
  const p = patterns.find(x => x.id === patternId);
  return !!p && p.off_weekdays.includes(weekday(date));
}

export function cellKind(patterns: Pattern[], assignments: Assignment[], marks: ExtraMark[], date: string): CellKind {
  if (!isOff(patterns, patternOn(assignments, date), date)) return 'work';
  return marks.some(m => m.day === date && !m.reversed_at) ? 'extra' : 'off';
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

/** The roster covers the Wint CX team only. PCG-only users are excluded; 'both' (cross-workspace admins) are in. */
export const isCxDomain = (platformDomain: string | null | undefined) => platformDomain !== 'pcg';

export interface Actor { userId: number; role: string }
/** Who may change a target. Admin: anyone. TL: only members reporting to them by user id, never themselves. */
export function canEditTarget(actor: Actor, targetUserId: number, tlOfTarget: number | null): boolean {
  if (actor.role === 'admin') return true;
  if (actor.role !== 'tl') return false;
  return targetUserId !== actor.userId && tlOfTarget === actor.userId;
}

/** Validation for a new scheduled change. Returns an error message or null. */
export function validateNewChange(a: { today: string; start: string; reason: string; toPattern: number; current: number | null; hasFuture: boolean }): string | null {
  if (!a.reason.trim()) return 'A reason is required.';
  if (a.start <= a.today) return 'The change must start tomorrow or later. Past days never change.';
  if (a.toPattern === a.current) return 'Pick a different pattern from the current one.';
  if (a.hasFuture) return 'This person already has a scheduled change. Edit or cancel it first.';
  return null;
}
export function validateExtraDay(a: { today: string; day: string; isWeekOff: boolean; hasActive: boolean; reason: string }): string | null {
  if (!a.reason.trim()) return 'A reason is required.';
  if (a.day > a.today) return 'Only today or past week-offs can be marked.';
  if (a.day.slice(0, 7) !== a.today.slice(0, 7)) return 'Only week-offs in the current month can be marked.';
  if (!a.isWeekOff) return 'That day is not a week-off for this person.';
  if (a.hasActive) return 'This person already has an extra day on that date.';
  return null;
}
