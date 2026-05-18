/**
 * Call quality scoring — types, weights, prompts, and helpers.
 * 10 parameters across 3 groups. Chat and call scored independently.
 */

// ── Parameter weights (must sum to 1.0) ──────────────────────────────────────

export const CALL_WEIGHTS: Record<string, number> = {
  CallOpening:     0.05,
  CallClosing:     0.05,
  TechnicalLegal:  0.15,
  AllQuestions:    0.10,
  Expectation:     0.10,
  Process:         0.05,
  Grammar:         0.10,
  Fillers:         0.10,
  EnergyTone:      0.10,
  ActiveListening: 0.10,
  Simplifying:     0.10,
};

export const CALL_PARAM_NAMES: Record<string, string> = {
  CallOpening:     'Call Opening',
  CallClosing:     'Call Closing',
  TechnicalLegal:  'Technically / Legally Correct',
  AllQuestions:    'All Questions Addressed',
  Expectation:     'Expectation Setting',
  Process:         'Process',
  Grammar:         'Vocabulary / Sentence Structure / Grammar / Pronunciations',
  Fillers:         'Fillers, Fumbling & Stammering. Clarity of Speech. Avoid Dead Air',
  EnergyTone:      'Energy Level, Enthusiasm & Tone Modulation',
  ActiveListening: 'Active Listening, Interruptions & Empathy',
  Simplifying:     'Simplifying Answers',
};

export const CALL_PARAM_GROUPS: Record<string, { label: string; keys: string[] }> = {
  process: {
    label: 'Process (50%)',
    keys: ['CallOpening', 'CallClosing', 'TechnicalLegal', 'AllQuestions', 'Expectation', 'Process'],
  },
  communication: {
    label: 'Communication Skills (30%)',
    keys: ['Grammar', 'Fillers', 'EnergyTone'],
  },
  customerService: {
    label: 'Customer Service Skills (20%)',
    keys: ['ActiveListening', 'Simplifying'],
  },
};

