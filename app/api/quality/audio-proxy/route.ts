import { NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';

export const dynamic = 'force-dynamic';

function getAudioContentType(url: string, upstreamType: string | null): string {
  if (upstreamType && upstreamType !== 'binary/octet-stream' && upstreamType !== 'application/octet-stream') {
    return upstreamType;
  }
  const cleanUrl = url.toLowerCase().split('?')[0];
  if (cleanUrl.endsWith('.wav')) return 'audio/wav';
  if (cleanUrl.endsWith('.mp3')) return 'audio/mpeg';
  if (cleanUrl.endsWith('.m4a')) return 'audio/mp4';
  if (cleanUrl.endsWith('.ogg')) return 'audio/ogg';
  if (cleanUrl.endsWith('.aac')) return 'audio/aac';
  if (cleanUrl.endsWith('.flac')) return 'audio/flac';
  return 'audio/wav';
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return new Response('Unauthorized', { status: 401 });
  }

  const url = req.nextUrl.searchParams.get('url');
  if (!url) {
    return new Response('URL parameter required', { status: 400 });
  }

  try {
    const rangeHeader = req.headers.get('range');
    const fetchHeaders: Record<string, string> = {};
    if (rangeHeader) {
      fetchHeaders['range'] = rangeHeader;
    }

    const response = await fetch(url, { headers: fetchHeaders });
    if (!response.ok && response.status !== 206) {
      return new Response(`Failed to fetch audio: ${response.statusText}`, { status: response.status });
    }

    const contentType = getAudioContentType(url, response.headers.get('content-type'));

    const headers = new Headers();
    headers.set('Content-Type', contentType);
    headers.set('Accept-Ranges', 'bytes');
    headers.set('Cache-Control', 'private, max-age=3600');

    // 1. If upstream handled the 206 Partial Content range request
    if (response.status === 206) {
      const contentRange = response.headers.get('content-range');
      if (contentRange) headers.set('Content-Range', contentRange);
      const contentLength = response.headers.get('content-length');
      if (contentLength) headers.set('Content-Length', contentLength);

      return new Response(response.body, {
        status: 206,
        headers,
      });
    }

    // 2. If client requested Range but upstream returned 200 (upstream ignored Range)
    if (rangeHeader && response.status === 200) {
      const buffer = await response.arrayBuffer();
      const totalLength = buffer.byteLength;

      const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
      if (match) {
        const start = parseInt(match[1], 10);
        const end = match[2] ? parseInt(match[2], 10) : totalLength - 1;

        if (start < totalLength) {
          const sliced = buffer.slice(start, Math.min(end + 1, totalLength));
          headers.set('Content-Range', `bytes ${start}-${start + sliced.byteLength - 1}/${totalLength}`);
          headers.set('Content-Length', sliced.byteLength.toString());

          return new Response(sliced, {
            status: 206,
            headers,
          });
        } else {
          headers.set('Content-Range', `bytes */${totalLength}`);
          return new Response(null, { status: 416, headers });
        }
      }
    }

    // 3. Standard full audio stream
    const contentLength = response.headers.get('content-length');
    if (contentLength) headers.set('Content-Length', contentLength);

    return new Response(response.body, {
      status: 200,
      headers,
    });
  } catch (err: any) {
    return new Response(`Audio proxy error: ${err.message}`, { status: 500 });
  }
}
