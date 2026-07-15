/**
 * Two-pass Gemini call quality analyzer.
 *
 * Pass 1 — Structure extraction: timestamps, speaker turns, silence, overlap.
 * Pass 2 — Content + quality: transcription, speaker ID, tone dimensions.
 *
 * Uses Gemini File API (upload once, reuse URI for both passes).
 */

import { readConfig } from './config';
import { diarizeAudioWithPyannote, pyannoteToPass1 } from './pyannote';

const GEMINI_UPLOAD_BASE = 'https://generativelanguage.googleapis.com/upload/v1beta/files';
const GEMINI_API_BASE    = 'https://generativelanguage.googleapis.com/v1beta';
const MODEL              = 'gemini-2.5-flash';

const MIME_MAP: Record<string, string> = {
  mp3:  'audio/mpeg',
  wav:  'audio/wav',
  m4a:  'audio/mp4',
  ogg:  'audio/ogg',
  flac: 'audio/flac',
};

// ── Types ────────────────────────────────────────────────────────────────────

export type SpeakerLabel = 'A' | 'B';
export type SpeakerRole  = 'IR_EXECUTIVE' | 'INVESTOR';

export interface TurnEvent {
  type: 'turn';
  speaker: SpeakerLabel;
  start: number;
  end: number;
}
export interface SilenceEvent {
  type: 'silence';
  start: number;
  end: number;
  duration: number;
}
export interface OverlapEvent {
  type: 'overlap';
  start: number;
  end: number;
  speaker_continuing: SpeakerLabel;
  speaker_interrupting: SpeakerLabel;
}

export type StructureEvent = TurnEvent | SilenceEvent | OverlapEvent;

export interface Pass1Result {
  duration_seconds: number;
  events: StructureEvent[];
}

interface TranscriptSegment {
  type: 'turn';
  speaker: SpeakerRole;
  start: number;
  end: number;
  text: string;
  translated: boolean;
  sentiment: 'positive' | 'neutral' | 'negative';
  aggression: number;
  confidence: number | null;
  empathy: number | null;
  talk_speed: 'slow' | 'normal' | 'fast';
}
interface SilenceSegment {
  type: 'silence';
  start: number;
  end: number;
  duration: number;
  silence_type: 'dead_air' | 'processing_pause' | 'hold';
}
interface OverlapSegment {
  type: 'overlap';
  start: number;
  end: number;
  interruption_by: SpeakerRole;
  speaker_interrupted: SpeakerRole;
}

type OutputSegment = TranscriptSegment | SilenceSegment | OverlapSegment;

export interface CallAnalysisResult {
  status: 'success';
  file_name: string;
  duration_seconds: number;
  detected_language: string;
  speaker_map: Record<SpeakerLabel, SpeakerRole>;
  speaker_identification_confidence: 'high' | 'medium' | 'low';
  speaker_identification_signal: string;
  summary: {
    total_segments: number;
    total_silences: number;
    total_overlaps: number;
    dead_air_events: number;
    executive_avg_confidence: number;
    executive_avg_empathy: number;
    investor_avg_aggression: number;
    executive_avg_aggression: number;
    overall_sentiment: string;
  };
  segments: OutputSegment[];
}

// ── File upload ───────────────────────────────────────────────────────────────

