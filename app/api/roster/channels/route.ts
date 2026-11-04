import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/cx/db';
import { rosterActor, assertCanEdit, audit, withRosterErrors } from '@/lib/roster-server';
import { todayIST } from '@/lib/ist';
import { CHANNELS } from '@/lib/roster';

/** Set one person's work channels. Body: { userId, channels: string[] } */
const PUT_ = async (req: NextRequest) => {
  const { actor, response } = await rosterActor('roster:manage:access');
  if (response) return response;
  const b = await req.json().catch(() => ({}));
  const userId = Number(b.userId);
  const channels: string[] = Array.isArray(b.channels) ? b.channels : [];
  if (!Number.isInteger(userId) || channels.some(c => !(CHANNELS as readonly string[]).includes(c))) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  const denied = await assertCanEdit(actor, userId, todayIST());
  if (denied) return denied;
  await query(`DELETE FROM work_channels WHERE user_id=$1`, [userId]);
  if (channels.length) await query(`INSERT INTO work_channels (user_id, channel) SELECT $1, UNNEST($2::text[])`, [userId, channels]);
  await audit(actor.userId, 'roster_channels_set', userId, { channels });
  return NextResponse.json({ ok: true });
}
export const PUT = withRosterErrors(PUT_);
