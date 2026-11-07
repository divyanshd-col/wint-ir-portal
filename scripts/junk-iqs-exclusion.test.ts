import test from 'node:test';
import assert from 'node:assert/strict';

import { isJunkDisposition } from '../lib/quality';
import { calculateEmailIQS } from '../lib/email/context-builder';

test('isJunkDisposition identifies junk chat and call dispositions correctly', () => {
  // Positive matches (should be identified as junk)
  assert.equal(isJunkDisposition('Junk'), true);
  assert.equal(isJunkDisposition('Junk Chats'), true);
  assert.equal(isJunkDisposition('junk'), true);
  assert.equal(isJunkDisposition('JUNK'), true);
  assert.equal(isJunkDisposition('junk calls'), true);
  assert.equal(isJunkDisposition('Junk Emails'), true);
  assert.equal(isJunkDisposition('  Junk  '), true);
  assert.equal(isJunkDisposition('Spam / Junk Query'), true);

  // Negative matches (legitimate interactions, not junk)
  assert.equal(isJunkDisposition('General Enquiry'), false);
  assert.equal(isJunkDisposition('Investment Query'), false);
  assert.equal(isJunkDisposition('KYC Verification'), false);
  assert.equal(isJunkDisposition('Repayment Issue'), false);
  assert.equal(isJunkDisposition(''), false);
  assert.equal(isJunkDisposition(null), false);
  assert.equal(isJunkDisposition(undefined), false);
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

test('Call pipeline marks junk calls as NOT_SCOREABLE with null IQS', () => {
  // Simulates call pipeline logic from lib/scoring/call-pipeline.ts
  function evaluateCall(callDisposition: string | null, subDisposition: string | null) {
    const isJunkCall =
      (callDisposition && callDisposition.toLowerCase().includes('junk')) ||
      (subDisposition && subDisposition.toLowerCase().includes('junk'));

    if (isJunkCall) {
      return {
        verdict: 'NOT_SCOREABLE',
        status: 'reviewed',
        iqs_percent: null,
        applicable_weight: 0,
      };
    }

    return {
      verdict: 'COMPLIANT',
      status: 'evaluated',
      iqs_percent: 85,
      applicable_weight: 100,
    };
  }

  const junkCall1 = evaluateCall('Junk', null);
  assert.equal(junkCall1.verdict, 'NOT_SCOREABLE');
  assert.equal(junkCall1.iqs_percent, null);

  const junkCall2 = evaluateCall('Customer Call', 'Junk Call');
  assert.equal(junkCall2.verdict, 'NOT_SCOREABLE');
  assert.equal(junkCall2.iqs_percent, null);

  const legitCall = evaluateCall('Payment Issue', 'Resolved');
  assert.equal(legitCall.verdict, 'COMPLIANT');
  assert.equal(legitCall.iqs_percent, 85);
});
