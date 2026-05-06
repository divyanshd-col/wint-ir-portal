/**
 * Call quality scoring — types, weights, prompts, and helpers.
 * Mirrors lib/quality.ts but adapted for voice call transcripts.
 */

// ── Parameter weights ─────────────────────────────────────────────────────────
export const CALL_WEIGHTS: Record<string, number> = {
  Technical:    0.20,
  AllQuestions: 0.10,
  Expectation:  0.10,
  Tone:         0.10,
  Interruptions:0.10,
  DeadAir:      0.10,
  Contextual:   0.05,
  FollowUp:     0.05,
  Process:      0.05,
  Opening:      0.05,
  Empathy:      0.05,
  Language:     0.05,
};

export const CALL_PARAM_NAMES: Record<string, string> = {
  Technical:    'Technically / Legally Correct',
  AllQuestions: 'All Questions Answered',
  Expectation:  'Expectation Setting',
  Tone:         'Tone & Communication',
  Interruptions:'Interruptions',
  DeadAir:      'Dead Air Handling',
  Contextual:   'Contextual & Personal',
  FollowUp:     'Follow-up & Closing',
  Process:      'Process-wise',
  Opening:      'Opening & Self-Introduction',
  Empathy:      'Empathy',
  Language:     'Language Handling',
};

export const CALL_PARAM_ORDER = [
  'Technical', 'AllQuestions', 'Expectation', 'Tone',
  'Interruptions', 'DeadAir', 'Contextual', 'FollowUp',
  'Process', 'Opening', 'Empathy', 'Language',
];

export type CallParamScore = 'Yes' | 'No' | 'NA';

export interface CallIQSScoreEntry {
  callId: string;
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
  // speech fields
  speaker?: string;
  text?: string;
  translated?: boolean;
  // interruption fields
  interrupted_speaker?: string;
  interrupted_by?: string;
  words_spoken?: number;
  // dead_air fields
  duration?: string;
  resumed_by?: string;
}

// ── IQS calculation ───────────────────────────────────────────────────────────
export function calculateCallIQS(scores: Record<string, CallParamScore>): number {
  let total = 0;
  for (const [param, weight] of Object.entries(CALL_WEIGHTS)) {
    const score = scores[param] ?? 'Yes';
    if (score === 'Yes' || score === 'NA') total += weight;
  }
  return Math.round(total * 100);
}

// ── Score Interruptions + DeadAir deterministically from segment counts ───────
export function scoreAutomaticParams(
  interruptionCount: number,
  deadAirCount: number,
): { scores: Pick<Record<string, CallParamScore>, 'Interruptions' | 'DeadAir'>; reasoning: Pick<Record<string, string>, 'Interruptions' | 'DeadAir'> } {
  const interruptionScore: CallParamScore = interruptionCount <= 2 ? 'Yes' : 'No';
  const deadAirScore: CallParamScore = deadAirCount === 0 ? 'Yes' : deadAirCount <= 1 ? 'NA' : 'No';

  return {
    scores: {
      Interruptions: interruptionScore,
      DeadAir: deadAirScore,
    },
    reasoning: {
      Interruptions: interruptionCount <= 2
        ? `${interruptionCount} interruption(s) detected — within acceptable threshold.`
        : `${interruptionCount} interruptions detected — IR executive was cut off multiple times before completing sentences.`,
      DeadAir: deadAirCount === 0
        ? 'No dead air detected.'
        : deadAirCount === 1
        ? '1 instance of dead air — borderline, scored NA.'
        : `${deadAirCount} instances of dead air detected — call had notable silences that affected flow.`,
    },
  };
}

