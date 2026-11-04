import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { todayIST, toIstDate } from '../lib/ist';
import { patternOn, cellKind, mondayOf, clampStart, canEditTarget, validateNewChange, validateExtraDay, type Pattern, type Assignment } from '../lib/roster';

const P: Pattern[] = [
  { id: 1, label: 'Sun-Thu', off_weekdays: [5, 6] },
  { id: 2, label: 'Mon-Fri', off_weekdays: [6, 0] },
  { id: 3, label: 'Tue-Sat', off_weekdays: [0, 1] },
];
const base: Assignment[] = [{ pattern_id: 2, effective_from: '2026-01-01' }];

test('patternOn - lookup across a change boundary uses the date, not today', () => {
  const a = [...base, { pattern_id: 3, effective_from: '2026-11-08' }];
  assert.equal(patternOn(a, '2026-11-07'), 2);
  assert.equal(patternOn(a, '2026-11-08'), 3);
  // Sat 7 Nov is a week-off on pattern 2; Mon 9 Nov is a week-off on pattern 3
  assert.equal(cellKind(P, a, [], '2026-11-07'), 'off');
  assert.equal(cellKind(P, a, [], '2026-11-09'), 'off');
  assert.equal(cellKind(P, a, [], '2026-11-10'), 'work');
});

test('todayIST - at 00:30 IST the UTC date is still yesterday', () => {
  const t = new Date('2026-11-04T19:00:00Z'); // 00:30 IST on 5 Nov
  assert.equal(t.toISOString().slice(0, 10), '2026-11-04');
  assert.equal(todayIST(t), '2026-11-05');
  assert.equal(toIstDate(new Date('2026-11-05T18:29:00Z')), '2026-11-05');
  assert.equal(toIstDate(new Date('2026-11-05T18:30:00Z')), '2026-11-06');
});

test('cancel restores exactly; A to B to A nets to the original', () => {
  const sched = [...base, { pattern_id: 3, effective_from: '2026-12-01' }];
  const cancelled = sched.map(a => a.pattern_id === 3 ? { ...a, cancelled_at: 'x' } : a);
  for (const d of ['2026-11-30', '2026-12-01', '2027-01-15']) assert.equal(patternOn(cancelled, d), patternOn(base, d));
  const aba = [...base, { pattern_id: 3, effective_from: '2026-12-01' }, { pattern_id: 2, effective_from: '2026-12-15' }];
  assert.equal(patternOn(aba, '2026-12-10'), 3);
  assert.equal(patternOn(aba, '2026-12-20'), 2);
});

test('extra day - shows on a week-off only, ignores reversed marks', () => {
  assert.equal(cellKind(P, base, [{ day: '2026-11-07', half: 'full' }], '2026-11-07'), 'extra');
  assert.equal(cellKind(P, base, [{ day: '2026-11-07', half: 'full', reversed_at: 'x' }], '2026-11-07'), 'off');
  assert.equal(cellKind(P, base, [{ day: '2026-11-05', half: 'full' }], '2026-11-05'), 'work');
});

test('validateExtraDay - duplicate rejected, re-mark allowed once reversed (hasActive false)', () => {
  const ok = { today: '2026-11-10', day: '2026-11-08', isWeekOff: true, hasActive: false, reason: 'weekend backlog' };
  assert.equal(validateExtraDay(ok), null);
  assert.match(validateExtraDay({ ...ok, hasActive: true })!, /already has/);
  assert.match(validateExtraDay({ ...ok, day: '2026-10-31' })!, /current month/);
  assert.match(validateExtraDay({ ...ok, day: '2026-11-11' })!, /today or past/i);
  assert.match(validateExtraDay({ ...ok, isWeekOff: false })!, /not a week-off/);
});

test('validateNewChange - second future change, past start, same pattern and empty reason are rejected', () => {
  const ok = { today: '2026-11-04', start: '2026-11-05', reason: 'shift move', toPattern: 3, current: 2, hasFuture: false };
  assert.equal(validateNewChange(ok), null);
  assert.ok(validateNewChange({ ...ok, hasFuture: true }));
  assert.ok(validateNewChange({ ...ok, start: '2026-11-04' }));
  assert.ok(validateNewChange({ ...ok, toPattern: 2 }));
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

test('grid paging - Monday start, no earlier than 1 Nov 2026, 12 months ahead', () => {
  assert.equal(mondayOf('2026-11-08'), '2026-11-02'); // Sunday belongs to the week starting Monday
  assert.equal(clampStart('2026-11-04', '2026-11-04'), '2026-11-02');
  assert.equal(clampStart('2026-10-19', '2026-11-04'), '2026-11-01'); // paged back past the bound
  assert.equal(clampStart('2025-01-01', '2026-11-04'), '2026-11-01');
  assert.equal(clampStart('2030-01-01', '2026-11-04'), mondayOf('2027-11-04'));
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
    assert.ok(!quality.includes('roster:manage') && !agent.includes('roster:manage'), `${f}: quality/agent are view-only`);
    assert.ok(quality.includes('roster:view') && agent.includes('roster:view'), `${f}: quality/agent can view`);
  }
  const mig = read('db/migrations/035_roster.sql');
  for (const k of ["('quality','roster:view:access'", "('agent','roster:view:access'", "('tl','roster:manage:access'", "('admin','roster:manage:access'"]) assert.ok(mig.includes(k), k);
});