export async function uploadAudioToGemini(
  audioBuffer: Buffer,
  mimeType: string,
  fileName: string,
  apiKey: string,
  onProgress?: (msg: string) => void,
): Promise<string> {
  const fileSizeMB = (audioBuffer.length / 1024 / 1024).toFixed(1);
  onProgress?.(`Uploading audio to Gemini File API… (${fileSizeMB} MB, ${mimeType})`);

  // Step 1: Initiate resumable upload
  onProgress?.('Step 1/2: Initiating resumable upload session…');
  let initRes: Response;
  try {
    initRes = await fetch(`${GEMINI_UPLOAD_BASE}?uploadType=resumable&key=${apiKey}`, {
      method: 'POST',
      headers: {
        'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': String(audioBuffer.length),
        'X-Goog-Upload-Header-Content-Type': mimeType,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ file: { display_name: fileName } }),
    });
  } catch (err: any) {
    throw new Error(`Gemini File API init network error: ${err.message}`);
  }

  onProgress?.(`Upload session response: HTTP ${initRes.status}`);
  if (!initRes.ok) {
    const text = await initRes.text();
    throw new Error(`Gemini File API init failed (${initRes.status}): ${text.slice(0, 200)}`);
  }

  const uploadUrl = initRes.headers.get('x-goog-upload-url');
  if (!uploadUrl) throw new Error('No upload URL returned from Gemini File API');
  onProgress?.('Upload session created — starting byte transfer…');

  // Step 2: Upload the bytes — convert Buffer to Uint8Array for Node.js fetch compat
  const uint8 = new Uint8Array(audioBuffer.buffer, audioBuffer.byteOffset, audioBuffer.byteLength);
  onProgress?.(`Step 2/2: Sending ${fileSizeMB} MB to Gemini (timeout: 120s)…`);
  const uploadStart = Date.now();
  let uploadRes: Response;
  try {
    const uploadController = new AbortController();
    const uploadTimer = setTimeout(() => uploadController.abort(), 120_000);
    uploadRes = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'X-Goog-Upload-Command': 'upload, finalize',
        'X-Goog-Upload-Offset': '0',
        'Content-Type': mimeType,
        'Content-Length': String(audioBuffer.length),
      },
      body: uint8 as unknown as BodyInit,
      signal: uploadController.signal,
    });
    clearTimeout(uploadTimer);
    onProgress?.(`Byte transfer completed in ${((Date.now() - uploadStart) / 1000).toFixed(1)}s`);
  } catch (err: any) {
    const elapsed = ((Date.now() - uploadStart) / 1000).toFixed(1);
    throw new Error(`Gemini File API upload failed after ${elapsed}s: ${err.message}`);
  }

  onProgress?.(`Byte transfer response: HTTP ${uploadRes.status}`);
  if (!uploadRes.ok) {
    const text = await uploadRes.text();
    throw new Error(`Gemini File API upload failed (${uploadRes.status}): ${text.slice(0, 200)}`);
  }

  const fileData = await uploadRes.json();
  const fileUri = fileData?.file?.uri;
  onProgress?.(`File API response: uri=${fileUri ?? 'MISSING'}, state=${fileData?.file?.state ?? 'unknown'}`);
  if (!fileUri) throw new Error(`No file URI returned. Full response: ${JSON.stringify(fileData).slice(0, 300)}`);

  onProgress?.(`Audio uploaded successfully (${fileSizeMB} MB) → ${fileUri.slice(0, 60)}…`);
  return fileUri;
}

// ── Gemini generate (direct REST, no SDK dependency on audio) ─────────────────

async function geminiGenerate(
  apiKey: string,
  prompt: string,
  fileUri: string,
  mimeType: string,
  timeoutMs = 300_000,
): Promise<string> {
  const body = {
    contents: [{
      parts: [
        { file_data: { mime_type: mimeType, file_uri: fileUri } },
        { text: prompt },
      ],
    }],
    generationConfig: {
      temperature: 0.1,
      // Gemini 2.5 counts thinking tokens against maxOutputTokens, so this must
      // be large enough for thinking budget + a full long-call transcript.
      maxOutputTokens: 65536,
      thinkingConfig: {
        thinkingBudget: 2048,
      },
    },
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    console.log('[Gemini debug] Sending request to:', `${GEMINI_API_BASE}/models/${MODEL}:generateContent`);
    const res = await fetch(
      `${GEMINI_API_BASE}/models/${MODEL}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      },
    );
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Gemini generate failed (${res.status}): ${text.slice(0, 300)}`);
    }
    const data = await res.json();
    console.log('[Gemini debug] Raw Response Data:', JSON.stringify(data, null, 2));
    const finishReason = data?.candidates?.[0]?.finishReason;
    if (finishReason && finishReason !== 'STOP') {
      console.warn(`[Gemini] Response finished with reason ${finishReason} — output may be truncated`);
    }
    const parts: any[] = data?.candidates?.[0]?.content?.parts ?? [];
    let fullText = '';
    for (const p of parts) {
      if (!p.thought && p.text) {
        fullText += p.text;
      }
    }
    return fullText.trim();
  } finally {
    clearTimeout(timer);
  }
}

// ── JSON extraction ───────────────────────────────────────────────────────────

