import './_load-env';
import { sendEmailComplianceSlackAlert } from '../lib/email/compliance-alert';

async function main() {
  const testTicketId = `ticket_test_${Date.now()}`;
  const testMessageId = `msg_test_${Date.now()}`;
  console.log(`Sending test email compliance alert for ticket ${testTicketId}...`);

  const success = await sendEmailComplianceSlackAlert({
    ticketId: '8f23ed60-8df8-44e0-bce1-093e450c469b',
    messageId: '2b6868e9-cc26-4dc4-bcac-88709749bf19',
    agentName: 'Sneha',
    qualityScore: 65,
    complianceIssues: [
      '[TEST] The attachment filename contains a different Client ID (1346374) than the one provided by the customer (22697644), suggesting the wrong account details may have been shared.',
    ],
    replySnippet: `<p data-pm-slice="1 1 []" style="margin: 0px 0px 0.25em; padding: 0px; font-family: system-ui, &quot;Segoe UI&quot;, Roboto, Helvetica, Arial, sans-serif; font-size: 13px;"><span>Dear Investor,</span></p><p>&nbsp;</p><p>We understand that you have downloaded your Investment Summary Report, which is available only in Excel format. We’re unable to provide this report in PDF format, as converting it may affect its layout and readability.</p><p>&nbsp;</p><p>However, we can provide your transaction statement from NSDL. I’ve requested it from our team, and since it is the end of the day, we expect to share it with you by tomorrow at this email address.</p><p>&nbsp;</p><p>In the meantime, I’ve attached your master report for your reference. We understand that you’re unable to open the Excel file and apologize for the inconvenience.</p>`,
    evaluatedAt: new Date().toISOString(),
  });

  console.log(`Email compliance alert result: ${success ? 'SUCCESS' : 'FAILED'}`);
}

main().catch(err => {
  console.error('Error sending test alert:', err);
  process.exit(1);
});

