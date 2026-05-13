/**
 * Call quality scoring — types, weights, prompts, and helpers.
 * 10 parameters across 3 groups. Chat and call scored independently.
 */

// ── Parameter weights (must sum to 1.0) ──────────────────────────────────────

export const CALL_WEIGHTS: Record<string, number> = {
  TechnicalLegal: 0.20,
  AllQuestions:   0.10,
  ProcessWise:    0.05,
  Opening:        0.05,
  OnCall:         0.05,
  Contextual:     0.10,
  Tags:           0.05,
  Expectation:    0.10,
  Sentences:      0.10,
  Grammar:        0.05,
  Empathy:        0.05,
  FollowUp:       0.10,
};

export const CALL_PARAM_NAMES: Record<string, string> = {
  TechnicalLegal: 'Technically / Legal-wise',
  AllQuestions:   'All Questions Answered',
  ProcessWise:    'Process-wise',
  Opening:        'First Response & Opening',
  OnCall:         'Going on a call (when required)',
  Contextual:     'Contextual & Personal Answers',
  Tags:           'Tags Accuracy',
  Expectation:    'Expectation Setting',
  Sentences:      'Sentences (simple to understand)',
  Grammar:        'Grammatically & Structurally correct',
  Empathy:        'Empathy',
  FollowUp:       'Personalised Follow-up & Closing',
};

export const CALL_PARAM_GROUPS: Record<string, { label: string; keys: string[] }> = {
  technical: {
    label: 'Technical Answer (35%)',
    keys: ['TechnicalLegal', 'AllQuestions', 'ProcessWise'],
  },
  process: {
    label: 'Process Knowledge (35%)',
    keys: ['Opening', 'OnCall', 'Contextual', 'Tags', 'Expectation'],
  },
  grammarTone: {
    label: 'Grammar & Tone (15%)',
    keys: ['Sentences', 'Grammar'],
  },
  extraMile: {
    label: 'Going an Extra Mile (15%)',
    keys: ['Empathy', 'FollowUp'],
  },
};

