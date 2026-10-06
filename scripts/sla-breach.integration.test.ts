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
    // now = 2026-10-01 09:45 IST. Trigger 1 window = 04:30Z..13:30Z on Oct 1 (breach = anchor + 24h).
    await pool.query(
      `INSERT INTO email_conversations (id, chat_id, customer_email, status, created_at, first_response_at, updated_at) VALUES
       ('a','in-unreplied','a@example.com','OPEN','2026-09-30 08:00Z',NULL,'2026-09-30 08:00Z'),
       ('b','in-replied','b@example.com','OPEN','2026-09-20 00:00Z','2026-09-20 01:00Z','2026-09-30 09:00Z'),
       ('c','just-outside','c@example.com','OPEN','2026-09-30 13:31Z',NULL,'2026-09-30 13:31Z'),
       ('d','closed','d@example.com','CLOSED','2026-09-30 08:00Z',NULL,'2026-09-30 08:00Z'),
       ('e','resolved','e@example.com','RESOLVED','2026-09-30 08:00Z','2026-09-30 08:30Z','2026-09-30 08:30Z'),
       ('f','auto-in-window','noreply@example.com','OPEN','2026-09-30 09:00Z',NULL,'2026-09-30 09:00Z')`,
    );
    const posted: string[] = [];
    const now = new Date('2026-10-01T04:15:00Z');
    const res = await runSlaBreachCron({
      authHeader: 'Bearer s', secret: 's', trigger: '1', now,
      fetchRows: fetchBreachingTickets, post: async (p) => { posted.push(JSON.stringify(p)); },
    });
    assert.deepEqual(res, { status: 200, body: { ok: true, count: 2, excluded: 1 } });
    assert.match(posted[0], /in-unreplied/);
    assert.match(posted[0], /in-replied/);
    assert.ok(!/just-outside|closed|resolved|auto-in-window/.test(posted[0]));
    assert.match(posted[0], /1 automated sender/);

    // The brief's original IST SQL must agree with the parameterised one.
    const ref = await pool.query(
      `WITH t AS (SELECT chat_id, CASE WHEN first_response_at IS NULL THEN created_at ELSE updated_at END AS s FROM email_conversations WHERE status='OPEN')
       SELECT chat_id FROM t WHERE (s + INTERVAL '24 hours') AT TIME ZONE 'Asia/Kolkata'
         BETWEEN '2026-10-01 10:00' AND '2026-10-01 19:00' ORDER BY s`,
    );
    const mine = await fetchBreachingTickets(getSlaWindow(now, 1));
    assert.deepEqual(mine.map((r) => r.chat_id), ref.rows.map((r) => r.chat_id)); // SQL returns automated too; the filter is applied afterwards
  } finally {
    await pool.end();
    (await import('../lib/cx/db')).getPool().end().catch(() => {});
  }
});
