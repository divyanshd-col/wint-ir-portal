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
  type: 'speech' | 'interruption' | 'dead_air' | 'poor_listening' | 'active_listening';
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
      const content = seg.text || '';
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

Pay close attention to names — IR executives introduce themselves by name (e.g. "This is Priya from Wint Wealth").
Transcribe that name EXACTLY as heard. Similarly transcribe bond names, fund names, and product names exactly as spoken.
CRITICAL: NEVER guess, infer, or hallucinate any proper noun (person names, bond names, company names, product names).
If a name is unclear, write it phonetically as best you can, or write [unclear]. Do NOT substitute a different name.

══════════════════════════════════════════
TRANSCRIPTION RULES
══════════════════════════════════════════
- Each segment = one complete speaker turn.
- Transcribe EVERY single word spoken — do not skip, summarize, or paraphrase anything.
- During overlapping speech: transcribe what BOTH speakers said. The interrupted speaker's words appear in their segment up to the cutoff point; the interrupting speaker's words appear in their own new segment.
- Translate ALL non-English words (Tamil, Malayalam, Hindi, Telugu, Kannada, etc.) to natural fluent English.
  Put the English translation directly in the "text" field — do NOT add a separate "translation" field.
  CRITICAL: Even a single non-English word in an otherwise English sentence must be fully translated. No exceptions.
- Keep filler sounds as-is where they are English (uh, um). Translate non-English fillers (haan → yes, theek hai → okay).
- Set "translated": true for any segment that contained non-English words (even partially).
- Report all detected languages in the "language" field.

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
ACTIVE LISTENING DETECTION
══════════════════════════════════════════
Listen for any moment where the IR EXECUTIVE indicates they could not hear or understand the investor.
This includes phrases like (in any language):
- "I cannot hear you" / "I can't hear you" / "Hello? I can't hear"
- "Can you please repeat?" / "Could you please repeat that?" / "Please come again"
- "I'm sorry, I didn't understand" / "I didn't catch that" / "I didn't get that"
- "Pardon?" / "Sorry, what did you say?" / "Can you come again?"
- Equivalent phrases in Hindi, Telugu, Tamil, Kannada, Malayalam, etc.

When detected, insert an active_listening flag IMMEDIATELY AFTER the IR EXECUTIVE speech segment where this phrase appears:
{"type":"active_listening","phrase":"[exact phrase spoken, translated to English]"}

Example: IR says "Sorry sir, I could not hear you, could you please repeat?" then insert:
{"type":"active_listening","phrase":"Sorry sir, I could not hear you, could you please repeat?"}

══════════════════════════════════════════
OUTPUT FORMAT
══════════════════════════════════════════
Return ONLY a valid JSON object. No markdown, no code fences.
Speech segments use: {"type":"speech","speaker":"[NAME]","text":"[ENGLISH TEXT]","translated":false}
Interruption flags use: {"type":"interruption","interrupted_speaker":"[NAME]","interrupted_by":"[NAME]","words_spoken":[N]}
Dead air flags use: {"type":"dead_air","duration":"~[N] seconds","resumed_by":"[NAME]"}
Active listening flags use: {"type":"active_listening","phrase":"[exact phrase in English]"}

