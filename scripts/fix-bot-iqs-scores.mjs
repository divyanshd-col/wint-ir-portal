import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';

const envPath = path.resolve('./.env.local');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const match = line.match(/^\s*([^#=]+)\s*=\s*(.*)$/);
    if (match) {
      let val = match[2].trim();
      if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
      if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
      process.env[match[1].trim()] = val;
    }
  });
}

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL,
  ssl: false
});

async function main() {
  const targetChatIds = ['110969', '110682', '110572', '110213', '110020'];
  console.log('--- BULK FIXING BOT-ONLY IQS SCORES IN POSTGRESQL ---');

  const res = await pool.query(`
    UPDATE iqs_scores i
    SET parameters = jsonb_set(
      jsonb_set(
        COALESCE(i.parameters, '{}'::jsonb),
        '{__scores}',
        jsonb_build_object(
          'agent_iqs', null,
          'bot_iqs', COALESCE(
            (i.parameters->'__scores'->>'agent_iqs')::numeric,
            (i.parameters->'__scores'->>'bot_iqs')::numeric,
            i.iqs_score
          )
        )
      ),
      '{__bot_parameters}',
      COALESCE(i.parameters->'__bot_parameters', i.parameters->'__agent_parameters', '{}'::jsonb)
    )
    FROM conversations c
    LEFT JOIN agents a ON a.id = c.agent_id
    WHERE c.id = i.chat_id
      AND (c.conversation_type = 'bot' OR a.name = 'Robylon AI' OR c.agent_id IN (15, 447, 784))
  `);

  console.log(`Updated ${res.rowCount} bot-only chat rows in iqs_scores in bulk.\n`);

  console.log('--- VERIFYING TARGET CHAT IDS ---');
  const targetRows = await pool.query(`
    SELECT chat_id, iqs_score, parameters->'__scores' AS scores
    FROM iqs_scores
    WHERE chat_id = ANY($1)
  `, [targetChatIds]);

  for (const row of targetRows.rows) {
    console.log(`Chat ID ${row.chat_id}: iqs_score=${row.iqs_score}, __scores=${JSON.stringify(row.scores)}`);
  }
}

main().catch(console.error).finally(() => pool.end());
