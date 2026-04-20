import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { getDispositions } from '@/lib/analytics/dispositions';
import { runAnalyticsAgent } from '@/lib/analytics/agent';
import { formatAgentResult } from '@/lib/analytics/formatter';
import { appendHistory } from '@/lib/analytics/sessions';
import { writeAuditLog } from '@/lib/analytics/executor';
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
  const priorContext: string | undefined = body.priorContext || undefined;
  const barFilters: AnalyticsFilters = body.filters ?? {
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
    return new Response(JSON.stringify({ error: 'message is required' }), { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const t0 = Date.now();
      try {
        // Disposition list for agent context
        const dispositionPayload = await getDispositions();
        const dispositionNames = dispositionPayload.dispositions.map(d => d.disposition);

        // Run agent loop — stream progress as log events (separate from answer)
        const result = await runAnalyticsAgent(
          message,
          barFilters,
          dispositionNames,
          priorContext,
          (update) => send(controller, { event: 'log', delta: update }, encoder),
        );

        let resultBlocks: InsightBlock[] = [];

        if (result.kind === 'clarify') {
          // LLM needs clarification before it can answer
          send(controller, { event: 'text', delta: result.question }, encoder);

        } else {
          const { answer } = result;

          // Narrative (shown as prose above the blocks)
          if (answer.answer_text) {
            send(controller, { event: 'text', delta: answer.answer_text }, encoder);
          }

          // Visual blocks
          resultBlocks = formatAgentResult(answer);
          if (resultBlocks.length) {
            send(controller, { event: 'blocks', blocks: resultBlocks }, encoder);
          }

          // Audit log (non-blocking)
          writeAuditLog({
            userEmail:  email,
            queryText:  message,
            queryType:  1,
            templateId: answer.output_shape,
            rowCount:   answer.data_rows?.length ?? 0,
            latencyMs:  Date.now() - t0,
          }).catch(() => {});

          // Session history (non-blocking)
          const entry: HistoryEntry = {
            id:        crypto.randomUUID(),
            message,
            response:  answer.answer_text ?? '',
            blocks:    resultBlocks,
            type:      1,
            filters:   barFilters,
            timestamp: new Date().toISOString(),
          };
          appendHistory(email, entry).catch(() => {});
        }

        send(controller, { event: 'done' }, encoder);
      } catch (err: any) {
        console.error('[analytics/query]', err?.message ?? err);
        send(controller, { event: 'error', message: err?.message ?? 'Something went wrong.' }, encoder);
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type':      'text/event-stream',
      'Cache-Control':     'no-cache',
      'Connection':        'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
