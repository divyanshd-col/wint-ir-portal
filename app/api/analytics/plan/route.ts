import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { readConfig } from '@/lib/config';
import { getOrderedGeminiKeys } from '@/lib/gemini';
import { getDispositions } from '@/lib/analytics/dispositions';
import { runPlannerPhase, runSynthesizerPhase } from '@/lib/analytics/agent';
import { formatAgentResult } from '@/lib/analytics/formatter';
import { writeAuditLog } from '@/lib/analytics/executor';
import { appendToSession } from '@/lib/analytics/sessions';
import type { AnalyticsFilters, InsightBlock, HistoryEntry } from '@/lib/analytics/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!(session?.user as any)?.isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const email = session!.user!.email ?? '';

  const body = await req.json().catch(() => ({}));
  const message: string = (body.message ?? '').trim();
  const sessionId: string = body.sessionId ?? '';
  const priorContext: string | undefined = body.priorContext || undefined;
  const maxConversations: number = typeof body.maxConversations === 'number' ? body.maxConversations : 100;
  const filters: AnalyticsFilters = body.filters ?? {
    dateFrom: new Date(Date.now() - 6 * 86400_000).toISOString().slice(0, 10),
    dateTo: new Date().toISOString().slice(0, 10),
    dispositions: [],
    subDispositions: [],
    teams: [],
    csatLabels: ['bad', 'could_be_better'],
    conversationTypes: [],
    agentIds: [],
  };

  if (!message) {
    return NextResponse.json({ error: 'message is required' }, { status: 400 });
  }

  const t0 = Date.now();
  const config = await readConfig();
  const keys = getOrderedGeminiKeys(config);

  const { dispositions: dispositionPayload } = await getDispositions();

  const planResult = await runPlannerPhase(message, filters, dispositionPayload, keys, priorContext, maxConversations);

  if (planResult.kind === 'clarify') {
    return NextResponse.json({ status: 'clarify', question: planResult.question });
  }
  if (planResult.kind === 'error') {
    return NextResponse.json({ status: 'error', message: planResult.message });
  }

  // SQL-only: synthesize immediately in this function call
  if (!planResult.needs_transcripts) {
    try {
      const answer = await runSynthesizerPhase(
        message, planResult.intent, planResult.output_shape,
        planResult.sql_results, [], keys, priorContext,
      );
      const blocks: InsightBlock[] = formatAgentResult(answer);

      writeAuditLog({
        userEmail: email, queryText: message, queryType: 1,
        templateId: answer.output_shape, rowCount: answer.data_rows?.length ?? 0,
        latencyMs: Date.now() - t0,
      }).catch(() => {});
      const entry: HistoryEntry = {
        id: crypto.randomUUID(), message, response: answer.answer_text ?? '',
        blocks, type: 1, filters, timestamp: new Date().toISOString(),
      };
      if (sessionId) await appendToSession(email, sessionId, entry).catch(() => {});

      return NextResponse.json({
        status: 'complete',
        answer_text: answer.answer_text,
        blocks,
        warnings: answer.warnings ?? [],
      });
    } catch (err: any) {
      return NextResponse.json({ status: 'error', message: err?.message ?? 'Synthesis failed' });
    }
  }

  // Transcript query: return plan data — client will call /api/analytics/insights next
  return NextResponse.json({
    status: 'needs_transcripts',
    intent: planResult.intent,
    output_shape: planResult.output_shape,
    transcript_intent: planResult.transcript_intent,
    transcript_ids: planResult.transcript_ids,
    sql_results: planResult.sql_results,
  });
}
