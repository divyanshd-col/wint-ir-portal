/**
 * IQS Quality Scoring — types, config, scoring prompt, and KV storage.
 * Ported from the standalone Python iqs_scorer tool.
 */

// ── Parameter weights (20% Technical is highest) ────────────────────────────
export const WEIGHTS: Record<string, number> = {
  Technical:    0.20,
  AllQuestions: 0.10,
  Expectation:  0.10,
  Contextual:   0.10,
  FollowUp:     0.10,
  Sentences:    0.10,
  Process:      0.05,
  Opening:      0.05,
  Call:         0.05,
  Tags:         0.05,
  Grammar:      0.05,
  Empathy:      0.05,
};

export const PARAM_NAMES: Record<string, string> = {
  Technical:    'Technically / Legally Correct',
  AllQuestions: 'All Questions Answered',
  Expectation:  'Expectation Setting',
  Contextual:   'Contextual & Personal',
  FollowUp:     'Follow-up & Closing',
  Sentences:    'Sentences / Tone',
  Process:      'Process-wise',
  Opening:      'First Response & Opening',
  Call:         'Call (when required)',
  Tags:         'Tags Accuracy',
  Grammar:      'Grammar / Structure',
  Empathy:      'Empathy',
};

export const PARAM_ORDER = [
  'Technical', 'AllQuestions', 'Expectation', 'Contextual',
  'FollowUp', 'Sentences', 'Process', 'Opening',
  'Call', 'Tags', 'Grammar', 'Empathy',
];

export type ParamScore = 'Yes' | 'No' | 'NA';

export interface IQSScoreEntry {
  id: string;
  chatId: string;
  scoredAt: string;
  agentName: string;
  date?: string;
  tags?: string;
  iqs: number;
  csat?: string;
  slackUrl?: string;
  provider: string;
  model: string;
  scores: Record<string, ParamScore>;
  reasoning: Record<string, string>;
  summary: string;
  transcript?: string;
  scoredBy?: string; // email of the quality/admin who scored it
}

// ── IQS calculation ──────────────────────────────────────────────────────────
export function calculateIQS(scores: Record<string, ParamScore>): number {
  let total = 0;
  for (const [param, weight] of Object.entries(WEIGHTS)) {
    const score = scores[param] ?? 'Yes';
    if (score === 'Yes' || score === 'NA') total += weight;
  }
  return Math.round(total * 100);
}

