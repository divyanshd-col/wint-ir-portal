import { PASCAL_TO_DB, ALL_DB_KEY_TO_PASCAL, LEGACY_V4_FALLBACK_KEY, resolveParamCell } from './param-keys';
import { HUMAN_WEIGHTS as V4_HUMAN_WEIGHTS_PCT, BOT_WEIGHTS as V4_BOT_WEIGHTS_PCT } from './scoring/prompt_v4';

/**
 * IQS Quality Scoring — types, config, scoring prompt, and KV storage.
 * Ported from the standalone Python iqs_scorer tool.
 */

export { resolveParamCell };

// ── Parameter weights ────────────────────────────────────────────────────────
// Sourced from lib/scoring/prompt_v4.ts's HUMAN_WEIGHTS (0-100 scale there,
// converted to fractions here) so there is one place that defines what v4
// actually scores — no more hand-duplicated, drifting copy.
export const WEIGHTS: Record<string, number> = Object.fromEntries(
  Object.entries(V4_HUMAN_WEIGHTS_PCT).map(([k, v]) => [k, v / 100])
);

export const PARAM_NAMES: Record<string, string> = {
  IssueResolution:           'Issue Resolution',
  Accuracy:                  'Accuracy',
  ExpectationFollowThrough:  'Expectation Setting & Follow-Through',
  DissatisfactionHandling:   'Dissatisfaction Handling',
  Personalization:           'Personalization',
  Empathy:                   'Empathy',
  EscalationDecision:        'Call Escalation Decision',
  Readability:               'Readability & Tone',
  GreetingHandover:          'Greeting & Handover',
  PostCallRecap:             'Post-Call Recap',

  // Lowercase & snake_case aliases
  issue_resolution:          'Issue Resolution',
  accuracy:                  'Accuracy',
  expectation_follow_through:'Expectation Setting & Follow-Through',
  dissatisfaction_handling:  'Dissatisfaction Handling',
  personalization:           'Personalization',
  empathy:                   'Empathy',
  escalation_decision:       'Call Escalation Decision',
  readability:               'Readability & Tone',
  greeting_handover:         'Greeting & Handover',
  post_call_recap:           'Post-Call Recap',
  greetinghandover:          'Greeting & Handover',
  dissatisfactionhandling:   'Dissatisfaction Handling',
  expectationfollowthrough:  'Expectation Setting & Follow-Through',
  escalationdecision:        'Call Escalation Decision',
  postcallrecap:             'Post-Call Recap',
};

export const PARAM_ORDER = Object.keys(V4_HUMAN_WEIGHTS_PCT);

// V3 Legacy parameter order, names, and weights for old chats
export const V3_PARAM_ORDER = [
  'Technical', 'AllQuestions', 'Expectation', 'Contextual',
  'FollowUp', 'Sentences', 'Process', 'Opening',
  'Call', 'Grammar', 'Empathy',
];

export const V3_PARAM_NAMES: Record<string, string> = {
  Technical:    'Technically / Legally Correct',
  AllQuestions: 'All Questions Answered',
  Expectation:  'Expectation Setting',
  Contextual:   'Contextual & Personal',
  FollowUp:     'Follow-up & Closing',
  Sentences:    'Sentences / Tone',
  Process:      'Process-wise',
  Opening:      'First Response & Opening',
  Call:         'Call (when required)',
  Grammar:      'Grammar / Structure',
  Empathy:      'Empathy',
};

export const V3_WEIGHTS: Record<string, number> = {
  Technical:    0.20,
  AllQuestions: 0.10,
  Expectation:  0.10,
  Contextual:   0.10,
  FollowUp:     0.10,
  Sentences:    0.10,
  Process:      0.05,
  Opening:      0.05,
  Call:         0.05,
  Grammar:      0.05,
  Empathy:      0.10,
};

// Helper function to detect if a chat evaluation is v4 vs legacy v3
export function isV4Evaluation(parameters: any, modelVersion?: string): boolean {
  if (!parameters || Object.keys(parameters).length === 0) return true;
  if (parameters.__scores || parameters.__agent_parameters) return true;
  const mv = (modelVersion || parameters.__bot_model_version || parameters.model_version || '').toLowerCase();
  if (mv.includes('v4') || mv.includes('gemini') || mv.includes('claude')) return true;
  if (parameters.dissatisfactionhandling || parameters.expectationfollowthrough || parameters.greetinghandover || parameters.issue_resolution || parameters.accuracy) return true;
  // Only return false if parameters explicitly contains legacy V3-only keys
  if (parameters.Technical !== undefined || parameters.AllQuestions !== undefined || parameters.Grammar !== undefined || parameters.Sentences !== undefined) {
    return false;
  }
  return true;
}

// Bot parameters and weights
export const BOT_WEIGHTS: Record<string, number> = {
  IssueResolution: 0.25,
  Accuracy: 0.20,
  CorrectEscalation: 0.20,
  NoRepetition: 0.10,
  Personalization: 0.10,
  ExpectationSetting: 0.08,
  Clarity: 0.07,
};

export const BOT_PARAM_NAMES: Record<string, string> = {
  IssueResolution: 'Issue Resolution',
  Accuracy: 'Accuracy',
  CorrectEscalation: 'Correct Escalation',
  NoRepetition: 'No Repetition',
  Personalization: 'Personalization',
  ExpectationSetting: 'Expectation Setting',
  Clarity: 'Clarity',

  // Lowercase & snake_case aliases
  issue_resolution: 'Issue Resolution',
  accuracy: 'Accuracy',
  correct_escalation: 'Correct Escalation',
  no_repetition: 'No Repetition',
  personalization: 'Personalization',
  expectation_setting: 'Expectation Setting',
  clarity: 'Clarity',
  correctescalation: 'Correct Escalation',
  norepetition: 'No Repetition',
  expectationsetting: 'Expectation Setting',
};

export const BOT_PARAM_ORDER = [
  'IssueResolution', 'Accuracy', 'CorrectEscalation', 'NoRepetition',
  'Personalization', 'ExpectationSetting', 'Clarity',
];

export interface DisputeTargetInfo {
  type: 'agent' | 'bot' | 'hybrid';
  label: 'AGENT' | 'BOT' | 'AGENT & BOT';
  badgeBg: string;
  badgeText: string;
  badgeBorder: string;
}

/**
 * Classifies whether a dispute targets Agent parameters, Bot parameters, or Both (Hybrid).
 */
export function getDisputeClassification(
  challengedParams?: Array<{ param: string; note?: string }> | null,
  conversationType?: string
): DisputeTargetInfo {
  const BOT_ONLY_KEYS = [
    'correct_escalation', 'no_repetition', 'clarity',
    'CorrectEscalation', 'NoRepetition', 'Clarity', 'ExpectationSetting', 'expectation_setting',
  ];

  if (!challengedParams || challengedParams.length === 0) {
    if (conversationType === 'bot') {
      return { type: 'bot', label: 'BOT', badgeBg: '#fef2f2', badgeText: '#991b1b', badgeBorder: '#fecaca' };
    }
    return { type: 'agent', label: 'AGENT', badgeBg: '#eff6ff', badgeText: '#1d4ed8', badgeBorder: '#bfdbfe' };
  }

  let hasBot = false;
  let hasAgent = false;

  for (const cp of challengedParams) {
    const p = cp.param || '';
    if (p.startsWith('bot:')) {
      hasBot = true;
    } else if (p.startsWith('agent:')) {
      hasAgent = true;
    } else if (BOT_ONLY_KEYS.includes(p)) {
      hasBot = true;
    } else {
      hasAgent = true;
    }
  }

  if (hasBot && hasAgent) {
    return { type: 'hybrid', label: 'AGENT & BOT', badgeBg: '#f3e8ff', badgeText: '#6b21a8', badgeBorder: '#e9d5ff' };
  }
  if (hasBot) {
    return { type: 'bot', label: 'BOT', badgeBg: '#fef2f2', badgeText: '#991b1b', badgeBorder: '#fecaca' };
  }
  return { type: 'agent', label: 'AGENT', badgeBg: '#eff6ff', badgeText: '#1d4ed8', badgeBorder: '#bfdbfe' };
}

/**
 * Formats a challenged parameter key for UI display (e.g. 'agent:Accuracy' -> 'Agent: Accuracy').
 */
export function formatParamLabel(paramKey: string): string {
  if (!paramKey) return '';
  let prefix = '';
  let raw = paramKey;
  if (paramKey.startsWith('bot:')) {
    prefix = 'Bot: ';
    raw = paramKey.slice(4);
  } else if (paramKey.startsWith('agent:')) {
    prefix = 'Agent: ';
    raw = paramKey.slice(6);
  }

  const label =
    PARAM_NAMES[raw] ||
    BOT_PARAM_NAMES[raw] ||
    V3_PARAM_NAMES[raw] ||
    raw;

  if (prefix) return `${prefix}${label}`;

  const BOT_ONLY_KEYS = [
    'correct_escalation', 'no_repetition', 'clarity',
    'CorrectEscalation', 'NoRepetition', 'Clarity', 'ExpectationSetting', 'expectation_setting',
  ];
  if (BOT_ONLY_KEYS.includes(raw)) {
    return `Bot: ${label}`;
  }
  return `Agent: ${label}`;
}


export type ParamScore = 'Yes' | 'No' | 'NA' | 'Half';

/**
 * Normalizes any score input (legacy or new) to standard v4 floats:
 * Yes/Pass -> 1.0, Half/Partial -> 0.5, No/Fail -> 0.0, NA -> null
 */
