import { GoogleGenAI } from '@google/genai';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { randomUUID } from 'crypto';
import { readConfig } from './config';
import { diarizeAudioWithPyannote, pyannoteToPass1 } from './pyannote';
import type { Pass1Result } from './call-analyzer';

/**
 * Returns the dedicated IQS Gemini key if configured, otherwise falls back
 * to the ordered chat keys. Use this for all quality-scoring LLM calls so
 * spend can be tracked separately from chat.
 */
export function getIQSGeminiKeys(config: any): string[] {
  if (config.iqsGeminiApiKey) return [config.iqsGeminiApiKey];
  return getOrderedGeminiKeys(config);
}

/** Returns all configured Gemini keys in fixed order 1→2→3→4→5. */
export function getOrderedGeminiKeys(config: any): string[] {
  return [
    config.geminiApiKey,
    config.geminiApiKey2,
    config.geminiApiKey3,
    config.geminiApiKey4,
    config.geminiApiKey5,
  ].filter(Boolean) as string[];
}

function isRetryable(err: any): boolean {
  const msg = String(err?.message).toLowerCase();
  return err?.status === 429 || err?.status === 503
    || msg.includes('429') || msg.includes('503')
    || msg.includes('quota') || msg.includes('unavailable') || msg.includes('high demand');
}

// Fallback chain: follow links until no next entry or a cycle is detected.
// gemini-2.5-flash → gemini-3-flash-preview → gemini-3.5-flash → gemini-2.5-pro
const FALLBACK_MODEL: Record<string, string> = {
  'gemini-2.5-flash':              'gemini-3-flash-preview',
  'gemini-3-flash-preview':        'gemini-3.5-flash',
  'gemini-3.5-flash':              'gemini-2.5-pro',
};

function buildModelChain(model: string): string[] {
  const chain = [model];
  const seen = new Set([model]);
  let current = model;
  while (FALLBACK_MODEL[current]) {
    const next = FALLBACK_MODEL[current];
    if (seen.has(next)) break;
    chain.push(next);
    seen.add(next);
    current = next;
  }
  return chain;
}

/** Non-streaming Gemini call with automatic key rotation on 429/503, then model fallback chain. */
export async function geminiGenerate(
  keys: string[],
  model: string,
  contents: any[],
  extra?: Record<string, any>,
  timeoutMs = 300_000
): Promise<string> {
  const modelsToTry = buildModelChain(model);
  let lastError: any;

  for (const currentModel of modelsToTry) {
    for (const key of keys) {
      try {
        const ai = new GoogleGenAI({ apiKey: key });
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('geminiGenerate timeout')), timeoutMs)
        );
        // systemInstruction must live inside config, not at the top level
        const { systemInstruction, config: extraConfig, ...rest } = (extra ?? {}) as any;
        const resolvedConfig = {
          ...(systemInstruction ? { systemInstruction } : {}),
          ...(extraConfig ?? {}),
        };
        const response = await Promise.race([
          ai.models.generateContent({
            model: currentModel,
            contents,
            ...(Object.keys(resolvedConfig).length ? { config: resolvedConfig } : {}),
            ...rest,
          }),
          timeoutPromise,
        ]);
        if (currentModel !== model) console.warn(`[gemini] ${model} unavailable — used ${currentModel} fallback`);
        return response.text || '';
      } catch (err: any) {
        if (isRetryable(err)) { lastError = err; continue; }
        throw err;
      }
    }
  }
  throw lastError;
}

// ── Call-quality specific Gemini caller ───────────────────────────────────────
// Raw-fetch implementation: responseMimeType=application/json, thinkingBudget=0 for flash,
// reverse-part iteration to skip thought entries, 5 retries with 10s gaps, model fallback.
const CALL_MODEL_CHAIN = [
  'gemini-2.5-flash',
  'gemini-2.5-pro',
  'gemini-1.5-pro',
  'gemini-1.5-flash',
];

