import { KnowledgeChunk } from './types';
import { readConfig } from './config';
import { storeGetKBCache, storeSetKBCache, storeClearKBCache } from './store';

declare global {
  var __kbCache: KnowledgeChunk[] | null;
  var __kbCacheTime: number;
}

global.__kbCache = global.__kbCache || null;
global.__kbCacheTime = global.__kbCacheTime || 0;
const CACHE_TTL = 30 * 60 * 1000;

async function fetchWithTimeout(url: string, ms = 10000): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

function extractIds(url: string): { id: string | null; isDoc: boolean } {
  const docMatch = url.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
  const fileMatch = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  return { id: docMatch?.[1] || fileMatch?.[1] || null, isDoc: !!docMatch };
}

async function fetchDocTitle(id: string): Promise<string> {
  try {
    const res = await fetchWithTimeout(`https://docs.google.com/document/d/${id}/export?format=html`);
    if (!res.ok) return id;
    const html = await res.text();
    const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    return match?.[1]?.trim() || id;
  } catch {
    return id;
  }
}

function getDocName(url: string): string {
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/');
    const meaningful = parts.filter(p => p && !['document', 'file', 'd', 'edit', 'view', 'drive', 'folders'].includes(p));
    return meaningful[0] || url;
  } catch { return url; }
}

async function fetchGoogleDoc(url: string): Promise<{ text: string; name: string }> {
  const { id, isDoc } = extractIds(url);
  if (!id) throw new Error(`Cannot extract ID from URL: ${url}`);

  if (isDoc) {
    const [textRes, name] = await Promise.all([
      fetchWithTimeout(`https://docs.google.com/document/d/${id}/export?format=txt`),
      fetchDocTitle(id),
    ]);
    if (!textRes.ok) throw new Error(`Failed to fetch doc: ${textRes.status}`);
    return { text: await textRes.text(), name };
  }

  const res = await fetchWithTimeout(`https://drive.google.com/uc?export=download&id=${id}`);
  if (!res.ok) throw new Error(`Failed to fetch file: ${res.status}`);
  const contentType = res.headers.get('content-type') || '';

  if (contentType.includes('pdf')) {
    const buffer = Buffer.from(await res.arrayBuffer());
    const pdfParseModule = await import('pdf-parse');
    const pdfParse = (pdfParseModule as any).default ?? pdfParseModule;
    const parsed = await pdfParse(buffer);
    return { text: parsed.text, name: id };
  }
  return { text: await res.text(), name: id };
}

/**
 * Detects whether a line is a section header and returns its depth level (1–4).
 * Returns 0 if not a header.
 *
 * Patterns handled:
 *   1.  Top-level numbered      → "1. KYC Process"
 *   1.1 Sub-section             → "1.1 Account Opening Form"
 *   1.1.1 Deep sub-section      → "1.1.1 Status Definitions"
 *   ALL CAPS lines              → "KYC PROCESS" / "HUF KYC"
 *   Type-code prefixed          → "A1. KYC" / "E1 — SIP"
 *   Markdown                    → "## Overview"
 */
