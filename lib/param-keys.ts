export const DB_KEY_TO_LEGACY: Record<string, string> = {
  technical:    'Technical',
  all_questions:'AllQuestions',
  expectation:  'Expectation',
  contextual:   'Contextual',
  follow_up:    'FollowUp',
  sentences:    'Sentences',
  process:      'Process',
  opening:      'Opening',
  call:         'Call',
  tags:         'Tags',
  grammar:      'Grammar',
  empathy:      'Empathy',
  dissatisfactionhandling: 'DissatisfactionHandling',

  // Bot-only parameter keys
  issue_resolution:   'IssueResolution',
  accuracy:           'Accuracy',
  correct_escalation: 'CorrectEscalation',
  no_repetition:      'NoRepetition',
  personalization:    'Personalization',
  expectation_setting:'ExpectationSetting',
  clarity:            'Clarity',

  // v4 human-leg parameter keys with no v3 equivalent — canonical going forward
  expectation_follow_through: 'ExpectationFollowThrough',
  escalation_decision:        'EscalationDecision',
  readability:                'Readability',
  greeting_handover:          'GreetingHandover',
  post_call_recap:            'PostCallRecap',
};

export const PASCAL_TO_DB: Record<string, string> = Object.fromEntries(
  Object.entries(DB_KEY_TO_LEGACY).map(([d, p]) => [p, d])
);

// ── Backward-compatible parameter reader ────────────────────────────────────
/**
 * Historical dialects a chat's stored parameters may be keyed under, oldest
 * first is NOT the priority order here — priority is newest/canonical first,
 * so a freshly re-scored or re-reviewed chat always wins over stale data:
 *   1. canonical db-key (PASCAL_TO_DB above) — what every new write uses.
 *   2. old no-underscore v4 fallback key — written by the scoring engine
 *      before PASCAL_TO_DB had entries for these 5 params.
 *   3. old v3-alias key — written by the frontend's retired CAT1/CAT2 shim,
 *      which routed v4 scores through v3-named slots for display/dispute.
 *   4. raw Pascal key, as a last resort.
 * This is purely additive: nothing already stored in the DB is rewritten,
 * this function just knows how to find it wherever it landed.
 */
export const LEGACY_V4_FALLBACK_KEY: Record<string, string> = {
  ExpectationFollowThrough: 'expectationfollowthrough',
  EscalationDecision:       'escalationdecision',
  Readability:              'readability',
  GreetingHandover:         'greetinghandover',
  PostCallRecap:            'postcallrecap',
};

/**
 * DB_KEY_TO_LEGACY plus the old no-underscore v4 fallback keys, for code that
 * needs to map an arbitrary stored key back to its canonical Pascal name
 * (rather than looking up one known Pascal name's value, which resolveParamCell
 * does). Without this, an old-dialect key like 'expectationfollowthrough'
 * naively title-cased becomes 'Expectationfollowthrough', not 'ExpectationFollowThrough'.
 */
export const ALL_DB_KEY_TO_PASCAL: Record<string, string> = {
  ...DB_KEY_TO_LEGACY,
  expectationfollowthrough: 'ExpectationFollowThrough',
  escalationdecision:       'EscalationDecision',
  greetinghandover:         'GreetingHandover',
  postcallrecap:            'PostCallRecap',
};

export const LEGACY_V3_ALIAS_KEY: Record<string, string> = {
  Accuracy:                 'technical',
  IssueResolution:          'all_questions',
  ExpectationFollowThrough: 'expectation',
  Personalization:          'contextual',
  Readability:              'sentences',
  GreetingHandover:         'opening',
  EscalationDecision:       'call',
  PostCallRecap:            'follow_up',
};

export interface RawParamCell {
  score?: any;
  reasoning?: string;
  comment?: string;
  unsure?: boolean;
}

/** Reads a parameter's stored value under any historical key spelling — see dialect notes above. */
export function resolveParamCell(safeParams: Record<string, any> | null | undefined, pascalKey: string): RawParamCell {
  if (!safeParams) return {};
  const canonicalKey = PASCAL_TO_DB[pascalKey];
  const fallbackKey  = LEGACY_V4_FALLBACK_KEY[pascalKey];
  const aliasKey     = LEGACY_V3_ALIAS_KEY[pascalKey];
  return safeParams[pascalKey]
    ?? (canonicalKey ? safeParams[canonicalKey] : undefined)
    ?? (fallbackKey ? safeParams[fallbackKey] : undefined)
    ?? (aliasKey ? safeParams[aliasKey] : undefined)
    ?? {};
}
