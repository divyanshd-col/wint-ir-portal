import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMissingTable } from '../lib/roster-server';
import { todayIST, toIstDate, isIsoDate } from '../lib/ist';
import { extraDayNote, validateReportingLine, patternOn, cellKind, mondayOf, clampAnchor, periodDays, shiftAnchor, canGoPrev, cycleOf, ROSTER_START, canEditTarget, isCxDomain, validateNewChange, validateExtraDay, filterPeople, isFiltered, NO_FILTER, asId, cleanText, reasonTooLong, REASON_MAX, MAX_AHEAD_DAYS, type FilterRow, type Pattern, type Assignment } from '../lib/roster';

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

// ---- calendar filters ----
const people: FilterRow[] = [
  { name: 'Kashvi Sethi',   role: 'agent',   tlUserId: 1,    pattern: 3,    cells: ['work', 'off', 'off', 'work', 'work', 'work', 'work'] },
  { name: 'Rhythum Singhal', role: 'agent',  tlUserId: 1,    pattern: 1,    cells: ['work', 'work', 'work', 'work', 'work', 'off', 'off'] },
  { name: 'Anjali',          role: 'agent',  tlUserId: 2,    pattern: 3,    cells: ['leave', 'leave-half', 'work', 'work', 'work', 'work', 'work'] },
  { name: 'Harsh',           role: 'tl',     tlUserId: null, pattern: 4,    cells: ['off', 'work', 'work', 'work', 'work', 'work', 'off'] },
  { name: 'Isna Rizvi',      role: 'quality', tlUserId: null, pattern: 2,   cells: ['work', 'work', 'work', 'off', 'off', 'work', 'work'] },
  { name: 'Zed Extra',       role: 'agent',  tlUserId: null, pattern: null, cells: ['none', 'none', 'none', 'none', 'none', 'none', 'none'] },
  { name: 'Priya Dhawan',    role: 'agent',  tlUserId: 2,    pattern: 2,    cells: ['lop', 'work', 'extra', 'hol', 'work', 'work', 'work'] },
];
const names = (f: Partial<typeof NO_FILTER>) => filterPeople(people, { ...NO_FILTER, ...f }).map(p => p.name);

test('filters - no filter returns everyone, in order', () => {
  assert.equal(names({}).length, people.length);
  assert.equal(isFiltered(NO_FILTER), false);
  assert.equal(isFiltered({ ...NO_FILTER, q: '  ' }), false); // spaces alone are not a filter
  assert.equal(isFiltered({ ...NO_FILTER, role: 'tl' }), true);
});
test('filters - search matches every word anywhere in the name, ignoring case and extra spaces', () => {
  assert.deepEqual(names({ q: 'kash' }), ['Kashvi Sethi']);
  assert.deepEqual(names({ q: '  SETHI  kashvi ' }), ['Kashvi Sethi']);   // any order, any case
  assert.deepEqual(names({ q: 'h' }), ['Kashvi Sethi', 'Rhythum Singhal', 'Harsh', 'Priya Dhawan']);   // a single letter matches anywhere in the name
  assert.deepEqual(names({ q: 'nobody' }), []);
  assert.deepEqual(names({ q: 'a.' }), []);   // not a regex, "." is just a character
});
test('filters - team: a team lead, or nobody assigned', () => {
  assert.deepEqual(names({ team: '1' }), ['Kashvi Sethi', 'Rhythum Singhal']);
  assert.deepEqual(names({ team: '2' }), ['Anjali', 'Priya Dhawan']);
  assert.deepEqual(names({ team: 'none' }), ['Harsh', 'Isna Rizvi', 'Zed Extra']);
  assert.deepEqual(names({ team: '99' }), []);
});
test('filters - roster type, including people with no type yet', () => {
  assert.deepEqual(names({ type: '3' }), ['Kashvi Sethi', 'Anjali']);
  assert.deepEqual(names({ type: 'unset' }), ['Zed Extra']);
  assert.deepEqual(names({ type: '5' }), []);
});
test('filters - role', () => {
  assert.deepEqual(names({ role: 'tl' }), ['Harsh']);
  assert.deepEqual(names({ role: 'quality' }), ['Isna Rizvi']);
  assert.deepEqual(names({ role: 'admin' }), []);
});
test('filters - status looks at the days on screen, leave includes LOP and half days, no type never matches', () => {
  assert.deepEqual(names({ status: 'off' }), ['Kashvi Sethi', 'Rhythum Singhal', 'Harsh', 'Isna Rizvi']);
  assert.deepEqual(names({ status: 'leave' }), ['Anjali', 'Priya Dhawan']);   // leave, half-day leave and LOP
  assert.deepEqual(names({ status: 'extra' }), ['Priya Dhawan']);
  assert.deepEqual(names({ status: 'hol' }), ['Priya Dhawan']);
  assert.ok(!names({ status: 'working' }).includes('Zed Extra'));
  assert.deepEqual(names({ status: 'bogus' }), []);   // an unknown status shows nobody rather than everybody
});
test('filters - combine with AND', () => {
  assert.deepEqual(names({ team: '2', status: 'leave' }), ['Anjali', 'Priya Dhawan']);
  assert.deepEqual(names({ team: '2', type: '3' }), ['Anjali']);
  assert.deepEqual(names({ team: '1', role: 'tl' }), []);
  assert.deepEqual(names({ q: 'priya', team: '2', type: '2', role: 'agent', status: 'extra' }), ['Priya Dhawan']);
});