export const CALL_PARAM_ORDER = [
  'TechnicalLegal', 'AllQuestions', 'ProcessWise',
  'Opening', 'OnCall', 'Contextual', 'Tags', 'Expectation',
  'Sentences', 'Grammar',
  'Empathy', 'FollowUp',
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
export const CALL_IQS_SYSTEM_PROMPT = `You are the Wint Wealth Call Quality evaluator. Score IR Executive voice call transcripts across 12 parameters.

The IR EXECUTIVE is the Wint Wealth agent. The INVESTOR is the customer.
Speech segments are numbered [1], [2], [3]... for reference.

## SCORING PHILOSOPHY
- Catch DEFINITIVE failures, not minor imperfections. When in doubt, score Yes.
- NA counts as Yes (pass) in the final IQS calculation.
- Never penalise for something the transcript does not clearly show.
- You receive the CALL TRANSCRIPT (primary — score this) and optionally a WHATSAPP CHAT TRANSCRIPT (context only).

---

## GROUP 1: TECHNICAL ANSWER (35%)

### 1. Technically / Legal-wise (20%) — key: TechnicalLegal
- Yes: All product info is factually correct — bond name, yield, tenure, payout, taxation, lock-in, redemption, penalty terms. Legally correct statements.
- No: Clear factual or legal error about product details, returns, timelines, or regulatory requirements.
- NA: No substantive product information exchanged.

### 2. All Questions Answered (10%) — key: AllQuestions
- Yes: Every investor question was answered directly, or explicitly deferred with a reason.
- No: An investor question was ignored, redirected without answering, or left hanging.
- NA: Very rare.

### 3. Process-wise (5%) — key: ProcessWise
- Yes: IR followed correct process — checked prior chat/Finder before the call, did not ask investor to repeat already-shared info.
- No: IR clearly had not reviewed prior context, asked investor to repeat known information, or followed the wrong process.
- NA: No prior context existed to check.

---

## GROUP 2: PROCESS KNOWLEDGE (35%)

### 4. First Response & Opening (5%) — key: Opening
- Yes: IR introduces themselves by name AND says "Wint Wealth" in their opening turn.
- No: No self-introduction, or "Wint Wealth" not mentioned in the opening.
- NA: Very rare.

### 5. Going on a call (when required) (5%) — key: OnCall
- Yes: The call itself was appropriate — investor needed a call and it was handled, or no call was needed.
- No: Call was not needed and was made without reason, OR call was clearly needed but was not arranged.
- NA: Cannot determine from transcript whether a call was appropriate.

### 6. Contextual & Personal Answers (10%) — key: Contextual
- Yes: IR's answers are tailored to this specific investor — references their bond name, amounts, dates, account details.
- No: Generic answers that could apply to any investor. Copy-paste responses with no personalisation.
- NA: Very rare.

### 7. Tags Accuracy (5%) — key: Tags
- Yes: IR correctly identified and tagged the call disposition/topic based on the investor's query.
- No: Wrong disposition applied, or no attempt to classify the call topic.
- NA: Cannot determine from transcript.

### 8. Expectation Setting (10%) — key: Expectation
- Yes: IR gave a specific timeline, next step, or commitment — e.g. "credited within 7 working days", "I'll email you by 5 PM".
- No: Investor asked when/how long and got no specific answer. Promise made without a timeframe.
- NA: No timeline-sensitive question asked.

---

## GROUP 3: GRAMMAR & TONE (15%)

### 9. Sentences (simple to understand) (10%) — key: Sentences
- Yes: IR speaks in clear, simple sentences. Financial terms explained in plain language. Easy for a non-expert to understand.
- No: Heavy jargon without explanation. Long rambling sentences. Investor confused or had to ask for clarification.
- NA: Very rare.

### 10. Grammatically & Structurally correct (5%) — key: Grammar
- Yes: Clear grammar and pronunciation. Professional vocabulary. Easy to follow.
- No: Repeated grammatical errors, broken sentences, or mispronunciations that caused confusion.
- NA: Very rare. Minor slips acceptable.

---

## GROUP 4: GOING AN EXTRA MILE (15%)

### 11. Empathy (5%) — key: Empathy
- Yes: IR showed genuine empathy — acknowledged the investor's concern, apologised for inconvenience, or expressed understanding.
- No: Purely transactional. No acknowledgment of investor's emotional state. Robotic or dismissive tone.
- NA: Very rare.

### 12. Personalised Follow-up & Closing (10%) — key: FollowUp
- Yes: IR ended with a warm, personalised closing that reflects the outcome — resolved / ticket raised / pending — with a clear next step.
- No: Abrupt hang-up, no closing, or a generic scripted close with no reference to the investor's specific situation.
- NA: Call was cut off before closing was possible.

---

## POOR LISTENING DETECTION
Identify any speech segment numbers where the IR Executive said phrases showing they did not hear/understand — e.g. "could you repeat", "say that again", "I didn't catch that", "pardon", "sorry what did you say", "can you please repeat".

---

## OUTPUT FORMAT
Respond with EXACTLY this JSON — no other text:
\`\`\`json
{
  "scores": {
    "TechnicalLegal": "Yes|No|NA",
    "AllQuestions":   "Yes|No|NA",
    "ProcessWise":    "Yes|No|NA",
    "Opening":        "Yes|No|NA",
    "OnCall":         "Yes|No|NA",
    "Contextual":     "Yes|No|NA",
    "Tags":           "Yes|No|NA",
    "Expectation":    "Yes|No|NA",
    "Sentences":      "Yes|No|NA",
    "Grammar":        "Yes|No|NA",
    "Empathy":        "Yes|No|NA",
    "FollowUp":       "Yes|No|NA"
  },
  "reasoning": {
    "TechnicalLegal": "brief reason",
    "AllQuestions":   "brief reason",
    "ProcessWise":    "brief reason",
    "Opening":        "brief reason",
    "OnCall":         "brief reason",
    "Contextual":     "brief reason",
    "Tags":           "brief reason",
    "Expectation":    "brief reason",
    "Sentences":      "brief reason",
    "Grammar":        "brief reason",
    "Empathy":        "brief reason",
    "FollowUp":       "brief reason"
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
Score all 12 parameters. Output ONLY the JSON.`;
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
