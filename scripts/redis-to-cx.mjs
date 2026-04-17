#!/usr/bin/env node
/**
 * redis-to-cx.mjs
 *
 * Migrates existing Wint IQS data from Upstash Redis → PostgreSQL CX tables.
 *
 * What it creates:
 *   cx_teams   — one default "Wint IR" team (or reuses existing)
 *   cx_users   — one entry per unique agentName found in Redis scores + a QA "System" user + a TL
 *   cx_agents  — links each agent user → team + QA
 *   cx_qa_audits      — one row per IQS score entry (iqs → score, scoredAt → audited_at)
 *   cx_csat_responses — one row per IQS entry where csat ∈ {'1','3','5'}
 *   cx_tickets        — one row per unique chatId (resolved_at = scoredAt)
 *
 * Idempotent: adds a chat_id column to fact tables for conflict detection,
 * so re-running the script is safe and won't duplicate data.
 *
 * Usage:
 *   node scripts/redis-to-cx.mjs              # dry-run (preview only)
 *   node scripts/redis-to-cx.mjs --confirm    # actually insert
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
const { Pool } = pg;

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT  = join(__dir, '..');

// ── Load env files ─────────────────────────────────────────────────────────────
for (const f of ['.env.local', '.env.vercel.tmp']) {
  const p = join(ROOT, f);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, 'utf-8').split('\n')) {
    const m = line.match(/^([^#=\s]+)\s*=\s*"?(.+?)"?\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const UPSTASH_URL   = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const POSTGRES_URL  = process.env.POSTGRES_URL;
const CONFIRM       = process.argv.includes('--confirm');

if (!UPSTASH_URL || !UPSTASH_TOKEN) { console.error('❌  Missing UPSTASH_REDIS_REST_URL / TOKEN'); process.exit(1); }
if (!POSTGRES_URL)                   { console.error('❌  Missing POSTGRES_URL'); process.exit(1); }

const pool = new Pool({ connectionString: POSTGRES_URL, ssl: { rejectUnauthorized: false } });

// ── Upstash helpers ────────────────────────────────────────────────────────────
async function upstashGet(path) {
  const r = await fetch(`${UPSTASH_URL}/${path}`, { headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` } });
  return (await r.json()).result;
}

async function fetchAllIQS() {
  const total = await upstashGet('llen/wint_iqs_scores');
  if (!total) return [];
  const BATCH = 500;
  const batches = Math.ceil(total / BATCH);
  const all = [];
  for (let i = 0; i < batches; i++) {
    const rows = await upstashGet(`lrange/wint_iqs_scores/${i*BATCH}/${i*BATCH+BATCH-1}`);
    for (const r of (rows || [])) {
      try { all.push(JSON.parse(r)); } catch {}
    }
  }
  return all;
}

// ── PostgreSQL helpers ─────────────────────────────────────────────────────────
async function sql(q, params = []) {
  const client = await pool.connect();
  try { return (await client.query(q, params)).rows; }
  finally { client.release(); }
}

// ── Main ───────────────────────────────────────────────────────────────────────
console.log('\n  Mode:', CONFIRM ? '⚠️  LIVE INSERT' : '🔍 DRY RUN (pass --confirm to actually insert)');
console.log('  Fetching IQS scores from Redis…');

const entries = await fetchAllIQS();
console.log(`  Total IQS entries: ${entries.length}`);

// ── Derive unique agents ───────────────────────────────────────────────────────
const agentNames = [...new Set(
  entries.map(e => (e.agentName || '').trim()).filter(Boolean)
)].sort();

console.log(`  Unique agent names: ${agentNames.length} — ${agentNames.join(', ')}`);
console.log(`  CSAT entries: ${entries.filter(e => ['1','3','5'].includes(e.csat)).length}`);
console.log(`  Unique chatIds: ${new Set(entries.map(e=>e.chatId)).size}`);

if (!CONFIRM) {
  console.log('\n  ✅  Dry run complete. Pass --confirm to insert.\n');
  await pool.end();
  process.exit(0);
}

// ── Step 1: Add chat_id column to fact tables (idempotent) ────────────────────
console.log('\n  Adding chat_id columns to fact tables (if missing)…');
await sql(`ALTER TABLE cx_qa_audits      ADD COLUMN IF NOT EXISTS chat_id VARCHAR(255)`);
await sql(`ALTER TABLE cx_csat_responses ADD COLUMN IF NOT EXISTS chat_id VARCHAR(255)`);
await sql(`ALTER TABLE cx_tickets        ADD COLUMN IF NOT EXISTS chat_id VARCHAR(255)`);
// Unique constraints for idempotency
await sql(`CREATE UNIQUE INDEX IF NOT EXISTS idx_qa_audits_chat    ON cx_qa_audits(agent_id, chat_id)`);
await sql(`CREATE UNIQUE INDEX IF NOT EXISTS idx_csat_chat         ON cx_csat_responses(agent_id, chat_id)`);
await sql(`CREATE UNIQUE INDEX IF NOT EXISTS idx_tickets_chat      ON cx_tickets(agent_id, chat_id)`);

// ── Step 2: Create default team ───────────────────────────────────────────────
console.log('  Creating default team…');

// Need a TL first — create a placeholder TL user
let tlId;
const existingTl = await sql(`SELECT user_id FROM cx_users WHERE role='tl' LIMIT 1`);
if (existingTl.length) {
  tlId = existingTl[0].user_id;
  console.log(`  Using existing TL: ${tlId}`);
} else {
  const tlRows = await sql(
    `INSERT INTO cx_users (name, role) VALUES ('Team Lead', 'tl')
     ON CONFLICT DO NOTHING RETURNING user_id`
  );
  if (tlRows.length) {
    tlId = tlRows[0].user_id;
  } else {
    tlId = (await sql(`SELECT user_id FROM cx_users WHERE name='Team Lead' AND role='tl' LIMIT 1`))[0]?.user_id;
  }
  console.log(`  Created TL: ${tlId}`);
}

let teamId;
const existingTeam = await sql(`SELECT team_id FROM cx_teams WHERE team_name='Wint IR' LIMIT 1`);
if (existingTeam.length) {
  teamId = existingTeam[0].team_id;
  console.log(`  Using existing team: ${teamId}`);
} else {
  const teamRows = await sql(
    `INSERT INTO cx_teams (team_name, tl_id) VALUES ('Wint IR', $1) RETURNING team_id`,
    [tlId]
  );
  teamId = teamRows[0].team_id;
  console.log(`  Created team "Wint IR": ${teamId}`);
}

// ── Step 3: Create system QA user ────────────────────────────────────────────
console.log('  Creating system QA user…');
let qaId;
const existingQa = await sql(`SELECT user_id FROM cx_users WHERE name='Quality Bot' AND role='qa' LIMIT 1`);
if (existingQa.length) {
  qaId = existingQa[0].user_id;
} else {
  const qaRows = await sql(
    `INSERT INTO cx_users (name, role) VALUES ('Quality Bot', 'qa')
     ON CONFLICT DO NOTHING RETURNING user_id`
  );
  qaId = qaRows.length
    ? qaRows[0].user_id
    : (await sql(`SELECT user_id FROM cx_users WHERE name='Quality Bot' AND role='qa' LIMIT 1`))[0]?.user_id;
}
console.log(`  QA user: ${qaId}`);

// ── Step 4: Create cx_users + cx_agents for each unique agent name ─────────────
console.log(`  Creating ${agentNames.length} agent users…`);
const agentIdMap = {}; // agentName → cx_agents.agent_id

for (const name of agentNames) {
  // cx_users
  let userId;
  const existingUser = await sql(`SELECT user_id FROM cx_users WHERE name=$1 AND role='agent' LIMIT 1`, [name]);
  if (existingUser.length) {
    userId = existingUser[0].user_id;
  } else {
    const uRows = await sql(
      `INSERT INTO cx_users (name, role) VALUES ($1, 'agent') ON CONFLICT DO NOTHING RETURNING user_id`,
      [name]
    );
    userId = uRows.length
      ? uRows[0].user_id
      : (await sql(`SELECT user_id FROM cx_users WHERE name=$1 AND role='agent' LIMIT 1`, [name]))[0]?.user_id;
  }

  // cx_agents
  let agentId;
  const existingAgent = await sql(`SELECT agent_id FROM cx_agents WHERE user_id=$1 LIMIT 1`, [userId]);
  if (existingAgent.length) {
    agentId = existingAgent[0].agent_id;
  } else {
    const aRows = await sql(
      `INSERT INTO cx_agents (user_id, team_id, qa_id) VALUES ($1, $2, $3) RETURNING agent_id`,
      [userId, teamId, qaId]
    );
    agentId = aRows[0].agent_id;
  }

  agentIdMap[name] = agentId;
  console.log(`    ${name.padEnd(20)} agent_id=${agentId}`);
}

// ── Step 5: Insert fact data ───────────────────────────────────────────────────
console.log('\n  Inserting QA audits, CSAT responses, tickets…');
let qaInserted = 0, csatInserted = 0, ticketsInserted = 0;
let qaSkipped  = 0, csatSkipped  = 0, ticketsSkipped  = 0;

// Track unique chatIds per agent for tickets (one ticket per chat)
const ticketsSeen = new Set();

for (const e of entries) {
  const name    = (e.agentName || '').trim();
  const agentId = agentIdMap[name];
  if (!agentId) continue; // skip blank agent names (shouldn't happen after filter)

  const chatId   = String(e.chatId || '');
  const scoredAt = e.scoredAt || e.date || new Date().toISOString();
  const iqs      = typeof e.iqs === 'number' ? e.iqs : parseFloat(e.iqs);

  // ── QA audit ──────────────────────────────────────────────────────────────
  if (!isNaN(iqs) && chatId) {
    try {
      await sql(
        `INSERT INTO cx_qa_audits (agent_id, qa_id, score, audited_at, week_start, chat_id)
         VALUES ($1, $2, $3, $4, '1970-01-01', $5)
         ON CONFLICT (agent_id, chat_id) DO NOTHING`,
        [agentId, qaId, iqs, scoredAt, chatId]
      );
      qaInserted++;
    } catch { qaSkipped++; }
  }

  // ── CSAT response ─────────────────────────────────────────────────────────
  const csatRaw = String(e.csat || '').trim();
  if (['1','3','5'].includes(csatRaw) && chatId) {
    try {
      await sql(
        `INSERT INTO cx_csat_responses (agent_id, rating, responded_at, week_start, chat_id)
         VALUES ($1, $2, $3, '1970-01-01', $4)
         ON CONFLICT (agent_id, chat_id) DO NOTHING`,
        [agentId, parseInt(csatRaw), scoredAt, chatId]
      );
      csatInserted++;
    } catch { csatSkipped++; }
  }

  // ── Ticket (one per unique chatId per agent) ───────────────────────────────
  const ticketKey = `${agentId}:${chatId}`;
  if (chatId && !ticketsSeen.has(ticketKey)) {
    ticketsSeen.add(ticketKey);
    try {
      await sql(
        `INSERT INTO cx_tickets (agent_id, resolved_at, week_start, chat_id)
         VALUES ($1, $2, '1970-01-01', $3)
         ON CONFLICT (agent_id, chat_id) DO NOTHING`,
        [agentId, scoredAt, chatId]
      );
      ticketsInserted++;
    } catch { ticketsSkipped++; }
  }
}

// ── Step 6: Fix week_start (triggers use audited_at/responded_at/resolved_at) ─
// The triggers compute week_start from the event timestamp.
// But we inserted '1970-01-01' as a placeholder — re-trigger via UPDATE.
console.log('\n  Recalculating week_start via triggers…');
await sql(`UPDATE cx_qa_audits      SET audited_at   = audited_at   WHERE chat_id IS NOT NULL`);
await sql(`UPDATE cx_csat_responses SET responded_at = responded_at WHERE chat_id IS NOT NULL`);
await sql(`UPDATE cx_tickets        SET resolved_at  = resolved_at  WHERE chat_id IS NOT NULL`);

// ── Summary ────────────────────────────────────────────────────────────────────
const [qaTot]   = await sql(`SELECT COUNT(*) AS n FROM cx_qa_audits`);
const [csatTot] = await sql(`SELECT COUNT(*) AS n FROM cx_csat_responses`);
const [tickTot] = await sql(`SELECT COUNT(*) AS n FROM cx_tickets`);

console.log(`
  ✅  Done!

  QA audits       : ${qaInserted} inserted  (${qaSkipped} skipped — already existed)  → total: ${qaTot.n}
  CSAT responses  : ${csatInserted} inserted  (${csatSkipped} skipped)                    → total: ${csatTot.n}
  Tickets         : ${ticketsInserted} inserted  (${ticketsSkipped} skipped)                    → total: ${tickTot.n}

  Agents created  : ${agentNames.length}
  Team            : Wint IR
  QA              : Quality Bot (AI-scored audits)

  ℹ️  You can now update team assignments and QA assignments via the Admin dashboard.
`);

await pool.end();
