import { HttpError } from '@/lib/roster-server';
import { addDays, toIstDate } from '@/lib/ist';
import { cycleOf, isOff, patternOn, type Assignment, type Pattern } from '@/lib/roster';
import { LIVE_STATUSES, daysBetween, quarter, type Half } from '@/lib/leave';
import { noticeGiven, noticeNeeded } from '@/lib/leave-rules';
import { balanceOf, offCounts, type Db } from '@/lib/leave-server';
import { approverContext, getRequest, HELD_STATUSES, limitFor, loadRules, loadPerson, requestsReady, roster, tlOfPerson, type ReqRow } from '@/lib/leave-requests';

export interface Viewer { userId: number; role: string }

/** The request, its timeline and day-by-day lines. Visible to the person, their TL, and admins. */
export async function requestDetail(db: Db, leaveId: string, viewer: Viewer) {
  const r = await getRequest(db, leaveId);
  if (!r) return null;
  const owner = r.user_id === viewer.userId;
  const tl = (await loadPerson(db, r.user_id)).role === 'agent' ? await tlOfPerson(db, r.user_id) : null;
  const approverView = !owner && (viewer.role === 'admin' || (viewer.role === 'tl' && tl?.userId === viewer.userId));
  if (!owner && !approverView) return null;
  const person = await loadPerson(db, r.user_id);

  const lines = await db.query<{ day: string; kind: string; state: string; charge: string; half: Half }>(`SELECT to_char(day,'YYYY-MM-DD') AS day, kind, state, charge, half FROM leave_days WHERE leave_id = $1 ORDER BY day, kind`, [leaveId]);
  const patterns = await db.query<Pattern>(`SELECT id, label, off_weekdays, rotates FROM roster_patterns`);
  const assigns = await db.query<Assignment>(`SELECT pattern_id, to_char(effective_from,'YYYY-MM-DD') AS effective_from FROM roster_assignments WHERE user_id = $1 AND cancelled_at IS NULL`, [r.user_id]);
  const cycle = cycleOf(patterns);
  const days = daysBetween(r.start_date, r.end_date).map(day => {
    const active = lines.filter(l => l.day === day && l.state !== 'cancelled');
    if (active.length) return { day, kind: active.some(l => l.kind === 'lop') ? (active.some(l => l.kind === 'leave') ? 'leave+lop' : 'lop') : 'leave', charge: quarter(active.reduce((a, l) => a + Number(l.charge), 0)), half: active[0].half };
    const t = patternOn(assigns, day, cycle);
    if (t !== null && isOff(patterns, t, day)) return { day, kind: 'weekoff', charge: 0, half: 'full' as Half };
    return { day, kind: lines.some(l => l.day === day) ? 'cancelled' : 'none', charge: 0, half: 'full' as Half };
  });
  const events = await db.query<{ at: string; event: string; text: string; reason: string | null; actor: string | null }>(
    `SELECT e.at, e.event, e.text, e.reason, u.name AS actor FROM leave_events e LEFT JOIN users u ON u.user_id = e.actor_user_id WHERE e.leave_id = $1 ORDER BY e.at, e.id`, [leaveId]);
  const leave = quarter(lines.filter(l => l.kind === 'leave' && l.state !== 'cancelled').reduce((a, l) => a + Number(l.charge), 0));
  const lop = quarter(lines.filter(l => l.kind === 'lop' && l.state !== 'cancelled').reduce((a, l) => a + Number(l.charge), 0));
  const today = toIstDate(new Date());
  const live = (LIVE_STATUSES as readonly string[]).includes(r.status);
  const out = {
    request: r, person: { name: person.name, role: person.role }, tlName: tl?.name ?? null, owner, leave, lop, days,
    events: events.map(e => ({ ...e, actor: e.actor })),
    ownerActions: owner ? {
      edit: r.status === 'In process' || r.status === 'Pending for approval',
      cancel: (HELD_STATUSES.includes(r.status) && !(r.status === 'Pending for approval' && r.start_date <= today)) || (live && r.start_date > today),
      sendToTl: r.status === 'Auto-rejected',
    } : null,
    approver: null as null | { actions: unknown; stretch: number; fullHalves: unknown; why: string },
  };
  if (approverView && r.status === 'Pending for approval') {
    const c = await approverContext(db, r, viewer);
    out.approver = { actions: c.actions, stretch: c.stretch, fullHalves: c.fullHalves, why: '' };
  }
  return out;
}

