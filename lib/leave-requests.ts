import { HttpError } from '@/lib/roster-server';

import { addDays, endOfDayIST, isIsoDate, toIstDate, weekday } from '@/lib/ist';
import { cycleOf, isOff, patternOn, reasonTooLong, type Assignment, type Pattern } from '@/lib/roster';
import { LIVE_STATUSES, fmtDayLong, fmtQ, quarter, type Half } from '@/lib/leave';
import { actionsFor, chargedDays, decide, noticeGiven, noticeNeeded, parseRules, splitLeaveLop, stretchDays, type Actions, type Decision, type FullHalf, type Rules, type SplitLine } from '@/lib/leave-rules';
import { balanceOf, leaveReady, offCounts, type Db } from '@/lib/leave-server';

/** Leave requests: applying, the 5-minute window, the decision, cancelling, editing and approving. One person's requests are
 *  always decided one after another (a lock), so two people can never both take the last spot. */

export const WINDOW_MINUTES = 5;
export const APPLY_ROLES = ['agent', 'tl', 'quality'];
/** Statuses whose days are held while the request waits (they reduce what can be used). */
export const HELD_STATUSES = ['In process', 'Pending for approval', 'Auto-rejected'];
/** Statuses that count towards the daily limit and block a new request on the same dates. */
const SPOT_STATUSES = [...LIVE_STATUSES, 'In process', 'Pending for approval', 'Auto-rejected'];

export interface ApplyInput { start: string; startHalf: Half; end: string; endHalf: Half }

export async function loadRules(db: Db): Promise<ReturnType<typeof parseRules>> {
  const rows = await db.query<{ key: string; value: string }>(`SELECT key, value FROM leave_settings`);
  return parseRules(Object.fromEntries(rows.map(r => [r.key, r.value])));
}

/** True once migrations 038 and 039 are both in. */
export async function requestsReady(db: Db): Promise<boolean> {
  if (!(await leaveReady(db))) return false;
  const r = await db.query<{ ok: boolean }>(`SELECT (to_regclass('public.leave_events') IS NOT NULL AND to_regclass('public.notifications') IS NOT NULL) AS ok`);
  return !!r[0]?.ok;
}

async function heldOf(db: Db, userId: number, excludeLeaveId?: string): Promise<number> {
  const r = await db.query<{ h: string }>(
    `SELECT COALESCE(SUM(d.charge), 0) AS h FROM leave_days d JOIN leave_requests q ON q.leave_id = d.leave_id
      WHERE q.user_id = $1 AND d.kind = 'leave' AND d.state <> 'cancelled' AND q.status = ANY($2::text[]) AND q.leave_id <> $3`,
    [userId, HELD_STATUSES, excludeLeaveId ?? '']);
  return Number(r[0].h);
}

async function approvedFullDays(db: Db, userId: number, excludeLeaveId?: string): Promise<Set<string>> {
  const r = await db.query<{ day: string }>(
    `SELECT to_char(d.day,'YYYY-MM-DD') AS day FROM leave_days d JOIN leave_requests q ON q.leave_id = d.leave_id
      WHERE q.user_id = $1 AND d.state <> 'cancelled' AND q.status = ANY($2::text[]) AND q.leave_id <> $3
      GROUP BY d.day HAVING SUM(d.charge) >= 1`, [userId, [...LIVE_STATUSES], excludeLeaveId ?? '']);
  return new Set(r.map(x => x.day));
}

async function limitFor(db: Db, role: string): Promise<(day: string, half: 'first' | 'second') => number | null> {
  if (role !== 'agent' && role !== 'tl') return () => null; // limits are off for QA and admins
  const lim = await db.query<{ weekday: number; half: string; max_off: number }>(`SELECT weekday, half, max_off FROM limits_by_role WHERE role = $1`, [role]);
  const m = new Map(lim.map(l => [`${l.weekday}|${l.half}`, l.max_off]));
  return (day, half) => m.get(`${weekday(day)}|${half}`) ?? null;
}

export interface Person { user_id: number; name: string; role: string; status: string; platform_domain: string }
export async function loadPerson(db: Db, userId: number): Promise<Person> {
  const r = await db.query<Person>(`SELECT user_id, name, role, status, platform_domain FROM users WHERE user_id = $1`, [userId]);
  if (!r[0]) throw new HttpError(404, 'Person not found.');
  return r[0];
}
export async function tlOfPerson(db: Db, userId: number): Promise<{ userId: number; name: string } | null> {
  const r = await db.query<{ user_id: number; name: string }>(
    `SELECT u.user_id, u.name FROM reporting_lines l JOIN users u ON u.user_id = l.tl_user_id WHERE l.user_id = $1 AND l.effective_from <= CURRENT_DATE AND u.status = 'active' ORDER BY l.effective_from DESC LIMIT 1`, [userId]);
  return r[0] ? { userId: r[0].user_id, name: r[0].name } : null;
}

