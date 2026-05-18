/**
 * Media context enrichment for IQS chat scoring.
 * Extracts publicly accessible URLs from transcript text, fetches their content
 * (images as base64, docs/pages as text snippets), and returns them in a format
 * ready to inject into the LLM scoring call.
 */

import { fetchGoogleDoc } from './drive';

const URL_LIMIT = 8;
const IMAGE_LIMIT = 3;
const DOC_LIMIT = 3;
const FETCH_TIMEOUT_MS = 5000;
const MAX_DOC_CHARS = 800;
const MAX_IMAGE_BYTES = 800_000;

// Known image CDN hostnames
const IMAGE_HOSTS = new Set(['imgur.com', 'i.imgur.com', 'i.ibb.co', 'cloudinary.com', 'res.cloudinary.com']);

type UrlType = 'image' | 'google-doc' | 'google-drive' | 'pdf' | 'loom' | 'youtube' | 'page';

export interface MediaEnrichment {
  /** Gemini inline_data parts — slot directly into the `parts` array */
  imageParts: Array<{ inlineData: { mimeType: string; data: string } }>;
  /** Claude base64 image parts — slot into the `content` array */
  claudeImageParts: Array<{ type: 'image'; source: { type: 'base64'; media_type: string; data: string } }>;
  /** Formatted text block to append to kbContext */
  textContext: string;
}

async function fetchWithTimeout(url: string, ms = FETCH_TIMEOUT_MS): Promise<Response> {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { signal: ctrl.signal });
  } finally {
    clearTimeout(id);
  }
}

export function extractUrls(text: string): string[] {
  const raw = text.match(/https?:\/\/[^\s"')>\]]+/g) ?? [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (let url of raw) {
    // Strip trailing punctuation that commonly trails URLs in chat text
    url = url.replace(/[.,;:!?)>]+$/, '');
    // Skip Robylon internals and localhost
    try {
      const { hostname } = new URL(url);
      if (hostname.includes('robylon') || hostname.includes('localhost') || hostname === '127.0.0.1') continue;
    } catch {
      continue;
    }
    if (!seen.has(url)) {
      seen.add(url);
      result.push(url);
    }
    if (result.length >= URL_LIMIT) break;
  }
  return result;
}

function classifyUrl(url: string): UrlType {
  try {
    const { hostname, pathname } = new URL(url);
    const ext = pathname.split('.').pop()?.toLowerCase() ?? '';

    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'].includes(ext)) return 'image';
    if (IMAGE_HOSTS.has(hostname)) return 'image';

    if (hostname === 'docs.google.com' && pathname.includes('/document/')) return 'google-doc';
    if (hostname === 'drive.google.com') return 'google-drive';

    if (ext === 'pdf') return 'pdf';

    if (hostname === 'loom.com' || hostname === 'www.loom.com') return 'loom';
    if (hostname === 'youtube.com' || hostname === 'www.youtube.com' || hostname === 'youtu.be') return 'youtube';
  } catch {
    // fall through
  }
  return 'page';
}

async function fetchImagePart(url: string): Promise<{ mimeType: string; data: string } | null> {
  try {
    // HEAD first to check size and type before downloading the full body
    let mimeType = '';
    try {
      const head = await fetchWithTimeout(url, 3000);
      const ct = head.headers.get('content-type') ?? '';
      const cl = parseInt(head.headers.get('content-length') ?? '0', 10);
      if (cl > MAX_IMAGE_BYTES) return null;
      if (ct) mimeType = ct.split(';')[0].trim();
    } catch {
      // HEAD not supported — fall through to GET
    }

    const res = await fetchWithTimeout(url);
    if (!res.ok) return null;

    const buffer = await res.arrayBuffer();
    if (buffer.byteLength > MAX_IMAGE_BYTES) return null;

    if (!mimeType) {
      mimeType = res.headers.get('content-type')?.split(';')[0].trim() ?? 'image/jpeg';
    }
    if (!mimeType.startsWith('image/')) return null;

    const base64 = Buffer.from(buffer).toString('base64');
    return { mimeType, data: base64 };
  } catch {
    return null;
  }
}