export function normalizeScore(val: number | boolean | string | null): {
  label: 'Yes' | 'No' | 'Half' | 'NA';
  value: number | null;
  badgeBg: string;
  badgeText: string;
} {
  // 1. Match 'Yes' / true / 1 / '1' / 2 / '2' / 'PASS' / 'pass'
  if (val === true || val === 1 || val === '1' || val === 2 || val === '2' || val === 'Yes' || val === 'yes' || val === 'PASS' || val === 'pass') {
    return { label: 'Yes', value: 1.0, badgeBg: '#dcfce7', badgeText: '#15803d' };
  }
  
  // 2. Match 'No' / false / 0.0 / 0 / '0' / 'FAIL' / 'fail'
  if (val === false || val === 0 || val === '0' || val === 0.0 || val === 'No' || val === 'no' || val === 'FAIL' || val === 'fail') {
    return { label: 'No', value: 0.0, badgeBg: '#fee2e2', badgeText: '#b91c1c' };
  }
  
  // 3. Match 'Half' / 0.5 / '0.5' / 'Partial' / 'partial' / 'Part' / 'part'
  if (val === 0.5 || val === '0.5' || val === 'Half' || val === 'half' || val === 'Partial' || val === 'partial' || val === 'Part' || val === 'part') {
    return { label: 'Half', value: 0.5, badgeBg: '#fef3c7', badgeText: '#b45309' };
  }
  
  // 4. Default to NA
  return { label: 'NA', value: null, badgeBg: '#f1f5f9', badgeText: '#64748b' };
}

export interface IQSScoreEntry {
  id: string;
  chatId: string;
  scoredAt: string;
  agentName: string;
  date?: string;
  tags?: string;
  iqs: number;
  botIqsScore?: number | null;
  callIqsScore?: number | null;
  csat?: string;
  parameters?: Record<string, any>;
  slackUrl?: string;
  provider: string;
  model: string;
  scores: Record<string, ParamScore>;
  reasoning: Record<string, string>;
  summary: string;
  transcript?: string;
  scoredBy?: string; // email of the quality/admin who scored it
  updatedAt?: string;   // ISO — set on create and on every quality override
  updatedBy?: string;   // email of last editor
  uncertainParameters?: Array<{ parameter: string; question: string }>;
  // ── Conversation metrics ────────────────────────────────────────────────────
  conversationType?: 'bot' | 'agent' | 'hybrid'; // 'bot' = only Myra responded
  frt?: number;              // seconds: chat assignment → first human agent message
  botToTeamSecs?: number;    // seconds: first Myra msg → first human agent msg (B→T)
  resolutionTime?: number;   // seconds: first customer msg → last msg in transcript
  closureTime?: number;      // seconds: first customer msg → conversation_ended (or last msg)
  conversationStarted?: string; // ISO timestamp of conversation start
  conversationEnded?: string;   // ISO timestamp of conversation end
  // ── Robylon classifications ─────────────────────────────────────────────────
  disposition?: string;     // l1 name — main tag / disposition
  subDisposition?: string;  // l2 name — sub tag / sub-disposition
  // ── Customer contact ────────────────────────────────────────────────────────
  mobileNumber?: string;    // customer phone number (from webhook)
  reviewNote?: string;      // quality reviewer's override note (persisted in DB)
}

// ── Bot name used at Wint Wealth ─────────────────────────────────────────────
const BOT_NAMES = new Set(['myra', 'bot', 'wint bot', 'wintbot', 'robylon ai']);
const CUSTOMER_LABELS = new Set(['user', 'customer', 'visitor']);

function isCustomer(sender: string) { return CUSTOMER_LABELS.has(sender.toLowerCase()); }
function isBot(sender: string) { return BOT_NAMES.has(sender.toLowerCase()); }
function isHumanAgent(sender: string) {
  const low = (sender || '').toLowerCase();
  return !isCustomer(sender) && !isBot(sender) && low !== 'internal note' && low !== 'system';
}

export interface TimedMessage {
  sender: string;
  content: string;
  timestamp?: string; // ISO string
}

export interface ConversationMetrics {
  conversationType: 'bot' | 'agent' | 'hybrid';
  frt?: number;
  botToTeamSecs?: number;
  resolutionTime?: number;
  closureTime?: number;
}

/** Calculate timing/type metrics from a messages array with optional timestamps. */
export function analyzeConversationTiming(
  messages: TimedMessage[],
  conversationEnded?: string,
  transferTimestamp?: string,  // when the chat was assigned to a human agent
): ConversationMetrics {
  // Sort by timestamp if available; otherwise use original order
  const sorted = [...messages].sort((a, b) => {
    if (!a.timestamp || !b.timestamp) return 0;
    return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
  });

  const firstCustomer = sorted.find(m => isCustomer(m.sender));
  const firstBot = sorted.find(m => isBot(m.sender));
  const firstHuman = sorted.find(m => isHumanAgent(m.sender));
  const lastMsg = sorted[sorted.length - 1];

  // Conversation type
  const hasBot = !!firstBot;
  const hasHuman = !!firstHuman;
  let conversationType: 'bot' | 'agent' | 'hybrid';
  if (!hasHuman) {
    conversationType = 'bot';
  } else if (!hasBot) {
    conversationType = 'agent';
  } else {
    conversationType = 'hybrid';
  }

  // Helper: diff in seconds between two ISO timestamps
  const diffSecs = (a?: string, b?: string) => {
    if (!a || !b) return undefined;
    const d = new Date(b).getTime() - new Date(a).getTime();
    return d >= 0 ? Math.round(d / 1000) : undefined;
  };

  // FRT = assignment timestamp → first human agent message
  // Only falls back to first customer message when there is no bot involved
  // (pure agent chats have no assignment event, so first customer msg is the right start)
  const frtStart = transferTimestamp
    ?? (conversationType === 'agent' ? firstCustomer?.timestamp : undefined);
  const frt = diffSecs(frtStart, firstHuman?.timestamp);
  const botToTeamSecs = diffSecs(firstBot?.timestamp, firstHuman?.timestamp);
  const resolutionTime = diffSecs(firstCustomer?.timestamp, lastMsg?.timestamp);
  const endTs = conversationEnded ?? lastMsg?.timestamp;
  const closureTime = diffSecs(firstCustomer?.timestamp, endTs);

  return { conversationType, frt, botToTeamSecs, resolutionTime, closureTime };
}

// ── IQS calculation ──────────────────────────────────────────────────────────
// Normalizes by sum of applicable weights. Both 'NA' AND parameters absent from
// `scores` are excluded from numerator (total) and denominator (possible) — this
// matches computeIQS() in lib/scoring/prompt_v4.ts, the authoritative engine.
// A missing key must NOT default to a pass: if `scores` is keyed for a different
// parameter generation than `activeWeights` (e.g. v3 scores against v4 weights),
// every key would miss and the old `?? 'Yes'` default silently returned 100.
// Skipping instead surfaces the mismatch as an obviously-wrong low score.
// Pass the correct isV4 flag at every call site so the weight set matches the scores.
export function calculateIQS(scores: Record<string, ParamScore>, isBot?: boolean, isV4 = true): number | null {
  const activeWeights = isBot ? BOT_WEIGHTS : (isV4 ? WEIGHTS : V3_WEIGHTS);
  let total = 0, possible = 0;
  for (const [param, weight] of Object.entries(activeWeights)) {
    const score = scores[param];
    if (score === undefined || score === 'NA') continue;
    possible += weight;
    if (score === 'Yes') {
      total += weight;
    } else if (score === 'Half') {
      total += weight * 0.5;
    }
  }
  return possible > 0 ? Math.round((total / possible) * 100) : null;
}

export type PooledParamInput =
  | { yes?: number; half?: number; total?: number; score?: number | null }
  | number
  | null
  | undefined;

export interface WeightedOverallOptions {
  roundDecimals?: number; // e.g. 1 for 1 decimal place (85.5), 0 or undefined for integer (86)
  scale?: '0-1' | '0-100' | 'auto';
}

/**
 * Computes a fixed-weight blend of pooled parameter scores for a period/rollup headline.
 * Formula: overall = Σ(parameter_score × weight) ÷ Σ(weight of parameters present)
 * Parameter score is pooled across chats (half-credit for 0.5, NA excluded).
 * Weights sourced from HUMAN_WEIGHTS / BOT_WEIGHTS in prompt_v4.ts.
 */