async function roster(db: Db, userId: number) {
  const patterns = await db.query<Pattern>(`SELECT id, label, off_weekdays, rotates FROM roster_patterns ORDER BY id`);
  const assigns = await db.query<Assignment>(`SELECT pattern_id, to_char(effective_from,'YYYY-MM-DD') AS effective_from FROM roster_assignments WHERE user_id = $1 AND cancelled_at IS NULL`, [userId]);
  const cycle = cycleOf(patterns);
  return { patterns, assigns, isOff: (d: string) => isOff(patterns, patternOn(assigns, d, cycle), d), hasType: (d: string) => patternOn(assigns, d, cycle) !== null };
}

export function validateApplyInput(i: ApplyInput, today: string): string | null {
  if (!isIsoDate(i.start) || !isIsoDate(i.end)) return 'Pick a start and an end date.';
  if (i.end < i.start) return 'The end date can’t be before the start date.';
  if (i.start < today) return 'You can’t apply for past dates. If you were absent, your TL adds it.';
  const H = ['full', 'first', 'second'];
  if (!H.includes(i.startHalf) || !H.includes(i.endHalf)) return 'Choose a full day, the first half or the second half.';
  if (i.start === i.end ? i.startHalf !== i.endHalf : (i.startHalf === 'first' || i.endHalf === 'second')) {
    return i.start === i.end ? 'For one day, pick full day, first half or second half.' : 'A longer leave can start on the second half of its first day and end on the first half of its last day.';
  }
  return null;
}

export interface Preview {
  days: { day: string; half: Half; weight: number }[];
  lines: SplitLine[];
  leave: number; lop: number;
  stretch: number; run: { from: string; to: string } | null;
  noticeNeeded: number; noticeGiven: number;
  decision: Decision; deciderText: string; why: string;
  balance: number; held: number; available: number; balanceAfter: number;
  fullHalves: FullHalf[]; applicantHasTl: boolean; tlName: string | null;
  lopWarning: string | null; rules: Rules;
}

/**
 * Works out everything about a request without saving it: the days charged, the leave and LOP split, days away in a row,
 * notice, the daily limit, and what would happen at the end of the 5 minutes. Used for the live preview, when the request is
 * saved, and again when it is decided.
 */