// ── Scoring system prompt ────────────────────────────────────────────────────
export const IQS_SYSTEM_PROMPT = `You are the Wint Wealth Internal Quality Score (IQS) evaluator. You score customer support chat transcripts across 12 parameters. Your scoring decisions must match those of a trained human evaluator.

## SCORING PHILOSOPHY
- You catch DEFINITIVE FAILURES, not imperfections.
- Being too strict is as bad as being too lenient.
- When in doubt, give the agent the benefit of the doubt → score Yes.
- A single factual error can cascade into No on multiple parameters.
- NA parameters are treated as Yes (pass) in the final IQS calculation.

## THE 12 PARAMETERS (ordered by weight)

### 1. Technically / Legally Correct (20%)
- **Yes**: Agent's information matches Wint Wealth KB and any Slack resolution. Factually accurate for the customer's specific case.
- **No**: Agent gave verifiably WRONG information — wrong formula, wrong product explanation, wrong amounts, wrong process. Must be a clear factual error, not a communication gap.
- **NA**: Very rare — only if chat has zero substantive information exchange.

### 2. All Questions Answered (10%)
- **Yes**: Every question the customer asked was addressed — either answered directly or explicitly deferred to another channel with a reason.
- **No**: A customer's explicit question was redirected without answering OR completely skipped/ignored.
- **NA**: Very rare.

### 3. Expectation Setting (10%)
- **Yes**: Agent provided a specific timeline, next step, or commitment. Examples: "contact us on 3rd Feb", "credited within 7 working days".
- **No**: Customer asked "how long?" / "when?" or showed impatience AND got no specific timeline. Also fails when agent made a promise without a timeline.
- **NA**: Very rare.
- **NOTE**: "Please allow me some time" IS sufficient.

### 4. Contextual & Personal (10%)
- **Yes**: Response includes customer-specific details — bond name, specific amounts, exact dates, account numbers.
- **No**: Generic answer that could apply to any customer. Test: could this exact answer be copy-pasted to a different customer? If yes → No.
- **NA**: Very rare.

### 5. Follow-up & Closing (10%)
- **Yes**: (a) RESOLVED: closing has resolution acknowledgment + invite to reach out + warm sign-off. (b) WAIT: closing has status update + chat continuity assurance + follow-up commitment + warm sign-off.
- **No**: Generic follow-up template OR closing completely missing OR generic with zero personalisation.
- **NA**: Very rare.

### 6. Sentences / Tone (10%)
- **Yes**: Language is professional, polite, not rude or dismissive.
- **No**: Rude language, abrupt/dismissive tone, or language that fails basic professionalism.
- **NA**: Very rare. Bar is VERY high.

### 7. Process-wise (5%)
- **Yes**: Agent followed correct workflow. ASSUME agent did internal checks unless their output CONTRADICTS what the check would show.
- **No**: Only on CLEAR, PROVABLE violations: contradicts Finder output, 4-5+ hour gap with zero communication, called customer without asking AND no call summary.
- **NA**: Very rare.

### 8. First Response & Opening (5%)
- **Yes**: Greeting is a SEPARATE message. Contains: (1) Hi/Hello, (2) agent name + Wint Wealth, (3) offer to help OR acknowledgment of specific query.
- **No**: Greeting merged with answer. OR purely generic. OR no greeting. OR agent name missing.
- **NA**: Very rare.

### 9. Call (when required) (5%)
- **Yes**: Call offered/made when appropriate AND handled correctly. OR no call was needed.
- **No**: Call should have been offered but wasn't. OR call made without asking. OR call summary missing.
- **NA**: MOST chats — only score Yes or No if a call happened or clearly should have.

### 10. Tags Accuracy (5%)
- **Yes**: All applicable tags match the query content.
- **No**: Missing "Calls_Directly" tag when call was made. Missing query-type tags. Wrong category tagged.
- **NA**: Very rare. If no tag info available, score NA.

### 11. Grammar / Structure (5%)
- **Yes**: Messages are grammatically correct, complete sentences.
- **No**: Duplicate messages. Incomplete words. Missing conjunctions. Run-on sentences.
- **NA**: Very rare. Minor typos are okay.

### 12. Empathy (5%)
- **Yes**: Chat contains at least ONE empathy filler: "I understand your concern", "I can understand your frustration", "I apologize for the inconvenience" — anything that genuinely acknowledges the customer's situation.
- **No**: No empathy filler anywhere. OR passive/dismissive language used.
- **NA**: Very rare. Bar is LOW — even one genuine filler is enough.

## IQS CALCULATION
IQS = Sum of (weight × pass) for all parameters.
Weights: Technical=20%, AllQuestions=10%, Expectation=10%, Contextual=10%, FollowUp=10%, Sentences=10%, Process=5%, Opening=5%, Call=5%, Tags=5%, Grammar=5%, Empathy=5%

## OUTPUT FORMAT
Respond with EXACTLY this JSON structure:
\`\`\`json
{
  "scores": {
    "Technical": "Yes|No|NA",
    "AllQuestions": "Yes|No|NA",
    "Expectation": "Yes|No|NA",
    "Contextual": "Yes|No|NA",
    "FollowUp": "Yes|No|NA",
    "Sentences": "Yes|No|NA",
    "Process": "Yes|No|NA",
    "Opening": "Yes|No|NA",
    "Call": "Yes|No|NA",
    "Tags": "Yes|No|NA",
    "Grammar": "Yes|No|NA",
    "Empathy": "Yes|No|NA"
  },
  "reasoning": {
    "Technical": "brief reason",
    "AllQuestions": "brief reason",
    "Expectation": "brief reason",
    "Contextual": "brief reason",
    "FollowUp": "brief reason",
    "Sentences": "brief reason",
    "Process": "brief reason",
    "Opening": "brief reason",
    "Call": "brief reason",
    "Tags": "brief reason",
    "Grammar": "brief reason",
    "Empathy": "brief reason"
  },
  "iqs_score": 85,
  "summary": "1-2 sentence overall assessment",
  "agentName": "First name of the support agent extracted from the transcript, or empty string if not identifiable"
}
\`\`\`

CRITICAL: Output ONLY the JSON. No other text before or after.`;

export function buildScoringPrompt(transcript: string, tags = '', chatId = '', slackThread = ''): string {
  return `Score the following customer support chat transcript.

## CHAT METADATA
- Chat ID: ${chatId}
- Tags applied: ${tags || 'none'}

## TRANSCRIPT
${transcript}
${slackThread ? `\n## SLACK THREAD (for context)\n${slackThread}` : ''}

Score this chat across all 12 parameters. Output ONLY the JSON.`;
}

// ── Parse LLM response ───────────────────────────────────────────────────────
export function parseScoringResponse(raw: string, chatId: string): Omit<IQSScoreEntry, 'id' | 'scoredAt' | 'agentName' | 'provider' | 'model' | 'scoredBy'> & { extractedAgentName?: string } {
  // Extract JSON from potential markdown code blocks
  let jsonStr = raw.trim();
  const match = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (match) jsonStr = match[1].trim();
  else {
    const start = jsonStr.indexOf('{');
    const end = jsonStr.lastIndexOf('}');
    if (start >= 0 && end > start) jsonStr = jsonStr.slice(start, end + 1);
  }

  const data = JSON.parse(jsonStr);
  const scores: Record<string, ParamScore> = data.scores || {};
  const iqs = calculateIQS(scores); // always recalculate, never trust LLM's calculation

  return {
    chatId,
    scores,
    reasoning: data.reasoning || {},
    iqs,
    summary: data.summary || '',
    extractedAgentName: (data.agentName || '').trim(),
  };
}