export function calculateWeightedOverallIQS(
  paramScores: Record<string, PooledParamInput> | null | undefined,
  channel: 'bot' | 'human' = 'human',
  options: WeightedOverallOptions = {}
): number | null {
  if (!paramScores || typeof paramScores !== 'object') return null;

  const weightsSource = channel === 'bot' ? V4_BOT_WEIGHTS_PCT : V4_HUMAN_WEIGHTS_PCT;

  const weightMap: Record<string, { key: string; weight: number }> = {};
  for (const [pascalKey, w] of Object.entries(weightsSource)) {
    weightMap[pascalKey] = { key: pascalKey, weight: w };
    const dbKey = PASCAL_TO_DB[pascalKey];
    if (dbKey) weightMap[dbKey] = { key: pascalKey, weight: w };
    const fallbackKey = LEGACY_V4_FALLBACK_KEY[pascalKey];
    if (fallbackKey) weightMap[fallbackKey] = { key: pascalKey, weight: w };
  }

  // Determine numeric scale across the input object to avoid mixing per-parameter scales
  const userScale = options.scale ?? 'auto';
  let isPercentScale = userScale === '0-100';
  if (userScale === 'auto') {
    for (const rawVal of Object.values(paramScores)) {
      if (rawVal === undefined || rawVal === null) continue;
      if (typeof rawVal === 'number' && !isNaN(rawVal) && rawVal > 1) {
        isPercentScale = true;
        break;
      }
      if (typeof rawVal === 'object' && rawVal !== null && rawVal.score !== undefined) {
        const sc = typeof rawVal.score === 'number' ? rawVal.score : parseFloat(String(rawVal.score));
        if (!isNaN(sc) && sc > 1) {
          isPercentScale = true;
          break;
        }
      }
    }
  }

  const canonicalPresent: Record<string, { paramScore: number; weight: number }> = {};

  for (const [rawKey, rawVal] of Object.entries(paramScores)) {
    if (rawVal === undefined || rawVal === null || rawKey.startsWith('__')) continue;

    const pascalKey = ALL_DB_KEY_TO_PASCAL[rawKey] ?? rawKey;
    const info = weightMap[rawKey] || weightMap[pascalKey];
    if (!info) continue;

    let paramScore: number | null = null;
    let isPresent = false;

    if (typeof rawVal === 'number') {
      if (!isNaN(rawVal)) {
        paramScore = isPercentScale ? rawVal / 100 : rawVal;
        isPresent = true;
      }
    } else if (typeof rawVal === 'object') {
      if (rawVal.total !== undefined && rawVal.total > 0) {
        const yes = rawVal.yes ?? 0;
        const half = rawVal.half ?? 0;
        paramScore = (yes + 0.5 * half) / rawVal.total;
        isPresent = true;
      } else if (rawVal.score !== undefined && rawVal.score !== null) {
        const sc = typeof rawVal.score === 'number' ? rawVal.score : parseFloat(String(rawVal.score));
        if (!isNaN(sc)) {
          paramScore = isPercentScale ? sc / 100 : sc;
          isPresent = true;
        }
      }
    }

    if (isPresent && paramScore !== null && !isNaN(paramScore)) {
      paramScore = Math.max(0, Math.min(1, paramScore));
      canonicalPresent[info.key] = { paramScore, weight: info.weight };
    }
  }

  let totalWeightedScore = 0;
  let totalPresentWeight = 0;

  for (const item of Object.values(canonicalPresent)) {
    totalWeightedScore += item.paramScore * item.weight;
    totalPresentWeight += item.weight;
  }

  if (totalPresentWeight === 0) return null;

  const resultPct = (totalWeightedScore / totalPresentWeight) * 100;
  const decimals = options.roundDecimals ?? 0;

  if (decimals > 0) {
    const factor = Math.pow(10, decimals);
    return Math.round(resultPct * factor) / factor;
  }
  return Math.round(resultPct);
}

/**
 * Pools parameter scores (Yes, Half, No) across an array of parameters objects (e.g. from jsonb_agg(s.parameters)).
 */
export function extractPooledParams(paramsArray: any[]): Record<string, { yes: number; half: number; total: number }> {
  const pooled: Record<string, { yes: number; half: number; total: number }> = {};
  if (!Array.isArray(paramsArray)) return pooled;
  for (let paramObj of paramsArray) {
    if (!paramObj) continue;
    if (typeof paramObj === 'string') {
      try { paramObj = JSON.parse(paramObj); } catch { continue; }
    }
    const targetObj = (typeof paramObj === 'object' && paramObj !== null)
      ? (paramObj.__agent_parameters || paramObj)
      : {};
    for (const [rawKey, val] of Object.entries(targetObj as Record<string, any>)) {
      if (rawKey.startsWith('__')) continue;
      const pk = ALL_DB_KEY_TO_PASCAL[rawKey] ?? rawKey;
      if (!pooled[pk]) pooled[pk] = { yes: 0, half: 0, total: 0 };
      const score = typeof val === 'object' && val !== null ? val.score : val;
      if (score === true || score === 'Yes' || score === 1 || score === '1') {
        pooled[pk].yes++; pooled[pk].total++;
      } else if (score === 0.5 || score === 'Half') {
        pooled[pk].half++; pooled[pk].total++;
      } else if (score === false || score === 'No' || score === 0 || score === '0') {
        pooled[pk].total++;
      }
    }
  }
  return pooled;
}


export function computeIqsFromRawParams(paramsObj: any, isBot = false): number | null {
  if (!paramsObj || typeof paramsObj !== 'object') return null;

  const BOT_ONLY_KEYS = [
    'correct_escalation', 'no_repetition', 'expectation_setting', 'clarity',
    'CorrectEscalation', 'NoRepetition', 'ExpectationSetting', 'Clarity',
    'bot_handover', 'BotHandover'
  ];
  const HUMAN_ONLY_KEYS = [
    'expectation_follow_through', 'dissatisfaction_handling', 'dissatisfactionhandling',
    'escalation_decision', 'escalationdecision', 'readability', 'greeting_handover',
    'greetinghandover', 'post_call_recap', 'postcallrecap', 'empathy',
    'ExpectationFollowThrough', 'DissatisfactionHandling', 'EscalationDecision',
    'Readability', 'GreetingHandover', 'PostCallRecap', 'Empathy',
    'Technical', 'AllQuestions', 'Expectation', 'Contextual', 'FollowUp', 'Sentences', 'Process', 'Opening', 'Call', 'Grammar'
  ];

  let targetParams: any = null;
  if (isBot) {
    if (paramsObj.__bot_parameters) {
      targetParams = paramsObj.__bot_parameters;
    } else if (!paramsObj.__agent_parameters) {
      // Flat object - only treat as bot if it contains bot-only keys and no human-only keys
      const hasBotOnlyKey = Object.keys(paramsObj).some(k => BOT_ONLY_KEYS.includes(k));
      const hasHumanOnlyKey = Object.keys(paramsObj).some(k => HUMAN_ONLY_KEYS.includes(k));
      if (hasBotOnlyKey && !hasHumanOnlyKey) {
        targetParams = paramsObj;
      }
    }
  } else {
    if (paramsObj.__agent_parameters) {
      targetParams = paramsObj.__agent_parameters;
    } else if (!paramsObj.__bot_parameters) {
      // Flat object - treat as agent/human if it has human-only keys or does not have exclusive bot-only keys
      const hasBotOnlyKey = Object.keys(paramsObj).some(k => BOT_ONLY_KEYS.includes(k));
      const hasHumanOnlyKey = Object.keys(paramsObj).some(k => HUMAN_ONLY_KEYS.includes(k));
      if (hasHumanOnlyKey || !hasBotOnlyKey) {
        targetParams = paramsObj;
      }
    }
  }

  if (!targetParams || typeof targetParams !== 'object') return null;

  // Score each generation against its own rubric. A legacy v3 chat must NOT be
  // routed through resolveParamCell's v4 alias mapping and v4 weights — that
  // drops Process/Grammar and drifts the displayed score from the stored one.
  const isV4 = isBot ? true : isV4Evaluation(paramsObj);
  const paramKeys = isBot ? BOT_PARAM_ORDER : (isV4 ? PARAM_ORDER : V3_PARAM_ORDER);
  const scores: Record<string, ParamScore> = {};
  let hasValidParam = false;

  for (const pascal of paramKeys) {
    const rawVal = resolveParamCell(targetParams, pascal);
    const hasData = rawVal !== undefined && rawVal !== null
      && !(typeof rawVal === 'object' && rawVal.score === undefined);
    if (hasData) {
      hasValidParam = true;
      const scoreVal = typeof rawVal === 'object' && rawVal !== null ? rawVal.score : rawVal;
      if (scoreVal === true || scoreVal === 1 || scoreVal === '1' || String(scoreVal).toLowerCase() === 'yes' || String(scoreVal).toLowerCase() === 'pass') {
        scores[pascal] = 'Yes';
      } else if (scoreVal === 'Half' || scoreVal === 0.5 || String(scoreVal).toLowerCase() === 'half') {
        scores[pascal] = 'Half';
      } else if (scoreVal === false || scoreVal === 0 || scoreVal === '0' || String(scoreVal).toLowerCase() === 'no' || String(scoreVal).toLowerCase() === 'fail') {
        scores[pascal] = 'No';
      } else {
        scores[pascal] = 'NA';
      }
    }
  }

  if (!hasValidParam) return null;
  return calculateIQS(scores, isBot, isV4);
}

// ── Scoring system prompt ────────────────────────────────────────────────────
export function getSystemPrompt(conversationType?: string, configPrompt?: string): string {
  if (conversationType === 'bot') {
    return BOT_IQS_SYSTEM_PROMPT;
  }
  return configPrompt?.trim() || IQS_SYSTEM_PROMPT;
}

