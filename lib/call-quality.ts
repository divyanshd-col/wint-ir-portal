/**
 * Call quality scoring — types, weights, prompts, and helpers.
 * 10 parameters across 3 groups. Chat and call scored independently.
 */

// ── Parameter weights (must sum to 1.0) ──────────────────────────────────────

export const CALL_WEIGHTS: Record<string, number> = {
  CallOpening:       0.05,
  CallClosing:       0.05,
  TechnicallyLegal:  0.15,
  AllQuestions:      0.10,
  ExpectationSetting:0.10,
  Process:           0.05,
  VocabularyGrammar: 0.10,
  FillersClarity:    0.10,
  EnergyTone:        0.10,
  ActiveListening:   0.10,
  SimplifyingAnswers:0.10,
};

export const CALL_PARAM_NAMES: Record<string, string> = {
  CallOpening:        'Call Opening',
  CallClosing:        'Call Closing',
  TechnicallyLegal:   'Technically / Legally Correct',
  AllQuestions:       'All Questions Addressed',
  ExpectationSetting: 'Expectation Setting',
  Process:            'Process',
  VocabularyGrammar:  'Vocabulary / Grammar / Pronunciation',
  FillersClarity:     'Fillers, Fumbling & Clarity',
  EnergyTone:         'Energy Level, Enthusiasm & Tone',
  ActiveListening:    'Active Listening, Interruptions & Empathy',
  SimplifyingAnswers: 'Simplifying Answers',
};

export const CALL_PARAM_GROUPS: Record<string, { label: string; keys: string[] }> = {
  process: {
    label: 'Process (50%)',
    keys: ['CallOpening', 'CallClosing', 'TechnicallyLegal', 'AllQuestions', 'ExpectationSetting', 'Process'],
  },
  communication: {
    label: 'Communication Skills (30%)',
    keys: ['VocabularyGrammar', 'FillersClarity', 'EnergyTone'],
  },
  customerService: {
    label: 'Customer Service Skills (20%)',
    keys: ['ActiveListening', 'SimplifyingAnswers'],
  },
};

export const CALL_PARAM_ORDER = [
  'CallOpening', 'CallClosing', 'TechnicallyLegal', 'AllQuestions', 'ExpectationSetting', 'Process',
  'VocabularyGrammar', 'FillersClarity', 'EnergyTone',
  'ActiveListening', 'SimplifyingAnswers',
];

export type CallParamScore = 'Yes' | 'No' | 'NA';

export interface PoorListeningSegment {
  segment_index: number;
  phrase: string;
}

export interface CallSegment {
  type: 'speech' | 'interruption' | 'dead_air' | 'poor_listening';
  // speech
  speaker?: string;
  text?: string;
  translated?: boolean;
  ts?: string;
  // interruption
  interrupted_speaker?: string;
  interrupted_by?: string;
  words_spoken?: number;
  // dead_air
  duration?: string;
  resumed_by?: string;
  // poor_listening
  phrase?: string;
}

export interface CallIQSScoreEntry {
  callId?: string;
  chatId?: string | null;
  agentName: string;
  calledAt?: string;
  durationSeconds?: number | null;
  language?: string | null;
  interruptionCount: number;
  deadAirCount: number;
  poorListeningCount: number;
  iqs: number;
  scores: Record<string, CallParamScore>;
  reasoning: Record<string, string>;
  summary: string;
  modelVersion: string;
  scoredAt?: string;
}

// ── IQS calculation ───────────────────────────────────────────────────────────
export function calculateCallIQS(scores: Record<string, CallParamScore>): number {
  let total = 0;
  for (const [param, weight] of Object.entries(CALL_WEIGHTS)) {
    const score = scores[param] ?? 'NA';
    if (score === 'Yes' || score === 'NA') total += weight;
  }
  return Math.round(total * 100);
}

// ── Build readable text from segments (for LLM scoring input) ─────────────────
export function segmentsToText(segments: CallSegment[]): string {
  const lines: string[] = [];
  let speechIdx = 0;
  for (const seg of segments) {
    if (seg.type === 'speech') {
      speechIdx++;
      lines.push(`[${speechIdx}] ${seg.speaker}: ${seg.text}${seg.translated ? ' [translated]' : ''}`);
    } else if (seg.type === 'interruption') {
      lines.push(`[INTERRUPTION: ${seg.interrupted_speaker} cut off by ${seg.interrupted_by} after ${seg.words_spoken ?? '?'} words]`);
    } else if (seg.type === 'dead_air') {
      lines.push(`[DEAD AIR: ${seg.duration ?? 'unknown'} — resumed by ${seg.resumed_by}]`);
    }
  }
  return lines.join('\n');
}

