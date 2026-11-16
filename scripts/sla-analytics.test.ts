import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSla, isClosedTicket, isIgnoredStatus, parseSlaRange, SLA_ANALYTICS_START, type SlaEmailRow } from '../lib/sla-analytics';

const H = 3600_000;
const NOW = new Date('2026-11-10T12:00:00Z');
const at = (hoursAgo: number) => new Date(NOW.getTime() - hoursAgo * H);
let n = 0;
const row = (o: Partial<SlaEmailRow> & { customerHoursAgo: number; replyAfterHours?: number | null; noteAfterHours?: number | null }): SlaEmailRow => {
  const customer = at(o.customerHoursAgo);
  return {
    chat_id: `c${++n}`, ticket_id: `t${n}`, customer_at: customer,
    replied_at: o.replyAfterHours == null ? null : new Date(customer.getTime() + o.replyAfterHours * H),
    noted_at: o.noteAfterHours == null ? null : new Date(customer.getTime() + o.noteAfterHours * H),
    robylon_status: 'robylon_status' in o ? o.robylon_status! : 'Answered', ticket_status: o.ticket_status ?? 'OPEN',
  };
};

test('reply inside 24h is fine, reply after 24h is a breach with the hours late', () => {
  const { summary, breaches } = analyzeSla([
    row({ customerHoursAgo: 100, replyAfterHours: 23.9 }),
    row({ customerHoursAgo: 100, replyAfterHours: 24 }),        // exactly 24h still meets the SLA
    row({ customerHoursAgo: 100, replyAfterHours: 30 }),
  ], NOW);
  assert.equal(summary.emailsReceived, 3);
  assert.equal(summary.breaches, 1);
  assert.equal(summary.lateReplies, 1);
  assert.equal(breaches[0].hoursLate, 6);
  assert.equal(summary.repliedWithinPct, 66.7);
});

test('no reply: a breach only once 24h have passed; before that it is not judged', () => {
  const { summary, breaches } = analyzeSla([
    row({ customerHoursAgo: 30, robylon_status: 'Customer reponded' }),   // 6h overdue
    row({ customerHoursAgo: 10, robylon_status: 'Customer reponded' }),   // still inside 24h
  ], NOW);
  assert.equal(summary.emailsReceived, 2);
  assert.equal(summary.breaches, 1);
  assert.equal(summary.unansweredPast24h, 1);
  assert.equal(breaches[0].repliedAt, null);
  assert.equal(breaches[0].hoursLate, 6);
  assert.equal(summary.repliedWithinPct, 0);   // the in-window one is not in the denominator
});

test('closed after customer responded: left out by default, included (and labelled) when asked', () => {
  const rows = [
    row({ customerHoursAgo: 50, robylon_status: 'CLOSED' }),                          // closed, never replied: "thanks"
    row({ customerHoursAgo: 50, robylon_status: null, ticket_status: 'RESOLVED' }),   // same, no status event
    row({ customerHoursAgo: 50, replyAfterHours: 40, robylon_status: 'CLOSED' }),     // closed but replied late: a real breach either way
  ];
  const off = analyzeSla(rows, NOW);
  assert.equal(off.summary.emailsReceived, 1);
  assert.equal(off.summary.breaches, 1);
  const on = analyzeSla(rows, NOW, { includeClosedUnreplied: true });
  assert.equal(on.summary.emailsReceived, 3);
  assert.equal(on.summary.breaches, 3);
  assert.equal(on.breaches.filter(b => b.closedAfterCustomer).length, 2);
  assert.equal(on.summary.unansweredPast24h, 0, 'closed tickets are not "waiting"');
});

test('ignored statuses are left out completely', () => {
  for (const status of ['Repayment', 'Repayment External Dependency', 'Hold', 'WAITING_ON_AGENT', 'Entity Escalation', ' hold ']) {
    assert.equal(isIgnoredStatus(status), true, status);
    assert.equal(analyzeSla([row({ customerHoursAgo: 60, robylon_status: status })], NOW).summary.emailsReceived, 0, status);
  }
  for (const status of ['OPEN', 'PENDING', 'Answered', 'Pending email sent', 'Customer reponded', 'Internal Dependency', 'External Dependency', null]) {
    assert.equal(isIgnoredStatus(status), false, String(status));
  }
});

