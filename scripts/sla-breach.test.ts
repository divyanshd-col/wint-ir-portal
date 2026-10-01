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
import { findBreachingTickets, type EmailTicketRow, type BreachingTicket } from '../lib/sla-breach';

const row = (o: Partial<EmailTicketRow>): EmailTicketRow => ({
  id: 't', chat_id: 'c', customer_email: 'a@example.com', customer_phone: '',
  status: 'OPEN', created_at: new Date('2026-09-30T05:00:00Z'), first_response_at: null,
  updated_at: new Date('2026-09-30T05:00:00Z'), ...o,
});
// Trigger 1 window on 2026-10-01 IST: 04:30Z .. 13:30Z. Breach = anchor + 24h.
const W1 = getSlaWindow(new Date('2026-10-01T04:15:00Z'), 1);

test('findBreachingTickets includes a ticket breaching inside the window', () => {
  const r = findBreachingTickets([row({ chat_id: 'in', created_at: new Date('2026-09-30T08:00:00Z') })], W1);
  assert.deepEqual(r.map((x) => x.chat_id), ['in']);
  assert.equal(r[0].sla_breach_time.toISOString(), '2026-10-01T08:00:00.000Z');
});

test('findBreachingTickets excludes tickets just outside the window', () => {
  const rows = [
    row({ chat_id: 'before', created_at: new Date('2026-09-30T04:29:59Z') }), // breach 04:29:59Z
    row({ chat_id: 'after', created_at: new Date('2026-09-30T13:30:01Z') }), // breach 13:30:01Z
  ];
  assert.deepEqual(findBreachingTickets(rows, W1), []);
});

test('findBreachingTickets excludes CLOSED and RESOLVED tickets', () => {
  const t = new Date('2026-09-30T08:00:00Z');
  const rows = [
    row({ chat_id: 'closed', status: 'CLOSED', created_at: t }),
    row({ chat_id: 'resolved', status: 'RESOLVED', created_at: t }),
  ];
  assert.deepEqual(findBreachingTickets(rows, W1), []);
});

test('findBreachingTickets anchors on updated_at once first_response_at is set', () => {
  const r = findBreachingTickets([row({
    chat_id: 'replied',
    created_at: new Date('2026-09-20T00:00:00Z'), // would be far outside the window
    first_response_at: new Date('2026-09-20T01:00:00Z'),
    updated_at: new Date('2026-09-30T09:00:00Z'),
  })], W1);
  assert.deepEqual(r.map((x) => x.chat_id), ['replied']);
  assert.equal(r[0].user_last_replied_at.toISOString(), '2026-09-30T09:00:00.000Z');
});

test('findBreachingTickets sorts by breach time ascending', () => {
  const r = findBreachingTickets([
    row({ chat_id: 'late', created_at: new Date('2026-09-30T12:00:00Z') }),
    row({ chat_id: 'early', created_at: new Date('2026-09-30T05:00:00Z') }),
  ], W1);
  assert.deepEqual(r.map((x) => x.chat_id), ['early', 'late']);
});

// ---- Step 3: Slack payload (no network) ----
import { buildSlackPayload, formatMentions, formatBreachesIn, formatBreachesAt } from '../lib/sla-breach';

const NOW = new Date('2026-10-01T10:51:00Z'); // 16:21 IST
const mk = () => findBreachingTickets([
  row({ chat_id: '111', customer_email: 'secret@example.com', created_at: new Date('2026-09-30T13:34:00Z') }), // breach 13:34Z = 19:04 IST, 2h43m away
  row({ chat_id: '222', created_at: new Date('2026-09-30T20:00:00Z') }), // breach next day 20:00Z - 1d9h09m away
], { windowStart: new Date('2026-10-01T00:00:00Z'), windowEnd: new Date('2026-10-03T00:00:00Z') });

test('formatBreachesIn - hours and minutes, days when long, "overdue" when past', () => {
  assert.equal(formatBreachesIn(new Date('2026-10-01T13:34:00Z'), NOW), '2h 43m');
  assert.equal(formatBreachesIn(new Date('2026-10-01T10:59:00Z'), NOW), '8m');
  assert.equal(formatBreachesIn(new Date('2026-10-02T20:00:00Z'), NOW), '1d 9h');
  assert.equal(formatBreachesIn(new Date('2026-10-01T10:00:00Z'), NOW), 'overdue');
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
  assert.match(p.text, /No SLA breaches expected in the 10 AM to 7 PM today window/);
  assert.ok(!p.text.includes('S1'));
  assert.ok(!(p.blocks ?? []).some((b: any) => b.type === 'table'));
});

test('buildSlackPayload - mentions + ticket table with the 3 columns, no email, "Ticket" not "Chat"', () => {
  const p = buildSlackPayload(mk(), 'w', NOW, '<!subteam^S1> <!subteam^S2>');
  assert.ok(p.text.includes('<!subteam^S1> <!subteam^S2>'));
  assert.match(p.text, /2 ticket\(s\)/);
  const json = JSON.stringify(p);
  assert.ok(!json.includes('secret@example.com') && !json.includes('@example.com'));
  assert.ok(!/Chat \d/.test(json));
  const table: any = p.blocks!.find((b: any) => b.type === 'table');
  assert.ok(table);
  const [header, r1, r2] = table.rows;
  assert.deepEqual(header.map((c: any) => c.text), ['Ticket ID', 'Breaches in', 'Breaches at', 'Open ticket']);
  assert.equal(r1[0].text, '111');
  assert.equal(r1[1].text, '2h 43m');
  assert.equal(r1[2].text, '1 Oct, 7:04 PM'); // 13:34Z = 19:04 IST
  assert.equal(r2[0].text, '222');
  const link = r1[3].elements[0].elements[0];
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
      fetchRows: async () => { calls.fetch++; return [] as BreachingTicket[]; },
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
  assert.match(p.text, /No SLA breaches expected/);
  assert.match(p.text, /2 automated sender\(s\) excluded/);
  assert.ok(!p.text.includes('S1'));
});

test('runSlaBreachCron - drops automated senders from the alert and reports the count', async () => {
  const { d } = deps();
  const posted: string[] = [];
  const t = (chat: string, email: string) => ({ ...mk()[0], chat_id: chat, customer_email: email });
  const res = await runSlaBreachCron({
    ...d, authHeader: 'Bearer shh', trigger: '1',
    fetchRows: async () => [t('900', 'real@gmail.com'), t('901', 'noreply@x.com')],
    post: async (p) => { posted.push(JSON.stringify(p)); },
  });
  assert.deepEqual(res.body, { ok: true, count: 1, excluded: 1 });
  assert.ok(posted[0].includes('900') && !posted[0].includes('901'));
});
