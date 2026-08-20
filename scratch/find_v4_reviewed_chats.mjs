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
const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });

async function run() {
  try {
    const res = await pool.query(`
      SELECT 
        c.id AS chat_id,
        a.name AS agent_name,
        c.closed_at,
        i.reviewed_by,
        i.reviewed_at,
        i.iqs_score,
        i.model_version,
        i.status,
        i.parameters
      FROM iqs_scores i
      JOIN conversations c ON c.id = i.chat_id
      LEFT JOIN agents a ON a.id = c.agent_id
      WHERE i.reviewed_by IS NOT NULL AND i.reviewed_by != ''
        AND c.closed_at >= '2026-06-15'
      ORDER BY c.closed_at DESC
    `);

    console.log(`Total reviewed chats after June 15: ${res.rows.length}\n`);

    // Helper to check if a chat is evaluated on latest (v4) parameters
    function isV4(parameters, modelVersion) {
      if (!parameters) return false;
      if (parameters.__scores || parameters.__agent_parameters || parameters.__bot_parameters) return true;
      const mv = (modelVersion || '').toLowerCase();
      if (mv.includes('v4') || mv.includes('gemini-3.5') || mv.includes('gemini-3.6')) return true;
      const keys = Object.keys(parameters).map(k => k.toLowerCase());
      if (keys.some(k => [
        'issue_resolution', 'accuracy', 'expectation_follow_through', 'expectationfollowthrough',
        'dissatisfactionhandling', 'dissatisfaction_handling', 'escalation_decision', 'escalationdecision',
        'greeting_handover', 'greetinghandover', 'post_call_recap', 'postcallrecap', 'readability'
      ].includes(k))) return true;
      return false;
    }

    const v4Chats = res.rows.filter(r => isV4(r.parameters, r.model_version));
    console.log(`Evaluated on latest (v4) parameters: ${v4Chats.length}\n`);

    const samples = v4Chats.slice(0, 20).map(r => ({
      chatId: r.chat_id,
      agentName: r.agent_name,
      closedAt: r.closed_at,
      reviewedBy: r.reviewed_by,
      reviewedAt: r.reviewed_at,
      iqsScore: r.iqs_score,
      modelVersion: r.model_version,
      hasV4Keys: isV4(r.parameters, r.model_version)
    }));

    console.log(JSON.stringify(samples, null, 2));

  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

run();
