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
  console.log(`[slack] Searching for: "${query}" (token: ${token ? token.slice(0, 8) + '…' : 'MISSING'})`);

  const url = `https://slack.com/api/search.messages?query=${encodeURIComponent(query)}&count=10&sort=score`;
  let data: any;
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    console.log(`[slack] search.messages HTTP ${res.status}`);
    if (!res.ok) {
      console.error(`[slack] HTTP error ${res.status}`);
      return [];
    }
    data = await res.json();
  } catch (err) {
    console.error('[slack] search.messages fetch failed:', err);
    return [];
  }

  if (!data.ok) {
    console.error(`[slack] API error: ${data.error} (needed: search:read scope)`);
    return [];
  }

  const matches = data.messages?.matches || [];
  console.log(`[slack] Raw matches: ${matches.length}`);

  if (!matches.length) return [];

  const validated = await Promise.all(
    matches.map((msg: any) => validateMessage(msg, token))
  );

  const results = validated.filter(Boolean).slice(0, 4) as SlackResult[];
  console.log(`[slack] Validated results: ${results.length}/${matches.length}`);
  return results;
}

async function validateMessage(msg: any, token: string): Promise<SlackResult | null> {
  const channelName: string = msg.channel?.name || '(unknown)';
  const text: string = msg.text || '';
  const permalink: string = msg.permalink || '';

  // Reject messages before 2026-01-01
  const msgTs = parseFloat(msg.ts || '0');
  if (msgTs < SLACK_CUTOFF_TS) {
    console.log(`[slack] ✗ #${channelName} — too old (${new Date(msgTs * 1000).toISOString().slice(0, 10)})`);
    return null;
  }

  // 1. cx-announcement channel — always authoritative
  if (channelName === 'cx-announcement' || channelName === 'cx-announcements') {
    console.log(`[slack] ✓ #${channelName} — cx-announcement (auto-trusted)`);
    return { text, channelName, permalink, validatedBy: 'cx-announcement' };
  }

  // 2. ✅ or 👍 reaction on the message
  const reactions: any[] = msg.reactions || [];
  const validReaction = reactions.find((r: any) =>
    ['white_check_mark', 'heavy_check_mark', '+1', 'thumbsup'].includes(r.name)
  );
  if (validReaction) {
    console.log(`[slack] ✓ #${channelName} — reaction :${validReaction.name}:`);
    return { text, channelName, permalink, validatedBy: `reaction:${validReaction.name}` };
  }

  // 3. Thread reply confirming the answer from a different user
  if ((msg.reply_count || 0) > 0 && msg.channel?.id && msg.ts) {
    const confirmedBy = await checkThreadConfirmation(msg.channel.id, msg.ts, msg.user, token);
    if (confirmedBy) {
      console.log(`[slack] ✓ #${channelName} — thread confirmed by ${confirmedBy}`);
      return { text, channelName, permalink, validatedBy: `thread:${confirmedBy}` };
    }
  }

  console.log(`[slack] ✗ #${channelName} — no validation signal (no reaction, no thread confirmation)`);
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
    if (!data.ok) {
      console.log(`[slack] conversations.replies error: ${data.error}`);
      return null;
    }

    // Skip the first message (the original), check replies only
    const replies: any[] = (data.messages || []).slice(1);
    for (const reply of replies) {
      if (reply.user === originalUser) continue; // must be validated by someone else
      const lower = (reply.text || '').toLowerCase();
      if (CONFIRMATION_KEYWORDS.some(kw => lower.includes(kw))) {
        return reply.username || reply.user || 'colleague';
      }
    }
  } catch (err) {
    console.error('[slack] conversations.replies failed:', err);
  }
  return null;
}
