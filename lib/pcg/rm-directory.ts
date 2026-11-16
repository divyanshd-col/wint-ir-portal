import { query } from '@/lib/cx/db';
import { canonicalizePcgRmName } from '@/lib/pcg/canonical-names';

export interface PcgRmDirectoryRecord {
  id: number;
  phoneNumber: string;
  rmName: string;
  tlName: string;
  email: string | null;
  role: string;
  status: string;
}

let directoryCache: Map<string, PcgRmDirectoryRecord> | null = null;
let lastCacheRefresh = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Normalizes a phone number to standard 12-digit Indian format (e.g. '919187709712')
 */
export function normalizeRmPhone(rawPhone?: string | number | null): string {
  if (!rawPhone) return '';
  const clean = String(rawPhone).replace(/\D/g, '').trim();
  if (!clean) return '';
  if (clean.length === 10) return `91${clean}`;
  if (clean.length === 11 && clean.startsWith('0')) return `91${clean.slice(1)}`;
  if (clean.length === 12 && clean.startsWith('91')) return clean;
  return clean;
}

/**
 * Loads all active RM directory mappings into an in-memory map.
 */
export async function getPcgRmDirectoryMap(forceRefresh = false): Promise<Map<string, PcgRmDirectoryRecord>> {
  const now = Date.now();
  if (!forceRefresh && directoryCache && now - lastCacheRefresh < CACHE_TTL_MS) {
    return directoryCache;
  }

  try {
    const rows = await query<any>(`
      SELECT id, phone_number, rm_name, tl_name, email, role, status
      FROM pcg_rm_directory
      WHERE status = 'active'
    `);

    const map = new Map<string, PcgRmDirectoryRecord>();
    for (const r of rows) {
      const norm = normalizeRmPhone(r.phone_number);
      if (norm) {
        map.set(norm, {
          id: Number(r.id),
          phoneNumber: norm,
          rmName: r.rm_name,
          tlName: r.tl_name,
          email: r.email || null,
          role: r.role || 'rm',
          status: r.status || 'active',
        });
      }
    }

    directoryCache = map;
    lastCacheRefresh = now;
    return map;
  } catch (err: any) {
    console.error('[pcg/rm-directory] Failed to load RM directory:', err?.message || err);
    return directoryCache || new Map();
  }
}

/**
 * Resolves RM name and Team Lead for a given agent phone number.
 */
export async function resolvePcgRmByPhone(rawPhone?: string | number | null): Promise<{
  rm: string;
  tl: string;
  email?: string | null;
} | null> {
  if (!rawPhone) return null;
  const norm = normalizeRmPhone(rawPhone);
  if (!norm) return null;

  const map = await getPcgRmDirectoryMap();
  const entry = map.get(norm);
  if (entry) {
    return {
      rm: canonicalizePcgRmName(entry.rmName),
      tl: entry.tlName,
      email: entry.email,
    };
  }

  return null;
}

/**
 * Returns all mapped RM names for a given Team Lead identifier.
 * Combines database mappings from pcg_rm_directory and fallback TL_TEAMS.
 */
export async function getPcgRmsForTl(tlIdentifier: string): Promise<string[]> {
  if (!tlIdentifier || tlIdentifier.trim() === '' || tlIdentifier === 'all') return [];

  const cleanTl = tlIdentifier.replace(/^Team\s+/i, '').trim().toLowerCase();
  const rmsSet = new Set<string>();

  // 1. From pcg_rm_directory table
  try {
    const dirMap = await getPcgRmDirectoryMap();
    for (const entry of dirMap.values()) {
      const entryTlClean = entry.tlName.replace(/^Team\s+/i, '').trim().toLowerCase();
      if (entryTlClean === cleanTl || entryTlClean.includes(cleanTl) || cleanTl.includes(entryTlClean)) {
        if (entry.role !== 'tl') {
          rmsSet.add(canonicalizePcgRmName(entry.rmName));
        }
      }
    }
  } catch (err) {
    console.warn('[getPcgRmsForTl] Failed to query pcg_rm_directory:', err);
  }

  // 2. From static fallback TL_TEAMS in pcg-calls
  try {
    const { TL_TEAMS } = await import('@/app/api/admin/pcg-calls/route');
    for (const [tlName, members] of Object.entries(TL_TEAMS)) {
      const tlClean = tlName.replace(/^Team\s+/i, '').trim().toLowerCase();
      if (tlClean === cleanTl || tlClean.includes(cleanTl) || cleanTl.includes(tlClean)) {
        members.forEach((m) => rmsSet.add(canonicalizePcgRmName(m)));
      }
    }
  } catch (err) {
    console.warn('[getPcgRmsForTl] Failed to load TL_TEAMS:', err);
  }

  // Purge any TL themselves or admin names
  rmsSet.delete(canonicalizePcgRmName(tlIdentifier));
  rmsSet.delete(cleanTl);

  return Array.from(rmsSet).sort((a, b) => a.localeCompare(b));
}

