import test from 'node:test';
import assert from 'node:assert/strict';
import { getTLSlackMention } from '../lib/quality-alert';
import { getAgentTLByName } from '../lib/robylon/db';

test('getTLSlackMention - maps Vedant G correctly', () => {
  assert.equal(getTLSlackMention('Vedant G'), '<@U09HZTDQZBP>');
  assert.equal(getTLSlackMention('vedant g'), '<@U09HZTDQZBP>');
  assert.equal(getTLSlackMention('Vedant'), '<@U09HZTDQZBP>');
});

test('getTLSlackMention - maps Kriti correctly', () => {
  assert.equal(getTLSlackMention('Kriti'), '<@U091YMP33DF>');
  assert.equal(getTLSlackMention('kriti patait'), '<@U091YMP33DF>');
  assert.equal(getTLSlackMention('Kriti Patait'), '<@U091YMP33DF>');
});

test('getTLSlackMention - falls back to agentName when tlName is missing or N/A', () => {
  // Hasan Merchant -> Vedant G
  assert.equal(getTLSlackMention('', 'Hasan Merchant'), '<@U09HZTDQZBP>');
  assert.equal(getTLSlackMention('N/A', 'Hasan Merchant'), '<@U09HZTDQZBP>');
  assert.equal(getTLSlackMention(undefined, 'hasan merchant'), '<@U09HZTDQZBP>');

  // Nitya Sharma -> Kriti
  assert.equal(getTLSlackMention('', 'Nitya Sharma'), '<@U091YMP33DF>');
  assert.equal(getTLSlackMention('N/A', 'Nitya Sharma'), '<@U091YMP33DF>');
  assert.equal(getTLSlackMention(undefined, 'nitya sharma'), '<@U091YMP33DF>');
});

test('getTLSlackMention - does not conflate Nityaa with Nitya Sharma', () => {
  // If agent is Nityaa, fallback should not trigger Kriti
  assert.equal(getTLSlackMention('', 'Nityaa'), 'N/A');
  // If tlName is Anusha for Nityaa, it tags Anusha
  assert.equal(getTLSlackMention('Anusha', 'Nityaa'), '<@U08LEA04YUR>');
});

test('getAgentTLByName - fallback mappings when DB query cannot find row', async () => {
  const origErr = console.error;
  console.error = () => {};
  try {
    // Hasan fallback
    const hasanTL = await getAgentTLByName('Hasan Merchant');
    assert.equal(hasanTL, 'Vedant G');

    // Nitya fallback
    const nityaTL = await getAgentTLByName('Nitya Sharma');
    assert.equal(nityaTL, 'Kriti');
  } finally {
    console.error = origErr;
  }
});


