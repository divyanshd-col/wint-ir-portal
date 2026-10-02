/**
 * GET /api/cron/sla-breach?trigger=1|2
 *
 * Twice daily (vercel.json, UTC): posts open email tickets about to breach the 24h SLA to Slack.
 *   trigger 1 (09:45 IST) -> breaches 10:00-19:00 IST today
 *   trigger 2 (15:00 IST) -> breaches 19:00 IST today to 11:30 IST tomorrow
 */
import { NextRequest, NextResponse } from 'next/server';
import { runSlaBreachCron } from '@/lib/sla-breach';
import { fetchBreachingTickets } from '@/lib/sla-breach-db';
import { sendSlackMessage } from '@/lib/slack';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const result = await runSlaBreachCron({
    authHeader: req.headers.get('authorization'),
    secret: process.env.SLA_CRON_SECRET,
    trigger: req.nextUrl.searchParams.get('trigger'),
    now: new Date(),
    fetchRows: fetchBreachingTickets,
    mentions: process.env.SLA_SLACK_MENTIONS,
    post: async ({ text, blocks }) => {
      const channel = process.env.SLA_SLACK_CHANNEL || process.env.SLACK_WEBHOOK_URL || '';
      const ok = await sendSlackMessage(channel, text, process.env.SLA_SLACK_BOT_TOKEN || '', blocks);
      if (!ok) throw new Error('Slack post failed');
    },
  });
  return NextResponse.json(result.body, { status: result.status });
}