export async function computeRequest(db: Db, userId: number, input: ApplyInput, o: { appliedAt: Date; excludeLeaveId?: string; deciding?: boolean }): Promise<Preview> {
  const person = await loadPerson(db, userId);
  if (person.status !== 'active' || !APPLY_ROLES.includes(person.role)) throw new HttpError(403, 'Leave is for agents, team leads and QA.');
  const { rules, missing } = await loadRules(db);
  if (!rules) throw new HttpError(409, `Leave rules aren’t set up yet (${missing.join(', ')}). Ask an admin.`);
  const appliedDate = toIstDate(o.appliedAt);
  const bad = validateApplyInput(input, appliedDate);
  if (bad) throw new HttpError(400, bad);

  const clash = await db.query<{ leave_id: string }>(
    `SELECT leave_id FROM leave_requests WHERE user_id = $1 AND status = ANY($2::text[]) AND leave_id <> $3 AND start_date <= $5 AND end_date >= $4 LIMIT 1`,
    [userId, SPOT_STATUSES, o.excludeLeaveId ?? '', input.start, input.end]);
  if (clash[0]) throw new HttpError(409, `You already have a request on those dates (${clash[0].leave_id}).`);

  const ro = await roster(db, userId);
  if (!ro.assigns.length) throw new HttpError(409, 'You have no roster type yet. Ask your TL.');
  const req = { start_date: input.start, end_date: input.end, start_half: input.startHalf, end_half: input.endHalf };
  const days = chargedDays(req, ro.isOff, ro.hasType);
  if (!days.length) throw new HttpError(400, 'Those days are all week-offs, so there is nothing to apply for.');

  const balance = await balanceOf(db, userId);
  const held = await heldOf(db, userId, o.excludeLeaveId);
  const available = quarter(balance - held);
  const split = splitLeaveLop(days, available, rules.negativeLimit);

  const approved = await approvedFullDays(db, userId, o.excludeLeaveId);
  const fullDays = days.filter(d => d.weight === 1).map(d => d.day);
  const stretch = stretchDays({ requestFullDays: fullDays, approvedFullDays: approved, isOff: ro.isOff });
  let run: Preview['run'] = null;
  if (fullDays.length) {
    const mine = new Set(fullDays); const away = (d: string) => mine.has(d) || approved.has(d) || ro.isOff(d);
    let from = fullDays[0], to = fullDays[0];
    while (away(addDays(from, -1))) from = addDays(from, -1);
    while (away(addDays(to, 1))) to = addDays(to, 1);
    run = { from, to };
  }

  const fullHalves: FullHalf[] = [];
  const lim = await limitFor(db, person.role);
  if (person.role === 'agent' || person.role === 'tl') {
    const counts = await offCounts(db, person.role, days.map(d => d.day), userId, true, o.deciding && o.excludeLeaveId ? { appliedAt: o.appliedAt.toISOString(), leaveId: o.excludeLeaveId } : undefined);
    for (const d of days) for (const half of (d.half === 'full' ? ['first', 'second'] : [d.half]) as ('first' | 'second')[]) {
      const limit = lim(d.day, half), count = counts[`${d.day}|${half}`] ?? 0;
      if (limit !== null && count >= limit) fullHalves.push({ day: d.day, half, count, limit });
    }
  }

  const tl = person.role === 'agent' ? await tlOfPerson(db, userId) : null;
  const stretchEff = stretch || 1;
  const decision = decide({ rules, stretch: stretchEff, leave: split.leave, lop: split.lop, startDate: input.start, appliedDate, applicantHasTl: !!tl, fullHalves, fmtDay: fmtDayLong });
  const needed = noticeNeeded(stretchEff, rules), given = noticeGiven(input.start, appliedDate);
  const total = quarter(split.leave + split.lop);
  const deciderText = decision.outcome === 'auto_approve' ? 'The system, after the 5 minutes' : decision.outcome === 'reject' ? 'Rejected automatically (you can send it to your TL)'
    : decision.level === 'tl' ? `Your TL${tl ? ` (${tl.name})` : ''}` : 'An admin';
  return {
    days, lines: split.lines, leave: split.leave, lop: split.lop, stretch: stretchEff, run, noticeNeeded: needed, noticeGiven: given,
    decision, deciderText, why: decision.outcome === 'reject' ? decision.note : decision.why,
    balance, held, available, balanceAfter: quarter(available - split.leave), fullHalves, applicantHasTl: !!tl, tlName: tl?.name ?? null,
    lopWarning: split.lop > 0 ? `Out of ${fmtQ(total)} day${total === 1 ? '' : 's'}, ${fmtQ(split.lop)} ${split.lop === 1 ? 'day' : 'days'} will be LOP since you don’t have enough leave` : null,
    rules,
  };
}

// ── events, notifications ──
export async function addEvent(db: Db, leaveId: string, actorUserId: number | null, event: string, text: string, reason?: string | null) {
  await db.query(`INSERT INTO leave_events (leave_id, actor_user_id, event, text, reason) VALUES ($1,$2,$3,$4,$5)`, [leaveId, actorUserId, event, text, reason ?? null]);
}
export async function notify(db: Db, userIds: number[], text: string, leaveId: string | null, needsAck = false) {
  for (const uid of [...new Set(userIds)]) await db.query(`INSERT INTO notifications (user_id, text, leave_id, needs_ack) VALUES ($1,$2,$3,$4)`, [uid, text, leaveId, needsAck]);
}
async function adminIds(db: Db, exceptUserId?: number): Promise<number[]> {
  const r = await db.query<{ user_id: number }>(`SELECT user_id FROM users WHERE role = 'admin' AND status = 'active' AND platform_domain <> 'pcg' AND user_id <> $1`, [exceptUserId ?? -1]);
  return r.map(x => x.user_id);
}

export interface ReqRow {
  leave_id: string; user_id: number; type: string; status: string; applied_at: string; reason: string | null; start_date: string; end_date: string;
  start_half: Half; end_half: Half; with_level: 'tl' | 'admin' | null; with_since: string | null; reject_code: string | null; reject_note: string | null;
  cancel_deadline: string | null; holds_spot: boolean; sent_to_tl: boolean; window_ends_at: string | null; stretch_days: number | null;
}
const REQ_COLS = `leave_id, user_id, type, status, applied_at, reason, to_char(start_date,'YYYY-MM-DD') AS start_date, to_char(end_date,'YYYY-MM-DD') AS end_date,
  start_half, end_half, with_level, with_since, reject_code, reject_note, cancel_deadline, holds_spot, sent_to_tl, window_ends_at, stretch_days`;

