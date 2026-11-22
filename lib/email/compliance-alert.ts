/**
 * lib/email/compliance-alert.ts
 *
 * Sends Slack alert to the dedicated #compliance-flag-emails channel (C0CERSWEXTM)
 * when an email reply fails compliance checks (Tripwire gates C1-C5).
 * Kept separate from chat/call compliance flags (#compliance-flag).
 */

import { postSlackMessage } from '@/lib/slack';
import { readConfig } from '@/lib/config';
import { getTLSlackMention } from '@/lib/quality-alert';
import { query } from '@/lib/cx/db';
import { getAgentTLById, getAgentTLByName } from '@/lib/robylon/db';

export interface EmailComplianceAlertPayload {
  ticketId: string;
  chatId?: string;
  messageId: string;
  agentName: string;
  agentId?: number;
  tlName?: string;
  qualityScore: number | null;
  complianceIssues: string[];
  replySnippet?: string;
  evaluatedAt?: string;
}

/**
 * Strips HTML tags, inline styles, script/head blocks and entities from email replies
 * so the exact human text is displayed in Slack alerts rather than raw HTML markup.
 */
export function cleanEmailReplySnippet(raw?: string | null): string {
  if (!raw) return '';
  return raw
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, '')
    .replace(/<br\s*[\/]?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)))
    .replace(/[ \t]+/g, ' ')
    .split('\n')
    .map(line => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
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

    // 1. Resolve TL name if not explicitly passed
    let tlName = (data.tlName || '').trim();
    if (!tlName && data.agentId) {
      try {
        tlName = (await getAgentTLById(data.agentId)) || '';
      } catch {}
    }
    if (!tlName && data.agentName) {
      try {
        tlName = (await getAgentTLByName(data.agentName)) || '';
      } catch {}
    }
    if (!tlName && data.agentName) {
      try {
        const rows = await query<{ tl_name: string | null }>(
          `SELECT tl_name FROM agents
           WHERE LOWER(name) = LOWER($1) OR LOWER(name) LIKE LOWER($1 || ' %') OR LOWER($1) LIKE LOWER(name || ' %')
           ORDER BY (CASE WHEN LOWER(name) = LOWER($1) THEN 0 ELSE 1 END), (tl_name IS NOT NULL) DESC, id DESC
           LIMIT 1`,
          [data.agentName.trim()]
        );
        if (rows[0]?.tl_name) tlName = rows[0].tl_name;
      } catch {}
    }

    const tlMention = getTLSlackMention(tlName, data.agentName);
    const tlDisplay = tlMention && tlMention !== 'N/A' ? tlMention : (tlName || 'Unassigned');

    // 2. Resolve Ticket & Portal links for clickable Ticket ID
    let chatId = data.chatId;
    if (!chatId && data.ticketId) {
      try {
        const rows = await query<{ chat_id: string | null }>(
          `SELECT chat_id FROM email_conversations WHERE id = $1 LIMIT 1`,
          [data.ticketId]
        );
        if (rows[0]?.chat_id) chatId = rows[0].chat_id;
      } catch {}
    }

    const portalBase = process.env.NEXTAUTH_URL || 'https://wint-ir-portal.vercel.app';
    const portalUrl = `${portalBase}/quality/email-evaluation?ticketId=${encodeURIComponent(data.ticketId)}`;
    const robylonUrl = chatId ? `https://app.robylon.ai/unified-inbox/share/${chatId}` : '';

    // Clickable ticket link — prefers Robylon if chatId is resolved, otherwise QA portal
    const primaryTicketUrl = robylonUrl || portalUrl;
    const ticketLink = `<${primaryTicketUrl}|${data.ticketId}>`;

    const reviewLinks = [
      robylonUrl ? `<${robylonUrl}|Open in Robylon ↗>` : null,
      `<${portalUrl}|Review in QA Portal ↗>`,
    ].filter(Boolean).join('  •  ');

    // 3. Clean and format the exact reply snippet
    let rawReply = data.replySnippet || '';
    if (!rawReply && data.messageId) {
      try {
        const rows = await query<{ agent_reply_text: string | null }>(
          `SELECT agent_reply_text FROM email_reply_evaluations WHERE message_id = $1 LIMIT 1`,
          [data.messageId]
        );
        if (rows[0]?.agent_reply_text) rawReply = rows[0].agent_reply_text;
      } catch {}
    }

    const cleanReply = cleanEmailReplySnippet(rawReply);
    const replySnippet = cleanReply.length > 1200
      ? cleanReply.slice(0, 1200) + '…'
      : cleanReply;

    const issuesList = data.complianceIssues.length > 0
      ? data.complianceIssues.map(i => `• ${i}`).join('\n')
      : '• Non-compliant phrasing or policy violation';

    const scoreDisplay = data.qualityScore !== null && data.qualityScore !== undefined
      ? `${data.qualityScore}%`
      : 'N/A';

    const text = `🚨 *Email Reply Compliance Breach Detected*
*Agent:* ${data.agentName} | *TL:* ${tlDisplay}
*Ticket ID:* <${primaryTicketUrl}|${data.ticketId}>
*Quality Score:* ${scoreDisplay}
*Issues Found:*
${issuesList}
${replySnippet ? `\n*Agent Reply:*\n${replySnippet}\n` : ''}
*Action Required:* ${reviewLinks}`;

    const fields: any[] = [
      { type: 'mrkdwn', text: `*Agent:*\n${data.agentName}` },
      { type: 'mrkdwn', text: `*TL:*\n${tlDisplay}` },
      { type: 'mrkdwn', text: `*Quality Score:*\n${scoreDisplay}` },
      { type: 'mrkdwn', text: `*Ticket ID:*\n${ticketLink}` },
      { type: 'mrkdwn', text: `*Evaluated:*\n${new Date(data.evaluatedAt || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` },
      { type: 'mrkdwn', text: `*Review Links:*\n${reviewLinks}` },
    ];

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

    if (replySnippet) {
      const quotedReply = replySnippet
        .split('\n')
        .map(l => `> ${l}`)
        .join('\n');

      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Exact Agent Reply:*\n${quotedReply}`,
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