Example output (mixed Telugu + English call):
{"language":"Telugu + English","segments":[
  {"type":"speech","speaker":"INVESTOR","text":"Hello?","translated":false},
  {"type":"dead_air","duration":"~2 seconds","resumed_by":"IR EXECUTIVE"},
  {"type":"speech","speaker":"IR EXECUTIVE","text":"Hello, good morning! This is Priya calling from Wint Wealth.","translated":false},
  {"type":"speech","speaker":"INVESTOR","text":"Yes sir, please go ahead.","translated":true},
  {"type":"interruption","interrupted_speaker":"IR EXECUTIVE","interrupted_by":"INVESTOR","words_spoken":5},
  {"type":"speech","speaker":"INVESTOR","text":"When will that bond mature?","translated":true}
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

// ── Call disposition extraction prompt (loose — used for KB query) ────────────
export const CALL_DISPOSITION_PROMPT = `You are analyzing a Wint Wealth IR call transcript. Extract the primary topic/disposition of this call.

Return ONLY this JSON:
{"call_disposition":"brief topic e.g. Payout Query, TDS Form Issue, Bond Maturity, Portfolio Question","call_sub_disposition":"more specific e.g. Delay in payout credit, Unable to submit Form 121"}`;

// ── Call disposition classification prompt (constrained to official 14-category list) ─
export const CALL_DISPOSITION_CLASSIFY_PROMPT = `You are classifying a Wint Wealth IR call transcript into an official disposition and sub-disposition.

You MUST choose EXACTLY one disposition and one sub-disposition from the lists below. Do not invent new values.
If the call touches multiple topics, pick the one that consumed the most conversation time.
If nothing fits, use disposition "OTHERS" and the closest sub-disposition.

## OFFICIAL DISPOSITION LIST

LIQUIDITY
  - Liquidity General Enquiry
  - Liquidity Process
  - Liquidity Status Update
  - Liquidity Charges
  - Liquidity DDPI Status
  - Liquidity cancellation
  - Liquidity Funds Not Received
  - Interest payout after selling a bond

SGB
  - SGB Enquiry
  - SGBs Not Visible in Portfolio

REFERRAL PROGRAM
  - Refer & Earn Not Activated
  - Referral reward calculation
  - Referred User Not Showing (referral mapping)

TAXATION
  - Tax deduction
  - Taxation Statement/Reports
  - Taxation TDS Certificate
  - Taxation 15G/H
  - Taxation Capital Gain/Loss

BOND PURCHASE
  - Bond Purchase Cancellation
  - Bond Purchase Order Status
  - Bond Purchase issue
  - Bond Purchase Process
  - Net Banking unavailable

FD
  - FD Withdrawal
  - FD Order status
  - FD Nominee details
  - FD Order pending
  - FD KYC
  - FD Bugs
  - FD not visible in the portfolio
  - FD interest

Interest Repayment
  - Interest Repayment Issue
  - Asset YTM/Coupon
  - Interest Repayment When/Where
  - Interest Repayment Breakup

ASSET
  - Asset Risk
  - Asset Specific Requirement
  - Asset Covenant Breach
  - Asset Limit
  - Asset NRI

FLEXI-TENURE BOND
  - flexi general enquiry
  - flexi sell process
  - flexi interest
  - flexi tenure change

SIP
  - SIP general enquiry
  - SIP modification
  - SIP cancellation
  - SIP Instalment Skip

WINT WISDOM
  - General Enquiry
  - Bugs
  - Portfolio and Risk
  - Tax and Optimisation

DIVERISIFICATION METER
  - Diversification Meter General

OTHERS
  - Unsubscribe Whatsapp
  - Advisory
  - Partnership
  - Request for RM
  - OTP not received
  - PT Refund Pending
  - Bond Name Change

SEBI KYC
  - SEBI KYC HUF
  - SEBI KYC Demat Query
  - SEBI KYC General Enquiry
  - SEBI KYC Delete Account
  - SEBI KYC NSDL SPEEDE
  - SEBI KYC Documents
  - Profile Change
  - SEBI KYC Details Change
  - Selfie Capture
  - Nominee
  - ACF link generation

## OUTPUT
Return ONLY this JSON — no other text:
{"disposition":"<exact disposition from list above>","sub_disposition":"<exact sub-disposition from list above>"}`;

// ── Call chunking prompt ──────────────────────────────────────────────────────
export const CALL_CHUNK_PROMPT = `You are breaking a Wint Wealth IR call transcript into topic-based chunks for knowledge retrieval.

Split the transcript at every point where the topic clearly changes. Each chunk should capture one distinct topic discussed.
Aim for 2–8 chunks per call. Do not create tiny chunks (< 3 speaker turns) unless the topic is completely self-contained.

For each chunk output:
- "topic": short label (5–10 words) describing what this chunk is about
- "summary": 1–2 sentence plain-English summary of what was discussed and resolved (if anything)
- "content": the raw transcript lines that belong to this chunk (copy them verbatim)

Return ONLY a valid JSON array — no other text:
[
  {
    "topic": "Opening and investor identity",
    "summary": "IR introduced herself and confirmed investor details.",
    "content": "[1] IR EXECUTIVE: Hello, good morning! This is Priya from Wint Wealth...\\n[2] INVESTOR: Yes, good morning."
  },
  {
    "topic": "Bond payout timeline query",
    "summary": "Investor asked when their Muthoot NCD interest would be credited. IR confirmed 5–7 working days from record date.",
    "content": "[3] INVESTOR: I wanted to ask about my payout...\\n[4] IR EXECUTIVE: The interest will be credited within 5 to 7 working days."
  }
]`;

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
  try {
    const parsed = robustJsonParse(raw);
    if (!parsed) return { language: 'English', segments: [] };
    if (Array.isArray(parsed)) return { language: 'Unknown', segments: parsed };
    return {
      language: parsed.language || 'English',
      segments: Array.isArray(parsed.segments) ? parsed.segments : [],
    };
  } catch {
    // Truncated JSON recovery — Gemini hit output token limit mid-response.
    // Extract language + any complete segment objects from the partial string.
    const langMatch = raw.match(/"language"\s*:\s*"([^"]+)"/);
    const language = langMatch?.[1] || 'English';
    const segments: CallSegment[] = [];
    const segRegex = /\{[^{}]*"type"\s*:\s*"[^"]*"[^{}]*\}/g;
    let m: RegExpExecArray | null;
    while ((m = segRegex.exec(raw)) !== null) {
      try {
        const seg = JSON.parse(m[0]);
        if (seg?.type) segments.push(seg as CallSegment);
      } catch {}
    }
    console.warn(`[parseTranscriptionResponse] Truncated JSON recovered: ${segments.length} segments, language=${language}`);
    return { language, segments };
  }
}

// ── Parse call disposition response (loose) ──────────────────────────────────
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

// ── Parse constrained classification response ─────────────────────────────────
export function parseCallDispositionClassified(raw: string): { disposition: string; subDisposition: string } {
  try {
    const parsed = robustJsonParse(raw);
    return {
      disposition: parsed?.disposition || '',
      subDisposition: parsed?.sub_disposition || '',
    };
  } catch {
    return { disposition: '', subDisposition: '' };
  }
}

// ── Parse call chunk response ─────────────────────────────────────────────────
export interface CallChunk {
  topic: string;
  summary: string;
  content: string;
}

export function parseCallChunks(raw: string): CallChunk[] {
  try {
    const parsed = robustJsonParse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((c: any) => c?.topic && c?.content).map((c: any) => ({
      topic: String(c.topic),
      summary: String(c.summary || ''),
      content: String(c.content),
    }));
  } catch {
    return [];
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