async function fetchDocContext(url: string, type: 'google-doc' | 'google-drive' | 'pdf'): Promise<{ label: string; text: string } | null> {
  try {
    if (type === 'google-doc' || type === 'google-drive') {
      const { text, name } = await fetchGoogleDoc(url);
      return { label: name || 'Google Doc', text: text.slice(0, MAX_DOC_CHARS) };
    }
    if (type === 'pdf') {
      const res = await fetchWithTimeout(url);
      if (!res.ok) return null;
      const buffer = Buffer.from(await res.arrayBuffer());
      const pdfParseModule = await import('pdf-parse');
      const pdfParse = (pdfParseModule as any).default ?? pdfParseModule;
      const parsed = await pdfParse(buffer);
      return { label: 'PDF', text: (parsed.text as string).slice(0, MAX_DOC_CHARS) };
    }
  } catch {
    // ignore — fetch errors are expected for private/inaccessible links
  }
  return null;
}

async function fetchPageMeta(url: string): Promise<{ label: string; text: string } | null> {
  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') ?? '';
    if (!ct.includes('text/html')) return null;
    // Read only the first 8 KB to find meta tags without downloading the whole page
    const reader = res.body?.getReader();
    if (!reader) return null;
    let html = '';
    while (html.length < 8192) {
      const { done, value } = await reader.read();
      if (done) break;
      html += Buffer.from(value).toString('utf8');
    }
    reader.cancel().catch(() => {});

    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const descMatch  = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)
                    ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i);
    const title = titleMatch?.[1]?.trim() ?? '';
    const desc  = descMatch?.[1]?.trim() ?? '';

    const text = [title, desc].filter(Boolean).join(' — ');
    if (!text) return null;
    return { label: 'Link', text };
  } catch {
    return null;
  }
}

/** Loom/YouTube: just surface the URL as a note — we can't watch the video. */
function videoNote(url: string, type: 'loom' | 'youtube'): { label: string; text: string } {
  const name = type === 'loom' ? 'Loom video' : 'YouTube video';
  return { label: name, text: `${name} shared: ${url} (content not fetched — video file)` };
}

/**
 * Main entry point.
 * Extracts all URLs from the transcript, fetches accessible media, and returns
 * image parts (for Gemini / Claude multimodal calls) plus a text context block.
 * Always resolves — never throws.
 */
export async function enrichTranscriptWithMedia(transcriptText: string): Promise<MediaEnrichment> {
  const empty: MediaEnrichment = { imageParts: [], claudeImageParts: [], textContext: '' };

  const urls = extractUrls(transcriptText);
  if (urls.length === 0) return empty;

  // Classify all URLs, then prioritise: images first, then docs/pages
  const classified = urls.map(url => ({ url, type: classifyUrl(url) }));
  const images = classified.filter(u => u.type === 'image').slice(0, IMAGE_LIMIT);
  const docs   = classified.filter(u => u.type !== 'image').slice(0, DOC_LIMIT);

  const imageParts: MediaEnrichment['imageParts']       = [];
  const claudeImageParts: MediaEnrichment['claudeImageParts'] = [];
  const textLines: string[] = [];

  // Fetch all in parallel — failures are silently skipped
  const imageResults = await Promise.allSettled(
    images.map(u => fetchImagePart(u.url))
  );

  for (let i = 0; i < images.length; i++) {
    const r = imageResults[i];
    if (r.status === 'fulfilled' && r.value) {
      const { mimeType, data } = r.value;
      imageParts.push({ inlineData: { mimeType, data } });
      claudeImageParts.push({ type: 'image', source: { type: 'base64', media_type: mimeType as any, data } });
    }
  }

  const docResults = await Promise.allSettled(
    docs.map(({ url, type }) => {
      if (type === 'google-doc' || type === 'google-drive' || type === 'pdf') return fetchDocContext(url, type);
      if (type === 'loom' || type === 'youtube') return Promise.resolve(videoNote(url, type));
      return fetchPageMeta(url);
    })
  );

  for (let i = 0; i < docs.length; i++) {
    const r = docResults[i];
    if (r.status === 'fulfilled' && r.value) {
      textLines.push(`[${r.value.label}] ${r.value.text}`);
    }
  }

  if (imageParts.length > 0) {
    textLines.unshift(`${imageParts.length} image(s) attached above — evaluate them as screenshots or media shared during the chat.`);
  }

  return {
    imageParts,
    claudeImageParts,
    textContext: textLines.join('\n'),
  };
}
