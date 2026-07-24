const fs = require('fs');
const { Pool } = require('/Users/admin/Documents/WintWealth/wint-ir-portal/node_modules/pg');

const envPath = '/Users/admin/Documents/WintWealth/wint-ir-portal/.env.local';
if (fs.existsSync(envPath)) {
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
}

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
const isSsl = connectionString && (
  connectionString.includes('sslmode=') ||
  connectionString.includes('neon.tech') ||
  connectionString.includes('vercel-storage.com') ||
  connectionString.includes('rds.amazonaws.com')
);

const pool = new Pool({
  connectionString,
  ssl: isSsl ? { rejectUnauthorized: false } : false
});

async function main() {
  const client = await pool.connect();
  try {
    console.log('--- STARTING BULK UPDATE: MARKING PENDING CHATS CLOSED BEFORE 15 JUNE 2026 AS REVIEWED ---');

    await client.query('BEGIN');

    const updateQuery = `
      UPDATE iqs_scores i
      SET status = 'reviewed',
          reviewed_by = $1,
          reviewed_at = NOW(),
          review_note = $2
      FROM conversations c
      WHERE c.id = i.chat_id
        AND i.status IN ('pending', 'reopened')
        AND c.closed_at < '2026-06-15 00:00:00';
    `;

    const res = await client.query(updateQuery, [
      'bulk_admin@wintwealth.com',
      'Bulk marked as reviewed for chats closed before 15 June 2026'
    ]);

    console.log(`\nSuccessfully updated ${res.rowCount} chats to status = 'reviewed'.`);

    await client.query('COMMIT');
    console.log('Transaction committed successfully.');

    // Verification check
    const verifyRes = await client.query(`
      SELECT COUNT(*) as remaining_pending
      FROM iqs_scores i
      JOIN conversations c ON c.id = i.chat_id
      WHERE i.status IN ('pending', 'reopened')
        AND c.closed_at < '2026-06-15 00:00:00'
    `);

    console.log(`Remaining pending chats closed before 15 June 2026: ${verifyRes.rows[0].remaining_pending}`);

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error executing update, transaction rolled back:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
