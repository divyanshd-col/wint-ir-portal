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
};

export const PASCAL_TO_DB: Record<string, string> = Object.fromEntries(
  Object.entries(DB_KEY_TO_LEGACY).map(([d, p]) => [p, d])
);
