/**
 * PCG / CX email routing: which inbox an event names, the saved PCG inbox list and the CX-traffic guard.
 * Run: npx tsx --test scripts/email-inbox.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PCG_EMAIL_INBOXES, emailInboxOf, inboxShares, isPcgInbox, parsePcgEmailInboxes, pcgInboxesOf, CX_INBOX_SHARE_LIMIT } from '../lib/email/inbox';
import { diffTrackedSettings, restoreToConfigPatch } from '../lib/settings-history-keys';

const prop = (v: string, key = 'snapshot_value') => ({ name: 'ticket_channel_email_rb_em', [key]: v });

test('the inbox comes from channel_info.email, else the ticket_channel_email_rb_em property, else nothing', () => {
  assert.equal(emailInboxOf({ channel_info: { email: ' Hello@WintWealth.com ' } }), 'hello@wintwealth.com');
  assert.equal(emailInboxOf({ data: { properties: [prop('pcg@x.com')] } }), 'pcg@x.com');
  assert.equal(emailInboxOf({ properties: [prop('pcg@x.com', 'selected_value')] }), 'pcg@x.com');           // top-level properties, selected_value
  assert.equal(emailInboxOf({ channel_info: { email: 'a@x.com' }, data: { properties: [prop('b@x.com')] } }), 'a@x.com'); // channel_info wins
  assert.equal(emailInboxOf({ channel_info: { email: null }, data: { properties: [prop('b@x.com')] } }), 'b@x.com');
  assert.equal(emailInboxOf({ data: { properties: [{ name: 'Status', snapshot_value: 'Open' }] } }), null);
  assert.equal(emailInboxOf({ channel_info: { email: 'not-an-address' } }), null);                          // junk is not an inbox
  assert.equal(emailInboxOf({ data: { properties: [prop('48541f2b-5f7d-43ff-bbdd-844ef4a836f8')] } }), null); // a channel id is not an address
  assert.equal(emailInboxOf({}), null);
  assert.equal(emailInboxOf(null), null);
});

test('an event is PCG only when its inbox is on the PCG list (an empty list means everything is CX)', () => {
  assert.equal(isPcgInbox('pcg@x.com', ['pcg@x.com']), true);
  assert.equal(isPcgInbox('hello@x.com', ['pcg@x.com']), false);
  assert.equal(isPcgInbox(null, ['pcg@x.com']), false);        // no inbox: the route follows the ticket instead
  assert.equal(isPcgInbox('pcg@x.com', []), false);
});

test('the saved inbox list: trimmed, lower-cased, de-duplicated, validated', () => {
  assert.deepEqual(parsePcgEmailInboxes(' PCG@x.com \n\nteam@x.com, pcg@x.com;ops@x.com'), { ok: true, value: ['pcg@x.com', 'team@x.com', 'ops@x.com'] });
  assert.deepEqual(parsePcgEmailInboxes(['A@x.com', 'a@x.com']), { ok: true, value: ['a@x.com'] });
  assert.deepEqual(parsePcgEmailInboxes(''), { ok: true, value: [] });                 // clearing the list is allowed
  for (const bad of ['nope', 'a@b', 'a b@x.com', '<a@x.com>']) assert.equal(parsePcgEmailInboxes(bad).ok, false, bad);
  assert.equal(parsePcgEmailInboxes(42).ok, false);
  assert.equal(parsePcgEmailInboxes(Array.from({ length: 21 }, (_, i) => `u${i}@x.com`)).ok, false);
});

test('CX traffic guard: an inbox with most of the recent CX tickets is over the limit, a small PCG inbox is not', () => {
  const shares = inboxShares([...Array(97).fill('hello@x.com'), ...Array(3).fill('pcg@x.com'), null]);
  assert.ok(shares['hello@x.com'] >= CX_INBOX_SHARE_LIMIT);
  assert.ok(shares['pcg@x.com'] < CX_INBOX_SHARE_LIMIT);
  assert.deepEqual(inboxShares([]), {});
  assert.deepEqual(inboxShares([null]), {});
});

test('the PCG inboxes default to the built-in three until an admin saves a list; a saved list (even empty) replaces them', () => {
  assert.deepEqual(DEFAULT_PCG_EMAIL_INBOXES, ['hnidesk@wintwealth.com', 'pmsadvisory@wintwealth.com', 'huf@wintwealth.com']);
  assert.deepEqual(pcgInboxesOf({}), DEFAULT_PCG_EMAIL_INBOXES);
  assert.deepEqual(pcgInboxesOf(null), DEFAULT_PCG_EMAIL_INBOXES);
  assert.deepEqual(pcgInboxesOf({ pcgEmailInboxes: ['Only@x.com'] }), ['only@x.com']);
  assert.deepEqual(pcgInboxesOf({ pcgEmailInboxes: [] }), []);                      // an admin cleared it: none, not the default
  assert.notEqual(pcgInboxesOf({}), DEFAULT_PCG_EMAIL_INBOXES);                      // a copy: callers cannot change the default
  assert.equal(isPcgInbox('huf@wintwealth.com', pcgInboxesOf({})), true);
  assert.equal(isPcgInbox('hello@wintwealth.com', pcgInboxesOf({})), false);        // the CX inbox is never PCG by default
});

test('the PCG inbox list is recorded in the settings history and can be restored', () => {
  assert.deepEqual(diffTrackedSettings({}, { pcgEmailInboxes: [...DEFAULT_PCG_EMAIL_INBOXES].reverse() }), []);   // same as the default: no change
  assert.deepEqual(diffTrackedSettings({}, { pcgEmailInboxes: ['b@x.com', 'a@x.com'] }).map(c => [c.key, c.oldValue, c.newValue]), [['pcgEmailInboxes', null, 'a@x.com, b@x.com']]);
  assert.deepEqual(diffTrackedSettings({ pcgEmailInboxes: ['a@x.com'] }, { pcgEmailInboxes: ['a@x.com'] }), []);
  assert.deepEqual(diffTrackedSettings({}, { pcgEmailInboxes: [] }).map(c => [c.key, c.oldValue, c.newValue]), [['pcgEmailInboxes', null, '(none)']]);
  assert.deepEqual(restoreToConfigPatch('pcgEmailInboxes', 'a@x.com, b@x.com'), { ok: true, patch: { pcgEmailInboxes: ['a@x.com', 'b@x.com'] } });
  assert.deepEqual(restoreToConfigPatch('pcgEmailInboxes', '(none)'), { ok: true, patch: { pcgEmailInboxes: [] } });
  assert.deepEqual(restoreToConfigPatch('pcgEmailInboxes', null), { ok: true, patch: { pcgEmailInboxes: undefined } });   // back to the default
});
