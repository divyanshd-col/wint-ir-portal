const ROUTE = 'call-analysis/run';
import { log, withLogging } from '@/lib/log';
/**
 * POST /api/call-analysis/run
 *
 * Step 2 of browser-direct upload flow.
 * Receives the Gemini file URI (already uploaded by browser),
 * runs two-pass analysis, streams progress via SSE.
 */

import { NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { analyzeCallFromUri } from '@/lib/call-analyzer';
import { readConfig } from '@/lib/config';
import { getIQSGeminiKeys } from '@/lib/gemini';

export const runtime    = 'nodejs';
export const maxDuration = 300;

function send(controller: ReadableStreamDefaultController, event: string, data: any, encoder: TextEncoder) {
  controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
}

async function _POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const user    = session?.user as any;
  if (!user || (!user.isAdmin && user.role !== 'tl')) {
    return new Response('Forbidden', { status: 403 });
  }

  const { fileUri, fileName, mimeType } = await req.json();
  if (!fileUri || !fileName || !mimeType) {
    return new Response(JSON.stringify({ error: 'fileUri, fileName and mimeType are required' }), { status: 400 });
  }

  const config = await readConfig();
  const keys   = getIQSGeminiKeys(config);
  if (!keys.length) {
    return new Response(JSON.stringify({ error: 'No Gemini API key configured' }), { status: 500 });
  }
  const apiKey = keys[0];

  const encoder = new TextEncoder();
  const stream  = new ReadableStream({
    async start(controller) {
      try {
        const result = await analyzeCallFromUri({
          fileUri,
          fileName,
          mimeType,
          apiKey,
          onProgress: (msg) => send(controller, 'progress', { message: msg }, encoder),
        });
        send(controller, 'result', result, encoder);
      } catch (err: any) {
        send(controller, 'error', { message: err?.message ?? 'Analysis failed' }, encoder);
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

export const POST = withLogging(ROUTE, _POST);
