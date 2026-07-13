import { readFileSync, existsSync } from 'fs';
import pg from 'pg';
import { GoogleGenAI } from '@google/genai';
const { Pool } = pg;

const envFile = './.env.local';
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf-8').split('\n')) {
    const m = line.match(/^([^#=\s]+)\s*=\s*"?(.+?)"?\s*$/);
    if (m) process.env[m[1]] = m[2];
  }
}

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL,
  ssl: { rejectUnauthorized: false },
});

const PASS1_PROMPT = `You are an audio structure analyser. Listen to the entire audio file.
Do NOT transcribe any words. Your only job is to detect and return:

1. SPEAKER TURNS: Every moment a different voice begins speaking.
2. SILENCE: Any gap of 2 seconds or more with no speech.
3. OVERLAP: Any moment where two voices speak simultaneously.

Return ONLY this JSON structure, nothing else:

{
  "duration_seconds": 0.0,
  "events": [
    {
      "type": "turn",
      "speaker": "A" or "B",
      "start": 0.0,
      "end": 0.0
    },
    {
      "type": "silence",
      "start": 0.0,
      "end": 0.0,
      "duration": 0.0
    },
    {
      "type": "overlap",
      "start": 0.0,
      "end": 0.0,
      "speaker_continuing": "A" or "B",
      "speaker_interrupting": "A" or "B"
    }
  ]
}

Ensure all event starts and ends are strictly chronologically ordered and match the audio timeline.
- Use only "A" and "B" as speaker labels — do not guess names or roles yet.
- Speaker "A" is always the first voice heard, even if it is just "Hello".
- Every second of audio must be accounted for across events — no gaps.
- Timestamps must not exceed duration_seconds.
- Overlap events take priority — if two voices speak simultaneously, do not log it as a turn. Log it as overlap.
- Silence threshold: only log silences of 2.0 seconds or longer.
- CRITICAL: All timestamps ("start", "end", "duration") MUST be raw decimal numbers of seconds (e.g. 65.5, 142.8). Never use colon format like "1:05.5" or "2:22.8".
- Merge consecutive speech turns by the same speaker if the gap between them is less than 2.0 seconds. Do not split a speaker's turn into tiny, repetitive segments (e.g., less than 1.5 seconds each) unless they are completely isolated utterances.
- If the call contains hold music, ringtones, beep sounds, dial tones, or static noise (particularly at the end of the call after the conversation is over), do NOT log them as speaker turns. Classify such periods as a single continuous silence event (type 'silence') or ignore them entirely. Never segment repetitive non-speech noise or music into alternating turns between speaker A and B.
`;

async function main() {
  const callId = '98261';

  const res = await pool.query('SELECT recording_url FROM call_recordings WHERE id = $1', [callId]);
  const recordingUrl = res.rows[0].recording_url;

  let apiKey = process.env.GEMINI_API_KEY || process.env.IQS_GEMINI_API_KEY;
  try {
    const raw = readFileSync('./portal-config.json', 'utf-8');
    const parsed = JSON.parse(raw);
    apiKey = parsed.iqsGeminiApiKey || parsed.geminiApiKey || apiKey;
  } catch {}

  const audioRes = await fetch(recordingUrl);
  const ext = recordingUrl.split('?')[0].split('.').pop()?.toLowerCase() ?? '';
  const mimeType = ext === 'wav' ? 'audio/wav' : ext === 'mp3' ? 'audio/mpeg' : 'audio/mpeg';
  const arrayBuffer = await audioRes.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const fs = await import('fs/promises');
  const path = await import('path');
  const os = await import('os');
  const tempFilePath = path.join(os.tmpdir(), `debug-call-${callId}.wav`);
  await fs.writeFile(tempFilePath, buffer);

  const ai = new GoogleGenAI({ apiKey });
  let fileUri = '';
  try {
    const uploadResult = await ai.files.upload({
      file: tempFilePath,
      config: { mimeType }
    });
    fileUri = uploadResult.uri;
  } finally {
    try { await fs.unlink(tempFilePath); } catch {}
  }

  const MODEL = 'gemini-2.5-flash';
  const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

  console.log('Fetching raw Pass 1 response...');
  const pass1Body = {
    contents: [{
      parts: [
        { file_data: { mime_type: mimeType, file_uri: fileUri } },
        { text: PASS1_PROMPT },
      ],
    }],
    generationConfig: {
      temperature: 0,
      responseMimeType: 'application/json',
      maxOutputTokens: 8192,
      thinkingConfig: { thinkingBudget: 1024 }
    },
  };

  const p1Res = await fetch(
    `${GEMINI_API_BASE}/models/${MODEL}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pass1Body),
    },
  );

  const p1Data = await p1Res.json();
  const p1Text = p1Data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  console.log('\n=== FULL RAW TEXT ===');
  console.log(p1Text);
  console.log('=== END ===');

  console.log('\nLength:', p1Text.length);
  try {
    const sanitized = p1Text.replace(/:\s*(\d+):(\d+(?:\.\d+)?)/g, (match, mins, secs) => {
      const totalSeconds = parseInt(mins, 10) * 60 + parseFloat(secs);
      return `: ${totalSeconds}`;
    });
    JSON.parse(sanitized);
    console.log('✅ Sanitized text parsed successfully as JSON!');
  } catch (err) {
    console.error('❌ Parse error on sanitized:', err.message);
  }
}

main().catch(console.error).finally(() => pool.end());
