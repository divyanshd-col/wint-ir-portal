/**
 * Two-pass Gemini call quality analyzer.
 *
 * Pass 1 — Structure extraction: timestamps, speaker turns, silence, overlap.
 * Pass 2 — Content + quality: transcription, speaker ID, tone dimensions.
 *
 * Uses Gemini File API (upload once, reuse URI for both passes).
 */

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

interface TurnEvent {
  type: 'turn';
  speaker: SpeakerLabel;
  start: number;
  end: number;
}
interface SilenceEvent {
  type: 'silence';
  start: number;
  end: number;
  duration: number;
}
interface OverlapEvent {
  type: 'overlap';
  start: number;
  end: number;
  speaker_continuing: SpeakerLabel;
  speaker_interrupting: SpeakerLabel;
}

type StructureEvent = TurnEvent | SilenceEvent | OverlapEvent;

interface Pass1Result {
  duration_seconds: number;
  events: StructureEvent[];
}

interface TranscriptSegment {
  event_type: 'turn';
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
  event_type: 'silence';
  start: number;
  end: number;
  duration: number;
  silence_type: 'dead_air' | 'processing_pause' | 'hold';
}
interface OverlapSegment {
  event_type: 'overlap';
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
  timeoutMs = 120_000,
): Promise<string> {
  const body = {
    contents: [{
      parts: [
        { file_data: { mime_type: mimeType, file_uri: fileUri } },
        { text: prompt },
      ],
    }],
    generationConfig: {
      temperature: 0,
      responseMimeType: 'application/json',
      maxOutputTokens: 8192,
    },
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
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
    return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  } finally {
    clearTimeout(timer);
  }
}

// ── JSON extraction ───────────────────────────────────────────────────────────

function extractJson(raw: string): any {
  const cleaned = raw.trim().replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
  try { return JSON.parse(cleaned); } catch {}
  const start = cleaned.indexOf('{');
  const end   = cleaned.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(cleaned.slice(start, end + 1)); } catch {}
  }
  throw new Error(`Cannot extract JSON from: ${raw.slice(0, 200)}`);
}

// ── Pass 1 prompt ─────────────────────────────────────────────────────────────

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

RULES:
- Use only "A" and "B" as speaker labels — do not guess names or roles yet.
- Speaker "A" is always the first voice heard, even if it is just "Hello".
- Every second of audio must be accounted for across events — no gaps.
- Timestamps must not exceed duration_seconds.
- Overlap events take priority — if two voices speak simultaneously, do not log it as a turn. Log it as overlap.
- Silence threshold: only log silences of 2.0 seconds or longer.`;

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

RETURN FORMAT — ONLY valid JSON, no markdown, no explanation:

{
  "speaker_map": {
    "A": "IR_EXECUTIVE" or "INVESTOR",
    "B": "IR_EXECUTIVE" or "INVESTOR"
  },
  "speaker_identification_confidence": "high" | "medium" | "low",
  "speaker_identification_signal": "exact quote that identified the executive, or empty string",
  "detected_language": "e.g. Hindi, English",
  "segments": [
    {
      "event_type": "turn",
      "speaker": "IR_EXECUTIVE" or "INVESTOR",
      "start": 0.0,
      "end": 0.0,
      "text": "transcribed and translated text",
      "translated": true or false,
      "sentiment": "positive" | "neutral" | "negative",
      "aggression": 0-10,
      "confidence": 0-10 or null,
      "empathy": 0-10 or null,
      "talk_speed": "slow" | "normal" | "fast"
    },
    {
      "event_type": "silence",
      "start": 0.0,
      "end": 0.0,
      "duration": 0.0,
      "silence_type": "dead_air" | "processing_pause" | "hold"
    },
    {
      "event_type": "overlap",
      "start": 0.0,
      "end": 0.0,
      "interruption_by": "IR_EXECUTIVE" or "INVESTOR",
      "speaker_interrupted": "IR_EXECUTIVE" or "INVESTOR"
    }
  ]
}`;
}

// ── Pass 1 validation ─────────────────────────────────────────────────────────

