/**
 * GET /api/cron/email-cred-reminder
 *
 * Runs monthly (vercel.json, 1st of the month). Posts a Slack reminder to
 * rotate the cx_business@ App Password and update EMAIL_APP_PASSWORD in Vercel,
 * so the emailed-signup path never silently breaks after a password change
 * (Google revokes app passwords on password rotation).
 */

import { NextRequest, NextResponse } from 'next/server';
import { sendSlackMessage } from '@/lib/slack';

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get('authorization') || '';
    const { searchParams } = new URL(req.url);
    if (auth !== `Bearer ${cronSecret}` && searchParams.get('secret') !== cronSecret) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }
  }

  const token = process.env.SLACK_BOT_TOKEN || '';
  const channel = process.env.OPS_SLACK_CHANNEL || process.env.QUALITY_SLACK_CHANNEL || '';
  if (!token || !channel) {
    return NextResponse.json({ ok: false, error: 'Slack not configured' }, { status: 200 });
  }

  const sender = process.env.EMAIL_USER || 'cx_business@wintwealth.com';
  const text =
    `🔑 *Monthly reminder — IR Portal email credential*\n` +
    `Rotate the App Password for *${sender}* and update *EMAIL_APP_PASSWORD* in Vercel.\n` +
    `Google revokes app passwords when the account password changes, so signup/invite emails will stop sending until this is refreshed.`;

  const posted = await sendSlackMessage(channel, text, token);
  return NextResponse.json({ ok: posted });
}
