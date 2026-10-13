/**
 * Integration test: real Postgres, no Slack. Opt-in via SLA_TEST_DATABASE_URL (must be localhost —
 * this test TRUNCATEs email_conversations).
 *   SLA_TEST_DATABASE_URL=postgres://postgres:test@localhost:54329/sla_test npx tsx --test scripts/sla-breach.integration.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';

const url = process.env.SLA_TEST_DATABASE_URL;
const isLocal = !!url && /@(localhost|127\.0\.0\.1)(:|\/)/.test(url);
const skip = !url ? 'SLA_TEST_DATABASE_URL not set' : !isLocal ? 'refusing: SLA_TEST_DATABASE_URL is not localhost' : false;

test('sla-breach cron end to end against a real database', { skip }, async () => {
  process.env.POSTGRES_URL_NON_POOLING = url;
  const { runSlaBreachCron, getSlaWindow } = await import('../lib/sla-breach');
  const { fetchBreachingTickets } = await import('../lib/sla-breach-db');
  const pool = new Pool({ connectionString: url });
  try {
    await pool.query('TRUNCATE email_conversations');
    await pool.query('TRUNCATE robylon_webhook_payloads');
    await pool.query(
      `INSERT INTO email_conversations (id, chat_id, customer_email, status) VALUES
       ('a','in-unreplied','a@example.com','OPEN'),
       ('b','in-followup','b@example.com','RESOLVED'),
       ('c','just-outside','c@example.com','OPEN'),
       ('d','answered','d@example.com','OPEN'),
       ('e','closed-unanswered','e@example.com','CLOSED'),
       ('f','auto-in-window','noreply@example.com','OPEN'),
       ('g','junk-in-window','g@example.com','OPEN')`,
    );
    // now = 2026-10-01 09:45 IST. Trigger 1 window = 04:30Z..13:30Z on Oct 1 (breach = last customer msg + 24h).
    const ev = (chat: string, type: string, at: string, extra: object = {}) =>
      pool.query(
        `INSERT INTO robylon_webhook_payloads (source, event_type, chat_id, payload, received_at) VALUES ('email',$1,$2,$3,$4)`,
        [type, chat, JSON.stringify({ created_at: at, data: extra }), at],
      );
    await ev('in-unreplied', 'TICKET_CREATED', '2026-09-30T08:00:00Z');
    await ev('in-followup', 'TICKET_CREATED', '2026-09-20T00:00:00Z');
    await ev('in-followup', 'REPLY_SENT', '2026-09-20T01:00:00Z');
    await ev('in-followup', 'NEW_MESSAGE', '2026-09-30T09:00:00Z', { sender_type: 'customer' });
    await ev('just-outside', 'TICKET_CREATED', '2026-09-30T13:31:00Z');
    await ev('answered', 'TICKET_CREATED', '2026-09-30T08:00:00Z');
    await ev('answered', 'REPLY_SENT', '2026-09-30T09:00:00Z');
    await ev('closed-unanswered', 'TICKET_CREATED', '2026-09-30T08:30:00Z');
    await ev('closed-unanswered', 'TICKET_CLOSED', '2026-10-01T08:30:00Z');
    await ev('auto-in-window', 'TICKET_CREATED', '2026-09-30T09:00:00Z');
    await ev('junk-in-window', 'TICKET_CREATED', '2026-09-30T09:30:00Z');
    await ev('junk-in-window', 'STATUS_CHANGED', '2026-09-30T09:31:00Z', { intents: [{ names: { l1: 'Junk', l2: 'Phishing / Fraud' } }] });
    const posted: string[] = [];
    const now = new Date('2026-10-01T04:15:00Z');
    const res = await runSlaBreachCron({
      authHeader: 'Bearer s', secret: 's', trigger: '1', now,
      fetchRows: fetchBreachingTickets, post: async (p) => { posted.push(JSON.stringify(p)); },
    });
    assert.deepEqual(res, { status: 200, body: { ok: true, count: 2, excluded: 1 } });
    assert.match(posted[0], /in-unreplied/);
    assert.match(posted[0], /in-followup/);
    assert.ok(!/just-outside|\banswered|closed-unanswered|auto-in-window|junk-in-window/.test(posted[0]));
    assert.match(posted[0], /1 automated sender/);

  } finally {
    await pool.end();
    (await import('../lib/cx/db')).getPool().end().catch(() => {});
  }
});
