import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderWithAttachments, attachmentsToHtml } from '../components/quality/attachments';

const URL = 'https://d1bqel035sft98.cloudfront.net/email/a/b/OpTransactionHistory15-10-2026.pdf';
const TEXT = `hi pls find the updated statement attached\n[Attachment: OpTransactionHistory15-10-2026.pdf - ${URL}]`;

test('plain text: the marker becomes a link chip, the sentence stays', () => {
  const html = renderToStaticMarkup(React.createElement('div', null, renderWithAttachments(TEXT)));
  assert.match(html, /hi pls find the updated statement attached/);
  assert.match(html, new RegExp(`<a class="attachment-chip" href="${URL.replace(/[.]/g, '\\.')}" target="_blank" rel="noopener noreferrer"`));
  assert.match(html, />OpTransactionHistory15-10-2026\.pdf</);
  assert.ok(!html.includes('[Attachment:'));
});

test('file names containing " - " keep their full name', () => {
  const html = renderToStaticMarkup(React.createElement('div', null, renderWithAttachments(`[Attachment: Jan - Mar statement.pdf - ${URL}]`)));
  assert.match(html, />Jan - Mar statement\.pdf</);
});

test('[Image: url] becomes an "Image" chip that opens the picture', () => {
  const html = renderToStaticMarkup(React.createElement('div', null, renderWithAttachments(`I have filled the form please check [Image: ${URL}]`)));
  assert.match(html, /I have filled the form please check /);
  assert.match(html, new RegExp(`href="${URL.replace(/[.]/g, '\\.')}"`));
  assert.match(html, />Image</);
  assert.ok(!html.includes('[Image:'));
  assert.match(attachmentsToHtml(`<p>see [Image: ${URL}]</p>`), /class="attachment-chip"[^>]*>.*Image/);
});

test('text without markers is untouched', () => {
  assert.equal(renderWithAttachments('just a message'), 'just a message');
});

test('html body: marker (plain or already linkified) becomes an anchor with the class first-class after href', () => {
  for (const body of [`<p>${TEXT.replace('\n', '<br>')}</p>`, `<p>[Attachment: x.pdf - <a href="${URL}">${URL}</a>]</p>`]) {
    const out = attachmentsToHtml(body);
    assert.match(out, /<a href="https:\/\/d1bqel035sft98[^"]+" class="attachment-chip" target="_blank"/);
    assert.ok(!out.includes('[Attachment:'));
  }
});

import { isActivityEvent } from '../components/quality/transcript-events';
test('assignment events are events even when the sender is the agent', () => {
  assert.equal(isActivityEvent('Nirmiti', 'Claimed by Nirmiti'), true);
  assert.equal(isActivityEvent('activity', 'Waiting to assign to agent'), true);
  assert.equal(isActivityEvent('Priya D', 'Assigned by Puja to Priya D'), true);
  assert.equal(isActivityEvent('Nirmiti', 'Sir, I have claimed your request and will update you'), false);
  assert.equal(isActivityEvent('bot', 'Hello. Welcome to Wint Wealth support.'), false);
});
