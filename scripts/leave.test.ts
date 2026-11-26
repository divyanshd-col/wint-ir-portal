import test from 'node:test';
import assert from 'node:assert/strict';
import { dayWeight, dayHalf, fmtQ, quarter, reconcileLeave, limitWarnings, leaveByDay, type LeaveLine, type LeaveRequest, type Change } from '../lib/leave';
import { cellKind, patternOn, type Assignment, type Pattern } from '../lib/roster';

const P: Pattern[] = [
  { id: 1, label: 'Saturday and Sunday off', off_weekdays: [6, 0] },
  { id: 2, label: 'Thursday and Friday off', off_weekdays: [4, 5] },
  { id: 3, label: 'Tuesday and Wednesday off', off_weekdays: [2, 3] },
  { id: 4, label: 'Monday and Sunday off', off_weekdays: [1, 0] },
];
const A = (pattern_id: number, effective_from: string): Assignment => ({ pattern_id, effective_from });
const req = (over: Partial<LeaveRequest> = {}): LeaveRequest => ({ leave_id: 'LV-1', user_id: 1, type: 'leave', status: 'Approved', start_date: '2026-11-05', end_date: '2026-11-08', start_half: 'full', end_half: 'full', ...over });
const line = (day: string, charge = 1, over: Partial<LeaveLine> = {}): LeaveLine => ({ leave_id: 'LV-1', day, kind: 'leave', half: 'full', state: 'upcoming', charge, ...over });

// Apply a result to the lines like the server does: give back cancels, a deduction revives a cancelled line or adds one.
function apply(lines: LeaveLine[], changes: Change[]): LeaveLine[] {
  const out = lines.map(l => ({ ...l }));
  for (const c of changes) {
    if (c.action === 'give_back') { for (const l of out) if (l.leave_id === c.leave_id && l.day === c.day && l.state !== 'cancelled') l.state = 'cancelled'; continue; }
    for (const [kind, amt] of [['leave', c.leave], ['lop', c.lop]] as const) {
      if (!amt) continue;
      const ex = out.find(l => l.leave_id === c.leave_id && l.day === c.day && l.kind === kind);
      if (ex) { ex.state = 'upcoming'; ex.charge = amt; } else out.push({ leave_id: c.leave_id, day: c.day, kind, half: c.half, state: 'upcoming', charge: amt });
    }
  }
  return out;
}
const active = (lines: LeaveLine[]) => lines.filter(l => l.state !== 'cancelled').map(l => `${l.day}:${l.kind}:${l.charge}`).sort();

test('quarter days: weights and halves of a block that starts on a second half and ends on a first half', () => {
  const r = req({ start_date: '2026-11-04', end_date: '2026-11-06', start_half: 'second', end_half: 'first' });
  assert.deepEqual(['2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07'].map(d => dayWeight(r, d)), [0, 0.5, 1, 0.5, 0]);
  assert.deepEqual(['2026-11-04', '2026-11-05', '2026-11-06'].map(d => dayHalf(r, d)), ['second', 'full', 'first']);
  const single = req({ start_date: '2026-11-04', end_date: '2026-11-04', start_half: 'first', end_half: 'first' });
  assert.equal(dayWeight(single, '2026-11-04'), 0.5); assert.equal(dayHalf(single, '2026-11-04'), 'first');
  assert.equal(fmtQ(3.25), '3.25'); assert.equal(fmtQ(-1.5), '−1.5'); assert.equal(fmtQ(0), '0'); assert.equal(quarter(0.3), 0.25);
});