function extractJson(raw: string, allowRepair = true): any {
  // Pre-process to repair colon timestamps like 1:02.9 to raw seconds
  const sanitized = raw.replace(/:\s*(\d+):(\d+(?:\.\d+)?)/g, (match, mins, secs) => {
    const totalSeconds = parseInt(mins, 10) * 60 + parseFloat(secs);
    return `: ${totalSeconds}`;
  });
  const cleaned = sanitized.trim().replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
  try { return JSON.parse(cleaned); } catch {}
  const start = cleaned.indexOf('{');
  const end   = cleaned.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(cleaned.slice(start, end + 1)); } catch {}
  }
  if (allowRepair) {
    const repaired = repairTruncatedJson(cleaned);
    if (repaired !== null) {
      console.warn('[Gemini] JSON output was truncated — salvaged the complete portion');
      return repaired;
    }
  }
  throw new Error(`Cannot extract JSON from: ${raw.slice(0, 2000)}`);
}

/**
 * Salvage a JSON object whose tail was cut off mid-stream (e.g. the model hit
 * maxOutputTokens). Truncates back to the last fully-closed nested value and
 * appends the missing closing brackets.
 */
function repairTruncatedJson(cleaned: string): any | null {
  const start = cleaned.indexOf('{');
  if (start < 0) return null;
  const s = cleaned.slice(start);

  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  let lastComplete = -1;            // index just past the last fully-closed nested value
  let stackAtLastComplete: string[] = [];

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; continue; }
    if (c === '{' || c === '[') {
      stack.push(c);
    } else if (c === '}' || c === ']') {
      if (stack.length === 0) return null; // malformed beyond repair
      stack.pop();
      // A value just closed at nesting depth <= 2 (e.g. one segment inside the
      // top-level "segments" array) — a safe point to cut back to.
      if (stack.length > 0 && stack.length <= 2) {
        lastComplete = i + 1;
        stackAtLastComplete = stack.slice();
      }
    }
  }

  if (lastComplete < 0) return null;
  const closers = stackAtLastComplete
    .slice()
    .reverse()
    .map(b => (b === '{' ? '}' : ']'))
    .join('');
  try {
    return JSON.parse(s.slice(0, lastComplete) + closers);
  } catch {
    return null;
  }
}

// ── Pass 1 prompt ─────────────────────────────────────────────────────────────

const PASS1_PROMPT = `You are an audio structure analyser. Listen to the entire audio file.
Do NOT transcribe any words. Your only job is to detect and return:

1. SPEAKER TURNS: Every moment a different voice begins speaking.
2. SILENCE: Any gap of 2 seconds or more with no speech.
3. OVERLAP: Any moment where two voices speak simultaneously.

Return ONLY this JSON structure, nothing else:
{"duration_seconds":0.0,"events":[["turn","A",0.0,0.0],["silence",0.0,0.0,0.0],["overlap",0.0,0.0,"A","B"]]}

Format for events:
- Turn: ["turn", speaker, start, end] (where speaker is "A" or "B")
- Silence: ["silence", start, end, duration]
- Overlap: ["overlap", start, end, speaker_continuing, speaker_interrupting] (where speakers are "A" or "B")

RULES:
- You MUST process the ENTIRE audio file from beginning to end. DO NOT STOP EARLY. The events array must cover the full duration of the audio.
- Use only "A" and "B" as speaker labels — do not guess names or roles yet.
- Speaker "A" is always the first voice heard, even if it is just "Hello".
- Every second of audio must be accounted for across events — no gaps.
- Timestamps must not exceed duration_seconds.
- Overlap events take priority — if two voices speak simultaneously, do not log it as a turn. Log it as overlap.
- Silence threshold: only log silences of 2.0 seconds or longer.
- CRITICAL: All timestamps ("start", "end", "duration") MUST be raw decimal numbers of seconds (e.g. 65.5, 142.8). Never use colon format like "1:05.5" or "2:22.8".
- Merge consecutive speech turns by the same speaker if the gap between them is less than 2.0 seconds. Do not split a speaker's turn into tiny, repetitive segments (e.g., less than 1.5 seconds each) unless they are completely isolated utterances.
- EXTREMELY CRITICAL: If you hear hold music, ringing, or background noise, do NOT log it as rapid alternating short speech turns. Instead, output a SINGLE continuous 'silence' event covering the ENTIRE duration of that noise (even if it lasts for minutes).
- After the hold music/noise ends, you MUST resume logging the rest of the conversation until the end of the audio. DO NOT STOP EARLY.
- You MUST output MINIFIED JSON. Do not include spaces, indentation, or newlines in the JSON output, to save tokens.`;

// ── Pass 2 prompt ─────────────────────────────────────────────────────────────

