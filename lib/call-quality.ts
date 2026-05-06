/**
 * Call IQS scoring — types, config, prompts, and scoring utilities.
 * Scores call recordings against 12 quality parameters.
 */

// ── Parameter weights ────────────────────────────────────────────────────────
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

export const CALL_PARAM_ORDER = [
  'TechnicalLegal', 'AllQuestions', 'ProcessWise', 'Opening',
  'OnCall', 'Contextual', 'Tags', 'Expectation',
  'Sentences', 'Grammar', 'Empathy', 'FollowUp',
];

// ── Types ────────────────────────────────────────────────────────────────────
export type CallSpeaker = 'IR_EXECUTIVE' | 'INVESTOR';
export type CallEventType = 'turn' | 'interruption' | 'dead_air';

export interface CallSegment {
  speaker:    CallSpeaker;
  text:       string;
  translated: boolean;
  start:      number;
  end:        number;
  event_type: CallEventType;
}

// ── Transcription prompt (audio → segments JSON) ─────────────────────────────
export const CALL_TRANSCRIPTION_PROMPT = `You are a call transcription engine for Wint Wealth, an Indian fintech company.
Transcribe the provided audio recording of a call between an IR (Investor Relations) Executive and an Investor.

Return ONLY valid JSON in this exact format — no markdown fences, no extra text:
{
  "language": "<detected language(s), e.g. 'Hindi', 'English', 'Tamil + English'>",
  "segments": [
    {
      "event_type": "turn",
      "speaker": "IR_EXECUTIVE",
      "start": 0.0,
      "end": 5.2,
      "text": "Hello, this is Priya from Wint Wealth...",
      "translated": false
    }
  ]
}

Rules:
- Use speaker label "IR_EXECUTIVE" for the Wint Wealth agent, "INVESTOR" for the customer.
- Infer speaker roles from context: the IR executive will introduce themselves and the company.
- For non-English speech, transcribe in the original language AND set "translated": true with an English translation appended in brackets, e.g. "Haan, sahi hai [Yes, that's correct]"
- For pure English segments set "translated": false.
- Add interruption events when a speaker cuts off the other mid-sentence:
  { "event_type": "interruption", "speaker": "IR_EXECUTIVE", "start": 12.1, "end": 12.1, "text": "", "translated": false }
  The speaker field here is the one who was INTERRUPTED (i.e. who got cut off).
- Add dead_air events for silences longer than 3 seconds:
  { "event_type": "dead_air", "speaker": "IR_EXECUTIVE", "start": 45.0, "end": 49.0, "text": "", "translated": false }
  The speaker field here is whoever resumed the conversation after the silence.
- Keep segment boundaries natural — one thought / sentence per segment is ideal.
- start/end are in seconds (float).`;

