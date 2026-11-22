import test from 'node:test';
import assert from 'node:assert/strict';
import { getSlaWindow } from '../lib/sla-breach';

const iso = (d: Date) => d.toISOString();

test('getSlaWindow trigger 1 - 10:00-19:00 IST of the same IST day', () => {
  // 2026-10-01 04:15 UTC = 09:45 IST
  const w = getSlaWindow(new Date('2026-10-01T04:15:00Z'), 1);
  assert.equal(iso(w.windowStart), '2026-10-01T04:30:00.000Z'); // 10:00 IST
  assert.equal(iso(w.windowEnd), '2026-10-01T13:30:00.000Z'); // 19:00 IST
});

test('getSlaWindow trigger 2 - 19:00 IST today to 11:30 IST tomorrow', () => {
  // 2026-10-01 09:30 UTC = 15:00 IST
  const w = getSlaWindow(new Date('2026-10-01T09:30:00Z'), 2);
  assert.equal(iso(w.windowStart), '2026-10-01T13:30:00.000Z'); // 19:00 IST
  assert.equal(iso(w.windowEnd), '2026-10-02T06:00:00.000Z'); // 11:30 IST next day
});

test('getSlaWindow uses the IST date, not the UTC date, after 18:30 UTC', () => {
  // 2026-10-01 20:00 UTC = 2026-10-02 01:30 IST -> IST day is Oct 2
  const w = getSlaWindow(new Date('2026-10-01T20:00:00Z'), 1);
  assert.equal(iso(w.windowStart), '2026-10-02T04:30:00.000Z');
  assert.equal(iso(w.windowEnd), '2026-10-02T13:30:00.000Z');
});

test('getSlaWindow uses the IST date just before IST midnight', () => {
  // 2026-10-01 18:29 UTC = 23:59 IST Oct 1
  const w = getSlaWindow(new Date('2026-10-01T18:29:00Z'), 2);
  assert.equal(iso(w.windowStart), '2026-10-01T13:30:00.000Z');
  assert.equal(iso(w.windowEnd), '2026-10-02T06:00:00.000Z');
});

// ---- Step 2: filter logic (mirrors the production SQL) ----
import { findBreachingTickets, isInScopeStatus, isAgentActionStatus, type EmailTicketRow, type BreachingTicket } from '../lib/sla-breach';

const d = (iso: string) => new Date(iso);
const row = (o: Partial<EmailTicketRow>): EmailTicketRow => ({
  id: 't', chat_id: 'c', customer_email: 'a@example.com', customer_phone: '',
  created_at: d('2026-09-30T05:00:00Z'), first_response_at: null, intent_l1: null,
  has_events: true, has_incoming_message: false, robylon_status: null,
  last_customer_message_at: null, last_agent_message_at: null, last_agent_status_at: null, ...o,
});
// Cron trigger 1 runs 09:45 IST = 04:15Z on 2026-10-01; its window is 04:30Z .. 13:30Z. Breach = customer's last message + 24h.
const CRON1 = d('2026-10-01T04:15:00Z');
const W1 = getSlaWindow(CRON1, 1);
const find = (rows: EmailTicketRow[]) => findBreachingTickets(rows, W1, CRON1);
const ids = (rows: BreachingTicket[]) => rows.map((x) => x.chat_id);

test('findBreachingTickets includes a ticket breaching inside the window (upcoming, not overdue)', () => {
  const r = find([row({ chat_id: 'in', created_at: d('2026-09-30T08:00:00Z') })]);
  assert.deepEqual(ids(r), ['in']);
  assert.equal(r[0].sla_breach_time.toISOString(), '2026-10-01T08:00:00.000Z');
  assert.equal(r[0].overdue, false);
});

test('findBreachingTickets excludes upcoming tickets just outside the window', () => {
  assert.deepEqual(find([
    row({ chat_id: 'before', created_at: d('2026-09-30T04:29:59Z') }), // breach 04:29:59Z: after the cron ran, before the window
    row({ chat_id: 'after', created_at: d('2026-09-30T13:30:01Z') }),  // breach 13:30:01Z
  ]), []);
});

