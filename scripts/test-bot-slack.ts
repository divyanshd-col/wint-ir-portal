import './_load-env';
import { fireBotQualityAlert, checkBotFailure } from '../lib/quality-alert';

async function main() {
  console.log('Testing BOT failure condition logic...');

  // Test case 1: Both NO -> should be failure
  const test1 = checkBotFailure({
    issue_resolution: 'No',
    correct_escalation: 'false',
  });
  console.log('Test 1 (both NO):', test1.isFailure ? 'PASSED (is failure)' : 'FAILED');

  // Test case 2: Issue Resolution YES, Correct Escalation NO -> should NOT be failure
  const test2 = checkBotFailure({
    issue_resolution: 'Yes',
    correct_escalation: 'No',
  });
  console.log('Test 2 (one YES, one NO):', !test2.isFailure ? 'PASSED (not failure)' : 'FAILED');

  // Test case 3: Transferred chat (hybrid or isTransferred: true) should NOT trigger BOT alert
  const testTransferred1 = await fireBotQualityAlert({
    chatId: `test_transferred_${Date.now()}`,
    conversationType: 'hybrid',
    scores: {
      issue_resolution: 'No',
      correct_escalation: 'No',
    },
  });
  console.log('Test 3 (hybrid / transferred chat):', !testTransferred1 ? 'PASSED (skipped)' : 'FAILED');

  const testTransferred2 = await fireBotQualityAlert({
    chatId: `test_transferred_flag_${Date.now()}`,
    isTransferred: true,
    scores: {
      issue_resolution: 'No',
      correct_escalation: 'No',
    },
  });
  console.log('Test 4 (isTransferred flag):', !testTransferred2 ? 'PASSED (skipped)' : 'FAILED');

  const testAgent = await fireBotQualityAlert({
    chatId: `test_agent_${Date.now()}`,
    conversationType: 'agent',
    scores: {
      issue_resolution: 'No',
      correct_escalation: 'No',
    },
  });
  console.log('Test 5 (agent chat):', !testAgent ? 'PASSED (skipped)' : 'FAILED');

  // Test case 6: Pure bot chat triggering Slack alert
  const testChatId = `test_bot_${Date.now()}`;
  console.log(`\nSending test pure BOT quality alert for chat ${testChatId}...`);

  const sent = await fireBotQualityAlert({
    chatId: testChatId,
    agentName: 'Myra (Bot)',
    conversationType: 'bot',
    isTransferred: false,
    scores: {
      issue_resolution: 'No',
      correct_escalation: 'No',
    },
    reasoning: {
      issue_resolution: 'Bot failed to answer customer question regarding FD interest rate.',
      correct_escalation: 'Bot failed to transfer customer to a human agent after 3 failed attempts.',
    },
    iqs: 30,
    disposition: 'FD Information Query',
  });

  console.log(`BOT Quality Alert test result: ${sent ? 'SUCCESS' : 'FAILED / DUPED'}`);
}

main().catch(err => {
  console.error('Error running BOT Slack test:', err);
  process.exit(1);
});
