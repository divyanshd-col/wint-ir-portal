import { HttpError } from '@/lib/roster-server';
import { toIstDate } from '@/lib/ist';
import { cycleOf, isOff, patternOn, type Assignment, type Pattern } from '@/lib/roster';
import { LIVE_STATUSES, daysBetween, quarter, type Half } from '@/lib/leave';
import { noticeGiven, noticeNeeded } from '@/lib/leave-rules';
import { balanceOf, type Db } from '@/lib/leave-server';
import { approverContext, getRequest, HELD_STATUSES, loadRules, loadPerson, requestsReady, tlOfPerson, type ReqRow } from '@/lib/leave-requests';

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
  if (!ready) return { ...base, balance: 0, held: 0, available: 0, upcoming: [], needsAction: [] };
  const balance = await balanceOf(db, userId);
  const held = Number((await db.query<{ h: string }>(`SELECT COALESCE(SUM(d.charge),0) AS h FROM leave_days d JOIN leave_requests q ON q.leave_id = d.leave_id WHERE q.user_id = $1 AND d.kind = 'leave' AND d.state <> 'cancelled' AND q.status = ANY($2::text[])`, [userId, HELD_STATUSES]))[0].h);
  const upcoming = await db.query(
    `SELECT leave_id, status, to_char(start_date,'YYYY-MM-DD') AS start_date, to_char(end_date,'YYYY-MM-DD') AS end_date FROM leave_requests
      WHERE user_id = $1 AND status = ANY($2::text[]) AND end_date >= $3 ORDER BY start_date LIMIT 5`, [userId, [...LIVE_STATUSES, 'In process', 'Pending for approval'], today]);
  const needsAction = await db.query(
    `SELECT leave_id, to_char(start_date,'YYYY-MM-DD') AS start_date, to_char(end_date,'YYYY-MM-DD') AS end_date, reject_note, cancel_deadline FROM leave_requests WHERE user_id = $1 AND status = 'Auto-rejected' ORDER BY cancel_deadline`, [userId]);
  return { ...base, userId, balance, held: quarter(held), available: quarter(balance - held), upcoming, needsAction };
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
      Object.assign(item, { stretch: c.stretch, fullHalves: c.fullHalves, actions: c.actions, noticeNeeded: needed, noticeGiven: given, whyHere: why[0]?.text ?? '', othersOff: others,
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
  return {
    balance: await balanceOf(db, userId), held: quarter(held),
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
