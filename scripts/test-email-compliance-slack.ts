import './_load-env';
import { sendEmailComplianceSlackAlert } from '../lib/email/compliance-alert';

async function main() {
  const testTicketId = `ticket_test_${Date.now()}`;
  const testMessageId = `msg_test_${Date.now()}`;
  console.log(`Sending test email compliance alert for ticket ${testTicketId}...`);

  const success = await sendEmailComplianceSlackAlert({
    ticketId: 'TEST-EMAIL-001',
    messageId: 'MSG-TEST-001',
    agentName: 'Hasan Merchant',
    qualityScore: 50,
    complianceIssues: [
      '[TEST] Verifying dedicated Slack channel for email compliance flags.',
      '[TEST] Confirming alerts are successfully routed to C0CERSWEXTM (#compliance-flag-emails).',
    ],
    replySnippet: 'This is a test notification confirming email compliance alerts are isolated from the chat compliance-flag channel.',
    evaluatedAt: new Date().toISOString(),
  });

  console.log(`Email compliance alert result: ${success ? 'SUCCESS' : 'FAILED'}`);
}

main().catch(err => {
  console.error('Error sending test alert:', err);
  process.exit(1);
});

