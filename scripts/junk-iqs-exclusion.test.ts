import test from 'node:test';
import assert from 'node:assert/strict';

import { hasJunkTag, isJunkDisposition, calculateIQS, computeIqsFromRawParams } from '../lib/quality';
import { calculateCallIQS } from '../lib/call-quality';
import { computeCallIQS } from '../lib/scoring/call-pipeline';
import { calculateEmailIQS } from '../lib/email/context-builder';

test('hasJunkTag and isJunkDisposition identify junk in various formats', () => {
  // Positive matches (strings)
  assert.equal(isJunkDisposition('Junk'), true);
  assert.equal(isJunkDisposition('Junk Chats'), true);
  assert.equal(isJunkDisposition('junk'), true);
  assert.equal(isJunkDisposition('JUNK'), true);
  assert.equal(isJunkDisposition('junk calls'), true);
  assert.equal(isJunkDisposition('Junk Emails'), true);
  assert.equal(isJunkDisposition('  Junk  '), true);
  assert.equal(isJunkDisposition('Spam / Junk Query'), true);

  // JSON string inputs
  assert.equal(hasJunkTag('{"disposition": "junk"}'), true);
  assert.equal(hasJunkTag('["tag1", "junk"]'), true);
  assert.equal(hasJunkTag('{"disposition": "Investment"}'), false);

  // Object inputs with various field names
  assert.equal(hasJunkTag({ disposition: 'junk' }), true);
  assert.equal(hasJunkTag({ sub_disposition: 'junk' }), true);
  assert.equal(hasJunkTag({ subDisposition: 'junk' }), true);
  assert.equal(hasJunkTag({ call_disposition: 'junk' }), true);
  assert.equal(hasJunkTag({ call_sub_disposition: 'junk' }), true);
  assert.equal(hasJunkTag({ tag: 'junk' }), true);
  assert.equal(hasJunkTag({ tags: ['junk'] }), true);
  assert.equal(hasJunkTag({ tags: ['legit', 'junk'] }), true);
  assert.equal(hasJunkTag({ intent_l1: 'junk' }), true);
  assert.equal(hasJunkTag({ intent_l2: 'junk' }), true);
  assert.equal(hasJunkTag({ category: 'junk' }), true);
  assert.equal(hasJunkTag({ custom_field: 'junk_item' }), true);

  // Array inputs
  assert.equal(hasJunkTag(['junk']), true);
  assert.equal(hasJunkTag(['legit', 'junk']), true);
  assert.equal(hasJunkTag(['legit', { disposition: 'junk' }]), true);

  // Sub-disposition checks
  assert.equal(isJunkDisposition('General Enquiry', 'Junk Call'), true);
  assert.equal(isJunkDisposition(null, 'Junk Call'), true);
  assert.equal(isJunkDisposition(undefined, 'Junk Call'), true);

  // Negative matches (legitimate interactions, not junk)
  assert.equal(isJunkDisposition('General Enquiry'), false);
  assert.equal(isJunkDisposition('Investment Query'), false);
  assert.equal(isJunkDisposition('KYC Verification'), false);
  assert.equal(isJunkDisposition('Repayment Issue'), false);
  assert.equal(isJunkDisposition(''), false);
  assert.equal(isJunkDisposition(null), false);
  assert.equal(isJunkDisposition(undefined), false);
  assert.equal(hasJunkTag({ disposition: 'Investment', sub_disposition: 'SIP' }), false);
  assert.equal(hasJunkTag(['tag1', 'tag2']), false);
});

