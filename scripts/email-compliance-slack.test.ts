import test from 'node:test';
import assert from 'node:assert/strict';
import { getEmailComplianceSlackChannel } from '../lib/email/compliance-alert';

test('getEmailComplianceSlackChannel - defaults to C0CERSWEXTM when no env set', () => {
  const origWebhook = process.env.COMPLIANCE_EMAIL_SLACK_WEBHOOK_URL;
  const origPrimary = process.env.COMPLIANCE_EMAIL_SLACK_CHANNEL;
  const origAlt1 = process.env.EMAIL_COMPLIANCE_SLACK_CHANNEL;
  const origAlt2 = process.env.COMPLIANCE_FLAG_EMAILS_SLACK_CHANNEL;

  delete process.env.COMPLIANCE_EMAIL_SLACK_WEBHOOK_URL;
  delete process.env.COMPLIANCE_EMAIL_SLACK_CHANNEL;
  delete process.env.EMAIL_COMPLIANCE_SLACK_CHANNEL;
  delete process.env.COMPLIANCE_FLAG_EMAILS_SLACK_CHANNEL;

  try {
    const ch = getEmailComplianceSlackChannel();
    assert.equal(ch, 'C0CERSWEXTM');
    // Verify it NEVER falls back to C0BRLHDDGQ0 (the chat compliance-flag channel)
    assert.notEqual(ch, 'C0BRLHDDGQ0');
    assert.notEqual(ch, process.env.COMPLIANCE_SLACK_CHANNEL);
  } finally {
    if (origWebhook !== undefined) process.env.COMPLIANCE_EMAIL_SLACK_WEBHOOK_URL = origWebhook;
    if (origPrimary !== undefined) process.env.COMPLIANCE_EMAIL_SLACK_CHANNEL = origPrimary;
    if (origAlt1 !== undefined) process.env.EMAIL_COMPLIANCE_SLACK_CHANNEL = origAlt1;
    if (origAlt2 !== undefined) process.env.COMPLIANCE_FLAG_EMAILS_SLACK_CHANNEL = origAlt2;
  }
});

test('getEmailComplianceSlackChannel - uses COMPLIANCE_EMAIL_SLACK_CHANNEL when configured', () => {
  const origPrimary = process.env.COMPLIANCE_EMAIL_SLACK_CHANNEL;
  process.env.COMPLIANCE_EMAIL_SLACK_CHANNEL = 'C_TEST_EMAIL_CHANNEL_123';

  try {
    const ch = getEmailComplianceSlackChannel();
    assert.equal(ch, 'C_TEST_EMAIL_CHANNEL_123');
  } finally {
    if (origPrimary !== undefined) {
      process.env.COMPLIANCE_EMAIL_SLACK_CHANNEL = origPrimary;
    } else {
      delete process.env.COMPLIANCE_EMAIL_SLACK_CHANNEL;
    }
  }
});

test('getEmailComplianceSlackChannel - webhook takes precedence if provided', () => {
  const origWebhook = process.env.COMPLIANCE_EMAIL_SLACK_WEBHOOK_URL;
  process.env.COMPLIANCE_EMAIL_SLACK_WEBHOOK_URL = 'https://hooks.slack.com/services/T/B/X';

  try {
    const ch = getEmailComplianceSlackChannel();
    assert.equal(ch, 'https://hooks.slack.com/services/T/B/X');
  } finally {
    if (origWebhook !== undefined) {
      process.env.COMPLIANCE_EMAIL_SLACK_WEBHOOK_URL = origWebhook;
    } else {
      delete process.env.COMPLIANCE_EMAIL_SLACK_WEBHOOK_URL;
    }
  }
});

