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
  const client = await pool.connect();
  try {
    console.log('--- STARTING HISTORICAL IQS SCORE BACKFILL TRANSACTION ---');
    await client.query('BEGIN');

    // 1. Set agent_iqs to null in __scores JSONB where all agent parameters are NA
    const q1 = await client.query(`
      UPDATE iqs_scores s
      SET parameters = jsonb_set(s.parameters, '{__scores,agent_iqs}', 'null'::jsonb)
      FROM conversations c
      WHERE c.id = s.chat_id
        AND c.conversation_type IN ('hybrid', 'agent')
        AND s.parameters ? '__agent_parameters'
        AND NOT EXISTS (
          SELECT 1 FROM jsonb_each(s.parameters->'__agent_parameters') AS p(k, v)
          WHERE p.v->>'score' IS NOT NULL AND p.v->>'score' NOT IN ('null', '')
        )
    `);
    console.log(`1. Updated __scores.agent_iqs to null for ${q1.rowCount} chats with all NA parameters.`);

    // 2. Set top-level iqs_score column to NULL for agent/hybrid chats with all NA parameters
    const q2 = await client.query(`
      UPDATE iqs_scores s
      SET iqs_score = NULL
      FROM conversations c
      WHERE c.id = s.chat_id
        AND c.conversation_type IN ('hybrid', 'agent')
        AND s.parameters ? '__agent_parameters'
        AND NOT EXISTS (
          SELECT 1 FROM jsonb_each(s.parameters->'__agent_parameters') AS p(k, v)
          WHERE p.v->>'score' IS NOT NULL AND p.v->>'score' NOT IN ('null', '')
        )
    `);
    console.log(`2. Updated top-level iqs_score column to NULL for ${q2.rowCount} chats with all NA parameters.`);

    // 3. Sync top-level iqs_score column with agent_iqs for all hybrid chats
    const q3 = await client.query(`
      UPDATE iqs_scores s
      SET iqs_score = CASE 
        WHEN s.parameters->'__scores'->>'agent_iqs' = 'null' OR s.parameters->'__scores'->>'agent_iqs' IS NULL THEN NULL 
        ELSE (s.parameters->'__scores'->>'agent_iqs')::integer 
      END
      FROM conversations c
      WHERE c.id = s.chat_id
        AND c.conversation_type = 'hybrid'
        AND s.iqs_score IS DISTINCT FROM (
          CASE 
            WHEN s.parameters->'__scores'->>'agent_iqs' = 'null' OR s.parameters->'__scores'->>'agent_iqs' IS NULL THEN NULL 
            ELSE (s.parameters->'__scores'->>'agent_iqs')::integer 
          END
        )
    `);
    console.log(`3. Synced iqs_score column with agent_iqs for ${q3.rowCount} hybrid chats where column mismatched.`);

    await client.query('COMMIT');
    console.log('--- TRANSACTION COMMITTED SUCCESSFULLY ---');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error during backfill transaction, rolled back:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
