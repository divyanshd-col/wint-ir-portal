import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMissingTable } from '../lib/roster-server';
import { todayIST, toIstDate } from '../lib/ist';
import { extraDayNote, validateReportingLine, patternOn, cellKind, mondayOf, clampAnchor, periodDays, shiftAnchor, canGoPrev, cycleOf, ROSTER_START, canEditTarget, isCxDomain, validateNewChange, validateExtraDay, type Pattern, type Assignment } from '../lib/roster';

const P: Pattern[] = [
  { id: 1, label: 'Saturday and Sunday off', off_weekdays: [6, 0] },
  { id: 2, label: 'Thursday and Friday off', off_weekdays: [4, 5] },
  { id: 3, label: 'Tuesday and Wednesday off', off_weekdays: [2, 3] },
  { id: 4, label: 'Monday and Sunday off', off_weekdays: [1, 0] },
  { id: 5, label: 'Monday to Friday (fixed)', off_weekdays: [6, 0], rotates: false },
];
// Type 1 in the week of Mon 2 Nov 2026, so 9 Nov is Type 2, 16 Nov Type 3, 23 Nov Type 4, 30 Nov back to Type 1
const base: Assignment[] = [{ pattern_id: 1, effective_from: '2026-11-02' }];

test('rotation - everyone moves to the next type every Monday, Type 4 wraps to Type 1', () => {
  const t = (d: string) => patternOn(base, d);
  assert.deepEqual(['2026-11-02', '2026-11-08'].map(t), [1, 1]);   // Mon to Sun of the first week
  assert.deepEqual(['2026-11-09', '2026-11-15'].map(t), [2, 2]);
  assert.equal(t('2026-11-16'), 3);
  assert.equal(t('2026-11-23'), 4);
  assert.equal(t('2026-11-30'), 1);                                // 4-week cycle repeats
  assert.equal(t('2027-01-25'), 1);                                // 12 weeks on
  assert.equal(t('2026-10-31'), null);                             // before the anchor: no type known
  assert.equal(patternOn([], '2026-11-10'), null);                 // nobody loaded yet
});

test('rotation - the four weeks match the roster in the mail', () => {
  const week = (from: string) => ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((_, i) => cellKind(P, base, [], periodDays('week', from)[i]));
  // Week 1 Type 1: Sat+Sun off
  assert.deepEqual(week('2026-11-02'), ['work', 'work', 'work', 'work', 'work', 'off', 'off']);
  // Week 2 Type 2: Thu+Fri off
  assert.deepEqual(week('2026-11-09'), ['work', 'work', 'work', 'off', 'off', 'work', 'work']);
  // Week 3 Type 3: Tue+Wed off
  assert.deepEqual(week('2026-11-16'), ['work', 'off', 'off', 'work', 'work', 'work', 'work']);
  // Week 4 Type 4: Mon+Sun off
  assert.deepEqual(week('2026-11-23'), ['off', 'work', 'work', 'work', 'work', 'work', 'off']);
});

test('rotation - 2 offs a week, 8 per cycle, never more than 5 working days in a row, Sat+Sun off together once per 4 weeks', () => {
  for (const start of [1, 2, 3, 4]) {
    const a = [{ pattern_id: start, effective_from: '2026-11-02' }];
    const days = periodDays('week', '2026-11-02').concat(...[7, 14, 21, 28, 35, 42].map(n => periodDays('week', shiftDays('2026-11-02', n))));
    const kinds = days.map(d => cellKind(P, a, [], d));
    for (let w = 0; w < 4; w++) assert.equal(kinds.slice(w * 7, w * 7 + 7).filter(k => k === 'off').length, 2, `type ${start} week ${w}`);
    assert.equal(kinds.slice(0, 28).filter(k => k === 'off').length, 8);
    let run = 0, max = 0; for (const k of kinds) { run = k === 'work' ? run + 1 : 0; max = Math.max(max, run); }
    assert.ok(max <= 5, `type ${start} works ${max} days in a row`);
    const sat = days.filter((_, i) => i % 7 === 5 && i < 28).map(d => cellKind(P, a, [], d));
    const sun = days.filter((_, i) => i % 7 === 6 && i < 28).map(d => cellKind(P, a, [], d));
    assert.equal(sat.filter((k, i) => k === 'off' && sun[i] === 'off').length, 1);
  }
});
const shiftDays = (d: string, n: number) => shiftAnchor('day', d, 1) && new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);