export const BOT_IQS_SYSTEM_PROMPT = `You are the Wint Wealth Internal Quality Score (IQS) evaluator. You score customer support chats. Your judgments must match those of a trained human QA reviewer.

## READ THE COMPLETE TRANSCRIPT FIRST
Read every message from first to last before scoring anything. Decisive details often appear late (a closing, a correction, a follow-up). Do not begin scoring until you have read the whole conversation.

## LANGUAGE
Chats are often in Hinglish or Hindi, or mix scripts. Do NOT lower any dimension for language mix, transliteration, or non-English phrasing. Judge clarity of meaning and correctness, never English purity.

## EMPTY OR NON-CHATS
If there is no substantive interaction (a customer message with no agent reply, an instant drop, only system or activity lines, or no real question or resolution), set every score to "NA", explain in summary, and do not fabricate scores.

## HOW TO GRADE THE SOFT DIMENSIONS (0 / 0.5 / 1)
Decide in this order for each graded dimension:
1. Did this dimension's core purpose succeed with no gap a QA reviewer would coach? Score 1.
2. Was the core handled but with ONE specific, nameable gap, short of a real failure? Score 0.5.
3. Did the core purpose clearly fail in a specific, nameable way? Score 0.
You MUST state the exact gap for a 0.5 and the exact failure for a 0 in the reasoning. If you cannot name it, score 1.
Judge ONLY this dimension's core purpose. Never lower a score for a problem that belongs to another dimension. When you are unsure of the DEGREE (not whether the dimension applies), give the benefit of the doubt and score higher.

## THREE STATES: SCORED, NOT APPLICABLE, OR UNSURE
Every dimension ends in one of three states. Use the "unsure" flag to separate the last two, because only one of them needs a human.
1. SCORED. You can judge it. Give the number (0 / 0.5 / 1, or 0 / 1 for binary). Set unsure = false.
2. NOT APPLICABLE. The dimension genuinely does not apply, for example a conditional whose trigger did not fire (Empathy on a calm chat, DissatisfactionHandling on a happy customer, PostCallRecap when no call happened, EscalationDecision when no call question arises). Set score = "NA" and unsure = false. In the comment, briefly say why it does not apply. This does NOT need QA review.
3. UNSURE. The dimension applies but you cannot judge it because the evidence is not in the chat, for example a call happened but you have no call transcript, or a claim depends on data you cannot see. Set score = "NA" and unsure = true. In the comment, write a precise question a human QA reviewer with call recordings and system access can answer, not a vague "was this okay". This DOES need QA review.
Do NOT use "NA" merely because you are unsure how GOOD something was. Uncertainty about degree is handled by scoring higher (benefit of the doubt), not by NA and not by the unsure flag. Unsure is only for "I cannot evaluate this at all from what I can see".
Only set unsure = true when the answer would actually change the score, meaning resolving it could turn this dimension from NA into a real fail. If even the worst-case answer would not lower the score, do not flag it, just score it and move on.
Both NA states are excluded from the score. The unsure flag is what tells QA which dimensions to go and check.

## KEEP DIMENSIONS INDEPENDENT
Do NOT let one problem cascade into many low scores. A factual error lowers Accuracy only, not four other dimensions.

## DATE AWARENESS
Today's date is in CHAT METADATA. A date on or before today has already happened. Never treat a past date as a missed future commitment.

## COMPLIANCE FLAG (separate from the score)
Independently of the quality dimensions, raise a compliance flag (set compliance.breach = true with the offending quote and type) if any of the following occurred ANYWHERE in the interaction. Read the whole interaction for this: the chat, and if a CALL TRANSCRIPT is present in context, the call too. A breach is a breach wherever it happened. Do not trace who said it or which leg it came from, the flag is about the interaction, not about blaming an agent. This does NOT change the quality score. It marks the interaction for separate compliance or QA review.
- Advisory breach: gave a personalised investment recommendation ("you should invest in X bond") or acted as an investment advisor.
- Guaranteed returns: implied or stated assured or guaranteed returns.
- Data handling over WhatsApp: see the data-handling rule below.
- Misleading error: a factual error serious enough to push the customer toward a wrong financial decision.
If none apply, set compliance.breach = false.
Note: a misleading-error breach that happened in the CHAT also lowers Accuracy. A breach that happened only on the CALL does not affect any chat quality parameter, since call quality is scored separately. Either way the flag fires.

### Data handling over WhatsApp
Documents may be shared over WhatsApp only if they carry no personal and no internal information.
- BREACH if the agent shares over WhatsApp any document containing a user's personal, investment, or KYC information. Examples: CMR (client master report), holding statement, investment report, taxation report, any KYC or identity proof, account opening or closing forms, or any file or screenshot showing PAN, Aadhaar, or bank details. Also a breach: any internal company material, Slack link, internal policy document, or internal SOP.
- NOT a breach: informational or how-to documents (how to file taxes, how to set up a SIP, how to raise a request on a website), any purely informational document, a return or reward calculation shared as an Excel file or a Google Sheets link (referral reward, YTM or XIRR calculation, bond pricing sheet, bond issuer document), and website or internet screenshots that do NOT show any personal data.
- A screenshot is a breach only if PAN, Aadhaar, bank details, or other user information is visible in it.
- When you cannot tell whether a shared document carried personal or internal information, treat it as a breach and note the ambiguity in compliance.note.

## WINT POLICY FACTS (current, apply mainly to Accuracy and IssueResolution)
- Settlement timelines that are CORRECT and must not be marked wrong: first investment or first payment T+3 working days, all subsequent investments T+1 working days. Working days are Monday to Friday only, weekends do not count. Only lower Accuracy if a materially different timeline is quoted.
- Form 121 is the current TDS declaration form and has replaced Form 15G/H. For many NBFCs the form is submitted through the Wint app. For some entities it must be submitted directly with that entity, not through Wint. An agent directing the customer to submit directly with the entity is CORRECT. Never lower Accuracy for this.
- Skip Instalment before cancellation is optional. An agent going straight to cancellation without offering Skip Instalment is not a failure.

## SCORING GUARDRAILS (how to handle what you see, applies to Accuracy and IssueResolution)
- Internal checks (Finder, order status, account or SIP state) are not visible to you and agents do not narrate them to customers. Do NOT assume a check was skipped, and do NOT lower Accuracy just because the agent did not say "I checked and confirmed X". The fact that a response could have been improved by a tool check is NOT enough to fail anything. Example: if the process KB says "check if there is an active SIP" and the agent proceeds with cancellation without stating "I verified you have an active SIP", that is NOT an error, the check is internal. Only lower Accuracy if the visible answer or action is provably wrong, for example the agent says a repayment was not processed but the transcript shows it was credited, or the agent gives a wrong fact or wrong process step.
- Private Notes / Internal notes (indicated in the transcript as "Internal Note: [content]" or "Private Note: [content]"), Slack links, and internal tool URLs in the transcript are internal working notes and were never sent to the customer. TREAT THEM AS BACKGROUND CONTEXT ONLY: use them to understand internal actions, background checks, or status updates, but EXCLUDE them while judging/scoring the customer chat. Do NOT evaluate their tone, grammar, or language as customer-facing messages, and NEVER score or penalize the agent on any quality parameter based on private notes.
- If the chat references a prior conversation (phrases such as "previous chat", "previous conversation", "previous text", "last time", "last conversation", "earlier ticket", "as discussed before", "as discussed earlier", "as mentioned earlier", "referred earlier", "as per our last chat", "continuing from before"), note it in summary and be lenient on Accuracy and IssueResolution. Missing context may live in that earlier chat. Do not fail for information gaps a prior chat could explain.

## MEDIA IN CHAT
Screenshots or documents shared in the chat are evidence.
- Accuracy: check whether the agent's guidance matches what a screenshot actually shows.
- Personalization: check whether a shared image or document fits this customer's specific situation rather than being a generic screenshot.
- Internal-tool screenshots (Finder, order status, a backend record, any internal system UI) must NOT be sent to the customer. If the agent shares one in the customer chat, that is an error. If it exposes any customer personal data (PAN, Aadhaar, bank details, holdings, KYC), it is a data-handling breach, raise the compliance flag. If it exposes no personal data, it is still a professionalism error, lower IssueResolution (or Accuracy if the screenshot also misinforms) and note it in the comment.
- If an image is unreadable or unclear, ignore it and score on the text alone.
- Document excerpts shown in a media or attachments section are trimmed previews, not the full file. Use them for context only, and do not fail a dimension because a preview looks incomplete.

## REASONING ISOLATION
Each dimension's reasoning must discuss only that dimension's own criteria. Never name another dimension inside a reasoning field. Examples of what NOT to do: writing about the greeting inside IssueResolution reasoning, writing about unanswered questions inside ExpectationFollowThrough reasoning, or writing about a factual error inside Empathy reasoning. Factual errors belong to Accuracy only. Score each dimension as if filling in a separate form with no view of the others.

## RUBRIC: BOT (the bot handled and closed the chat with no human)
Score the bot only. A bot's shortfalls are fixed by changing its flow, prompt, or KB, not by coaching a person, so judge outcomes and safety, not human craft. Do NOT judge greeting style, empathy, closing warmth, or call handling. Those do not apply to a bot.

### IssueResolution (graded 0 / 0.5 / 1)
Did the bot solve the request AND answer every question the customer asked, not just the first.
- 1: request resolved and every question answered.
- 0.5: main ask handled but a secondary question dropped, or only partly answered.
- 0: the core question went unanswered, or it closed without resolving or handing off.
Does not cover: correctness (Accuracy), repetition (NoRepetition), or clarity (Clarity).

### Accuracy (graded 0 / 0.5 / 1)
Was everything the bot stated correct against the KB and the customer's real data (product rules, settlement timelines first T+3 and subsequent T+1 working days, tax and Form 121 guidance, amounts, dates, figures it pulled).
- 1: all claims and figures accurate.
- 0.5: a minor inaccuracy that does not change the customer's action.
- 0: a wrong rule, figure, or process step a KB or data check would contradict.
Guardrails: "submit the form directly with the entity" is correct, and the timelines above are correct. Serious misleading errors escalate to the compliance flag.

### CorrectEscalation (graded 0 / 0.5 / 1)
Did the bot recognise its limits and hand off to a human at the right moment, rather than pretend to cope. It should escalate on a distressed or angry customer, a compliance-sensitive issue, stuck funds, or after failing to resolve, and should not close prematurely on an open issue.
- 1: escalated at the right moment, or correctly resolved without needing to.
- 0.5: escalated, but late, after avoidable back-and-forth.
- 0: should have escalated and instead looped or closed.
Does not cover: the repetition itself (NoRepetition). Here judge only the handoff decision.

### NoRepetition (graded 0 / 0.5 / 1)
Did the bot make progress, or repeat the same answer or menu without moving forward.
- 1: every turn moved the conversation forward, no wasted repeats.
- 0.5: one avoidable repeat, then it recovered.
- 0: it looped, sending a near-identical response or menu two or more times without progressing (for example re-sending the same "which payment are you referring to" menu right after the customer answered).
- A short single-exchange chat with nothing repeated is 1 by default.
Does not cover: whether it should have escalated (CorrectEscalation) or whether the answer was correct (Accuracy).

### Personalization (conditional, graded 0 / 0.5 / 1, else "NA")
Two things together: did the bot use the customer's actual data, AND did it read the conversation and frame its answer to the specific question this customer asked rather than paste a stock block.
- Data: referencing the customer's specific bond, repayment, amount, account, or order state when the question is about their account.
- Framing: shaping the reply around what the customer said, answering the version of the question they actually asked, using details they already gave instead of asking again, not dropping a canned paragraph that only loosely fits.
- 1: uses the customer's real data where relevant AND is framed around what they actually asked.
- 0.5: right data but stock phrasing that does not engage with how they asked, or a generic block where specifics were available.
- 0: a template answer that ignores the customer's data or the conversation context.
- "NA" (unsure false): a generic policy or how-to question with no customer-specific element and only one natural way to answer (for example "can I add a credit card account" answered by a flat policy "no"). Nothing to personalise or reframe.
Does not cover: correctness (Accuracy) or readability (Clarity).

### ExpectationSetting (conditional, graded 0 / 0.5 / 1, else "NA")
When something is pending, did the bot tell the customer what happens next and by when.
- 1: a clear next step or timeline was given (for example "being processed today, will be credited to account...").
- 0.5: implied but vague on an ongoing issue handled by the bot where a specific timeframe could be given.
- 0: left the customer not knowing what happens next on a pending item.
- "NA" (unsure false): the query was fully resolved on the spot with nothing pending.
- **TRANSFER / HANDOVER**: When transferring a chat to a human executive, standard transfer phrasing (e.g. "I'm transferring your chat to an executive", "please allow them some time to connect", "connecting you at the earliest", "an executive will assist you shortly") is FULLY ACCEPTABLE expectation setting for a bot handover. Do NOT penalize or score 0.5 for vague timeline on bot transfer messages. A bot cannot predict human agent queue wait times; informing the user of the transfer is sufficient (score 1).
Does not cover: whether the timeline quoted was correct (Accuracy).

### Clarity (binary 0 / 1)
Was the bot easy to read AND did it explain rather than dump.
- 1: clear, phone-friendly, and it explains where explanation is needed.
- 0: a dense wall of text, unexplained internal jargon (EOD, T+1, Flexi-tenure used raw), or an answer so terse it does not tell the customer what to do.
- Never flag: numbered or line-broken lists (good formatting), spacing artifacts, or all caps for emphasis. Each newline is a separate WhatsApp message, judge per line.
Does not cover: correctness or completeness, only whether it was understandable.

## OUTPUT
Return ONLY valid JSON in exactly this shape. Do not compute an overall score, that is done in code.
{
"channel": "bot",
"compliance": { "breach": true or false, "type": "advisory | guaranteed_returns | data_handling | misleading_error | none", "quote": "", "note": "" },
"parameters": {
"IssueResolution": { "score": 0 or 0.5 or 1, "unsure": false, "comment": "why this score" },
"Accuracy": { "score": 0 or 0.5 or 1, "unsure": false, "comment": "why this score, cite KB if used" },
"CorrectEscalation": { "score": 0 or 0.5 or 1, "unsure": false, "comment": "why this score" },
"NoRepetition": { "score": 0 or 0.5 or 1, "unsure": false, "comment": "why this score" },
"Personalization": { "score": 0 or 0.5 or 1 or "NA", "unsure": false, "comment": "why this score, or why NA (generic policy question)" },
"ExpectationSetting": { "score": 0 or 0.5 or 1 or "NA", "unsure": false, "comment": "why this score, or why NA (nothing pending)" },
"Clarity": { "score": 0 or 1, "unsure": false, "comment": "why this score" }
},
"needs_review": true or false,
"review_parameters": [ "names where unsure is true, or empty array" ],
"kbCitation": "Document > Section, or null",
"summary": "1 to 2 sentence overall assessment"
}

Same rules as the human output: unsure = true only when a dimension applies but cannot be evaluated from the chat (score "NA", QA question in comment). A conditional dimension that simply does not apply (Personalization on a generic policy question, ExpectationSetting when nothing is pending) is "NA" with unsure = false. needs_review = true if any unsure is true.
Output ONLY the JSON. No text before or after.
`

