#!/usr/bin/env node
/**
 * redis-to-robylon.mjs
 *
 * Migrates existing Wint IQS data from Upstash Redis → new PostgreSQL schema
 * (conversations + iqs_scores + agents + contacts).
 *
 * Source in Redis:
 *   wint_iqs_scores       — full IQS entries (scores, reasoning, timing, agent, csat, chatId)
 *   wint_t:{chatId}       — stored transcripts (timedMessages array)
 *
 * Target in PostgreSQL:
 *   agents        — one row per unique agent name (auto-created)
 *   contacts      — one row per unique phone number (from mobileNumber field)
 *   conversations — one row per unique chatId
 *   iqs_scores    — one row per scored conversation (full parameter breakdown)
 *
 * Idempotent: uses ON CONFLICT DO NOTHING / DO UPDATE throughout.
 *
 * Usage:
 *   node scripts/redis-to-robylon.mjs              # dry-run
 *   node scripts/redis-to-robylon.mjs --confirm    # actually migrate
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
const { Pool } = pg;

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT  = join(__dir, '..');

// ── Load env ──────────────────────────────────────────────────────────────────
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
const db   = async (q, p = []) => (await pool.query(q, p)).rows;

// ── Upstash helpers ────────────────────────────────────────────────────────────
async function upstash(path) {
  const r = await fetch(`${UPSTASH_URL}/${path}`, {
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
  });
  return (await r.json()).result;
}

async function fetchAllIQS() {
  const total = await upstash('llen/wint_iqs_scores');
  if (!total) return [];
  const BATCH = 500;
  const all = [];
  for (let i = 0; i < Math.ceil(total / BATCH); i++) {
    const rows = await upstash(`lrange/wint_iqs_scores/${i*BATCH}/${i*BATCH+BATCH-1}`);
    for (const r of rows || []) { try { all.push(JSON.parse(r)); } catch {} }
  }
  return all;
}

async function fetchTranscript(chatId) {
  const raw = await upstash(`get/wint_t:${chatId}`);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

// ── Parameter name normalisation (Redis uses 'Technical', DB uses 'technical') ─
const PARAM_MAP = {
  Technical:    'technical',
  AllQuestions: 'all_questions',
  Expectation:  'expectation',
  Contextual:   'contextual',
  FollowUp:     'follow_up',
  Sentences:    'sentences',
  Process:      'process',
  Opening:      'opening',
  Call:         'call',
  Tags:         'tags',
  Grammar:      'grammar',
  Empathy:      'empathy',
};

/** Convert Redis {scores:{Technical:'Yes'}, reasoning:{Technical:'...'}} → JSONB format */
function buildParametersJsonb(scores, reasoning) {
  const params = {};
  for (const [redisKey, dbKey] of Object.entries(PARAM_MAP)) {
    const s = scores?.[redisKey];
    params[dbKey] = {
      score:     s === 'Yes' ? true : s === 'No' ? false : null,
      reasoning: reasoning?.[redisKey] || '',
    };
  }
  return params;
}

