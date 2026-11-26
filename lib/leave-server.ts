import { createHash } from 'crypto';
import { HttpError } from '@/lib/roster-server';
import { addDays, weekday } from '@/lib/ist';
import { cycleOf, patternOn, reasonTooLong, validateNewChange, type Assignment, type Pattern } from '@/lib/roster';
import { LIVE_STATUSES, fmtDayLong, fmtQ, limitWarnings, reconcileLeave, type Change, type LeaveLine, type LeaveRequest, type LimitWarning, type Reconciled } from '@/lib/leave';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = { query<T = any>(sql: string, params?: any[]): Promise<T[]> };

/** True once migration 038 has been applied. Until then the roster works without any leave data. */
export async function leaveReady(db: Db): Promise<boolean> {
  const r = await db.query<{ ok: boolean }>(`SELECT (to_regclass('public.leave_ledger') IS NOT NULL AND to_regclass('public.leave_days') IS NOT NULL AND to_regclass('public.leave_requests') IS NOT NULL) AS ok`);
  return !!r[0]?.ok;
}

/** True once migration 039 is in (requests can wait, be held and be decided). */
export async function waitingSupported(db: Db): Promise<boolean> {
  const r = await db.query<{ ok: boolean }>(`SELECT to_regclass('public.leave_events') IS NOT NULL AS ok`);
  return !!r[0]?.ok;
}

/** Statuses whose days are held while a request waits. */
export const HELD = ['In process', 'Pending for approval', 'Auto-rejected'];

/**
 * How many OTHER people of this role are off, per `${day}|${half}` (a full day counts in both halves). `waiting` adds requests
 * still waiting for a decision, which also count towards the limit; a full-day rejection holds no spot until someone approves it.
 * `before` is used when a request is decided: requests are decided in the order they were made, so one made later does not count yet.
 */
export async function offCounts(db: Db, role: 'agent' | 'tl', days: string[], excludeUserId: number, waiting: boolean, before?: { appliedAt: string; leaveId: string }): Promise<Record<string, number>> {
  if (!days.length) return {};
  const statuses = waiting ? [...LIVE_STATUSES, ...HELD] : [...LIVE_STATUSES];
  const rows = await db.query<{ user_id: number; day: string; half: string }>(
    `SELECT DISTINCT r.user_id, to_char(d.day,'YYYY-MM-DD') AS day, d.half
       FROM leave_days d JOIN leave_requests r ON r.leave_id = d.leave_id JOIN users u ON u.user_id = r.user_id
      WHERE d.day = ANY($1::date[]) AND d.state <> 'cancelled' AND r.status = ANY($2::text[]) ${waiting ? `AND (r.holds_spot OR r.status <> 'Auto-rejected')` : ''}
        ${before ? `AND (r.status = ANY($7::text[]) OR (r.applied_at, r.leave_id) < ($5::timestamptz, $6::text))` : ''}
        AND r.user_id <> $3 AND u.status = 'active' AND u.role = $4`, before ? [days, statuses, excludeUserId, role, before.appliedAt, before.leaveId, [...LIVE_STATUSES]] : [days, statuses, excludeUserId, role]);
  const people = new Map<string, Set<number>>();
  for (const r of rows) for (const half of (r.half === 'full' ? ['first', 'second'] : [r.half])) {
    const k = `${r.day}|${half}`; (people.get(k) ?? people.set(k, new Set()).get(k)!).add(r.user_id);
  }
  return Object.fromEntries([...people].map(([k, s]) => [k, s.size]));
}

export async function balanceOf(db: Db, userId: number): Promise<number> {
  const r = await db.query<{ b: string }>(`SELECT COALESCE(SUM(amount), 0) AS b FROM leave_ledger WHERE user_id = $1`, [userId]);
  return Number(r[0]?.b ?? 0);
}
async function negativeLimit(db: Db): Promise<number> {
  const r = await db.query<{ value: string }>(`SELECT value FROM leave_settings WHERE key = 'negative_limit'`);
  const n = Number(r[0]?.value);
  return Number.isFinite(n) ? n : -2;
}

export type Mutation =
  | { kind: 'create'; toPattern: number; start: string; reason?: string }
  | { kind: 'edit'; id: number; toPattern: number; start: string; reason?: string; expectedUpdatedAt?: string }
  | { kind: 'cancel'; id: number; reason?: string };

