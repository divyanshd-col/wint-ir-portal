/**
 * Call quality scoring — types, weights, prompts, and helpers.
 * Parameters sourced from "CHATS CSAT/IQS Metrics (NEW)" spec sheet.
 * Call and chat are scored 100% independently against their own transcripts.
 */

// ── Parameter weights (must sum to 1.0) ──────────────────────────────────────

export const CALL_WEIGHTS: Record<string, number> = {
  TechnicalLegal: 0.20, // Technically / Legal-wise
  AllQuestions:   0.10, // All Questions Answered
  ProcessWise:    0.05, // Process-wise
  Opening:        0.05, // First Response & Opening
  OnCall:         0.05, // Going on a call (when required)
  Contextual:     0.10, // Contextual & Personal Answers
  Tags:           0.05, // Tags Accuracy
  Expectation:    0.10, // Expectation Setting
  Sentences:      0.10, // Sentences (simple to understand)
  Grammar:        0.05, // Grammatically & Structurally correct
  Empathy:        0.05, // Empathy
  FollowUp:       0.10, // Personalised Follow-up & Closing
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

// Grouped for display (mirrors the spec sheet)
export const CALL_PARAM_GROUPS: Record<string, { label: string; keys: string[] }> = {
  technical: {
    label: 'Technical Answer (35%)',
    keys: ['TechnicalLegal', 'AllQuestions', 'ProcessWise'],
  },
  process: {
    label: 'Process Knowledge (35%)',
    keys: ['Opening', 'OnCall', 'Contextual', 'Tags', 'Expectation'],
  },
  grammar: {
    label: 'Grammar & Sentence Framing / Tone (15%)',
    keys: ['Sentences', 'Grammar'],
  },
  extra: {
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

export interface CallIQSScoreEntry {
  callId?: string;
  chatId?: string | null;
  agentName: string;
  calledAt?: string;
  date?: string;
  durationSeconds?: number | null;
  language?: string | null;
  interruptionCount: number;
  deadAirCount: number;
  iqs: number;
  scores: Record<string, CallParamScore>;
  reasoning: Record<string, string>;
  summary: string;
  modelVersion: string;
  scoredAt?: string;
}

export interface CallSegment {
  type: 'speech' | 'interruption' | 'dead_air';
  // speech
  speaker?: string;
  text?: string;
  translated?: boolean;
  ts?: string;          // ISO timestamp from Robylon's pre-transcribed payload
  // interruption
  interrupted_speaker?: string;
  interrupted_by?: string;
  words_spoken?: number;
  // dead_air
  duration?: string;
  resumed_by?: string;
}

// ── IQS calculation (same formula as lib/quality.ts calculateIQS) ────────────
export function calculateCallIQS(scores: Record<string, CallParamScore>): number {
  let total = 0;
  for (const [param, weight] of Object.entries(CALL_WEIGHTS)) {
    const score = scores[param] ?? 'Yes';
    if (score === 'Yes' || score === 'NA') total += weight;
  }
  return Math.round(total * 100);
}

// ── Build readable text from segments (for LLM scoring input) ────────────────
export function segmentsToText(segments: CallSegment[]): string {
  const lines: string[] = [];
  for (const seg of segments) {
    if (seg.type === 'speech') {
      lines.push(`${seg.speaker}: ${seg.text}${seg.translated ? ' [translated from regional language]' : ''}`);
    } else if (seg.type === 'interruption') {
      lines.push(`[INTERRUPTION: ${seg.interrupted_speaker} cut off by ${seg.interrupted_by} after ${seg.words_spoken ?? '?'} words]`);
    } else if (seg.type === 'dead_air') {
      lines.push(`[DEAD AIR: ${seg.duration ?? 'unknown duration'} — resumed by ${seg.resumed_by}]`);
    }
  }
  return lines.join('\n');
}

// ── Transcription prompt (audio → segment JSON) ───────────────────────────────
export const CALL_TRANSCRIPTION_PROMPT = `Transcribe this IR (Investor Relations) call recording from Wint Wealth.

## SPEAKER IDENTIFICATION
- IR EXECUTIVE: the person who introduces themselves and says "Wint Wealth"
- INVESTOR: the other speaker (the customer / investor)

## RULES
1. Transcribe every word verbatim — do not skip, summarise, or paraphrase
2. Overlapping speech: capture both speakers in separate consecutive segments
3. Non-English words (Tamil, Malayalam, Hindi, Telugu, Kannada, etc.): translate to fluent English in the "text" field and set "translated": true
4. Interruption: if a speaker is cut off mid-sentence (fewer than ~10 words spoken), insert an interruption object BEFORE the next speaker's segment
5. Dead air: if there is silence ≥ 2 seconds, insert a dead_air object with estimated duration and who resumed

## OUTPUT — respond with ONLY this JSON, no other text:
{
  "language": "e.g. Tamil + English",
  "segments": [
    {"type": "speech", "speaker": "INVESTOR", "text": "Hello?", "translated": false},
    {"type": "dead_air", "duration": "~3 seconds", "resumed_by": "IR EXECUTIVE"},
    {"type": "speech", "speaker": "IR EXECUTIVE", "text": "Hi, this is Priya from Wint Wealth.", "translated": false},
    {"type": "interruption", "interrupted_speaker": "IR EXECUTIVE", "interrupted_by": "INVESTOR", "words_spoken": 5},
    {"type": "speech", "speaker": "INVESTOR", "text": "Sorry, what was the bond name?", "translated": false}
  ]
}`;

// ── Call IQS scoring system prompt ───────────────────────────────────────────
export const CALL_IQS_SYSTEM_PROMPT = `You are the Wint Wealth Call Quality evaluator. You score IR (Investor Relations) voice call transcripts across 12 parameters grouped into 4 attributes.

The IR EXECUTIVE is the Wint Wealth agent. The INVESTOR is the customer.

## SCORING PHILOSOPHY
- Catch DEFINITIVE failures, not minor imperfections. When in doubt, score Yes.
- NA counts as Yes (pass) in the final IQS calculation.
- Never penalise an agent for something the transcript does not clearly show.
- You will receive the CALL TRANSCRIPT (what you score) and optionally a WHATSAPP CHAT TRANSCRIPT (context only — do not score it, use it to understand what the investor raised before the call).

---

## ATTRIBUTE 1: Technical Answer (35% total)

### 1. Technically / Legal-wise (20%)
- Yes: All product information is factually correct — bond name, yield, tenure, payout, taxation, lock-in, redemption process — per Wint Wealth's offerings.
- No: Agent gave a clear factual error about product details, returns, timelines, or legal requirements.
- NA: No substantive product information was exchanged.

### 2. All Questions Answered (10%)
- Yes: Every question the investor asked was addressed directly, or explicitly deferred with a reason ("I'll send you an email", "let me check and call back").
- No: An investor question was ignored, redirected without answering, or left hanging.
- NA: Very rare.

### 3. Process-wise (5%)
- Yes: Agent followed the correct Wint Wealth workflow — correct escalation, correct next steps advised, no process shortcuts.
- No: Clear, provable process violation — wrong step advised, told investor to do something they shouldn't, or contradicted standard Wint process.
- NA: Very rare.

---

## ATTRIBUTE 2: Process Knowledge (35% total)

### 4. First Response & Opening (5%)
- Yes: Agent introduced themselves by name AND mentioned "Wint Wealth" at or near the start of the call.
- No: No introduction, OR agent name missing, OR "Wint Wealth" not mentioned.
- NA: Very rare.

### 5. Going on a call — when required (5%)
- Yes: A call was needed and the agent handled it correctly OR a call was not required (score NA when irrelevant).
- No: A call was clearly needed (customer was distressed, issue complex) but agent did not offer/conduct one. OR call was handled incorrectly.
- NA: MOST calls — score NA unless there was a clear failure or clear need.

### 6. Contextual & Personal Answers (10%)
- Yes: Agent referenced investor-specific details — their bond name, investment amount, maturity date, account number, or specific situation.
- No: Generic answer that could apply to any investor — no personalisation, no specific details.
- NA: Very rare.

### 7. Tags Accuracy (5%)
- Yes: The disposition (L1) and sub-disposition (L2) tags visible in metadata accurately reflect the call's main topic.
- No: Tags are wrong or mismatched — e.g. tagged "Referral" but call is about payout delay.
- NA: No tag data available — score NA.

### 8. Expectation Setting (10%)
- Yes: Agent gave a specific timeline, next step, or commitment: "credited within 7 working days", "I'll email you by 5 PM today".
- No: Investor asked when/how long and got no specific answer. OR agent made a promise without a timeframe.
- NA: No timeline-sensitive question was asked.

---

## ATTRIBUTE 3: Grammar & Sentence Framing / Tone (15% total)

### 9. Sentences — simple to understand (10%)
- Yes: Language is clear, simple, and free of jargon the investor would not understand. Short sentences. Easy to follow.
- No: Confusing language, excessive jargon, run-on sentences, or investor had to ask for clarification repeatedly.
- NA: Very rare.

### 10. Grammatically & Structurally correct (5%)
- Yes: Responses are grammatically complete. No broken sentences, no missing words, no unintelligible fragments.
- No: Repeated incomplete sentences, missing conjunctions, or structurally broken responses that confused the investor.
- NA: Very rare. Minor slips are acceptable.

---

## ATTRIBUTE 4: Going an Extra Mile (15% total)

### 11. Empathy (5%)
- Yes: At least one genuine empathy expression — "I understand your concern", "I'm sorry for the inconvenience", "I can see why that would be frustrating".
- No: No empathy anywhere in the call, OR passive/dismissive language used.
- NA: Very rare. Bar is low — even one genuine expression passes.

### 12. Personalised Follow-up & Closing (10%)
- Yes: Call ended with a clear personalised follow-up action + warm sign-off. E.g. "I'll send you the statement by EOD and follow up tomorrow, take care!"
- No: Generic closing ("is there anything else?") with no personalised next step. OR abrupt hang-up. OR no closing at all.
- NA: Very rare.

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
  "iqs_score": 85,
  "summary": "1-2 sentence overall assessment of the call"
}
\`\`\`
CRITICAL: Output ONLY the JSON.`;

// ── Build scoring prompt (call transcript + optional chat context) ─────────────
export function buildCallScoringPrompt(
  callTranscriptText: string,
  chatTranscriptText: string,
  callId: string,
  interruptionCount: number,
  deadAirCount: number,
  kbContext = '',
): string {
  return `Score the following Wint Wealth IR call.

## CALL METADATA
- Call ID: ${callId}
- Interruptions detected in call: ${interruptionCount}
- Dead air instances detected: ${deadAirCount}
${kbContext ? `
## WINT KNOWLEDGE BASE REFERENCE
Use these KB excerpts to verify whether the IR executive's product information is correct.

${kbContext}
` : ''}
## CALL TRANSCRIPT — score this
${callTranscriptText}
${chatTranscriptText ? `
## WHATSAPP CHAT CONTEXT — reference only, do NOT score this
The investor had this WhatsApp conversation before the call. Use it to understand
what issues were raised and check whether the call addressed them.

${chatTranscriptText}
` : ''}
Score this call across all 12 parameters. Output ONLY the JSON.`;
}

// ── Parse Gemini transcription response ───────────────────────────────────────
export function parseTranscriptionResponse(raw: string): { language: string; segments: CallSegment[] } {
  let jsonStr = raw.trim();
  const block = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (block) jsonStr = block[1].trim();
  else {
    const start = jsonStr.indexOf('{');
    const end   = jsonStr.lastIndexOf('}');
    if (start >= 0 && end > start) jsonStr = jsonStr.slice(start, end + 1);
  }
  try {
    const parsed = JSON.parse(jsonStr);
    return {
      language: parsed.language || 'English',
      segments: Array.isArray(parsed.segments) ? parsed.segments : [],
    };
  } catch {
    return { language: 'English', segments: [] };
  }
}

// ── Parse call IQS scoring response ──────────────────────────────────────────
function robustJsonParse(raw: string): any {
  let jsonStr = raw.trim();
  const block = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (block) jsonStr = block[1].trim();
  else {
    const start = jsonStr.indexOf('{');
    const end   = jsonStr.lastIndexOf('}');
    if (start >= 0 && end > start) jsonStr = jsonStr.slice(start, end + 1);
  }
  try { return JSON.parse(jsonStr); } catch {}
  try {
    return JSON.parse(
      jsonStr.replace(/("(?:[^"\\]|\\.)*")/g, m =>
        m.replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t'),
      ),
    );
  } catch {}
  throw new Error(`Cannot parse call scoring response: ${jsonStr.slice(0, 200)}`);
}

export function parseCallScoringResponse(raw: string): {
  scores: Record<string, CallParamScore>;
  reasoning: Record<string, string>;
  iqs: number;
  summary: string;
} {
  const data = robustJsonParse(raw);
  const scores: Record<string, CallParamScore>   = data.scores   || {};
  const reasoning: Record<string, string>         = data.reasoning || {};
  const iqs = calculateCallIQS(scores); // always recalculate, never trust LLM's number
  return { scores, reasoning, iqs, summary: data.summary || '' };
}
