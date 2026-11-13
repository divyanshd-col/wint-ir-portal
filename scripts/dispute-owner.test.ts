/**
 * TL-owned dispute resolution: owner setting, history, queue membership, team matching and the QA audit-queue rule.
 * Run: npx tsx --test scripts/dispute-owner.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentInTeam, disputeOwnerOf, isTlActionable, parseDisputeOwner, tlEditStatus } from '../lib/dispute-owner';
import { diffTrackedSettings, restoreToConfigPatch } from '../lib/settings-history-keys';

test('the owner comes from the saved config: only "tl" means TL, anything else (or no config) is QA', () => {
  assert.equal(disputeOwnerOf({ disputeOwner: 'tl' }), 'tl');
  assert.equal(disputeOwnerOf({ disputeOwner: 'qa' }), 'qa');
  assert.equal(disputeOwnerOf({}), 'qa');
  assert.equal(disputeOwnerOf({ disputeOwner: 'TL' }), 'qa');
  assert.equal(disputeOwnerOf(null), 'qa');
});

test('saving the owner validates the value', () => {
  assert.deepEqual(parseDisputeOwner('tl'), { ok: true, value: 'tl' });
  assert.deepEqual(parseDisputeOwner('qa'), { ok: true, value: 'qa' });
  for (const bad of ['', 'admin', 'TL', null, undefined, 1, true]) assert.equal(parseDisputeOwner(bad).ok, false, String(bad));
});

test('changing the owner is recorded in the settings history and can be restored', () => {
  assert.deepEqual(diffTrackedSettings({}, { disputeOwner: 'tl' }).map(c => [c.key, c.oldValue, c.newValue]), [['disputeOwner', null, 'tl']]);
  assert.deepEqual(diffTrackedSettings({ disputeOwner: 'tl' }, { disputeOwner: 'qa' }).map(c => [c.key, c.oldValue, c.newValue]), [['disputeOwner', 'tl', null]]);
  assert.deepEqual(diffTrackedSettings({}, { disputeOwner: 'qa' }), []);          // QA saved explicitly is still the default
  assert.deepEqual(restoreToConfigPatch('disputeOwner', null), { ok: true, patch: { disputeOwner: 'qa' } });
  assert.deepEqual(restoreToConfigPatch('disputeOwner', 'tl'), { ok: true, patch: { disputeOwner: 'tl' } });
});

test('TL queue: open IR disputes (incl. already forwarded to QA); never TL-raised or decided ones; empty when QA owns', () => {
  const f = (status: string, raisedByRole: any) => ({ status, raisedByRole } as any);
  for (const s of ['pending', 'ir_pending_tl', 'tl_forwarded']) assert.equal(isTlActionable(f(s, 'ir'), 'tl'), true, s);
  assert.equal(isTlActionable(f('tl_forwarded', 'tl'), 'tl'), false);   // raised by a TL: stays with QA
  for (const s of ['reviewed', 'tl_resolved', 'cancelled']) assert.equal(isTlActionable(f(s, 'ir'), 'tl'), false, s);
  assert.equal(isTlActionable(f('pending', 'ir'), 'qa'), false);        // QA owns: nothing is in the TL queue
});

test('agentInTeam matches full names and the Robylon / portal prefix variants, nothing else', () => {
  const team = ['Anushka choudhary', 'Sai Devakar'];
  assert.equal(agentInTeam(team, 'anushka CHOUDHARY'), true);
  assert.equal(agentInTeam(team, 'Sai'), true);                    // portal name is a prefix of the full name
  assert.equal(agentInTeam(team, 'Sai Devakar Rao'), true);        // Robylon name extends the team name
  assert.equal(agentInTeam(team, 'Saiyan'), false);
  assert.equal(agentInTeam(team, ''), false);
  assert.equal(agentInTeam(team, null), false);
  assert.equal(agentInTeam([], 'Sai Devakar'), false);             // a TL with no agents resolves nothing
});

test('TL edit keeps at-or-below-threshold items in the QA audit queue, otherwise marks reviewed', () => {
  assert.equal(tlEditStatus(85, 85, 'pending'), 'pending');        // exactly at the threshold is audited
  assert.equal(tlEditStatus(70, 85, 'reopened'), 'reopened');
  assert.equal(tlEditStatus(86, 85, 'pending'), 'reviewed');       // fixed by the TL above the threshold: leaves the queue
  assert.equal(tlEditStatus(60, 85, 'reviewed'), 'reviewed');      // QA already reviewed it: do not re-queue
  assert.equal(tlEditStatus(60, 85, null), 'reviewed');
  assert.equal(tlEditStatus(null, 85, 'pending'), 'reviewed');     // no score: nothing to audit by threshold
  assert.equal(tlEditStatus(95, 85, 'pending', true), 'pending');  // critical gate failure (calls) is audited at any score
});
