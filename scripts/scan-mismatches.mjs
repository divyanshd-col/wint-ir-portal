import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
const { Pool } = pg;

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT  = join(__dir, '..');

const envFile = join(ROOT, '.env.local');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf-8').split('\n')) {
    const m = line.match(/^([^#=\s]+)\s*=\s*"?(.+?)"?\s*$/);
    if (m) process.env[m[1]] = m[2];
  }
}

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

const BOT_WEIGHTS = {
  IssueResolution: 0.25,
  Accuracy: 0.20,
  CorrectEscalation: 0.20,
  NoRepetition: 0.10,
  Personalization: 0.10,
  ExpectationSetting: 0.08,
  Clarity: 0.07,
};

const HUMAN_WEIGHTS = {
  IssueResolution: 0.25,
  Accuracy: 0.20,
  ExpectationFollowThrough: 0.15,
  DissatisfactionHandling: 0.10,
  Personalization: 0.10,
  Empathy: 0.05,
  EscalationDecision: 0.05,
  Readability: 0.05,
  GreetingHandover: 0.03,
  PostCallRecap: 0.02,
};

const DB_TO_PASCAL = {
  issue_resolution: 'IssueResolution',
  accuracy: 'Accuracy',
  correct_escalation: 'CorrectEscalation',
  no_repetition: 'NoRepetition',
  personalization: 'Personalization',
  expectation_setting: 'ExpectationSetting',
  clarity: 'Clarity',
  expectation_follow_through: 'ExpectationFollowThrough',
  dissatisfaction_handling: 'DissatisfactionHandling',
  dissatisfactionhandling: 'DissatisfactionHandling',
  empathy: 'Empathy',
  escalation_decision: 'EscalationDecision',
  escalationdecision: 'EscalationDecision',
  readability: 'Readability',
  greeting_handover: 'GreetingHandover',
  greetinghandover: 'GreetingHandover',
  post_call_recap: 'PostCallRecap',
  postcallrecap: 'PostCallRecap',
};

function calculateIQS(scores, isBot) {
  const weights = isBot ? BOT_WEIGHTS : HUMAN_WEIGHTS;
  let total = 0, possible = 0;
  for (const [param, weight] of Object.entries(weights)) {
    const score = scores[param];
    if (score === undefined || score === 'NA' || score === null) continue;
    possible += weight;
    if (score === 'Yes' || score === 1 || score === true) {
      total += weight;
    } else if (score === 'Half' || score === 0.5) {
      total += weight * 0.5;
    }
  }
  return possible > 0 ? Math.round((total / possible) * 100) : null;
}

function computeIqs(paramsObj, isBot) {
  if (!paramsObj || typeof paramsObj !== 'object') return null;
  const target = isBot
    ? (paramsObj.__bot_parameters || (paramsObj.__agent_parameters ? null : paramsObj))
    : (paramsObj.__agent_parameters || (paramsObj.__bot_parameters ? null : paramsObj));

  if (!target || typeof target !== 'object') return null;

  const scores = {};
  let hasAny = false;
  for (const [k, v] of Object.entries(target)) {
    if (k.startsWith('__')) continue;
    const pascal = DB_TO_PASCAL[k] || k;
    const scoreVal = typeof v === 'object' && v !== null ? v.score : v;
    if (scoreVal === true || scoreVal === 1 || scoreVal === '1' || String(scoreVal).toLowerCase() === 'yes' || String(scoreVal).toLowerCase() === 'pass') {
      scores[pascal] = 'Yes';
      hasAny = true;
    } else if (scoreVal === 'Half' || scoreVal === 0.5 || String(scoreVal).toLowerCase() === 'half') {
      scores[pascal] = 'Half';
      hasAny = true;
    } else if (scoreVal === false || scoreVal === 0 || scoreVal === '0' || String(scoreVal).toLowerCase() === 'no' || String(scoreVal).toLowerCase() === 'fail') {
      scores[pascal] = 'No';
      hasAny = true;
    } else if (scoreVal === 'NA' || scoreVal === null || scoreVal === undefined) {
      scores[pascal] = 'NA';
      hasAny = true;
    }
  }
  if (!hasAny) return null;
  return calculateIQS(scores, isBot);
}

async function run() {
  console.log('--- System Check: Scanning all iqs_scores rows for NIL / 0 score mismatches ---');
  
  const allRows = await pool.query(`
    SELECT s.chat_id, s.iqs_score, s.call_iqs_score, c.conversation_type, c.tags->>'disposition' as disposition, s.parameters
    FROM iqs_scores s
    LEFT JOIN conversations c ON c.id = s.chat_id
  `);

  console.log(`Total iqs_scores rows scanned: ${allRows.rows.length}`);

  let botNilMismatchCount = 0;
  let agentNilMismatchCount = 0;

  const botMismatches = [];
  const agentMismatches = [];

  for (const r of allRows.rows) {
    let params = r.parameters || {};
    if (typeof params === 'string') {
      try { params = JSON.parse(params); } catch { params = {}; }
    }

    const computedAgentIqs = computeIqs(params, false);
    const computedBotIqs = computeIqs(params, true);

    const isBot = r.conversation_type === 'bot' || !!params.__bot_parameters;

    // Check bot mismatch: all parameters are NA (computed is null), but DB has 0
    if (isBot) {
      const storedBotIqs = params.__scores?.bot_iqs ?? (r.iqs_score !== null ? parseFloat(r.iqs_score) : null);
      if (computedBotIqs === null && (storedBotIqs === 0 || r.iqs_score === 0 || r.iqs_score === '0')) {
        botNilMismatchCount++;
        botMismatches.push({
          chatId: r.chat_id,
          storedIqs: r.iqs_score,
          storedScores: params.__scores,
          disposition: r.disposition,
        });
      }
    } else {
      // Check human agent mismatch: all parameters are NA (computed is null), but DB has 0
      const storedAgentIqs = params.__scores?.agent_iqs ?? (r.iqs_score !== null ? parseFloat(r.iqs_score) : null);
      if (computedAgentIqs === null && (storedAgentIqs === 0 || r.iqs_score === 0 || r.iqs_score === '0')) {
        agentNilMismatchCount++;
        agentMismatches.push({
          chatId: r.chat_id,
          storedIqs: r.iqs_score,
          storedScores: params.__scores,
          disposition: r.disposition,
        });
      }
    }
  }

  console.log(`\nResults:`);
  console.log(`- Bot chats with NIL in body (all NA) but 0 at top/DB: ${botNilMismatchCount}`);
  console.log(`- Human agent chats with NIL in body (all NA) but 0 at top/DB: ${agentNilMismatchCount}`);

  console.log(`\nSample bot mismatches (first 10):`);
  for (const b of botMismatches.slice(0, 10)) {
    console.log(`  Chat ${b.chatId} | DB iqs_score: ${b.storedIqs} | __scores: ${JSON.stringify(b.storedScores)} | dispo: ${b.disposition}`);
  }

  if (agentMismatches.length > 0) {
    console.log(`\nSample agent mismatches:`);
    for (const a of agentMismatches.slice(0, 10)) {
      console.log(`  Chat ${a.chatId} | DB iqs_score: ${a.storedIqs} | __scores: ${JSON.stringify(a.storedScores)} | dispo: ${a.disposition}`);
    }
  }

  await pool.end();
}

run().catch(console.error);
