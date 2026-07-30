// Validate the weighted-blend overall_iqs against the current AVG(iqs) headline,
// using REAL rows from the DB. Read-only; computes nothing new in the DB.
//
// Usage:
//   node scripts/validate-weighted-overall.mjs <channel> <dateFrom> <dateTo> [agentName]
//     channel   = bot | human
//     dateFrom  = YYYY-MM-DD (closed_at >=)
//     dateTo    = YYYY-MM-DD (closed_at <=)
//     agentName = optional exact agents.name filter
//
// Example:
//   node scripts/validate-weighted-overall.mjs human 2026-07-01 2026-07-28
//   node scripts/validate-weighted-overall.mjs bot  2026-07-01 2026-07-28
//
// It prints, for the cohort:
//   • per-parameter pooled pass-rate (half-credit for 0.5, NA excluded) — same
//     computation the parameter columns already use (PASS_RATE_SELECT).
//   • CURRENT headline  = AVG(stored per-chat iqs)           (agent_iqs/bot_iqs/iqs_score)
//   • PROPOSED headline = Σ(rate × weight) / Σ(weight present)  (the fix)
//   • a hand-reconciliation line so acceptance-criterion #2 is checkable by eye.

import fs from 'fs';
import { Pool } from 'pg';

// ── load .env.local like the other scripts in this repo ─────────────────────
for (const envPath of ['./.env.local', './.env']) {
  if (!fs.existsSync(envPath)) continue;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([^#=]+)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(m[1].trim() in process.env)) process.env[m[1].trim()] = v;
  }
}

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
if (!connectionString) {
  console.error('Missing POSTGRES_URL(_NON_POOLING). Put it in .env.local.');
  process.exit(1);
}

// ── weights, straight from lib/scoring/prompt_v4.ts (0-100 scale) ───────────
const HUMAN_WEIGHTS = {
  issue_resolution: 25, accuracy: 20, expectation_follow_through: 20,
  dissatisfaction_handling: 10, personalization: 10, empathy: 5,
  escalation_decision: 5, readability: 3, greeting_handover: 2, post_call_recap: 5,
};
const BOT_WEIGHTS = {
  issue_resolution: 25, accuracy: 20, correct_escalation: 20,
  no_repetition: 10, personalization: 10, expectation_setting: 8, clarity: 7,
};

const [channel, dateFrom, dateTo, agentName] = process.argv.slice(2);
if (!['bot', 'human'].includes(channel) || !dateFrom || !dateTo) {
  console.error('Usage: node scripts/validate-weighted-overall.mjs <bot|human> <dateFrom> <dateTo> [agentName]');
  process.exit(1);
}

const WEIGHTS    = channel === 'bot' ? BOT_WEIGHTS : HUMAN_WEIGHTS;
const CONTAINER  = channel === 'bot' ? '__bot_parameters' : '__agent_parameters';
const STORED_COL = channel === 'bot' ? 'bot_iqs' : 'agent_iqs'; // per-chat headline column

const pool = new Pool({ connectionString, ssl: false });

// pull the raw rows; do the pooling in JS so the logic is transparent & auditable
function paramContainer(parameters) {
  if (!parameters || typeof parameters !== 'object') return {};
  // v4 nests under CONTAINER; legacy rows keep params at top level
  if (parameters[CONTAINER] && typeof parameters[CONTAINER] === 'object') return parameters[CONTAINER];
  return parameters;
}

// half-credit + NA-excluded, exactly like PASS_RATE_SELECT:
//   'true' -> 1, '0.5' -> 0.5, 'false' -> 0 ; null/NA/absent -> excluded
function cellScore(cell) {
  if (cell == null) return null;
  const s = cell.score;
  if (s === true || s === 'true' || s === 1) return 1;
  if (s === 0.5 || s === '0.5') return 0.5;
  if (s === false || s === 'false' || s === 0) return 0;
  return null; // 'NA', null, '', undefined -> out of numerator AND denominator
}

async function main() {
  const where = ['c.closed_at::date >= $1', 'c.closed_at::date <= $2', 's.parameters IS NOT NULL'];
  const args = [dateFrom, dateTo];
  if (channel === 'bot')   where.push(`c.conversation_type = 'bot'`);
  if (channel === 'human') where.push(`(c.conversation_type IS DISTINCT FROM 'bot')`);
  if (agentName) { args.push(agentName); where.push(`a.name = $${args.length}`); }

  const rows = await pool.query(`
    SELECT s.chat_id, s.iqs_score, s.${STORED_COL} AS stored_iqs, s.parameters
    FROM iqs_scores s
    JOIN conversations c ON c.id = s.chat_id
    LEFT JOIN agents a ON a.id = c.agent_id
    WHERE ${where.join(' AND ')}
  `, args);

  const n = rows.rows.length;
  if (n === 0) { console.log('No rows for that cohort.'); return; }

  // ── pooled per-parameter pass-rate ────────────────────────────────────────
  const num = {}, den = {};
  for (const k of Object.keys(WEIGHTS)) { num[k] = 0; den[k] = 0; }

  // ── current headline: AVG of stored per-chat iqs ──────────────────────────
  let sumStored = 0, cntStored = 0, sumGeneric = 0, cntGeneric = 0;

  for (const r of rows.rows) {
    const c = paramContainer(r.parameters);
    for (const k of Object.keys(WEIGHTS)) {
      const v = cellScore(c[k]);
      if (v == null) continue;
      num[k] += v; den[k] += 1;
    }
    if (r.stored_iqs != null) { sumStored += Number(r.stored_iqs); cntStored++; }
    if (r.iqs_score  != null) { sumGeneric += Number(r.iqs_score); cntGeneric++; }
  }

  // ── weighted blend of pooled rates ────────────────────────────────────────
  let blendNum = 0, blendDen = 0;
  const table = [];
  for (const [k, w] of Object.entries(WEIGHTS)) {
    if (den[k] === 0) { table.push({ param: k, weight: w, present: 0, rate: null }); continue; }
    const rate = (num[k] / den[k]) * 100; // 0..100
    blendNum += rate * w;
    blendDen += w;
    table.push({ param: k, weight: w, present: den[k], rate });
  }
  const blend = blendDen === 0 ? null : blendNum / blendDen;

  const avgStored  = cntStored  ? sumStored  / cntStored  : null;
  const avgGeneric = cntGeneric ? sumGeneric / cntGeneric : null;

  // ── report ────────────────────────────────────────────────────────────────
  console.log(`\nCohort: channel=${channel}  ${dateFrom}..${dateTo}${agentName ? `  agent="${agentName}"` : ''}`);
  console.log(`Chats in cohort: ${n}\n`);
  console.log('Pooled parameter pass-rates (half-credit, NA excluded):');
  console.log('  param                         weight  present  pass%   contrib(rate*w)');
  for (const t of table) {
    const rate = t.rate == null ? '  NA ' : t.rate.toFixed(1).padStart(5);
    const contrib = t.rate == null ? '   —' : (t.rate * t.weight).toFixed(0).padStart(6);
    console.log(`  ${t.param.padEnd(28)}  ${String(t.weight).padStart(4)}   ${String(t.present).padStart(6)}   ${rate}  ${contrib}`);
  }
  console.log(`\n  Σ contrib = ${blendNum.toFixed(0)}   Σ weight present = ${blendDen}`);
  console.log('  ───────────────────────────────────────────────');
  console.log(`  PROPOSED  overall = Σcontrib / Σweight = ${blend == null ? 'NA' : blend.toFixed(1)}`);
  console.log(`  CURRENT   overall = AVG(${STORED_COL})      = ${avgStored  == null ? 'NA' : avgStored.toFixed(1)}   (n=${cntStored})`);
  console.log(`            AVG(iqs_score) [combined col]     = ${avgGeneric == null ? 'NA' : avgGeneric.toFixed(1)}   (n=${cntGeneric})`);
  if (blend != null && avgStored != null)
    console.log(`\n  Δ (proposed − current) = ${(blend - avgStored).toFixed(1)} points`);
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => pool.end());