test('type change: a charged day that becomes a week-off is given back, a week-off that becomes working is deducted', () => {
  // Thu 5 to Sun 8 Nov on Type 1 (Sat+Sun off): Thu and Fri are charged. Moving to Type 2 (Thu+Fri off) swaps them.
  const r = reconcileLeave({ requests: [req()], lines: [line('2026-11-05'), line('2026-11-06')], assignments: [A(2, '2026-11-02')], patterns: P, from: '2026-11-02', balance: 5, negativeLimit: -2 });
  assert.deepEqual(r.changes.map(c => [c.day, c.action, c.leave, c.lop]), [['2026-11-05', 'give_back', 1, 0], ['2026-11-06', 'give_back', 1, 0], ['2026-11-07', 'deduct', 1, 0], ['2026-11-08', 'deduct', 1, 0]]);
  assert.equal(r.net, 0); assert.equal(r.lopDays, 0);
});

test('type change: a leave that ends up with fewer working days gives days back, with more working days deducts', () => {
  // Type 1 -> Type 3 (Tue+Wed off) from 2 Nov: Thu and Fri stay charged, Sat and Sun become working => deduct 2
  const r = reconcileLeave({ requests: [req()], lines: [line('2026-11-05'), line('2026-11-06')], assignments: [A(3, '2026-11-02')], patterns: P, from: '2026-11-02', balance: 5, negativeLimit: -2 });
  assert.deepEqual(r.changes.map(c => [c.day, c.action]), [['2026-11-07', 'deduct'], ['2026-11-08', 'deduct']]);
  assert.equal(r.net, -2);
});

test('type change: where balance runs out the rest is LOP, and at the negative limit a day becomes LOP directly', () => {
  const base = { requests: [req()], lines: [line('2026-11-05'), line('2026-11-06')], assignments: [A(3, '2026-11-02')], patterns: P, from: '2026-11-02', negativeLimit: -2 };
  const part = reconcileLeave({ ...base, balance: -1.25 }); // available 0.75: Sat 0.75 leave + 0.25 LOP, Sun all LOP
  assert.deepEqual(part.changes.map(c => [c.day, c.leave, c.lop]), [['2026-11-07', 0.75, 0.25], ['2026-11-08', 0, 1]]);
  assert.equal(part.net, -0.75); assert.equal(part.lopDays, 1.25);
  const atLimit = reconcileLeave({ ...base, balance: -2 });
  assert.deepEqual(atLimit.changes.map(c => [c.leave, c.lop]), [[0, 1], [0, 1]]); assert.equal(atLimit.net, 0);
  const lopReq = reconcileLeave({ ...base, requests: [req({ type: 'lop' })], balance: 10 });
  assert.deepEqual(lopReq.changes.map(c => [c.leave, c.lop]), [[0, 1], [0, 1]]); // an LOP request never takes balance
});

test('type change: given-back days are used before anything turns into LOP', () => {
  // Type 1 -> Type 2 gives back Thu+Fri (2) and deducts Sat+Sun (2). At -2 with nothing else, the 2 given back pay for them.
  const r = reconcileLeave({ requests: [req()], lines: [line('2026-11-05'), line('2026-11-06')], assignments: [A(2, '2026-11-02')], patterns: P, from: '2026-11-02', balance: -2, negativeLimit: -2 });
  assert.equal(r.lopDays, 0); assert.equal(r.net, 0);
});

test('type change: days before the start are untouched, and people with no type are left alone', () => {
  const r = reconcileLeave({ requests: [req()], lines: [line('2026-11-05'), line('2026-11-06')], assignments: [A(2, '2026-11-07')], patterns: P, from: '2026-11-07', balance: 5, negativeLimit: -2 });
  assert.deepEqual(r.changes.map(c => c.day), ['2026-11-07', '2026-11-08']); // Thu and Fri are before the start, kept as charged
  const none = reconcileLeave({ requests: [req()], lines: [line('2026-11-05')], assignments: [], patterns: P, from: '2026-11-02', balance: 5, negativeLimit: -2 });
  assert.equal(none.changes.length, 0);
});

