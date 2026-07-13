import { query } from './lib/cx/db.ts';
async function run() {
  const res = await query('SELECT id, chat_id, status, duration_seconds FROM call_recordings WHERE id IN ($1, $2)', ['98621', '98261']);
  console.log(res);
  process.exit(0);
}
run();
