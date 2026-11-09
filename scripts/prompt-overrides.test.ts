import test from 'node:test';
import assert from 'node:assert/strict';
import { promptOrDefault, workspaceAccess, visiblePromptFields, parsePromptFields, MAX_PROMPT_CHARS } from '../lib/prompt-overrides';
import { buildEmailEvaluationPrompt, DEFAULT_EMAIL_PROMPT_INTRO, DEFAULT_EMAIL_PROMPT_COMPLIANCE } from '../lib/email/context-builder';

const superAdmin = { isSuperAdmin: true, platformDomain: 'both' };
const cxAdmin = { isSuperAdmin: false, platformDomain: 'cx' };
const pcgAdmin = { isSuperAdmin: false, platformDomain: 'pcg' };

test('promptOrDefault uses the saved text unless it is blank', () => {
  assert.equal(promptOrDefault('mine', 'default'), 'mine');
  for (const blank of [undefined, null, '', '   \n']) assert.equal(promptOrDefault(blank, 'default'), 'default');
});

test('workspaceAccess: super admins and "both" see both, others only their own', () => {
  assert.deepEqual(workspaceAccess(superAdmin), { cx: true, pcg: true });
  assert.deepEqual(workspaceAccess({ platformDomain: 'both' }), { cx: true, pcg: true });
  assert.deepEqual(workspaceAccess(cxAdmin), { cx: true, pcg: false });
  assert.deepEqual(workspaceAccess(pcgAdmin), { cx: false, pcg: true });
});

test('visiblePromptFields never mixes workspaces', () => {
  assert.deepEqual(visiblePromptFields('cx', superAdmin).sort(), ['callGatesPrompt', 'callIqsPrompt', 'emailPromptCompliance', 'emailPromptIntro']);
  assert.deepEqual(visiblePromptFields('pcg', superAdmin).sort(), ['pcgClassificationPrompt', 'pcgQualityPrompt']);
  assert.deepEqual(visiblePromptFields('pcg', cxAdmin), []);     // a CX admin sees no PCG prompts, even if the page says "pcg"
  assert.deepEqual(visiblePromptFields('cx', pcgAdmin), []);     // and a PCG admin sees no CX prompts
  assert.equal(visiblePromptFields('pcg', pcgAdmin).length, 2);
});

test('parsePromptFields enforces workspace, type and size', () => {
  assert.deepEqual(parsePromptFields({ callGatesPrompt: 'x', unrelated: 1 }, cxAdmin), { ok: true, value: { callGatesPrompt: 'x' } });
  assert.deepEqual(parsePromptFields({ pcgQualityPrompt: '' }, pcgAdmin), { ok: true, value: { pcgQualityPrompt: '' } });   // '' = back to default
  assert.deepEqual(parsePromptFields({}, cxAdmin), { ok: true, value: {} });

  const cross1 = parsePromptFields({ pcgQualityPrompt: 'x' }, cxAdmin);
  const cross2 = parsePromptFields({ callIqsPrompt: 'x' }, pcgAdmin);
  assert.ok(!cross1.ok && cross1.status === 403);
  assert.ok(!cross2.ok && cross2.status === 403);
  assert.equal(parsePromptFields({ pcgQualityPrompt: 'x', callIqsPrompt: 'y' }, superAdmin).ok, true);

  const notText = parsePromptFields({ callGatesPrompt: 5 }, cxAdmin);
  assert.ok(!notText.ok && notText.status === 400);
  assert.equal(parsePromptFields({ callGatesPrompt: 'x'.repeat(MAX_PROMPT_CHARS + 1) }, cxAdmin).ok, false);
  assert.equal(parsePromptFields({ callGatesPrompt: 'x'.repeat(MAX_PROMPT_CHARS) }, cxAdmin).ok, true);
});

test('email prompt: edits to the instruction blocks reach the prompt, the output format stays locked', () => {
  const base = { ticketId: 't', messageId: 'm', agentName: 'A', sentAt: '2026-11-01T10:00:00Z', customerMessage: 'hi', agentReplyText: 'hello', historyCount: 0 };
  const dflt = buildEmailEvaluationPrompt(base);
  assert.ok(dflt.includes(DEFAULT_EMAIL_PROMPT_INTRO) && dflt.includes(DEFAULT_EMAIL_PROMPT_COMPLIANCE));

  const custom = buildEmailEvaluationPrompt({ ...base, promptText: { intro: 'CUSTOM-INTRO', compliance: 'CUSTOM-COMPLIANCE' } });
  assert.ok(custom.startsWith('CUSTOM-INTRO'));
  assert.ok(custom.includes('CUSTOM-COMPLIANCE') && !custom.includes(DEFAULT_EMAIL_PROMPT_COMPLIANCE));
  for (const prompt of [dflt, custom]) {
    assert.ok(prompt.includes('OUTPUT FORMAT:') && prompt.includes('"parameter_scores"') && prompt.includes("AGENT'S OUTBOUND REPLY TO EVALUATE"));
  }
  // blank edits fall back to the built-in text
  const blank = buildEmailEvaluationPrompt({ ...base, promptText: { intro: '  ', compliance: '' } });
  assert.equal(blank, dflt);
});

test('email prompt: knowledge base is included when found, and the evaluator is told what it does not have', () => {
  const base = { ticketId: 't', messageId: 'm', agentName: 'A', sentAt: '2026-11-01T10:00:00Z', customerMessage: 'hi', agentReplyText: 'hello', historyCount: 0 };
  const withKb = buildEmailEvaluationPrompt({ ...base, knowledgeBase: '[TDS guide]\nTDS is 10% on interest.' });
  assert.ok(withKb.includes('KNOWLEDGE BASE (verify') && withKb.includes('TDS is 10% on interest.'));
  // the excerpt sits before the rubric so the parameters can refer to it
  assert.ok(withKb.indexOf('TDS is 10%') < withKb.indexOf('EVALUATION PARAMETERS'));

  for (const none of [undefined, '', '   ']) {
    const p = buildEmailEvaluationPrompt({ ...base, knowledgeBase: none });
    assert.ok(p.includes('no relevant excerpt was found') && !p.includes('KNOWLEDGE BASE (verify'));
  }
  for (const p of [withKb, buildEmailEvaluationPrompt(base)]) {
    assert.ok(p.includes('NOT PROVIDED: the client\'s account data') && p.includes('unverified'));
  }
});

test('email prompt: JSON example has placeholders, not copyable values, and one key per parameter', () => {
  const p = buildEmailEvaluationPrompt({ ticketId: 't', messageId: 'm', agentName: 'A', sentAt: 'x', customerMessage: 'hi', agentReplyText: 'hello', historyCount: 0 });
  const format = p.slice(p.indexOf('OUTPUT FORMAT:'));
  assert.ok(!format.includes('88') && !format.includes('USA') && !format.includes('Form 16A'));
  assert.ok(format.includes('"quality_score": <integer 0-100>'));
  for (const key of ['issue_resolution', 'accuracy', 'expectation_setting', 'personalisation', 'empathy', 'sentences_simple_to_understand', 'opening_and_closing']) {
    assert.equal(format.split(`"${key}": "<`).length - 1, 2, key);   // once in parameter_scores, once in parameter_reasoning
  }
});