test('calculateIQS hardcodes exclusion of junk chats from scoring (NIL IQS)', () => {
  const perfectScores = {
    IssueResolution: 'Yes' as const,
    Accuracy: 'Yes' as const,
    ExpectationFollowThrough: 'Yes' as const,
    DissatisfactionHandling: 'Yes' as const,
    Personalization: 'Yes' as const,
    Empathy: 'Yes' as const,
    EscalationDecision: 'Yes' as const,
    Readability: 'Yes' as const,
    GreetingHandover: 'Yes' as const,
    PostCallRecap: 'Yes' as const,
  };

  // Normal chat gets valid score
  const normalScore = calculateIQS(perfectScores, false, true, 'Investment Query', 'Bonds');
  assert.equal(normalScore, 100);

  // Chat with junk disposition returns null
  assert.equal(calculateIQS(perfectScores, false, true, 'Junk'), null);
  assert.equal(calculateIQS(perfectScores, false, true, 'junk'), null);
  assert.equal(calculateIQS(perfectScores, false, true, 'Junk Chats'), null);

  // Chat with junk sub-disposition returns null
  assert.equal(calculateIQS(perfectScores, false, true, 'General Query', 'Junk'), null);

  // Chat with junk tag object returns null
  assert.equal(calculateIQS(perfectScores, false, true, { disposition: 'junk' }), null);
  assert.equal(calculateIQS(perfectScores, false, true, ['junk']), null);
});

test('calculateCallIQS hardcodes exclusion of junk calls from scoring (NIL IQS)', () => {
  const perfectCallScores = {
    CallOpening: 'Yes' as const,
    CallClosing: 'Yes' as const,
    TechnicalLegal: 'Yes' as const,
    AllQuestions: 'Yes' as const,
    Expectation: 'Yes' as const,
    Process: 'Yes' as const,
    Grammar: 'Yes' as const,
    Fillers: 'Yes' as const,
    EnergyTone: 'Yes' as const,
    ActiveListening: 'Yes' as const,
    Simplifying: 'Yes' as const,
  };

  // Normal call gets valid score
  const normalCallScore = calculateCallIQS(perfectCallScores, 'Investment Query', 'Bonds');
  assert.equal(normalCallScore, 100);

  // Call with junk disposition returns null
  assert.equal(calculateCallIQS(perfectCallScores, 'Junk'), null);
  assert.equal(calculateCallIQS(perfectCallScores, 'junk calls'), null);

  // Call with junk sub-disposition returns null
  assert.equal(calculateCallIQS(perfectCallScores, 'Customer Call', 'Junk Call'), null);

  // Call with junk object returns null
  assert.equal(calculateCallIQS(perfectCallScores, { call_disposition: 'junk' }), null);
});

test('computeCallIQS hardcodes exclusion of junk calls in pipeline (NIL IQS)', () => {
  const scores = {
    P1: { score: 'Yes' },
    P2: { score: 'Yes' },
    P3: { score: 'Yes' },
    P4: { score: 'Yes' },
    P5: { score: 'Yes' },
    P6: { score: 'Yes' },
    P7: { score: 'Yes' },
    P8: { score: 'Yes' },
    P9: { score: 'Yes' },
    P10: { score: 'Yes' },
    P11: { score: 'Yes' },
  };

  // Normal call
  const normalResult = computeCallIQS(scores, 'General Query', 'Support');
  assert.equal(normalResult.iqs_percent, 100);
  assert.ok(normalResult.applicable_weight > 0);

  // Junk disposition
  const junkResult1 = computeCallIQS(scores, 'Junk', null);
  assert.equal(junkResult1.iqs_percent, null);
  assert.equal(junkResult1.applicable_weight, 0);

  // Junk sub-disposition
  const junkResult2 = computeCallIQS(scores, 'Enquiry', 'Junk Call');
  assert.equal(junkResult2.iqs_percent, null);
  assert.equal(junkResult2.applicable_weight, 0);

  // Junk object
  const junkResult3 = computeCallIQS(scores, { call_disposition: 'junk' });
  assert.equal(junkResult3.iqs_percent, null);
  assert.equal(junkResult3.applicable_weight, 0);
});