function getHeaderLevel(line: string): number {
  const t = line.trim();
  if (!t || t.length > 120) return 0;

  // Markdown: # / ## / ### / ####
  const md = t.match(/^(#{1,4})\s+\S/);
  if (md) return md[1].length;

  // Numbered section: "1." / "1.1" / "1.1.1" / "1.1.1.1"
  // Must start with digits.digits pattern and be followed by a capital or word char
  // Guard against plain list items (full sentences ending with punctuation)
  const num = t.match(/^(\d+(?:\.\d+)*)[.)]\s+(\S.*)/);
  if (num) {
    const rest = num[2];
    // Reject if it looks like a sentence (ends in . , ; ? !) and is long
    const isSentence = rest.length > 60 && /[.,:;?!]$/.test(rest);
    if (!isSentence) {
      const parts = num[1].split('.').filter(Boolean);
      return Math.min(parts.length, 4);
    }
  }

  // Type-code headers: "A1.", "B2.", "C1 —", "E1:", etc.
  const typeCode = t.match(/^[A-Z]\d+[.:\s—–-]\s*\S/);
  if (typeCode && t.length <= 80) return 1;

  // ALL CAPS line (min 4 chars, max 80, no lowercase, not purely numeric)
  // Allows spaces, hyphens, slashes, ampersands, parens
  if (
    t.length >= 4 &&
    t.length <= 80 &&
    /^[A-Z0-9][A-Z0-9\s\-\/&:(),.']+$/.test(t) &&
    /[A-Z]{2,}/.test(t) // at least 2 consecutive uppercase letters
  ) return 1;

  return 0;
}

/**
 * Section-aware chunker.
 *
 * Strategy:
 *  - Walk lines; when a header is found, flush the current buffer as a chunk.
 *  - Maintain a breadcrumb of ancestor headers so every chunk knows its full
 *    hierarchical context (e.g. "1. KYC > 1.1 AOF Status > 1.1.2 Expired").
 *  - If a section's content exceeds maxChars, split it on paragraph boundaries
 *    but prefix every sub-chunk with the breadcrumb so context is never lost.
 *  - Skip fragments that are too small to be useful (< 40 chars of real content).
 */
function chunkText(text: string, maxChars = 2000): string[] {
  const lines = text.split('\n');
  const chunks: string[] = [];

  // breadcrumb[i] = header text at nesting level i+1
  let breadcrumb: string[] = [];
  let buffer: string[] = [];

  function flush() {
    const content = buffer.join('\n').trim();
    buffer = [];
    if (!content || content.length < 40) return;

    const prefix = breadcrumb.join(' > ');
    const full = prefix ? `${prefix}\n\n${content}` : content;

    if (full.length <= maxChars) {
      chunks.push(full.trim());
      return;
    }

    // Section too large — split on paragraph boundaries, prefix each sub-chunk
    const paras = content.split(/\n{2,}/);
    let cur = '';
    for (const para of paras) {
      const candidate = cur ? `${cur}\n\n${para}` : para;
      const withPrefix = prefix ? `${prefix}\n\n${candidate}` : candidate;
      if (withPrefix.length > maxChars && cur.length > 0) {
        const out = prefix ? `${prefix}\n\n${cur}` : cur;
        chunks.push(out.trim());
        cur = para;
      } else {
        cur = candidate;
      }
    }
    if (cur.trim()) {
      const out = prefix ? `${prefix}\n\n${cur}` : cur;
      chunks.push(out.trim());
    }
  }

  for (const line of lines) {
    const level = getHeaderLevel(line);

    if (level > 0) {
      flush();
      // Trim breadcrumb to parent levels, then push this header
      breadcrumb = breadcrumb.slice(0, level - 1);
      breadcrumb[level - 1] = line.trim();
    } else {
      buffer.push(line);
    }
  }

  flush(); // final section
  return chunks.filter(c => c.trim().length >= 40);
}

export async function resetKBCache(): Promise<void> {
  global.__kbCache = null;
  global.__kbCacheTime = 0;
  await storeClearKBCache();
}

export async function fetchKnowledgeChunks(): Promise<KnowledgeChunk[]> {
  const now = Date.now();

  // 1. In-memory (fastest — same serverless instance)
  if (global.__kbCache && now - global.__kbCacheTime < CACHE_TTL) {
    return global.__kbCache;
  }

  // 2. KV cache (cross-invocation on Vercel)
  const fromKV = await storeGetKBCache();
  if (fromKV && fromKV.length > 0) {
    global.__kbCache = fromKV;
    global.__kbCacheTime = now;
    return fromKV;
  }

  // 3. Fetch fresh from Google Docs
  const config = await readConfig();
  const urls = config.knowledgeBaseUrls || [];
  const chunks: KnowledgeChunk[] = [];

  const results = await Promise.all(
    urls.map(url =>
      fetchGoogleDoc(url).catch(err => {
        console.error(`Failed to fetch ${url}:`, err);
        return null;
      })
    )
  );
  for (let i = 0; i < urls.length; i++) {
    const result = results[i];
    if (!result) continue;
    for (const chunk of chunkText(result.text)) {
      chunks.push({ fileId: urls[i], fileName: result.name, content: chunk });
    }
  }

  global.__kbCache = chunks;
  global.__kbCacheTime = now;
  await storeSetKBCache(chunks);
  return chunks;
}

/**
 * Simple suffix-stripping stemmer.
 * Normalises word variants so "pledging"/"pledged"/"pledge" all become "pledg",
 * "cancellation"/"cancelling"/"cancel" all become "cancel", etc.
 * Applied to BOTH query words and chunk text so mismatched inflections still score.
 */
function stemWord(word: string): string {
  if (word.length < 5) return word;
  // Try longer suffixes first so "ations" wins over "ions" wins over "s"
  const suffixes = [
    'ations', 'ation', 'ments', 'ment', 'nesses', 'ness',
    'ables', 'able', 'ibles', 'ible', 'ings', 'ing',
    'ied', 'ies', 'ed', 'es', 'ly', 's',
  ];
  for (const suf of suffixes) {
    if (word.endsWith(suf) && word.length - suf.length >= 3) {
      return word.slice(0, word.length - suf.length);
    }
  }
  return word;
}

export function retrieveRelevantChunks(chunks: KnowledgeChunk[], query: string, topK = 10): KnowledgeChunk[] {
  const q = query.toLowerCase();
  const rawWords = q.split(/\s+/).filter(w => w.length > 2);

  // Build search terms: original words PLUS their stemmed forms (deduped)
  const searchTerms = [...new Set([...rawWords, ...rawWords.map(stemWord)])];

  // 2-word and 3-word phrases from the original query for phrase-level boosting
  const phrases: string[] = [];
  for (let i = 0; i < rawWords.length - 1; i++) {
    phrases.push(`${rawWords[i]} ${rawWords[i + 1]}`);
    if (i < rawWords.length - 2) phrases.push(`${rawWords[i]} ${rawWords[i + 1]} ${rawWords[i + 2]}`);
  }

  const scored = chunks.map(chunk => {
    const lower = chunk.content.toLowerCase();

    // Split into header (breadcrumb path) vs body for weighted scoring
    const firstNewline = lower.indexOf('\n');
    const headerPart = firstNewline > -1 ? lower.slice(0, firstNewline) : lower;
    const bodyPart   = firstNewline > -1 ? lower.slice(firstNewline)    : '';

    let score = 0;

    // Word hits (including stemmed variants): header = 3×, body = 1×
    for (const term of searchTerms) {
      const re = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
      score += (headerPart.match(re) || []).length * 3;
      score += (bodyPart.match(re)   || []).length;
    }

    // Phrase hits: 5× per occurrence
    for (const phrase of phrases) {
      const re = new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
      score += (lower.match(re) || []).length * 5;
    }

    return { chunk, score };
  });

  // Sort by score descending; return topK regardless of score value.
  // Removing the score > 0 gate means the LLM always receives some KB context —
  // even when query terminology differs entirely from KB text, the highest-scoring
  // (or first-ranked) chunks are still passed so the model can reason across them.
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(s => s.chunk);
}

/** Returns the highest relevance score any chunk achieves for the given query.
 *  A score of 0 means no keyword overlap — safe signal to trigger a Slack fallback. */
export function getTopKBScore(chunks: KnowledgeChunk[], query: string): number {
  if (!chunks.length) return 0;
  const q = query.toLowerCase();
  const rawWords = q.split(/\s+/).filter(w => w.length > 2);
  const searchTerms = [...new Set([...rawWords, ...rawWords.map(stemWord)])];
  const phrases: string[] = [];
  for (let i = 0; i < rawWords.length - 1; i++) {
    phrases.push(`${rawWords[i]} ${rawWords[i + 1]}`);
    if (i < rawWords.length - 2) phrases.push(`${rawWords[i]} ${rawWords[i + 1]} ${rawWords[i + 2]}`);
  }
  let topScore = 0;
  for (const chunk of chunks) {
    const lower = chunk.content.toLowerCase();
    const firstNewline = lower.indexOf('\n');
    const headerPart = firstNewline > -1 ? lower.slice(0, firstNewline) : lower;
    const bodyPart   = firstNewline > -1 ? lower.slice(firstNewline)    : '';
    let score = 0;
    for (const term of searchTerms) {
      const re = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
      score += (headerPart.match(re) || []).length * 3;
      score += (bodyPart.match(re)   || []).length;
    }
    for (const phrase of phrases) {
      const re = new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
      score += (lower.match(re) || []).length * 5;
    }
    if (score > topScore) topScore = score;
  }
  return topScore;
}

export async function listDriveFiles() {
  const config = await readConfig();
  return (config.knowledgeBaseUrls || []).map(url => ({
    id: url,
    name: getDocName(url),
    mimeType: url.includes('/document/') ? 'application/vnd.google-apps.document' : 'application/pdf',
  }));
}