export interface Plan {
  from: string;
  rows: { id: number; pattern_id: number; effective_from: string; updated_at: string }[];
  reconciled: Reconciled;
  warnings: LimitWarning[];
  fingerprint: string;
  balance: number;
  liveIds: string[];
}

/** The scheduled change a mutation targets, and who it belongs to (checked before permissions). */
export async function scheduledRow(db: Db, id: number, today: string) {
  const r = await db.query<{ id: number; user_id: number; pattern_id: number; effective_from: string; updated_at: string }>(
    `SELECT id, user_id, pattern_id, to_char(effective_from,'YYYY-MM-DD') AS effective_from, updated_at FROM roster_assignments WHERE id = $1 AND cancelled_at IS NULL`, [id]);
  // bigserial ids come back from pg as text, so hand them out as numbers
  return r[0] && r[0].effective_from > today ? { ...r[0], id: Number(r[0].id) } : null; // only future rows can change
}

/**
 * Works out what a change does to the person's leave, without writing anything. Used for the preview and, inside the
 * save transaction, to recompute and refuse if the result has changed since the person previewed it.
 * Validation errors come out as HttpError. `forSave` also requires a reason and checks the edit version.
 */
export async function planMutation(db: Db, userId: number, m: Mutation, today: string, forSave: boolean): Promise<Plan> {
  const patterns = await db.query<Pattern>(`SELECT id, label, off_weekdays, rotates FROM roster_patterns ORDER BY id`);
  const cycle = cycleOf(patterns);
  const all = (await db.query<{ id: number; pattern_id: number; effective_from: string; updated_at: string }>(
    `SELECT id, pattern_id, to_char(effective_from,'YYYY-MM-DD') AS effective_from, updated_at FROM roster_assignments WHERE user_id = $1 AND cancelled_at IS NULL`, [userId])).map(r => ({ ...r, id: Number(r.id) }));
  const reason = String(m.reason ?? '').trim();
  if (reasonTooLong(reason)) throw new HttpError(400, reasonTooLong(reason)!);
  let next: (Assignment & { id?: number })[];
  let from: string;

  if (m.kind === 'cancel') {
    const old = all.find(r => r.id === m.id);
    if (!old || old.effective_from <= today) throw new HttpError(404, 'This change has already started or was cancelled.');
    if (forSave && !reason) throw new HttpError(400, 'A reason is required.');
    next = all.filter(r => r.id !== m.id); from = old.effective_from;
  } else {
    if (!patterns.some(p => p.id === m.toPattern && p.rotates !== false)) throw new HttpError(400, 'Unknown roster type.');
    const others = m.kind === 'edit' ? all.filter(r => r.id !== m.id) : all;
    if (m.kind === 'edit') {
      const old = all.find(r => r.id === m.id);
      if (!old || old.effective_from <= today) throw new HttpError(404, 'This change has already started or was cancelled.');
      if (forSave && !m.expectedUpdatedAt) throw new HttpError(400, 'Reload the page and try again.');
      if (forSave && new Date(m.expectedUpdatedAt!).getTime() !== new Date(old.updated_at).getTime())
        throw new HttpError(409, 'This change was edited by someone else. Reload and try again.');
      from = old.effective_from < m.start ? old.effective_from : m.start;
    } else from = m.start;
    // the same rules as a new change; an edit replaces the one pending row, so it may not "already exist"
    const err = validateNewChange({ today, start: m.start, reason: forSave ? reason : 'preview', toPattern: m.toPattern,
      current: patternOn(others, m.start, cycle), hasFuture: others.some(r => r.effective_from > today) });
    if (err) throw new HttpError(400, err);
    next = [...others, { id: m.kind === 'edit' ? m.id : -1, pattern_id: m.toPattern, effective_from: m.start }];
  }

  if (!(await leaveReady(db))) {
    const empty: Reconciled = { changes: [], net: 0, lopDays: 0, key: '[]' };
    return { from, rows: all, reconciled: empty, warnings: [], fingerprint: hash(empty.key), balance: 0, liveIds: [] };
  }

  // approved leave and (once requests can wait) requests still waiting are all recalculated; waiting ones only move held days
  const waiting = await waitingSupported(db);
  const statuses = waiting ? [...LIVE_STATUSES, ...HELD] : [...LIVE_STATUSES];
  const reqs = await db.query<LeaveRequest>(
    `SELECT leave_id, user_id, type, status, to_char(start_date,'YYYY-MM-DD') AS start_date, to_char(end_date,'YYYY-MM-DD') AS end_date, start_half, end_half
       FROM leave_requests WHERE user_id = $1 AND status = ANY($2::text[]) AND end_date >= $3`, [userId, statuses, from]);
  const lines = reqs.length ? (await db.query<LeaveLine & { charge: string }>(
    `SELECT leave_id, to_char(day,'YYYY-MM-DD') AS day, kind, half, state, charge FROM leave_days WHERE leave_id = ANY($1::text[])`, [reqs.map(r => r.leave_id)])).map(l => ({ ...l, charge: Number(l.charge) })) : [];
  const ledger = await balanceOf(db, userId);
  const held = waiting ? Number((await db.query<{ h: string }>(
    `SELECT COALESCE(SUM(d.charge), 0) AS h FROM leave_days d JOIN leave_requests q ON q.leave_id = d.leave_id WHERE q.user_id = $1 AND d.kind = 'leave' AND d.state <> 'cancelled' AND q.status = ANY($2::text[])`, [userId, HELD]))[0].h) : 0;
  const balance = ledger - held; // what can still be used
  const liveIds = reqs.filter(r => (LIVE_STATUSES as readonly string[]).includes(r.status)).map(r => r.leave_id);
  const reconciled = reconcileLeave({ requests: reqs, lines, assignments: next, patterns, from, balance, negativeLimit: await negativeLimit(db), fmtDay: fmtDayLong });
  const warnings = await dailyLimitWarnings(db, userId, reconciled.changes);
  return { from, rows: all, reconciled, warnings, fingerprint: hash(reconciled.key), balance, liveIds };
}

