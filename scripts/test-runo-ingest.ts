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
  console.log('=== RUNO PCG CALL INGESTION TEST ===\n');

  // Test 1: Outgoing Answered
  const outgoingAnswered = {
    "callId": "68fb1d8ecf9af992f3132454",
    "callerId": "9435bc08-90a1-4c5d-ae36-aea519399990",
    "calledBy": "Gokul_Admin",
    "name": "Aravind",
    "customerId": "686b70872fd7398ef7f40ab8",
    "phoneNumber": "+919014502431",
    "startTime": 1761287562,
    "duration": 5,
    "type": "outgoing",
    "tag": null,
    "createdAt": 1761287589,
    "userPhone": "+919989766169",
    "processId": "67739f61c4f766bab7c0e5e9"
  };

  // Test 2: Outgoing Unanswered
  const outgoingUnanswered = {
    "callId": "68fb1db30b47ebec21eff808",
    "callerId": "9435bc08-90a1-4c5d-ae36-aea519399990",
    "calledBy": "Gokul_Admin",
    "name": "Aravind",
    "customerId": "686b70872fd7398ef7f40ab8",
    "phoneNumber": "+919014502431",
    "startTime": 1761287599,
    "duration": 0,
    "type": "outgoing",
    "tag": "unanswered",
    "createdAt": 1761287611,
    "userPhone": "+919989766169",
    "processId": "67739f61c4f766bab7c0e5e9"
  };

  // Test 3: Incoming Missed
  const incomingMissed = {
    "callId": "68fb1de0fb0d6e3a6c32f026",
    "callerId": "9435bc08-90a1-4c5d-ae36-aea519399990",
    "calledBy": "Gokul_Admin",
    "name": "Aravind",
    "customerId": "686b70872fd7398ef7f40ab8",
    "phoneNumber": "+919014502431",
    "startTime": 1761287644,
    "duration": 0,
    "type": "missed",
    "tag": null,
    "createdAt": 1761287654,
    "userPhone": "+919989766169",
    "processId": "67739f61c4f766bab7c0e5e9"
  };

  // Test 4: Incoming Answered
  const incomingAnswered = {
    "callId": "68fb1eeb0b47ebec21effc1b",
    "callerId": "9435bc08-90a1-4c5d-ae36-aea519399990",
    "calledBy": "Gokul_Admin",
    "name": "Aravind",
    "customerId": "686b70872fd7398ef7f40ab8",
    "phoneNumber": "+919014502431",
    "startTime": 1761287908,
    "duration": 5,
    "type": "incoming",
    "tag": null,
    "createdAt": 1761287924,
    "userPhone": "+919989766169",
    "processId": "67739f61c4f766bab7c0e5e9"
  };

  // Test 5: AWS Call Recording URL Payload for Incoming Answered
  const awsRecordingPayload = {
    "callId": "68fb1eeb0b47ebec21effc1b",
    "recordingUrl": "https://gokulrunocrm.s3.amazonaws.com/recordings/67739f5121e7b6558e8b0809/9435bc08-90a1-4c5d-ae36-aea519399990/68f8874982b8404525ffcb66_1761118033994-converted.aac"
  };

  // Import POST handler from route handler
  const { POST } = await import('../app/api/webhooks/runo/route');

  const testPayloads = [
    { name: 'Outgoing Answered', payload: outgoingAnswered },
    { name: 'Outgoing Unanswered', payload: outgoingUnanswered },
    { name: 'Incoming Missed', payload: incomingMissed },
    { name: 'Incoming Answered', payload: incomingAnswered },
    { name: 'AWS Recording URL', payload: awsRecordingPayload },
  ];

  for (const item of testPayloads) {
    console.log(`Sending payload: ${item.name}...`);
    const req = new Request('http://localhost:3000/api/webhooks/runo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(item.payload),
    });

    const res = await POST(req as any);
    const json = await res.json();
    console.log(`Result for ${item.name}:`, json);
  }

  console.log('\n--- VERIFYING INSERTED ROWS IN DB ---');
  const rows = await query(`
    SELECT id, call_id, agent_name, phone_number, call_type, tag, duration_seconds, recording_url, start_time
    FROM pcg_call_recordings
    ORDER BY id ASC
  `);

  console.log(`Total rows in pcg_call_recordings: ${rows.length}`);
  console.log(rows);

  const rawRows = await query(`
    SELECT id, source, event_type, chat_id, received_at
    FROM robylon_webhook_payloads
    WHERE source = 'runo'
    ORDER BY id DESC LIMIT 5
  `);
  console.log('\nRaw payloads in robylon_webhook_payloads:', rawRows);

  if (rows.length >= 4 && rawRows.length >= 5) {
    console.log('\n🎉 TEST PASSED: All Runo sample call payloads ingested and verified in database cleanly!');
  } else {
    console.error('\n❌ TEST FAILED: Rows missing!');
  }
}

runTest().catch(console.error);
