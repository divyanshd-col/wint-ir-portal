import { NextRequest, NextResponse } from 'next/server';
import { createHash, timingSafeEqual } from 'crypto';
import { readConfig } from '@/lib/config';
import { fetchGoogleDoc } from '@/lib/drive';

// A cold call reads every KB Google Doc.
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const sha = (s: string) => createHash('sha256').update(s).digest();

interface KbDoc { fileId: string; fileName: string; text: string }
// ponytail: per-instance memory cache; each serverless instance fetches once per TTL. Move to the KV store if cold calls get too frequent.
const TTL = 15 * 60 * 1000;
let cache: { at: number; urls: string; docs: KbDoc[] } | null = null;

/**
 * GET /api/kb
 *
 * The CX knowledge base as the full text of every document, exactly as exported from Google Docs:
 *   { generatedAt, docCount, docs: [{ fileId, fileName, text }], errors?: [{ fileId, error }] }
 * `fileId` is the document URL saved in the portal settings. PCG's private AIF / MLD files are not included.
 * Documents that cannot be read are listed in `errors` instead of failing the whole call (and that result is not cached).
 *
 * Auth: `Authorization: Bearer <KB_API_TOKEN>`. Fails closed: with no KB_API_TOKEN set nothing is served.
 * Data can be up to 15 minutes old.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.KB_API_TOKEN;
  if (!secret) return NextResponse.json({ error: 'KB API is not configured' }, { status: 503 });

  const provided = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!timingSafeEqual(sha(provided), sha(secret))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: { 'WWW-Authenticate': 'Bearer' } });
  }

  const urls = (await readConfig()).knowledgeBaseUrls || [];
  const key = urls.join('\n');
  let docs: KbDoc[];
  const errors: { fileId: string; error: string }[] = [];

  if (cache && cache.urls === key && Date.now() - cache.at < TTL) {
    docs = cache.docs;
  } else {
    const results = await Promise.allSettled(urls.map(u => fetchGoogleDoc(u)));
    docs = [];
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') docs.push({ fileId: urls[i], fileName: r.value.name, text: r.value.text });
      else errors.push({ fileId: urls[i], error: String(r.reason?.message ?? r.reason).slice(0, 200) });
    });
    if (docs.length === 0 && urls.length > 0) {
      return NextResponse.json({ error: 'Could not read any knowledge base document', errors }, { status: 502 });
    }
    if (errors.length === 0) cache = { at: Date.now(), urls: key, docs };
  }

  return NextResponse.json(
    { generatedAt: new Date().toISOString(), docCount: docs.length, docs, ...(errors.length ? { errors } : {}) },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}