export const IQS_SYSTEM_PROMPT = `You are the Wint Wealth Internal Quality Score (IQS) evaluator. You score customer support chat transcripts across 11 parameters. Your scoring decisions must match those of a trained human evaluator.

## READ THE COMPLETE TRANSCRIPT FIRST — NON-NEGOTIABLE
Before scoring ANY parameter, read the COMPLETE transcript from the very first message to the very last. Do not begin scoring until every single message has been read. Scoring a parameter without having read the full conversation is invalid and will produce wrong results. Details that determine scores often appear late in the conversation — a closing message, a follow-up, a correction. Missing any part of the transcript = incorrect scores.

## SCORING PHILOSOPHY
- You catch DEFINITIVE FAILURES, not imperfections.
- Being too strict is as bad as being too lenient.
- When in doubt, give the agent the benefit of the doubt → score Yes.
- A single factual error can cascade into No on multiple parameters.
- NA parameters are excluded from the IQS calculation (both numerator and denominator). If all parameters are NA, the IQS score is NIL (null).
- **NEVER assume a failure when the transcript is ambiguous.** If you are not certain the agent did something wrong, score NA and flag for QA review.
- **Date awareness**: Today's date is provided in CHAT METADATA. Any date on or before today is a PAST event that has already occurred. Do NOT treat a past date as a missed future commitment when scoring Expectation Setting. Only fail Expectation Setting for missing or vague timelines on genuinely unresolved future issues — never for referencing dates that have already passed.

## EMPTY OR NON-CHATS / JUNK CHATS / CALLS THAT DID NOT CONNECT
If there is no substantive interaction (a customer message with no agent reply, an instant drop, a call that did not go through or connect, or Junk Chats with no query asked / no conversation):
- Set EVERY parameter score to "NA".
- Explain in the summary that the interaction did not take place or no query was raised.
- Do NOT score parameters as "No" or penalize the agent with 0 for non-interactions. All "NA" will evaluate to NIL (null).

## WINT WEALTH SPECIFIC POLICIES

### Documents via WhatsApp — NEVER acceptable
At Wint Wealth, all documents are ONLY shared via email. Agents must NEVER share documents over WhatsApp, even if the customer requests it.
- If customer asks for documents over WhatsApp and agent redirects them to email → this is **CORRECT behavior**. Do NOT penalize.
- Failing to redirect a WhatsApp document request to email would be a process violation.

### Form 15G/H and Form 121
Form 121 is the current TDS declaration form and has replaced Form 15G/H for new submissions.
- For many NBFCs, Wint Wealth supports the form submission process directly through the app.
- For some entities, the form must be submitted directly with that entity — NOT through Wint Wealth. When an agent tells a customer to submit the form directly with the entity, they are **CORRECT**. Do NOT penalize for this guidance.
- Never mark Technical as No simply because an agent directed a customer to submit a form directly with the entity rather than through the Wint app.

### Settlement Timelines — CORRECT timelines to use for evaluation
Agents quoting any of the following timelines are technically correct. Do NOT penalize:
- **First investment / first payment**: T+3 working days settlement.
- **All subsequent investments**: T+1 working days settlement.
- Working days = Monday to Friday only. Saturdays and Sundays do NOT count.
- An agent quoting T+3 for a first investment or T+1 for a regular investment is giving accurate information. Only mark Technical as No if they quote a materially different timeline that contradicts these rules.

### Internal Tool Checks (Finder / KB) — AI cannot verify
The AI scorer cannot see whether an agent checked Finder, order status, or account state before responding. Therefore:
- **Do NOT assume the agent skipped an internal check** — you have no evidence of this.
- Only mark Process as No if the agent's visible response directly contradicts what an internal check would have shown (e.g. agent says repayment not processed but transcript shows it was credited).
- The fact that a response could have been improved by a tool check is NOT sufficient to fail Process.

### Agent Not Narrating Backend Checks — NOT a Technical Error
Agents routinely perform backend verifications (e.g., confirming an active SIP, checking Finder, verifying order status) without explicitly telling the customer what they checked. This is correct behaviour — we do not expose all internal backend details to clients.
- **Do NOT mark Technical as No** simply because the agent did not say "I checked and confirmed X" before taking an action.
- If the process KB says "check if there is an active SIP" and the agent proceeds with cancellation without stating "I verified you have an active SIP" — this is NOT a technical error. The check is internal; the agent is not required to narrate it to the customer.
- Only mark Technical as No if the agent's actual response or action is provably wrong — e.g., they said the wrong fact, gave the wrong process step, or the outcome contradicts what a correct check would have produced.
- The absence of a verbal confirmation of a backend check is **never** sufficient on its own to fail Technical.

### Skip Instalment before Cancellation — Not mandatory
The KB mentions "Skip Instalment" as an option before cancellation, but this is **not a mandatory step**. An agent proceeding directly to cancellation without first offering "Skip Instalment" is NOT a process failure. Do not penalize.

### Calls — Only a violation if no prior customer request
- If the customer explicitly requested a call anywhere in the chat transcript → agent initiating a call is **CORRECT**. Do NOT penalize.
- If the customer never requested a call AND the agent calls without any business reason → this IS a process violation (score Process No and note it clearly).
- When you cannot determine whether a call happened at all, score Call as NA and add to \`uncertain_parameters\`.

### Private Notes, Internal Notes, Slack Links, and Internal References
Transcripts sometimes contain internal Slack links, internal tool URLs, internal notes / private notes (indicated as "Internal Note: [content]" or "Private Note: [content]"), or references to internal systems.
- These are internal working notes — they are NOT sent to the customer and are not part of customer-facing responses.
- TREAT THEM AS BACKGROUND CONTEXT ONLY: use them to understand internal actions, background checks, or workflow status.
- Do NOT include, judge, penalize, or evaluate the agent on any quality parameter based on private notes or internal notes. Evaluate only what was communicated directly to the customer.

### Screenshots and Media Shared in Chat
When images are provided alongside the transcript, they are screenshots or other media shared by the customer or agent during the chat.
- Use them as visual evidence — e.g. a screenshot of an error screen, an app UI state, or a document image.
- **Technical**: check whether the guidance the agent gave matches what the screenshot actually shows.
- **Contextual**: check whether a shared image or document is relevant to this customer's specific situation, not a generic screenshot.
- **Process**: a screenshot of a Finder check or internal tool is supporting evidence of a check — do not penalise for it.
- If an image is unreadable or unclear, ignore it and score based on the text transcript alone.
- Document excerpts in the MEDIA SHARED IN CHAT section are trimmed previews — use them for context only.

### Call Requests — Always score Call as NA, flag for QA
If the transcript contains any reference to a customer requesting a call, or a call that needs to happen:
- Score the **Call** parameter as **NA** (we cannot evaluate calls without the call transcript).
- Add it to \`uncertain_parameters\` with a specific question, e.g. "Customer requested a call — was a call conducted and handled correctly?"
- **Never score Call as No** when the only issue is that you cannot see the call interaction. We do not have call transcripts to evaluate.

## HANDLING UNCERTAINTY — CRITICAL RULES
When you are unsure how to score a parameter because the transcript is ambiguous, incomplete, or missing context:
1. **Do NOT assume the agent failed.** Benefit of the doubt always goes to the agent.
2. **Score the parameter as NA.** This counts as a pass in IQS.
3. **Add it to \`uncertain_parameters\`** with a precise, specific question that a human QA reviewer can answer to determine the correct score.
4. Score all parameters where you ARE confident as normal (Yes/No/NA as appropriate).
5. Only add to \`uncertain_parameters\` when your uncertainty would change the score from NA to No if resolved.

## PREVIOUS CONVERSATION REFERENCES
If the transcript contains any reference to a prior conversation — phrases such as "previous chat", "last time", "earlier ticket", "as discussed before", "previous text", "previous conversation", "last conversation", "referred earlier", "as mentioned earlier", "as per our last chat", "continuing from before" — note this clearly in your summary field. When such references are present:
- Be lenient on Technical and AllQuestions: the agent may be responding to context from a prior conversation that is NOT visible in this transcript. Do not penalise for information gaps that could be explained by that missing context.
- Do NOT score Technical as No simply because a claim cannot be fully verified from what is visible — the supporting context may have been in the prior chat.

## PARAMETER ISOLATION — CRITICAL
Each parameter is fully independent. Its reasoning must stay within its own criteria only.

RULES:
1. The reasoning for parameter X must ONLY discuss the criteria defined for parameter X — nothing else.
2. NEVER mention another parameter's name inside a reasoning field.
3. NEVER evaluate Opening, Grammar, Empathy, Process, Expectation, etc. inside the Technical reasoning — each has its own separate scoring field.
4. If you find yourself writing about one parameter while filling in another parameter's reasoning, stop and remove it.

EXAMPLES OF WHAT NOT TO DO:
- Technical reasoning: "The agent also had a good opening and introduced themselves well..." → WRONG. Opening belongs in Opening.reasoning only.
- Expectation reasoning: "All customer questions were also addressed clearly..." → WRONG. That belongs in AllQuestions.reasoning.
- Process reasoning: "The agent's grammar was poor throughout the conversation..." → WRONG. Grammar belongs in Grammar.reasoning only.
- Empathy reasoning: "The agent gave incorrect information about the timeline..." → WRONG. Factual errors belong in Technical.reasoning only.

Score each parameter as if you are filling in a completely separate evaluation form with no visibility into the others.

## THE 11 PARAMETERS (ordered by weight)

### 1. Technically / Legally Correct (20%) ⚠️ HIGHEST PRIORITY PARAMETER
Technical and legal correctness is the utmost crucial point for IQS evaluation. There must not be even a hint of incorrect information in any customer conversation. Every factual claim the agent makes must be verifiably accurate — no exceptions, no approximations.
Score based on whether the agent's information is factually correct per Wint Wealth KB and policy.
- **Yes**: Information is accurate for the customer's specific case.
- **No** — mark No if ANY of these failures are visible:
  - **Technically wrong**: Agent stated a wrong fact, wrong amount, wrong formula, wrong product rule, or wrong process step — a clear factual error (not just a communication gap).
  - **Dependent upon KB but contradicts it**: Agent gave guidance that directly contradicts what the Wint Wealth KB or Slack resolution says about the topic.
  - **SEBI / Regulatory violation**: Agent gave a personalised investment recommendation (e.g. "You should invest in X bond"), implied guaranteed returns, or provided investment advisory services — this is an automatic No regardless of KB. It is a standalone regulatory compliance failure under SEBI.
- **NA**: Only if the chat has zero substantive information exchange.
- **RULE**: Must be a CLEAR, VERIFIABLE factual error or regulatory violation. Do not fail for ambiguity.

### 2. All Questions Answered (10%)
- **Yes**: Every explicit customer question was answered or deliberately deferred with a reason.
- **No** — mark No if ANY of these are visible:
  - **AQ – Missed question with Bot**: A question the customer raised (even during bot phase prior to transfer) was never picked up, acknowledged, or answered by the agent.
  - **AQ – Multiple queries**: Customer asked several questions in one message and the agent answered only some of them, leaving one or more unanswered.
- **NA**: Very rare.

### 3. Expectation Setting (10%)
Score whether the agent set a clear, specific expectation about timeline, next steps, or resolution path.
- **Yes**: Agent gave a specific timeline, commitment, or next step (e.g. "credited within 7 working days", "our team will contact you by 3rd Feb"). "Please allow me/them some time" or informing the customer about a team transfer or escalation ("at the earliest") counts.
- **No** — mark No if ANY of these are visible:
  - **Exp – TAT missing**: Customer asked "how long?", "when?", or showed impatience about timing — and got no specific timeline or even a ballpark.
  - **Exp – No education**: Agent resolved an issue but did not explain what happened or what the customer should expect next — leaving the customer without context on the outcome.
  - **Exp – Others**: Agent made a promise or commitment but gave no timeline or follow-up structure around it.
- **NA**: Very rare.
- **IMPORTANT**: Distinguish from Technical. Expectation Setting is about whether a timeline/next-step was communicated — NOT about whether the timeline given was correct (that is Technical).

### 4. Contextual & Personal (10%)
- **Yes**: Response includes customer-specific details — their bond name, their specific amounts, their exact dates, their account details.
- **No** — mark No if ANY of these are visible:
  - **CP – Irrelevant answer**: Agent's response does not address the customer's actual situation or problem.
  - **CP – Copy-paste answer**: Generic template answer that could apply to any customer. Test: could this exact answer be copy-pasted to a completely different customer's chat? If yes → No.
  - **CP – Ignoring bot-transferred query**: Customer stated their query during the bot phase, and the human agent ignored that context or asked the customer to repeat what was already stated.
  - **CP – Missing info for easy understanding**: Agent did not share links, screenshots, or docs that were clearly needed for the customer to understand or act — leaving the response incomplete.
- **NA**: Very rare.

### 5. Follow-up & Closing (10%)
- **Yes**: Closing is personalised to the outcome — resolved / ticket raised / on wait — with a warm sign-off and relevant next step.
- **No** — mark No if ANY of these are visible:
  - **PF – Closing sentence missing or generic**: Closing does not reflect the actual outcome (resolved / ticket raised / custom). Generic template with no personalisation.
  - **PF – Chat on wait not handled**: Chat needed to go on wait (pending resolution, raised case) but agent did not put it on wait or explain the status.
  - **PF – Chat holding message not personalised**: Agent put the chat on wait but used a completely generic waiting message with no reference to the customer's specific query.
  - **PF – Follow-up not personalised**: The follow-up message has no connection to the main conversation — it reads as a detached template.
- **NA**: Very rare.

### 6. Sentences / Simple to Understand (10%)
Score whether the agent's messages are clear, readable, and free from comprehension barriers.
- **Yes**: Messages are clear, appropriately structured, and easy to read on mobile.
- **No** — mark No if ANY of these are visible:
  - **ST – Technical jargon without explanation**: Agent used internal jargon (EOD, Flexi-tenure, Upswing, T+1, etc.) without providing the full form or a plain-language explanation.
  - **ST – Long, unbroken answers**: Wall-of-text messages — no line breaks, no paragraph splits, links buried inside text instead of sent as a separate message. Unreadable on mobile.
  - **ST – Structure/Framing**: One-liner responses to complex queries where structure was clearly needed; or message fragmented in a confusing way.
- **NA**: Very rare. Bar is HIGH.

### 7. Process-wise (5%)
Score whether the agent followed Wint Wealth's operational process correctly.
- **Yes**: Agent followed correct workflow. Assume agent did internal checks (Finder, last chat, order status) unless their visible output directly contradicts what such a check would have shown.
- **No** — mark No ONLY if the failure is VISIBLE in the transcript:
  - **PW – Wrong process explained**: Agent described the wrong process step to the customer in a way that is clearly incorrect per Wint policy.
  - **PW – Did not raise ticket / escalate when required**: Case clearly needed a ticket or Slack escalation (e.g. funds issue, bug, repayment error) — agent closed the chat without raising one.
  - **PW – Delayed response (4–5+ hours)**: A gap of 4–5 hours or more with zero communication is visible in the timestamps, with no put-on-wait or explanation.
  - **PW – Processes not followed**: Any other clear, provable process deviation visible in the transcript.
  - **PW – Did not check Finder / last chat**: Only fail this if the agent's answer is WRONG in a way that would have been corrected by checking Finder or the previous chat. You cannot fail Process simply because a check might have been skipped — the wrong output must be visible.
- **NA**: Very rare.
- **CRITICAL**: Never assume a Finder check was skipped unless the agent's response directly contradicts what that check would have shown.

### 8. First Response & Opening (5%)
- **Yes**: Greeting is a SEPARATE message containing: (1) Hi/Hello, (2) agent name + Wint Wealth, (3) offer to help OR acknowledgment of the specific query. On bot-transferred chats, the greeting MUST acknowledge the customer's query already stated in the bot phase.
- **No**: Greeting merged with the answer. OR purely generic opener (e.g. asking "How can I help you?" when the query was already stated to the bot). OR failing to acknowledge the customer's query already stated during the bot phase before transfer. OR no greeting at all. OR agent name missing.
- **NA**: Very rare. Never mark NA for Opening on a bot-transferred chat when an agent joins.

### 9. Call (when required) (5%)
Score whether the agent correctly decided on a call — made one when needed, and didn't make one when not needed.
- **Yes**: No call was required and none was made. OR a call was required, offered, and handled.
- **No** — mark No if ANY of these are visible AND no call was initiated:
  - **Call – User requested a call** but the agent did not arrange one and just closed the chat.
  - **Call – Complicated or urgent query** (funds stuck, known bug, repayment issue, panic/irate user, heavy jargon) but agent did not offer/arrange a call.
  - **Call – User clearly not understanding** (repeated confusion, misunderstanding jargons or the explanation) but agent did not offer to call and clarify.
  - **Call – Day-long / raised-case query**: Agent raised a case / logged off but did not offer a follow-up call before closing, even though the situation clearly warranted it.
  - Also **No** if agent initiated a call with NO customer request and NO business reason.
- **NA**: If a call was requested or arranged but you cannot verify how it went (no call transcript) → score NA and add to \`uncertain_parameters\`.
- **IMPORTANT**: If you cannot tell whether a call happened or not from the chat → NA, never No.

### 10. Grammar / Structure (5%)
- **Yes**: Messages are grammatically correct, structurally complete, and appropriately formatted for a WhatsApp conversation.
- **No** — mark No ONLY if these are clearly visible in the agent's words:
  - **SG – Spelling errors**: Clear misspellings that affect readability or professionalism (e.g. "recievd", "plese").
  - **SG – Typing errors**: Wrong words, autocorrect errors, missing words that change meaning (e.g. "I will you the details" instead of "I will send you the details").
  - **SG – Grammar errors**: Missing conjunctions, run-on sentences, incomplete sentences, subject-verb disagreement.
  - **SG – Wall of text**: Agent sent a single unbroken block of text containing multiple distinct pieces of information, all crammed into one continuous paragraph with no line breaks, numbered points, or structural separators. This makes information unreadable on a mobile screen. Mark No only when the agent consistently sends dense walls of text — a single long-but-structured message (e.g. numbered steps with line breaks) is NOT a wall of text and must NOT be penalised.
- **NEVER flag these — they are formatting choices or platform artifacts, not errors:**
  - Numbered or bulleted lists with line breaks — this is GOOD formatting, not a wall of text.
  - Each line break (newline) in an agent message represents a separate WhatsApp message or a deliberate paragraph break. Evaluate punctuation and grammar per individual line — NEVER treat the full response as one continuous sentence. A full stop at the end of line 1 and the start of a new sentence on line 2 is correct — do not flag missing punctuation between lines.
  - Extra spaces or missing spaces between words (e.g. "thankyou", "thank  you") — WhatsApp/Robylon renders spacing differently.
  - ALL-CAPS words used for emphasis — common in customer service chat.
- **NA**: Very rare. Minor typos that don't affect meaning are acceptable.

### 11. Empathy (10%)
Score whether the agent acknowledged the customer's emotional state and communicated with warmth.
- **Yes**: Chat contains at least ONE genuine empathy acknowledgment — e.g. "I understand your concern", "I can see why this is frustrating", "I apologise for the inconvenience" — that addresses the customer's situation.
- **No** — mark No if ANY of these are visible:
  - **EP – Did not acknowledge the query**: Agent gave a purely transactional reply or generic greeting with no personalisation or acknowledgment of the customer's situation/query (especially queries stated in the bot phase prior to transfer).
  - **EP – Robotic / too formal**: Excessive use of "sir/ma'am" at the start or end of every statement; tone feels scripted and impersonal throughout.
  - **EP – Hollow fillers overused**: Phrases like "Please", "I can understand your concern", "I can empathise with you", "Please do not worry" used repeatedly with no real personalisation — filler without feeling.
  - **EP – Requesting user without proper tone**: Asking the user to retry, re-send, or take an action without a polite, properly framed request.
  - **EP – Did not assess user's understanding**: Customer was clearly confused or emotionally distressed and the agent did not assess whether the customer understood, did not offer to rephrase, and did not consider offering a call.
- **NA**: Very rare. Bar is LOW — even one genuine, personalised empathy line is enough to pass.

## IQS CALCULATION
IQS = Sum of (weight × pass) for all parameters, normalized to 100.
Weights: Technical=20%, AllQuestions=10%, Expectation=10%, Contextual=10%, FollowUp=10%, Sentences=10%, Process=5%, Opening=5%, Call=5%, Grammar=5%, Empathy=10%

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
    "Grammar": "Yes|No|NA",
    "Empathy": "Yes|No|NA"
  },
  "reasoning": {
    "Technical": "brief reason — if KB was consulted, cite the document and section",
    "AllQuestions": "brief reason",
    "Expectation": "brief reason",
    "Contextual": "brief reason",
    "FollowUp": "brief reason",
    "Sentences": "brief reason",
    "Process": "brief reason",
    "Opening": "brief reason",
    "Call": "brief reason",
    "Grammar": "brief reason",
    "Empathy": "brief reason"
  },
  "kbCitation": "Document Name > Section Heading (null if KB was not relevant)",
  "iqs_score": 85,
  "summary": "1-2 sentence overall assessment",
  "agentName": "First name of the support agent extracted from the transcript, or empty string if not identifiable",
  "uncertain_parameters": [
    { "parameter": "ParameterName", "question": "Specific question for QA to resolve — include exactly what information is needed to score this correctly" }
  ]
}
\`\`\`

Notes on \`uncertain_parameters\`:
- Include ONLY parameters where uncertainty would change the score from NA to No if the QA provides context.
- If there are no uncertain parameters, set \`uncertain_parameters\` to an empty array: \`[]\`.
- Each question must be specific enough that a human QA reviewer who has call recordings and system access can answer it definitively.

CRITICAL: Output ONLY the JSON. No other text before or after. For kbCitation, use the exact document name and section heading from the KB context provided (e.g. "Wint Fixed Deposits > Lock-in Period"). Set to null if no KB lookup was needed for the Technical parameter.`;