// ── Transcription prompt ──────────────────────────────────────────────────────
export const CALL_TRANSCRIPTION_PROMPT = `Transcribe this IR (Investor Relations) call recording from Wint Wealth.

## SPEAKER IDENTIFICATION
- IR EXECUTIVE: the person who introduces themselves and mentions "Wint Wealth"
- INVESTOR: the other speaker (the customer/investor)

## TRANSCRIPTION RULES
1. Transcribe every word verbatim — do not paraphrase or skip anything
2. Overlapping speech (both talking at once): capture both speakers in separate consecutive segments
3. For non-English words (Tamil, Malayalam, Hindi, Telugu, Kannada, etc.): translate to fluent English in the "text" field and set "translated": true
4. If a speaker is cut off before finishing ~10 words, insert an interruption flag BEFORE the next speaker's segment
5. If there is silence ≥ 2 seconds, insert a dead_air flag with estimated duration and who resumed

## OUTPUT FORMAT
Respond with ONLY this JSON — no other text:
{
  "language": "e.g. Tamil + English",
  "segments": [
    {"type": "speech", "speaker": "INVESTOR", "text": "Hello?", "translated": false},
    {"type": "dead_air", "duration": "~3 seconds", "resumed_by": "IR EXECUTIVE"},
    {"type": "speech", "speaker": "IR EXECUTIVE", "text": "Hi, this is Priya from Wint Wealth.", "translated": false},
    {"type": "interruption", "interrupted_speaker": "IR EXECUTIVE", "interrupted_by": "INVESTOR", "words_spoken": 5},
    {"type": "speech", "speaker": "INVESTOR", "text": "Sorry, what was the bond name?", "translated": false}
  ]
}

CRITICAL: Output ONLY the JSON. No markdown fences, no preamble, no explanation.`;

// ── Build text transcript from segments (for IQS scoring prompt) ──────────────
export function segmentsToText(segments: CallSegment[]): string {
  const lines: string[] = [];
  for (const seg of segments) {
    if (seg.type === 'speech') {
      lines.push(`${seg.speaker}: ${seg.text}${seg.translated ? ' [translated]' : ''}`);
    } else if (seg.type === 'interruption') {
      lines.push(`[INTERRUPTION: ${seg.interrupted_speaker} cut off by ${seg.interrupted_by} after ${seg.words_spoken ?? '?'} words]`);
    } else if (seg.type === 'dead_air') {
      lines.push(`[DEAD AIR: ${seg.duration ?? 'unknown duration'} — resumed by ${seg.resumed_by}]`);
    }
  }
  return lines.join('\n');
}

// ── Call IQS scoring prompt ───────────────────────────────────────────────────
export const CALL_IQS_SYSTEM_PROMPT = `You are the Wint Wealth Call Quality evaluator. You score IR (Investor Relations) call transcripts across 10 parameters (Interruptions and Dead Air are scored separately from counts — do NOT include them in your output).

## SCORING PHILOSOPHY
- Catch DEFINITIVE FAILURES, not imperfections. When in doubt, score Yes.
- NA parameters count as Yes (pass) in the final IQS calculation.
- Never assume failure when the transcript is ambiguous — give the agent benefit of the doubt.
- Interruptions and DeadAir will be computed from segment counts automatically — do NOT include them in your scores or reasoning.

## WINT WEALTH SPECIFIC POLICIES
- The IR EXECUTIVE is the Wint Wealth agent. The INVESTOR is the customer.
- The IR executive should introduce themselves by name and mention "Wint Wealth" at the start.
- All product information must align with Wint Wealth's bond/investment offerings.

## THE 10 PARAMETERS YOU MUST SCORE

### 1. Technically / Legally Correct (20%)
- Yes: Information given is factually accurate per Wint Wealth products (bonds, yields, process).
- No: Clear factual error about product details, returns, timelines, or legal requirements.
- NA: No substantive information exchanged.

### 2. All Questions Answered (10%)
- Yes: Every investor question was addressed or explicitly deferred with a reason.
- No: An investor question was ignored or redirected without answering.
- NA: Very rare.

### 3. Expectation Setting (10%)
- Yes: Agent provided specific timelines, next steps, or commitments.
- No: Investor asked when/how long and got no specific answer. OR promise made without timeline.
- NA: Very rare.

### 4. Tone & Communication (10%)
- Yes: Professional, clear, polite tone throughout the call.
- No: Rude, dismissive, excessively casual, or confusing communication.
- NA: Very rare.

### 5. Contextual & Personal (5%)
- Yes: Agent referenced investor-specific details (bond name, amount, dates, account).
- No: Generic response that could apply to any investor.
- NA: Very rare.

### 6. Follow-up & Closing (5%)
- Yes: Call ended with clear next steps, commitment to follow up, or warm sign-off.
- No: Call ended abruptly or with no clarity on next steps.
- NA: Very rare.

### 7. Process-wise (5%)
- Yes: Agent followed correct escalation/information workflow.
- No: Clear process violation — wrong info given, incorrect step advised.
- NA: Very rare.

### 8. Opening & Self-Introduction (5%)
- Yes: Agent introduced themselves by name AND mentioned "Wint Wealth" at the start.
- No: No introduction, OR missing name, OR missing "Wint Wealth".
- NA: Very rare.

### 9. Empathy (5%)
- Yes: At least one genuine empathy expression — acknowledgment of concern, apology for inconvenience, etc.
- No: No empathy at all, OR passive/dismissive language.
- NA: Very rare.

### 10. Language Handling (5%)
- Yes: Code-switching was handled smoothly; investor understood responses regardless of language mix.
- No: Language confusion caused miscommunication; investor had to repeat due to language barrier.
- NA: Call was in a single language with no code-switching.

## OUTPUT FORMAT
Respond with EXACTLY this JSON (10 parameters only — no Interruptions, no DeadAir):
\`\`\`json
{
  "scores": {
    "Technical": "Yes|No|NA",
    "AllQuestions": "Yes|No|NA",
    "Expectation": "Yes|No|NA",
    "Tone": "Yes|No|NA",
    "Contextual": "Yes|No|NA",
    "FollowUp": "Yes|No|NA",
    "Process": "Yes|No|NA",
    "Opening": "Yes|No|NA",
    "Empathy": "Yes|No|NA",
    "Language": "Yes|No|NA"
  },
  "reasoning": {
    "Technical": "brief reason",
    "AllQuestions": "brief reason",
    "Expectation": "brief reason",
    "Tone": "brief reason",
    "Contextual": "brief reason",
    "FollowUp": "brief reason",
    "Process": "brief reason",
    "Opening": "brief reason",
    "Empathy": "brief reason",
    "Language": "brief reason"
  },
  "iqs_score": 85,
  "summary": "1-2 sentence overall assessment"
}
\`\`\`
CRITICAL: Output ONLY the JSON.`;