/** The payroll month that contains `today`: it runs from the 25th to the 24th (IST). */
export function payrollWindow(today: string): { from: string; to: string; label: string } {
  const [y, m, d] = today.split('-').map(Number);
  const startMonth = d >= 25 ? m : m - 1, startYear = startMonth === 0 ? y - 1 : y, sm = startMonth === 0 ? 12 : startMonth;
  const from = `${startYear}-${String(sm).padStart(2, '0')}-25`;
  const toMonth = sm === 12 ? 1 : sm + 1, toYear = sm === 12 ? startYear + 1 : startYear;
  const to = `${toYear}-${String(toMonth).padStart(2, '0')}-24`;
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return { from, to, label: `25 ${MON[sm - 1]} – 24 ${MON[toMonth - 1]} ${toYear}` };
}
/** The next 1st of a month after `today` (when the monthly credit runs, at 12:00 am IST). */
export function nextCreditDate(today: string): string {
  const [y, m] = today.split('-').map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
}

/** The home page: balance in quarter days, what is held, upcoming leave, what needs the person, and their roster. */
export async function leaveMe(db: Db, userId: number) {
  const ready = await requestsReady(db);
  const person = await loadPerson(db, userId);
  const { rules, missing } = ready ? await loadRules(db) : { rules: null, missing: [] as string[] };
  const patterns = await db.query<Pattern>(`SELECT id, label, off_weekdays, rotates FROM roster_patterns ORDER BY id`);
  const assigns = await db.query<Assignment>(`SELECT pattern_id, to_char(effective_from,'YYYY-MM-DD') AS effective_from FROM roster_assignments WHERE user_id = $1 AND cancelled_at IS NULL`, [userId]);
  const today = toIstDate(new Date());
  const type = patternOn(assigns, today, cycleOf(patterns));
  const pat = patterns.find(p => p.id === type);
  const base = { userId, ready, rulesMissing: missing, rulesReady: !!rules, negativeLimit: rules?.negativeLimit ?? -2, person: { name: person.name, role: person.role },
    roster: { type, label: pat?.label ?? null, offWeekdays: pat?.off_weekdays ?? [] }, today };
  const empty = { inProcess: [], lopMonth: { label: payrollWindow(today).label, approved: 0, waiting: 0 }, nextCredit: { date: nextCreditDate(today), amount: null as number | null }, holidays: [], scheduled: null };
  if (!ready) return { ...base, ...empty, balance: 0, held: 0, available: 0, upcoming: [], needsAction: [] };
  const balance = await balanceOf(db, userId);
  const held = Number((await db.query<{ h: string }>(`SELECT COALESCE(SUM(d.charge),0) AS h FROM leave_days d JOIN leave_requests q ON q.leave_id = d.leave_id WHERE q.user_id = $1 AND d.kind = 'leave' AND d.state <> 'cancelled' AND q.status = ANY($2::text[])`, [userId, HELD_STATUSES]))[0].h);
  const upcoming = await db.query(
    `SELECT r.leave_id, r.status, to_char(r.start_date,'YYYY-MM-DD') AS start_date, to_char(r.end_date,'YYYY-MM-DD') AS end_date, r.start_half, r.end_half,
            COALESCE((SELECT SUM(charge) FROM leave_days d WHERE d.leave_id = r.leave_id AND d.state <> 'cancelled'), 0)::float AS days
       FROM leave_requests r WHERE r.user_id = $1 AND r.status = ANY($2::text[]) AND r.end_date >= $3 ORDER BY r.start_date LIMIT 5`, [userId, [...LIVE_STATUSES, 'In process', 'Pending for approval'], today]);
  const inProcess = await db.query(
    `SELECT r.leave_id, to_char(r.start_date,'YYYY-MM-DD') AS start_date, to_char(r.end_date,'YYYY-MM-DD') AS end_date, r.start_half, r.end_half, r.window_ends_at,
            COALESCE((SELECT SUM(charge) FROM leave_days d WHERE d.leave_id = r.leave_id AND d.state <> 'cancelled'), 0)::float AS days
       FROM leave_requests r WHERE r.user_id = $1 AND r.status = 'In process' ORDER BY r.applied_at DESC LIMIT 3`, [userId]);
  const win = payrollWindow(today);
  const lopRows = await db.query<{ waiting: boolean; c: string }>(
    `SELECT (r.status IN ('In process','Pending for approval')) AS waiting, COALESCE(SUM(d.charge),0) AS c
       FROM leave_days d JOIN leave_requests r ON r.leave_id = d.leave_id
      WHERE r.user_id = $1 AND d.kind = 'lop' AND d.state <> 'cancelled' AND d.day BETWEEN $2 AND $3 AND r.status = ANY($4::text[]) GROUP BY 1`,
    [userId, win.from, win.to, [...LIVE_STATUSES, 'In process', 'Pending for approval']]);
  const lopMonth = { label: win.label, approved: quarter(Number(lopRows.find(r => !r.waiting)?.c ?? 0)), waiting: quarter(Number(lopRows.find(r => r.waiting)?.c ?? 0)) };
  const yearly = Number((await db.query<{ value: string }>(`SELECT value FROM leave_settings WHERE key = 'yearly_leave_count'`))[0]?.value);
  const nextCredit = { date: nextCreditDate(today), amount: Number.isFinite(yearly) && yearly > 0 ? yearly / 12 : null };
  const cycle = cycleOf(patterns);
  const holidays = (await db.query<{ day: string; name: string }>(`SELECT to_char(day,'YYYY-MM-DD') AS day, name FROM holidays WHERE day > $1 ORDER BY day LIMIT 40`, [today]))
    .filter(h => { const t = patternOn(assigns, h.day, cycle); return t !== null && !isOff(patterns, t, h.day); }).slice(0, 3);
  const sch = (await db.query<{ pattern_id: number; starts_on: string; set_by: string | null }>(
    `SELECT a.pattern_id, to_char(a.effective_from,'YYYY-MM-DD') AS starts_on, s.name AS set_by FROM roster_assignments a LEFT JOIN users s ON s.user_id = a.set_by_user_id
      WHERE a.user_id = $1 AND a.cancelled_at IS NULL AND a.effective_from > $2 ORDER BY a.effective_from LIMIT 1`, [userId, today]))[0];
  const scheduled = sch ? { type: sch.pattern_id, label: patterns.find(p => p.id === sch.pattern_id)?.label ?? null, starts_on: sch.starts_on, set_by: sch.set_by } : null;
  const needsAction = await db.query(
    `SELECT leave_id, to_char(start_date,'YYYY-MM-DD') AS start_date, to_char(end_date,'YYYY-MM-DD') AS end_date, reject_note, reject_code, start_half, end_half, cancel_deadline FROM leave_requests WHERE user_id = $1 AND status = 'Auto-rejected' ORDER BY cancel_deadline`, [userId]);
  return { ...base, userId, balance, held: quarter(held), available: quarter(balance - held), upcoming, inProcess, needsAction, lopMonth, nextCredit, holidays, scheduled };
}