/**
 * Trim a transcript before sending to the LLM to reduce token cost.
 * - Removes blank lines
 * - Truncates individual lines longer than 400 chars (bot FAQ dumps, copy-pastes)
 * - Removes consecutive duplicate lines (agent accidentally sends same message twice)
 * - Hard-caps total at maxChars with head+tail preservation so Opening and Closing
 *   context are both visible to the scorer
 */
export function trimTranscript(transcript: string, maxChars = 5000): string {
  const lines = transcript.split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0)
    .map(l => l.length > 400 ? l.slice(0, 397) + '…' : l);

  // Remove consecutive identical lines
  const deduped: string[] = [];
  for (const line of lines) {
    if (deduped.length === 0 || deduped[deduped.length - 1] !== line) {
      deduped.push(line);
    }
  }

  const joined = deduped.join('\n');
  if (joined.length <= maxChars) return joined;

  // Keep 55% head (Opening matters) + 45% tail (Closing/FollowUp matter)
  const headChars = Math.round(maxChars * 0.55);
  const tailChars = maxChars - headChars - 35;
  const headRaw = joined.slice(0, headChars);
  const tailRaw = joined.slice(joined.length - tailChars);

  // Cut at line boundaries where possible
  const headEnd = headRaw.lastIndexOf('\n');
  const tailStart = tailRaw.indexOf('\n');
  const head = headEnd > 0 ? headRaw.slice(0, headEnd) : headRaw;
  const tail = tailStart > 0 ? tailRaw.slice(tailStart + 1) : tailRaw;

  return `${head}\n[… transcript trimmed …]\n${tail}`;
}

