import fs from 'fs';
import path from 'path';
import {
  fetchKnowledgeChunks,
  retrieveRelevantChunks,
  chunkText,
} from '@/lib/drive';
import type { KnowledgeChunk } from '@/lib/types';

let pcgCustomChunksCache: KnowledgeChunk[] | null = null;

/**
 * Loads the PCG-exclusive AIF and MLD documents and chunks them.
 * These are completely separate from the CX AIF and MLD documents.
 */
function loadPcgExclusiveChunks(): KnowledgeChunk[] {
  if (pcgCustomChunksCache) {
    return pcgCustomChunksCache;
  }

  const chunks: KnowledgeChunk[] = [];
  const kbDir = path.join(process.cwd(), 'lib', 'pcg', 'kb');

  // 1. PCG Exclusive AIF Knowledge Base (Wint Wealth Debt Fund)
  const aifPath = path.join(kbDir, 'pcg-aif-kb.txt');
  if (fs.existsSync(aifPath)) {
    const aifText = fs.readFileSync(aifPath, 'utf8');
    for (const chunk of chunkText(aifText)) {
      chunks.push({
        fileId: 'pcg-exclusive-aif',
        fileName: 'PCG AIF Knowledge Base (Wint Wealth Debt Fund)',
        content: `[PCG Exclusive: AIF - Wint Wealth Debt Fund]\n${chunk}`,
      });
    }
  }

  // 2. PCG Exclusive MLD Knowledge Base (Market Linked Debentures)
  const mldPath = path.join(kbDir, 'pcg-mld-kb.txt');
  if (fs.existsSync(mldPath)) {
    const mldText = fs.readFileSync(mldPath, 'utf8');
    for (const chunk of chunkText(mldText)) {
      chunks.push({
        fileId: 'pcg-exclusive-mld',
        fileName: 'PCG MLD Knowledge Base (Market Linked Debentures)',
        content: `[PCG Exclusive: MLD - Market Linked Debentures]\n${chunk}`,
      });
    }
  }

  pcgCustomChunksCache = chunks;
  return chunks;
}

/**
 * Fetches all knowledge chunks for PCG evaluation:
 * - Uses all CX knowledge chunks (bonds, KYC, taxation, liquidity, etc.)
 * - EXCLUDES CX AIF and CX MLD documents
 * - INJECTS PCG-exclusive AIF and MLD documents
 */
export async function fetchPcgKnowledgeChunks(): Promise<KnowledgeChunk[]> {
  let cxChunks: KnowledgeChunk[] = [];
  try {
    cxChunks = await fetchKnowledgeChunks();
  } catch {
    cxChunks = [];
  }

  // Filter out any CX chunks that belong to AIF or MLD
  const filteredCxChunks = cxChunks.filter((chunk) => {
    const nameLower = (chunk.fileName || '').toLowerCase();
    const idLower = (chunk.fileId || '').toLowerCase();
    const contentHeader = (chunk.content.split('\n')[0] || '').toLowerCase();

    const isCxAif =
      nameLower.includes('aif') ||
      idLower.includes('aif') ||
      contentHeader.includes('[aif]') ||
      contentHeader.includes('aif >');

    const isCxMld =
      nameLower.includes('mld') ||
      idLower.includes('mld') ||
      contentHeader.includes('[mld]') ||
      contentHeader.includes('mld >');

    return !isCxAif && !isCxMld;
  });

  // Inject PCG-exclusive chunks
  const pcgExclusive = loadPcgExclusiveChunks();
  return [...filteredCxChunks, ...pcgExclusive];
}

/**
 * Retrieves relevant KB chunks for PCG call evaluation query.
 */
export async function retrievePcgRelevantChunks(
  query: string,
  topK = 5
): Promise<KnowledgeChunk[]> {
  const allPcgChunks = await fetchPcgKnowledgeChunks();
  return retrieveRelevantChunks(allPcgChunks, query, topK);
}

/**
 * Builds formatted KB Context for LLM prompt during PCG Call Scoring.
 */
export async function getPcgKbContextForScoring(
  searchQuery: string,
  topK = 6
): Promise<string> {
  if (!searchQuery.trim()) return '';

  const relevant = await retrievePcgRelevantChunks(searchQuery, topK);
  if (!relevant.length) return '';

  return relevant
    .map((c) => {
      return `[${c.fileName}]\n${c.content}`;
    })
    .join('\n---\n');
}
