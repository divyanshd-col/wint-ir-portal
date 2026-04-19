import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { query } from '@/lib/cx/db';
import { getDispositions } from '@/lib/analytics/dispositions';
import { classifyQuery, mergeFilters } from '@/lib/analytics/classifier';
import { executeTemplate, writeAuditLog } from '@/lib/analytics/executor';
import { formatFilterHeader, formatResult } from '@/lib/analytics/formatter';
import { appendHistory } from '@/lib/analytics/sessions';
import { extractThemes } from '@/lib/analytics/themes';
import { geminiGenerate, getOrderedGeminiKeys } from '@/lib/gemini';
import { readConfig } from '@/lib/config';
import type { AnalyticsFilters, StreamChunk, InsightBlock, HistoryEntry } from '@/lib/analytics/types';

export const runtime = 'nodejs';
export const maxDuration = 45;

function send(controller: ReadableStreamDefaultController, chunk: StreamChunk, encoder: TextEncoder) {
  controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
}

async function generateNarrative(
  templateId: string,
  rows: any[],
  message: string,
  keys: string[],
): Promise<string> {
  if (!rows.length || !keys.length) return '';
  const sample = JSON.stringify(rows.slice(0, 15));
  const prompt = `In 1-2 sentences, summarise the key insight from this data for a product team member.
Data (template: ${templateId}): ${sample}
User asked: "${message}"
Be specific, use numbers from the data. Do NOT mention the template name.`;
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
        // 1. Disposition list (for classifier context)
        const dispositionPayload = await getDispositions();
        const dispositionNames = dispositionPayload.dispositions.map(d => d.disposition);

        // 2. Classify
        const classification = await classifyQuery(message, barFilters, dispositionNames);

        // 3. Merge filters (Rule B)
        const effectiveFilters = mergeFilters(classification.entities, barFilters);

        // 4. Resolve agent names → IDs
        if (classification.entities.agentNames?.length) {
          try {
            const agentRows = await query<{ id: number }>(
              `SELECT id FROM agents WHERE name = ANY($1)`,
              [classification.entities.agentNames],
            );
            effectiveFilters.agentIds = agentRows.map(r => r.id);
          } catch {}
        }

        // 5. Filter header — always first
        const filterHeader = formatFilterHeader(effectiveFilters);
        send(controller, { event: 'blocks', blocks: [filterHeader] }, encoder);

        const config = await readConfig();
        const keys = getOrderedGeminiKeys(config);

        let resultBlocks: InsightBlock[] = [];
        let rowCount = 0;

        if (classification.type === 2) {
          // Phase 2: theme extraction
          send(controller, { event: 'text', delta: 'Analysing conversations for themes…\n' }, encoder);
          resultBlocks = await extractThemes(effectiveFilters);
          send(controller, { event: 'blocks', blocks: resultBlocks }, encoder);

        } else {
          // Phase 1: SQL template
          const templateId = classification.templateId ?? 'count_by_disposition';
          const extras = {
            metricName: classification.entities.metricName ?? undefined,
            topN:       classification.entities.topN       ?? undefined,
            teamId:     classification.entities.teams?.[0] ?? undefined,
            windowA:    classification.entities.windowA    ?? undefined,
            windowB:    classification.entities.windowB    ?? undefined,
          };

          const result = await executeTemplate(templateId, effectiveFilters, extras);
          rowCount = result.rowCount;

          // Narrative summary
          const narrative = await generateNarrative(templateId, result.rows, message, keys);
          if (narrative) send(controller, { event: 'text', delta: narrative }, encoder);

          resultBlocks = formatResult(templateId, classification.shape, result.rows);
          send(controller, { event: 'blocks', blocks: resultBlocks }, encoder);
        }

        // Audit log (non-blocking)
        writeAuditLog({
          userEmail:  email,
          queryText:  message,
          queryType:  classification.type,
          templateId: classification.templateId,
          rowCount,
          latencyMs:  Date.now() - t0,
        }).catch(() => {});

        // Session history (non-blocking)
        const entry: HistoryEntry = {
          id:        crypto.randomUUID(),
          message,
          response:  '',
          blocks:    [filterHeader, ...resultBlocks],
          type:      classification.type,
          filters:   effectiveFilters,
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
