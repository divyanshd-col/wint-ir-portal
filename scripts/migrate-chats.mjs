import fs from 'fs';
import { Pool } from 'pg';

const envPath = './.env.local';
const envContent = fs.readFileSync(envPath, 'utf8');
envContent.split('\n').forEach(line => {
  const match = line.match(/^\s*([^#=]+)\s*=\s*(.*)$/);
  if (match) {
    const key = match[1].trim();
    let val = match[2].trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
    process.env[key] = val;
  }
});

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL,
  ssl: false
});

async function main() {
  const isConfirm = process.argv.includes('--confirm');
  console.log(`Migration mode: ${isConfirm ? '⚠️  LIVE UPDATE' : '🔍 DRY RUN (pass --confirm to write)'}`);

  // Count first
  const countQuery = `
    SELECT conversation_type, COUNT(*) as count
    FROM conversations c
    WHERE conversation_type IN ('agent', 'hybrid')
      AND (
        transcript IS NULL OR
        NOT EXISTS (
          SELECT 1
          FROM jsonb_to_recordset(c.transcript) AS x(sender_type text, sender_name text)
          WHERE x.sender_type = 'agent'
            AND LOWER(COALESCE(x.sender_name, '')) NOT IN ('myra', 'bot', 'wint bot', 'wintbot', 'robylon ai')
        )
      )
    GROUP BY conversation_type
  `;
  const countRes = await pool.query(countQuery);
  console.log('\nMismatch counts to update:');
  console.log(countRes.rows);

  const totalToUpdate = countRes.rows.reduce((sum, r) => sum + parseInt(r.count, 10), 0);
  if (totalToUpdate === 0) {
    console.log('No mismatched conversations found. Nothing to update.');
    await pool.end();
    return;
  }

  if (!isConfirm) {
    console.log('\nDry run complete. Run with --confirm to update the database.');
    await pool.end();
    return;
  }

  console.log(`\nUpdating ${totalToUpdate} conversations to 'bot' type…`);
  const updateQuery = `
    UPDATE conversations c
    SET conversation_type = 'bot'
    WHERE conversation_type IN ('agent', 'hybrid')
      AND (
        transcript IS NULL OR
        NOT EXISTS (
          SELECT 1
          FROM jsonb_to_recordset(c.transcript) AS x(sender_type text, sender_name text)
          WHERE x.sender_type = 'agent'
            AND LOWER(COALESCE(x.sender_name, '')) NOT IN ('myra', 'bot', 'wint bot', 'wintbot', 'robylon ai')
        )
      )
  `;
  const updateRes = await pool.query(updateQuery);
  console.log(`Successfully updated ${updateRes.rowCount} conversation records.`);

  await pool.end();
}

main().catch(err => {
  console.error(err);
  pool.end();
});
