import { addDays, weekday } from '@/lib/ist';
import { cycleOf, isOff, patternOn, type Assignment, type Pattern } from '@/lib/roster';

/** Pure leave rules, no database. Amounts are in days and always whole quarters (0.25). */
export type Half = 'full' | 'first' | 'second';
export type LeaveKind = 'leave' | 'lop';
export interface LeaveRequest { leave_id: string; user_id: number; type: 'leave' | 'lop' | 'extra'; status: string; start_date: string; end_date: string; start_half: Half; end_half: Half }
export interface LeaveLine { leave_id: string; day: string; kind: LeaveKind; half: Half; state: 'upcoming' | 'taken' | 'cancelled'; charge: number }

/** Requests that hold days: approved ones. (Pending ones join in release 2.) */
export const LIVE_STATUSES = ['Approved', 'Auto-approved', 'Taken'] as const;

export const quarter = (n: number) => Math.round(n * 4) / 4;
const floorQuarter = (n: number) => Math.floor(n * 4 + 1e-9) / 4;

/** 3.25, 3, -1.5. Quarter days everywhere, a real minus sign. */
export function fmtQ(n: number): string {
  const v = quarter(n);
  const s = String(Math.abs(v));
  return v < 0 ? `−${s}` : s;
}

export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** How much of a day a request covers: 1 for a full day, 0.5 for a half. 0 outside the request. */
export function dayWeight(r: Pick<LeaveRequest, 'start_date' | 'end_date' | 'start_half' | 'end_half'>, day: string): number {
  if (day < r.start_date || day > r.end_date) return 0;
  if (r.start_date === r.end_date) return r.start_half === 'full' ? 1 : 0.5;
  if (day === r.start_date) return r.start_half === 'full' ? 1 : 0.5;
  if (day === r.end_date) return r.end_half === 'full' ? 1 : 0.5;
  return 1;
}
/** Which half of the day a request covers on that day. */
export function dayHalf(r: Pick<LeaveRequest, 'start_date' | 'end_date' | 'start_half' | 'end_half'>, day: string): Half {
  if (dayWeight(r, day) === 1) return 'full';
  if (r.start_date === r.end_date) return r.start_half === 'full' ? 'full' : r.start_half;
  if (day === r.start_date) return 'second';
  return 'first'; // the last day of a block that ends on its first half
}

export interface Change {
  leave_id: string;
  day: string;
  half: Half;
  action: 'give_back' | 'deduct';
  leave: number;   // quarter days that move the balance (positive for both, direction by action)
  lop: number;     // quarter days that become (or stop being) LOP, never touches the balance
  text: string;
}
export interface Reconciled { changes: Change[]; net: number; lopDays: number; key: string }

export interface ReconcileInput {
  requests: LeaveRequest[];       // the person's live requests
  lines: LeaveLine[];             // all their lines, cancelled ones included (they can be revived)
  assignments: Assignment[];      // the roster after the change
  patterns: Pattern[];
  from: string;                   // first day the change affects
  balance: number;                // current ledger balance
  negativeLimit: number;          // e.g. -2
  fmtDay?: (iso: string) => string;
}

/**
 * Makes leave lines match the roster after a type change. A charged day that is now a week-off is given back.
 * A day inside a leave that is now a working day is deducted, and where balance runs out (down to the negative
 * limit) the rest is LOP. People with no roster type are left alone. Give-backs are applied before deductions,
 * so freed days cover as much as possible before anything becomes LOP.
 */
