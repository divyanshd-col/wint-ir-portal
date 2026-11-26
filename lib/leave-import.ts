import { cycleOf, isOff, patternOn, type Assignment, type Pattern } from '@/lib/roster';
import { dayHalf, dayWeight, daysBetween, fmtDayLong, fmtQ, quarter, type Half, type LeaveKind } from '@/lib/leave';

/** The go-live load: balances, leave and holidays from the Excel template, turned into rows. Pure, so it is unit-tested. */
export interface BalanceRow { email: string; balance: number; line: number }
export interface LeaveRow { email: string; leaveId?: string; type: string; status: string; start: string; startHalf: string; end: string; endHalf: string; reason?: string; line: number }
export interface LoadUser { userId: number; name: string }

export interface LoadRequest { leave_id: string; user_id: number; type: 'leave' | 'lop'; status: 'Approved' | 'Taken'; start_date: string; end_date: string; start_half: Half; end_half: Half; reason: string | null }
export interface LoadLine { leave_id: string; day: string; kind: LeaveKind; half: Half; state: 'upcoming' | 'taken'; charge: number }
export interface LoadLedger { user_id: number; entry_type: string; amount: number; leave_id: string | null; description: string }
export interface LoadPlan { requests: LoadRequest[]; lines: LoadLine[]; ledger: LoadLedger[]; problems: string[] }

const isIso = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
const HALVES = ['full', 'first', 'second'];

export function buildLoad(a: {
  balances: BalanceRow[]; leaves: LeaveRow[]; users: Map<string, LoadUser>; assignments: Map<number, Assignment[]>;
  patterns: Pattern[]; today: string; nextLeaveId: () => string;
}): LoadPlan {
  const problems: string[] = [];
  const cycle = cycleOf(a.patterns);
  const requests: LoadRequest[] = [], lines: LoadLine[] = [], ledger: LoadLedger[] = [];
  const balanceOf = new Map<number, number>();
  const futureCharge = new Map<number, number>();
  const seenIds = new Set<string>();
  const spans = new Map<number, { s: string; e: string; id: string }[]>();
  const noType = new Set<number>();

  for (const b of a.balances) {
    const u = a.users.get(b.email.toLowerCase());
    if (!u) { problems.push(`Balances line ${b.line}: no active CX person with email ${b.email}`); continue; }
    if (!Number.isFinite(b.balance) || quarter(b.balance) !== b.balance) { problems.push(`Balances line ${b.line}: ${b.email} balance must be in quarter days (like 3.25), got ${b.balance}`); continue; }
    if (balanceOf.has(u.userId)) { problems.push(`Balances line ${b.line}: ${b.email} is listed twice`); continue; }
    balanceOf.set(u.userId, b.balance);
  }

  for (const r of a.leaves) {
    const where = `Leaves line ${r.line}`;
    const u = a.users.get(r.email.toLowerCase());
    if (!u) { problems.push(`${where}: no active CX person with email ${r.email}`); continue; }
    const type = r.type.toLowerCase(), status = r.status;
    if (type !== 'leave' && type !== 'lop') { problems.push(`${where}: type must be leave or lop, got "${r.type}"`); continue; }
    if (status !== 'Approved' && status !== 'Taken') { problems.push(`${where}: status must be Approved or Taken, got "${status}"`); continue; }
    if (!isIso(r.start) || !isIso(r.end) || r.end < r.start) { problems.push(`${where}: dates must be YYYY-MM-DD with the end on or after the start (${r.start} to ${r.end})`); continue; }
    const sh = (r.startHalf || 'full').toLowerCase(), eh = (r.endHalf || 'full').toLowerCase();
    if (!HALVES.includes(sh) || !HALVES.includes(eh)) { problems.push(`${where}: halves must be full, first or second`); continue; }
    if (r.start === r.end ? sh !== eh : (sh === 'first' || eh === 'second')) {
      problems.push(`${where}: ${r.start === r.end ? 'a single day needs the same half in both columns' : 'a block can start on the second half and end on the first half only'}`); continue;
    }
    const id = (r.leaveId || '').trim() || a.nextLeaveId();
    if (seenIds.has(id)) { problems.push(`${where}: leave ID ${id} is used twice`); continue; }
    const clash = (spans.get(u.userId) ?? []).find(x => !(r.end < x.s || r.start > x.e));
    if (clash) { problems.push(`${where}: ${u.name} already has ${clash.id} on those dates`); continue; }
    const assignments = a.assignments.get(u.userId) ?? [];
    if (!assignments.length) {
      if (!noType.has(u.userId)) { noType.add(u.userId); problems.push(`${u.name} has no roster type yet, so their leave days can't be worked out. Load the roster first.`); }
      continue;
    }
    seenIds.add(id); (spans.get(u.userId) ?? spans.set(u.userId, []).get(u.userId)!).push({ s: r.start, e: r.end, id });
    const req: LoadRequest = { leave_id: id, user_id: u.userId, type, status, start_date: r.start, end_date: r.end, start_half: sh as Half, end_half: eh as Half, reason: r.reason?.trim() || null };
    requests.push(req);
    let future = 0, any = 0;
    for (const day of daysBetween(r.start, r.end)) {
      const w = dayWeight(req, day);
      const t = patternOn(assignments, day, cycle);
      if (!w || t === null || isOff(a.patterns, t, day)) continue; // week-offs are not charged and get no line
      lines.push({ leave_id: id, day, kind: type, half: dayHalf(req, day), state: day < a.today ? 'taken' : 'upcoming', charge: w });
      any += w;
      if (day >= a.today && type === 'leave') future += w;
    }
    if (any === 0) problems.push(`${where}: ${u.name}'s ${r.start} to ${r.end} is all week-offs under their roster, nothing to charge`);
    if (future > 0) {
      futureCharge.set(u.userId, quarter((futureCharge.get(u.userId) ?? 0) + future));
      ledger.push({ user_id: u.userId, entry_type: 'Leave approved', amount: -quarter(future), leave_id: id, description: `Leave approved, loaded from the go-live sheet: ${fmtQ(future)} day${future === 1 ? '' : 's'} from ${fmtDayLong(a.today)} on` });
    }
  }

  for (const [userId, bal] of balanceOf) {
    // The sheet balance already has future approved leave taken off. Add it back and deduct each leave as a normal leave,
    // so the balance shown is the same and later cancels and changes work correctly.
    ledger.unshift({ user_id: userId, entry_type: 'Opening balance', amount: quarter(bal + (futureCharge.get(userId) ?? 0)), leave_id: null, description: 'Opening balance from the go-live sheet' });
  }
  for (const uid of futureCharge.keys()) if (!balanceOf.has(uid)) problems.push(`${[...a.users.values()].find(u => u.userId === uid)?.name ?? uid} has leave on the sheet but no balance row`);
  return { requests, lines, ledger, problems };
}