function buildPass2Prompt(pass1: Pass1Result): string {
  return `You are analysing a customer service call for Wint Wealth, an Indian fixed-income investment platform. Two speakers are on this call.

You have been given the exact speaker turn structure below, derived from audio analysis. These timestamps are ground truth — do not change them.

TURN STRUCTURE:
${JSON.stringify(pass1, null, 2)}

YOUR TASKS:

TASK 1 — SPEAKER IDENTIFICATION
Listen to the full call and determine:
- Which speaker (A or B) is the IR EXECUTIVE (Wint Wealth employee)?
- Which speaker (A or B) is the INVESTOR (customer)?

IR EXECUTIVE identification signal:
  Explicitly says their own name AND "Wint Wealth" together in one utterance.
  Example: "Hi, this is Priya from Wint Wealth" or "Main Rahul bol raha hoon, Wint Wealth se."
  This can happen anywhere in the call — not necessarily first.
  If you cannot find this signal, label the speaker who answers questions and explains products as IR EXECUTIVE.

TASK 2 — TRANSCRIPTION
For each "turn" event in the structure above, transcribe the exact words spoken during that time window.

Language rules:
- Auto-detect: English, Hindi, Hinglish, Tamil, Telugu, Kannada, Malayalam, Marathi and any other Indian language.
- Translate ALL non-English content to natural fluent English.
- Preserve filler sounds as-is: uh, um, haan, acha, theek hai.
- Never invent words not spoken. If a segment is unclear, write [inaudible].
- Mark translated: true for any segment containing translated content.

TASK 3 — TONE ANALYSIS
For each turn segment, return these five quality dimensions:

sentiment: "positive" | "neutral" | "negative" — based on word choice and vocal affect combined.

aggression: 0-10
  0 = completely calm. 10 = openly hostile or shouting.
  Measure for both speakers.

confidence: 0-10 (IR EXECUTIVE only, null for INVESTOR)
  0 = very hesitant, uses "I think" / "maybe" excessively.
  10 = direct, clear, no unnecessary hedging.

empathy: 0-10 (IR EXECUTIVE only, null for INVESTOR)
  0 = robotic, no acknowledgement of investor concerns.
  10 = explicitly acknowledges feelings, uses investor's name, validates concerns before answering.

talk_speed: "slow" | "normal" | "fast" — relative to natural conversational pace for that language.

TASK 4 — SILENCE AND OVERLAP ANNOTATION
For each "silence" event, classify it:
  silence_type: "dead_air" | "processing_pause" | "hold"
  dead_air = neither speaker responds, call feels dropped.
  processing_pause = short natural gap while thinking.
  hold = one party explicitly put on hold or is waiting.

For each "overlap" event: map speaker labels to actual roles.

RETURN FORMAT — ONLY valid JSON, no markdown, no explanation.
To fit long calls within token budgets, represent the segments array as a compact list of arrays. Each event must be represented exactly as:
- For turn: ["turn", speaker, start, end, text, translated, sentiment, aggression, confidence, empathy, talk_speed]
  (where speaker is "IR_EXECUTIVE" or "INVESTOR", confidence/empathy are numbers or null, translated is true or false)
- For silence: ["silence", start, end, duration, silence_type]
  (where silence_type is "dead_air" | "processing_pause" | "hold")
- For overlap: ["overlap", start, end, interruption_by, speaker_interrupted]
  (where interruption_by and speaker_interrupted are "IR_EXECUTIVE" or "INVESTOR")

Example output:
{
  "speaker_map": {
    "A": "IR_EXECUTIVE",
    "B": "INVESTOR"
  },
  "speaker_identification_confidence": "high",
  "speaker_identification_signal": "This is Priya from Wint Wealth",
  "detected_language": "English",
  "segments": [
    ["silence", 0.0, 2.5, 2.5, "dead_air"],
    ["turn", "IR_EXECUTIVE", 2.5, 6.2, "Hello sir, good morning.", false, "positive", 0, 9, 8, "normal"],
    ["overlap", 6.2, 7.0, "INVESTOR", "IR_EXECUTIVE"]
  ]
}
- CRITICAL: All timestamps ("start", "end", "duration") in the segments array must match the input turn structure and remain raw decimal numbers of seconds (e.g. 62.9, 142.8). Never use colon notation like "1:02.9" or "2:22.8".
- EXTREMELY CRITICAL: You MUST output MINIFIED JSON. Do NOT include spaces, indentation, or newlines in the JSON output, to save tokens.
`;
}

// ── Pass 1 validation ─────────────────────────────────────────────────────────

