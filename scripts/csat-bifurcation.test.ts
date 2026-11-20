import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CSAT_BIFURCATION,
  getCsatBifurcationList,
  classifyChatCsat,
  makeBifurcationKey,
} from '../lib/csat-bifurcation';

test('DEFAULT_CSAT_BIFURCATION contains 85 entries (17 unsolvable, 68 solvable)', () => {
  assert.equal(DEFAULT_CSAT_BIFURCATION.length, 85);
  const unsolvable = DEFAULT_CSAT_BIFURCATION.filter(e => e.type === 'unsolvable');
  const solvable = DEFAULT_CSAT_BIFURCATION.filter(e => e.type === 'solvable');
  assert.equal(unsolvable.length, 17);
  assert.equal(solvable.length, 68);
});

test('classifyChatCsat - Solvable chat retains raw customer CSAT regardless of IQS', () => {
  // Good CSAT with IQS 95
  const res1 = classifyChatCsat('Asset', 'Asset General Enquiry', 95, 'good');
  assert.equal(res1.bifurcation, 'solvable');
  assert.equal(res1.bifurcatedCsatLabel, 'good');

  // Bad CSAT with IQS 95 -> remains bad because it is solvable
  const res2 = classifyChatCsat('Asset', 'Asset General Enquiry', 95, 'bad');
  assert.equal(res2.bifurcation, 'solvable');
  assert.equal(res2.bifurcatedCsatLabel, 'bad');

  // Could be better CSAT with IQS 100 -> remains could_be_better
  const res3 = classifyChatCsat('Taxation', 'Form 121', 100, 'could_be_better');
  assert.equal(res3.bifurcation, 'solvable');
  assert.equal(res3.bifurcatedCsatLabel, 'could_be_better');

  // No CSAT -> remains null
  const res4 = classifyChatCsat('Asset', 'Asset General Enquiry', 95, null);
  assert.equal(res4.bifurcation, 'solvable');
  assert.equal(res4.bifurcatedCsatLabel, null);
});

test('classifyChatCsat - Unsolvable chat with customer CSAT and IQS >= 90 upgrades to good CSAT', () => {
  // Bad CSAT with IQS 100 on unsolvable issue -> upgraded to 'good'
  const res1 = classifyChatCsat('Interest Repayment', 'Interest / Principal Not Credited', 100, 'bad');
  assert.equal(res1.bifurcation, 'unsolvable');
  assert.equal(res1.bifurcatedCsatLabel, 'good');

  // Could be better with IQS 90 -> upgraded to 'good'
  const res2 = classifyChatCsat('Bond Purchase', 'Bond Purchase Issue', 90, 'could_be_better');
  assert.equal(res2.bifurcation, 'unsolvable');
  assert.equal(res2.bifurcatedCsatLabel, 'good');

  // Good CSAT with IQS 95 -> remains 'good'
  const res3 = classifyChatCsat('Liquidity', 'Liquidity Funds Not Received', 95, 'good');
  assert.equal(res3.bifurcation, 'unsolvable');
  assert.equal(res3.bifurcatedCsatLabel, 'good');
});

test('classifyChatCsat - Unsolvable chat with customer CSAT and IQS < 90 keeps raw rating', () => {
  const res1 = classifyChatCsat('Interest Repayment', 'Interest / Principal Not Credited', 85, 'bad');
  assert.equal(res1.bifurcation, 'unsolvable');
  assert.equal(res1.bifurcatedCsatLabel, 'bad');

  const res2 = classifyChatCsat('Bond Purchase', 'Bond Purchase Issue', 70, 'could_be_better');
  assert.equal(res2.bifurcation, 'unsolvable');
  assert.equal(res2.bifurcatedCsatLabel, 'could_be_better');
});

test('classifyChatCsat - Unsolvable chat without customer CSAT remains null', () => {
  const res = classifyChatCsat('Interest Repayment', 'Interest / Principal Not Credited', 100, null);
  assert.equal(res.bifurcation, 'unsolvable');
  assert.equal(res.bifurcatedCsatLabel, null);
});

test('classifyChatCsat - Unmapped disposition or missing sub-disposition returns null bifurcation', () => {
  const res1 = classifyChatCsat('Unknown Disposition', 'Some Sub', 95, 'good');
  assert.equal(res1.bifurcation, null);
  assert.equal(res1.bifurcatedCsatLabel, 'good');

  const res2 = classifyChatCsat('Asset', '', 95, 'good');
  assert.equal(res2.bifurcation, null);
  assert.equal(res2.bifurcatedCsatLabel, 'good');
});

test('classifyChatCsat - Uses live config override when provided', () => {
  // Move 'Bond Purchase Issue' from unsolvable to solvable via config
  const customConfig = {
    csatBifurcationMap: [
      { disposition: 'Bond Purchase', subDisposition: 'Bond Purchase Issue', type: 'solvable' as const },
    ],
  };

  const res = classifyChatCsat('Bond Purchase', 'Bond Purchase Issue', 95, 'bad', customConfig);
  assert.equal(res.bifurcation, 'solvable');
  assert.equal(res.bifurcatedCsatLabel, 'bad'); // Because solvable does not upgrade
});
