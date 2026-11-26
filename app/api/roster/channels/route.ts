import { NextRequest, NextResponse } from 'next/server';
import { withTransaction } from '@/lib/cx/db';
import { rosterActor, assertCanEdit, audit, withRosterErrors } from '@/lib/roster-server';
import { todayIST } from '@/lib/ist';
import { asId, CHANNELS } from '@/lib/roster';

/** Set one person's work channels. Body: { userId, channels: string[] }. The list replaces what was there, all or nothing. */
const PUT_ = async (req: NextRequest) => {
  const { actor, response } = await rosterActor('roster:manage:access');
  if (response) return response;
  const b = await req.json().catch(() => ({}));
  const userId = asId(b.userId);
  // a missing or malformed list must never clear someone's channels by accident
  if (userId === null || !Array.isArray(b.channels) || b.channels.some((c: unknown) => typeof c !== 'string' || !(CHANNELS as readonly string[]).includes(c)))
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  const channels = [...new Set<string>(b.channels)];
  const denied = await assertCanEdit(actor, userId, todayIST());
  if (denied) return denied;
  await withTransaction(async tx => {
    await tx.query(`SELECT 1 FROM users WHERE user_id = $1 FOR UPDATE`, [userId]); // one person's saves go one after another
    await tx.query(`DELETE FROM work_channels WHERE user_id = $1`, [userId]);
    if (channels.length) await tx.query(`INSERT INTO work_channels (user_id, channel) SELECT $1, UNNEST($2::text[])`, [userId, channels]);
    await audit(actor.userId, 'roster_channels_set', userId, { channels }, tx);
  });
  return NextResponse.json({ ok: true });
};
export const PUT = withRosterErrors(PUT_);
