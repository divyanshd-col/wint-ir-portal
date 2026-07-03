import fs from 'fs';
import { Pool } from 'pg';

const envPath = './.env.local';
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

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL,
  ssl: false
});

async function main() {
  const res = await pool.query(`
    SELECT id, tags, started_at, closed_at 
    FROM conversations 
    WHERE tags IS NOT NULL
    LIMIT 20
  `);
  
  console.log("Conversations:");
  console.log(JSON.stringify(res.rows, null, 2));

  // Let's query a conversation or IQS score that has chat transcript logged
  // Wait, does conversations have a transcript column? Let's check conversation columns:
  const columnsRes = await pool.query(`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = 'conversations'
  `);
  console.log("\nConversation Columns:");
  console.log(JSON.stringify(columnsRes.rows, null, 2));

  // Let's see what tables we have in public schema:
  const tablesRes = await pool.query(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public'
  `);
  console.log("\nTables:");
  console.log(JSON.stringify(tablesRes.rows, null, 2));

  await pool.end();
}

main().catch(console.error);
