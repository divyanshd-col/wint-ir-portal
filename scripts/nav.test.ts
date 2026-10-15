import test from 'node:test';
import assert from 'node:assert/strict';
import { topTabs, activeTab, isAuthPath, hasNavSkill } from '../lib/nav';

const labels = (role: string, skills?: string[]) => topTabs(role, skills).map((t) => t.label);

test('admin sees all four tabs, Chat first, with their hrefs', () => {
  assert.deepEqual(topTabs('admin', []).map((t) => [t.label, t.href]), [
    ['Chat', '/chat'], ['Analytics', '/analytics'], ['Quality', '/quality'], ['Settings', '/settings'],
  ]);
});

test('team lead: Chat, Analytics, Quality but no Settings', () => {
  assert.deepEqual(labels('tl'), ['Chat', 'Analytics', 'Quality']);
});

test('quality analyst and agent: no Analytics (no analytics access), no Settings', () => {
  assert.deepEqual(labels('quality'), ['Chat', 'Quality']);
  assert.deepEqual(labels('agent'), ['Chat', 'Quality']);
});

test('explicit skills override the role defaults', () => {
  assert.deepEqual(labels('agent', ['chat:access']), ['Chat']);
  assert.deepEqual(labels('agent', ['analytics:access', 'settings:manage:access']), ['Analytics', 'Settings']);
});

test('hasNavSkill - admin always passes; others need the skill', () => {
  assert.equal(hasNavSkill('admin', [], 'anything'), true);
  assert.equal(hasNavSkill('tl', undefined, 'analytics:access'), true);
  assert.equal(hasNavSkill('tl', undefined, 'settings:manage:access'), false);
  assert.equal(hasNavSkill(undefined, undefined, 'chat:access'), false);
});

test('activeTab - Analytics group, Quality group, Chat, Settings (incl. Token Usage), and unknown routes', () => {
  for (const p of ['/analytics', '/call-analysis', '/cx']) assert.equal(activeTab(p), 'analytics', p);
  for (const p of ['/quality', '/quality/chat-evaluation', '/tl', '/tl/member-analytics', '/agent/quality-chats']) assert.equal(activeTab(p), 'quality', p);
  assert.equal(activeTab('/chat'), 'chat');
  assert.equal(activeTab('/settings'), 'settings');
  assert.equal(activeTab('/tokens'), 'settings'); // reached from Settings, Token Usage is not in the Analytics sidebar
  assert.equal(activeTab('/kb-gaps'), null);
  assert.equal(activeTab('/qualityx'), null); // segment match, not prefix match
});

test('isAuthPath - login, setup and set-password hide the top bar', () => {
  for (const p of ['/login', '/setup', '/set-password', '/set-password/abc']) assert.equal(isAuthPath(p), true, p);
  for (const p of ['/', '/chat', '/loginx']) assert.equal(isAuthPath(p), false, p);
});