export function buildScoringPrompt(
  transcript: string,
  tags = '',
  chatId = '',
  slackThread = '',
  kbContext = '',
  subDisposition = '',
  conversationType?: string,
  hasCall = false
): string {
  const today = new Date().toISOString().split('T')[0];

  let scenarioLine = '';
  if (conversationType === 'bot') {
    scenarioLine = 'SCENARIO: Type 1, bot-only chat. The bot handled the whole chat and closed it with no human agent. Apply the BOT rubric to the bot.';
  } else if (hasCall) {
    scenarioLine = 'SCENARIO: Type 3, bot then human chat then voice call. A human agent took over in chat and a voice call also happened. Apply the HUMAN rubric to the human agent\'s chat turns, PostCallRecap applies, and do not score the call itself.';
  } else {
    scenarioLine = 'SCENARIO: Type 2, bot then human chat. The bot could not resolve it and escalated to a human agent, who took over in chat. No voice call took place, so PostCallRecap is NA. Apply the HUMAN rubric and score only the human agent\'s turns from handover onward.';
  }

  return `Score the following interaction.
${scenarioLine}
Today (scoring date): ${today}

## CHAT METADATA
- Chat ID: ${chatId}
- Disposition (L1): ${tags || 'none'}
- Sub-disposition (L2): ${subDisposition || 'none'}
${kbContext ? `
## WINT KNOWLEDGE BASE REFERENCE
Use these KB excerpts to judge Accuracy.
${kbContext}
` : ''}
## TRANSCRIPT
${transcript}
${slackThread ? `
## SLACK THREAD (for context)
${slackThread}
` : ''}
Output ONLY the JSON.`;
}

