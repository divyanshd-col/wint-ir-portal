/**
 * lib/email/compliance-alert.ts
 *
 * Implements Step 4 of Implementation Plan:
 * Sends Slack alert when an email reply fails compliance checks.
 */

import { postSlackMessage } from '@/lib/slack';
import { readConfig } from '@/lib/config';

export interface EmailComplianceAlertPayload {
  ticketId: string;
  messageId: string;
  agentName: string;
  qualityScore: number;
  complianceIssues: string[];
  replySnippet?: string;
  evaluatedAt?: string;
}

export async function sendEmailComplianceSlackAlert(
  data: EmailComplianceAlertPayload
): Promise<boolean> {
  try {
    const config = await readConfig().catch(() => ({} as any));
    const token =
      process.env.COMPLIANCE_SLACK_BOT_TOKEN ||
      process.env.SLACK_BOT_TOKEN ||
      config.slackUserToken ||
      '';

    const channel =
      process.env.COMPLIANCE_SLACK_CHANNEL ||
      process.env.QUALITY_SLACK_CHANNEL ||
      'C0BRLHDDGQ0';

    const issuesList = data.complianceIssues.length > 0
      ? data.complianceIssues.map(i => `• ${i}`).join('\n')
      : '• Non-compliant phrasing or policy violation';

    const snippet = data.replySnippet
      ? `\n> *Agent Reply:*\n> _${data.replySnippet.slice(0, 300).replace(/\n/g, ' ')}${data.replySnippet.length > 300 ? '…' : ''}_`
      : '';

    const text = `🚨 *Email Reply Compliance Breach Detected*
*Agent:* ${data.agentName}
*Ticket ID:* \`${data.ticketId}\` | *Message ID:* \`${data.messageId}\`
*Quality Score:* ${data.qualityScore}%
*Issues Found:*
${issuesList}${snippet}
*Action Required:* Review in QA Email Evaluation Portal: /quality/email-evaluation?ticketId=${encodeURIComponent(data.ticketId)}`;

    const blocks = [
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
        fields: [
          { type: 'mrkdwn', text: `*Agent:*\n${data.agentName}` },
          { type: 'mrkdwn', text: `*Quality Score:*\n${data.qualityScore}%` },
          { type: 'mrkdwn', text: `*Ticket ID:*\n\`${data.ticketId}\`` },
          { type: 'mrkdwn', text: `*Evaluated:*\n${new Date(data.evaluatedAt || Date.now()).toLocaleTimeString()}` },
        ],
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
      console.log(`[compliance-alert] Slack notification sent for message ${data.messageId}`);
      return true;
    } else {
      console.warn(`[compliance-alert] Failed to post Slack message: ${res.error}`);
      return false;
    }
  } catch (err: any) {
    console.error('[compliance-alert] Error sending Slack alert:', err?.message || err);
    return false;
  }
}
