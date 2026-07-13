import { NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';

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
    const response = await fetch(url);
    if (!response.ok) {
      return new Response(`Failed to fetch audio: ${response.statusText}`, { status: response.status });
    }

    const contentType = response.headers.get('Content-Type') || 'audio/wav';
    const buffer = await response.arrayBuffer();

    return new Response(buffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (err: any) {
    return new Response(`Audio proxy error: ${err.message}`, { status: 500 });
  }
}