test('type change: A to B to A nets to zero and cancelling restores the lines exactly', () => {
  const lines0 = [line('2026-11-05'), line('2026-11-06')];
  const orig = [A(1, '2026-11-02')];
  const toB = reconcileLeave({ requests: [req()], lines: lines0, assignments: [...orig, A(2, '2026-11-02')].slice(1), patterns: P, from: '2026-11-02', balance: 5, negativeLimit: -2 });
  const lines1 = apply(lines0, toB.changes);
  assert.notDeepEqual(active(lines1), active(lines0));
  // back to the original roster (a cancel): everything returns, nothing is created twice
  const back = reconcileLeave({ requests: [req()], lines: lines1, assignments: orig, patterns: P, from: '2026-11-02', balance: 5 + toB.net, negativeLimit: -2 });
  const lines2 = apply(lines1, back.changes);
  assert.deepEqual(active(lines2), active(lines0));
  assert.equal(toB.net + back.net, 0);
  // and with the roster unchanged there is nothing to do
  assert.equal(reconcileLeave({ requests: [req()], lines: lines2, assignments: orig, patterns: P, from: '2026-11-02', balance: 5, negativeLimit: -2 }).changes.length, 0);
});

test('type change: half days are deducted as half days', () => {
  const r = req({ start_date: '2026-11-07', end_date: '2026-11-08', start_half: 'second', end_half: 'first' }); // Sat second half to Sun first half
  const out = reconcileLeave({ requests: [r], lines: [], assignments: [A(3, '2026-11-02')], patterns: P, from: '2026-11-02', balance: 5, negativeLimit: -2 });
  assert.deepEqual(out.changes.map(c => [c.day, c.half, c.leave]), [['2026-11-07', 'second', 0.5], ['2026-11-08', 'first', 0.5]]);
  assert.equal(out.net, -1);
});

test('daily limit: only days already at the limit warn, a full day counts in both halves', () => {
  const changes: Change[] = [
    { leave_id: 'LV-1', day: '2026-11-07', half: 'full', action: 'deduct', leave: 1, lop: 0, text: '' },
    { leave_id: 'LV-1', day: '2026-11-08', half: 'second', action: 'deduct', leave: 0.5, lop: 0, text: '' },
    { leave_id: 'LV-1', day: '2026-11-09', half: 'full', action: 'give_back', leave: 1, lop: 0, text: '' },
  ];
  const counts = { '2026-11-07|first': 3, '2026-11-07|second': 2, '2026-11-08|first': 3, '2026-11-08|second': 3 };
  const w = limitWarnings(changes, counts, () => 3);
  assert.deepEqual(w.map(x => [x.day, x.half, x.count, x.limit]), [['2026-11-07', 'first', 3, 3], ['2026-11-08', 'second', 3, 3]]);
  assert.deepEqual(limitWarnings(changes, counts, () => null), []); // limits off for this role
});

test('grid cells: week-off wins, then leave / LOP (full or half), then a holiday, then working', () => {
  const asg = [A(1, '2026-11-02')];
  const ctx = { leave: leaveByDay([line('2026-11-04'), line('2026-11-05', 0.5), line('2026-11-06', 1, { kind: 'lop' }), line('2026-11-09', 1, { state: 'cancelled' }), line('2026-11-07')]), holidays: new Set(['2026-11-04', '2026-11-10']) };
  const k = (d: string) => cellKind(P, asg, [], d, ctx);
  assert.equal(k('2026-11-04'), 'leave');      // leave beats a holiday
  assert.equal(k('2026-11-05'), 'leave-half');
  assert.equal(k('2026-11-06'), 'lop');
  assert.equal(k('2026-11-07'), 'off');        // Sat is a week-off even though a line sits on it
  assert.equal(k('2026-11-09'), 'work');       // a cancelled line shows nothing (this is Type 2's Monday, a working day)
  assert.equal(k('2026-11-10'), 'hol');
  assert.equal(cellKind(P, [], [], '2026-11-04', ctx), 'none');
  assert.equal(patternOn(asg, '2026-11-09', 4), 2);
});

