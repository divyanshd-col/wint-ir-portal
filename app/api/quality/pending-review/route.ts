import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { getAllScoredConversations, getAgentNamesByTL, getAgentNamesByQA } from '@/lib/robylon/db';
import { storeGetIQSFlags, storeGetQAReview, storeSetQAReview } from '@/lib/store';
import { readConfig } from '@/lib/config';

function qualityAccess(role: string | undefined) {
  return !!role && ['admin', 'quality', 'tl'].includes(role);
}

export async function GET(_req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const role  = (session.user as any)?.role;
  const email = (session.user as any)?.email || '';
  if (!qualityAccess(role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  let selfAgentName = '';
  let scopedAgentNames: string[] | null = null;

  if (['tl', 'quality'].includes(role)) {
    const config = await readConfig();
    const configUser = config.users.find((u: any) => (u.email || u.username) === email);
    selfAgentName = configUser?.agentName || '';
  }

  if (role === 'tl' && selfAgentName) {
    scopedAgentNames = await getAgentNamesByTL(selfAgentName);
  } else if (role === 'quality' && selfAgentName) {
    scopedAgentNames = await getAgentNamesByQA(selfAgentName);
  }

  const dbOpts: Parameters<typeof getAllScoredConversations>[1] = { iqsMax: 79, includeUncertain: true };
  if (scopedAgentNames !== null) dbOpts.agentNames = scopedAgentNames;

  let rows: any[] = [];
  try {
    rows = await getAllScoredConversations(0, dbOpts);
  } catch (e: any) {
    return NextResponse.json({ error: 'Database error', detail: e?.message }, { status: 500 });
  }

  // Build flag map: chatId → pending flag
  const flagsByChat: Record<string, any> = {};
  try {
    const flagStrings = await storeGetIQSFlags();
    for (const s of flagStrings) {
      try {
        const f = JSON.parse(s);
        if (f.chatId) flagsByChat[String(f.chatId)] = f;
      } catch {}
    }
  } catch {}

  // Fetch QA review statuses in parallel for each chat
  const chatIds = rows.map((r: any) => String(r.chatId));
  const reviews = await Promise.all(chatIds.map((id: string) => storeGetQAReview(id)));
  const reviewMap: Record<string, any> = {};
  chatIds.forEach((id: string, i: number) => { if (reviews[i]) reviewMap[id] = reviews[i]; });

  const items = rows.map((row: any) => {
    const parameters = row.parameters || {};
    const scores: Record<string, string> = {};
    const reasoning: Record<string, string> = {};
    let uncertain: Array<{ parameter: string; question: string }> | undefined;

    for (const [key, val] of Object.entries(parameters) as [string, any][]) {
      if (key === '__uncertain') {
        if (Array.isArray(val) && val.length > 0) uncertain = val;
        continue;
      }
      const k = key.charAt(0).toUpperCase() + key.slice(1);
      scores[k]    = val?.score === true ? 'Yes' : val?.score === false ? 'No' : 'NA';
      reasoning[k] = val?.reasoning || '';
    }

    return {
      chatId: String(row.chatId),
      agentName: row.agentName || '',
      iqs: row.iqs,
      scoredAt: row.scoredAt,
      date: row.date ? String(row.date).slice(0, 10) : '',
      mobileNumber: row.mobileNumber || '',
      flag: flagsByChat[String(row.chatId)] || null,
      qaStatus: reviewMap[String(row.chatId)] || null,
      scores,
      reasoning,
      ...(uncertain && { uncertainParameters: uncertain }),
    };
  });

  const uncertainCount = items.filter(i => !!(i as any).uncertainParameters && !(i as any).qaStatus).length;
  return NextResponse.json({ items, uncertainCount });
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const role = (session.user as any)?.role;
  if (!qualityAccess(role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { chatId, reviewNote } = await req.json();
  if (!chatId) return NextResponse.json({ error: 'chatId required' }, { status: 400 });

  await storeSetQAReview(String(chatId), {
    reviewedBy: (session.user as any)?.email || '',
    reviewedAt: new Date().toISOString(),
    reviewNote: reviewNote || '',
  });

  return NextResponse.json({ ok: true });
}
