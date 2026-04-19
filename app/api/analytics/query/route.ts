import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { getDispositions } from '@/lib/analytics/dispositions';
import { generateSQL } from '@/lib/analytics/text-to-sql';
import { executeRawSQL, writeAuditLog } from '@/lib/analytics/executor';
import { formatFilterHeader, formatDynamicResult } from '@/lib/analytics/formatter';
import { appendHistory } from '@/lib/analytics/sessions';
import { extractThemes } from '@/lib/analytics/themes';
import { geminiGenerate, getOrderedGeminiKeys } from '@/lib/gemini';
import { readConfig } from '@/lib/config';
import type { AnalyticsFilters, StreamChunk, InsightBlock, HistoryEntry } from '@/lib/analytics/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

function send(controller: ReadableStreamDefaultController, chunk: StreamChunk, encoder: TextEncoder) {
  controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
}

async function generateNarrative(
  sql: string,
  rows: any[],
  message: string,
  keys: string[],
): Promise<string> {
  if (!rows.length || !keys.length) return '';
  const sample = JSON.stringify(rows.slice(0, 15));
  const prompt = `In 1-2 sentences, summarise the key insight from this data for a product team member.
Data: ${sample}
User asked: "${message}"
Be specific, use numbers from the data.`;
  try {
    return await geminiGenerate(
      keys,
      'gemini-2.5-flash',
      [{ role: 'user', parts: [{ text: prompt }] }],
      {},
      8_000,
    );
  } catch {
    return '';
  }
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
        // 1. Filter header — always shown first
        send(controller, { event: 'blocks', blocks: [formatFilterHeader(barFilters)] }, encoder);

        // 2. Generate SQL (or classify as theme_extraction / cannot_answer)
        const result = await generateSQL(message, barFilters, priorContext);

        const config = await readConfig();
        const keys = getOrderedGeminiKeys(config);

        let resultBlocks: InsightBlock[] = [];
        let rowCount = 0;
        let templateId: string | null = null;

        if (result.kind === 'cannot_answer') {
          send(controller, { event: 'text', delta: result.message }, encoder);

        } else if (result.kind === 'theme_extraction') {
          send(controller, { event: 'text', delta: 'Analysing conversations for themes…\n' }, encoder);
          resultBlocks = await extractThemes(barFilters);
          send(controller, { event: 'blocks', blocks: resultBlocks }, encoder);
          templateId = 'theme_extraction';

        } else {
          // SQL path
          templateId = 'text_to_sql';
          let execResult: Awaited<ReturnType<typeof executeRawSQL>>;
          try {
            execResult = await executeRawSQL(result.sql);
          } catch (err: any) {
            send(controller, { event: 'text', delta: `Query error: ${err.message}` }, encoder);
            send(controller, { event: 'done' }, encoder);
            controller.close();
            return;
          }

          rowCount = execResult.rowCount;

          // Narrative
          const narrative = await generateNarrative(result.sql, execResult.rows, message, keys);
          if (narrative) send(controller, { event: 'text', delta: narrative }, encoder);

          resultBlocks = formatDynamicResult(execResult.rows, result.chartHint, result.title);
          send(controller, { event: 'blocks', blocks: resultBlocks }, encoder);
        }

        // Audit log (non-blocking)
        writeAuditLog({
          userEmail:  email,
          queryText:  message,
          queryType:  result.kind === 'theme_extraction' ? 2 : 1,
          templateId,
          rowCount,
          latencyMs:  Date.now() - t0,
        }).catch(() => {});

        // Session history (non-blocking)
        const entry: HistoryEntry = {
          id:        crypto.randomUUID(),
          message,
          response:  '',
          blocks:    [formatFilterHeader(barFilters), ...resultBlocks],
          type:      result.kind === 'theme_extraction' ? 2 : 1,
          filters:   barFilters,
          timestamp: new Date().toISOString(),
        };
        appendHistory(email, entry).catch(() => {});

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