// ---- input hardening ----
test('asId - only real positive whole ids pass; null, true, [], empty and junk do not', () => {
  for (const ok of [1, 42, '7', '0012', 999999999999999]) assert.ok(asId(ok) !== null, `${String(ok)} is an id`);
  assert.equal(asId('0012'), 12);
  for (const bad of [null, undefined, true, false, [], [5], {}, '', ' ', 'abc', '1.5', 1.5, 0, '0', -1, '-1', NaN, Infinity, '1e3', ' 5', '5 ', '1;DROP', '99999999999999999999', 2 ** 60, '٣'])
    assert.equal(asId(bad), null, `${String(bad)} is not an id`);
});
test('cleanText - only strings count as text, an object never becomes "[object Object]"', () => {
  assert.equal(cleanText('  hello \n'), 'hello');
  for (const bad of [null, undefined, 5, true, {}, [], ['a']]) assert.equal(cleanText(bad), '');
});
test('reasons - capped at 500 characters on every roster action', () => {
  assert.equal(reasonTooLong('x'.repeat(REASON_MAX)), null);
  assert.ok(reasonTooLong('x'.repeat(REASON_MAX + 1)));
  const long = 'x'.repeat(REASON_MAX + 1);
  assert.match(validateNewChange({ today: '2026-11-22', start: '2026-11-30', reason: long, toPattern: 2, current: 1, hasFuture: false }) ?? '', /under 500/);
  assert.match(validateExtraDay({ today: '2026-11-22', day: '2026-11-21', isWeekOff: true, hasActive: false, reason: long }) ?? '', /under 500/);
  assert.match(validateReportingLine({ actorUserId: 1, userId: 2, tlUserId: 3, reason: long, personRole: 'agent', tlRole: 'tl' }) ?? '', /under 500/);
});
test('scheduling - a change can start at most 12 months ahead', () => {
  const base = { today: '2026-11-22', reason: 'r', toPattern: 2, current: 1, hasFuture: false };
  assert.equal(validateNewChange({ ...base, start: '2027-11-22' }), null); // exactly 365 days ahead and a Monday: still allowed
  assert.match(validateNewChange({ ...base, start: '2027-11-29' }) ?? '', /12 months ahead/);
  const lastMonday = (() => { let d = addDaysT(base.today, MAX_AHEAD_DAYS); while (new Date(d + 'T00:00:00Z').getUTCDay() !== 1) d = addDaysT(d, -1); return d; })();
  assert.equal(validateNewChange({ ...base, start: lastMonday }), null);
  assert.match(validateNewChange({ ...base, start: addDaysT(lastMonday, 7) }) ?? '', /12 months ahead/);
  assert.match(validateNewChange({ ...base, start: '2099-12-28' }) ?? '', /12 months ahead/);
});
const addDaysT = (iso: string, n: number) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

test('isIsoDate - real calendar dates only, 2027-02-30 is not one', () => {
  for (const ok of ['2026-11-22', '2028-02-29', '2026-12-31', '2026-01-01']) assert.equal(isIsoDate(ok), true, ok);
  for (const bad of ['2027-02-30', '2027-02-29', '2026-04-31', '2026-13-01', '2026-00-10', '2026-11-00', '2026-11-5', '26-11-05', '2026-11-05T00:00:00Z', ' 2026-11-05', '2026/11/05', '', 'tomorrow', null, undefined, 20261105, ['2026-11-05'], { a: 1 }])
    assert.equal(isIsoDate(bad as unknown), false, String(bad));
});
