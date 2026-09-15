import { query } from '../lib/cx/db';

async function run() {
  console.log('--- Starting Data Correction for Chat 150282 and Call 150347 ---');

  // 1. Fetch Chat 150282
  const chatRows = await query(`SELECT chat_id, iqs_score, parameters FROM iqs_scores WHERE chat_id = '150282'`);
  if (!chatRows.length) {
    throw new Error('Chat 150282 not found in iqs_scores');
  }

  const chat = chatRows[0];
  const params = typeof chat.parameters === 'string' ? JSON.parse(chat.parameters) : chat.parameters;

  // Filter out guaranteed_returns from __breaches
  if (Array.isArray(params.__breaches)) {
    params.__breaches = params.__breaches.filter((b: string) => !b.toLowerCase().includes('guaranteed_returns'));
  }
  // Clear call-related uncertainty on Accuracy
  params.__uncertain = [];

  // Restore Accuracy score to true for agent
  if (params.__agent_parameters?.accuracy) {
    params.__agent_parameters.accuracy.score = true;
    params.__agent_parameters.accuracy.reasoning =
      'All responses provided in the chat were accurate and properly addressed the customer queries. (Voice call statement isolated to call evaluation).';
  }
  if (params.__scores) {
    params.__scores.agent_iqs = 100;
  }

  await query(`
    UPDATE iqs_scores
    SET iqs_score = 100,
        parameters = $1::jsonb
    WHERE chat_id = '150282'
  `, [JSON.stringify(params)]);
  console.log('✅ Chat 150282 updated: iqs_score = 100, Accuracy = true, __breaches cleared.');

  // 2. Fetch Call 150347
  const callRows = await query(`SELECT * FROM call_evaluations WHERE call_id = '150347'`);
  if (!callRows.length) {
    throw new Error('Call 150347 not found in call_evaluations');
  }

  const callEval = callRows[0];
  const gates = typeof callEval.gates === 'string' ? JSON.parse(callEval.gates) : (callEval.gates || {});

  gates.G1_no_advice = {
    status: 'fail',
    reason_code: 'advice_investment',
    evidence: [
      {
        quote: 'we cannot guarantee it, but if you have invested in senior secured bonds, you will get the principal amount back.',
        why: 'Promising or implying guaranteed return of principal on senior secured bonds violates compliance gate G1.',
        turn: 140,
        speaker: 'IR_EXECUTIVE'
      }
    ],
    borderline: []
  };

  await query(`
    UPDATE call_evaluations
    SET call_gate_result = 'FAIL',
        verdict = 'FAILED_CRITICAL',
        agent_id = 817,
        gates = $1::jsonb
    WHERE call_id = '150347'
  `, [JSON.stringify(gates)]);

  await query(`
    UPDATE call_recordings
    SET agent_id = 817,
        updated_at = NOW()
    WHERE id = '150347'
  `);

  console.log('✅ Call 150347 updated: call_gate_result = FAIL, verdict = FAILED_CRITICAL, agent_id = 817 (Shreya), G1_no_advice failed.');
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Error running fix:', err);
    process.exit(1);
  });
