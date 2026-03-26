export interface SlackResult {
  text: string;
  channelName: string;
  permalink: string;
  validatedBy: string; // e.g. "cx-announcement" | "reaction:white_check_mark" | "thread:@username"
}

// Only messages posted on or after 2026-01-01 00:00:00 UTC
const SLACK_CUTOFF_TS = 1735689600;

const CONFIRMATION_KEYWORDS = [
  'correct', 'confirmed', 'right', 'yes', 'exactly', "that's right",
  'this is correct', 'approved', 'go ahead', 'proceed', ':white_check_mark:',
];

/**
 * Searches Slack for messages matching the query and returns only validated results.
 * Validation rules (in priority order):
 *   1. Message is from #cx-announcement → auto-trusted
 *   2. Message has a ✅ / 👍 reaction
 *   3. Thread has a confirmation reply from a different user
 * Only messages posted on/after 2026-01-01 are considered.
 */
export async function searchSlack(query: string, token: string): Promise<SlackResult[]> {
  const url = `https://slack.com/api/search.messages?query=${encodeURIComponent(query)}&count=10&sort=score`;
  let data: any;
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return [];
    data = await res.json();
  } catch (err) {
    console.error('[slack] search.messages failed:', err);
    return [];
  }

  if (!data.ok || !data.messages?.matches?.length) return [];

  const validated = await Promise.all(
    data.messages.matches.map((msg: any) => validateMessage(msg, token))
  );

  return validated.filter(Boolean).slice(0, 4) as SlackResult[];
}

async function validateMessage(msg: any, token: string): Promise<SlackResult | null> {
  const channelName: string = msg.channel?.name || '';
  const text: string = msg.text || '';
  const permalink: string = msg.permalink || '';

  // Reject messages before 2026-01-01
  const msgTs = parseFloat(msg.ts || '0');
  if (msgTs < SLACK_CUTOFF_TS) return null;

  // 1. cx-announcement channel — always authoritative
  if (channelName === 'cx-announcement' || channelName === 'cx-announcements') {
    return { text, channelName, permalink, validatedBy: 'cx-announcement' };
  }

  // 2. ✅ or 👍 reaction on the message
  const reactions: any[] = msg.reactions || [];
  const validReaction = reactions.find((r: any) =>
    ['white_check_mark', 'heavy_check_mark', '+1', 'thumbsup'].includes(r.name)
  );
  if (validReaction) {
    return { text, channelName, permalink, validatedBy: `reaction:${validReaction.name}` };
  }

  // 3. Thread reply confirming the answer from a different user
  if ((msg.reply_count || 0) > 0 && msg.channel?.id && msg.ts) {
    const confirmedBy = await checkThreadConfirmation(msg.channel.id, msg.ts, msg.user, token);
    if (confirmedBy) {
      return { text, channelName, permalink, validatedBy: `thread:${confirmedBy}` };
    }
  }

  return null;
}

async function checkThreadConfirmation(
  channelId: string,
  ts: string,
  originalUser: string,
  token: string
): Promise<string | null> {
  try {
    const url = `https://slack.com/api/conversations.replies?channel=${channelId}&ts=${ts}&limit=20`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.ok) return null;

    // Skip the first message (the original), check replies only
    const replies: any[] = (data.messages || []).slice(1);
    for (const reply of replies) {
      if (reply.user === originalUser) continue; // must be validated by someone else
      const lower = (reply.text || '').toLowerCase();
      if (CONFIRMATION_KEYWORDS.some(kw => lower.includes(kw))) {
        return reply.username || reply.user || 'colleague';
      }
    }
  } catch {}
  return null;
}
