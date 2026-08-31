/**
 * Call quality scoring — types, weights, prompts, and helpers.
 * 10 parameters across 3 groups. Chat and call scored independently.
 */

import { robustJsonParse } from './quality';

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
  iqs: number | null;
  scores: Record<string, CallParamScore>;
  reasoning: Record<string, string>;
  summary: string;
  modelVersion: string;
  scoredAt?: string;
}

// ── IQS calculation ───────────────────────────────────────────────────────────
export function calculateCallIQS(scores: Record<string, CallParamScore>): number | null {
  let total = 0, possible = 0;
  for (const [param, weight] of Object.entries(CALL_WEIGHTS)) {
    const score = scores[param] ?? 'NA';
    if (score !== 'NA') {
      possible += weight;
      if (score === 'Yes') {
        total += weight;
      }
    }
  }
  return possible > 0 ? Math.round((total / possible) * 100) : null;
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

IR EXECUTIVE: The Wint Wealth employee on the call. Professional, consultative tone. Explains bonds/funds and quotes yield, tenure, payout, and lock-in terms. Answers KYC/PAN/documentation questions. References "Wint Wealth", "RBI", "SEBI", or the platform/app. Often closes with "anything else I can help with?" / "thank you for calling Wint Wealth."
INVESTOR: The customer. Asks about returns, safety, tenure, or redemption. Supplies personal details (name, PAN, amount) when asked. May speak first OR second. May ask "Hello, is this Wint Wealth?" — this is still the INVESTOR asking a question, NOT the IR introducing themselves.

DECISION PROCEDURE (follow in order — each later step is a fallback for when the step above doesn't give a clear answer):
1. Listen to the ENTIRE call before labelling any speaker.
2. Use VOICE CHARACTERISTICS as the PRIMARY identifier: distinguish the two voices by pitch, gender, accent, and speaking style. The same voice must get the same label throughout the call — never re-assign a label to a different voice partway through.
3. PRIMARY ANCHOR — self-introduction: the speaker who says their OWN NAME + "Wint Wealth" in a self-introduction (e.g. "This is Rahul calling from Wint Wealth") = IR EXECUTIVE. Assign that voice as IR EXECUTIVE for the whole call; the other voice = INVESTOR for the entire call.
4. CRITICAL EDGE CASE: "Hello, is this Wint Wealth?" / "Am I speaking to Wint Wealth?" / "Are you calling from Wint?" is a QUESTION — only the INVESTOR would ask it. Do NOT label this voice IR EXECUTIVE just because it said "Wint".
5. FALLBACK ANCHOR — if no clean self-introduction is audible anywhere in the call (garbled opening, IR skips the intro, recording starts mid-call), identify the IR EXECUTIVE by ROLE/CONTENT instead: the voice that explains products, quotes bond/fund terms, answers questions, cites company policy, or requests/confirms KYC details is the IR EXECUTIVE. The voice that asks about returns/safety/tenure, raises concerns, or supplies personal details on request is the INVESTOR.
6. Do NOT rely on who speaks first. Either speaker may initiate the call.
7. SELF-CHECK before finalizing: re-scan every segment where "Wint" was spoken. If it was the INVESTOR's voice saying it in a self-introduction ("...from Wint Wealth"), or the IR EXECUTIVE's voice asking "is this Wint Wealth?", your labels are backwards — swap IR EXECUTIVE and INVESTOR across every segment before producing output.
8. Once you have identified both voices, apply the correct label to EVERY segment — never mix labels for the same voice.

Pay close attention to names — IR executives introduce themselves by name (e.g. "This is Priya from Wint Wealth").
Transcribe that name EXACTLY as heard. Similarly transcribe bond names, fund names, and product names exactly as spoken.
CRITICAL: NEVER guess, infer, or hallucinate any proper noun (person names, bond names, company names, product names).
If a name is unclear, write it phonetically as best you can, or write [unclear]. Do NOT substitute a different name.

══════════════════════════════════════════
TRANSCRIPTION RULES
══════════════════════════════════════════
- Process the ENTIRE audio recording from 0:00 to the very last second. DO NOT stop midway or skip later parts of the conversation. Keep transcribing until the final closing or disconnection.
- Each segment = one complete speaker turn.
- Transcribe EVERY single word spoken — do not skip, summarize, or paraphrase anything.
- During overlapping speech: transcribe what BOTH speakers said. The interrupted speaker's words appear in their segment up to the cutoff point; the interrupting speaker's words appear in their own new segment.
- Translate ALL non-English words (Tamil, Malayalam, Hindi, Telugu, Kannada, etc.) to natural fluent English.
  Put the English translation directly in the "text" field — do NOT add a separate "translation" field.
  CRITICAL: Even a single non-English word in an otherwise English sentence must be fully translated. No exceptions.
- Keep filler sounds as-is where they are English (uh, um). Translate non-English fillers (haan → yes, theek hai → okay).
- Set "translated": true for any segment that contained non-English words (even partially).
- Report all detected languages in the "language" field.
- EXTREMELY CRITICAL: Output MINIFIED JSON. Do NOT include extra whitespace, indentation, or newlines in the JSON output, to maximize token capacity for long calls.

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
Speech segments use: {"type":"speech","speaker":"[NAME]","text":"[ENGLISH TEXT]","translated":false,"ts":"M:SS"}
  where "ts" is the timestamp when this line begins in the audio, in M:SS format (e.g. "0:00", "1:32", "12:05").
Interruption flags use: {"type":"interruption","interrupted_speaker":"[NAME]","interrupted_by":"[NAME]","words_spoken":[N]}
Dead air flags use: {"type":"dead_air","duration":"~[N] seconds","resumed_by":"[NAME]"}
Active listening flags use: {"type":"active_listening","phrase":"[exact phrase in English]"}

Example output (mixed Telugu + English call):
{"language":"Telugu + English","segments":[
  {"type":"speech","speaker":"INVESTOR","text":"Hello?","translated":false,"ts":"0:00"},
  {"type":"dead_air","duration":"~2 seconds","resumed_by":"IR EXECUTIVE"},
  {"type":"speech","speaker":"IR EXECUTIVE","text":"Hello, good morning! This is Priya calling from Wint Wealth.","translated":false,"ts":"0:03"},
  {"type":"speech","speaker":"INVESTOR","text":"Yes sir, please go ahead.","translated":true,"ts":"0:08"},
  {"type":"interruption","interrupted_speaker":"IR EXECUTIVE","interrupted_by":"INVESTOR","words_spoken":5},
  {"type":"speech","speaker":"INVESTOR","text":"When will that bond mature?","translated":true,"ts":"1:45"}
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

// ── Call disposition classification prompt (synced with Robylon taxonomy) ─────
export const CALL_DISPOSITION_CLASSIFY_PROMPT = `You are classifying a Wint Wealth IR call transcript into an official disposition and sub-disposition.

You MUST choose EXACTLY one disposition and one sub-disposition from the lists below. Do not invent new values.
If the call touches multiple topics, pick the one that consumed the most conversation time.
If nothing fits, use disposition "Others" and the closest sub-disposition.

## OFFICIAL DISPOSITION LIST

Liquidity
  - Liquidity General Enquiry
  - Liquidity Process
  - Liquidity Status Update
  - Liquidity Charges
  - Liquidity DDPI Status
  - Liquidity Cancellation
  - Liquidity Funds Not Received
  - Interest Payout After Selling a Bond

SGB
  - SGB Enquiry
  - SGBs Not Visible in Portfolio

Referral Program
  - Refer & Earn Not Activated
  - Referral Reward Calculation
  - Referred User Not Showing

Taxation
  - Tax Deduction
  - Taxation Statement/Reports
  - Taxation TDS Certificate
  - Taxation Capital Gain/Loss
  - Form 121
  - Form 121 Status & Confirmation
  - Form 121 bugs
  - Form 121 Not Available

Bond Purchase
  - Bond Purchase Cancellation
  - Bond Purchase Order Status
  - Bond Purchase Issue
  - Bond Purchase Process
  - Net Banking Unavailable

FD
  - FD Withdrawal
  - FD Order Status
  - FD Nominee Details
  - FD Order Pending
  - FD KYC
  - FD Bugs
  - FD Not Visible in Portfolio
  - FD Interest

Interest Repayment
  - Interest Repayment Breakup
  - Interest Repayment When/Where
  - Asset YTM/Coupon
  - Interest / Principal Not Credited

Asset
  - Asset General Enquiry
  - Asset Risk
  - Asset Specific Requirement
  - Asset Covenant Breach
  - Asset Limit
  - Asset NRI

Flexi-Tenure Bond
  - Flexi General Enquiry
  - Flexi Sell Process
  - Flexi Interest
  - Flexi Tenure Change

SIP
  - SIP General Enquiry
  - SIP Modification
  - SIP Cancellation
  - SIP Instalment Skip

Wint Wisdom
  - Wint Wisdom General Enquiry
  - Wint Wisdom Bugs
  - Portfolio and Risk
  - Tax and Optimisation

Diversification Meter
  - Diversification Meter General

KYC
  - Bank Account linking issues
  - Aadhar / PAN Queries
  - KYC Status
  - ACF Link Generation
  - Nominee
  - Selfie Capture
  - SEBI KYC Details Change
  - Profile Change
  - SEBI KYC Documents
  - SEBI KYC NSDL SPEEDE
  - SEBI KYC Delete Account
  - KYC Process and Steps
  - SEBI KYC Demat Query
  - SEBI KYC HUF

Dashboard and Profile Query
  - Login & OTP Issue
  - App and Dashboard Bugs
  - Dashboard - General Query
  - Dashboard - Portfolio values
  - Dashboard and App Navigation

Wint Ivory
  - Wint Ivory Required
  - Wint Ivory General Query

Family Account
  - Family Account General Query

Junk Chats
  - No query asked

Others
  - Bond Name Change
  - PT Refund Pending
  - OTP Not Received
  - Request for RM
  - Partnership
  - Advisory
  - Unsubscribe Whatsapp

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

## READ THE COMPLETE TRANSCRIPT FIRST — NON-NEGOTIABLE
Before scoring ANY parameter, read the COMPLETE call transcript from segment [1] to the last segment. Do not begin scoring until every segment has been read. Scoring a parameter without reading the full call is invalid and will produce wrong results. Details that determine scores often appear late in the call — a closing, a correction, a follow-up question. Missing any segment = incorrect scores.

## SCORING PHILOSOPHY
- Catch DEFINITIVE failures, not minor imperfections. When in doubt, score Yes.
- NA parameters are excluded from the IQS calculation (both numerator and denominator). If all parameters are NA, the IQS score is NIL (null).
- Never penalise for something the transcript does not clearly show.
- You receive the CALL TRANSCRIPT (primary — score this) and optionally a WHATSAPP CHAT TRANSCRIPT (context only).
- **Date awareness**: Today's date is provided in CALL METADATA. Any date on or before today is a PAST event that has already occurred. Do NOT treat a past date as a missed future commitment when scoring Expectation. Only fail Expectation for missing or vague timelines on genuinely unresolved future issues — never for referencing dates that have already passed.

## EMPTY, UNCONNECTED, OR NON-CONVERSATION CALLS / JUNK CHATS
- If the call never went through, did not connect, was unanswered, disconnected immediately with no conversation, or was categorized as a Junk Chat / No query asked with no substantive dialogue:
  - Set EVERY parameter score to "NA".
  - Set summary explaining that the call did not take place / no conversation occurred.
  - Do NOT mark parameters as "No" or penalize the agent with 0 for an unattempted or failed connection. All "NA" will produce a NIL (null) score.

---

## PARAMETER ISOLATION — CRITICAL
Each parameter is fully independent. Its reasoning must stay within its own criteria only.

RULES:
1. The reasoning for parameter X must ONLY discuss the criteria defined for parameter X — nothing else.
2. NEVER mention another parameter's name inside a reasoning field.
3. NEVER evaluate CallOpening, CallClosing, Grammar, Fillers, ActiveListening, etc. inside the TechnicalLegal reasoning — each has its own separate scoring field.
4. If you find yourself writing about one parameter while filling in another parameter's reasoning, stop and remove it.

EXAMPLES OF WHAT NOT TO DO:
- TechnicalLegal reasoning: "The call closing was appropriate and the agent signed off well..." → WRONG. Call Closing belongs in CallClosing.reasoning only.
- CallOpening reasoning: "The agent's grammar was poor throughout..." → WRONG. Grammar belongs in Grammar.reasoning only.
- Expectation reasoning: "All investor questions were also addressed clearly..." → WRONG. That belongs in AllQuestions.reasoning.
- ActiveListening reasoning: "The IR gave incorrect product information about the bond..." → WRONG. Factual errors belong in TechnicalLegal.reasoning only.

Score each parameter as if you are filling in a completely separate evaluation form with no visibility into the others.

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

### 3. Technically / Legally Correct (15%) — key: TechnicalLegal ⚠️ HIGHEST PRIORITY PARAMETER
Technical and legal correctness is the utmost crucial point for IQS evaluation. There must not be even a hint of incorrect information in any customer conversation. Every factual claim the IR makes about products, rates, timelines, or regulations must be verifiably accurate — no exceptions.
- Yes: All product information stated by the IR EXECUTIVE matches the WINT KNOWLEDGE BASE REFERENCE below — bond name, yield, tenure, payout, taxation, lock-in, redemption, penalty terms, registered entity names. In your reasoning, name the specific KB document and section that confirms each fact.
- No: A statement contradicts the KB, or the KB has no relevant entry to verify a significant product claim the IR made. State exactly what was claimed and what the KB says (or that it is absent from the KB).
  Also No — SEBI / Regulatory violation (automatic fail, no KB needed): IR gave a personalised investment recommendation (e.g. "You should invest in this bond", "I suggest putting your money here"), implied guaranteed returns, or provided investment advisory services that would constitute unregistered advisory activity under SEBI regulations.
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
- Each speaker turn in the transcript is a separate spoken utterance — evaluate grammar per utterance, not across the full call as one continuous block. A pause or new turn does not mean a sentence is incomplete.
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
    "TechnicalLegal":  "brief reason — cite the KB document and section used",
    "AllQuestions":    "brief reason",
    "Expectation":     "brief reason",
    "Process":         "brief reason",
    "Grammar":         "brief reason",
    "Fillers":         "brief reason",
    "EnergyTone":      "brief reason",
    "ActiveListening": "brief reason",
    "Simplifying":     "brief reason"
  },
  "kbCitation": "Document Name > Section Heading (null if KB was not relevant)",
  "poor_listening_segments": [
    {"segment_index": 7, "phrase": "Could you please repeat that?"}
  ],
  "iqs_score": 85,
  "summary": "1-2 sentence overall assessment"
}
\`\`\`
CRITICAL: Output ONLY the JSON. For kbCitation, use the exact document name and section heading from the KB context provided (e.g. "Wint Fixed Deposits > Lock-in Period"). Set to null if no KB lookup was needed.`;

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
  const today = new Date().toISOString().split('T')[0];
  return `Score the following Wint Wealth IR call.

## CALL METADATA
- Call ID: ${callId}
- Today's date (scoring date): ${today}
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

// ── Deterministic speaker-label correction ────────────────────────────────────
// Detects swapped IR EXECUTIVE / INVESTOR labels via two heuristics:
// 1. INVESTOR segment says "Wint [Wealth]" in a self-introduction context
//    — only the IR introduces themselves as calling from Wint.
// 2. IR EXECUTIVE segment phrases "is this Wint Wealth?" or "are you from Wint"
//    — investor phrasing, not an IR self-introduction.
function fixSpeakerLabels(segments: CallSegment[]): CallSegment[] {
  const speechSegs = segments.filter(s => s.type === 'speech');

  // Heuristic 1: INVESTOR says "from Wint" / introduces as Wint Wealth employee
  const investorClaimsWint = speechSegs.some(
    s => s.speaker === 'INVESTOR' &&
         /\bwint\b/i.test(s.text || '') &&
         // Confirm it looks like a self-introduction, not a question about Wint
         !/is\s+this\s+wint|are\s+you\s+(from\s+)?wint|this\s+is\s+wint\?/i.test(s.text || ''),
  );

  // Heuristic 2: IR EXECUTIVE asks "is this Wint Wealth?" — investor question pattern
  const irAsksIfWint = speechSegs.some(
    s => s.speaker === 'IR EXECUTIVE' &&
         /is\s+this\s+(wint|wint\s+wealth)|are\s+you\s+(from\s+)?wint/i.test(s.text || ''),
  );

  const labelsReversed = investorClaimsWint || irAsksIfWint;
  if (!labelsReversed) return segments;

  console.warn('[fixSpeakerLabels] Detected reversed labels — swapping IR EXECUTIVE ↔ INVESTOR');
  const swap = (label: string | undefined) =>
    label === 'IR EXECUTIVE' ? 'INVESTOR'
    : label === 'INVESTOR'   ? 'IR EXECUTIVE'
    : label;

  return segments.map(seg => {
    if (seg.type === 'speech')       return { ...seg, speaker: swap(seg.speaker) };
    if (seg.type === 'interruption') return { ...seg, interrupted_speaker: swap(seg.interrupted_speaker), interrupted_by: swap(seg.interrupted_by) };
    if (seg.type === 'dead_air')     return { ...seg, resumed_by: swap(seg.resumed_by) };
    return seg;
  });
}

// ── Parse transcription response ──────────────────────────────────────────────
export function parseTranscriptionResponse(raw: string): { language: string; segments: CallSegment[] } {
  try {
    const parsed = robustJsonParse(raw);
    if (!parsed) return { language: 'English', segments: [] };
    if (Array.isArray(parsed)) return { language: 'Unknown', segments: fixSpeakerLabels(parsed) };
    return {
      language: parsed.language || 'English',
      segments: fixSpeakerLabels(Array.isArray(parsed.segments) ? parsed.segments : []),
    };
  } catch {
    // Truncated JSON recovery — Gemini hit output token limit mid-response.
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
    return { language, segments: fixSpeakerLabels(segments) };
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
  iqs: number | null;
  summary: string;
  kbCitation: string | null;
} {
  const data = robustJsonParse(raw);
  const scores: Record<string, CallParamScore> = data?.scores || {};
  const reasoning: Record<string, string> = data?.reasoning || {};
  const poorListeningSegments: PoorListeningSegment[] = data?.poor_listening_segments || [];
  const iqs = calculateCallIQS(scores);
  const kbCitation = typeof data?.kbCitation === 'string' && data.kbCitation.toLowerCase() !== 'null'
    ? data.kbCitation
    : null;
  return { scores, reasoning, poorListeningSegments, iqs, summary: data?.summary || '', kbCitation };
}