test('rotation - a new anchor re-sets the type from its Monday; earlier weeks keep the old rotation', () => {
  const a = [...base, { pattern_id: 3, effective_from: '2026-12-07' }]; // old rotation would give Type 2 on 7 Dec
  assert.equal(patternOn(base, '2026-12-07'), 2);
  assert.equal(patternOn(a, '2026-12-06'), patternOn(base, '2026-12-06'));
  assert.equal(patternOn(a, '2026-12-07'), 3);
  assert.equal(patternOn(a, '2026-12-14'), 4);
  assert.equal(patternOn(a, '2026-12-21'), 1);
});

test('fixed type (Mon-Fri team) never rotates', () => {
  const fixed: Assignment[] = [{ pattern_id: 5, effective_from: '2026-11-02' }];
  assert.equal(cycleOf(P), 4);
  for (const d of ['2026-11-02', '2026-11-09', '2026-11-23', '2027-03-01']) assert.equal(patternOn(fixed, d, cycleOf(P)), 5);
  // Sat/Sun off every single week, Mon-Fri working
  for (const wk of ['2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23']) {
    assert.deepEqual(periodDays('week', wk).map(d => cellKind(P, fixed, [], d)), ['work', 'work', 'work', 'work', 'work', 'off', 'off']);
  }
});

test('the sheet - Week 1 groups G1..G4 are Types 1..4 and move one type a week (G1 is Type 4 in Week 4, G4 is Type 3)', () => {
  const g = (type: number) => [{ pattern_id: type, effective_from: '2026-11-02' }];
  assert.equal(patternOn(g(1), '2026-11-23', 4), 4); // Harsh: Mon+Sun off in Week 4
  assert.equal(patternOn(g(4), '2026-11-23', 4), 3); // Sundar: Tue+Wed off in Week 4
  assert.equal(patternOn(g(2), '2026-11-23', 4), 1); // Yashika: Sat+Sun off in Week 4
  assert.equal(patternOn(g(3), '2026-11-09', 4), 4); // Vedant in Week 2: Mon+Sun off
});

test('no roster type set - cells are none, not working', () => {
  assert.equal(cellKind(P, [], [], '2026-11-10'), 'none');
});

test('todayIST - at 00:30 IST the UTC date is still yesterday', () => {
  const t = new Date('2026-11-04T19:00:00Z'); // 00:30 IST on 5 Nov
  assert.equal(t.toISOString().slice(0, 10), '2026-11-04');
  assert.equal(todayIST(t), '2026-11-05');
  assert.equal(toIstDate(new Date('2026-11-05T18:29:00Z')), '2026-11-05');
  assert.equal(toIstDate(new Date('2026-11-05T18:30:00Z')), '2026-11-06');
});

test('cancel restores exactly; A to B to A nets to the original', () => {
  const sched = [...base, { pattern_id: 3, effective_from: '2026-12-07' }];
  const cancelled = sched.map(a => a.pattern_id === 3 ? { ...a, cancelled_at: 'x' } : a);
  for (const d of ['2026-12-06', '2026-12-07', '2027-01-15']) assert.equal(patternOn(cancelled, d), patternOn(base, d));
  // Back onto the type the rotation would have given anyway: no visible difference from the original
  const aba = [...base, { pattern_id: 3, effective_from: '2026-12-07' }, { pattern_id: patternOn(base, '2026-12-21')!, effective_from: '2026-12-21' }];
  for (const d of ['2026-12-21', '2026-12-28', '2027-02-01']) assert.equal(patternOn(aba, d), patternOn(base, d));
});

