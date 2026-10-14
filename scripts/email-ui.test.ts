import test from 'node:test';
import assert from 'node:assert/strict';
import { robylonTicketUrl, resolveDateRange, intentLabel } from '../lib/email/ui';

test('robylonTicketUrl - the unified-inbox link for a chat id', () => {
  assert.equal(robylonTicketUrl('110894'), 'https://app.robylon.ai/unified-inbox/share/110894');
  assert.equal(robylonTicketUrl(110894), 'https://app.robylon.ai/unified-inbox/share/110894');
  assert.equal(robylonTicketUrl(' 110894 '), 'https://app.robylon.ai/unified-inbox/share/110894');
});

test('resolveDateRange - 7 days is today and the 6 days before it (calendar days, inclusive)', () => {
  const now = new Date(2026, 9, 14, 15, 30); // 14 Oct 2026, local time
  assert.deepEqual(resolveDateRange('7', undefined, undefined, now), { from: '2026-10-08', to: '2026-10-14' });
});

test('resolveDateRange - 30 days crosses month and uses local dates', () => {
  const now = new Date(2026, 9, 14, 0, 5); // just after local midnight: must stay 14 Oct, not slip to the 13th
  assert.deepEqual(resolveDateRange('30', undefined, undefined, now), { from: '2026-09-15', to: '2026-10-14' });
});

test('resolveDateRange - custom passes the chosen dates through; missing dates fall back to 7 days', () => {
  const now = new Date(2026, 9, 14, 12, 0);
  assert.deepEqual(resolveDateRange('custom', '2026-10-01', '2026-10-05', now), { from: '2026-10-01', to: '2026-10-05' });
  assert.deepEqual(resolveDateRange('custom', undefined, undefined, now), { from: '2026-10-08', to: '2026-10-14' });
});

test('intentLabel - L1 name for display, a dash when Robylon has not classified the ticket', () => {
  assert.equal(intentLabel('KYC'), 'KYC');
  assert.equal(intentLabel('  Interest Repayment '), 'Interest Repayment');
  for (const v of [null, undefined, '', '  ', 'None', 'none', 'a34fb658-285d-450e-951e-b804c98cfff1']) assert.equal(intentLabel(v), '—', String(v));
});
