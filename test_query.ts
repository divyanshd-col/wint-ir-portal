import { query } from './lib/cx/db';

async function run() {
  const res = await query('SELECT parameters FROM iqs_scores WHERE parameters IS NOT NULL AND parameters::text LIKE \'%reasoning%\' LIMIT 1');
  console.log(JSON.stringify(res[0], null, 2));
}

run().catch(console.error).finally(() => process.exit(0));