// ── Insert poor_listening flags back into segment array ───────────────────────
export function insertPoorListeningFlags(
  segments: CallSegment[],
  poorSegments: PoorListeningSegment[],
): CallSegment[] {
  if (!poorSegments.length) return segments;

  // Build a map: speech segment number (1-based) → original array index
  const speechIdxMap: Record<number, number> = {};
  let speechCount = 0;
  for (let i = 0; i < segments.length; i++) {
    if (segments[i].type === 'speech') {
      speechCount++;
      speechIdxMap[speechCount] = i;
    }
  }

  const toInsert = poorSegments
    .map(ps => ({ origIdx: speechIdxMap[ps.segment_index] ?? -1, phrase: ps.phrase }))
    .filter(x => x.origIdx >= 0)
    .sort((a, b) => b.origIdx - a.origIdx); // reverse order so indices don't shift

  const result = [...segments];
  for (const item of toInsert) {
    result.splice(item.origIdx + 1, 0, { type: 'poor_listening', phrase: item.phrase });
  }
  return result;
}

// ── Transcription prompt (Pass 1) — audio → segment JSON ─────────────────────
export const CALL_TRANSCRIPTION_PROMPT = `You are analyzing a customer service call for Wint Wealth, an Indian fixed income investment platform.
Listen to the ENTIRE audio before producing any output.

══════════════════════════════════════════
SPEAKER IDENTIFICATION
══════════════════════════════════════════
There are exactly two speakers: IR EXECUTIVE and INVESTOR.

IR EXECUTIVE: Says their own name + "Wint Wealth" in their introduction. Explains products and resolves queries.
INVESTOR: Often speaks first — answers with "Hello?", "Haan?", or silence. Asks questions, raises problems.

DECISION PROCEDURE:
1. Listen to the whole call first.
2. Whoever says their name + "Wint Wealth" = IR EXECUTIVE for the entire call.
3. The other voice = INVESTOR for the entire call.
4. A short "Hello?" or "Haan?" with no introduction at the start = INVESTOR.

══════════════════════════════════════════
TRANSCRIPTION RULES
══════════════════════════════════════════
- Each segment = one complete speaker turn.
- Transcribe every word spoken — do not skip, summarize, or paraphrase anything.
- During overlapping speech: transcribe what BOTH speakers said. The interrupted speaker's words appear in their segment up to the cutoff point; the interrupting speaker's words appear in their own new segment.
- Translate ALL non-English words (Tamil, Malayalam, Hindi, Telugu, Kannada, etc.) to natural fluent English. Put the English translation in the "text" field directly — do NOT add a separate "translation" field.
- Keep filler sounds as-is (uh, um, haan, theek hai).
- Mark translated:true for any segment with translated content.
- Report detected languages in the "language" field.

══════════════════════════════════════════
INTERRUPTION DETECTION
══════════════════════════════════════════
Listen carefully for moments where one speaker cuts off or talks over another.

An interruption occurs when Speaker A is talking and Speaker B starts speaking before Speaker A finishes their thought.
- Count the words Speaker A had spoken in that turn at the moment of interruption.
- Insert an interruption flag BEFORE the segment of the speaker who did the interrupting.
- Only flag as interruption if Speaker A had spoken fewer than 10 words in that turn when cut off.

Interruption flag format:
{"type":"interruption","interrupted_speaker":"[NAME]","interrupted_by":"[NAME]","words_spoken":[NUMBER]}

══════════════════════════════════════════
DEAD AIR DETECTION
══════════════════════════════════════════
Listen for pauses of 2 or more seconds where neither speaker is talking.
Insert a dead air flag at the point where the silence occurs.
Estimate the duration to the nearest second.
Note which speaker resumed the conversation.

Dead air flag format:
{"type":"dead_air","duration":"~[N] seconds","resumed_by":"[SPEAKER NAME]"}

Only flag dead air that is noticeably long (2+ seconds). Ignore normal conversational pauses under 2 seconds.

══════════════════════════════════════════
OUTPUT FORMAT
══════════════════════════════════════════
Return ONLY a valid JSON object. No markdown, no code fences.
Speech segments: {"type":"speech","speaker":"[NAME]","text":"[TEXT]","translated":false}
Interruption flags: {"type":"interruption","interrupted_speaker":"[NAME]","interrupted_by":"[NAME]","words_spoken":[N]}
Dead air flags: {"type":"dead_air","duration":"~[N] seconds","resumed_by":"[NAME]"}

Example output:
{"language":"English","segments":[
  {"type":"speech","speaker":"INVESTOR","text":"Hello?","translated":false},
  {"type":"dead_air","duration":"~2 seconds","resumed_by":"IR EXECUTIVE"},
  {"type":"speech","speaker":"IR EXECUTIVE","text":"Hello, good morning! This is Priya calling from Wint Wealth.","translated":false},
  {"type":"speech","speaker":"INVESTOR","text":"Yes tell me.","translated":false},
  {"type":"interruption","interrupted_speaker":"IR EXECUTIVE","interrupted_by":"INVESTOR","words_spoken":5},
  {"type":"speech","speaker":"INVESTOR","text":"Sorry, what was the maturity date again?","translated":false}
]}`;