test('computeIqsFromRawParams hardcodes exclusion of junk from raw parameter scoring', () => {
  const rawParams = {
    __agent_parameters: {
      IssueResolution: { score: 'Yes' },
      Accuracy: { score: 'Yes' },
      ExpectationFollowThrough: { score: 'Yes' },
    },
    __scores: {
      agent_iqs: 85,
    },
  };

  // Normal parameters
  const normalScore = computeIqsFromRawParams(rawParams, false, 'Investment', 'SIP');
  assert.ok(typeof normalScore === 'number' && normalScore > 0);

  // Junk passed in disposition arg
  assert.equal(computeIqsFromRawParams(rawParams, false, 'Junk'), null);
  assert.equal(computeIqsFromRawParams(rawParams, false, 'Investment', 'Junk'), null);

  // Junk embedded in paramsObj
  const junkParamsObj = {
    ...rawParams,
    __disposition: 'Junk',
  };
  assert.equal(computeIqsFromRawParams(junkParamsObj), null);

  const junkTagsParamsObj = {
    ...rawParams,
    tags: ['junk'],
  };
  assert.equal(computeIqsFromRawParams(junkTagsParamsObj), null);

  // If agent_iqs was already null, do not compute fallback score
  const nullScoreParams = {
    ...rawParams,
    __scores: {
      agent_iqs: null,
    },
  };
  assert.equal(computeIqsFromRawParams(nullScoreParams), null);
});

test('calculateEmailIQS hardcodes exclusion of junk emails from scoring', () => {
  const perfectParams = {
    issue_resolution: 'yes',
    accuracy: 'yes',
    expectation_setting: 'yes',
    personalisation: 'yes',
    empathy: 'yes',
    sentences_simple_to_understand: 'yes',
    opening_and_closing: 'yes',
  };

  // Normal intent computes IQS 100
  const normalScore = calculateEmailIQS(perfectParams, undefined, 'Account Statement Request');
  assert.equal(normalScore, 100);

  // Undefined intent computes IQS 100
  const noIntentScore = calculateEmailIQS(perfectParams);
  assert.equal(noIntentScore, 100);

  // Junk intent returns null (NIL IQS, hardcoded exclusion)
  assert.equal(calculateEmailIQS(perfectParams, undefined, 'Junk'), null);
  assert.equal(calculateEmailIQS(perfectParams, undefined, 'junk'), null);
  assert.equal(calculateEmailIQS(perfectParams, undefined, 'Junk Emails'), null);
  assert.equal(calculateEmailIQS(perfectParams, undefined, 'Spam / Junk'), null);
});

test('Weighted IQS rollup excludes junk rows from total calculation', () => {
  // Simulates table / dashboard rollup behavior as in DispositionTreeTable wavg helper
  type TestRow = {
    disposition: string;
    chatCount: number;
    iqsChat: number | null;
  };

  const rows: TestRow[] = [
    { disposition: 'Investment Query', chatCount: 10, iqsChat: 90 },
    { disposition: 'KYC Verification', chatCount: 5, iqsChat: 80 },
    { disposition: 'Junk Chats', chatCount: 20, iqsChat: 20 }, // Junk with poor score
    { disposition: 'Junk', chatCount: 15, iqsChat: 0 },         // Junk with 0 score
  ];

  // Helper matching wavg(rows, r => r.chatCount, r => r.iqsChat, true)
  function computeTotalIQS(
    items: TestRow[],
    countFn: (r: TestRow) => number,
    valFn: (r: TestRow) => number | null,
    isIqs: boolean
  ): number | null {
    const valid = items.filter(r => {
      const v = valFn(r);
      const w = countFn(r);
      if (v === null || v === undefined || isNaN(v) || w <= 0) return false;
      if (isIqs && r.disposition.toLowerCase().includes('junk')) return false;
      return true;
    });
    if (valid.length === 0) return null;
    const sumW = valid.reduce((s, r) => s + countFn(r), 0);
    if (sumW === 0) return null;
    const sumV = valid.reduce((s, r) => s + valFn(r)! * countFn(r), 0);
    return Math.round(sumV / sumW);
  }

  // Without junk exclusion, total would be severely polluted:
  // (10*90 + 5*80 + 20*20 + 15*0) / (10+5+20+15) = (900 + 400 + 400 + 0) / 50 = 1700 / 50 = 34
  const pollutedTotal = computeTotalIQS(rows, r => r.chatCount, r => r.iqsChat, false);
  assert.equal(pollutedTotal, 34);

  // With junk excluded:
  // (10*90 + 5*80) / (10+5) = (900 + 400) / 15 = 1300 / 15 = 86.66... -> 87
  const cleanTotal = computeTotalIQS(rows, r => r.chatCount, r => r.iqsChat, true);
  assert.equal(cleanTotal, 87);
  assert.notEqual(cleanTotal, pollutedTotal);
});
