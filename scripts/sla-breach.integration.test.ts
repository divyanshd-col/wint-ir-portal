/**
 * Integration test: real Postgres, no Slack. Opt-in via SLA_TEST_DATABASE_URL (must be localhost —
 * this test TRUNCATEs email_conversations and robylon_webhook_payloads; use a throwaway database,
 * e.g. `docker exec sla-test-pg createdb -U postgres sla_integration`).
 *   SLA_TEST_DATABASE_URL=postgres://postgres:test@localhost:54329/sla_integration npx tsx --test scripts/sla-breach.integration.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';

const url = process.env.SLA_TEST_DATABASE_URL;
const isLocal = !!url && /@(localhost|127\.0\.0\.1)(:|\/)/.test(url);
const skip = !url ? 'SLA_TEST_DATABASE_URL not set' : !isLocal ? 'refusing: SLA_TEST_DATABASE_URL is not localhost' : false;

test('sla-breach cron end to end against a real database', { skip }, async () => {
  process.env.POSTGRES_URL_NON_POOLING = url;
  const { runSlaBreachCron } = await import('../lib/sla-breach');
  const { fetchOpenTickets } = await import('../lib/sla-breach-db');
  const pool = new Pool({ connectionString: url });
  try {
    // schema as in migrations 021 and 025 (the throwaway test database starts empty)
    await pool.query(`CREATE TABLE IF NOT EXISTS email_conversations (
      id VARCHAR(100) PRIMARY KEY, chat_id VARCHAR(100) NOT NULL, subject_line VARCHAR(500), customer_email VARCHAR(255),
      customer_phone VARCHAR(50), agent_name VARCHAR(255), status VARCHAR(50) DEFAULT 'OPEN', created_at TIMESTAMPTZ DEFAULT NOW(),
      first_response_at TIMESTAMPTZ, closed_at TIMESTAMPTZ, raw_payload JSONB, updated_at TIMESTAMPTZ DEFAULT NOW())`);
    await pool.query(`CREATE TABLE IF NOT EXISTS robylon_webhook_payloads (
      id BIGSERIAL PRIMARY KEY, source VARCHAR(50) NOT NULL DEFAULT 'chat', event_type VARCHAR(100), event_id VARCHAR(255),
      chat_id VARCHAR(100), payload JSONB NOT NULL, headers JSONB, received_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    await pool.query('TRUNCATE email_conversations, robylon_webhook_payloads');

    // now = 2026-10-01 09:45 IST (04:15Z). Trigger 1 window = 04:30Z..13:30Z on Oct 1. Breach = customer's last message + 24h; overdue = already past.
    const T = (chat: string, status = 'OPEN', created = '2026-09-30 08:00Z', email = `${chat}@example.com`) =>
      `('${chat}','${chat}','${email}','${status}','${created}','${created}')`;
    await pool.query(
      `INSERT INTO email_conversations (id, chat_id, customer_email, status, created_at, updated_at) VALUES
       ${[
         T('unanswered'), T('customer-last'), T('agent-last'), T('repayment'), T('pending-status'), T('note-after'),
         T('answered-stuck'), T('answered-quiet'), T('hold'), T('internal-start'), T('overdue', 'OPEN', '2026-09-28 08:00Z'),
         T('no-events'), T('closed', 'CLOSED'), T('just-outside', 'OPEN', '2026-09-30 13:31Z'),
         T('noreply', 'OPEN', '2026-09-30 09:00Z', 'noreply@example.com'),
       ].join(',\n       ')}`,
    );

    const msg = (from: string, type: string, at: string) => ({ from_email: from, message_type: type, created_at: at });
    const ev = (chat: string, type: string, at: string, data: Record<string, unknown> = {}) => [chat, type, at, JSON.stringify({ data })];
    const cust = (chat: string, at: string) => ev(chat, 'NEW_MESSAGE', at, { message: msg('cust@gmail.com', 'incoming', at) });
    const reply = (chat: string, at: string) => ev(chat, 'REPLY_SENT', at, { message: msg('Sneha@WintWealth.com', 'reply', at) });
    const status = (chat: string, at: string, s: string, props: [string, string][] = []) =>
      ev(chat, 'STATUS_CHANGED', at, { new_status: s, properties: props.map(([name, v]) => ({ name, selected_value: v, snapshot_value: v })) });
    const created = (chat: string, at: string) => ev(chat, 'TICKET_CREATED', at, { properties: [] });
    const rows = [
      created('unanswered', '2026-09-30 08:00Z'),                                   // only the creation event: no reply, upcoming
      reply('customer-last', '2026-09-20 03:00Z'), cust('customer-last', '2026-09-30 09:00Z'),   // customer wrote after the reply
      cust('agent-last', '2026-09-30 07:00Z'), reply('agent-last', '2026-09-30 08:00Z'),         // agent last: not flagged
      cust('repayment', '2026-09-30 08:00Z'), status('repayment', '2026-09-30 10:00Z', 'PENDING'), status('repayment', '2026-09-30 11:00Z', 'Repayment'), // latest wins
      cust('pending-status', '2026-09-30 08:00Z'), status('pending-status', '2026-09-30 10:00Z', 'PENDING', [['Intents_L1', 'KYC']]),
      cust('note-after', '2026-09-30 08:00Z'), ev('note-after', 'INTERNAL_NOTE_ADDED', '2026-09-30 09:00Z', { message: msg('sneha@wintwealth.com', 'note', '2026-09-30 09:00Z') }),
      status('answered-stuck', '2026-09-30 06:00Z', 'Answered'), cust('answered-stuck', '2026-09-30 09:00Z'),   // customer wrote after Answered: still flagged
      cust('answered-quiet', '2026-09-30 08:00Z'), status('answered-quiet', '2026-09-30 09:00Z', 'Answered'), // agent acted last by status
      cust('hold', '2026-09-30 08:00Z'), status('hold', '2026-09-30 09:00Z', 'Hold'),
      ev('internal-start', 'NEW_MESSAGE', '2026-09-30 08:00Z', { message: msg('compliance@wintwealth.com', 'incoming', '2026-09-30 08:00Z') }), // started by a Wint sender
      cust('overdue', '2026-09-28 08:00Z'),                                                                      // 24h passed on Sep 29 08:00Z
      created('just-outside', '2026-09-30 13:31Z'),
      created('noreply', '2026-09-30 09:00Z'),
    ];
    for (const [chat, type, at, payload] of rows) {
      await pool.query(`INSERT INTO robylon_webhook_payloads (source, event_type, chat_id, payload, received_at) VALUES ('email',$1,$2,$3::jsonb,$4)`, [type, chat, payload, at]);
    }
    // a chat-source event for the same chat id must be ignored
    await pool.query(`INSERT INTO robylon_webhook_payloads (source, event_type, chat_id, payload, received_at) VALUES ('chat','STATUS_CHANGED','pending-status',$1::jsonb,'2026-09-30 12:00Z')`,
      [JSON.stringify({ data: { new_status: 'Repayment' } })]);

    const posted: string[] = [];
    const res = await runSlaBreachCron({
      authHeader: 'Bearer s', secret: 's', trigger: '1', now: new Date('2026-10-01T04:15:00Z'),
      fetchOpenTickets, post: async (p) => { posted.push(JSON.stringify(p)); },
    });
    assert.deepEqual(res, { status: 200, body: { ok: true, count: 6, excluded: 1 } });
    const table = JSON.parse(posted[0]).blocks.find((b: { type: string }) => b.type === 'table');
    const listed = table.rows.slice(1).map((r: { text: string }[]) => r[0].text);
    assert.equal(listed[0], 'overdue'); // overdue first
    assert.deepEqual([...listed].sort(), ['answered-stuck', 'customer-last', 'note-after', 'overdue', 'pending-status', 'unanswered']);
    assert.match(posted[0], /1 automated sender/);
    assert.match(posted[0], /1 overdue/);
    // L1 still comes through for a ticket that has one
    const l1 = Object.fromEntries(table.rows.slice(1).map((r: { text: string }[]) => [r[0].text, r[1].text]));
    assert.equal(l1['pending-status'], 'KYC');
    assert.equal(l1['unanswered'], '—');
  } finally {
    await pool.end();
    (await import('../lib/cx/db')).getPool().end().catch(() => {});
  }
});