test('extra day - shows on a week-off only, ignores reversed marks', () => {
  // Sat 7 Nov: Type 1 week, Sat is off. Wed 4 Nov: working.
  assert.equal(cellKind(P, base, [{ day: '2026-11-07', half: 'full' }], '2026-11-07'), 'extra');
  assert.equal(cellKind(P, base, [{ day: '2026-11-07', half: 'full', reversed_at: 'x' }], '2026-11-07'), 'off');
  assert.equal(cellKind(P, base, [{ day: '2026-11-04', half: 'full' }], '2026-11-04'), 'work');
});

test('validateExtraDay - duplicate rejected, re-mark allowed once reversed (hasActive false)', () => {
  const ok = { today: '2026-11-10', day: '2026-11-08', isWeekOff: true, hasActive: false, reason: 'weekend backlog' };
  assert.equal(validateExtraDay(ok), null);
  assert.match(validateExtraDay({ ...ok, hasActive: true })!, /already has/);
  assert.match(validateExtraDay({ ...ok, day: '2026-10-31' })!, /roster starts/);                  // before launch
  assert.equal(validateExtraDay({ ...ok, today: '2026-12-02', day: '2026-11-08' }), null);           // an earlier month is fine
  assert.match(validateExtraDay({ ...ok, day: '2026-11-11' })!, /today or past/i);
  assert.match(validateExtraDay({ ...ok, isWeekOff: false })!, /not a week-off/);
});

test('validateNewChange - second future change, past start, non-Monday, no-op and empty reason are rejected', () => {
  const ok = { today: '2026-11-04', start: '2026-11-09', reason: 'shift move', toPattern: 3, current: 2, hasFuture: false };
  assert.equal(validateNewChange(ok), null);
  assert.ok(validateNewChange({ ...ok, hasFuture: true }));
  assert.ok(validateNewChange({ ...ok, start: '2026-11-02' }));
  assert.match(validateNewChange({ ...ok, start: '2026-11-10' })!, /Monday/); // the rotation moves on Mondays
  assert.match(validateNewChange({ ...ok, toPattern: 2 })!, /already the type/); // no-op against the rotation
  assert.ok(validateNewChange({ ...ok, reason: '  ' }));
});

test('canEditTarget - TL only for members reporting to them by id; near-identical names do not matter', () => {
  const amit = { userId: 1001, role: 'tl' };
  assert.equal(canEditTarget(amit, 2001, 1001), true);   // reports to Amit
  assert.equal(canEditTarget(amit, 2002, 1002), false);  // reports to Sumit (a different id)
  assert.equal(canEditTarget(amit, 2003, null), false);  // unassigned
  assert.equal(canEditTarget(amit, 1001, 1001), false);  // own row is admin-only
  assert.equal(canEditTarget({ userId: 1, role: 'admin' }, 2002, 1002), true);
  assert.equal(canEditTarget({ userId: 3, role: 'agent' }, 2002, 3), false);
});

test('calendar - day is one date, week is Monday to Sunday, month is whole Monday-aligned weeks', () => {
  assert.deepEqual(periodDays('day', '2026-11-04'), ['2026-11-04']);
  const w = periodDays('week', '2026-11-08'); // a Sunday belongs to the week starting Monday
  assert.equal(w.length, 7); assert.equal(w[0], '2026-11-02'); assert.equal(w[6], '2026-11-08');
  const m = periodDays('month', '2026-11-15'); // Nov 2026 starts on a Sunday (6 days of lead-in) and has 30 days
  assert.equal(m[0], '2026-10-26'); assert.equal(m.length % 7, 0); assert.equal(m.length, 42); assert.equal(m[41], '2026-12-06'); // 6 leading + 30 days = 6 weeks
  assert.equal(periodDays('month', '2026-12-10').length, 35); // 1 Dec is a Tuesday
});

test('calendar - stepping: day, week, and month (lands on the 1st, crosses year end)', () => {
  assert.equal(shiftAnchor('day', '2026-11-04', 1), '2026-11-05');
  assert.equal(shiftAnchor('week', '2026-11-04', -1), '2026-10-28');
  assert.equal(shiftAnchor('month', '2026-11-20', 1), '2026-12-01');
  assert.equal(shiftAnchor('month', '2026-12-20', 1), '2027-01-01');
  assert.equal(shiftAnchor('month', '2026-01-31', 1), '2026-02-01');
});

