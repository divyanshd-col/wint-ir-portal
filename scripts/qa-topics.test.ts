import test from 'node:test';
import assert from 'node:assert/strict';
import { topicKey, findDefinedTopic } from '../lib/qa-topics';

const defined = ['Others', 'Liquidity', 'Flexi-Tenure Bond'];

test('findDefinedTopic ignores case and spaces and returns the defined spelling', () => {
  assert.equal(findDefinedTopic(defined, 'OTHERS'), 'Others');
  assert.equal(findDefinedTopic(defined, '  liquidity '), 'Liquidity');
  assert.equal(findDefinedTopic(defined, 'FLEXI-TENURE BOND'), 'Flexi-Tenure Bond');
});

test('findDefinedTopic is undefined for empty, None and unowned topics', () => {
  for (const t of [undefined, null, '', '   ', 'None', 'SEBI KYC']) assert.equal(findDefinedTopic(defined, t), undefined);
});

test('topicKey normalises', () => {
  assert.equal(topicKey(' Calls_Directly '), 'calls_directly');
  assert.equal(topicKey(null), '');
});
