/**
 * scripts/email-parameters.test.ts
 *
 * Verifies the 7 email quality parameters, weights, scoring calculations, and prompt generation.
 */

import {
  DEFAULT_EMAIL_PARAMETERS,
  calculateEmailIQS,
  normalizeParamScoreValue,
  buildEmailEvaluationPrompt,
} from '../lib/email/context-builder';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ Assertion Failed: ${msg}`);
    process.exit(1);
  } else {
    console.log(`✓ ${msg}`);
  }
}

console.log('=== Running Email Evaluation Parameters Tests ===\n');

// 1. Parameter count and weight verification
assert(DEFAULT_EMAIL_PARAMETERS.length === 7, `Expected 7 parameters, got ${DEFAULT_EMAIL_PARAMETERS.length}`);

const totalWeight = DEFAULT_EMAIL_PARAMETERS.reduce((sum, p) => sum + p.defaultWeight, 0);
assert(totalWeight === 100, `Expected total weight = 100%, got ${totalWeight}%`);

const expectedKeys = [
  'issue_resolution',
  'accuracy',
  'expectation_setting',
  'personalisation',
  'empathy',
  'sentences_simple_to_understand',
  'opening_and_closing',
];

expectedKeys.forEach(k => {
  const found = DEFAULT_EMAIL_PARAMETERS.find(p => p.key === k);
  assert(!!found, `Parameter '${k}' must exist in DEFAULT_EMAIL_PARAMETERS`);
  assert(found?.allowNA === true, `Parameter '${k}' must have allowNA=true for alignment`);
});

// 2. Normalization verification
assert(normalizeParamScoreValue('yes') === 'yes', 'normalize yes');
assert(normalizeParamScoreValue('pass') === 'yes', 'normalize pass -> yes');
assert(normalizeParamScoreValue('partial') === 'half', 'normalize partial -> half');
assert(normalizeParamScoreValue('half') === 'half', 'normalize half');
assert(normalizeParamScoreValue('no') === 'no', 'normalize no');
assert(normalizeParamScoreValue('fail') === 'no', 'normalize fail -> no');
assert(normalizeParamScoreValue('na') === 'na', 'normalize na');
assert(normalizeParamScoreValue('n/a') === 'na', 'normalize n/a -> na');

// 3. IQS Calculation Tests
const allYes: Record<string, any> = {
  issue_resolution: 'yes',
  accuracy: 'yes',
  expectation_setting: 'yes',
  personalisation: 'yes',
  empathy: 'yes',
  sentences_simple_to_understand: 'yes',
  opening_and_closing: 'yes',
};
assert(calculateEmailIQS(allYes) === 100, `All Yes should produce IQS 100, got ${calculateEmailIQS(allYes)}`);

const allHalf: Record<string, any> = {
  issue_resolution: 'half',
  accuracy: 'half',
  expectation_setting: 'half',
  personalisation: 'half',
  empathy: 'half',
  sentences_simple_to_understand: 'half',
  opening_and_closing: 'half',
};
assert(calculateEmailIQS(allHalf) === 50, `All Half should produce IQS 50, got ${calculateEmailIQS(allHalf)}`);

const allNo: Record<string, any> = {
  issue_resolution: 'no',
  accuracy: 'no',
  expectation_setting: 'no',
  personalisation: 'no',
  empathy: 'no',
  sentences_simple_to_understand: 'no',
  opening_and_closing: 'no',
};
assert(calculateEmailIQS(allNo) === 0, `All No should produce IQS 0, got ${calculateEmailIQS(allNo)}`);

// Test NA exclusion from numerator and denominator
// When empathy (weight 10) is NA and all others are 'yes', score should remain 100!
const withNA: Record<string, any> = {
  issue_resolution: 'yes',
  accuracy: 'yes',
  expectation_setting: 'yes',
  personalisation: 'yes',
  empathy: 'na',
  sentences_simple_to_understand: 'yes',
  opening_and_closing: 'yes',
};
assert(calculateEmailIQS(withNA) === 100, `Score with NA empathy should still be 100, got ${calculateEmailIQS(withNA)}`);

// Test alias resolution (e.g. 'sentences' for 'sentences_simple_to_understand', 'personalization' for 'personalisation')
const withAliases: Record<string, any> = {
  issue_resolution: 'yes',
  accuracy: 'yes',
  expectation_setting: 'yes',
  personalization: 'yes',
  empathy: 'yes',
  sentences: 'yes',
  opening_and_closing: 'yes',
};
assert(calculateEmailIQS(withAliases) === 100, `Score with aliases should be 100, got ${calculateEmailIQS(withAliases)}`);

// 4. Prompt Generation Verification
const prompt = buildEmailEvaluationPrompt({
  ticketId: 'T101',
  messageId: 'M202',
  agentName: 'Aman Sharma',
  sentAt: '2026-10-13T10:00:00Z',
  customerMessage: 'When will I receive my interest payout for October?',
  agentReplyText: 'Hi, your interest has been initiated today and will reflect in your bank account ending 1234 within 24 working hours.',
  historyCount: 1,
});

assert(prompt.includes('1. Issue resolution'), 'Prompt must contain Issue resolution');
assert(prompt.includes('2. Accuracy'), 'Prompt must contain Accuracy');
assert(prompt.includes('3. Expectation setting'), 'Prompt must contain Expectation setting');
assert(prompt.includes('4. Personalisation'), 'Prompt must contain Personalisation');
assert(prompt.includes('5. Empathy'), 'Prompt must contain Empathy');
assert(prompt.includes('6. Sentences (Simple to understand)'), 'Prompt must contain Sentences (Simple to understand)');
assert(prompt.includes('7. Opening and closing message'), 'Prompt must contain Opening and closing message');
assert(prompt.includes('CRITICAL COMPLIANCE TRIPWIRES'), 'Prompt must contain compliance tripwires');

console.log('\n🎉 All 7 Email Evaluation Parameters verified successfully!');
