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

  // Test case 6: Pure bot chat WITHOUT transcript should be skipped (not triggered)
  const testChatIdNoTranscript = `test_bot_no_transcript_${Date.now()}`;
  console.log(`\nTesting pure BOT chat WITHOUT transcript (${testChatIdNoTranscript})...`);

  const sentWithoutTranscript = await fireBotQualityAlert({
    chatId: testChatIdNoTranscript,
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

  console.log('Test 6 (missing transcript skipped):', !sentWithoutTranscript ? 'PASSED (skipped)' : 'FAILED');

  // Test case 7: Pure bot chat WITH transcript triggering Slack alert + summary of what happened
  const testChatId2 = `test_bot_ai_${Date.now()}`;
  console.log(`\nSending test pure BOT quality alert with transcript for chat ${testChatId2}...`);

  const sent2 = await fireBotQualityAlert({
    chatId: testChatId2,
    agentName: 'Myra (Bot)',
    conversationType: 'bot',
    isTransferred: false,
    scores: {
      issue_resolution: 'No',
      correct_escalation: 'No',
    },
    reasoning: {
      issue_resolution: 'Bot provided generic FD rates instead of premature withdrawal penalty details.',
      correct_escalation: 'Bot did not connect to human representative despite customer asking for an executive.',
    },
    iqs: 25,
    disposition: 'Fixed Deposit',
    subDisposition: 'Premature Withdrawal',
    transcript: `Customer: Hi, I want to withdraw my Bajaj Finance FD early. What will be the penalty deduction?
Bot: Welcome to Wint Wealth! You can explore multiple high yield FDs on our platform.
Customer: I am asking about my existing FD withdrawal penalty, please answer my question or connect me to an agent.
Bot: Our FD rates go up to 9.1% p.a. Bajaj Finance FDs are rated AAA.
Customer: This is useless. Connect me to a human support executive now!
Bot: Thank you for contacting Wint Wealth! Have a nice day.`,
  });

  console.log(`BOT Quality Alert test 2 (with transcript) result: ${sent2 ? 'SUCCESS' : 'FAILED / DUPED'}`);
}

main().catch(err => {
  console.error('Error running BOT Slack test:', err);
  process.exit(1);
});