test('TAT average and median; medians of an even count average the middle two', () => {
  const { summary } = analyzeSla([
    row({ customerHoursAgo: 100, replyAfterHours: 1 }),
    row({ customerHoursAgo: 100, replyAfterHours: 2 }),
    row({ customerHoursAgo: 100, replyAfterHours: 3 }),
    row({ customerHoursAgo: 100, replyAfterHours: 10 }),
  ], NOW);
  assert.equal(summary.avgTatHours, 4);
  assert.equal(summary.medianTatHours, 2.5);
  assert.deepEqual(analyzeSla([], NOW).summary, {
    emailsReceived: 0, repliedWithinPct: null, breaches: 0, lateReplies: 0, avgTatHours: null, medianTatHours: null, unansweredPast24h: 0,
  });
});

test('breaches are listed worst first', () => {
  const { breaches } = analyzeSla([
    row({ customerHoursAgo: 100, replyAfterHours: 26 }),
    row({ customerHoursAgo: 100, replyAfterHours: 60 }),
    row({ customerHoursAgo: 40, robylon_status: 'OPEN' }),
  ], NOW);
  assert.deepEqual(breaches.map(b => b.hoursLate), [36, 16, 2]);
});

test('closed detection: the latest Robylon status wins over the stale table status', () => {
  assert.equal(isClosedTicket({ robylon_status: 'Answered', ticket_status: 'CLOSED' }), false);
  assert.equal(isClosedTicket({ robylon_status: 'CLOSED', ticket_status: 'OPEN' }), true);
  assert.equal(isClosedTicket({ robylon_status: null, ticket_status: 'Resolved' }), true);
  assert.equal(isClosedTicket({ robylon_status: null, ticket_status: 'OPEN' }), false);
});

test('date range: IST days, never before 1 Oct, defaults to the last 7 days', () => {
  const r = parseSlaRange('2026-10-05', '2026-10-07', NOW);
  assert.equal(r.from.toISOString(), '2026-10-04T18:30:00.000Z');
  assert.equal(r.to.toISOString(), '2026-10-07T18:30:00.000Z');          // end of 7 Oct IST
  assert.equal(parseSlaRange('2026-09-01', '2026-10-07', NOW).from.getTime(), SLA_ANALYTICS_START.getTime());
  const d = parseSlaRange(null, null, NOW);
  assert.ok(d.to.getTime() > NOW.getTime() && d.to.getTime() - d.from.getTime() >= 7 * 24 * H);
  assert.equal(parseSlaRange('nonsense', '2026-10-07', NOW).from.getTime() < r.to.getTime(), true);
});

test('an internal note is not a reply: still a breach, but the list says a note was added', () => {
  const { summary, breaches } = analyzeSla([
    row({ customerHoursAgo: 60, noteAfterHours: 3, robylon_status: 'PENDING' }),   // noted, never replied
    row({ customerHoursAgo: 60, robylon_status: 'PENDING' }),                      // nothing at all
    row({ customerHoursAgo: 60, replyAfterHours: 30, noteAfterHours: 2 }),         // replied late; the note is irrelevant
  ], NOW);
  assert.equal(summary.breaches, 3);
  const noted = breaches.filter(b => b.noteAt);
  assert.equal(noted.length, 1);
  assert.equal(noted[0].repliedAt, null);
  assert.equal(noted[0].noteAt, new Date(NOW.getTime() - 57 * H).toISOString());
  assert.equal(breaches.find(b => b.repliedAt)!.noteAt, null);
});

test('unanswered rows carry the data check; replied rows do not', () => {
  const base = row({ customerHoursAgo: 60, robylon_status: 'Customer reponded' });
  const { breaches } = analyzeSla([
    { ...base, last_event_at: new Date(NOW.getTime() - 50 * H), missing_agent_messages: 1 },
    row({ customerHoursAgo: 60, replyAfterHours: 30 }),
  ], NOW);
  const open = breaches.find(b => !b.repliedAt)!;
  assert.equal(open.missingAgentMessages, 1);
  assert.equal(open.lastEventAt, new Date(NOW.getTime() - 50 * H).toISOString());
  const late = breaches.find(b => b.repliedAt)!;
  assert.equal(late.missingAgentMessages, 0);
  assert.equal(late.lastEventAt, null);
});
