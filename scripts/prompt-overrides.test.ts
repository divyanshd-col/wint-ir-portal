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