test('findBreachingTickets lists tickets already past 24h as overdue, first, whatever the window', () => {
  const r = find([
    row({ chat_id: 'upcoming', created_at: d('2026-09-30T08:00:00Z') }),
    row({ chat_id: 'overdue-2d', created_at: d('2026-09-28T08:00:00Z') }),
    row({ chat_id: 'overdue-1h', created_at: d('2026-09-30T03:00:00Z') }),
  ]);
  assert.deepEqual(ids(r), ['overdue-2d', 'overdue-1h', 'upcoming']);
  assert.deepEqual(r.map((x) => x.overdue), [true, true, false]);
});

test('findBreachingTickets - an agent reply after the customer message means no flag', () => {
  assert.deepEqual(find([
    row({ chat_id: 'replied', created_at: d('2026-09-30T08:00:00Z'), last_agent_message_at: d('2026-09-30T09:00:00Z') }),
    row({ chat_id: 'replied-late', created_at: d('2026-09-27T08:00:00Z'), last_agent_message_at: d('2026-09-30T09:00:00Z') }), // reply was past 24h, still answered
    row({ chat_id: 'first-response', created_at: d('2026-09-28T08:00:00Z'), first_response_at: d('2026-09-28T09:00:00Z') }),
  ]), []);
});

test('findBreachingTickets - a customer message after the agent reply restarts the clock from that message', () => {
  const r = find([row({
    chat_id: 'again', created_at: d('2026-09-20T00:00:00Z'), last_agent_message_at: d('2026-09-20T01:00:00Z'),
    last_customer_message_at: d('2026-09-30T09:00:00Z'),
  })]);
  assert.deepEqual(ids(r), ['again']);
  assert.equal(r[0].user_last_replied_at.toISOString(), '2026-09-30T09:00:00.000Z');
});

test('findBreachingTickets - Answered / Pending email sent: not flagged if the agent acted last, flagged if the customer wrote after (safeguard)', () => {
  for (const status of ['Answered', 'Pending email sent']) {
    assert.deepEqual(find([row({ chat_id: 'quiet', robylon_status: status, created_at: d('2026-09-29T08:00:00Z'), last_agent_status_at: d('2026-09-29T10:00:00Z') })]), [], status);
    const r = find([row({
      chat_id: 'stuck', robylon_status: status, created_at: d('2026-09-29T08:00:00Z'),
      last_agent_status_at: d('2026-09-29T10:00:00Z'), last_customer_message_at: d('2026-09-30T09:00:00Z'), // customer replied, Robylon never moved it
    })]);
    assert.deepEqual(ids(r), ['stuck'], status);
    assert.equal(r[0].user_last_replied_at.toISOString(), '2026-09-30T09:00:00.000Z');
  }
});

test('isInScopeStatus - Open, PENDING, Customer responded (either spelling), Pending email sent, Answered and both dependencies', () => {
  for (const s of ['OPEN', 'PENDING', 'Customer reponded', 'Customer responded', 'Pending email sent', 'Answered', 'Internal Dependency', 'External Dependency', '  answered '])
    assert.equal(isInScopeStatus(s), true, s);
  for (const s of ['WAITING_ON_AGENT', 'Hold', 'Entity Escalation', 'Repayment', 'Repayment External Dependency', 'CLOSED', 'RESOLVED', '', null, undefined])
    assert.equal(isInScopeStatus(s as string | null | undefined), false, String(s));
});

test('isAgentActionStatus - only Answered and Pending email sent', () => {
  assert.equal(isAgentActionStatus('Answered'), true);
  assert.equal(isAgentActionStatus('pending email sent'), true);
  for (const s of ['PENDING', 'OPEN', 'Customer reponded', null]) assert.equal(isAgentActionStatus(s as string | null), false, String(s));
});

