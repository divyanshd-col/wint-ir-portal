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

  // Bot-only parameter keys
  issue_resolution:   'IssueResolution',
  accuracy:           'Accuracy',
  correct_escalation: 'CorrectEscalation',
  no_repetition:      'NoRepetition',
  personalization:    'Personalization',
  expectation_setting:'ExpectationSetting',
  clarity:            'Clarity',
};

export const PASCAL_TO_DB: Record<string, string> = Object.fromEntries(
  Object.entries(DB_KEY_TO_LEGACY).map(([d, p]) => [p, d])
);