/** Requests waiting for this approver, or the ones they have decided. An admin sees everything, a TL their own team. */
export async function approvalsList(db: Db, viewer: Viewer, tab: 'waiting' | 'done') {
  const cols = `r.leave_id`;
  let ids: string[];
  if (tab === 'waiting') {
    const rows = await db.query<{ leave_id: string }>(
      `SELECT r.leave_id FROM leave_requests r WHERE r.status = 'Pending for approval' AND r.user_id <> $1
         AND ($2 = 'admin' OR EXISTS (SELECT 1 FROM reporting_lines l WHERE l.user_id = r.user_id AND l.tl_user_id = $1 AND l.effective_from <= CURRENT_DATE
                AND l.effective_from = (SELECT MAX(effective_from) FROM reporting_lines x WHERE x.user_id = r.user_id AND x.effective_from <= CURRENT_DATE)))
        ORDER BY r.with_since, r.leave_id`, [viewer.userId, viewer.role]);
    ids = rows.map(r => r.leave_id);
  } else {
    const rows = await db.query<{ leave_id: string }>(
      `SELECT ${cols} FROM leave_requests r JOIN leave_events e ON e.leave_id = r.leave_id
        WHERE e.actor_user_id = $1 AND e.event IN ('approved','rejected','forwarded') GROUP BY r.leave_id ORDER BY MAX(e.at) DESC LIMIT 100`, [viewer.userId]);
    ids = rows.map(r => r.leave_id);
  }
  const { rules } = await loadRules(db);
  const out = [];
  for (const id of ids) {
    const r = await getRequest(db, id) as ReqRow;
    const person = await loadPerson(db, r.user_id);
    const tl = person.role === 'agent' ? await tlOfPerson(db, r.user_id) : null;
    const lines = await db.query<{ kind: string; charge: string }>(`SELECT kind, charge FROM leave_days WHERE leave_id = $1 AND state <> 'cancelled'`, [id]);
    const leave = quarter(lines.filter(l => l.kind === 'leave').reduce((a, l) => a + Number(l.charge), 0));
    const lop = quarter(lines.filter(l => l.kind === 'lop').reduce((a, l) => a + Number(l.charge), 0));
    const item: Record<string, unknown> = { request: r, person: { name: person.name, role: person.role }, tlName: tl?.name ?? null, leave, lop };
    if (tab === 'waiting' && rules) {
      const c = await approverContext(db, r, viewer);
      const why = await db.query<{ text: string }>(`SELECT text FROM leave_events WHERE leave_id = $1 AND event IN ('sent','forwarded','moved_up') ORDER BY at DESC, id DESC LIMIT 1`, [id]);
      const needed = noticeNeeded(c.stretch, rules), given = noticeGiven(r.start_date, toIstDate(new Date(r.applied_at)));
      const days = daysBetween(r.start_date, r.end_date);
      // who else is off on those days: an admin sees names, a TL only their own team
      const others = await db.query<{ name: string; day: string; half: string; status: string }>(
        `SELECT DISTINCT u.name, to_char(d.day,'YYYY-MM-DD') AS day, d.half, q.status FROM leave_days d JOIN leave_requests q ON q.leave_id = d.leave_id JOIN users u ON u.user_id = q.user_id
          WHERE d.day = ANY($1::date[]) AND d.state <> 'cancelled' AND q.user_id <> $2 AND u.role = $3 AND q.status = ANY($4::text[])
            AND ($5 = 'admin' OR EXISTS (SELECT 1 FROM reporting_lines l WHERE l.user_id = q.user_id AND l.tl_user_id = $6))
          ORDER BY day, u.name`, [days, r.user_id, person.role, [...LIVE_STATUSES, 'In process', 'Pending for approval'], viewer.role, viewer.userId]);
      // the prototype's "Already off on these dates" table: for each working day (up to a week), how many are off in each half against the limit
      const ro = await roster(db, r.user_id);
      const workDays = days.filter(d => !ro.isOff(d)).slice(0, 7);
      const counts = person.role === 'agent' || person.role === 'tl' ? await offCounts(db, person.role, workDays, r.user_id, true) : {};
      const lim = await limitFor(db, person.role);
      const hol = workDays.length ? await db.query<{ day: string; name: string }>(`SELECT to_char(day,'YYYY-MM-DD') AS day, name FROM holidays WHERE day = ANY($1::date[])`, [workDays]) : [];
      const offByDay = workDays.map(day => ({ day, holiday: hol.find(h => h.day === day)?.name ?? null,
        first: { count: counts[`${day}|first`] ?? 0, limit: lim(day, 'first') }, second: { count: counts[`${day}|second`] ?? 0, limit: lim(day, 'second') } }));
      Object.assign(item, { offByDay, stretch: c.stretch, fullHalves: c.fullHalves, actions: c.actions, noticeNeeded: needed, noticeGiven: given, whyHere: why[0]?.text ?? '', othersOff: others,
        balance: await balanceOf(db, r.user_id), waitingSince: r.with_since });
    }
    out.push(item);
  }
  return out;
}