export async function getRequest(db: Db, leaveId: string, lock = false): Promise<ReqRow | null> {
  const r = await db.query<ReqRow>(`SELECT ${REQ_COLS} FROM leave_requests WHERE leave_id = $1${lock ? ' FOR UPDATE' : ''}`, [leaveId]);
  return r[0] ?? null;
}

async function replaceLines(db: Db, leaveId: string, lines: SplitLine[]) {
  await db.query(`DELETE FROM leave_days WHERE leave_id = $1`, [leaveId]);
  for (const l of lines) await db.query(`INSERT INTO leave_days (leave_id, day, kind, half, state, charge) VALUES ($1,$2,$3,$4,'upcoming',$5)`, [leaveId, l.day, l.kind, l.half, l.charge]);
}
async function cancelLines(db: Db, leaveId: string) { await db.query(`UPDATE leave_days SET state = 'cancelled' WHERE leave_id = $1`, [leaveId]); }
async function leaveAmount(db: Db, leaveId: string): Promise<number> {
  const r = await db.query<{ a: string }>(`SELECT COALESCE(SUM(charge), 0) AS a FROM leave_days WHERE leave_id = $1 AND kind = 'leave' AND state <> 'cancelled'`, [leaveId]);
  return Number(r[0].a);
}

/** Saves a new request. It waits 5 minutes ("In process"), during which the person can edit or cancel it. */
export async function createRequest(db: Db, userId: number, input: ApplyInput, reason: string): Promise<string> {
  if (!reason.trim()) throw new HttpError(400, 'A reason is required.');
  if (reasonTooLong(reason.trim())) throw new HttpError(400, reasonTooLong(reason.trim())!);
  await db.query(`SELECT 1 FROM users WHERE user_id = $1 FOR UPDATE`, [userId]);
  const now = new Date();
  const p = await computeRequest(db, userId, input, { appliedAt: now });
  const id = (await db.query<{ id: string }>(`SELECT 'LV-' || nextval('leave_id_seq') AS id`))[0].id;
  await db.query(
    `INSERT INTO leave_requests (leave_id, user_id, type, status, applied_at, reason, start_date, end_date, start_half, end_half, window_ends_at, source)
     VALUES ($1,$2,$3,'In process',$4,$5,$6,$7,$8,$9,$10,'app')`,
    [id, userId, p.leave > 0 ? 'leave' : 'lop', now.toISOString(), reason.trim(), input.start, input.end, input.startHalf, input.endHalf, new Date(now.getTime() + WINDOW_MINUTES * 60000).toISOString()]);
  await replaceLines(db, id, p.lines);
  await addEvent(db, id, userId, 'applied', 'Applied', reason.trim());
  await addEvent(db, id, null, 'in_process', `In process for ${WINDOW_MINUTES} minutes. You can still edit or cancel it.`);
  return id;
}

/** Edit while it is still waiting: it goes back through the 5-minute check and loses its place in the queue. */
export async function editRequest(db: Db, leaveId: string, userId: number, input: ApplyInput, reason: string): Promise<void> {
  if (!reason.trim()) throw new HttpError(400, 'A reason is required.');
  if (reasonTooLong(reason.trim())) throw new HttpError(400, reasonTooLong(reason.trim())!);
  await db.query(`SELECT 1 FROM users WHERE user_id = $1 FOR UPDATE`, [userId]);
  const r = await getRequest(db, leaveId, true);
  if (!r || r.user_id !== userId) throw new HttpError(404, 'Request not found.');
  if (r.status !== 'In process' && r.status !== 'Pending for approval') throw new HttpError(409, 'This request can’t be edited any more.');
  const now = new Date();
  const p = await computeRequest(db, userId, input, { appliedAt: now, excludeLeaveId: leaveId });
  await db.query(
    `UPDATE leave_requests SET status = 'In process', start_date = $2, end_date = $3, start_half = $4, end_half = $5, reason = $6, type = $7, applied_at = $8, window_ends_at = $9,
            with_level = NULL, with_since = NULL, sent_to_tl = FALSE, holds_spot = TRUE, reject_code = NULL, reject_note = NULL WHERE leave_id = $1`,
    [leaveId, input.start, input.end, input.startHalf, input.endHalf, reason.trim(), p.leave > 0 ? 'leave' : 'lop', now.toISOString(), new Date(now.getTime() + WINDOW_MINUTES * 60000).toISOString()]);
  await replaceLines(db, leaveId, p.lines);
  await addEvent(db, leaveId, userId, 'edited', `Edited. In process again for ${WINDOW_MINUTES} minutes.`, reason.trim());
}

