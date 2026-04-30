import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { readConfig } from '@/lib/config';
import { getOrderedGeminiKeys } from '@/lib/gemini';
import { readTranscripts } from '@/lib/analytics/transcript-reader';
import { miniSummarizeTranscripts } from '@/lib/analytics/summarizer';
import { runSynthesizerPhase } from '@/lib/analytics/agent';
import { formatAgentResult } from '@/lib/analytics/formatter';
import { writeAuditLog } from '@/lib/analytics/executor';
import { appendToSession } from '@/lib/analytics/sessions';
import type { SqlResult } from '@/lib/analytics/agent';
import type { AnalyticsFilters, StreamChunk, InsightBlock, HistoryEntry } from '@/lib/analytics/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

function send(controller: ReadableStreamDefaultController, chunk: StreamChunk, encoder: TextEncoder) {
  controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!(session?.user as any)?.isAdmin) {
    return new Response('Forbidden', { status: 403 });
  }
  const email = session!.user!.email ?? '';

  const body = await req.json().catch(() => ({}));
  const message: string = (body.message ?? '').trim();
  const sessionId: string = body.sessionId ?? '';
  const intent: string = body.intent ?? '';
  const outputShape: string = body.output_shape ?? 'transcript_analysis';
  const transcriptIntent: string = body.transcript_intent ?? intent;
  const maxConversations: number = typeof body.maxConversations === 'number' && body.maxConversations > 0 ? body.maxConversations : 100;
  const transcriptIds: string[] = (body.transcript_ids ?? []).slice(0, maxConversations);
  const sqlResults: SqlResult[] = body.sql_results ?? [];
  const filters: AnalyticsFilters = body.filters ?? {} as AnalyticsFilters;
  const priorContext: string | undefined = body.priorContext || undefined;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const t0 = Date.now();
      try {
        const config = await readConfig();
        const keys = getOrderedGeminiKeys(config);

        // Fetch all transcripts in one DB query
        send(controller, { event: 'log', delta: `Fetching ${transcriptIds.length} conversations…\n` }, encoder);
        const allTranscripts = await readTranscripts(transcriptIds);
        send(controller, { event: 'log', delta: `${allTranscripts.length} loaded. Summarising in parallel…\n` }, encoder);

        // Chunk into batches of 20, run all mini-summarize calls in parallel
        const BATCH_SIZE = 20;
        const batches: typeof allTranscripts[] = [];
        for (let i = 0; i < allTranscripts.length; i += BATCH_SIZE) {
          batches.push(allTranscripts.slice(i, i + BATCH_SIZE));
        }

        const summaries = await Promise.all(
          batches.map((batch, i) => {
            send(controller, { event: 'log', delta: `Summarising batch ${i + 1}/${batches.length} (${batch.length} chats)…\n` }, encoder);
            return miniSummarizeTranscripts(batch, transcriptIntent, keys);
          }),
        );

        send(controller, { event: 'log', delta: 'Synthesising answer…\n' }, encoder);

        const answer = await runSynthesizerPhase(message, intent, outputShape, sqlResults, summaries, keys, priorContext);

        if (answer.answer_text) {
          send(controller, { event: 'text', delta: answer.answer_text }, encoder);
        }

        const blocks: InsightBlock[] = formatAgentResult(answer);
        if (blocks.length) {
          send(controller, { event: 'blocks', blocks }, encoder);
        }

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

        send(controller, { event: 'done' }, encoder);
      } catch (err: any) {
        console.error('[analytics/insights]', err?.message ?? err);
        send(controller, { event: 'error', message: err?.message ?? 'Something went wrong.' }, encoder);
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
