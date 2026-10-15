import test from 'node:test';
import assert from 'node:assert/strict';
import { isHttpsRequest } from '../lib/auth-cookie';

test('https forwarded by a proxy or tunnel counts as https', () => {
  assert.equal(isHttpsRequest('https', 'http:'), true);
  assert.equal(isHttpsRequest('HTTPS', 'http:'), true);
  assert.equal(isHttpsRequest('https,http', 'http:'), true); // first hop wins when several are listed
});

test('http forwarded by a proxy is http even if the app sees https', () => {
  assert.equal(isHttpsRequest('http', 'https:'), false);
  assert.equal(isHttpsRequest('http,https', 'https:'), false);
});

test('without a forwarded header the request protocol decides', () => {
  assert.equal(isHttpsRequest(null, 'https:'), true);
  assert.equal(isHttpsRequest(undefined, 'http:'), false);
  assert.equal(isHttpsRequest('', 'http:'), false);
});
