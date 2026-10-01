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
  const { response } = await requireRole(['admin']);
  if (response) return response;

  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id') || searchParams.get('call_id');

  if (!id) {
    return NextResponse.json({ error: 'Call ID parameter is required' }, { status: 400 });
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

    // 2. Parse S3 bucket and key from recording_url
    const urlObj = new URL(s3Url);
    const bucket = urlObj.hostname.split('.')[0];
    const key = urlObj.pathname.substring(1);

    const s3 = getS3Client();
    if (!s3) {
      return NextResponse.json({ error: 'AWS S3 credentials not configured in server environment' }, { status: 500 });
    }

    // 3. Fetch object stream from S3
    const getCommand = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    const s3Response = await s3.send(getCommand);
    if (!s3Response.Body) {
      return NextResponse.json({ error: 'Empty response body from S3' }, { status: 502 });
    }

    // Determine correct content type
    let contentType = 'audio/aac';
    if (key.endsWith('.wav')) contentType = 'audio/wav';
    if (key.endsWith('.mp3')) contentType = 'audio/mpeg';
    if (key.endsWith('.m4a')) contentType = 'audio/mp4';

    // Stream the web ReadableStream directly
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
  } catch (error: any) {
    console.error('[admin/pcg-calls/audio] Error streaming S3 audio:', error);
    return NextResponse.json({ error: 'Failed to stream call recording audio' }, { status: 500 });
  }
}