const hash = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 16);

/** Days a deduction lands on that are already full for the person's role (agents counted across the whole CX team). */
async function dailyLimitWarnings(db: Db, userId: number, changes: Change[]): Promise<LimitWarning[]> {
  const days = [...new Set(changes.filter(c => c.action === 'deduct').map(c => c.day))];
  if (!days.length) return [];
  const u = await db.query<{ role: string }>(`SELECT role FROM users WHERE user_id = $1`, [userId]);
  const role = u[0]?.role === 'tl' ? 'tl' : u[0]?.role === 'agent' ? 'agent' : null;
  if (!role) return []; // limits are off for QA and admins
  const lim = await db.query<{ weekday: number; half: string; max_off: number }>(`SELECT weekday, half, max_off FROM limits_by_role WHERE role = $1`, [role]);
  const limitMap = new Map(lim.map(l => [`${l.weekday}|${l.half}`, l.max_off]));
  const counts = await offCounts(db, role, days, userId, await waitingSupported(db));
  return limitWarnings(changes, counts, (day, half) => limitMap.get(`${weekday(day)}|${half}`) ?? null);
}

/** Writes a plan's changes: lines first, then one ledger entry for each day that moves the balance. Inside the caller's transaction. */
export async function applyReconciled(tx: Db, actorId: number, userId: number, plan: Plan, label: string): Promise<void> {
  for (const c of plan.reconciled.changes) {
    if (c.action === 'give_back') {
      await tx.query(`UPDATE leave_days SET state = 'cancelled' WHERE leave_id = $1 AND day = $2 AND state <> 'cancelled'`, [c.leave_id, c.day]);
    } else {
      for (const [kind, amt] of [['leave', c.leave], ['lop', c.lop]] as const) {
        if (!amt) continue;
        // revive a line this change cancelled earlier, or add to a part-charged day, or insert a new one
        await tx.query(
          `INSERT INTO leave_days (leave_id, day, kind, half, state, charge) VALUES ($1, $2, $3, $4, 'upcoming', $5)
           ON CONFLICT (leave_id, day, kind) DO UPDATE SET
             charge = CASE WHEN leave_days.state = 'cancelled' THEN EXCLUDED.charge ELSE leave_days.charge + EXCLUDED.charge END,
             state = 'upcoming'`, [c.leave_id, c.day, kind, c.half, amt]);
      }
    }
    if (c.leave > 0 && plan.liveIds.includes(c.leave_id)) { // a waiting request only moves held days, the ledger moves when it is approved
      await tx.query(
        `INSERT INTO leave_ledger (user_id, entry_type, amount, leave_id, description, created_by_user_id) VALUES ($1, 'Pattern change recalculation', $2, $3, $4, $5)`,
        [userId, c.action === 'give_back' ? c.leave : -c.leave, c.leave_id, `${label}. ${c.text}.`, actorId]);
    }
  }
}

export { fmtQ, addDays };