test('findBreachingTickets - skips out-of-scope Robylon statuses, keeps in-scope ones', () => {
  const t = d('2026-09-30T09:00:00Z');
  const r = find([
    ...['WAITING_ON_AGENT', 'Hold', 'Entity Escalation', 'Repayment', 'Repayment External Dependency', 'CLOSED'].map((s) => row({ chat_id: `out-${s}`, robylon_status: s, created_at: t })),
    ...['PENDING', 'Customer reponded', 'Internal Dependency', 'External Dependency', 'OPEN', null].map((s) => row({ chat_id: `in-${s}`, robylon_status: s, created_at: t })),
  ]);
  assert.deepEqual(ids(r).sort(), ['in-Customer reponded', 'in-External Dependency', 'in-Internal Dependency', 'in-OPEN', 'in-PENDING', 'in-null']);
});

test('findBreachingTickets - a ticket started by a Wint sender has no customer waiting, even though created_at is a moment after the mail', () => {
  assert.deepEqual(find([row({
    chat_id: 'internal', created_at: d('2026-09-30T08:00:00.537Z'), has_incoming_message: true,
    last_customer_message_at: null, last_agent_message_at: d('2026-09-30T08:00:00.000Z'),
  })]), []);
});

test('findBreachingTickets - the customer clock is the newest customer message; created_at only when no incoming message is stored', () => {
  const withMsg = find([row({ chat_id: 'm', created_at: d('2026-09-20T00:00:00Z'), has_incoming_message: true, last_customer_message_at: d('2026-09-30T09:00:00Z') })]);
  assert.equal(withMsg[0].user_last_replied_at.toISOString(), '2026-09-30T09:00:00.000Z');
  const noMsg = find([row({ chat_id: 'n', created_at: d('2026-09-30T09:00:00Z'), has_incoming_message: false })]);
  assert.equal(noMsg[0].user_last_replied_at.toISOString(), '2026-09-30T09:00:00.000Z');
});

test('findBreachingTickets - a Portal ticket (we sent the first email) has no customer waiting until the customer replies', () => {
  // ticket 200528: created from the Portal, only our mail, status PENDING, no incoming message
  const portal = row({ chat_id: 'portal', created_at: d('2026-09-30T05:00:00Z'), ticket_source: 'Portal', robylon_status: 'PENDING', has_incoming_message: false });
  assert.deepEqual(find([portal]), []);
  // the customer replies: the clock starts at their message
  const replied = find([{ ...portal, chat_id: 'replied', has_incoming_message: true, last_customer_message_at: d('2026-09-30T09:00:00Z') }]);
  assert.equal(replied[0].user_last_replied_at.toISOString(), '2026-09-30T09:00:00.000Z');
  // an Email-sourced ticket with no stored message still falls back to created_at
  assert.equal(find([row({ chat_id: 'email', ticket_source: 'Email', created_at: d('2026-09-30T09:00:00Z') })]).length, 1);
});

test('findBreachingTickets - skips tickets with no stored events at all (cannot tell who spoke last)', () => {
  assert.deepEqual(find([row({ chat_id: 'old', has_events: false, created_at: d('2026-09-30T08:00:00Z') })]), []);
});

test('findBreachingTickets sorts by breach time ascending', () => {
  const r = find([
    row({ chat_id: 'late', created_at: d('2026-09-30T12:00:00Z') }),
    row({ chat_id: 'early', created_at: d('2026-09-30T05:00:00Z') }),
  ]);
  assert.deepEqual(ids(r), ['early', 'late']);
});

// ---- Step 3: Slack payload (no network) ----
import { buildSlackPayload, formatMentions, formatBreachesIn, formatBreachesAt, cleanIntent } from '../lib/sla-breach';

