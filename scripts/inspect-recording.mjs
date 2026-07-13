import pg from 'pg';
import { readFileSync } from 'fs';
import { GoogleGenAI } from '@google/genai';
import path from 'path';

let apiKey = process.env.GEMINI_API_KEY || process.env.IQS_GEMINI_API_KEY;
try {
  const raw = readFileSync('./portal-config.json', 'utf-8');
  const parsed = JSON.parse(raw);
  apiKey = parsed.iqsGeminiApiKey || parsed.geminiApiKey || apiKey;
} catch {}

const dbUrl = process.env.POSTGRES_URL || process.env.POSTGRES_URL_NON_POOLING || "postgresql://neondb_owner:npg_enEoNcvm25SZ@ep-flat-poetry-amiar3g2-pooler.c-5.us-east-1.aws.neon.tech/neondb?sslmode=require";

async function main() {
  const pool = new pg.Pool({ connectionString: dbUrl });
  const dbRes = await pool.query('SELECT id, recording_url, duration_seconds, status FROM call_recordings WHERE id = $1', [98261]);
  if (dbRes.rows.length === 0) {
    console.error('Call 98261 not found in database');
    await pool.end();
    return;
  }
  const call = dbRes.rows[0];
  console.log('Database Row:', JSON.stringify(call, null, 2));

  console.log('Fetching audio headers...');
  const res = await fetch(call.recording_url);
  console.log('HTTP Status:', res.status);
  console.log('Content-Length:', res.headers.get('content-length'));
  console.log('Content-Type:', res.headers.get('content-type'));

  const arrayBuffer = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  console.log('Downloaded Buffer Size (bytes):', buffer.length);

  // Upload to Gemini
  const ai = new GoogleGenAI({ apiKey });
  const tempPath = './temp-test-audio.wav';
  const fs = await import('fs/promises');
  await fs.writeFile(tempPath, buffer);

  console.log('Uploading to Gemini File API...');
  const uploadResult = await ai.files.upload({
    file: tempPath,
    config: { mimeType: 'audio/wav' }
  });
  console.log('Upload Result:', JSON.stringify(uploadResult, null, 2));

  console.log('Polling status...');
  let fileInfo = uploadResult;
  let count = 0;
  while (fileInfo.state === 'PROCESSING' && count < 30) {
    await new Promise(r => setTimeout(r, 2000));
    fileInfo = await ai.files.get({ name: uploadResult.name });
    console.log(`Poll ${count + 1} State:`, fileInfo.state);
    count++;
  }

  // Generate metadata info using Gemini
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: [
      {
        fileData: {
          fileUri: fileInfo.uri,
          mimeType: fileInfo.mimeType
        }
      },
      'Tell me the exact duration of this audio file in seconds, and describe any sounds or voices you hear in it.'
    ]
  });

  console.log('Gemini Metadata response:', response.text);

  // Clean up
  try {
    await ai.files.delete({ name: uploadResult.name });
  } catch {}
  await fs.unlink(tempPath);
  await pool.end();
}

main().catch(console.error);
