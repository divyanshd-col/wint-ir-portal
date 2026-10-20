import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-guard';
import { query } from '@/lib/cx/db';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

function getS3Client(): S3Client | null {
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID || process.env.AWS_S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY || process.env.AWS_S3_SECRET_ACCESS_KEY;
  const region = process.env.AWS_REGION || 'ap-south-1';

  if (!accessKeyId || !secretAccessKey) {
    return null;
  }

  return new S3Client({
    region,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });
}

export async function GET(req: NextRequest) {
  const { response } = await requireRole(['admin', 'tl', 'agent', 'quality']);
  if (response) return response;

  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id') || searchParams.get('call_id');

  if (!id) {
    return NextResponse.json({ error: 'Call ID parameter is required' }, { status: 400 });
  }

  // For testing branch: handle synthetic dummy calls without database query
  if (id.startsWith('runo-') || !isNaN(Number(id))) {
    return NextResponse.json({ error: 'Audio recording not stored for synthetic testing call' }, { status: 404 });
  }

  try {
    // 1. Lookup call recording from database
    const rows = await query<{ recording_url: string }>(
      `SELECT recording_url FROM pcg_call_recordings WHERE (id::text = $1 OR call_id = $1) AND recording_url IS NOT NULL LIMIT 1`,
      [id]
    );

    if (!rows || rows.length === 0 || !rows[0].recording_url) {
      return NextResponse.json({ error: 'Call recording not found or has no recording URL' }, { status: 404 });
    }

    const s3Url = rows[0].recording_url;

    // 2. Parse S3 bucket and key from recording_url if possible
    let bucket = '';
    let key = '';
    try {
      const urlObj = new URL(s3Url);
      if (urlObj.hostname.includes('.s3.') || urlObj.hostname.endsWith('.s3.amazonaws.com')) {
        const parts = urlObj.hostname.split('.');
        bucket = parts[0];
        key = urlObj.pathname.replace(/^\/+/, '');
      } else {
        const pathParts = urlObj.pathname.replace(/^\/+/, '').split('/');
        bucket = pathParts[0] || '';
        key = pathParts.slice(1).join('/');
      }
    } catch {
      // Non-standard URL format
    }

    // Determine correct content type
    let contentType = 'audio/aac';
    const lowerKeyOrUrl = (key || s3Url).toLowerCase();
    if (lowerKeyOrUrl.includes('.wav')) contentType = 'audio/wav';
    else if (lowerKeyOrUrl.includes('.mp3')) contentType = 'audio/mpeg';
    else if (lowerKeyOrUrl.includes('.m4a')) contentType = 'audio/mp4';
    else if (lowerKeyOrUrl.includes('.ogg')) contentType = 'audio/ogg';

    // 3. Attempt S3 SDK fetch if credentials are configured
    const s3 = getS3Client();
    if (s3 && bucket && key) {
      try {
        const getCommand = new GetObjectCommand({
          Bucket: bucket,
          Key: key,
        });

        const s3Response = await s3.send(getCommand);
        if (s3Response.Body) {
          const stream = s3Response.Body.transformToWebStream();
          const headers = new Headers();
          headers.set('Content-Type', contentType);
          headers.set('Accept-Ranges', 'bytes');
          headers.set('Cache-Control', 'private, max-age=3600');
          if (s3Response.ContentLength) {
            headers.set('Content-Length', s3Response.ContentLength.toString());
          }

          return new NextResponse(stream, {
            status: 200,
            headers,
          });
        }
      } catch (s3Err) {
        console.warn('[admin/pcg-calls/audio] S3 SDK fetch failed, falling back to direct fetch:', s3Err);
      }
    }

    // 4. Fallback: Direct HTTP fetch (works for public S3 URLs, pre-signed URLs, or third-party audio CDNs)
    try {
      const directResponse = await fetch(s3Url);
      if (directResponse.ok && directResponse.body) {
        const headers = new Headers();
        headers.set('Content-Type', directResponse.headers.get('content-type') || contentType);
        headers.set('Accept-Ranges', 'bytes');
        headers.set('Cache-Control', 'private, max-age=3600');
        const len = directResponse.headers.get('content-length');
        if (len) headers.set('Content-Length', len);

        return new NextResponse(directResponse.body, {
          status: 200,
          headers,
        });
      }
    } catch (fetchErr) {
      console.warn('[admin/pcg-calls/audio] Direct fetch fallback failed:', fetchErr);
    }

    return NextResponse.json({ error: 'Failed to stream call recording audio' }, { status: 502 });
  } catch (error: any) {
    console.error('[admin/pcg-calls/audio] Error streaming audio:', error);
    return NextResponse.json({ error: 'Failed to stream call recording audio' }, { status: 500 });
  }
}
