/**
 * Syncs user_id from users table onto agents table based on name / email matching.
 * Run with: node scripts/sync-agent-users.mjs
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import pg from 'pg';

try {
  const env = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim().replace(/^"|"$/g, '');
  }
} catch {}

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL,
  ssl: { rejectUnauthorized: false },
});

async function main() {
  console.log('=== Syncing agents.user_id with users table ===');
  
  const users = (await pool.query(`SELECT user_id, email, name FROM users`)).rows;
  const agents = (await pool.query(`SELECT id, name, user_id FROM agents`)).rows;
  
  let updatedCount = 0;
  for (const a of agents) {
    // Find matching user by exact name or exact prefix
    const matchedUser = users.find(u => 
      u.name.toLowerCase().trim() === a.name.toLowerCase().trim()
    );

    if (matchedUser && a.user_id !== matchedUser.user_id) {
      await pool.query(`UPDATE agents SET user_id = $1 WHERE id = $2`, [matchedUser.user_id, a.id]);
      console.log(`Linked agent [${a.id}] '${a.name}' -> user [${matchedUser.user_id}] '${matchedUser.name}' (${matchedUser.email})`);
      updatedCount++;
    }
  }

  console.log(`\nDone! Linked ${updatedCount} agents to identity users.`);
  await pool.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