/** Convert timedMessages from Redis transcript → JSONB array for conversations.transcript */
function buildTranscriptJsonb(timedMessages) {
  if (!Array.isArray(timedMessages)) return [];
  return timedMessages.map((m, i) => {
    const sender = (m.sender || '').toLowerCase();
    const senderType = sender === 'user' || sender === 'customer' ? 'customer'
                     : sender === 'bot'  || sender === 'myra'     ? 'bot'
                     : 'agent';
    return {
      sequence:    i + 1,
      sender_type: senderType,
      sender_name: m.sender || '',
      content:     m.content || '',
      sent_at:     m.timestamp || null,
    };
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────
console.log('\n  Mode:', CONFIRM ? '⚠️  LIVE INSERT' : '🔍 DRY RUN (pass --confirm to insert)');
console.log('  Fetching IQS scores from Redis…');

const entries = await fetchAllIQS();
console.log(`  Total IQS entries in Redis : ${entries.length}`);

// Deduplicate by chatId — keep the most recent entry per chatId
const byChat = new Map();
for (const e of entries) {
  const existing = byChat.get(e.chatId);
  if (!existing || e.scoredAt > existing.scoredAt) byChat.set(String(e.chatId), e);
}
const unique = [...byChat.values()];
console.log(`  Unique chatIds             : ${unique.length}`);

const agentNames = [...new Set(unique.map(e => (e.agentName||'').trim()).filter(Boolean))].sort();
const phones     = [...new Set(unique.map(e => e.mobileNumber).filter(Boolean))];
const withCsat   = unique.filter(e => ['1','3','5'].includes(String(e.csat||'')));

console.log(`  Unique agents              : ${agentNames.length} — ${agentNames.join(', ')}`);
console.log(`  Unique phone numbers       : ${phones.length}`);
console.log(`  Entries with CSAT          : ${withCsat.length}`);

if (!CONFIRM) {
  console.log('\n  ✅  Dry run complete. Pass --confirm to insert.\n');
  await pool.end();
  process.exit(0);
}

// ── Step 1: Upsert agents ─────────────────────────────────────────────────────
console.log('\n  Upserting agents…');
const agentIdMap = {};
for (const name of agentNames) {
  const rows = await db(
    `INSERT INTO agents (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
    [name]
  );
  agentIdMap[name] = rows[0].id;
  process.stdout.write(`    ${name.padEnd(22)} → agent.id=${rows[0].id}\n`);
}

// ── Step 2: Upsert contacts ───────────────────────────────────────────────────
console.log('  Upserting contacts…');
const contactIdMap = {};
for (const phone of phones) {
  const rows = await db(
    `INSERT INTO contacts (phone) VALUES ($1) ON CONFLICT (phone) DO UPDATE SET phone = EXCLUDED.phone RETURNING id`,
    [phone]
  );
  contactIdMap[phone] = rows[0].id;
}
console.log(`    ${phones.length} contacts upserted.`);

// ── Step 3: Insert conversations + iqs_scores ─────────────────────────────────
console.log('  Inserting conversations and IQS scores…');
let convInserted = 0, iqsInserted = 0, skipped = 0, transcriptsFetched = 0;

for (const e of unique) {
  const chatId    = String(e.chatId);
  const agentName = (e.agentName || '').trim();
  const agentId   = agentIdMap[agentName] ?? null;
  const contactId = e.mobileNumber ? (contactIdMap[e.mobileNumber] ?? null) : null;

  // Fetch transcript from Redis wint_t:{chatId}
  let transcriptJsonb = [];
  const stored = await fetchTranscript(chatId);
  if (stored?.timedMessages?.length) {
    transcriptsFetched++;
    transcriptJsonb = buildTranscriptJsonb(stored.timedMessages);
  }

  // CSAT
  const csatRaw = String(e.csat || '').trim();
  const csatScore = csatRaw === '5' ? 5 : csatRaw === '3' ? 3 : csatRaw === '1' ? 1 : null;
  const csatLabel = csatScore === 5 ? 'good' : csatScore === 3 ? 'could_be_better' : csatScore === 1 ? 'bad' : null;

  // Tags
  const tags = (e.disposition || e.subDisposition) ? {
    disposition:     e.disposition    || e.tags || '',
    sub_disposition: e.subDisposition || '',
  } : null;

  // Timing
  const convType = e.conversationType || 'agent';

  // ── conversations ──────────────────────────────────────────────────────────
  try {
    await db(`
      INSERT INTO conversations (
        id, contact_id, agent_id, conversation_type,
        started_at, closed_at,
        csat_score, csat_label,
        transcript, tags,
        frt_seconds, bot_to_team_seconds, resolution_seconds,
        webhook_trigger, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15)
      ON CONFLICT (id) DO UPDATE SET
        contact_id          = COALESCE(EXCLUDED.contact_id, conversations.contact_id),
        agent_id            = COALESCE(EXCLUDED.agent_id, conversations.agent_id),
        conversation_type   = COALESCE(EXCLUDED.conversation_type, conversations.conversation_type),
        started_at          = COALESCE(EXCLUDED.started_at, conversations.started_at),
        closed_at           = COALESCE(EXCLUDED.closed_at, conversations.closed_at),
        csat_score          = COALESCE(EXCLUDED.csat_score, conversations.csat_score),
        csat_label          = COALESCE(EXCLUDED.csat_label, conversations.csat_label),
        transcript          = COALESCE(EXCLUDED.transcript, conversations.transcript),
        tags                = COALESCE(EXCLUDED.tags, conversations.tags),
        frt_seconds         = COALESCE(EXCLUDED.frt_seconds, conversations.frt_seconds),
        bot_to_team_seconds = COALESCE(EXCLUDED.bot_to_team_seconds, conversations.bot_to_team_seconds),
        resolution_seconds  = COALESCE(EXCLUDED.resolution_seconds, conversations.resolution_seconds),
        updated_at          = NOW()
    `, [
      chatId,
      contactId,
      agentId,
      convType,
      e.conversationStarted || e.date || null,
      e.conversationEnded   || e.scoredAt || null,
      csatScore,
      csatLabel,
      transcriptJsonb.length ? JSON.stringify(transcriptJsonb) : null,
      tags ? JSON.stringify(tags) : null,
      typeof e.frt           === 'number' ? e.frt           : null,
      typeof e.botToTeamSecs === 'number' ? e.botToTeamSecs : null,
      typeof e.resolutionTime=== 'number' ? e.resolutionTime: null,
      'webhook:robylon',
      e.scoredAt || new Date().toISOString(),
    ]);
    convInserted++;
  } catch (err) {
    console.error(`  ⚠️  conversation insert failed for ${chatId}:`, err.message);
    skipped++;
    continue;
  }

  // ── iqs_scores ─────────────────────────────────────────────────────────────
  if (e.scores && typeof e.iqs === 'number') {
    const parameters = buildParametersJsonb(e.scores, e.reasoning);
    const modelVersion = `${e.provider || 'gemini'}/${e.model || 'gemini-2.5-flash'}`;
    try {
      await db(`
        INSERT INTO iqs_scores (chat_id, iqs_score, parameters, model_version, scored_at)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (chat_id) DO UPDATE SET
          iqs_score     = EXCLUDED.iqs_score,
          parameters    = EXCLUDED.parameters,
          model_version = EXCLUDED.model_version,
          scored_at     = EXCLUDED.scored_at
      `, [chatId, e.iqs, JSON.stringify(parameters), modelVersion, e.scoredAt || new Date().toISOString()]);
      iqsInserted++;
    } catch (err) {
      console.error(`  ⚠️  iqs_scores insert failed for ${chatId}:`, err.message);
    }
  }
}

// ── Final counts ──────────────────────────────────────────────────────────────
const [c1] = await db(`SELECT COUNT(*) AS n FROM conversations`);
const [c2] = await db(`SELECT COUNT(*) AS n FROM iqs_scores`);
const [c3] = await db(`SELECT COUNT(*) AS n FROM agents`);
const [c4] = await db(`SELECT COUNT(*) AS n FROM contacts`);

console.log(`
  ✅  Done!

  conversations  : ${convInserted} upserted  → total: ${c1.n}
  iqs_scores     : ${iqsInserted} upserted  → total: ${c2.n}
  agents         : ${agentNames.length} upserted  → total: ${c3.n}
  contacts       : ${phones.length} upserted  → total: ${c4.n}
  transcripts    : ${transcriptsFetched} fetched from Redis
  skipped        : ${skipped}
`);

await pool.end();
