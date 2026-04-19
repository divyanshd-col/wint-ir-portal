#!/usr/bin/env node
/**
 * Adds tl_name and qa_name columns to the agents table and pre-populates
 * them from the existing cx_agents/cx_teams/cx_users data.
 * Usage: node scripts/add-agent-tl-qa.mjs
 */
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
const { Pool } = pg;

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT  = join(__dir, '..');

for (const f of ['.env.local', '.env.vercel.tmp']) {
  const p = join(ROOT, f);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, 'utf-8').split('\n')) {
    const m = line.match(/^([^#=\s]+)\s*=\s*"?(.+?)"?\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const pool = new Pool({ connectionString: process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL, ssl: { rejectUnauthorized: false } });
const db = async (q, p = []) => (await pool.query(q, p)).rows;

await db(`ALTER TABLE agents ADD COLUMN IF NOT EXISTS tl_name TEXT`);
await db(`ALTER TABLE agents ADD COLUMN IF NOT EXISTS qa_name TEXT`);
console.log('Columns added.');

// Populate qa_name from cx_agents
const qa = await db(`
  UPDATE agents a SET qa_name = u_qa.name
  FROM cx_agents ca
  JOIN cx_users u_agent ON u_agent.user_id = ca.user_id
  JOIN cx_users u_qa ON u_qa.user_id = ca.qa_id
  WHERE u_agent.name = a.name AND a.qa_name IS NULL
  RETURNING a.name, u_qa.name as qa_name`);
console.log(`qa_name set for ${qa.length} agents`);

// Populate tl_name from cx_teams
const tl = await db(`
  UPDATE agents a SET tl_name = u_tl.name
  FROM cx_agents ca
  JOIN cx_users u_agent ON u_agent.user_id = ca.user_id
  JOIN cx_teams t ON t.team_id = ca.team_id
  JOIN cx_users u_tl ON u_tl.user_id = t.tl_id
  WHERE u_agent.name = a.name AND a.tl_name IS NULL
  RETURNING a.name, u_tl.name as tl_name`);
console.log(`tl_name set for ${tl.length} agents`);

const all = await db(`SELECT name, tl_name, qa_name FROM agents ORDER BY name`);
console.log('\nAgents:');
for (const a of all) console.log(`  ${a.name.padEnd(25)} TL:${(a.tl_name||'—').padEnd(20)} QA:${a.qa_name||'—'}`);

await pool.end();
