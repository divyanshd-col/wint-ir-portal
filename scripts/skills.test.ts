import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..');

const envFile = join(ROOT, '.env.local');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf-8').split('\n')) {
    const m = line.match(/^([^#=\s]+)\s*=\s*"?(.+?)"?\s*$/);
    if (m) process.env[m[1]] = m[2];
  }
}

import {
  listAllSkills,
  listPersonasWithSkills,
  getSkillsForPersona,
  hasSkill,
  togglePersonaSkill,
} from '../lib/skills';

test('SBAC - listAllSkills returns all seeded system skills', async () => {
  const skills = await listAllSkills();
  assert.ok(skills.length >= 19, `Expected at least 19 skills, got ${skills.length}`);
  const skillIds = skills.map(s => s.id);
  assert.ok(skillIds.includes('chat:access'));
  assert.ok(skillIds.includes('analytics:access'));
  assert.ok(skillIds.includes('quality:chat_eval:access'));
  assert.ok(skillIds.includes('tl:team_analytics:access'));
  assert.ok(skillIds.includes('skills:manage:access'));
});

test('SBAC - listPersonasWithSkills returns all 4 standard personas with skills', async () => {
  const personas = await listPersonasWithSkills();
  const personaIds = personas.map(p => p.id);
  assert.ok(personaIds.includes('admin'));
  assert.ok(personaIds.includes('tl'));
  assert.ok(personaIds.includes('quality'));
  assert.ok(personaIds.includes('agent'));

  const tl = personas.find(p => p.id === 'tl');
  assert.ok(tl);
  assert.ok(tl.skills.includes('analytics:access'));
  assert.ok(tl.skills.includes('tl:team_analytics:access'));
});

test('SBAC - hasSkill evaluates user skills correctly', () => {
  // Direct skills array
  assert.equal(hasSkill(['chat:access', 'analytics:access'], 'analytics:access'), true);
  assert.equal(hasSkill(['chat:access'], 'analytics:access'), false);

  // Array of required skills (OR logic)
  assert.equal(hasSkill(['quality:chat_eval:access'], ['quality:analytics:access', 'quality:chat_eval:access']), true);
  assert.equal(hasSkill(['chat:access'], ['quality:analytics:access', 'quality:chat_eval:access']), false);

  // Admin persona bypass
  assert.equal(hasSkill({ role: 'admin', isAdmin: true, skills: ['settings:manage:access'] }, 'random:skill'), true);

  // Non-admin user object with skills
  const agentUser = { role: 'agent', skills: ['chat:access', 'agent:my_chats:access'] };
  assert.equal(hasSkill(agentUser, 'chat:access'), true);
  assert.equal(hasSkill(agentUser, 'analytics:access'), false);
});

test('SBAC - togglePersonaSkill dynamically attaches and detaches skills', async () => {
  const initialTLSkills = await getSkillsForPersona('tl');
  const wasChatEvalAssigned = initialTLSkills.includes('quality:chat_eval:access');

  // Toggle ON for TL
  await togglePersonaSkill('tl', 'quality:chat_eval:access', true, 'test-runner@wintwealth.com');
  const updatedSkillsAfterOn = await getSkillsForPersona('tl');
  assert.ok(updatedSkillsAfterOn.includes('quality:chat_eval:access'), 'Skill should be enabled');

  // Toggle OFF for TL
  await togglePersonaSkill('tl', 'quality:chat_eval:access', false, 'test-runner@wintwealth.com');
  const updatedSkillsAfterOff = await getSkillsForPersona('tl');
  assert.ok(!updatedSkillsAfterOff.includes('quality:chat_eval:access'), 'Skill should be disabled');

  // Restore initial state
  if (wasChatEvalAssigned) {
    await togglePersonaSkill('tl', 'quality:chat_eval:access', true, 'test-runner@wintwealth.com');
  }
});