export async function callGeminiForCall(
  keys: string[],
  contents: any[],
  _systemInstruction?: string,
  timeoutMs = 300_000,
): Promise<string> {
  let lastError: any;

  for (const model of CALL_MODEL_CHAIN) {
    const isPro = model.includes('-pro');
    const body = JSON.stringify({
      contents,
      generationConfig: {
        temperature: 0,
        responseMimeType: 'application/json',
        maxOutputTokens: 8192,
        ...(!isPro ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
      },
    });

    let skipModel = false;
    for (let attempt = 1; attempt <= 5; attempt++) {
      if (attempt > 1) await new Promise(r => setTimeout(r, 10_000));

      for (const key of keys) {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
        try {
          const fetchPromise = fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body,
          });
          const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('callGeminiForCall timeout')), timeoutMs)
          );
          const res  = await Promise.race([fetchPromise, timeoutPromise]);
          const data = await res.json() as any;

          const errMsg = (data.error?.message) ?? '';
          const isCapacity   = res.status === 503 || res.status === 429
            || errMsg.includes('demand') || errMsg.includes('overload');
          const isDeprecated = errMsg.includes('no longer available')
            || errMsg.includes('deprecated')
            || errMsg.includes('Budget 0 is invalid')
            || res.status === 404;

          if (isDeprecated) { skipModel = true; break; }
          if (isCapacity)   { lastError = new Error(errMsg || `HTTP ${res.status}`); break; }
          if (!res.ok)      throw new Error(errMsg || `API error ${res.status}`);

          // Reverse-iterate parts to skip thought:true entries (Gemini 2.5 Pro)
          const parts: any[] = data.candidates?.[0]?.content?.parts ?? [];
          for (let i = parts.length - 1; i >= 0; i--) {
            if (!parts[i].thought && parts[i].text) return (parts[i].text as string).trim();
          }
          return '';
        } catch (err: any) {
          const msg = String(err?.message ?? '').toLowerCase();
          const isCapacity = msg.includes('demand') || msg.includes('503') || msg.includes('429');
          if (!isCapacity) throw err;
          lastError = err;
        }
      }
      if (skipModel) break;
    }

    if (model !== CALL_MODEL_CHAIN[CALL_MODEL_CHAIN.length - 1]) {
      console.warn(`[gemini-call] ${model} exhausted — trying next model`);
    }
  }

  throw lastError ?? new Error('All Gemini call-quality models failed');
}

/** Streaming Gemini call with automatic key rotation on 429/503, then model fallback chain. */
export async function geminiStream(
  keys: string[],
  model: string,
  contents: any[],
  systemInstruction: string
) {
  const modelsToTry = buildModelChain(model);
  let lastError: any;

  for (const currentModel of modelsToTry) {
    // Cap thinking for Pro to reduce latency at scale. Flash has no thinking by default.
    const thinkingConfig = currentModel.includes('pro')
      ? { thinkingConfig: { thinkingBudget: 2048 } }
      : {};
    for (const key of keys) {
      try {
        const ai = new GoogleGenAI({ apiKey: key });
        if (currentModel !== model) console.warn(`[gemini] ${model} unavailable — used ${currentModel} fallback`);
        return await ai.models.generateContentStream({
          model: currentModel,
          contents,
          config: { systemInstruction, ...thinkingConfig },
        });
      } catch (err: any) {
        if (isRetryable(err)) { lastError = err; continue; }
        throw err;
      }
    }
  }
  throw lastError;
}

export function mimeFromUrl(url: string): string {
  const u = url.toLowerCase().split('?')[0];
  if (u.endsWith('.mp3'))  return 'audio/mpeg';
  if (u.endsWith('.wav'))  return 'audio/wav';
  if (u.endsWith('.m4a'))  return 'audio/mp4';
  if (u.endsWith('.ogg'))  return 'audio/ogg';
  if (u.endsWith('.flac')) return 'audio/flac';
  return 'audio/mpeg';
}

function buildPass2TranscriptionPrompt(pass1: Pass1Result): string {
  const formattedEvents = pass1.events.map((e: any) => {
    const toMinsSecs = (sec: number) => {
      const m = Math.floor(sec / 60);
      const s = Math.floor(sec % 60);
      return `${m}:${s.toString().padStart(2, '0')}`;
    };
    if (e.type === 'turn') {
      return {
        type: 'turn',
        speaker: e.speaker,
        start: e.start,
        end: e.end,
        ts: toMinsSecs(e.start)
      };
    } else if (e.type === 'silence') {
      return {
        type: 'silence',
        start: e.start,
        end: e.end,
        duration: `${Math.round(e.duration)} seconds`
      };
    } else { // overlap
      return {
        type: 'overlap',
        start: e.start,
        end: e.end,
        speaker_continuing: e.speaker_continuing,
        speaker_interrupting: e.speaker_interrupting
      };
    }
  });

  return `You are analyzing a customer service call for Wint Wealth, an Indian fixed income investment platform. Two speakers are on this call.
You have been given the exact speaker turn structure below, derived from audio analysis. These timestamps are ground truth — do not change them.

TURN STRUCTURE:
${JSON.stringify(formattedEvents, null, 2)}

YOUR TASKS:
1. Identify Speaker Roles:
   - Identify whether Speaker A or B is the IR EXECUTIVE (Wint Wealth representative) and who is the INVESTOR (customer).
   - IR EXECUTIVE: Introduces themselves by name AND says "Wint Wealth" (e.g. "This is Priya calling from Wint Wealth").
   - INVESTOR: The customer.
2. Transcribe and Translate:
   - For each "turn" event in the structure above, transcribe the exact words spoken during that time window.
   - Translate all non-English content to fluent natural English. Set "translated": true for any segment with translated content.
3. Detect Active Listening:
   - For any turn where the IR EXECUTIVE indicates they could not hear or understand (e.g., "could you repeat", "pardon", "sorry what did you say"), add an "active_listening" flag object immediately after that speech segment.
4. Output JSON:
   - Output a JSON object containing the "language" (e.g., "Hindi", "Telugu + English") and the chronological list of "segments".
   - Convert the "turn" events into "speech" segment objects: {"type":"speech","speaker":"IR EXECUTIVE"|"INVESTOR","text":"[ENGLISH TEXT]","translated":true|false,"ts":"M:SS"}
   - Convert the "silence" events into "dead_air" objects: {"type":"dead_air","duration":"~[N] seconds","resumed_by":"IR EXECUTIVE"|"INVESTOR"}.
   - Convert the "overlap" events into "interruption" objects: {"type":"interruption","interrupted_speaker":"IR EXECUTIVE"|"INVESTOR","interrupted_by":"IR EXECUTIVE"|"INVESTOR","words_spoken":[N]}. Estimate words_spoken at the moment of interruption (only if cut off before ~10 words).

RETURN FORMAT: Return ONLY a valid JSON object matching this schema (do NOT wrap in markdown code blocks or any other wrapper):
{
  "language": "e.g. Hindi, English",
  "segments": [
    {
      "type": "speech",
      "speaker": "IR EXECUTIVE" | "INVESTOR",
      "text": "transcribed and translated English text",
      "translated": true | false,
      "ts": "M:SS"
    },
    ...
  ]
}
`;
}

