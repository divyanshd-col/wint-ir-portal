import { query } from './lib/db.js';

async function main() {
  const result = await query("SELECT id, conversation_type FROM conversations WHERE conversation_type = 'hybrid' LIMIT 10");
  console.log(result.rows);
}
main().catch(console.error);
