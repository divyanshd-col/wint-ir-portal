import test from 'node:test';
import assert from 'node:assert/strict';
import { actionsFor, chargedDays, decide, levelForStretch, noticeGiven, noticeNeeded, parseRules, splitLeaveLop, stretchDays, type Rules } from '../lib/leave-rules';
import { endOfDayIST } from '../lib/ist';
import { isOff, patternOn, type Assignment, type Pattern } from '../lib/roster';

const P: Pattern[] = [
  { id: 1, label: 'Sat+Sun', off_weekdays: [6, 0] }, { id: 2, label: 'Thu+Fri', off_weekdays: [4, 5] },
  { id: 3, label: 'Tue+Wed', off_weekdays: [2, 3] }, { id: 4, label: 'Mon+Sun', off_weekdays: [1, 0] },
];
// Test numbers only. The real ones come from the settings table.
const R: Rules = { negativeLimit: -2, threshold1: 2, threshold2: 7, maxLength: 14, b1Len: 2, b1Days: 2, b2Len: 5, b2Days: 5, b3Days: 10 };
const A: Assignment[] = [{ pattern_id: 1, effective_from: '2026-11-02' }]; // Type 1: Sat+Sun off, rotating weekly
const off = (d: string) => isOff(P, patternOn(A, d, 4), d);
const typed = (d: string) => patternOn(A, d, 4) !== null;
const req = (s: string, e: string, sh = 'full', eh = 'full') => ({ start_date: s, end_date: e, start_half: sh as 'full', end_half: eh as 'full' });

test('rules: every setting must exist, nothing is defaulted', () => {
  const full = { threshold_1: '2', threshold_2: '7', max_length: '14', notice_band_1_length: '2', notice_band_1_days: '2', notice_band_2_length: '5', notice_band_2_days: '5', notice_band_3_days: '10' };
  const ok = parseRules({ ...full, negative_limit: '-2' });
  assert.deepEqual(ok.missing, []); assert.equal(ok.rules?.threshold2, 7); assert.equal(ok.rules?.negativeLimit, -2);
  const bad = parseRules({ ...full, max_length: '', notice_band_3_days: 'abc' });
  assert.equal(bad.rules, null); assert.deepEqual(bad.missing, ['max_length', 'notice_band_3_days']);
  assert.deepEqual(parseRules({}).missing.length, 8);
});

test('charging: week-offs are free, a holiday on a working day still costs 1, half days cost 0.5', () => {
  // Thu 5 Nov to Mon 9 Nov on Type 1 (Sat+Sun off; Mon 9 Nov is the Type 2 week, a working day)
  const d = chargedDays(req('2026-11-05', '2026-11-09'), off, typed);
  assert.deepEqual(d.map(x => [x.day, x.weight]), [['2026-11-05', 1], ['2026-11-06', 1], ['2026-11-09', 1]]);
  const half = chargedDays(req('2026-11-06', '2026-11-09', 'second', 'first'), off, typed);
  assert.deepEqual(half.map(x => [x.day, x.half, x.weight]), [['2026-11-06', 'second', 0.5], ['2026-11-09', 'first', 0.5]]);
  assert.deepEqual(chargedDays(req('2026-11-07', '2026-11-08'), off, typed), []); // all week-offs
  assert.deepEqual(chargedDays(req('2026-10-30', '2026-10-31'), off, typed), []); // before the roster starts
});

test('balance split: part leave, rest LOP, earliest days take the balance first (the docs example)', () => {
  const days = [{ day: '2026-11-05', half: 'full' as const, weight: 1 }];
  const s = splitLeaveLop(days, -1.75, -2);
  assert.deepEqual(s.lines.map(l => [l.kind, l.charge]), [['leave', 0.25], ['lop', 0.75]]); assert.equal(s.leave, 0.25); assert.equal(s.lop, 0.75);
  const three = [5, 6, 9].map(n => ({ day: `2026-11-0${n}`, half: 'full' as const, weight: 1 }));
  const t = splitLeaveLop(three, 1.5, -2); // 3.5 usable: all three days from balance
  assert.equal(t.lop, 0); assert.equal(t.leave, 3);
  const u = splitLeaveLop(three, -1, -2); // 1 usable: first day leave, the rest LOP
  assert.deepEqual(u.lines.map(l => [l.day, l.kind, l.charge]), [['2026-11-05', 'leave', 1], ['2026-11-06', 'lop', 1], ['2026-11-09', 'lop', 1]]);
  assert.equal(splitLeaveLop(days, -2, -2).leave, 0); // at the limit: all LOP
  assert.equal(splitLeaveLop(days, -3, -2).lop, 1);   // below the limit never takes more
});

test('days away in a row: the docs example, half days break it, week-offs only count when they touch', () => {
  // Riya (off Sat+Sun) has leave Thu 5 and Fri 6 Nov, applies Mon 9 and Tue 10: Thu..Tue = 6 days away
  const approved = new Set(['2026-11-05', '2026-11-06']);
  assert.equal(stretchDays({ requestFullDays: ['2026-11-09', '2026-11-10'], approvedFullDays: approved, isOff: off }), 6);
  // alone, Mon+Tue next to a weekend: Sat..Tue = 4
  assert.equal(stretchDays({ requestFullDays: ['2026-11-09', '2026-11-10'], approvedFullDays: new Set(), isOff: off }), 4);
  // a mid-week day with nothing next to it
  assert.equal(stretchDays({ requestFullDays: ['2026-11-04'], approvedFullDays: new Set(), isOff: off }), 1);
  // Thursday to Monday: 5 days away, not 3
  assert.equal(stretchDays({ requestFullDays: ['2026-11-05', '2026-11-06', '2026-11-09'], approvedFullDays: new Set(), isOff: off }), 5);
  // a half-day neighbour is not in approvedFullDays, so it breaks the run; only half days means 0 (judged as 1)
  assert.equal(stretchDays({ requestFullDays: [], approvedFullDays: new Set(), isOff: off }), 0);
});

