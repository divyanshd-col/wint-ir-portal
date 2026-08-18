import { fireQualityAlert } from '../lib/quality-alert';

async function main() {
  const testChatId = `test_${Date.now()}`;
  console.log(`Sending test compliance alert for chat ${testChatId}...`);

  await fireQualityAlert({
    chatId: testChatId,
    agentName: 'Aksa Jacob',
    scores: { Accuracy: 'false' },
    reasoning: { Accuracy: 'Agent guaranteed returns on a fixed income product.' },
    iqs: 40,
    disposition: 'Product Query',
    breaches: [
      {
        type: 'guaranteed_returns',
        quote: 'Your investment gives guaranteed 14% returns with zero risk.',
        note: 'Stated assured returns',
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
