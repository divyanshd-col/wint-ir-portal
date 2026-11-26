import test from 'node:test';
import assert from 'node:assert/strict';
import { activeKey, asPortalRole, hrmsMenu, isHrmsPath } from '../components/hrms/nav';
import { dayW, fr, halfLabel, nd, payrollOf, payrollSpan } from '../components/hrms/leave/format';
import { nextCreditDate, payrollWindow } from '../lib/leave-views';

const flat = (role: string, skills?: string[]) => hrmsMenu(role, skills).flatMap(s => s.items.map(i => `${s.group}/${i.label}${i.scope ? ` (${i.scope})` : ''}`));

test('an agent with only the leave skill gets the three Me screens, and nothing else', () => {
  assert.deepEqual(flat('agent', ['leave:use:access']), ['Me/Home', 'Me/My requests', 'Me/Statement']);
});
test('no leave or roster skill means no HRMS menu at all', () => {
  assert.deepEqual(hrmsMenu('agent', []), []);
  assert.deepEqual(hrmsMenu('agent', undefined).length, 0);
});
test('the Roster item follows the roster skill and says how much of it the person sees', () => {
  assert.deepEqual(flat('agent', ['leave:use:access', 'roster:view:access']), ['Me/Home', 'Me/My requests', 'Me/Statement', 'Team/Roster (View)']);
  assert.ok(flat('quality', ['leave:use:access', 'roster:view:access']).includes('Team/Roster (View)'));
});
test('a team lead sees Approvals and their own team on Roster', () => {
  const m = flat('tl', ['leave:use:access', 'leave:approve:access', 'roster:view:access']);
  assert.deepEqual(m, ['Me/Home', 'Me/My requests', 'Me/Statement', 'Team/Approvals', 'Team/Roster (Own team)']);
});
test('an admin (the Manager, and HR) has no My requests or Statement, and sees everyone on Roster (Manager home is not built yet, so no Home item)', () => {
  assert.deepEqual(flat('admin', []), ['Team/Approvals', 'Team/Roster (Everyone)']);
});
test('unknown roles fall back to agent', () => {
  assert.equal(asPortalRole('sr_tl'), 'agent');
  assert.equal(asPortalRole(undefined), 'agent');
  assert.equal(asPortalRole('tl'), 'tl');
  assert.equal(asPortalRole('admin'), 'admin');
  assert.equal(asPortalRole('quality'), 'quality');
});

test('activeKey picks the menu item a page belongs to', () => {
  assert.equal(activeKey('/leave'), 'home');
  assert.equal(activeKey('/leave/requests'), 'my-requests');
  assert.equal(activeKey('/leave/requests/anything'), 'my-requests');
  assert.equal(activeKey('/leave/statement'), 'statement');
  assert.equal(activeKey('/leave/approvals'), 'approvals');
  assert.equal(activeKey('/roster'), 'roster');
  assert.equal(activeKey('/leave/not-a-page'), null);
  assert.equal(activeKey('/chat'), null);
  assert.equal(activeKey('/leaves'), null);
});
test('only /leave and /roster (and below) are the HRMS', () => {
  for (const p of ['/leave', '/leave/requests', '/roster', '/roster/x']) assert.equal(isHrmsPath(p), true, p);
  for (const p of ['/', '/chat', '/leaves', '/rostering', '/quality', '/settings']) assert.equal(isHrmsPath(p), false, p);
});

test('payroll month: 25th to 24th, named after the month it ends in', () => {
  assert.equal(payrollOf('2026-11-24').label, 'Nov 2026');
  assert.equal(payrollOf('2026-11-25').label, 'Dec 2026');
  assert.equal(payrollOf('2026-10-25').label, 'Nov 2026');
  assert.equal(payrollOf('2026-12-25').label, 'Jan 2027');
  assert.equal(payrollOf('2026-12-31').key, '2027-01');
  assert.equal(payrollOf('2027-01-01').label, 'Jan 2027');
  assert.equal(payrollSpan('2026-11'), '25 Oct – 24 Nov');
  assert.equal(payrollSpan('2027-01'), '25 Dec – 24 Jan');
});
test('payroll window and next credit date agree with the same rule', () => {
  assert.deepEqual(payrollWindow('2026-11-26'), { from: '2026-11-25', to: '2026-12-24', label: '25 Nov – 24 Dec 2026' });
  assert.deepEqual(payrollWindow('2026-11-24'), { from: '2026-10-25', to: '2026-11-24', label: '25 Oct – 24 Nov 2026' });
  assert.deepEqual(payrollWindow('2027-01-03'), { from: '2026-12-25', to: '2027-01-24', label: '25 Dec – 24 Jan 2027' });
  assert.equal(nextCreditDate('2026-11-26'), '2026-12-01');
  assert.equal(nextCreditDate('2026-12-31'), '2027-01-01');
  assert.equal(nextCreditDate('2026-12-01'), '2027-01-01');
  // the window a day belongs to ends in the same month payrollOf names
  for (const d of ['2026-11-24', '2026-11-25', '2026-12-31', '2027-01-24', '2027-01-25']) assert.equal(payrollOf(d).key, payrollWindow(d).to.slice(0, 7), d);
});

test('wording helpers match the prototype', () => {
  assert.equal(fr('2026-12-07', '2026-12-07'), 'Mon, 7 Dec 2026');
  assert.equal(fr('2026-12-07', '2026-12-10'), 'Mon, 7 Dec 2026 – Thu, 10 Dec 2026');
  assert.equal(dayW(1), '1 day'); assert.equal(dayW(0.5), '0.5 days'); assert.equal(dayW(2.25), '2.25 days');
  assert.equal(nd(1.5), '1.5'); assert.equal(nd(-2), '−2');
  assert.equal(halfLabel('2026-12-07', '2026-12-07', 'full', 'full'), 'Full day');
  assert.equal(halfLabel('2026-12-07', '2026-12-07', 'first', 'first'), 'First half');
  assert.equal(halfLabel('2026-12-07', '2026-12-09', 'second', 'first'), 'Starts second half, ends first half');
  assert.equal(halfLabel('2026-12-07', '2026-12-09', 'full', 'full'), 'Full days');
});