export const CALL_PARAM_ORDER = [
  'CallOpening', 'CallClosing', 'TechnicalLegal', 'AllQuestions', 'Expectation', 'Process',
  'Grammar', 'Fillers', 'EnergyTone',
  'ActiveListening', 'Simplifying',
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
  translation?: string;
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
      // Use English translation for LLM scoring when available; fall back to original text
      const content = seg.translation || seg.text || '';
      lines.push(`[${speechIdx}] ${seg.speaker}: ${content}${seg.translated ? ' [translated]' : ''}`);
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
- For non-English speech (Tamil, Malayalam, Hindi, Telugu, Kannada, etc.):
  • "text" field: verbatim transcription in the ORIGINAL language (exactly what was spoken)
  • "translation" field: natural, fluent English translation of what was said
  • "translated": true
- For English speech: "text" field only, no "translation" field, "translated": false
- Keep filler sounds as-is in "text" (uh, um, haan, theek hai). Translate their meaning in "translation" if non-English.
- Report detected languages in the "language" field.

══════════════════════════════════════════
INTERRUPTION DETECTION
══════════════════════════════════════════
Listen carefully for moments where one speaker cuts off or talks over another.

An interruption occurs when Speaker A is talking and Speaker B starts speaking before Speaker A finishes their thought.
- Count the words Speaker A had spoken in that turn at the moment of interruption.
- Insert an interruption flag BEFORE the segment of the speaker who did the interrupting.
- Only flag as interruption if Speaker A had spoken fewer than 10 words in that turn when cut off.

Interruption flag format (insert as a segment object):
{"type":"interruption","interrupted_speaker":"[NAME]","interrupted_by":"[NAME]","words_spoken":[NUMBER]}

Example: IR EXECUTIVE was saying "So the bond matures in three" (6 words) when INVESTOR cut in:
{"type":"interruption","interrupted_speaker":"IR EXECUTIVE","interrupted_by":"INVESTOR","words_spoken":6}

══════════════════════════════════════════
DEAD AIR DETECTION
══════════════════════════════════════════
Listen for pauses of 2 or more seconds where neither speaker is talking.
Insert a dead air flag at the point in the conversation where the silence occurs.
Estimate the duration to the nearest second.
Note which speaker resumed the conversation.

Dead air flag format (insert as a segment object):
{"type":"dead_air","duration":"~[N] seconds","resumed_by":"[SPEAKER NAME]"}

Example: {"type":"dead_air","duration":"~4 seconds","resumed_by":"INVESTOR"}

Only flag dead air that is noticeably long (2+ seconds). Ignore normal conversational pauses under 2 seconds.

══════════════════════════════════════════
OUTPUT FORMAT
══════════════════════════════════════════
Return ONLY a valid JSON object. No markdown, no code fences.

English speech segment:   {"type":"speech","speaker":"[NAME]","text":"[TEXT]","translated":false}
Non-English speech segment: {"type":"speech","speaker":"[NAME]","text":"[ORIGINAL LANGUAGE TEXT]","translation":"[ENGLISH TRANSLATION]","translated":true}
Interruption flag:  {"type":"interruption","interrupted_speaker":"[NAME]","interrupted_by":"[NAME]","words_spoken":[N]}
Dead air flag:      {"type":"dead_air","duration":"~[N] seconds","resumed_by":"[NAME]"}

Example output (mixed Hindi + English call):
{"language":"Hindi + English","segments":[
  {"type":"speech","speaker":"INVESTOR","text":"Hello?","translated":false},
  {"type":"dead_air","duration":"~2 seconds","resumed_by":"IR EXECUTIVE"},
  {"type":"speech","speaker":"IR EXECUTIVE","text":"Hello, good morning! This is Priya calling from Wint Wealth.","translated":false},
  {"type":"speech","speaker":"INVESTOR","text":"जी सर, हां बोलिए।","translation":"Yes sir, please go ahead.","translated":true},
  {"type":"interruption","interrupted_speaker":"IR EXECUTIVE","interrupted_by":"INVESTOR","words_spoken":5},
  {"type":"speech","speaker":"INVESTOR","text":"वो bond कब mature होगा?","translation":"When will that bond mature?","translated":true}
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
export const CALL_IQS_SYSTEM_PROMPT = `You are the Wint Wealth Call Quality evaluator. Score IR Executive voice call transcripts across 11 parameters.

The IR EXECUTIVE is the Wint Wealth agent. The INVESTOR is the customer.
Speech segments are numbered [1], [2], [3]... for reference.

## SCORING PHILOSOPHY
- Catch DEFINITIVE failures, not minor imperfections. When in doubt, score Yes.
- NA counts as Yes (pass) in the final IQS calculation.
- Never penalise for something the transcript does not clearly show.
- You receive the CALL TRANSCRIPT (primary — score this) and optionally a WHATSAPP CHAT TRANSCRIPT (context only).

---

## GROUP 1: PROCESS (50%)

### 1. Call Opening (5%) — key: CallOpening
- Yes: IR opens the call within 5 seconds with a self-introduction AND mentions "Wint Wealth".
- No: No self-introduction within the first few seconds, or "Wint Wealth" not mentioned in the opening.
- NA: Very rare.

### 2. Call Closing (5%) — key: CallClosing
- Yes: IR closes with an appropriate greeting/sign-off for the day (e.g. "Have a good day", "Thank you for calling").
- No: Abrupt hang-up with no closing greeting, or call was cut off.
- NA: Call was disconnected before closing was possible.

### 3. Technically / Legally Correct (15%) — key: TechnicalLegal
- Yes: All product information stated by the IR EXECUTIVE matches the WINT KNOWLEDGE BASE REFERENCE below — bond name, yield, tenure, payout, taxation, lock-in, redemption, penalty terms, registered entity names. In your reasoning, name the specific KB document and section that confirms each fact.
- No: A statement contradicts the KB, or the KB has no relevant entry to verify a significant product claim the IR made. State exactly what was claimed and what the KB says (or that it is absent from the KB).
- NA: No substantive product information was exchanged on this call.

### 4. All Questions Addressed (10%) — key: AllQuestions
- Yes: Every investor question was answered directly, or explicitly deferred with a reason.
- No: An investor question was ignored, redirected without answering, or left hanging.
- NA: Very rare.

### 5. Expectation Setting (10%) — key: Expectation
- Yes: IR gave a specific timeline, next step, or commitment — e.g. "credited within 7 working days", "I'll email you by 5 PM". Covers product info, TAT, and issue updates.
- No: Investor asked when/how long and got no specific answer. Promise made without a timeframe.
- NA: No timeline-sensitive question asked.

### 6. Process (5%) — key: Process
- Yes: IR checked the investor's prior chat query before the call and did not ask them to repeat already-shared info. Pre-checked details on Wint Finder to assist quickly without putting investor on hold.
- No: IR clearly had not reviewed prior chat context, asked investor to repeat known information, or did not pre-check Finder details causing unnecessary hold time.
- NA: No prior chat context existed to check.

---

## GROUP 2: COMMUNICATION SKILLS (30%)

### 7. Vocabulary / Sentence Structure / Grammar / Pronunciations (10%) — key: Grammar
- Yes: IR interacts with correct sentence structure, grammar, and clear pronunciation. Professional vocabulary.
- No: Repeated grammatical errors, broken sentences, or mispronunciations that caused confusion.
- NA: Very rare. Minor slips acceptable.

### 8. Fillers, Fumbling & Stammering. Clarity of Speech. Avoid Dead Air (10%) — key: Fillers
- Yes: No excessive fillers (aaa, uuumm), no fumbling or stammering. Clear confident delivery. Dead air avoided.
- No: Frequent fillers, fumbling, or stammering that made IR sound unconfident. Prolonged dead air on the call.
- NA: Very rare.

### 9. Energy Level, Enthusiasm & Tone Modulation (10%) — key: EnergyTone
- Yes: IR displays good tone and manner, not scripted. Energy maintained throughout. Welcoming to queries regardless of call length. Not uninterested or stern.
- No: IR sounds flat, bored, scripted, or uninterested. Monotone delivery. Energy drops noticeably.
- NA: Cannot assess from transcript alone (audio-based parameter — use audio signal if available).

---

## GROUP 3: CUSTOMER SERVICE SKILLS (20%)

### 10. Active Listening, Interruptions & Empathy (10%) — key: ActiveListening
- Yes: IR listens to the investor without interrupting. Does not make investor repeat themselves. Does not have a parallel conversation. Shows empathy when investor raises concerns.
- No: IR interrupted the investor, talked over them, made them repeat, or showed no empathy to a frustrated investor.
- NA: Very rare.

### 11. Simplifying Answers (10%) — key: Simplifying
- Yes: IR explains financial terms in plain language. Confirms with investor if they need further clarification. Avoids heavy jargon.
- No: Heavy unexplained jargon. Investor confused or had to ask for clarification. No attempt to simplify.
- NA: No complex financial terms discussed.

---

## POOR LISTENING DETECTION
Identify any speech segment numbers where the IR Executive said phrases showing they did not hear/understand — e.g. "could you repeat", "say that again", "I didn't catch that", "pardon", "sorry what did you say", "can you please repeat".

---

## OUTPUT FORMAT
Respond with EXACTLY this JSON — no other text:
\`\`\`json
{
  "scores": {
    "CallOpening":     "Yes|No|NA",
    "CallClosing":     "Yes|No|NA",
    "TechnicalLegal":  "Yes|No|NA",
    "AllQuestions":    "Yes|No|NA",
    "Expectation":     "Yes|No|NA",
    "Process":         "Yes|No|NA",
    "Grammar":         "Yes|No|NA",
    "Fillers":         "Yes|No|NA",
    "EnergyTone":      "Yes|No|NA",
    "ActiveListening": "Yes|No|NA",
    "Simplifying":     "Yes|No|NA"
  },
  "reasoning": {
    "CallOpening":     "brief reason",
    "CallClosing":     "brief reason",
    "TechnicalLegal":  "brief reason",
    "AllQuestions":    "brief reason",
    "Expectation":     "brief reason",
    "Process":         "brief reason",
    "Grammar":         "brief reason",
    "Fillers":         "brief reason",
    "EnergyTone":      "brief reason",
    "ActiveListening": "brief reason",
    "Simplifying":     "brief reason"
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
Use these excerpts from Wint's internal KB to verify whether the IR Executive's product information is technically correct. Pay close attention when scoring TechnicalLegal.

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