const NOW = new Date('2026-10-01T10:51:00Z'); // 16:21 IST
const mk = () => findBreachingTickets([
  row({ chat_id: '111', customer_email: 'secret@example.com', intent_l1: 'KYC', created_at: new Date('2026-09-30T13:34:00Z') }), // breach 13:34Z = 19:04 IST, 2h43m away
  row({ chat_id: '222', created_at: new Date('2026-09-30T20:00:00Z') }), // breach next day 20:00Z - 1d9h09m away
], { windowStart: new Date('2026-10-01T00:00:00Z'), windowEnd: new Date('2026-10-03T00:00:00Z') }, NOW);

test('formatBreachesIn - hours and minutes, days when long, "overdue <how long>" when past', () => {
  assert.equal(formatBreachesIn(new Date('2026-10-01T13:34:00Z'), NOW), '2h 43m');
  assert.equal(formatBreachesIn(new Date('2026-10-01T10:59:00Z'), NOW), '8m');
  assert.equal(formatBreachesIn(new Date('2026-10-02T20:00:00Z'), NOW), '1d 9h');
  assert.equal(formatBreachesIn(new Date('2026-10-01T10:00:00Z'), NOW), 'overdue 51m');
  assert.equal(formatBreachesIn(new Date('2026-09-29T20:00:00Z'), NOW), 'overdue 1d 14h');
  assert.equal(formatBreachesIn(new Date('2026-10-01T10:51:00Z'), NOW), 'overdue');
});

test('formatBreachesAt - IST, 12-hour, day and month', () => {
  assert.equal(formatBreachesAt(new Date('2026-10-01T13:34:00Z')), '1 Oct, 7:04 PM');
  assert.equal(formatBreachesAt(new Date('2026-10-01T20:00:00Z')), '2 Oct, 1:30 AM'); // crosses IST midnight
  assert.equal(formatBreachesAt(new Date('2026-10-02T06:00:00Z')), '2 Oct, 11:30 AM');
});

test('formatMentions - subteam, user ids, and plain-text fallback', () => {
  assert.equal(formatMentions('S01ABC,U02DEF'), '<!subteam^S01ABC> <@U02DEF>');
  assert.equal(formatMentions(undefined), '@cx_tl @email');
  assert.equal(formatMentions('  '), '@cx_tl @email');
});

test('buildSlackPayload - zero rows: no-breach text, no mentions, no table', () => {
  const p = buildSlackPayload([], '10 AM to 7 PM today', NOW, '<!subteam^S1>');
  assert.match(p.text, /No overdue tickets and no SLA breaches expected in the 10 AM to 7 PM today window/);
  assert.ok(!p.text.includes('S1'));
  assert.ok(!(p.blocks ?? []).some((b: any) => b.type === 'table'));
});

test('buildSlackPayload - mentions + ticket table with the 3 columns, no email, "Ticket" not "Chat"', () => {
  const p = buildSlackPayload(mk(), 'w', NOW, '<!subteam^S1> <!subteam^S2>');
  assert.ok(p.text.includes('<!subteam^S1> <!subteam^S2>'));
  assert.match(p.text, /2 breaching in the w window/);
  assert.ok(!/overdue/.test(p.text));
  const json = JSON.stringify(p);
  assert.ok(!json.includes('secret@example.com') && !json.includes('@example.com'));
  assert.ok(!/Chat \d/.test(json));
  const table: any = p.blocks!.find((b: any) => b.type === 'table');
  assert.ok(table);
  const [header, r1, r2] = table.rows;
  assert.deepEqual(header.map((c: any) => c.text), ['Ticket ID', 'Category', 'Breaches in', 'Breaches at', 'Open ticket']);
  assert.equal(r1[0].text, '111');
  assert.equal(r1[1].text, 'KYC');
  assert.equal(r2[1].text, '—'); // no intent yet
  assert.equal(r1[2].text, '2h 43m');
  assert.equal(r1[3].text, '1 Oct, 7:04 PM'); // 13:34Z = 19:04 IST
  assert.equal(r2[0].text, '222');
  const link = r1[4].elements[0].elements[0];
  assert.equal(link.type, 'link');
  assert.equal(link.url, 'https://app.robylon.ai/unified-inbox/share/111');
  assert.equal(link.text, 'Open ticket');
});

