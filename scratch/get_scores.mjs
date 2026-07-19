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
  const chatIds = ['99615', '103865', '103577', '104758'];
  console.log(`Fetching scores for chats: ${chatIds.join(', ')}`);
  
  const res = await pool.query(
    `SELECT chat_id, iqs_score, call_iqs_score, scored_at FROM iqs_scores WHERE chat_id = ANY($1)`,
    [chatIds]
  );
  
  console.log('\nResults for requested chats:');
  console.log(JSON.stringify(res.rows, null, 2));

  console.log('\nFinding the single failed chat from the re-run batch...');
  
  const sql = `
    SELECT c.id, c.agent_id, c.tags, c.closed_at, c.transcript, i.scored_at, i.iqs_score
    FROM conversations c
    LEFT JOIN iqs_scores i ON i.chat_id = c.id
    WHERE c.conversation_type = 'bot' 
      AND c.closed_at >= '2026-06-15 00:00:00'
    ORDER BY c.closed_at DESC
  `;
  
  const allRes = await pool.query(sql);
  
  // Filter exactly like rerun-bot-scores.ts does to find truly bot-only chats (Type 1)
  const convs = allRes.rows.filter((conv) => {
    let transcriptMessages = [];
    if (Array.isArray(conv.transcript)) {
      transcriptMessages = conv.transcript;
    } else if (conv.transcript && typeof conv.transcript === 'object' && Array.isArray(conv.transcript.messages)) {
      transcriptMessages = conv.transcript.messages;
    }
    const hasHuman = transcriptMessages.some((m) => {
      const sender = (m.sender || m.role || m.sender_name || '').trim().toLowerCase();
      const isCustomer = ['user', 'customer', 'visitor'].includes(sender);
      const isBot = ['myra', 'bot', 'wint bot', 'wintbot'].includes(sender) || sender === 'robylon ai';
      const isSystem = m.sender_type === 'activity' || sender === 'system';
      const isInternal = m.is_private === true || m.is_internal === true || sender === 'internal note';
      return !isCustomer && !isBot && !isSystem && !isInternal && sender !== '';
    });
    return !hasHuman;
  });

  // We are looking for the one that failed to re-run today (July 17, 2026)
  // Those that succeeded will have iqs_scores.scored_at >= '2026-07-17 00:00:00'
  const failed = convs.filter(c => {
    if (!c.scored_at) return true;
    const scoredDate = new Date(c.scored_at);
    // Scored date is before today (July 17, 2026)
    return scoredDate.getTime() < new Date('2026-07-17T00:00:00').getTime();
  });

  console.log(`\nFailed / Unprocessed today: ${failed.length} chats`);
  for (const c of failed) {
    console.log(`- Chat ID: ${c.id}`);
    console.log(`  Closed At: ${c.closed_at}`);
    console.log(`  Last Scored At: ${c.scored_at || 'Never'}`);
    console.log(`  Last Score: ${c.iqs_score || 'None'}`);
    console.log(`  Tags: ${JSON.stringify(c.tags)}`);
  }
  
  await pool.end();
}

main().catch(err => {
  console.error(err);
  pool.end();
});