// ── Scoring system prompt ─────────────────────────────────────────────────────
export const CALL_IQS_SYSTEM_PROMPT = `You are the Wint Wealth Call IQS evaluator. You score IR (Investor Relations) call recordings across 12 quality parameters. Your scoring must match a trained human evaluator.

## SCORING PHILOSOPHY
- Catch DEFINITIVE FAILURES, not imperfections.
- Being too strict is as bad as being too lenient.
- When in doubt, give the agent the benefit of the doubt → score Yes.
- NA parameters are treated as Yes (pass) in the final IQS calculation.
- NEVER assume failure when the transcript is ambiguous. If you are not certain, score NA.

## THE 12 PARAMETERS (ordered by weight)

### 1. TechnicalLegal — Technically / Legal-wise (20%)
- Yes: All information shared is factually correct per Wint Wealth's products and processes, legally compliant, no misleading statements about returns/risks/regulations.
- No: Agent gave verifiably wrong information — wrong rates, wrong product details, wrong legal/regulatory guidance. Must be a clear factual error.
- NA: Call had zero substantive information exchange (e.g. wrong number, call dropped immediately).

### 2. AllQuestions — All Questions Answered (10%)
- Yes: Every investor question was addressed — either answered directly or explicitly deferred with a reason.
- No: A question was completely ignored or redirected without addressing it.
- NA: Investor asked no questions.

### 3. ProcessWise — Process-wise (5%)
- Yes: Agent followed Wint Wealth's standard call process (verified investor identity, followed escalation paths, used proper hold/transfer procedures).
- No: Agent skipped mandatory process steps or violated standard procedure.
- NA: No process-sensitive situations arose.

### 4. Opening — First Response & Opening (5%)
- Yes: Agent opened with proper greeting, introduced themselves and Wint Wealth, confirmed the investor's name.
- No: Missing proper introduction or investor verification.
- NA: Call recording starts mid-conversation without a beginning.

### 5. OnCall — Going on a call (when required) (5%)
- Yes: When a call was needed (investor requested or issue warranted), the agent handled it appropriately.
- No: Agent refused or avoided a necessary call escalation without valid reason.
- NA: No situation arose requiring a call escalation decision; or cannot be evaluated from transcript alone.

### 6. Contextual — Contextual & Personal Answers (10%)
- Yes: Agent acknowledged the investor's specific portfolio, history, or concern and gave personalised answers rather than generic responses.
- No: Agent gave generic/scripted responses that ignored the investor's specific context or portfolio details they mentioned.
- NA: No investor-specific context was available or relevant.

### 7. Tags — Tags Accuracy (5%)
- Yes: Agent correctly tagged/categorised the call (by disposition, product, query type) as per Wint Wealth's taxonomy.
- No: Clearly wrong tagging.
- NA: Cannot evaluate tagging from call audio alone; score NA unless tags are confirmed in the WhatsApp chat context.

### 8. Expectation — Expectation Setting (10%)
- Yes: Agent gave accurate timelines, next steps, and set realistic expectations. No overpromising.
- No: Agent overpromised, gave unrealistic timelines, or failed to explain what happens next.
- NA: No expectations needed to be set.

### 9. Sentences — Sentences (simple to understand) (10%)
- Yes: Agent used clear, simple language appropriate for a retail investor. Avoided jargon or explained it when used.
- No: Agent's language was confusing, too technical, or the sentences were incoherent.
- NA: Very short call with minimal speech.

### 10. Grammar — Grammatically & Structurally correct (5%)
- Yes: Agent's speech was grammatically acceptable. Minor errors are fine — focus on whether communication was clear.
- No: Agent's speech had persistent grammar errors that impaired understanding.
- NA: Very short call.

### 11. Empathy — Empathy (5%)
- Yes: Agent acknowledged investor concerns, showed understanding, used empathetic language especially for complaints or distress.
- No: Agent was dismissive, impatient, or tone-deaf to clearly expressed investor frustration.
- NA: No emotional situation arose.

### 12. FollowUp — Personalised Follow-up & Closing (10%)
- Yes: Agent summarised next steps, confirmed investor satisfaction, closed the call professionally with a personalised note.
- No: Call ended abruptly without a proper closing or next-step confirmation.
- NA: Call dropped unexpectedly; closing was not possible.

## RESPONSE FORMAT
Return ONLY valid JSON — no markdown fences, no extra text:
{
  "scores": {
    "TechnicalLegal": "Yes",
    "AllQuestions": "Yes",
    "ProcessWise": "NA",
    "Opening": "Yes",
    "OnCall": "NA",
    "Contextual": "No",
    "Tags": "NA",
    "Expectation": "Yes",
    "Sentences": "Yes",
    "Grammar": "Yes",
    "Empathy": "Yes",
    "FollowUp": "Yes"
  },
  "reasoning": {
    "TechnicalLegal": "Agent correctly explained the NCD yield...",
    "AllQuestions": "Both questions were answered directly...",
    "ProcessWise": "No process-sensitive steps were triggered.",
    "Opening": "Agent opened with 'Hi, this is Priya from Wint Wealth...'",
    "OnCall": "No escalation situation arose.",
    "Contextual": "Agent gave generic payout info without referencing the investor's specific bond.",
    "Tags": "Cannot evaluate tagging from audio.",
    "Expectation": "Agent gave a 2-business-day timeline accurately.",
    "Sentences": "Language was clear and jargon-free throughout.",
    "Grammar": "Speech was grammatically acceptable.",
    "Empathy": "Agent acknowledged the investor's frustration about the delay.",
    "FollowUp": "Agent summarised next steps and closed warmly."
  },
  "summary": "One-paragraph overall assessment of the call quality."
}`;