test('buildSlackPayload - caps the table at 99 data rows and says so', () => {
  const many = Array.from({ length: 120 }, (_, i) => ({ ...mk()[0], chat_id: String(1000 + i) }));
  const p = buildSlackPayload(many, 'w', NOW, '@x');
  const table: any = p.blocks!.find((b: any) => b.type === 'table');
  assert.equal(table.rows.length, 100); // header + 99
  assert.match(JSON.stringify(p), /21 more/);
});

// ---- Step 4: route auth (DB must never be touched on 401) ----
import { runSlaBreachCron } from '../lib/sla-breach';
import { NextRequest } from 'next/server';

function deps() {
  const calls = { fetch: 0, post: [] as string[] };
  return {
    calls,
    d: {
      secret: 'shh',
      now: new Date('2026-10-01T04:15:00Z'),
      fetchOpenTickets: async () => { calls.fetch++; return [] as EmailTicketRow[]; },
      post: async (p: { text: string }) => { calls.post.push(p.text); },
    },
  };
}

test('runSlaBreachCron - wrong or missing bearer returns 401 and never touches the DB', async () => {
  for (const auth of [null, 'Bearer nope', 'shh']) {
    const { calls, d } = deps();
    const res = await runSlaBreachCron({ ...d, authHeader: auth, trigger: '1' });
    assert.equal(res.status, 401);
    assert.equal(calls.fetch, 0);
    assert.equal(calls.post.length, 0);
  }
});

test('runSlaBreachCron - unset CRON_SECRET fails closed', async () => {
  const { calls, d } = deps();
  const res = await runSlaBreachCron({ ...d, secret: undefined, authHeader: 'Bearer undefined', trigger: '1' });
  assert.equal(res.status, 401);
  assert.equal(calls.fetch, 0);
});

test('runSlaBreachCron - valid bearer fetches, posts, returns count', async () => {
  const { calls, d } = deps();
  const res = await runSlaBreachCron({ ...d, authHeader: 'Bearer shh', trigger: '2' });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true, count: 0, excluded: 0 });
  assert.equal(calls.fetch, 1);
  assert.equal(calls.post.length, 1);
});

test('runSlaBreachCron - invalid trigger is a 400', async () => {
  const { d } = deps();
  const res = await runSlaBreachCron({ ...d, authHeader: 'Bearer shh', trigger: '9' });
  assert.equal(res.status, 400);
});

test('GET /api/cron/sla-breach without bearer returns 401', async () => {
  process.env.SLA_CRON_SECRET = 'shh';
  const { GET } = await import('../app/api/cron/sla-breach/route');
  const res = await GET(new NextRequest('http://localhost/api/cron/sla-breach?trigger=1'));
  assert.equal(res.status, 401);
});

// ---- Automated-sender filter ----
import { isAutomatedSender, splitAutomated } from '../lib/sla-breach';

test('isAutomatedSender - flags noreply-style and notification senders', () => {
  for (const e of [
    'noreply@example.com', 'no-reply@accounts.google.com', 'NoReply@Example.com', 'donotreply@bank.com',
    'do-not-reply@x.com', 'noreply-apps-scripts-notifications@google.com', 'testflight_no_reply@email.apple.com',
    'recommendations@discover.pinterest.com', 'notifications@github.com', 'mailer-daemon@x.com', 'noreply-1234@example.com',
  ]) assert.equal(isAutomatedSender(e), true, e);
});

test('isAutomatedSender - keeps real customers and company support addresses', () => {
  for (const e of ['ravi@gmail.com', 'replyguy@gmail.com', 'care@cashfree.com', 'support@setu.co', 'user162515@example.com', '', null, undefined])
    assert.equal(isAutomatedSender(e as string | null | undefined), false, String(e));
});

