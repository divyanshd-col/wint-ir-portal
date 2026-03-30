import { storeAppendCorrection, storeGetCorrections, storeSetCorrections } from './store';

export interface SourceChunk {
  fileId: string;
  fileName: string;
  breadcrumb: string;
  excerpt: string;
}

export interface CorrectionEntry {
  id: string;
  timestamp: string;
  submittedBy: string;
  originalQuery: string;
  originalAnswer: string;
  correctedAnswer: string;
  agentNote?: string;
  sourceChunks: SourceChunk[];
  formAnswers?: Record<string, string>;
  category?: string;
  status: 'pending' | 'approved' | 'rejected';
  promptSuggestion?: string;
  promptApproved?: boolean;
  resolvedAt?: string;
  resolvedBy?: string;
}

export async function appendCorrection(entry: CorrectionEntry): Promise<void> {
  await storeAppendCorrection(entry);
}

export async function getCorrections(): Promise<CorrectionEntry[]> {
  const raw = await storeGetCorrections();
  if (!raw.length) return [];
  return raw
    .map(item => {
      try { return typeof item === 'string' ? JSON.parse(item) : item; } catch { return null; }
    })
    .filter(Boolean) as CorrectionEntry[];
}

export async function updateCorrection(id: string, patch: Partial<CorrectionEntry>): Promise<void> {
  const all = await getCorrections();
  const updated = all.map(c => (c.id === id ? { ...c, ...patch } : c));
  // storeSetCorrections writes the full array as a single JSON string — use SET not LPUSH
  await storeSetCorrections(updated);
}
