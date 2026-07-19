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

const BOT_NAMES = new Set(['myra', 'bot', 'wint bot', 'wintbot', 'robylon ai']);

function isCustomer(sender) {
  return ['user', 'customer', 'visitor'].includes((sender || '').toLowerCase());
}

function isBot(sender) {
  return BOT_NAMES.has((sender || '').toLowerCase());
}

function isHumanAgent(sender) {
  const low = (sender || '').toLowerCase();
  return !isCustomer(sender) && !isBot(sender) && low !== 'internal note' && low !== 'system';
}

async function main() {
  console.log('Fetching all conversations…');
  const res = await pool.query('SELECT id, conversation_type, transcript FROM conversations');
  console.log(`Fetched ${res.rows.length} conversations.`);

  let hybridToBotCount = 0;
  let agentToBotCount = 0;
  const updates = [];

  for (const row of res.rows) {
    const messages = Array.isArray(row.transcript) ? row.transcript : [];
    // Count human agent messages in the normalized transcript
    const humanAgentMsgs = messages.filter(m => {
      // Exclude internal notes & activities if needed, but isHumanAgent already handles names
      const sender = m.sender_name || (m.sender_type === 'customer' ? 'User' : m.sender_type === 'bot' ? 'Bot' : 'Agent');
      return m.sender_type === 'agent' && isHumanAgent(sender) && !m.is_internal;
    });

    if (humanAgentMsgs.length === 0) {
      if (row.conversation_type === 'hybrid') {
        hybridToBotCount++;
        updates.push({ id: row.id, from: 'hybrid', to: 'bot' });
      } else if (row.conversation_type === 'agent') {
        agentToBotCount++;
        updates.push({ id: row.id, from: 'agent', to: 'bot' });
      }
    }
  }

  console.log(`\nConversations that should be changed to 'bot':`);
  console.log(`- Hybrid -> Bot: ${hybridToBotCount}`);
  console.log(`- Agent -> Bot: ${agentToBotCount}`);
  console.log(`- Total: ${updates.length}`);

  if (updates.length > 0) {
    console.log('\nExample chats that need update:');
    console.log(updates.slice(0, 10));
  }

  await pool.end();
}

main().catch(err => {
  console.error(err);
  pool.end();
});