export async function fetchAndTranscribeAudio(
  recordingUrl: string,
  geminiKeys: string[],
  timeoutMs = 300_000
): Promise<{ language: string; segments: any[] }> {
  let mimeType = mimeFromUrl(recordingUrl);
  const audioRes = await fetch(recordingUrl);
  if (!audioRes.ok) {
    throw new Error(`HTTP ${audioRes.status} fetching audio`);
  }
  const ct = audioRes.headers.get('content-type');
  if (ct && ct.startsWith('audio/')) {
    mimeType = ct.split(';')[0].trim();
  }

  // Create temporary local file
  const tempDir = os.tmpdir();
  const tempFileName = `gemini-audio-${randomUUID()}${path.extname(recordingUrl) || '.mp3'}`;
  const tempFilePath = path.join(tempDir, tempFileName);

  const arrayBuffer = await audioRes.arrayBuffer();
  await fs.writeFile(tempFilePath, Buffer.from(arrayBuffer));

  // Initialize Gemini File API client with the primary rotated API key
  const primaryKey = geminiKeys[0];
  const ai = new GoogleGenAI({ apiKey: primaryKey });

  let uploadResult: any;
  try {
    uploadResult = await ai.files.upload({
      file: tempFilePath,
      config: {
        mimeType,
      },
    });
  } catch (err: any) {
    // Clean up local file on upload error
    try { await fs.unlink(tempFilePath); } catch {}
    throw new Error(`Failed to upload audio to Gemini Files API: ${err?.message || err}`);
  }

  const { CALL_TRANSCRIPTION_PROMPT, parseTranscriptionResponse } = await import('./call-quality');

  try {
    // Check if Pyannote is configured
    let pyKey = '';
    try {
      const config = await readConfig();
      pyKey = config.pyannoteApiKey || '';
    } catch {}
    if (!pyKey) {
      pyKey = process.env.PYANNOTE_API_KEY || process.env.PYANNOTEAI_API_KEY || '';
    }

    if (!pyKey) {
      throw new Error('Pyannote API key is not configured');
    }

    console.log(`[gemini] Running Pyannote diarization on ${recordingUrl}…`);
    const pySegments = await diarizeAudioWithPyannote(recordingUrl, pyKey);
    const pass1 = pyannoteToPass1(pySegments);
    console.log(`[gemini] Pyannote diarization complete: ${pass1.events.length} events. Building Pass 2 prompt…`);
    console.log(`[Diarization Output] Recording: ${recordingUrl}`, JSON.stringify(pass1, null, 2));

    const pass2Prompt = buildPass2TranscriptionPrompt(pass1);
    const raw = await callGeminiForCall(
      geminiKeys,
      [{ parts: [
        { file_data: { mime_type: mimeType, file_uri: uploadResult.uri } },
        { text: pass2Prompt },
      ]}],
      undefined,
      timeoutMs,
    );

    const parsed = parseTranscriptionResponse(raw);
    console.log(`[Transcript Output] Recording: ${recordingUrl}`, JSON.stringify(parsed, null, 2));

    return parsed;
  } finally {
    // remote cleanup
    try {
      await ai.files.delete({ name: uploadResult.name });
    } catch (e: any) {
      console.warn(`[gemini] Failed to delete remote file ${uploadResult.name}:`, e?.message);
    }
    // local cleanup
    try {
      await fs.unlink(tempFilePath);
    } catch (e: any) {
      console.warn(`[gemini] Failed to delete local temp file ${tempFilePath}:`, e?.message);
    }
  }
}