function validatePass1(data: any, attempt: number): Pass1Result {
  if (!data || !Array.isArray(data.events) || data.events.length === 0) {
    throw new Error(`Pass 1 attempt ${attempt}: empty or missing events array`);
  }
  if (!data.duration_seconds || data.duration_seconds <= 0) {
    throw new Error(`Pass 1 attempt ${attempt}: invalid duration_seconds`);
  }
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
  const turns    = segments.filter((s): s is TranscriptSegment => s.event_type === 'turn');
  const silences = segments.filter((s): s is SilenceSegment   => s.event_type === 'silence');
  const overlaps = segments.filter((s): s is OverlapSegment   => s.event_type === 'overlap');

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

// ── Main entry point ──────────────────────────────────────────────────────────

export async function analyzeCall(opts: {
  audioBuffer: Buffer;
  fileName: string;
  apiKey: string;
  onProgress?: (msg: string) => void;
}): Promise<CallAnalysisResult> {
  const { audioBuffer, fileName, apiKey, onProgress } = opts;

  const ext = fileName.split('.').pop()?.toLowerCase() ?? 'mp3';
  const mimeType = MIME_MAP[ext] ?? 'audio/mpeg';

  if (audioBuffer.length > 500 * 1024 * 1024) {
    onProgress?.('Warning: file is >500MB — analysis may be slow');
  }

  // ── Upload once ───────────────────────────────────────────────────────────
  const fileUri = await uploadAudioToGemini(audioBuffer, mimeType, fileName, apiKey, onProgress);

  // ── Pass 1: Structure extraction ──────────────────────────────────────────
  let pass1: Pass1Result | null = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    onProgress?.(`Pass 1 — structure extraction${attempt > 1 ? ' (retry)' : ''}… sending audio to Gemini`);
    const p1Start = Date.now();
    try {
      const raw = await geminiGenerate(apiKey, PASS1_PROMPT, fileUri, mimeType, 90_000);
      onProgress?.(`Pass 1 — Gemini responded in ${((Date.now() - p1Start) / 1000).toFixed(1)}s, parsing JSON…`);
      const data = extractJson(raw);
      pass1 = validatePass1(data, attempt);
      onProgress?.(`Pass 1 complete — ${pass1.events.length} events, duration=${pass1.duration_seconds}s`);
      break;
    } catch (err: any) {
      onProgress?.(`Pass 1 error (attempt ${attempt}): ${err.message}`);
      if (attempt === 2) throw new Error(`Pass 1 failed after 2 attempts: ${err.message}`);
      onProgress?.('Retrying Pass 1 in 3 seconds…');
      await new Promise(r => setTimeout(r, 3000));
    }
  }
  if (!pass1) throw new Error('Pass 1 did not produce a result');

  // ── Pass 2: Transcription + analysis ─────────────────────────────────────
  onProgress?.('Pass 2 — transcription + analysis, sending audio + structure to Gemini…');
  const pass2Prompt = buildPass2Prompt(pass1);
  onProgress?.(`Pass 2 prompt built (${(pass2Prompt.length / 1000).toFixed(1)}k chars)`);
  const p2Start = Date.now();
  let pass2Raw: string;
  try {
    pass2Raw = await geminiGenerate(apiKey, pass2Prompt, fileUri, mimeType, 180_000);
    onProgress?.(`Pass 2 — Gemini responded in ${((Date.now() - p2Start) / 1000).toFixed(1)}s, parsing JSON…`);
  } catch (err: any) {
    throw new Error(`Pass 2 LLM error: ${err.message}`);
  }

  let pass2: any;
  try {
    pass2 = extractJson(pass2Raw);
    onProgress?.(`Pass 2 parsed — ${pass2?.segments?.length ?? 0} segments`);
  } catch (err: any) {
    onProgress?.(`Pass 2 raw output (first 300 chars): ${pass2Raw.slice(0, 300)}`);
    throw new Error(`Pass 2 JSON parse failed: ${err.message}`);
  }

  onProgress?.('Building final result…');

  const segments: OutputSegment[] = pass2.segments ?? [];
  const summary = computeSummary(segments);

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
