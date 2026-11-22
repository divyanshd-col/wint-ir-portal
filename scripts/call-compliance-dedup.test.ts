import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..');

const envFile = join(ROOT, '.env.local');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf-8').split('\n')) {
    const m = line.match(/^([^#=\s]+)\s*=\s*"?(.+?)"?\s*$/);
    if (m) process.env[m[1]] = m[2];
  }
}

import { fireQualityAlert } from '../lib/quality-alert';
import { query, getPool } from '../lib/cx/db';

test.after(async () => {
  try {
    await getPool().end();
  } catch {}
});

test('fireQualityAlert - skips alert for call with compliance_alerted_at in DB', async () => {
  let slackFetchCalled = false;
  const origFetch = global.fetch;

  global.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const urlStr = String(input);
    if (urlStr.includes('slack.com')) {
      slackFetchCalled = true;
      return new Response(JSON.stringify({ ok: true, ts: '123456.789' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return origFetch(input, init);
  };

  try {
    // Call 192049 has compliance_alerted_at backfilled in DB
    const rows = await query<{ compliance_alerted_at: string | null }>(
      `SELECT compliance_alerted_at FROM call_evaluations WHERE call_id = $1`,
      ['192049']
    );
    assert.ok(rows[0]?.compliance_alerted_at, 'Call 192049 should have compliance_alerted_at set in DB');

    await fireQualityAlert({
      callId: '192049',
      channel: 'call',
      agentName: 'Test Agent',
      scores: {},
      reasoning: {},
      complianceFlag: true,
      breaches: [{ type: 'G1_no_advice', quote: 'guaranteed return' }],
    });

    assert.equal(slackFetchCalled, false, 'Slack API should NOT be called when compliance_alerted_at is set');
  } finally {
    global.fetch = origFetch;
  }
});

test('fireQualityAlert - skips alert for call 152906 with compliance_alerted_at in DB', async () => {
  let slackFetchCalled = false;
  const origFetch = global.fetch;

  global.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const urlStr = String(input);
    if (urlStr.includes('slack.com')) {
      slackFetchCalled = true;
      return new Response(JSON.stringify({ ok: true, ts: '123456.789' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return origFetch(input, init);
  };

  try {
    // Call 152906 has compliance_alerted_at backfilled in DB
    const rows = await query<{ compliance_alerted_at: string | null }>(
      `SELECT compliance_alerted_at FROM call_evaluations WHERE call_id = $1`,
      ['152906']
    );
    assert.ok(rows[0]?.compliance_alerted_at, 'Call 152906 should have compliance_alerted_at set in DB');

    await fireQualityAlert({
      callId: '152906',
      channel: 'call',
      agentName: 'Test Agent',
      scores: {},
      reasoning: {},
      complianceFlag: true,
      breaches: [{ type: 'G1_no_advice', quote: 'guaranteed return' }],
    });

    assert.equal(slackFetchCalled, false, 'Slack API should NOT be called for call 152906');
  } finally {
    global.fetch = origFetch;
  }
});