/** Cancel: in process, auto-rejected, pending, or approved before it starts. Days go back. The TL is told about an approved one. */
export async function cancelRequest(db: Db, leaveId: string, userId: number): Promise<void> {
  await db.query(`SELECT 1 FROM users WHERE user_id = $1 FOR UPDATE`, [userId]);
  const r = await getRequest(db, leaveId, true);
  if (!r || r.user_id !== userId) throw new HttpError(404, 'Request not found.');
  const today = toIstDate(new Date());
  const wasApproved = r.status === 'Approved' || r.status === 'Auto-approved';
  if (!(HELD_STATUSES.includes(r.status) || wasApproved)) throw new HttpError(409, 'This request can’t be cancelled.');
  if (wasApproved && r.start_date <= today) throw new HttpError(409, 'Leave that has started or passed needs an admin to approve the cancel. That isn’t available yet.');
  if (r.status === 'Pending for approval' && r.start_date <= today) throw new HttpError(409, 'The leave date has come, so only an admin can decide this request.');
  const amount = await leaveAmount(db, leaveId);
  await cancelLines(db, leaveId);
  await db.query(`UPDATE leave_requests SET status = 'Cancelled', with_level = NULL, decided_at = NOW() WHERE leave_id = $1`, [leaveId]);
  if (wasApproved && amount > 0) {
    await db.query(`INSERT INTO leave_ledger (user_id, entry_type, amount, leave_id, description, created_by_user_id) VALUES ($1,'Leave days given back',$2,$3,$4,$1)`,
      [userId, amount, leaveId, `Leave cancelled before it started: ${fmtQ(amount)} day${amount === 1 ? '' : 's'} given back`]);
  }
  await addEvent(db, leaveId, userId, 'cancelled', wasApproved ? 'Cancelled before it started. The days are back in the balance.' : 'Cancelled. The days are back in the balance.');
  if (wasApproved) {
    const p = await loadPerson(db, userId);
    const tl = await tlOfPerson(db, userId);
    await notify(db, tl ? [tl.userId] : await adminIds(db, userId), `${p.name} cancelled leave ${fmtDayLong(r.start_date)}${r.end_date !== r.start_date ? ` to ${fmtDayLong(r.end_date)}` : ''} (${leaveId})`, leaveId, true);
  }
}

/** The person sends an auto-rejected request to a human. It stays with the TL (an admin if they have no TL) until someone decides. */
export async function sendToTl(db: Db, leaveId: string, userId: number): Promise<void> {
  await db.query(`SELECT 1 FROM users WHERE user_id = $1 FOR UPDATE`, [userId]);
  const r = await getRequest(db, leaveId, true);
  if (!r || r.user_id !== userId) throw new HttpError(404, 'Request not found.');
  if (r.status !== 'Auto-rejected') throw new HttpError(409, 'Only an auto-rejected request can be sent to your TL.');
  const p = await loadPerson(db, userId);
  const tl = p.role === 'agent' ? await tlOfPerson(db, userId) : null;
  const level = tl ? 'tl' : 'admin';
  await db.query(`UPDATE leave_requests SET status = 'Pending for approval', with_level = $2, with_since = NOW(), sent_to_tl = TRUE, cancel_deadline = NULL WHERE leave_id = $1`, [leaveId, level]);
  await addEvent(db, leaveId, userId, 'sent', tl ? `Sent to your TL (${tl.name})` : 'Sent to an admin');
  await notify(db, tl ? [tl.userId] : await adminIds(db, userId), `${p.name} sent ${leaveId} for a decision: ${r.reject_note ?? 'rejected by the system'}`, leaveId);
}

