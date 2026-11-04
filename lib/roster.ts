import { addDays, weekday } from '@/lib/ist';

export interface Pattern { id: number; label: string; off_weekdays: number[] }
export interface Assignment { id?: number; pattern_id: number; effective_from: string; cancelled_at?: string | null }
export interface ExtraMark { day: string; half: 'full' | 'first' | 'second'; reversed_at?: string | null }
export type CellKind = 'work' | 'off' | 'extra';
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
export function gridDays(start: string, n = 14): string[] {
  return Array.from({ length: n }, (_, i) => addDays(start, i));
}
/** Paging bounds: 1 Jan of the current IST year back, 12 months forward. Returns a Monday inside the range. */
export function clampStart(start: string, today: string): string {
  const min = mondayOf(`${today.slice(0, 4)}-01-01`);
  const max = mondayOf(addDays(today, 365));
  const s = mondayOf(start);
  return s < min ? min : s > max ? max : s;
}

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
