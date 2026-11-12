/**
 * TL-owned dispute resolution: ownership switch, queue membership, team matching and the QA audit-queue rule.
 * Run: npx tsx --test scripts/dispute-owner.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentInTeam, disputesOwnedByTL, isTlActionable, tlEditStatus } from '../lib/dispute-owner';

const withOwner = (v: string | undefined, fn: () => void) => {
  const prev = process.env.DISPUTES_OWNER;
  if (v === undefined) delete process.env.DISPUTES_OWNER; else process.env.DISPUTES_OWNER = v;
  try { fn(); } finally { if (prev === undefined) delete process.env.DISPUTES_OWNER; else process.env.DISPUTES_OWNER = prev; }
};

test('ownership is off unless DISPUTES_OWNER=tl', () => {
  withOwner(undefined, () => assert.equal(disputesOwnedByTL(), false));
  withOwner('qa', () => assert.equal(disputesOwnedByTL(), false));
  withOwner('tl', () => assert.equal(disputesOwnedByTL(), true));
});

test('TL queue: open IR disputes (incl. already forwarded to QA); never TL-raised or decided ones; empty when QA owns', () => {
  const f = (status: string, raisedByRole: any) => ({ status, raisedByRole } as any);
  withOwner('tl', () => {
    for (const s of ['pending', 'ir_pending_tl', 'tl_forwarded']) assert.equal(isTlActionable(f(s, 'ir')), true, s);
    assert.equal(isTlActionable(f('tl_forwarded', 'tl')), false);   // raised by a TL: stays with QA
    for (const s of ['reviewed', 'tl_resolved', 'cancelled']) assert.equal(isTlActionable(f(s, 'ir')), false, s);
  });
  withOwner(undefined, () => assert.equal(isTlActionable(f('pending', 'ir')), false));
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
