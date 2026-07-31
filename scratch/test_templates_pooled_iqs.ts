import { postProcessTemplateRows, buildQuery } from '../lib/analytics/templates';
import { extractPooledParams, calculateWeightedOverallIQS } from '../lib/quality';

console.log('Testing postProcessTemplateRows & pooled weighted IQS...');

// Test 1: extractPooledParams
const sampleParams = [
  {
    __agent_parameters: {
      accuracy: { score: 'Yes' },
      issue_resolution: { score: 'Yes' },
      empathy: { score: 'NA' },
    },
  },
  {
    __agent_parameters: {
      accuracy: { score: 'Half' },
      issue_resolution: { score: 'No' },
      empathy: { score: 'Yes' },
    },
  },
];

const pooled = extractPooledParams(sampleParams);
console.log('Pooled params:', pooled);

const weighted = calculateWeightedOverallIQS(pooled, 'human', { roundDecimals: 1 });
console.log('Weighted IQS:', weighted);

if (weighted === null || isNaN(weighted)) {
  console.error('FAILED: weighted is null or NaN');
  process.exit(1);
}

// Test 2: postProcessTemplateRows top_agents_by_metric
const mockAgentRows = [
  { agent: 'Agent A', avg_iqs: 50.0, chats: 5, parameters: sampleParams },
];
postProcessTemplateRows('top_agents_by_metric', { metricName: 'avg_iqs' }, mockAgentRows);
console.log('Processed mockAgentRows:', mockAgentRows);

if (mockAgentRows[0].parameters !== undefined) {
  console.error('FAILED: parameters column was not deleted');
  process.exit(1);
}

if (mockAgentRows[0].avg_iqs === 50.0) {
  console.error('FAILED: avg_iqs was not updated to weighted score');
  process.exit(1);
}

console.log('SUCCESS! All pooled weighted IQS unit checks passed.');