test('calendar - nothing before 1 Nov 2026, at most 12 months ahead', () => {
  assert.equal(clampAnchor('2025-01-01', '2026-11-04'), ROSTER_START);
  assert.equal(clampAnchor('2030-01-01', '2026-11-04'), '2027-11-04');
  assert.equal(canGoPrev('day', '2026-11-01'), false);
  assert.equal(canGoPrev('day', '2026-11-02'), true);
  assert.equal(canGoPrev('week', '2026-11-04'), true);  // previous week still holds Sun 1 Nov
  assert.equal(canGoPrev('week', '2026-10-28'), false); // that week is the first one; one more back is all pre-launch
  assert.equal(canGoPrev('month', '2026-11-20'), false);
  assert.equal(canGoPrev('month', '2026-12-01'), true);
});

test('roster skills - defaults agree in all copies and the migration grants them', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const read = (p: string) => readFileSync(join(root, p), 'utf8');
  for (const f of ['components/RoleShell.tsx', 'middleware.ts', 'lib/skills.ts', 'lib/nav.ts']) {
    const s = read(f);
    assert.ok(s.includes("'roster:view:access'"), `${f} grants view`);
    assert.ok(s.includes("'roster:manage:access'"), `${f} grants manage to admin/tl`);
    const quality = /quality: \[([^\]]*)\]/.exec(s)?.[1] ?? '';
    const agent = /agent: \[([^\]]*)\]/.exec(s)?.[1] ?? '';
    assert.ok(!quality.includes('roster:manage') && !agent.includes('roster:manage'), `${f}: quality/agent never manage`);
    assert.ok(quality.includes('roster:view'), `${f}: quality can view`);
    assert.ok(!agent.includes('roster:view'), `${f}: the Roster is off for agents (a switch in Settings > Skills)`);
  }
  const mig = read('db/migrations/035_roster.sql');
  for (const k of ["('quality','roster:view:access'", "('tl','roster:manage:access'", "('admin','roster:manage:access'"]) assert.ok(mig.includes(k), k);
  assert.ok(!mig.includes("('agent','roster:view:access'"), '035 no longer grants agents the roster');
  assert.match(read('db/migrations/037_roster_agents_off.sql'), /DELETE FROM persona_skills WHERE persona_id = 'agent' AND skill_id = 'roster:view:access'/);
});

test('isMissingTable - only Postgres undefined_table (42P01) counts', () => {
  assert.equal(isMissingTable({ code: '42P01' }), true);
  assert.equal(isMissingTable({ code: '23505' }), false);
  assert.equal(isMissingTable(new Error('boom')), false);
  assert.equal(isMissingTable(null), false);
});

test('roster is CX only - PCG-only users are out, cx and both are in', () => {
  assert.equal(isCxDomain('cx'), true);
  assert.equal(isCxDomain('both'), true);
  assert.equal(isCxDomain('pcg'), false);
  assert.equal(isCxDomain(undefined), true); // older rows default to cx
});

test('extra day from an earlier month is added in the current month with a note of the original date', () => {
  assert.equal(extraDayNote('2026-11-08', '2026-11-20'), null);
  assert.equal(extraDayNote('2026-11-08', '2026-12-02'), 'Worked on 2026-11-08, added in December 2026');
  assert.equal(extraDayNote('2026-12-28', '2027-01-03'), 'Worked on 2026-12-28, added in January 2027');
});

test('team lead change - admin rules: reason, never your own record, agents only, real team lead', () => {
  const ok = { actorUserId: 1, userId: 2, tlUserId: 3, reason: 'moved teams', personRole: 'agent', tlRole: 'tl' };
  assert.equal(validateReportingLine(ok), null);
  assert.ok(validateReportingLine({ ...ok, reason: ' ' }));
  assert.match(validateReportingLine({ ...ok, userId: 1 })!, /own team lead/);
  assert.match(validateReportingLine({ ...ok, personRole: 'tl' })!, /Only agents/);
  assert.match(validateReportingLine({ ...ok, tlRole: 'agent' })!, /Pick a team lead/);
  assert.ok(validateReportingLine({ ...ok, tlUserId: 2 }));
});
