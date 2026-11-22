import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewThreshold, parseQualityThresholds, DEFAULT_QUALITY_THRESHOLDS } from '../lib/quality-thresholds';
import {
  DEFAULT_EMAIL_PARAMETERS, resolveEmailParameters, parseEmailRubric, emailWeightMap, calculateEmailIQS, buildEmailEvaluationPrompt,
} from '../lib/email/context-builder';

// ── review thresholds ──────────────────────────────────────────────────────
test('reviewThreshold falls back to 85 and ignores bad saved values', () => {
  assert.equal(reviewThreshold(undefined, 'chat'), 85);
  assert.equal(reviewThreshold({}, 'email'), 85);
  assert.equal(reviewThreshold({ qualityThresholds: { chatReview: 90 } }, 'chat'), 90);
  assert.equal(reviewThreshold({ qualityThresholds: { chatReview: 90 } }, 'call'), 85);
  for (const bad of [NaN, -1, 101, '85', null]) assert.equal(reviewThreshold({ qualityThresholds: { emailReview: bad as never } }, 'email'), 85);
});

test('parseQualityThresholds needs all three numbers in 0-100', () => {
  assert.deepEqual(parseQualityThresholds({ chatReview: 80, callReview: 85, emailReview: 90 }), { ok: true, value: { chatReview: 80, callReview: 85, emailReview: 90 } });
  assert.equal(parseQualityThresholds({ chatReview: 80, callReview: 85 }).ok, false);
  assert.equal(parseQualityThresholds({ chatReview: 101, callReview: 85, emailReview: 85 }).ok, false);
  assert.equal(parseQualityThresholds(DEFAULT_QUALITY_THRESHOLDS).ok, true);
});

// ── email rubric ───────────────────────────────────────────────────────────
test('defaults: seven parameters, weights add up to 100, resolve(undefined) is the defaults', () => {
  assert.equal(DEFAULT_EMAIL_PARAMETERS.length, 7);
  assert.equal(DEFAULT_EMAIL_PARAMETERS.reduce((s, p) => s + p.defaultWeight, 0), 100);
  assert.deepEqual(resolveEmailParameters(undefined), DEFAULT_EMAIL_PARAMETERS);
  assert.deepEqual(resolveEmailParameters({}), DEFAULT_EMAIL_PARAMETERS);
});

test('parseEmailRubric stores only what differs and enforces the 100 total', () => {
  const ok = parseEmailRubric({ issue_resolution: { weight: 20 }, accuracy: { weight: 30 } });
  assert.deepEqual(ok, { ok: true, value: { issue_resolution: { weight: 20 }, accuracy: { weight: 30 } } });
  const resolved = resolveEmailParameters((ok as { ok: true; value: never }).value);
  assert.equal(resolved.find(p => p.key === 'accuracy')!.defaultWeight, 30);
  assert.equal(resolved.reduce((s, p) => s + p.defaultWeight, 0), 100);

  // saving the defaults unchanged stores nothing (so future default improvements still flow through)
  const same = Object.fromEntries(DEFAULT_EMAIL_PARAMETERS.map(p => [p.key, { name: p.name, weight: p.defaultWeight, description: p.description, instructions: p.instructions }]));
  assert.deepEqual(parseEmailRubric(same), { ok: true, value: {} });

  assert.equal(parseEmailRubric({ issue_resolution: { weight: 26 } }).ok, false);          // total 101
  assert.equal(parseEmailRubric({ nonsense: { weight: 5 } }).ok, false);                    // unknown key
  assert.equal(parseEmailRubric({ empathy: { name: '   ' } }).ok, false);                   // empty text
  assert.equal(parseEmailRubric({ empathy: { weight: -5, } }).ok, false);                   // out of range
  assert.equal(parseEmailRubric({ empathy: { name: 'x'.repeat(81) } }).ok, false);          // too long
  assert.equal(parseEmailRubric(null).ok, false);
});

test('edited name, weight and instructions reach the prompt and the IQS', () => {
  const rubric = { empathy: { name: 'Warmth', instructions: 'CUSTOM-EMPATHY-RULES', weight: 5 }, opening_and_closing: { weight: 10 } };
  const params = resolveEmailParameters(rubric);
  const prompt = buildEmailEvaluationPrompt({
    ticketId: 't', messageId: 'm', agentName: 'A', sentAt: '2026-11-01T10:00:00Z', customerMessage: 'hi', agentReplyText: 'hello', historyCount: 0, parameters: params,
  });
  assert.ok(prompt.includes('5. Warmth\nCUSTOM-EMPATHY-RULES'));
  assert.ok(prompt.includes('(7 Parameters)'));

  const allYes = Object.fromEntries(DEFAULT_EMAIL_PARAMETERS.map(p => [p.key, 'yes']));
  assert.equal(calculateEmailIQS(allYes, emailWeightMap(params)), 100);
  // a "no" on a 25-weight parameter costs 25 points; on the re-weighted 5-weight one only 5
  assert.equal(calculateEmailIQS({ ...allYes, accuracy: 'no' }, emailWeightMap(params)), 75);
  assert.equal(calculateEmailIQS({ ...allYes, empathy: 'no' }, emailWeightMap(params)), 95);
});

test('default prompt still lists the seven parameters in order', () => {
  const prompt = buildEmailEvaluationPrompt({
    ticketId: 't', messageId: 'm', agentName: 'A', sentAt: '2026-11-01T10:00:00Z', customerMessage: 'hi', agentReplyText: 'hello', historyCount: 0,
  });
  const idx = DEFAULT_EMAIL_PARAMETERS.map((p, i) => prompt.indexOf(`${i + 1}. ${p.name}\n`));
  assert.ok(idx.every(n => n > 0) && idx.every((n, i) => i === 0 || n > idx[i - 1]));
});
