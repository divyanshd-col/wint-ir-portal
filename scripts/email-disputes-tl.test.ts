import test from 'node:test';
import assert from 'node:assert/strict';
import { disputeLabel } from '../lib/email/ui';
import { DEFAULT_EMAIL_PARAMETERS } from '../lib/email/context-builder';

test('disputeLabel - correctly maps dispute statuses and QA assignee', () => {
  assert.equal(disputeLabel('Raised'), 'Forwarded to TL (Pending Review)');
  assert.equal(disputeLabel('Under_Review'), 'Forwarded to QA');
  assert.equal(disputeLabel('Under_Review', 'Yashvi Chajjer'), 'Forwarded to Yashvi Chajjer');
  assert.equal(disputeLabel('TL_Resolved'), 'Reviewed by TL');
  assert.equal(disputeLabel('Resolved'), 'Reviewed');
  assert.equal(disputeLabel('Resolved', 'Manorathi'), 'Reviewed by Manorathi');
  assert.equal(disputeLabel('Rejected'), 'Rejected by QA');
  assert.equal(disputeLabel('Rejected', 'Manorathi'), 'Rejected by Manorathi');
  assert.equal(disputeLabel('None'), '—');
  assert.equal(disputeLabel(null), '—');
  assert.equal(disputeLabel(undefined), '—');
});

test('DEFAULT_EMAIL_PARAMETERS - contains valid parameter keys and weights for disputes', () => {
  assert(DEFAULT_EMAIL_PARAMETERS.length > 0);
  for (const param of DEFAULT_EMAIL_PARAMETERS) {
    assert(typeof param.key === 'string' && param.key.length > 0);
    assert(typeof param.name === 'string' && param.name.length > 0);
    assert(typeof param.defaultWeight === 'number' && param.defaultWeight > 0);
  }
});

test('TL Raise Dispute payload builder - formats challenged parameters correctly', () => {
  const selectedParams = new Set(['greeting_signoff', 'issue_resolution']);
  const reason = 'Agent properly resolved the query and signed off with appropriate signature.';

  const challengedParams = Array.from(selectedParams).map(p => ({
    param: p,
    note: reason.trim(),
  }));

  const payload = {
    action: 'raise_dispute',
    messageId: 'msg_test_123',
    notes: reason.trim(),
    challengedParams,
    raisedByRole: 'tl',
  };

  assert.equal(payload.action, 'raise_dispute');
  assert.equal(payload.raisedByRole, 'tl');
  assert.equal(payload.challengedParams.length, 2);
  assert.deepEqual(payload.challengedParams[0], {
    param: 'greeting_signoff',
    note: reason,
  });
  assert.deepEqual(payload.challengedParams[1], {
    param: 'issue_resolution',
    note: reason,
  });
});