test('notice: bands by days away, counted in calendar days', () => {
  assert.deepEqual([1, 2, 3, 5, 6, 20].map(n => noticeNeeded(n, R)), [2, 2, 5, 5, 10, 10]);
  assert.equal(noticeNeeded(0, R), 2); // half days use the 1-day band
  assert.equal(noticeGiven('2026-10-13', '2026-10-10'), 3); // "3 days notice, applied on 10 Oct: 13 Oct is fine"
  assert.equal(noticeGiven('2026-10-10', '2026-10-10'), 0);
});

const base = { rules: R, stretch: 1, leave: 1, lop: 0, startDate: '2026-11-20', appliedDate: '2026-11-10', applicantHasTl: true, fullHalves: [] as never[] };
test('decision: short notice, then a full day, then too long, then who decides', () => {
  assert.equal(decide({ ...base }).outcome, 'auto_approve');
  const sn = decide({ ...base, startDate: '2026-11-11' });
  assert.equal(sn.outcome === 'reject' && sn.code, 'short_notice'); assert.match((sn as { note: string }).note, /needs 2 days notice and you gave 1/);
  const full = decide({ ...base, fullHalves: [{ day: '2026-11-20', half: 'first', count: 4, limit: 3 }] });
  assert.equal(full.outcome === 'reject' && full.code, 'full'); assert.match((full as { note: string }).note, /4 people are already off on 2026-11-20/);
  const long = decide({ ...base, stretch: 15, startDate: '2026-12-30' });
  assert.equal(long.outcome === 'reject' && long.code, 'too_long');
  // short notice is checked before a full day
  assert.equal((decide({ ...base, startDate: '2026-11-11', fullHalves: [{ day: '2026-11-11', half: 'first', count: 3, limit: 3 }] }) as { code: string }).code, 'short_notice');
});
test('decision: levels', () => {
  const lvl = (o: object) => { const d = decide({ ...base, ...o }); return d.outcome === 'route' ? d.level : d.outcome; };
  assert.equal(lvl({ stretch: 2 }), 'auto_approve');          // up to threshold 1
  assert.equal(lvl({ stretch: 3, startDate: '2026-11-25' }), 'tl');
  assert.equal(lvl({ stretch: 8, startDate: '2026-12-10' }), 'admin');   // above threshold 2
  assert.equal(lvl({ stretch: 3, startDate: '2026-11-25', applicantHasTl: false }), 'admin'); // a TL or QA reports to an admin
  assert.equal(lvl({ lop: 1, leave: 0, stretch: 1 }), 'tl');  // LOP always needs a person
  assert.equal(lvl({ lop: 1, leave: 0, stretch: 1, applicantHasTl: false }), 'admin');
  assert.equal(lvl({ startDate: '2026-11-10', rules: { ...R, b1Days: 0, b2Days: 0, b3Days: 0 } }), 'admin'); // the leave day counts as after the date
  assert.equal(levelForStretch(2, R, true), null); assert.equal(levelForStretch(7, R, true), 'tl'); assert.equal(levelForStretch(8, R, true), 'admin');
});
test('decision: a pure LOP request has no notice check but still needs a person', () => {
  const d = decide({ ...base, leave: 0, lop: 1, startDate: '2026-11-11' }); // 1 day notice, band needs 2
  assert.equal(d.outcome, 'route');
});

test('approver actions: TL approves only what stays at TL level; admin anything; nobody their own', () => {
  const w = { applicantUserId: 10, withLevel: 'tl' as const, sentToTl: false, fullDay: false, stretch: 3, startDate: '2026-11-25', today: '2026-11-10', lop: 0 };
  const tl = { userId: 2, role: 'tl', isTlOfApplicant: true };
  assert.deepEqual(actionsFor(tl, w, R, true), { approve: true, reject: true, forward: true, approveBlockedWhy: undefined });
  assert.match(actionsFor(tl, { ...w, fullDay: true }, R, true).approveBlockedWhy!, /Limit crossed/);
  assert.match(actionsFor(tl, { ...w, sentToTl: true }, R, true).approveBlockedWhy!, /Only an admin/);
  assert.match(actionsFor(tl, { ...w, stretch: 9 }, R, true).approveBlockedWhy!, /needs an admin/);
  assert.match(actionsFor(tl, { ...w, startDate: '2026-11-10' }, R, true).approveBlockedWhy!, /needs an admin/);
  assert.deepEqual(actionsFor({ ...tl, isTlOfApplicant: false }, w, R, true), { approve: false, reject: false, forward: false });
  assert.deepEqual(actionsFor({ userId: 10, role: 'admin', isTlOfApplicant: false }, w, R, true), { approve: false, reject: false, forward: false }); // not your own
  const admin = actionsFor({ userId: 1, role: 'admin', isTlOfApplicant: false }, { ...w, fullDay: true }, R, true);
  assert.deepEqual([admin.approve, admin.reject, admin.forward, admin.needsOverLimitOk], [true, true, false, true]);
});

test('11:59 pm IST deadline is a real instant', () => {
  assert.equal(endOfDayIST('2026-11-11').toISOString(), '2026-11-11T18:29:00.000Z');
});
