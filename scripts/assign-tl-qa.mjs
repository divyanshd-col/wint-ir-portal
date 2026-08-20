/**
 * Assigns tl_name and qa_name to all agents based on the team structure.
 * Run with: node scripts/assign-tl-qa.mjs
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
// Load .env manually
try {
  const env = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim().replace(/^"|"$/g, '');
  }
} catch {}
import pg from 'pg';

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL,
  ssl: { rejectUnauthorized: false },
});

async function q(sql, params = []) {
  const { rows } = await pool.query(sql, params);
  return rows;
}

const overwrite = process.argv.includes('--overwrite');

async function setTL(nameLike, tlName, opts = {}) {
  const exclude = opts.exclude || [];
  let sql = overwrite
    ? `UPDATE agents SET tl_name = $1 WHERE name ILIKE $2`
    : `UPDATE agents SET tl_name = $1 WHERE name ILIKE $2 AND tl_name IS NULL`;
  const params = [tlName, nameLike];
  for (let i = 0; i < exclude.length; i++) {
    sql += ` AND name NOT ILIKE $${params.length + 1}`;
    params.push(exclude[i]);
  }
  const res = await pool.query(sql + ' RETURNING name', params);
  return res.rows.map(r => r.name);
}

async function setQA(nameLike, qaName, opts = {}) {
  const exclude = opts.exclude || [];
  let sql = overwrite
    ? `UPDATE agents SET qa_name = $1 WHERE name ILIKE $2`
    : `UPDATE agents SET qa_name = $1 WHERE name ILIKE $2 AND qa_name IS NULL`;
  const params = [qaName, nameLike];
  for (let i = 0; i < exclude.length; i++) {
    sql += ` AND name NOT ILIKE $${params.length + 1}`;
    params.push(exclude[i]);
  }
  const res = await pool.query(sql + ' RETURNING name', params);
  return res.rows.map(r => r.name);
}

async function main() {
  // Show current agents
  const agents = await q('SELECT name, tl_name, qa_name FROM agents ORDER BY name');
  console.log(`\n=== ${agents.length} agents ===`);
  agents.forEach(a => console.log(`  ${a.name} | TL: ${a.tl_name || '—'} | QA: ${a.qa_name || '—'}`));

  console.log(`\n=== Applying TL assignments (overwrite: ${overwrite}) ===`);
  const tlMap = [
    // TL: Harsh
    ['Bhavika%',    'Harsh'],
    ['Vikrant%',    'Harsh'],
    ['Gajal%',      'Harsh'],
    ['Bismit%',     'Harsh'],   // Bismita S / Bismitha
    ['Dhanush%',    'Harsh'],
    ['Vaibhavi%',   'Harsh'],
    // TL: Yashika
    ['Vedant%',        'Yashika'],
    ['Aksa%',          'Yashika'],
    ['Yashvi%',        'Yashika'],
    ['Varshini%',      'Yashika'],
    ['Sahana%',        'Yashika'],
    ['Bhavna Sharma%', 'Yashika'],
    ['Bhavna%',        'Yashika'],
    // TL: Neha C
    ['Anwesha%',    'Neha C'],
    ['Purvi%',      'Neha C'],
    ['Shayari%',    'Neha C'],
    ['Sneha%',      'Neha C'],
    ['Elton%',      'Neha C'],
    // TL: Puja
    ['Nandini%',    'Puja'],
    ['Nirmit%',     'Puja'],   // Nirmiti / Nirmithi
    ['Kashika%',    'Puja'],
    ['Srishti%',    'Puja'],
    ['Ashwitha%',   'Puja'],
    // TL: Rishitha
    ['Anushka%',    'Rishitha'],
    ['Aditya%',     'Rishitha'],
    ['Sahil%',      'Rishitha'],
    ['Tushar%',     'Rishitha'],
    ['Priti%',      'Rishitha'],
    ['Saksham%',    'Rishitha'],
    // TL: Priya Sundar
    ['Anjana%',          'Priya Sundar'],
    ['Harsh Soni%',      'Priya Sundar'],
    ['Pooja%',           'Priya Sundar'],
    ['Priyadharshini%',  'Priya Sundar'],
    ['Ritik%',           'Priya Sundar'],
    ['Sakshi%',          'Priya Sundar'],
    ['Viraj%',           'Priya Sundar'],
    ['Jatin%',           'Priya Sundar'],
    // TL: Anusha
    ['Anjai%',    'Anusha'],
    ['Kanika%',   'Anusha'],
    ['Nityaa%',   'Anusha'],
    ['Ekdant%',   'Anusha'],
    ['Bhavana%',  'Anusha'],
    ['Pranav%',   'Anusha'],
  ];

  for (const [pattern, tl] of tlMap) {
    const updated = await setTL(pattern, tl);
    if (updated.length) console.log(`  TL=${tl}: ${updated.join(', ')}`);
  }

  console.log('\n=== Applying QA assignments ===');
  const qaMap = [
    // QA: Dipti
    ['Ritik%',     'Dipti'],
    ['Sakshi%',    'Dipti'],
    ['Tushar%',    'Dipti'],
    ['Saksham%',   'Dipti'],
    ['Aditya%',    'Dipti'],
    ['Bhavika%',   'Dipti'],
    // QA: Arjun
    ['Shayari%',   'Arjun'],
    ['Priti%',     'Arjun'],
    ['Gajal%',     'Arjun'],
    ['Bismit%',    'Arjun'],
    ['Varshini%',  'Arjun'],
    // QA: Manorathi
    ['Harsh Soni%',  'Manorathi'],
    ['Anwesha%',     'Manorathi'],
    ['Sahana%',      'Manorathi'],
    ['Dhanush%',     'Manorathi'],
    ['Nirmit%',      'Manorathi'],
    ['Vedant%',      'Manorathi'],
    ['Kanika%',      'Manorathi'],
    // QA: Yashvi/Priyanka
    ['Priya%',     'Yashvi/Priyanka', { exclude: ['Priyadharshini%', 'Priya Sundar%'] }],
    ['Anushka%',   'Yashvi/Priyanka'],
    ['Aksa%',      'Yashvi/Priyanka'],
    ['Sahil%',     'Yashvi/Priyanka'],
    ['Ekdant%',    'Yashvi/Priyanka'],
    // QA: Nandani
    ['Pooja%',     'Nandani'],
    ['Vikrant%',   'Nandani'],
    ['Nandini%',   'Nandani'],  // Nandini Jain
    ['Anjana%',    'Nandani'],
    ['Nityaa%',    'Nandani'],  // "Nitya" in sheet = Nityaa in DB
    ['Anjali%',    'Nandani'],
    ['Pranav%',    'Nandani'],
    // QA: Sindhu
    ['Jatin%',     'Sindhu'],
    ['Viraj%',     'Sindhu'],
    ['Elton%',     'Sindhu'],
    ['Sneha%',     'Sindhu'],
    ['Bhavana%',   'Sindhu'],
    ['Vaibhavi%',  'Sindhu'],
  ];

  for (const [pattern, qa, opts] of qaMap) {
    const updated = await setQA(pattern, qa, opts || {});
    if (updated.length) console.log(`  QA=${qa}: ${updated.join(', ')}`);
  }

  console.log('\n=== Final state ===');
  const final = await q('SELECT name, tl_name, qa_name FROM agents ORDER BY name');
  final.forEach(a => console.log(`  ${a.name} | TL: ${a.tl_name || '—'} | QA: ${a.qa_name || '—'}`));

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
