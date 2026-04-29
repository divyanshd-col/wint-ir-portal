/**
 * POST /api/call-analysis
 *
 * Accepts a multipart form upload with a single audio file.
 * Streams progress via SSE, then emits a final JSON result event.
 *
 * Access: admin + tl only.
 */

import { NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { analyzeCall } from '@/lib/call-analyzer';
import { readConfig } from '@/lib/config';
import { getIQSGeminiKeys } from '@/lib/gemini';

export const runtime  = 'nodejs';
export const maxDuration = 300;

const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500 MB

function allowed(role: string | undefined, isAdmin: boolean | undefined): boolean {
  return !!isAdmin || role === 'tl';
}

function send(controller: ReadableStreamDefaultController, event: string, data: any, encoder: TextEncoder) {
  const line = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  controller.enqueue(encoder.encode(line));
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const user    = session?.user as any;
  if (!user || !allowed(user.role, user.isAdmin)) {
    return new Response('Forbidden', { status: 403 });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid multipart form' }), { status: 400 });
  }

  const file = formData.get('audio') as File | null;
  if (!file) {
    return new Response(JSON.stringify({ error: 'audio file is required' }), { status: 400 });
  }

  const validExts = ['mp3', 'wav', 'm4a', 'ogg', 'flac'];
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (!validExts.includes(ext)) {
    return new Response(
      JSON.stringify({ error: `Unsupported format. Allowed: ${validExts.join(', ')}` }),
      { status: 400 },
    );
  }

  if (file.size > MAX_FILE_SIZE) {
    return new Response(
      JSON.stringify({ error: `File too large (${(file.size / 1024 / 1024).toFixed(0)} MB). Max 500 MB.` }),
      { status: 400 },
    );
  }

  const config   = await readConfig();
  const geminiKeys = getIQSGeminiKeys(config);
  if (!geminiKeys.length) {
    return new Response(JSON.stringify({ error: 'No Gemini API key configured' }), { status: 500 });
  }
  const apiKey = geminiKeys[0];

  const audioBuffer = Buffer.from(await file.arrayBuffer());

  const encoder = new TextEncoder();
  const stream  = new ReadableStream({
    async start(controller) {
      try {
        const result = await analyzeCall({
          audioBuffer,
          fileName: file.name,
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
