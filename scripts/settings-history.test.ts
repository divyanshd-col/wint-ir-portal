import test from 'node:test';
import assert from 'node:assert/strict';
import { TRACKED_SETTINGS, trackedKeysFor, isTrackedKey, normalizeSettingValue, diffTrackedSettings, restoreToConfigPatch } from '../lib/settings-history-keys';
import { PROMPT_FIELDS, MAX_PROMPT_CHARS } from '../lib/prompt-overrides';
import { DEFAULT_QUALITY_THRESHOLDS } from '../lib/quality-thresholds';

test('every editable prompt is tracked, in the same workspace', () => {
  for (const [field, ws] of Object.entries(PROMPT_FIELDS)) {
    assert.ok(isTrackedKey(field), `${field} is not tracked`);
    assert.equal(TRACKED_SETTINGS[field as keyof typeof TRACKED_SETTINGS].workspace, ws);
  }
  for (const k of ['systemPrompt', 'iqsScoringPrompt', 'emailRubric', 'qualityThresholds']) assert.ok(isTrackedKey(k));
  assert.equal(isTrackedKey('geminiApiKey'), false);   // credentials never go into the history
});

test('history is split by workspace', () => {
  assert.deepEqual(trackedKeysFor('pcg').sort(), ['pcgClassificationPrompt', 'pcgQualityPrompt']);
  assert.ok(!trackedKeysFor('cx').some(k => k.startsWith('pcg')));
  assert.ok(trackedKeysFor('cx').includes('callGatesPrompt'));
});

test('normalize: blank, empty and default values all mean "default"', () => {
  for (const blank of [undefined, null, '', '  \n']) assert.equal(normalizeSettingValue('callGatesPrompt', blank), null);
  assert.equal(normalizeSettingValue('callGatesPrompt', 'x'), 'x');
  assert.equal(normalizeSettingValue('emailRubric', {}), null);
  assert.deepEqual(normalizeSettingValue('emailRubric', { accuracy: { weight: 30 } }), { accuracy: { weight: 30 } });
  assert.equal(normalizeSettingValue('qualityThresholds', { ...DEFAULT_QUALITY_THRESHOLDS }), null);
  assert.deepEqual(normalizeSettingValue('qualityThresholds', { chatReview: 80, callReview: 85, emailReview: 85 }), { chatReview: 80, callReview: 85, emailReview: 85 });
});

test('diff finds only real changes and ignores key order and untracked fields', () => {
  const same = diffTrackedSettings({ callGatesPrompt: 'a', geminiApiKey: 'k1' }, { callGatesPrompt: 'a', geminiApiKey: 'k2' });
  assert.deepEqual(same, []);
  assert.deepEqual(diffTrackedSettings({}, { callGatesPrompt: '' }), []);                         // default -> blank is no change
  assert.deepEqual(diffTrackedSettings({ qualityThresholds: DEFAULT_QUALITY_THRESHOLDS }, {}), []);
  assert.deepEqual(
    diffTrackedSettings({ emailRubric: { a: { weight: 1, name: 'x' } } }, { emailRubric: { a: { name: 'x', weight: 1 } } }), []);

  const d = diffTrackedSettings({ iqsScoringPrompt: 'old text', pcgQualityPrompt: 'p1' }, { iqsScoringPrompt: 'new text', pcgQualityPrompt: '' });
  assert.deepEqual(d.map(c => [c.key, c.oldValue, c.newValue]).sort(), [['iqsScoringPrompt', 'old text', 'new text'], ['pcgQualityPrompt', 'p1', null]]);
});

test('restore turns a history value back into a valid config change', () => {
  assert.deepEqual(restoreToConfigPatch('callIqsPrompt', 'text'), { ok: true, patch: { callIqsPrompt: 'text' } });
  assert.deepEqual(restoreToConfigPatch('callIqsPrompt', null), { ok: true, patch: { callIqsPrompt: '' } });          // back to the built-in default
  assert.deepEqual(restoreToConfigPatch('emailRubric', null), { ok: true, patch: { emailRubric: {} } });
  assert.deepEqual(restoreToConfigPatch('qualityThresholds', null), { ok: true, patch: { qualityThresholds: undefined } });
  assert.deepEqual(restoreToConfigPatch('qualityThresholds', { chatReview: 80, callReview: 85, emailReview: 90 }),
    { ok: true, patch: { qualityThresholds: { chatReview: 80, callReview: 85, emailReview: 90 } } });
  assert.deepEqual(restoreToConfigPatch('emailRubric', { accuracy: { weight: 30 }, issue_resolution: { weight: 20 } }),
    { ok: true, patch: { emailRubric: { accuracy: { weight: 30 }, issue_resolution: { weight: 20 } } } });

  // values that would not pass a normal save are refused on restore too
  assert.equal(restoreToConfigPatch('emailRubric', { accuracy: { weight: 99 } }).ok, false);      // weights no longer add up to 100
  assert.equal(restoreToConfigPatch('qualityThresholds', { chatReview: 500 }).ok, false);
  assert.equal(restoreToConfigPatch('callIqsPrompt', { not: 'text' }).ok, false);
  assert.equal(restoreToConfigPatch('callIqsPrompt', 'x'.repeat(MAX_PROMPT_CHARS + 1)).ok, false);
});
