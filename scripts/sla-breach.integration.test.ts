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

    // now = 2026-10-01 09:45 IST. Trigger 1 window = 04:30Z..13:30Z on Oct 1 (breach = last customer message + 24h).
    const T = (chat: string, extra = '', status = 'OPEN', created = '2026-09-30 08:00Z', frt = 'NULL', updated = created) =>
      `('${chat}','${chat}','${chat}@example.com','${status}','${created}',${frt},'${updated}')`;
    await pool.query(
      `INSERT INTO email_conversations (id, chat_id, customer_email, status, created_at, first_response_at, updated_at) VALUES
       ${[
         T('unanswered'),                                   // no events, no reply: anchor = created_at, in window
         T('customer-last', '', 'OPEN', '2026-09-20 00:00Z', "'2026-09-20 01:00Z'", '2026-09-29 00:00Z'), // anchor = last message, not updated_at
         T('agent-last'),                                   // last message from @wintwealth.com
         T('repayment'),                                    // Chat Status = Repayment
         T('repayment-ext'),                                // Chat Status = Repayment External Dependency
         T('pending-status'),                               // Chat Status = PENDING (kept)
         T('note-after'),                                   // customer message, then an internal note: still customer-last
         T('closed', '', 'CLOSED'),
         T('just-outside', '', 'OPEN', '2026-09-30 13:31Z'),
         T('noreply', '', 'OPEN', '2026-09-30 09:00Z'),
       ].join(',\n       ')}`,
    );
    await pool.query("UPDATE email_conversations SET customer_email = 'noreply@example.com' WHERE id = 'noreply'");

    const ev = (chat: string, type: string, at: string, message?: { from: string; type: string; sentAt: string }, props: [string, string][] = []) => [
      chat, type, at,
      JSON.stringify({ data: {
        ...(message ? { message: { from_email: message.from, message_type: message.type, created_at: message.sentAt } } : {}),
        properties: props.map(([name, v]) => ({ name, selected_value: v, snapshot_value: v })),
      } }),
    ];
    const rows = [
      ev('customer-last', 'NEW_MESSAGE', '2026-09-30 09:00Z', { from: 'cust@gmail.com', type: 'incoming', sentAt: '2026-09-30 09:00Z' }),
      ev('customer-last', 'REPLY_SENT', '2026-09-20 03:00Z', { from: 'hello@wintwealth.com', type: 'reply', sentAt: '2026-09-20 03:00Z' }),
      ev('agent-last', 'NEW_MESSAGE', '2026-09-30 07:00Z', { from: 'cust@gmail.com', type: 'incoming', sentAt: '2026-09-30 07:00Z' }),
      ev('agent-last', 'REPLY_SENT', '2026-09-30 08:00Z', { from: 'Sneha@WintWealth.com', type: 'reply', sentAt: '2026-09-30 08:00Z' }),
      ev('repayment', 'STATUS_CHANGED', '2026-09-30 09:00Z', undefined, [['Chat Status', 'PENDING']]),
      ev('repayment', 'STATUS_CHANGED', '2026-09-30 10:00Z', undefined, [['Chat Status', 'Repayment']]),       // latest wins
      ev('repayment-ext', 'STATUS_CHANGED', '2026-09-30 10:00Z', undefined, [['Chat Status', 'Repayment External Dependency']]),
      ev('pending-status', 'STATUS_CHANGED', '2026-09-30 10:00Z', undefined, [['Chat Status', 'PENDING'], ['Intents_L1', 'KYC']]),
      ev('note-after', 'NEW_MESSAGE', '2026-09-30 08:00Z', { from: 'cust@gmail.com', type: 'incoming', sentAt: '2026-09-30 08:00Z' }),
      ev('note-after', 'INTERNAL_NOTE_ADDED', '2026-09-30 09:00Z', { from: 'sneha@wintwealth.com', type: 'note', sentAt: '2026-09-30 09:00Z' }),
    ];
    for (const [chat, type, at, payload] of rows) {
      await pool.query(`INSERT INTO robylon_webhook_payloads (source, event_type, chat_id, payload, received_at) VALUES ('email',$1,$2,$3::jsonb,$4)`, [type, chat, payload, at]);
    }
    // a chat-source event for the same chat id must be ignored
    await pool.query(`INSERT INTO robylon_webhook_payloads (source, event_type, chat_id, payload, received_at) VALUES ('chat','STATUS_CHANGED','pending-status',$1::jsonb,'2026-09-30 11:00Z')`,
      [JSON.stringify({ data: { properties: [{ name: 'Chat Status', selected_value: 'Repayment', snapshot_value: 'Repayment' }] } })]);

    const posted: string[] = [];
    const res = await runSlaBreachCron({
      authHeader: 'Bearer s', secret: 's', trigger: '1', now: new Date('2026-10-01T04:15:00Z'),
      fetchOpenTickets, post: async (p) => { posted.push(JSON.stringify(p)); },
    });
    assert.deepEqual(res, { status: 200, body: { ok: true, count: 4, excluded: 1 } });
    const table = JSON.parse(posted[0]).blocks.find((b: { type: string }) => b.type === 'table');
    const listed = table.rows.slice(1).map((r: { text: string }[]) => r[0].text).sort();
    assert.deepEqual(listed, ['customer-last', 'note-after', 'pending-status', 'unanswered']);
    assert.match(posted[0], /1 automated sender/);
    // L1 still comes through for a ticket that has one
    const l1 = Object.fromEntries(table.rows.slice(1).map((r: { text: string }[]) => [r[0].text, r[1].text]));
    assert.equal(l1['pending-status'], 'KYC');
    assert.equal(l1['unanswered'], '—');
  } finally {
    await pool.end();
    (await import('../lib/cx/db')).getPool().end().catch(() => {});
  }
});
