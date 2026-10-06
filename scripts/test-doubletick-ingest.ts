import fs from 'fs';
import path from 'path';

// Load .env manually
const envPath = path.join(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  const envConfig = fs.readFileSync(envPath, 'utf8');
  for (const line of envConfig.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx > 0) {
      const key = trimmed.substring(0, idx).trim();
      let val = trimmed.substring(idx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      process.env[key] = val;
    }
  }
}

import { query } from '../lib/cx/db';

async function runTest() {
  console.log('--- TESTING DOUBLETICK INGESTION SCRIPT ---');

  const testPayload = [
    {
      "wabaNumber": "17272141402",
      "Chat ID": "05c76e35-0949-4023-8147-ce07d678e3c6",
      "Message ID": "0788273f-8989-43e4-85c0-6d49e9664561",
      "Customer Name": "sachin",
      "Customer Phone": "919971530964",
      "Chat Type": "INDIVIDUAL",
      "WABA Number": "17272141402",
      "Assigned Agent": "KB File Test",
      "Chat Status": "OPEN",
      "Last Message At": "2026-08-21T09:12:38.397Z",
      "Direction": "Agent",
      "Sent By": "Mitul Varshney",
      "Message Type": "template",
      "Content": ". Hi\n\n_This is a test message_",
      "Sent At": "2026-08-07T14:47:50.000Z"
    }
  ];

  // Insert test payload directly via saveRobylonWebhookPayload
  const { saveRobylonWebhookPayload } = await import('../lib/robylon/db');
  
  await saveRobylonWebhookPayload({
    source: 'doubletick',
    eventType: 'CHAT_EXPORT',
    eventId: testPayload[0]["Message ID"],
    chatId: testPayload[0]["Chat ID"],
    payload: testPayload,
    headers: { "user-agent": "doubletick-test" }
  });

  console.log('✅ Ingestion completed. Querying robylon_webhook_payloads for inserted record...');

  const result = await query(`
    SELECT * FROM robylon_webhook_payloads 
    WHERE source = 'doubletick' AND chat_id = $1 
    ORDER BY id DESC LIMIT 1
  `, [testPayload[0]["Chat ID"]]);

  console.log('=== VERIFIED DB ROW ===');
  console.log({
    id: result[0]?.id,
    source: result[0]?.source,
    channel: result[0]?.channel,
    chat_id: result[0]?.chat_id,
    received_at: result[0]?.received_at,
    payload_sample: result[0]?.payload
  });

  if (result.length > 0 && result[0].source === 'doubletick') {
    console.log('\n🎉 TEST PASSED: DoubleTick payload ingested and verified in database cleanly!');
  } else {
    console.error('\n❌ TEST FAILED: Row was not found or source mismatch!');
  }
}

runTest().catch(console.error);