// ── Energy / Tone scoring prompt (audio-based, Pass 1b) ───────────────────────
export const ENERGY_TONE_PROMPT = `You are evaluating the energy level, enthusiasm, and tone modulation of an IR Executive on a Wint Wealth customer service call.

Listen to the ENTIRE call. Assess ONLY the IR Executive's voice (not the investor).

Score this single parameter:

ENERGY LEVEL, ENTHUSIASM & TONE MODULATION
- Yes: The IR sounds engaged, warm, and energetic throughout. Tone varies naturally — not flat or robotic. Welcoming to queries regardless of call length. Does NOT sound scripted or uninterested.
- No: The IR sounds flat, bored, scripted, stern, or uninterested. Monotone delivery. Energy drops noticeably during the call.
- NA: Cannot assess from audio quality.

Return ONLY this JSON:
{"score":"Yes|No|NA","reasoning":"one sentence explanation"}`;

// ── Call disposition extraction prompt ────────────────────────────────────────
export const CALL_DISPOSITION_PROMPT = `You are analyzing a Wint Wealth IR call transcript. Extract the primary topic/disposition of this call.

Return ONLY this JSON:
{"call_disposition":"brief topic e.g. Payout Query, TDS Form Issue, Bond Maturity, Portfolio Question","call_sub_disposition":"more specific e.g. Delay in payout credit, Unable to submit Form 121"}`;

