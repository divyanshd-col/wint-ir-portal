import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COMPLIANCE_GATES_LIST,
  resolveGateData,
  findEmailBreachesForGate,
} from '../components/quality/EmailEvaluationPage';

test('COMPLIANCE_GATES_LIST contains expected compliance gates for emails', () => {
  assert.equal(COMPLIANCE_GATES_LIST.length, 3);
  const keys = COMPLIANCE_GATES_LIST.map(g => g.key);
  assert.deepEqual(keys, ['G1_no_advice', 'G2_no_fabrication', 'G3_identity_first']);
  assert.equal(COMPLIANCE_GATES_LIST[0].shortLabel, 'G1 Advice');
  assert.equal(COMPLIANCE_GATES_LIST[1].shortLabel, 'G2 Fabrication');
  assert.equal(COMPLIANCE_GATES_LIST[2].shortLabel, 'G3 Identity');
});

test('resolveGateData - defaults to pass when compliant and no issues', () => {
  COMPLIANCE_GATES_LIST.forEach(g => {
    const res = resolveGateData(undefined, g.key, g.altKey, [], true);
    assert.equal(res.status, 'pass');
    assert.equal(res.reasoning, '');
  });
});

test('resolveGateData - maps G1 breach (guaranteed returns / investment advice / disclaimers)', () => {
  const issues = ['Guaranteed returns promised in second paragraph'];
  const g1 = resolveGateData(undefined, 'G1_no_advice', 'G1', issues, false);
  const g2 = resolveGateData(undefined, 'G2_no_fabrication', 'G2', issues, false);
  const g3 = resolveGateData(undefined, 'G3_identity_first', 'G3', issues, false);

  assert.equal(g1.status, 'fail');
  assert.equal(g1.reasoning, 'Guaranteed returns promised in second paragraph');
  assert.equal(g2.status, 'pass');
  assert.equal(g3.status, 'pass');
});

test('resolveGateData - maps G2 breach (misleading timeline / fabricated facts)', () => {
  const issues = ['Misinformed customer regarding withdrawal turnaround timeline'];
  const g1 = resolveGateData(undefined, 'G1_no_advice', 'G1', issues, false);
  const g2 = resolveGateData(undefined, 'G2_no_fabrication', 'G2', issues, false);
  const g3 = resolveGateData(undefined, 'G3_identity_first', 'G3', issues, false);

  assert.equal(g1.status, 'pass');
  assert.equal(g2.status, 'fail');
  assert.equal(g2.reasoning, 'Misinformed customer regarding withdrawal turnaround timeline');
  assert.equal(g3.status, 'pass');
});

test('resolveGateData - maps G3 breach (disclosing client details / PII leakage)', () => {
  const issues = ["Disclosed another client's folio and confidential statement"];
  const g1 = resolveGateData(undefined, 'G1_no_advice', 'G1', issues, false);
  const g2 = resolveGateData(undefined, 'G2_no_fabrication', 'G2', issues, false);
  const g3 = resolveGateData(undefined, 'G3_identity_first', 'G3', issues, false);

  assert.equal(g1.status, 'pass');
  assert.equal(g2.status, 'pass');
  assert.equal(g3.status, 'fail');
  assert.equal(g3.reasoning, "Disclosed another client's folio and confidential statement");
});

test('resolveGateData - unclassified compliance issue falls back to G2 to prevent dropped breach', () => {
  const issues = ['Unprofessional language used towards user'];
  const g1 = resolveGateData(undefined, 'G1_no_advice', 'G1', issues, false);
  const g2 = resolveGateData(undefined, 'G2_no_fabrication', 'G2', issues, false);
  const g3 = resolveGateData(undefined, 'G3_identity_first', 'G3', issues, false);

  assert.equal(g1.status, 'pass');
  assert.equal(g2.status, 'fail');
  assert.equal(g2.reasoning, 'Unprofessional language used towards user');
  assert.equal(g3.status, 'pass');
});

test('resolveGateData - loads persisted __gates object when present', () => {
  const savedGates = {
    G1_no_advice: { status: 'pass', reasoning: '' },
    G2_no_fabrication: { status: 'fail', reasoning: 'QA verified false timeline' },
    G3_identity_first: { status: 'not_applicable', reasoning: '' },
  };

  const g1 = resolveGateData(savedGates, 'G1_no_advice', 'G1');
  const g2 = resolveGateData(savedGates, 'G2_no_fabrication', 'G2');
  const g3 = resolveGateData(savedGates, 'G3_identity_first', 'G3');

  assert.equal(g1.status, 'pass');
  assert.equal(g2.status, 'fail');
  assert.equal(g2.reasoning, 'QA verified false timeline');
  assert.equal(g3.status, 'not_applicable');
});

test('findEmailBreachesForGate - handles structured objects with prefix colon stripping', () => {
  const raw = ['G1: Investment advice provided without disclaimer'];
  const matched = findEmailBreachesForGate(raw, 'G1_no_advice');
  assert.equal(matched, 'Investment advice provided without disclaimer');
});