// ── Parse LLM response ───────────────────────────────────────────────────────
/** Sanitize a JSON string: fix unescaped newlines/tabs/quotes inside string values. */
export function sanitizeJson(s: string): string {
  // Replace literal newlines/tabs inside JSON string values (between quotes) with escaped versions
  return s.replace(/("(?:[^"\\]|\\.)*")/g, (match) =>
    match
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t'),
  );
}

/** Try multiple strategies to parse LLM JSON response. */
function repairTruncatedJson(cleaned: string): any | null {
  const start = cleaned.indexOf('{');
  if (start < 0) return null;
  const s = cleaned.slice(start);

  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  let lastComplete = -1;
  let stackAtLastComplete: string[] = [];

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; continue; }
    if (c === '{' || c === '[') {
      stack.push(c);
    } else if (c === '}' || c === ']') {
      if (stack.length === 0) return null;
      stack.pop();
      if (stack.length > 0 && stack.length <= 3) {
        lastComplete = i + 1;
        stackAtLastComplete = stack.slice();
      }
    }
  }

  if (lastComplete < 0) return null;
  const closers = stackAtLastComplete
    .slice()
    .reverse()
    .map(b => (b === '{' ? '}' : ']'))
    .join('');
  try {
    return JSON.parse(s.slice(0, lastComplete) + closers);
  } catch {
    return null;
  }
}

export function robustJsonParse(raw: string): any {
  if (!raw?.trim()) return null;
  let s = raw.trim();

  // 1. Extract from markdown code block if present
  const block = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (block) s = block[1].trim();

  // 2. Try direct parse
  try { return JSON.parse(s); } catch {}

  // 3. Try to extract outermost object { }
  const oa = s.indexOf('{'), ob = s.lastIndexOf('}');
  if (oa >= 0 && ob > oa) {
    const candidate = s.slice(oa, ob + 1);
    try { return JSON.parse(candidate); } catch {}
    try { return JSON.parse(sanitizeJson(candidate)); } catch {}
    try { return JSON.parse(candidate.replace(/,\s*([}\]])/g, '$1')); } catch {}
  }

  // 4. Try to extract outermost array [ ]
  const aa = s.indexOf('['), ab = s.lastIndexOf(']');
  if (aa >= 0 && ab > aa) {
    const candidate = s.slice(aa, ab + 1);
    try { return JSON.parse(candidate); } catch {}
    try { return JSON.parse(candidate.replace(/,\s*([}\]])/g, '$1')); } catch {}
  }

  // Try to repair truncated JSON
  const repaired = repairTruncatedJson(s);
  if (repaired !== null) {
    console.warn('[Gemini] JSON output was truncated — salvaged the complete portion');
    return repaired;
  }

  // 5. Last resort: extract scores block with regex so we at least get pass/fail
  const scoresMatch = s.match(/"scores"\s*:\s*(\{[^}]+\})/);
  if (scoresMatch) {
    try {
      const scores = JSON.parse(scoresMatch[1]);
      const summaryMatch = s.match(/"summary"\s*:\s*"([^"]+)"/);
      return { scores, summary: summaryMatch?.[1] || '', reasoning: {}, agentName: '' };
    } catch {}
  }

  throw new Error(`Cannot parse response: ${s.slice(0, 300)}`);
}

export function parseScoringResponse(raw: string, chatId: string, conversationType?: string): Omit<IQSScoreEntry, 'id' | 'scoredAt' | 'agentName' | 'provider' | 'model' | 'scoredBy'> & { extractedAgentName?: string } {
  const data = robustJsonParse(raw) || {};
  const scores: Record<string, ParamScore> = {};
  const reasoning: Record<string, string> = {};

  const isBot = conversationType === 'bot';

  if (data.parameters) {
    for (const [key, val] of Object.entries(data.parameters) as [string, any][]) {
      if (val) {
        let scoreStr: ParamScore = 'NA';
        if (val.score === true || val.score === 1 || val.score === 'Yes') {
          scoreStr = 'Yes';
        } else if (val.score === false || val.score === 0 || val.score === 'No') {
          scoreStr = 'No';
        } else if (val.score === 0.5 || val.score === 'Half') {
          scoreStr = 'Half';
        }
        scores[key] = scoreStr;
        reasoning[key] = val.comment || val.reasoning || '';
      }
    }
  } else {
    // Fallback to old format
    if (data.scores) {
      for (const [k, v] of Object.entries(data.scores)) {
        scores[k] = v === 'Yes' ? 'Yes' : v === 'No' ? 'No' : v === 'Half' ? 'Half' : 'NA';
      }
    }
    if (data.reasoning) {
      for (const [k, v] of Object.entries(data.reasoning)) {
        reasoning[k] = String(v);
      }
    }
  }

  // Fallback for human rubric 'Process' under bot (for backward compatibility / safety)
  if (isBot && !scores['Process'] && !scores['CorrectEscalation']) {
    scores['Process'] = 'Yes';
    reasoning['Process'] = 'Bot-handled chat — Myra follows process by definition.';
  }

  // Legacy manual-scoring path: IQS_SYSTEM_PROMPT emits v3 parameter names for the
  // human rubric, so score against V3_WEIGHTS (isV4=false). Bot uses BOT_WEIGHTS
  // regardless of the flag. Without this, v3 keys miss the v4 WEIGHTS set entirely.
  const iqs = calculateIQS(scores, isBot, false); // always recalculate

  // Extract uncertain_parameters — validate structure
  let uncertainParameters: Array<{ parameter: string; question: string }> | undefined;
  if (Array.isArray(data.uncertain_parameters) && data.uncertain_parameters.length > 0) {
    uncertainParameters = data.uncertain_parameters
      .filter((u: any) => u && typeof u.parameter === 'string' && typeof u.question === 'string')
      .map((u: any) => ({ parameter: u.parameter, question: u.question }));
    if ((uncertainParameters as any[]).length === 0) uncertainParameters = undefined;
  }

  const kbCitation = typeof data.kbCitation === 'string' && data.kbCitation.toLowerCase() !== 'null'
    ? data.kbCitation
    : null;

  const breaches = (data.compliance && data.compliance.breaches) || data.breaches || [];
  const complianceFlag = !!(data.compliance && (data.compliance.breach || (data.compliance.breaches || []).length > 0)) || !!data.compliance_flag || breaches.length > 0;

  return {
    chatId,
    scores,
    reasoning,
    iqs,
    summary: data.summary || '',
    extractedAgentName: (data.agentName || '').trim(),
    conversationType: conversationType as 'bot' | 'agent' | 'hybrid' | undefined,
    breaches,
    complianceFlag,
    ...(uncertainParameters && { uncertainParameters }),
    ...(kbCitation && { kbCitation }),
  };
}

// ── Shared UI Helpers ──────────────────────────────────────────────────────────

export function fmtDuration(secs: number | undefined | null): string {
  if (secs == null || secs < 0) return '—';
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60), s = secs % 60;
  if (secs < 3600) return s > 0 ? `${m}m ${s}s` : `${m}m`;
  const h = Math.floor(secs / 3600), rm = Math.floor((secs % 3600) / 60);
  return rm > 0 ? `${h}h ${rm}m` : `${h}h`;
}

export function iqsTheme(iqs: number) {
  if (iqs >= 90) return { text: '#15803d', bg: '#dcfce7', bar: '#22c55e', label: 'Excellent' };
  if (iqs >= 80) return { text: '#b45309', bg: '#fef3c7', bar: '#f59e0b', label: 'Good' };
  if (iqs >= 70) return { text: '#c2410c', bg: '#ffedd5', bar: '#f97316', label: 'Average' };
  return { text: '#b91c1c', bg: '#fee2e2', bar: '#ef4444', label: 'At Risk' };
}