// ── Utility: segments → plain text ───────────────────────────────────────────
export function segmentsToText(segments: CallSegment[]): string {
  return segments
    .filter(s => s.event_type === 'turn' && s.text)
    .map(s => `[${s.speaker}] ${s.text}${s.translated ? ' *(translated)*' : ''}`)
    .join('\n');
}

// ── Parse Gemini transcription response ──────────────────────────────────────
export function parseTranscriptionResponse(raw: string): { language: string; segments: CallSegment[] } {
  let text = raw.trim();
  // Strip markdown code fences if present
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '');
  try {
    const parsed = JSON.parse(text);
    return {
      language: parsed.language ?? 'Unknown',
      segments: Array.isArray(parsed.segments) ? parsed.segments : [],
    };
  } catch {
    return { language: 'Unknown', segments: [] };
  }
}

// ── Calculate Call IQS (same formula as calculateIQS in lib/quality.ts) ──────
export function calculateCallIQS(scores: Record<string, 'Yes' | 'No' | 'NA'>): number {
  let total = 0;
  for (const [param, weight] of Object.entries(CALL_WEIGHTS)) {
    const score = scores[param] ?? 'Yes';
    if (score === 'Yes' || score === 'NA') total += weight;
  }
  return Math.round(total * 100);
}

// ── Build scoring prompt ──────────────────────────────────────────────────────
export function buildCallScoringPrompt(
  callTranscriptText: string,
  chatTranscriptText: string,
  callId: string,
  interruptionCount: number,
  deadAirCount: number,
  kbContext?: string,
): string {
  const lines: string[] = [];

  lines.push(`Call ID: ${callId}`);
  lines.push(`Interruptions: ${interruptionCount}  |  Dead air events: ${deadAirCount}`);
  lines.push('');
  lines.push('## CALL TRANSCRIPT (score this)');
  lines.push(callTranscriptText || '(no transcript available)');

  if (chatTranscriptText) {
    lines.push('');
    lines.push('## WHATSAPP CHAT CONTEXT (reference only — do not score this)');
    lines.push(chatTranscriptText);
    lines.push('Use this to understand what the investor discussed before the call.');
    lines.push('Check whether the IR executive addressed open issues from the chat.');
  }

  if (kbContext) {
    lines.push('');
    lines.push('## KNOWLEDGE BASE CONTEXT');
    lines.push(kbContext);
  }

  return lines.join('\n');
}

// ── Parse call scoring response ───────────────────────────────────────────────
export function parseCallScoringResponse(raw: string): {
  scores: Record<string, 'Yes' | 'No' | 'NA'>;
  reasoning: Record<string, string>;
  iqs: number;
  summary: string;
} {
  let text = raw.trim();
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '');

  const fallback = {
    scores: Object.fromEntries(CALL_PARAM_ORDER.map(k => [k, 'NA' as const])),
    reasoning: Object.fromEntries(CALL_PARAM_ORDER.map(k => [k, ''])),
    iqs: 0,
    summary: '',
  };

  try {
    const parsed = JSON.parse(text);

    const scores: Record<string, 'Yes' | 'No' | 'NA'> = {};
    const reasoning: Record<string, string> = {};

    for (const param of CALL_PARAM_ORDER) {
      const raw = parsed.scores?.[param];
      scores[param] = raw === 'Yes' || raw === 'No' ? raw : 'NA';
      reasoning[param] = parsed.reasoning?.[param] ?? '';
    }

    return {
      scores,
      reasoning,
      iqs: calculateCallIQS(scores),
      summary: parsed.summary ?? '',
    };
  } catch {
    return fallback;
  }
}
