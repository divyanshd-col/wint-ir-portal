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
  const chats = ['47750', '34081'];
  for (const id of chats) {
    const res = await pool.query('SELECT id, transcript, tags FROM conversations WHERE id = $1', [id]);
    console.log(`\n================= CHAT ${id} =================`);
    if (res.rows.length === 0) {
      console.log("Not found");
    } else {
      const row = res.rows[0];
      console.log("Tags:", JSON.stringify(row.tags, null, 2));
      console.log("Transcript:");
      console.log(JSON.stringify(row.transcript, null, 2));
    }
  }
  await pool.end();
}

main().catch(console.error);