function validatePass1(data: any, attempt: number): Pass1Result {
  if (!data || !Array.isArray(data.events) || data.events.length === 0) {
    throw new Error(`Pass 1 attempt ${attempt}: empty or missing events array`);
  }
  if (!data.duration_seconds || data.duration_seconds <= 0) {
    throw new Error(`Pass 1 attempt ${attempt}: invalid duration_seconds`);
  }

  // Map arrays back to objects
  const mappedEvents: StructureEvent[] = data.events.map((e: any) => {
    if (Array.isArray(e)) {
      if (e[0] === 'turn') {
        return { type: 'turn', speaker: e[1], start: e[2], end: e[3] } as TurnEvent;
      } else if (e[0] === 'silence') {
        return { type: 'silence', start: e[1], end: e[2], duration: e[3] } as SilenceEvent;
      } else if (e[0] === 'overlap') {
        return { type: 'overlap', start: e[1], end: e[2], speaker_continuing: e[3], speaker_interrupting: e[4] } as OverlapEvent;
      }
    }
    return e as StructureEvent; // fallback in case it's already an object
  }).filter(Boolean);
  
  data.events = mappedEvents;
  const hasTurns = data.events.some((e: any) => e.type === 'turn');
  if (!hasTurns) {
    throw new Error(`Pass 1 attempt ${attempt}: no turn events found — likely garbage output`);
  }
  // Clamp timestamps exceeding duration
  const dur = data.duration_seconds;
  for (const e of data.events) {
    if (e.start > dur) e.start = dur;
    if (e.end   > dur) e.end   = dur;
    if (e.type === 'silence' && e.duration) {
      e.duration = Math.min(e.duration, dur - e.start);
    }
  }
  return data as Pass1Result;
}

// ── Summary computation ───────────────────────────────────────────────────────

function computeSummary(segments: OutputSegment[]): CallAnalysisResult['summary'] {
  const turns    = segments.filter((s): s is TranscriptSegment => s.type === 'turn');
  const silences = segments.filter((s): s is SilenceSegment   => s.type === 'silence');
  const overlaps = segments.filter((s): s is OverlapSegment   => s.type === 'overlap');

  const execTurns     = turns.filter(t => t.speaker === 'IR_EXECUTIVE');
  const investorTurns = turns.filter(t => t.speaker === 'INVESTOR');

  const avg = (arr: number[]) =>
    arr.length ? Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 10) / 10 : 0;

  const sentimentScore = (s: TranscriptSegment['sentiment']) =>
    s === 'positive' ? 1 : s === 'negative' ? -1 : 0;
  const totalScore = turns.reduce((a, t) => a + sentimentScore(t.sentiment), 0);
  const overallSentiment = totalScore > 0 ? 'positive' : totalScore < 0 ? 'negative' : 'neutral';

  return {
    total_segments:          turns.length,
    total_silences:          silences.length,
    total_overlaps:          overlaps.length,
    dead_air_events:         silences.filter(s => s.silence_type === 'dead_air').length,
    executive_avg_confidence: avg(execTurns.map(t => t.confidence ?? 0)),
    executive_avg_empathy:    avg(execTurns.map(t => t.empathy ?? 0)),
    investor_avg_aggression:  avg(investorTurns.map(t => t.aggression)),
    executive_avg_aggression: avg(execTurns.map(t => t.aggression)),
    overall_sentiment:        overallSentiment,
  };
}

// ── URI-based entry point (browser uploads directly to Gemini) ───────────────

