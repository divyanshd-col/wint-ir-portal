const fs = require('fs');
const { Pool } = require('pg');

const envPath = '/Users/admin/Documents/WintWealth/wint-ir-portal/.env.local';
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
  console.log('=== STARTING DATABASE REMEDIATION FOR MISLINKED CALL RECORDINGS ===\n');

  // Find all call recordings currently linked to a chat whose timeframe does not contain called_at
  const mislinkedRes = await pool.query(`
    SELECT cr.id AS call_id, cr.chat_id AS current_chat_id, cr.called_at, cr.contact_id,
           c.started_at AS chat_started_at, c.closed_at AS chat_closed_at
    FROM call_recordings cr
    JOIN conversations c ON c.id::text = cr.chat_id
    WHERE cr.called_at IS NOT NULL
      AND (
        cr.called_at < c.started_at
        OR (c.closed_at IS NOT NULL AND cr.called_at > c.closed_at)
      )
    ORDER BY cr.called_at DESC
  `);

  console.log(`Found ${mislinkedRes.rows.length} mislinked call recordings to remediate.`);

  let relinkedCount = 0;
  let unlinkedCount = 0;

  for (const row of mislinkedRes.rows) {
    let correctChatRes = { rows: [] };
    if (row.contact_id) {
      correctChatRes = await pool.query(`
        SELECT id, started_at, closed_at
        FROM conversations
        WHERE contact_id = $1
          AND started_at <= $2
          AND COALESCE(closed_at, NOW()) >= $2
        ORDER BY started_at DESC
        LIMIT 1
      `, [row.contact_id, row.called_at]);
    }

    const correctChat = correctChatRes.rows[0];

    if (correctChat) {
      await pool.query(`
        UPDATE call_recordings
        SET chat_id = $1, status = 'linked', updated_at = NOW()
        WHERE id = $2
      `, [correctChat.id, row.call_id]);
      relinkedCount++;
      console.log(`[RELINKED] Call ${row.call_id} (called ${row.called_at.toISOString()}) moved from Chat ${row.current_chat_id} -> Chat ${correctChat.id}`);
    } else {
      await pool.query(`
        UPDATE call_recordings
        SET chat_id = NULL, status = 'pending_link', updated_at = NOW()
        WHERE id = $1
      `, [row.call_id]);
      unlinkedCount++;
      console.log(`[UNLINKED] Call ${row.call_id} (called ${row.called_at.toISOString()}) unlinked from Chat ${row.current_chat_id} (no active chat window at called_at)`);
    }
  }

  console.log('\n=== REMEDIATION SUMMARY ===');
  console.log(`Total Processed: ${mislinkedRes.rows.length}`);
  console.log(`Re-linked to Correct Chat: ${relinkedCount}`);
  console.log(`Unlinked (chat_id = NULL): ${unlinkedCount}`);

  await pool.end();
}

main().catch(err => {
  console.error(err);
  pool.end();
});