/** One person's statement, newest first, with a running balance. The caller checks who may see it. */
export async function statementFor(db: Db, userId: number) {
  const rows = await db.query<{ id: number; at: string; entry_type: string; description: string; leave_id: string | null; amount: string; running: string }>(
    `SELECT id, to_char(entry_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD"T"HH24:MI') AS at, entry_type, description, leave_id, amount,
            SUM(amount) OVER (ORDER BY entry_at, id) AS running
       FROM leave_ledger WHERE user_id = $1 ORDER BY entry_at DESC, id DESC LIMIT 300`, [userId]);
  const held = Number((await db.query<{ h: string }>(`SELECT COALESCE(SUM(d.charge),0) AS h FROM leave_days d JOIN leave_requests q ON q.leave_id = d.leave_id WHERE q.user_id = $1 AND d.kind = 'leave' AND d.state <> 'cancelled' AND q.status = ANY($2::text[])`, [userId, HELD_STATUSES]))[0].h);
  // which requests the held days belong to (the prototype lists them under "Held for pending requests")
  const heldRequests = await db.query<{ leave_id: string; start_date: string; end_date: string; status: string; charge: string }>(
    `SELECT q.leave_id, to_char(q.start_date,'YYYY-MM-DD') AS start_date, to_char(q.end_date,'YYYY-MM-DD') AS end_date, q.status, SUM(d.charge) AS charge
       FROM leave_days d JOIN leave_requests q ON q.leave_id = d.leave_id
      WHERE q.user_id = $1 AND d.kind = 'leave' AND d.state <> 'cancelled' AND q.status = ANY($2::text[]) GROUP BY q.leave_id, q.start_date, q.end_date, q.status ORDER BY q.start_date, q.leave_id`, [userId, HELD_STATUSES]);
  return {
    balance: await balanceOf(db, userId), held: quarter(held),
    heldRequests: heldRequests.map(h => ({ leave_id: h.leave_id, start_date: h.start_date, end_date: h.end_date, status: h.status, charge: quarter(Number(h.charge)) })),
    entries: rows.map(r => ({ id: r.id, at: r.at, type: r.entry_type, description: r.description, leaveId: r.leave_id, amount: Number(r.amount), balance: Number(r.running) })),
  };
}