// ── Call IQS scoring system prompt (Pass 2, text-based) ──────────────────────
export const CALL_IQS_SYSTEM_PROMPT = `You are the Wint Wealth Call Quality evaluator. Score IR Executive voice call transcripts across 10 parameters.

The IR EXECUTIVE is the Wint Wealth agent. The INVESTOR is the customer.
Speech segments are numbered [1], [2], [3]... for reference.

## SCORING PHILOSOPHY
- Catch DEFINITIVE failures, not minor imperfections. When in doubt, score Yes.
- NA counts as Yes (pass) in the final IQS calculation.
- Never penalise for something the transcript does not clearly show.
- You receive the CALL TRANSCRIPT (primary — score this) and optionally a WHATSAPP CHAT TRANSCRIPT (context only).

---

## GROUP 1: PROCESS (50%)

### 1. Call Opening (5%)
- Yes: IR introduces themselves by name AND says "Wint Wealth" within the first 5 seconds / opening turn.
- No: No self-introduction, or "Wint Wealth" not mentioned in the opening.
- NA: Very rare.

### 2. Call Closing (5%)
- Yes: IR ends with an appropriate warm closing — e.g. "Have a good day", "Thank you for calling", "Take care".
- No: Abrupt hang-up, no closing, or generic dismissal.
- NA: Call was cut off before closing was possible.

### 3. Technically / Legally Correct (15%)
- Yes: All product info is factually correct — bond name, yield, tenure, payout, taxation, lock-in, redemption, penalty terms.
- No: Clear factual error about product details, returns, timelines, or legal requirements.
- NA: No substantive product information exchanged.

### 4. All Questions Addressed (10%)
- Yes: Every investor question was answered directly, or explicitly deferred with a reason.
- No: An investor question was ignored, redirected without answering, or left hanging.
- NA: Very rare.

### 5. Expectation Setting (10%)
- Yes: IR gave a specific timeline, next step, or commitment — e.g. "credited within 7 working days", "I'll email you by 5 PM".
- No: Investor asked when/how long and got no specific answer. Or promise made without timeframe.
- NA: No timeline-sensitive question asked.

### 6. Process (5%)
- Yes: IR checked the investor's query details (from chat or previous interaction) before the call. Did not ask investor to repeat information already shared. Pre-checked Wint Finder for client details.
- No: IR asked investor to repeat information already known, or clearly had not reviewed prior context.
- NA: No prior context existed to check.

---

## GROUP 2: COMMUNICATION SKILLS (30%)

### 7. Vocabulary / Grammar / Pronunciation (10%)
- Yes: Clear sentence structure, correct grammar, professional vocabulary. Easy to follow.
- No: Repeated grammatical errors, broken sentences, mispronunciations that caused confusion.
- NA: Very rare. Minor slips acceptable.

### 8. Fillers, Fumbling & Clarity (10%)
- Yes: Minimal fillers (uh, um, aaa). No fumbling or stammering. Speech is clear and confident.
- No: Excessive fillers, repeated stammering, or unclear speech that reduced investor confidence.
- NA: Very rare.

### 9. Energy Level, Enthusiasm & Tone (10%)
- NOTE: This parameter is scored separately from audio. Use the provided audio_score here.
- Yes / No / NA as provided by the audio analysis.

---

## GROUP 3: CUSTOMER SERVICE SKILLS (20%)

### 10. Active Listening, Interruptions & Empathy (10%)
- Yes: IR listened actively — did not interrupt the investor, did not ask them to repeat (unless truly inaudible), showed empathy ("I understand", "I'm sorry for the inconvenience").
- No: IR interrupted investor, asked investor to repeat unnecessarily, or showed no empathy.
- NA: Very rare.

### 11. Simplifying Answers (10%)
- Yes: IR explained financial terms in simple language. Offered to elaborate if needed. Answers were easy for a non-expert to understand.
- No: Heavy jargon used without explanation. Investor seemed confused or had to ask for clarification.
- NA: No complex terms were used.

---

## POOR LISTENING DETECTION
Identify any speech segment numbers where the IR Executive said phrases showing they did not hear/understand — e.g. "could you repeat", "say that again", "I didn't catch that", "I didn't understand", "pardon", "sorry what did you say", "I didn't get that", "can you please repeat".

---

## OUTPUT FORMAT
Respond with EXACTLY this JSON — no other text:
\`\`\`json
{
  "scores": {
    "CallOpening":        "Yes|No|NA",
    "CallClosing":        "Yes|No|NA",
    "TechnicallyLegal":   "Yes|No|NA",
    "AllQuestions":       "Yes|No|NA",
    "ExpectationSetting": "Yes|No|NA",
    "Process":            "Yes|No|NA",
    "VocabularyGrammar":  "Yes|No|NA",
    "FillersClarity":     "Yes|No|NA",
    "EnergyTone":         "Yes|No|NA",
    "ActiveListening":    "Yes|No|NA",
    "SimplifyingAnswers": "Yes|No|NA"
  },
  "reasoning": {
    "CallOpening":        "brief reason",
    "CallClosing":        "brief reason",
    "TechnicallyLegal":   "brief reason",
    "AllQuestions":       "brief reason",
    "ExpectationSetting": "brief reason",
    "Process":            "brief reason",
    "VocabularyGrammar":  "brief reason",
    "FillersClarity":     "brief reason",
    "EnergyTone":         "brief reason",
    "ActiveListening":    "brief reason",
    "SimplifyingAnswers": "brief reason"
  },
  "poor_listening_segments": [
    {"segment_index": 7, "phrase": "Could you please repeat that?"}
  ],
  "iqs_score": 85,
  "summary": "1-2 sentence overall assessment"
}
\`\`\`
CRITICAL: Output ONLY the JSON.`;