export async function analyzeCallFromUri(opts: {
  fileUri: string;
  pyannoteUri?: string;
  recordingUrl?: string;
  fileName: string;
  mimeType: string;
  apiKey: string;
  pyannoteApiKey?: string;
  onProgress?: (msg: string) => void;
}): Promise<CallAnalysisResult> {
  const { fileUri, pyannoteUri, recordingUrl, fileName, mimeType, apiKey, pyannoteApiKey, onProgress } = opts;
  onProgress?.(`Starting analysis — file already uploaded, URI: ${fileUri.slice(0, 60)}…`);

  let pass1: Pass1Result | null = null;

  // Resolve Pyannote API key
  let pyKey = pyannoteApiKey;
  if (!pyKey) {
    try {
      const config = await readConfig();
      pyKey = config.pyannoteApiKey || '';
    } catch {}
  }
  if (!pyKey) {
    pyKey = process.env.PYANNOTE_API_KEY || process.env.PYANNOTEAI_API_KEY || '';
  }

  if (!pyKey) {
    throw new Error('Pyannote API key is not configured');
  }

  // Attempt Pyannote diarization
  const diarizeUrl = pyannoteUri || (recordingUrl ?? (fileUri.startsWith('http') && !fileUri.includes('googleapis.com') ? fileUri : ''));
  if (!diarizeUrl) {
    throw new Error('Pyannote diarization requires a public recording URL or valid media URI');
  }

  onProgress?.('Running speaker diarization using Pyannote precision-2 model…');
  const pySegments = await diarizeAudioWithPyannote(diarizeUrl, pyKey, onProgress);
  const p1 = pyannoteToPass1(pySegments);
  pass1 = p1;
  onProgress?.(`Pyannote diarization complete — ${p1.events.length} events, duration=${p1.duration_seconds}s`);
  console.log(`[Diarization Output] Call: ${fileName}`, JSON.stringify(p1, null, 2));

  if (!pass1) throw new Error('Pass 1 did not produce a result');

  // ── Pass 2: Transcription + analysis ─────────────────────────────────────
  const pass2Prompt = buildPass2Prompt(pass1);
  onProgress?.(`Pass 2 prompt built (${(pass2Prompt.length / 1000).toFixed(1)}k chars)`);
  let pass2: any = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    onProgress?.(`Pass 2 — transcription + analysis${attempt > 1 ? ' (retry)' : ''}, sending audio + structure to Gemini…`);
    const p2Start = Date.now();
    let pass2Raw: string;
    try {
      pass2Raw = await geminiGenerate(apiKey, pass2Prompt, fileUri, mimeType, 300_000);
      onProgress?.(`Pass 2 — Gemini responded in ${((Date.now() - p2Start) / 1000).toFixed(1)}s, parsing JSON…`);
    } catch (err: any) {
      if (attempt === 2) throw new Error(`Pass 2 LLM error: ${err.message}`);
      onProgress?.(`Pass 2 LLM error (attempt ${attempt}): ${err.message} — retrying in 3 seconds…`);
      await new Promise(r => setTimeout(r, 3000));
      continue;
    }

    try {
      // Only salvage truncated output on the final attempt — prefer a clean retry.
      pass2 = extractJson(pass2Raw, attempt === 2);
      onProgress?.(`Pass 2 parsed — ${pass2?.segments?.length ?? 0} segments`);
      break;
    } catch (err: any) {
      onProgress?.(`Pass 2 raw output (first 300 chars): ${pass2Raw.slice(0, 300)}`);
      if (attempt === 2) throw new Error(`Pass 2 JSON parse failed: ${err.message}`);
      onProgress?.(`Pass 2 JSON parse failed (attempt ${attempt}) — retrying in 3 seconds…`);
      await new Promise(r => setTimeout(r, 3000));
    }
  }
  if (!pass2) throw new Error('Pass 2 did not produce a result');

  onProgress?.('Building final result…');
  const rawSegments = pass2.segments ?? [];
  const segments: OutputSegment[] = rawSegments.map((s: any) => {
    if (!Array.isArray(s) || s.length === 0) return null;
    const type = s[0];
    if (type === 'turn') {
      return {
        type: 'turn',
        speaker: s[1],
        start: s[2],
        end: s[3],
        text: s[4],
        translated: s[5],
        sentiment: s[6],
        aggression: s[7],
        confidence: s[8],
        empathy: s[9],
        talk_speed: s[10]
      } as TranscriptSegment;
    } else if (type === 'silence') {
      return {
        type: 'silence',
        start: s[1],
        end: s[2],
        duration: s[3],
        silence_type: s[4]
      } as SilenceSegment;
    } else if (type === 'overlap') {
      return {
        type: 'overlap',
        start: s[1],
        end: s[2],
        interruption_by: s[3],
        speaker_interrupted: s[4]
      } as OverlapSegment;
    }
    return null;
  }).filter(Boolean) as OutputSegment[];
  const summary = computeSummary(segments);
  console.log(`[Transcript Output] Call: ${fileName}`, JSON.stringify(segments, null, 2));

  return {
    status: 'success',
    file_name: fileName,
    duration_seconds: pass1.duration_seconds,
    detected_language: pass2.detected_language ?? 'Unknown',
    speaker_map: pass2.speaker_map ?? { A: 'IR_EXECUTIVE', B: 'INVESTOR' },
    speaker_identification_confidence: pass2.speaker_identification_confidence ?? 'low',
    speaker_identification_signal: pass2.speaker_identification_signal ?? '',
    summary,
    segments,
  };
}

export function getMimeType(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  return MIME_MAP[ext] ?? 'audio/mpeg';
}
