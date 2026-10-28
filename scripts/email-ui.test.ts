import test from 'node:test';
import assert from 'node:assert/strict';
import { robylonTicketUrl, resolveDateRange, intentLabel, trimEmailBody, paramLabel, dayBoundsISO, disputeLabel, pageSlice, pageCount, paramChoice } from '../lib/email/ui';

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

test('resolveDateRange - all returns empty bounds (unrestricted all-time view)', () => {
  assert.deepEqual(resolveDateRange('all', undefined, undefined), { from: '', to: '' });
});

test('intentLabel - L1 name for display, a dash when Robylon has not classified the ticket', () => {
  assert.equal(intentLabel('KYC'), 'KYC');
  assert.equal(intentLabel('  Interest Repayment '), 'Interest Repayment');
  for (const v of [null, undefined, '', '  ', 'None', 'none', 'a34fb658-285d-450e-951e-b804c98cfff1']) assert.equal(intentLabel(v), '—', String(v));
});

test('trimEmailBody - drops trailing blank lines / empty html blocks and collapses blank runs', () => {
  assert.equal(trimEmailBody('Hi\n\n\n\nThanks\n\n  \n'), 'Hi\n\nThanks');
  assert.equal(trimEmailBody('<p>Hi</p><p>Thanks</p><p>&nbsp;</p><br><br/><div> <br></div>\n'), '<p>Hi</p><p>Thanks</p>');
  assert.equal(trimEmailBody('<p>Hi<br>there</p>'), '<p>Hi<br>there</p>');
  assert.equal(trimEmailBody(null), '');
});

test('paramLabel - plain label for a stored parameter value', () => {
  assert.deepEqual(['yes', 'PASS', 'Half', 'partial', 'no', 'fail', 'na', 'N/A', undefined, '', 85].map(paramLabel), ['Yes', 'Yes', 'Half', 'Half', 'No', 'No', 'NA', 'NA', '—', '—', '85%']);
});

test('dayBoundsISO - local start/end of the picked days, as instants the API can compare with sent_at', () => {
  const { from, to } = dayBoundsISO('2026-10-08', '2026-10-14');
  assert.equal(from, new Date(2026, 9, 8, 0, 0, 0, 0).toISOString());
  assert.equal(to, new Date(2026, 9, 14, 23, 59, 59, 999).toISOString());
});

test('disputeLabel - who is holding the dispute, in the words the chat views use', () => {
  assert.deepEqual(
    ['Raised', 'Under_Review', 'TL_Resolved', 'Resolved', 'Rejected', 'None', undefined].map(disputeLabel),
    ['Raised by agent', 'Forwarded to QA', 'Resolved by TL', 'Resolved by QA', 'Rejected by QA', '—', '—'],
  );
});

test('pageSlice / pageCount - client-side paging for the email tables', () => {
  const rows = Array.from({ length: 45 }, (_, i) => i + 1);
  assert.equal(pageCount(45, 20), 3);
  assert.equal(pageCount(0, 20), 1);
  assert.deepEqual(pageSlice(rows, 1, 20), rows.slice(0, 20));
  assert.deepEqual(pageSlice(rows, 3, 20), [41, 42, 43, 44, 45]);
  assert.deepEqual(pageSlice(rows, 9, 20), [41, 42, 43, 44, 45]); // out-of-range page clamps to the last
});

test('paramChoice - which of Yes / Half / No / NA a stored value selects', () => {
  assert.deepEqual(
    ['yes', 'PASS', 'half', 'Partial', 'no', 'fail', 'na', 'N/A', 85, '', null, undefined].map(paramChoice),
    ['yes', 'yes', 'half', 'half', 'no', 'no', 'na', 'na', null, null, null, null],
  );
});

test('formatNoteDate - formats ISO dates cleanly for internal note headers', async () => {
  const { formatNoteDate } = await import('../components/quality/EmailContentRenderer');
  assert.equal(formatNoteDate(null), '');
  assert.equal(formatNoteDate(undefined), '');
  const formatted = formatNoteDate('2026-10-22T04:29:04.486Z');
  assert.ok(formatted.includes('Oct'), `Expected month in formatted date: ${formatted}`);
  assert.ok(formatted.includes('2026'), `Expected year in formatted date: ${formatted}`);
});

test('formatEmailDateTime - formats email date and time cleanly', async () => {
  const { formatEmailDateTime } = await import('../lib/email/ui');
  assert.deepEqual(formatEmailDateTime(null), { date: '—', time: '', full: '—' });
  assert.deepEqual(formatEmailDateTime(''), { date: '—', time: '', full: '—' });
  const res = formatEmailDateTime('2026-10-22T08:30:00Z');
  assert.ok(res.date.includes('Oct') && res.date.includes('2026'));
  assert.ok(res.time.length > 0);
  assert.equal(res.full, `${res.date}, ${res.time}`);
});