export function buildCallScoringPrompt(
  transcriptText: string,
  callId: string,
  interruptionCount: number,
  deadAirCount: number,
  kbContext = '',
): string {
  return `Score the following Wint Wealth IR call transcript.

## CALL METADATA
- Call ID: ${callId}
- Interruptions detected: ${interruptionCount}
- Dead air instances detected: ${deadAirCount}
${kbContext ? `
## WINT KNOWLEDGE BASE REFERENCE
Use these excerpts to evaluate whether the IR executive's information is technically correct.

${kbContext}` : ''}

## CALL TRANSCRIPT
${transcriptText}

Score this call across the 10 parameters. Output ONLY the JSON.`;
}

// ── Parse call scoring response ───────────────────────────────────────────────
function robustJsonParse(raw: string): any {
  let jsonStr = raw.trim();
  const block = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (block) jsonStr = block[1].trim();
  else {
    const start = jsonStr.indexOf('{');
    const end = jsonStr.lastIndexOf('}');
    if (start >= 0 && end > start) jsonStr = jsonStr.slice(start, end + 1);
  }
  try { return JSON.parse(jsonStr); } catch {}
  try {
    return JSON.parse(jsonStr.replace(/("(?:[^"\\]|\\.)*")/g, m =>
      m.replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')));
  } catch {}
  throw new Error(`Cannot parse call scoring response: ${jsonStr.slice(0, 200)}`);
}

export function parseCallScoringResponse(
  raw: string,
  interruptionCount: number,
  deadAirCount: number,
): { scores: Record<string, CallParamScore>; reasoning: Record<string, string>; iqs: number; summary: string } {
  const data = robustJsonParse(raw);
  const llmScores: Record<string, CallParamScore> = data.scores || {};
  const reasoning: Record<string, string> = data.reasoning || {};

  // Merge in deterministically-scored params
  const auto = scoreAutomaticParams(interruptionCount, deadAirCount);
  const scores: Record<string, CallParamScore> = { ...llmScores, ...auto.scores };
  Object.assign(reasoning, auto.reasoning);

  const iqs = calculateCallIQS(scores);

  return { scores, reasoning, iqs, summary: data.summary || '' };
}

// ── Parse transcription JSON from Gemini ──────────────────────────────────────
export function parseTranscriptionResponse(raw: string): { language: string; segments: CallSegment[] } {
  let jsonStr = raw.trim();
  const block = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (block) jsonStr = block[1].trim();
  else {
    const start = jsonStr.indexOf('{');
    const end = jsonStr.lastIndexOf('}');
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
