import './_load-env';
import { fireQualityAlert } from '../lib/quality-alert';

async function main() {
  const testChatId = `test_bot_${Date.now()}`;
  console.log(`Sending test compliance alert for bot chat ${testChatId}...`);

  await fireQualityAlert({
    chatId: testChatId,
    agentName: 'Myra',
    conversationType: 'bot',
    isBot: true,
    scores: { Accuracy: 'false' },
    reasoning: { Accuracy: 'Bot shared incorrect compliance info.' },
    iqs: 40,
    disposition: 'Product Query',
    breaches: [
      {
        type: 'TEST_BOT_COMPLIANCE',
        quote: 'Testing compliance alert for bot handled chat.',
        note: 'Test trigger: verifying TL tags <@U09LS1TSY5T>',
      },
    ],
    complianceFlag: true,
  });

  console.log('Compliance alert sent successfully!');
}

main().catch(err => {
  console.error('Error sending test alert:', err);
  process.exit(1);
});
