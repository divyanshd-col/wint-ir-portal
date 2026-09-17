import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';

// Bind the secret before importing the module (verifyConsentToken reads it).
process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || 'test-secret-for-oauth-crypto';

import {
  verifyPkceS256,
  isAllowedRedirectUri,
  signConsentToken,
  verifyConsentToken,
  type ConsentFields,
} from '../lib/mcp/oauth';

// ── PKCE (S256) ───────────────────────────────────────────────────────────────
test('verifyPkceS256 accepts a correct verifier/challenge pair', () => {
  const verifier = randomBytes(48).toString('base64url'); // 43–128 chars
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  assert.equal(verifyPkceS256(verifier, challenge), true);
});

test('verifyPkceS256 rejects a wrong verifier', () => {
  const verifier = randomBytes(48).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const wrong = randomBytes(48).toString('base64url');
  assert.equal(verifyPkceS256(wrong, challenge), false);
});

test('verifyPkceS256 rejects too-short verifiers (RFC 7636)', () => {
  const short = 'abc';
  const challenge = createHash('sha256').update(short).digest('base64url');
  assert.equal(verifyPkceS256(short, challenge), false);
});

// ── Redirect-URI host allowlist ─────────────────────────────────────────────────
test('isAllowedRedirectUri allows Anthropic https callbacks', () => {
  assert.equal(isAllowedRedirectUri('https://claude.ai/api/mcp/auth_callback'), true);
  assert.equal(isAllowedRedirectUri('https://claude.com/anything'), true);
  assert.equal(isAllowedRedirectUri('https://foo.claude.ai/cb'), true);
});

test('isAllowedRedirectUri rejects other hosts, http, and lookalikes', () => {
  assert.equal(isAllowedRedirectUri('https://evil.com/cb'), false);
  assert.equal(isAllowedRedirectUri('http://claude.ai/cb'), false); // not https
  assert.equal(isAllowedRedirectUri('https://claude.ai.evil.com/cb'), false); // suffix trick
  assert.equal(isAllowedRedirectUri('https://notclaude.ai/cb'), false);
  assert.equal(isAllowedRedirectUri('not-a-url'), false);
});

// ── Consent CSRF token ──────────────────────────────────────────────────────────
const fields: ConsentFields = {
  clientId: 'wint_client_abc',
  redirectUri: 'https://claude.ai/api/mcp/auth_callback',
  codeChallenge: 'challenge123',
  scope: 'analytics:read',
  resource: 'https://ir.wintwealth.com/api/mcp/mcp',
  state: 'xyz',
  email: 'ceo@wintwealth.com',
};

test('consent token round-trips for matching fields', () => {
  const now = 1_700_000_000;
  const token = signConsentToken(fields, now);
  assert.equal(verifyConsentToken(token, fields, now + 60), true);
});

test('consent token fails if any bound field changes', () => {
  const now = 1_700_000_000;
  const token = signConsentToken(fields, now);
  assert.equal(verifyConsentToken(token, { ...fields, clientId: 'wint_client_other' }, now + 60), false);
  assert.equal(verifyConsentToken(token, { ...fields, redirectUri: 'https://claude.com/cb' }, now + 60), false);
  assert.equal(verifyConsentToken(token, { ...fields, email: 'someone@wintwealth.com' }, now + 60), false);
});

test('consent token expires', () => {
  const now = 1_700_000_000;
  const token = signConsentToken(fields, now);
  assert.equal(verifyConsentToken(token, fields, now + 10_000), false); // > 10 min later
});

test('consent token rejects garbage', () => {
  const now = 1_700_000_000;
  assert.equal(verifyConsentToken('garbage', fields, now), false);
  assert.equal(verifyConsentToken(undefined, fields, now), false);
});