/** Decides a request whose 5 minutes are up, in the order it was made. */
async function finalizeOne(db: Db, leaveId: string): Promise<void> {
  const r = await getRequest(db, leaveId, true);
  if (!r || r.status !== 'In process' || !r.window_ends_at || new Date(r.window_ends_at) > new Date()) return;
  const person = await loadPerson(db, r.user_id);
  let p: Preview;
  try {
    p = await computeRequest(db, r.user_id, { start: r.start_date, end: r.end_date, startHalf: r.start_half, endHalf: r.end_half }, { appliedAt: new Date(r.applied_at), excludeLeaveId: leaveId, deciding: true });
  } catch (e) {
    if (e instanceof HttpError && e.status !== 403) { // it can no longer be processed (rules changed, dates now invalid): cancel it and say why
      await cancelLines(db, leaveId);
      await db.query(`UPDATE leave_requests SET status = 'Auto-cancelled', decided_at = NOW() WHERE leave_id = $1`, [leaveId]);
      await addEvent(db, leaveId, null, 'auto_cancelled', `Cancelled by the system: ${e.message}`);
      await notify(db, [r.user_id], `Your leave request ${leaveId} was cancelled: ${e.message}`, leaveId);
      return;
    }
    throw e;
  }
  await replaceLines(db, leaveId, p.lines); // the split can change if the balance moved in the 5 minutes
  const d = p.decision;
  const what = `${fmtDayLong(r.start_date)}${r.end_date !== r.start_date ? ` to ${fmtDayLong(r.end_date)}` : ''}`;
  if (d.outcome === 'auto_approve') {
    await db.query(`UPDATE leave_requests SET status = 'Auto-approved', stretch_days = $2, decided_at = NOW(), with_level = NULL WHERE leave_id = $1`, [leaveId, p.stretch]);
    await postApproval(db, r.user_id, leaveId, p.leave, r.user_id);
    await addEvent(db, leaveId, null, 'auto_approved', `Auto-approved. ${d.why}.`);
    await notify(db, [r.user_id], `Your leave ${what} (${leaveId}) was approved`, leaveId);
  } else if (d.outcome === 'route') {
    await db.query(`UPDATE leave_requests SET status = 'Pending for approval', with_level = $2, with_since = NOW(), stretch_days = $3 WHERE leave_id = $1`, [leaveId, d.level, p.stretch]);
    const tl = d.level === 'tl' ? await tlOfPerson(db, r.user_id) : null;
    await addEvent(db, leaveId, null, 'sent', `Sent to ${d.level === 'tl' ? `your TL${tl ? ` (${tl.name})` : ''}` : 'an admin'}. ${d.why}.`);
    await notify(db, d.level === 'tl' && tl ? [tl.userId] : await adminIds(db, r.user_id), `${person.name} applied for leave ${what} (${leaveId}), waiting for you`, leaveId);
  } else {
    const today = toIstDate(new Date());
    await db.query(`UPDATE leave_requests SET status = 'Auto-rejected', reject_code = $2, reject_note = $3, cancel_deadline = $4, holds_spot = $5, stretch_days = $6, decided_at = NOW() WHERE leave_id = $1`,
      [leaveId, d.code, d.note, endOfDayIST(today).toISOString(), d.code !== 'full', p.stretch]);
    await addEvent(db, leaveId, null, 'auto_rejected', `Auto-rejected: ${d.note}. Cancel it or send it to your TL before 11:59 pm IST, or it is cancelled automatically.`);
    await notify(db, [r.user_id], `Your leave ${what} (${leaveId}) was rejected: ${d.note}. Cancel it or send it to your TL before 11:59 pm.`, leaveId);
  }
}

/** Ledger entry when a request is approved: its days leave the balance. LOP days never touch it. */
async function postApproval(db: Db, userId: number, leaveId: string, leave: number, actorId: number) {
  if (leave <= 0) return;
  await db.query(`INSERT INTO leave_ledger (user_id, entry_type, amount, leave_id, description, created_by_user_id) VALUES ($1,'Leave approved',$2,$3,$4,$5)`,
    [userId, -leave, leaveId, `Leave approved: ${fmtQ(leave)} day${leave === 1 ? '' : 's'}`, actorId]);
}

/**
 * Moves everything that is due: requests whose 5 minutes are up (in the order they were made), auto-rejected requests whose
 * 11:59 pm deadline passed, and approved leave whose dates have gone by. Safe to run any time and from several places.
 */
