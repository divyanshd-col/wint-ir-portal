import fs from 'fs';
import path from 'path';

// ── Load .env.local first ──────────────────────────────────────────────────
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

import { query } from '../lib/cx/db';
import { executeScoring } from '../lib/scoring/engine';
import { getAgentName } from '../lib/robylon/db';

async function main() {
  const limitArgIdx = process.argv.indexOf('--limit');
  const limit = limitArgIdx >= 0 ? parseInt(process.argv[limitArgIdx + 1], 10) : null;

  const concurrencyArgIdx = process.argv.indexOf('--concurrency');
  const concurrency = concurrencyArgIdx >= 0 ? parseInt(process.argv[concurrencyArgIdx + 1], 10) : 5;

  console.log('--- STARTING BOT CHATS RE-RUN PROCESS ---');
  console.log(`- Cutoff date: 2026-06-15 00:00:00`);
  console.log(`- Concurrency limit: ${concurrency}`);
  if (limit) console.log(`- Batch limit: ${limit}`);

  // Fetch bot-only chats closed from 15th June onwards
  let sql = `
    SELECT id, agent_id, tags, closed_at, transcript 
    FROM conversations 
    WHERE conversation_type = 'bot' 
      AND closed_at >= '2026-06-15 00:00:00'
    ORDER BY closed_at DESC
  `;
  if (limit) {
    sql += ` LIMIT ${limit}`;
  }

  const convs = await query<any>(sql);
  const total = convs.length;
  console.log(`- Found ${total} chats to re-run.\n`);

  if (total === 0) {
    console.log('No chats found matching criteria. Exiting.');
    process.exit(0);
  }

  // Pre-fetch knowledge chunks once to warm up the in-memory cache and avoid concurrent cache stampedes
  console.log('- Pre-fetching Knowledge Base context to warm up cache...');
  try {
    const { fetchKnowledgeChunks } = await import('../lib/drive');
    await fetchKnowledgeChunks();
    console.log('- Cache warmed up successfully!\n');
  } catch (err: any) {
    console.warn('- Cache warm up warning (will fetch on demand):', err.message);
  }

  let completed = 0;
  let succeeded = 0;
  let failed = 0;
  const startTime = Date.now();

  // Simple concurrency worker pool
  const queue = [...convs];
  const workers = Array.from({ length: concurrency }, async () => {
    while (queue.length > 0) {
      const conv = queue.shift();
      if (!conv) break;

      const chatId = conv.id;
      const tags = conv.tags || {};
      const disposition = tags.disposition || '';
      const subDisposition = tags.sub_disposition || '';

      try {
        const agentName = conv.agent_id ? await getAgentName(conv.agent_id) : '';
        const result = await executeScoring(conv, agentName, disposition, subDisposition);
        
        completed++;
        succeeded++;
        const iqsVal = result ? result.iqs : 'N/A';
        console.log(`[${completed}/${total}] Chat ${chatId.padEnd(8)}: Succeeded! (IQS: ${iqsVal})`);
      } catch (err: any) {
        completed++;
        failed++;
        console.error(`[${completed}/${total}] Chat ${chatId.padEnd(8)}: FAILED. Error: ${err.message}`);
      }
    }
  });

  await Promise.all(workers);

  const elapsedMins = ((Date.now() - startTime) / 60000).toFixed(2);
  console.log('\n--- RE-RUN PROCESS COMPLETED ---');
  console.log(`- Total processed : ${completed}`);
  console.log(`- Succeeded       : ${succeeded}`);
  console.log(`- Failed          : ${failed}`);
  console.log(`- Elapsed time    : ${elapsedMins} minutes`);
  
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error during main execution:', err);
  process.exit(1);
});
