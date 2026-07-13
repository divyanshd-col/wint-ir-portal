import { readFileSync, existsSync, writeFileSync } from 'fs';
import { GoogleGenAI } from '@google/genai';

let apiKey = process.env.GEMINI_API_KEY || process.env.IQS_GEMINI_API_KEY;
try {
  const raw = readFileSync('./portal-config.json', 'utf-8');
  const parsed = JSON.parse(raw);
  apiKey = parsed.iqsGeminiApiKey || parsed.geminiApiKey || apiKey;
} catch {}

async function main() {
  const ai = new GoogleGenAI({ apiKey });
  const tempPath = './test-temp-file.txt';
  writeFileSync(tempPath, 'Hello Gemini File API test content!');

  console.log('Uploading test file...');
  const uploadResult = await ai.files.upload({
    file: tempPath,
    config: { mimeType: 'text/plain' }
  });

  console.log('Upload Result Structure:', JSON.stringify(uploadResult, null, 2));

  console.log('Polling file info...');
  const fileInfo = await ai.files.get({ name: uploadResult.name });
  console.log('File Info from get():', JSON.stringify(fileInfo, null, 2));

  // Clean up
  try {
    await ai.files.delete({ name: uploadResult.name });
  } catch {}
  const fs = await import('fs/promises');
  await fs.unlink(tempPath);
}

main().catch(console.error);
