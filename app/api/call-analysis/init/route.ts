const ROUTE = 'call-analysis/init';
import { log, withLogging } from '@/lib/log';
/**
 * POST /api/call-analysis/init
 *
 * Step 1 of browser-direct upload flow.
 * Server calls Gemini File API to open a resumable upload session,
 * returns the upload URL to the browser. The browser then uploads
 * the file bytes directly to Gemini — bypassing Vercel's 4.5MB limit.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { readConfig } from '@/lib/config';
import { getIQSGeminiKeys } from '@/lib/gemini';

export const runtime = 'nodejs';

const GEMINI_UPLOAD_BASE = 'https://generativelanguage.googleapis.com/upload/v1beta/files';

const MIME_MAP: Record<string, string> = {
  mp3:  'audio/mpeg',
  wav:  'audio/wav',
  m4a:  'audio/mp4',
  ogg:  'audio/ogg',
  flac: 'audio/flac',
};

async function _POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const user    = session?.user as any;
  if (!user || (!user.isAdmin && user.role !== 'tl')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { fileName, fileSize } = await req.json();
  if (!fileName) return NextResponse.json({ error: 'fileName required' }, { status: 400 });

  const ext      = (fileName.split('.').pop() ?? '').toLowerCase();
  const mimeType = MIME_MAP[ext];
  if (!mimeType) {
    return NextResponse.json({ error: `Unsupported format: .${ext}` }, { status: 400 });
  }

  const config = await readConfig();
  const keys   = getIQSGeminiKeys(config);
  if (!keys.length) return NextResponse.json({ error: 'No Gemini API key configured' }, { status: 500 });
  const apiKey = keys[0];

  try {
    const res = await fetch(`${GEMINI_UPLOAD_BASE}?uploadType=resumable&key=${apiKey}`, {
      method: 'POST',
      headers: {
        'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': String(fileSize ?? 0),
        'X-Goog-Upload-Header-Content-Type': mimeType,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ file: { display_name: fileName } }),
    });

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ error: `Gemini init failed (${res.status}): ${text.slice(0, 200)}` }, { status: 502 });
    }

    const uploadUrl = res.headers.get('x-goog-upload-url');
    if (!uploadUrl) return NextResponse.json({ error: 'No upload URL from Gemini' }, { status: 502 });

    return NextResponse.json({ uploadUrl, mimeType });
  } catch (err: any) {
    return NextResponse.json({ error: `Init network error: ${err.message}` }, { status: 502 });
  }
}

export const POST = withLogging(ROUTE, _POST);
