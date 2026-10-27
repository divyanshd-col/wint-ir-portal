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
