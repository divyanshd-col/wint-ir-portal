import test from 'node:test';
import assert from 'node:assert/strict';
import { clipQuote, summariseEvidence, ALERT_QUOTE_MAX, ALERT_EVIDENCE_MAX } from '../lib/quality-alert';

test('clipQuote leaves short quotes alone and collapses whitespace', () => {
  assert.equal(clipQuote('  Sir,   0.25% YTM\napplies. '), 'Sir, 0.25% YTM applies.');
  assert.equal(clipQuote(null), '');
});

test('clipQuote cuts a whole transcript turn at a word boundary with an ellipsis (call 190403 had a 5,202-character quote)', () => {
  const turn = 'so the holders of VVIP category are given priority in everything '.repeat(80); // ~5,000 chars
  const out = clipQuote(turn);
  assert.ok(out.length <= ALERT_QUOTE_MAX + 1, String(out.length));
  assert.ok(out.endsWith('…'));
  assert.ok(!out.endsWith(' …'));
  assert.ok(turn.startsWith(out.slice(0, -1)), 'still a prefix of the original');
});

test('summariseEvidence lists at most three clipped quotes and counts the rest', () => {
  const big = 'x'.repeat(5202);
  const ev = [{ quote: 'a' }, { quote: big }, { why: 'only a reason' }, { quote: 'd' }, { quote: 'e' }];
  const out = summariseEvidence(ev);
  assert.ok(out.length < ALERT_QUOTE_MAX * ALERT_EVIDENCE_MAX + 80, String(out.length));
  assert.match(out, /^a; x+…; only a reason; \(\+2 more in the portal\)$/);
});

test('summariseEvidence falls back when there is no evidence', () => {
  assert.equal(summariseEvidence([]), 'Call gate requirement failed');
  assert.equal(summariseEvidence(undefined), 'Call gate requirement failed');
  assert.equal(summariseEvidence([{ quote: '  ' }]), 'Call gate requirement failed');
});