export async function sweepDue(withTx: <T>(fn: (tx: Db) => Promise<T>) => Promise<T>, plain: Db): Promise<{ decided: number; cancelled: number; taken: number }> {
  let decided = 0, cancelled = 0, taken = 0;
  for (;;) {
    const due = await plain.query<{ leave_id: string }>(`SELECT leave_id FROM leave_requests WHERE status = 'In process' AND window_ends_at <= NOW() ORDER BY applied_at, leave_id LIMIT 20`);
    if (!due.length) break;
    let progressed = 0;
    for (const d of due) {
      await withTx(async tx => {
        await tx.query(`SELECT pg_advisory_xact_lock(727001)`); // decisions are made one at a time, in order
        const before = await getRequest(tx, d.leave_id);
        await finalizeOne(tx, d.leave_id);
        const after = await getRequest(tx, d.leave_id);
        if (before && after && before.status !== after.status) progressed++;
      });
    }
    decided += progressed;
    if (!progressed) break;
  }
  const expired = await plain.query<{ leave_id: string; user_id: number }>(`SELECT leave_id, user_id FROM leave_requests WHERE status = 'Auto-rejected' AND cancel_deadline < NOW()`);
  for (const e of expired) {
    await withTx(async tx => {
      const r = await getRequest(tx, e.leave_id, true);
      if (!r || r.status !== 'Auto-rejected') return;
      await cancelLines(tx, e.leave_id);
      await tx.query(`UPDATE leave_requests SET status = 'Auto-cancelled', decided_at = NOW() WHERE leave_id = $1`, [e.leave_id]);
      await addEvent(tx, e.leave_id, null, 'auto_cancelled', 'Auto-cancelled: nothing was chosen by 11:59 pm IST. The days are back in the balance.');
      await notify(tx, [e.user_id], `Your leave request ${e.leave_id} was cancelled automatically. The days are back in your balance.`, e.leave_id);
      cancelled++;
    });
  }
  const today = toIstDate(new Date());
  const done = await plain.query<{ leave_id: string }>(`UPDATE leave_requests SET status = 'Taken' WHERE status IN ('Approved','Auto-approved') AND end_date < $1 RETURNING leave_id`, [today]);
  taken = done.length;
  await plain.query(`UPDATE leave_days d SET state = 'taken' FROM leave_requests r WHERE r.leave_id = d.leave_id AND d.state = 'upcoming' AND d.day < $1 AND r.status IN ('Approved','Auto-approved','Taken')`, [today]);
  return { decided, cancelled, taken };
}

export type DecideAction = 'approve' | 'reject' | 'forward';
export interface Approver { userId: number; role: string }

/** Everything an approver is allowed to do with this request, from the rules. */
export async function approverContext(db: Db, r: ReqRow, who: Approver) {
  const { rules } = await loadRules(db);
  if (!rules) throw new HttpError(409, 'Leave rules aren’t set up yet.');
  const person = await loadPerson(db, r.user_id);
  const tl = person.role === 'agent' ? await tlOfPerson(db, r.user_id) : null;
  const ro = await roster(db, r.user_id);
  const approved = await approvedFullDays(db, r.user_id, r.leave_id);
  const lines = await db.query<{ day: string; weight: string; half: Half; kind: string; charge: string }>(`SELECT to_char(day,'YYYY-MM-DD') AS day, half, kind, charge, charge AS weight FROM leave_days WHERE leave_id = $1 AND state <> 'cancelled'`, [r.leave_id]);
  const perDay = new Map<string, number>();
  for (const l of lines) perDay.set(l.day, (perDay.get(l.day) ?? 0) + Number(l.charge));
  const fullDays = [...perDay].filter(([, t]) => t >= 1).map(([d]) => d);
  const stretch = stretchDays({ requestFullDays: fullDays, approvedFullDays: approved, isOff: ro.isOff }) || 1;
  const counts = person.role === 'agent' || person.role === 'tl' ? await offCounts(db, person.role, [...new Set(lines.map(l => l.day))], r.user_id, true) : {};
  const lim = await limitFor(db, person.role);
  const fullHalves: FullHalf[] = [];
  for (const l of lines) for (const half of (l.half === 'full' ? ['first', 'second'] : [l.half]) as ('first' | 'second')[]) {
    const limit = lim(l.day, half), count = counts[`${l.day}|${half}`] ?? 0;
    if (limit !== null && count >= limit && !fullHalves.some(f => f.day === l.day && f.half === half)) fullHalves.push({ day: l.day, half, count, limit });
  }
  const lop = lines.filter(l => l.kind === 'lop').reduce((a, l) => a + Number(l.charge), 0);
  const isTl = who.role === 'tl' && !!tl && tl.userId === who.userId;
  const actions: Actions = actionsFor({ userId: who.userId, role: who.role, isTlOfApplicant: isTl },
    { applicantUserId: r.user_id, withLevel: r.with_level ?? 'admin', sentToTl: r.sent_to_tl, fullDay: fullHalves.length > 0, stretch, startDate: r.start_date, today: toIstDate(new Date()), lop }, rules, !!tl);
  return { rules, person, tl, stretch, fullHalves, lop, actions };
}

