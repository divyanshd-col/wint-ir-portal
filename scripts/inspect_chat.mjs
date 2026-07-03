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
  const chatId = '80527';
  console.log(`Inspecting Chat ID: ${chatId}`);

  const convRows = await pool.query('SELECT * FROM conversations WHERE id = $1', [chatId]);
  console.log('\n--- CONVERSATION ---');
  if (convRows.rows.length === 0) {
    console.log('No conversation found');
    await pool.end();
    return;
  }
  const conv = convRows.rows[0];
  console.log('ID:', conv.id);
  console.log('Agent ID:', conv.agent_id);
  console.log('Contact ID:', conv.contact_id);
  console.log('Started At:', conv.started_at);
  console.log('Closed At:', conv.closed_at);
  console.log('Tags:', JSON.stringify(conv.tags, null, 2));

  const iqsRows = await pool.query('SELECT * FROM iqs_scores WHERE chat_id = $1', [chatId]);
  console.log('\n--- IQS SCORES ---');
  if (iqsRows.rows.length === 0) {
    console.log('No IQS scores found');
  } else {
    const iqs = iqsRows.rows[0];
    console.log('IQS Score:', iqs.iqs_score);
    console.log('Parameters:', JSON.stringify(iqs.parameters, null, 2));
    console.log('Call IQS Score:', iqs.call_iqs_score);
    console.log('Call Parameters:', JSON.stringify(iqs.call_parameters, null, 2));
    console.log('Call Scored At:', iqs.call_scored_at);
  }

  const callRows = await pool.query(
    'SELECT * FROM call_recordings WHERE chat_id = $1 OR (contact_id = $2 AND called_at >= $3::timestamptz - interval \'1 hour\' AND called_at <= $4::timestamptz + interval \'1 hour\')',
    [chatId, conv.contact_id, conv.started_at, conv.closed_at]
  );
  console.log('\n--- CALL RECORDINGS ---');
  console.log('Count:', callRows.rows.length);
  for (const call of callRows.rows) {
    console.log(`- ID: ${call.id}, Url: ${call.recording_url}, Called At: ${call.called_at}, Status: ${call.status}, Duration: ${call.duration_seconds}s`);
    console.log('  Transcript Snippet:', JSON.stringify((call.transcript || []).slice(0, 5), null, 2));
  }

  await pool.end();
}

main().catch(err => {
  console.error(err);
  pool.end();
});
