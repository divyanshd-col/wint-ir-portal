/**
 * lib/email/compliance-alert.ts
 *
 * Sends Slack alert to the dedicated #compliance-flag-emails channel
 * when an email reply fails compliance checks (Tripwire gates C1-C5).
 * Kept separate from chat/call compliance flags (#compliance-flag).
 */

import { postSlackMessage } from '@/lib/slack';
import { readConfig } from '@/lib/config';
import { getTLSlackMention } from '@/lib/quality-alert';

export interface EmailComplianceAlertPayload {
  ticketId: string;
  messageId: string;
  agentName: string;
  tlName?: string;
  qualityScore: number;
  complianceIssues: string[];
  replySnippet?: string;
  evaluatedAt?: string;
}

export function getEmailComplianceSlackChannel(): string {
  return (
    process.env.COMPLIANCE_EMAIL_SLACK_WEBHOOK_URL ||
    process.env.COMPLIANCE_EMAIL_SLACK_CHANNEL ||
    process.env.EMAIL_COMPLIANCE_SLACK_CHANNEL ||
    process.env.COMPLIANCE_FLAG_EMAILS_SLACK_CHANNEL ||
    'C0CERSWEXTM'
  );
}

export async function sendEmailComplianceSlackAlert(
  data: EmailComplianceAlertPayload
): Promise<boolean> {
  try {
    const config = await readConfig().catch(() => ({} as any));
    const token =
      process.env.COMPLIANCE_EMAIL_SLACK_BOT_TOKEN ||
      process.env.COMPLIANCE_SLACK_BOT_TOKEN ||
      process.env.SLACK_BOT_TOKEN ||
      config.slackUserToken ||
      '';

    const channel = getEmailComplianceSlackChannel();

    const issuesList = data.complianceIssues.length > 0
      ? data.complianceIssues.map(i => `• ${i}`).join('\n')
      : '• Non-compliant phrasing or policy violation';

    const snippet = data.replySnippet
      ? `\n> *Agent Reply:*\n> _${data.replySnippet.slice(0, 300).replace(/\n/g, ' ')}${data.replySnippet.length > 300 ? '…' : ''}_`
      : '';

    const tlMention = getTLSlackMention(data.tlName, data.agentName);
    const tlDisplay = tlMention && tlMention !== 'N/A' ? tlMention : null;

    const text = `🚨 *Email Reply Compliance Breach Detected*
*Agent:* ${data.agentName}${tlDisplay ? `\n*TL:* ${tlDisplay}` : ''}
*Ticket ID:* \`${data.ticketId}\` | *Message ID:* \`${data.messageId}\`
*Quality Score:* ${data.qualityScore}%
*Issues Found:*
${issuesList}${snippet}
*Action Required:* Review in QA Email Evaluation Portal: /quality/email-evaluation?ticketId=${encodeURIComponent(data.ticketId)}`;

    const fields: any[] = [
      { type: 'mrkdwn', text: `*Agent:*\n${data.agentName}` },
      { type: 'mrkdwn', text: `*Quality Score:*\n${data.qualityScore}%` },
      { type: 'mrkdwn', text: `*Ticket ID:*\n\`${data.ticketId}\`` },
      { type: 'mrkdwn', text: `*Evaluated:*\n${new Date(data.evaluatedAt || Date.now()).toLocaleTimeString()}` },
    ];

    if (tlDisplay) {
      fields.splice(1, 0, { type: 'mrkdwn', text: `*TL:*\n${tlDisplay}` });
    }

    const blocks: any[] = [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: '🚨 Email Compliance Violation Alert',
          emoji: true,
        },
      },
      {
        type: 'section',
        fields,
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Compliance Issues:*\n${issuesList}`,
        },
      },
    ];

    if (data.replySnippet) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Reply Snippet:*\n>${data.replySnippet.slice(0, 250).replace(/\n/g, ' ')}...`,
        },
      });
    }

    const res = await postSlackMessage(channel, text, token, blocks, {
      username: 'Email Quality Sentinel',
      icon_emoji: ':warning:',
    });

    if (res.ok) {
      console.log(`[compliance-alert] Slack notification sent to ${channel} for message ${data.messageId}`);
      return true;
    } else {
      console.warn(`[compliance-alert] Failed to post Slack message to ${channel}: ${res.error}`);
      return false;
    }
  } catch (err: any) {
    console.error('[compliance-alert] Error sending Slack alert:', err?.message || err);
    return false;
  }
}