/** Approve, reject or forward. Every action needs a reason. The stretch is counted again now: a request that has grown moves up. */
export async function decideRequest(db: Db, leaveId: string, who: Approver, action: DecideAction, reason: string, overLimitOk: boolean): Promise<{ moved?: string }> {
  if (!reason.trim()) throw new HttpError(400, 'A reason is required.');
  if (reasonTooLong(reason.trim())) throw new HttpError(400, reasonTooLong(reason.trim())!);
  await db.query(`SELECT pg_advisory_xact_lock(727001)`);
  const r = await getRequest(db, leaveId, true);
  if (!r) throw new HttpError(404, 'Request not found.');
  if (r.status !== 'Pending for approval') throw new HttpError(409, 'This request changed, please refresh.');
  const ctx = await approverContext(db, r, who);
  const a = ctx.actions;
  if (!a.reject && !a.approve && !a.forward) throw new HttpError(403, 'You can’t act on this request.');
  const actor = await loadPerson(db, who.userId);
  const what = `${fmtDayLong(r.start_date)}${r.end_date !== r.start_date ? ` to ${fmtDayLong(r.end_date)}` : ''}`;

  if (action === 'forward') {
    if (!a.forward) throw new HttpError(403, 'You can’t forward this request.');
    await db.query(`UPDATE leave_requests SET with_level = 'admin', with_since = NOW() WHERE leave_id = $1`, [leaveId]);
    await addEvent(db, leaveId, who.userId, 'forwarded', `Forwarded to an admin by ${actor.name}`, reason.trim());
    await notify(db, await adminIds(db, r.user_id), `${ctx.person.name}'s leave ${what} (${leaveId}) was forwarded to you`, leaveId);
    return {};
  }
  if (action === 'reject') {
    if (!a.reject) throw new HttpError(403, 'You can’t reject this request.');
    await cancelLines(db, leaveId);
    await db.query(`UPDATE leave_requests SET status = 'Rejected', with_level = NULL, decided_by_user_id = $2, decided_at = NOW() WHERE leave_id = $1`, [leaveId, who.userId]);
    await addEvent(db, leaveId, who.userId, 'rejected', `Rejected by ${actor.name}`, reason.trim());
    await notify(db, [r.user_id], `Your leave ${what} (${leaveId}) was rejected by ${actor.name}: ${reason.trim()}`, leaveId);
    return {};
  }
  // approve
  if (!a.approve) {
    // a TL who tries to approve something that has grown past their level: move it up, say why
    if (who.role === 'tl' && ctx.stretch > ctx.rules.threshold2 && r.with_level === 'tl') {
      await db.query(`UPDATE leave_requests SET with_level = 'admin', with_since = NOW(), stretch_days = $2 WHERE leave_id = $1`, [leaveId, ctx.stretch]);
      const text = `Moved to an admin: ${ctx.person.name} is now away ${ctx.stretch} days in a row`;
      await addEvent(db, leaveId, null, 'moved_up', text);
      await notify(db, await adminIds(db, r.user_id), `${text} (${leaveId})`, leaveId);
      return { moved: text };
    }
    throw new HttpError(403, a.approveBlockedWhy ?? 'You can’t approve this request.');
  }
  if (a.needsOverLimitOk && !overLimitOk) throw new HttpError(409, `OVER_LIMIT: ${ctx.fullHalves.map(f => `${fmtDayLong(f.day)} ${f.half} half: ${f.count} of ${f.limit} off`).join('; ')}. Approving puts the day over the limit.`);
  const amount = await leaveAmount(db, leaveId);
  await db.query(`UPDATE leave_requests SET status = 'Approved', with_level = NULL, holds_spot = TRUE, stretch_days = $2, decided_by_user_id = $3, decided_at = NOW() WHERE leave_id = $1`, [leaveId, ctx.stretch, who.userId]);
  await postApproval(db, r.user_id, leaveId, amount, who.userId);
  await addEvent(db, leaveId, who.userId, 'approved', ctx.fullHalves.length ? `Approved by ${actor.name} over the daily limit` : `Approved by ${actor.name}`, reason.trim());
  await notify(db, [r.user_id], `Your leave ${what} (${leaveId}) was approved by ${actor.name}`, leaveId);
  return {};
}