import { buildLoad } from '../lib/leave-import';
test('go-live load: balance already net of future leave is added back, each future leave deducted, past leave is history only', () => {
  const users = new Map([['riya@x.com', { userId: 7, name: 'Riya' }]]);
  let n = 10000;
  const out = buildLoad({
    balances: [{ email: 'riya@x.com', balance: 3, line: 2 }],
    leaves: [
      { email: 'riya@x.com', type: 'leave', status: 'Taken', start: '2026-11-03', end: '2026-11-04', startHalf: 'full', endHalf: 'full', line: 2 },      // Tue+Wed, before today
      { email: 'riya@x.com', type: 'leave', status: 'Approved', start: '2026-11-05', end: '2026-11-08', startHalf: 'full', endHalf: 'full', line: 3 },   // Thu..Sun: Thu+Fri charged on Type 1
    ],
    users, assignments: new Map([[7, [A(1, '2026-11-02')]]]), patterns: P, today: '2026-11-05', nextLeaveId: () => `LV-${++n}`,
  });
  assert.deepEqual(out.problems, []);
  assert.deepEqual(out.requests.map(r => r.leave_id), ['LV-10001', 'LV-10002']);
  assert.deepEqual(out.lines.map(l => [l.leave_id, l.day, l.state, l.charge]), [
    ['LV-10001', '2026-11-03', 'taken', 1], ['LV-10001', '2026-11-04', 'taken', 1], ['LV-10002', '2026-11-05', 'upcoming', 1], ['LV-10002', '2026-11-06', 'upcoming', 1]]);
  assert.deepEqual(out.ledger.map(l => [l.entry_type, l.amount, l.leave_id]), [['Opening balance', 5, null], ['Leave approved', -2, 'LV-10002']]); // 3 + 2 added back, then -2: still 3
  assert.equal(out.ledger.reduce((a, l) => a + l.amount, 0), 3);
});

test('go-live load: bad rows are reported, never guessed', () => {
  const users = new Map([['riya@x.com', { userId: 7, name: 'Riya' }], ['amit@x.com', { userId: 8, name: 'Amit' }]]);
  const mk = (over: object) => ({ email: 'riya@x.com', type: 'leave', status: 'Approved', start: '2026-11-10', end: '2026-11-11', startHalf: 'full', endHalf: 'full', line: 2, ...over });
  const run = (leaves: object[], balances = [{ email: 'riya@x.com', balance: 1, line: 2 }]) => buildLoad({ balances, leaves: leaves as never, users, assignments: new Map([[7, [A(1, '2026-11-02')]]]), patterns: P, today: '2026-11-05', nextLeaveId: () => 'LV-1' }).problems.join(' | ');
  assert.match(run([mk({ email: 'nobody@x.com' })]), /no active CX person/);
  assert.match(run([mk({ type: 'sick' })]), /type must be leave or lop/);
  assert.match(run([mk({ status: 'Rejected' })]), /status must be Approved or Taken/);
  assert.match(run([mk({ end: '2026-11-09' })]), /end on or after the start/);
  assert.match(run([mk({ startHalf: 'first' })]), /second half and end on the first half/);
  assert.match(run([mk({ leaveId: 'LV-9' }), mk({ leaveId: 'LV-9', start: '2026-11-20', end: '2026-11-20' })]), /used twice/);
  assert.match(run([mk({ leaveId: 'LV-8' }), mk({ leaveId: 'LV-9', start: '2026-11-11', end: '2026-11-12' })]), /already has LV-8/);
  assert.match(run([mk({ email: 'amit@x.com' })], [{ email: 'amit@x.com', balance: 1, line: 2 }]), /no roster type yet/);
  assert.match(run([mk({ start: '2026-11-07', end: '2026-11-08' })]), /all week-offs/); // Sat+Sun on Type 1
  assert.match(run([mk({})], [{ email: 'riya@x.com', balance: 1.3, line: 2 }]), /quarter days/);
  assert.match(run([mk({})], []), /no balance row/);
});
