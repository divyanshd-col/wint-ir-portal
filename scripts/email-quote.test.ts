import test from 'node:test';
import assert from 'node:assert/strict';
import { extractConciseQuery, splitQuotedReply, formatQuoted, isHtml } from '../components/quality/EmailContentRenderer';

const RAW = "Hi,\n\nCan you send me a confirmation stating that there is \u201cNo Activity\u201d for the period of, from April 09, 2026 to June 30, 2026.\n\nI need this to upload to my company.\n\nThank you!\n\nOn Wed, 14 Oct 2026 at 2:11 PM, unnati jaiswal <unnatijaiswal70@gmail.com> wrote:\n\n> Hi, > > I am not sure what pending details is required from me. > > Thanks > > On Tue, 13 Oct 2026 at 5:03 PM, <hello@wintwealth.com> wrote: > >> Dear Investor, >> >> We hope you are doing well.";

test('a plain-text address in angle brackets is not HTML', () => {
  assert.equal(isHtml(RAW), false);
  assert.equal(isHtml('<p>Hello</p><br>'), true);
});

test('core query keeps the whole sentence ("confirmation" no longer matches "on ... wrote:")', () => {
  const q = extractConciseQuery(RAW, 'subject');
  assert.match(q, /^Can you send me a confirmation stating that there is/);
  assert.match(q, /I need this to upload to my company\.$/);
});

test('quoted history is split off the new message, also when line breaks were collapsed', () => {
  const { main, quoted } = splitQuotedReply(RAW);
  assert.ok(main.endsWith('Thank you!'));
  assert.ok(quoted.startsWith('On Wed, 14 Oct 2026'));
  assert.equal(splitQuotedReply('Hi, Can you help? Thank you! On Wed, 14 Oct 2026 at 2:11 PM, X wrote: > Hi').main, 'Hi, Can you help? Thank you!');
  assert.equal(splitQuotedReply('I want a confirmation on the date wrote: nothing').quoted, '');
});

test('formatQuoted puts each quoted line on its own row and keeps the <address> header whole', () => {
  const out = formatQuoted(splitQuotedReply(RAW).quoted);
  assert.match(out, /^On Wed, 14 Oct 2026 at 2:11 PM, unnati jaiswal <unnatijaiswal70@gmail\.com> wrote:/);
  assert.match(out, /\nI am not sure what pending details is required from me\.\n/);
});