// ── Build call scoring prompt ─────────────────────────────────────────────────
export function buildCallScoringPrompt(
  callTranscriptText: string,
  chatTranscriptText: string,
  callId: string,
  interruptionCount: number,
  deadAirCount: number,
  callDisposition = '',
  chatDisposition = '',
  kbContext = '',
): string {
  return `Score the following Wint Wealth IR call.

## CALL METADATA
- Call ID: ${callId}
- Interruptions detected: ${interruptionCount}
- Dead air instances: ${deadAirCount}
- Call disposition (extracted from call): ${callDisposition || 'Unknown'}
- Chat disposition (from WhatsApp classification): ${chatDisposition || 'Unknown'}
${kbContext ? `
## WINT KNOWLEDGE BASE REFERENCE
${kbContext}
` : ''}
## CALL TRANSCRIPT — score this (segments numbered for poor_listening_segments reference)
${callTranscriptText}
${chatTranscriptText ? `
## WHATSAPP CHAT CONTEXT — reference only, do NOT score this
${chatTranscriptText}
` : ''}
Score all 11 parameters. Output ONLY the JSON.`;
}

// ── Parse transcription response ──────────────────────────────────────────────
export function parseTranscriptionResponse(raw: string): { language: string; segments: CallSegment[] } {
  const parsed = robustJsonParse(raw);
  if (!parsed) return { language: 'English', segments: [] };
  if (Array.isArray(parsed)) return { language: 'Unknown', segments: parsed };
  return {
    language: parsed.language || 'English',
    segments: Array.isArray(parsed.segments) ? parsed.segments : [],
  };
}

// ── Parse call disposition response ──────────────────────────────────────────
export function parseCallDisposition(raw: string): { callDisposition: string; callSubDisposition: string } {
  try {
    const parsed = robustJsonParse(raw);
    return {
      callDisposition: parsed?.call_disposition || '',
      callSubDisposition: parsed?.call_sub_disposition || '',
    };
  } catch {
    return { callDisposition: '', callSubDisposition: '' };
  }
}

// ── Parse energy/tone response ────────────────────────────────────────────────
export function parseEnergyToneResponse(raw: string): { score: CallParamScore; reasoning: string } {
  try {
    const parsed = robustJsonParse(raw);
    const score = parsed?.score as CallParamScore;
    return {
      score: ['Yes', 'No', 'NA'].includes(score) ? score : 'NA',
      reasoning: parsed?.reasoning || '',
    };
  } catch {
    return { score: 'NA', reasoning: '' };
  }
}

// ── Parse call IQS scoring response ──────────────────────────────────────────
export function parseCallScoringResponse(raw: string): {
  scores: Record<string, CallParamScore>;
  reasoning: Record<string, string>;
  poorListeningSegments: PoorListeningSegment[];
  iqs: number;
  summary: string;
} {
  const data = robustJsonParse(raw);
  const scores: Record<string, CallParamScore> = data?.scores || {};
  const reasoning: Record<string, string> = data?.reasoning || {};
  const poorListeningSegments: PoorListeningSegment[] = data?.poor_listening_segments || [];
  const iqs = calculateCallIQS(scores);
  return { scores, reasoning, poorListeningSegments, iqs, summary: data?.summary || '' };
}

// ── Robust JSON parser (5-step fallback) ──────────────────────────────────────
function normalizeTranscription(r: any): { language: string; segments: CallSegment[] } {
  if (Array.isArray(r)) return { language: 'Unknown', segments: r };
  if (r?.segments) return { language: r.language || 'Unknown', segments: r.segments };
  return { language: r?.language || 'Unknown', segments: [] };
}

function robustJsonParse(raw: string): any {
  if (!raw?.trim()) return null;
  let s = raw.trim();

  // Step 1: strip markdown fences
  const block = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (block) s = block[1].trim();

  // Step 2: parse as-is
  try { return JSON.parse(s); } catch {}

  // Step 3: extract outermost { }
  const oa = s.indexOf('{'), ob = s.lastIndexOf('}');
  if (oa >= 0 && ob > oa) { try { return JSON.parse(s.slice(oa, ob + 1)); } catch {} }

  // Step 4: extract outermost [ ]
  const aa = s.indexOf('['), ab = s.lastIndexOf(']');
  if (aa >= 0 && ab > aa) { try { return JSON.parse(s.slice(aa, ab + 1)); } catch {} }

  // Step 5: fix trailing commas
  if (oa >= 0 && ob > oa) { try { return JSON.parse(s.slice(oa, ob + 1).replace(/,\s*([}\]])/g, '$1')); } catch {} }
  if (aa >= 0 && ab > aa) { try { return JSON.parse(s.slice(aa, ab + 1).replace(/,\s*([}\]])/g, '$1')); } catch {} }

  throw new Error(`Cannot parse response: ${s.slice(0, 300)}`);
}
