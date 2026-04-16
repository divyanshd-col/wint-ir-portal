import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { storeUpdateIQSScoreEntry } from '@/lib/store';
import { calculateIQS } from '@/lib/quality';
import type { ParamScore } from '@/lib/quality';

const PARAM_KEYS = ['Technical','AllQuestions','Expectation','Contextual','FollowUp','Sentences','Process','Opening','Call','Tags','Grammar','Empathy'];

function qualityAccess(session: any) {
  return ['admin', 'quality', 'tl'].includes(session?.user?.role);
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !qualityAccess(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json();
  const { id, chatId, scores, reasoning, agentName, disposition, subDisposition, csat, summary, note } = body;
  if (!id || !chatId) return NextResponse.json({ error: 'id and chatId required' }, { status: 400 });

  // Validate scores if provided
  const validScoreValues: ParamScore[] = ['Yes', 'No', 'NA'];
  if (scores) {
    for (const [k, v] of Object.entries(scores)) {
      if (PARAM_KEYS.includes(k) && !validScoreValues.includes(v as ParamScore)) {
        return NextResponse.json({ error: `Invalid score value for ${k}: ${v}` }, { status: 400 });
      }
    }
  }

  const updates: Record<string, any> = {
    updatedAt: new Date().toISOString(),
    updatedBy: session.user?.email || session.user?.name || 'unknown',
  };

  if (scores) {
    updates.scores = scores;
    updates.iqs = calculateIQS(scores); // always recalculate
  }
  if (reasoning !== undefined) updates.reasoning = reasoning;
  if (agentName !== undefined) updates.agentName = agentName;
  if (disposition !== undefined) { updates.disposition = disposition; updates.tags = disposition; }
  if (subDisposition !== undefined) updates.subDisposition = subDisposition;
  if (csat !== undefined) updates.csat = csat;
  if (summary !== undefined) updates.summary = summary;
  if (note !== undefined) updates.note = note;

  const ok = await storeUpdateIQSScoreEntry(id, chatId, updates);
  if (!ok) return NextResponse.json({ error: 'Entry not found — it may still be pending or the ID is mismatched.' }, { status: 404 });

  // Return the merged entry so the client can update its local state without a refetch
  return NextResponse.json({ ok: true, entry: { id, chatId, ...updates } });
}