export function reconcileLeave(inp: ReconcileInput): Reconciled {
  const cycle = cycleOf(inp.patterns);
  const fd = inp.fmtDay ?? ((d: string) => d);
  const sorted = [...inp.requests].sort((a, b) => a.start_date.localeCompare(b.start_date) || a.leave_id.localeCompare(b.leave_id));
  const giveBacks: Change[] = [];
  const needs: { req: LeaveRequest; day: string; half: Half; needed: number }[] = [];

  for (const req of sorted) {
    for (const day of daysBetween(req.start_date < inp.from ? inp.from : req.start_date, req.end_date)) {
      const w = dayWeight(req, day);
      if (!w) continue;
      const type = patternOn(inp.assignments, day, cycle);
      if (type === null) continue;
      const active = inp.lines.filter(l => l.leave_id === req.leave_id && l.day === day && l.state !== 'cancelled');
      const total = quarter(active.reduce((a, l) => a + l.charge, 0));
      const half = dayHalf(req, day);
      if (isOff(inp.patterns, type, day)) {
        if (total > 0) {
          const leave = quarter(active.filter(l => l.kind === 'leave').reduce((a, l) => a + l.charge, 0));
          const lop = quarter(active.filter(l => l.kind === 'lop').reduce((a, l) => a + l.charge, 0));
          giveBacks.push({ leave_id: req.leave_id, day, half, action: 'give_back', leave, lop, text: `${fd(day)} becomes a week-off, given back` });
        }
      } else if (total < w) {
        needs.push({ req, day, half, needed: quarter(w - total) });
      }
    }
  }

  let balance = inp.balance;
  for (const g of giveBacks) balance = quarter(balance + g.leave);
  const deducts: Change[] = [];
  needs.sort((a, b) => a.day.localeCompare(b.day) || a.req.leave_id.localeCompare(b.req.leave_id));
  for (const n of needs) {
    const available = Math.max(0, floorQuarter(balance - inp.negativeLimit));
    const leave = n.req.type === 'lop' ? 0 : Math.min(n.needed, available);
    const lop = quarter(n.needed - leave);
    balance = quarter(balance - leave);
    deducts.push({ leave_id: n.req.leave_id, day: n.day, half: n.half, action: 'deduct', leave, lop,
      text: `${fd(n.day)} becomes a working day, deducted${lop > 0 ? (leave > 0 ? `, ${fmtQ(lop)} of it LOP` : ', LOP (balance is at the limit)') : ''}` });
  }

  const changes = [...giveBacks, ...deducts].sort((a, b) => a.day.localeCompare(b.day) || a.leave_id.localeCompare(b.leave_id));
  const net = quarter(giveBacks.reduce((a, c) => a + c.leave, 0) - deducts.reduce((a, c) => a + c.leave, 0));
  const lopDays = quarter(deducts.reduce((a, c) => a + c.lop, 0));
  const key = JSON.stringify(changes.map(c => [c.leave_id, c.day, c.action, c.leave, c.lop]));
  return { changes, net, lopDays, key };
}

export interface LimitWarning { day: string; half: 'first' | 'second'; count: number; limit: number }

/**
 * Days that are already full for the person's role. `offCounts` holds how many OTHER people of that role are off,
 * keyed `${day}|${half}`; a full day counts in both halves. A warning never blocks the save.
 */
export function limitWarnings(changes: Change[], offCounts: Record<string, number>, limitFor: (day: string, half: 'first' | 'second') => number | null): LimitWarning[] {
  const out: LimitWarning[] = [];
  const seen = new Set<string>();
  for (const c of changes) {
    if (c.action !== 'deduct') continue;
    for (const half of (c.half === 'full' ? ['first', 'second'] : [c.half]) as ('first' | 'second')[]) {
      const k = `${c.day}|${half}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const limit = limitFor(c.day, half);
      const count = offCounts[k] ?? 0;
      if (limit !== null && count >= limit) out.push({ day: c.day, half, count, limit });
    }
  }
  return out;
}

/** What one person's lines on one day add up to, for the roster cell. */
export interface DayLeave { leave: number; lop: number }
export function leaveByDay(lines: Pick<LeaveLine, 'day' | 'kind' | 'charge' | 'state'>[]): Map<string, DayLeave> {
  const m = new Map<string, DayLeave>();
  for (const l of lines) {
    if (l.state === 'cancelled') continue;
    const e = m.get(l.day) ?? { leave: 0, lop: 0 };
    e[l.kind] = quarter(e[l.kind] + l.charge);
    m.set(l.day, e);
  }
  return m;
}

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** 'Sat, 28 Nov 2026' */
export function fmtDayLong(iso: string): string {
  return `${WD[weekday(iso)]}, ${Number(iso.slice(8, 10))} ${MON[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
}

export { weekday };