test('splitAutomated - separates humans from automated and counts the latter', () => {
  const t = (email: string) => ({ ...mk()[0], customer_email: email });
  const { human, automatedCount } = splitAutomated([t('a@gmail.com'), t('noreply@x.com'), t('b@gmail.com'), t('no-reply@y.com')]);
  assert.deepEqual(human.map((r) => r.customer_email), ['a@gmail.com', 'b@gmail.com']);
  assert.equal(automatedCount, 2);
});

test('buildSlackPayload - notes how many automated tickets were excluded', () => {
  const p = buildSlackPayload(mk(), 'w', NOW, '@x', 3);
  assert.match(p.text, /3 automated sender\(s\) excluded/);
});

test('buildSlackPayload - zero human rows but some excluded still says so, with no mentions', () => {
  const p = buildSlackPayload([], 'w', NOW, '<!subteam^S1>', 2);
  assert.match(p.text, /No overdue tickets and no SLA breaches expected/);
  assert.match(p.text, /2 automated sender\(s\) excluded/);
  assert.ok(!p.text.includes('S1'));
});

test('runSlaBreachCron - drops automated senders from the alert and reports the count', async () => {
  const { d } = deps();
  const posted: string[] = [];
  const t = (chat: string, email: string) => row({ chat_id: chat, customer_email: email, created_at: new Date('2026-09-30T08:00:00Z') });
  const res = await runSlaBreachCron({
    ...d, authHeader: 'Bearer shh', trigger: '1',
    fetchOpenTickets: async () => [t('900', 'real@gmail.com'), t('901', 'noreply@x.com')],
    post: async (p) => { posted.push(JSON.stringify(p)); },
  });
  assert.deepEqual(res.body, { ok: true, count: 1, excluded: 1 });
  assert.ok(posted[0].includes('900') && !posted[0].includes('901'));
});

// ---- L1 intent ----
test('cleanIntent - keeps names, drops empty, "None" and raw ids', () => {
  assert.equal(cleanIntent('KYC'), 'KYC');
  assert.equal(cleanIntent('  Interest Repayment '), 'Interest Repayment');
  for (const v of [null, undefined, '', '  ', 'None', 'none', 'a34fb658-285d-450e-951e-b804c98cfff1']) assert.equal(cleanIntent(v), null, String(v));
});

test('findBreachingTickets - carries the L1 intent through', () => {
  const r = find([row({ chat_id: 'x', intent_l1: 'Taxation', created_at: new Date('2026-09-30T08:00:00Z') })]);
  assert.equal(r[0].intent_l1, 'Taxation');
});

// ---- Slack: overdue wording ----
import { isStaffEmail } from '../lib/sla-breach';

test('isStaffEmail - only the @wintwealth.com domain, any case', () => {
  assert.equal(isStaffEmail('hello@wintwealth.com'), true);
  assert.equal(isStaffEmail('Sneha@WintWealth.com'), true);
  for (const e of ['ritik486@gmail.com', 'x@notwintwealth.com', 'wintwealth.com@gmail.com', '', null, undefined])
    assert.equal(isStaffEmail(e as string | null | undefined), false, String(e));
});

test('buildSlackPayload - header separates overdue from upcoming, and the table says how long overdue', () => {
  const rows = findBreachingTickets([
    row({ chat_id: 'late', created_at: new Date('2026-09-29T20:00:00Z') }),  // breach 09-30 20:00Z: overdue 14h51m at NOW
    row({ chat_id: 'soon', created_at: new Date('2026-09-30T13:34:00Z') }),  // breach 13:34Z today
  ], { windowStart: new Date('2026-10-01T00:00:00Z'), windowEnd: new Date('2026-10-03T00:00:00Z') }, NOW);
  const p = buildSlackPayload(rows, 'w', NOW, '@x');
  assert.match(p.text, /1 overdue \(customer still waiting\), 1 breaching in the w window/);
  const table: any = p.blocks!.find((b: any) => b.type === 'table');
  assert.equal(table.rows[1][0].text, 'late');
  assert.equal(table.rows[1][2].text, 'overdue 14h 51m');
  assert.equal(table.rows[2][2].text, '2h 43m');
});