export async function listNotifications(db: Db, userId: number) {
  const items = await db.query(`SELECT id, created_at, text, leave_id, read_at, needs_ack, acked_at FROM notifications WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT 50`, [userId]);
  const unread = Number((await db.query<{ n: string }>(`SELECT COUNT(*) AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL`, [userId]))[0].n);
  return { items, unread };
}
export async function ackNotification(db: Db, userId: number, id: number) {
  const r = await db.query<{ id: number }>(`UPDATE notifications SET acked_at = NOW(), read_at = COALESCE(read_at, NOW()) WHERE id = $1 AND user_id = $2 AND needs_ack RETURNING id`, [id, userId]);
  if (!r[0]) throw new HttpError(404, 'Notification not found.');
}

export interface CalendarDay {
  day: string; off: boolean; hasType: boolean; holiday: string | null;
  mine: { kind: 'leave' | 'lop' | 'pend' | 'taken'; halves: [boolean, boolean]; leaveId: string } | null;
  full: [boolean, boolean];   // the first and the second half are already full for the person's role (no names)
}
/**
 * One month of the apply calendar for this person: week-offs, holidays, their own leave, and which halves are already full for
 * their role (counted across the whole CX team, requests still waiting included). Nobody is named.
 */
export async function calendarFor(db: Db, userId: number, month: string): Promise<{ month: string; days: CalendarDay[] }> {
  const [y, m] = month.split('-').map(Number);
  const first = `${y}-${String(m).padStart(2, '0')}-01`;
  const last = addDays(`${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`, -1);
  const days = daysBetween(first, last);
  const person = await loadPerson(db, userId);
  const ro = await roster(db, userId);
  const hols = new Map((await db.query<{ day: string; name: string }>(`SELECT to_char(day,'YYYY-MM-DD') AS day, name FROM holidays WHERE day BETWEEN $1 AND $2`, [first, last])).map(h => [h.day, h.name]));
  const mine = await db.query<{ day: string; half: string; kind: string; status: string; state: string; leave_id: string }>(
    `SELECT to_char(d.day,'YYYY-MM-DD') AS day, d.half, d.kind, r.status, d.state, r.leave_id FROM leave_days d JOIN leave_requests r ON r.leave_id = d.leave_id
      WHERE r.user_id = $1 AND d.day BETWEEN $2 AND $3 AND d.state <> 'cancelled' AND r.status = ANY($4::text[])`,
    [userId, first, last, [...LIVE_STATUSES, 'In process', 'Pending for approval', 'Auto-rejected']]);
  const limit = await limitFor(db, person.role);
  const counts = person.role === 'agent' || person.role === 'tl' ? await offCounts(db, person.role, days, userId, true) : {};
  return {
    month: first.slice(0, 7),
    days: days.map(day => {
      const t = mine.filter(x => x.day === day);
      const halves: [boolean, boolean] = [t.some(x => x.half === 'full' || x.half === 'first'), t.some(x => x.half === 'full' || x.half === 'second')];
      const live = t.find(x => (LIVE_STATUSES as readonly string[]).includes(x.status));
      const kind = t.length === 0 ? null : live ? (live.status === 'Taken' || live.state === 'taken' ? 'taken' : t.some(x => x.kind === 'lop') ? 'lop' : 'leave') : 'pend';
      const isFull = (half: 'first' | 'second') => { const l = limit(day, half); return l !== null && (counts[`${day}|${half}`] ?? 0) >= l; };
      return { day, off: ro.hasType(day) && ro.isOff(day), hasType: ro.hasType(day), holiday: hols.get(day) ?? null, mine: kind ? { kind, halves, leaveId: t[0].leave_id } : null, full: [isFull('first'), isFull('second')] };
    }),
  };
}
