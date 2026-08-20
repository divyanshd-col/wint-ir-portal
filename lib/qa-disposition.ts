import { PortalConfig } from './config';
import { query } from './cx/db';

export function isManorathi(email: string): boolean {
  const e = (email || '').toLowerCase().trim();
  return e === 'manorathi@wintwealth.com' || e === 'manorathi.t@wintwealth.com';
}

/**
 * Returns the list of dispositions a user is authorized to see based on qaDispositionMap.
 * - Admin: sees all dispositions (or specific assigned dispositions if configured)
 * - Assigned QA (e.g. Dipti): sees ONLY their assigned dispositions from qaDispositionMap
 * - Manorathi (fallback QA): sees her assigned dispositions + any unassigned dispositions from DB (never sees dispositions assigned to others)
 */
export async function getAuthorizedDispositions(
  email: string,
  role: string,
  config: PortalConfig,
  allDbDispositions?: string[]
): Promise<string[]> {
  const map = config.qaDispositionMap ?? [];
  const cleanEmail = (email || '').toLowerCase().trim();
  const qaEntry = map.find(e => e.email.toLowerCase().trim() === cleanEmail);

  let dbDisps = allDbDispositions;
  if (!dbDisps) {
    try {
      const rows = await query<{ d: string }>(`
        SELECT DISTINCT tags->>'disposition' AS d
        FROM conversations
        WHERE tags->>'disposition' IS NOT NULL AND tags->>'disposition' != ''
      `);
      dbDisps = rows.map(r => r.d).filter(Boolean);
    } catch {
      dbDisps = [];
    }
  }

  if (role === 'admin' && (!qaEntry || qaEntry.dispositions.length === 0)) {
    return dbDisps;
  }

  if (isManorathi(cleanEmail)) {
    // Dispositions assigned to OTHER QAs
    const otherQADispositions = new Set(
      map
        .filter(e => !isManorathi(e.email))
        .flatMap(e => e.dispositions || [])
        .map(d => d.trim().toLowerCase())
    );

    const manorathiAssigned = qaEntry?.dispositions ?? [];
    const unassignedFromDb = dbDisps.filter(d => !otherQADispositions.has(d.trim().toLowerCase()));

    const resultSet = new Set<string>();
    for (const d of manorathiAssigned) resultSet.add(d);
    for (const d of unassignedFromDb) resultSet.add(d);
    return Array.from(resultSet);
  }

  if (qaEntry && qaEntry.dispositions.length > 0) {
    return qaEntry.dispositions;
  }

  if (role === 'quality') {
    const configUser = config.users.find(u => (u.email || u.username || '').toLowerCase() === cleanEmail);
    return configUser?.assignedDispositions ?? [];
  }

  return [];
}

/**
 * Returns the list of call dispositions a user is authorized to see based on qaDispositionMap.
 */
export async function getAuthorizedCallDispositions(
  email: string,
  role: string,
  config: PortalConfig,
  allDbCallDispositions?: string[]
): Promise<string[]> {
  const map = config.qaDispositionMap ?? [];
  const cleanEmail = (email || '').toLowerCase().trim();
  const qaEntry = map.find(e => e.email.toLowerCase().trim() === cleanEmail);

  let dbDisps = allDbCallDispositions;
  if (!dbDisps) {
    try {
      const rows = await query<{ d: string }>(`
        SELECT DISTINCT call_disposition AS d
        FROM call_recordings
        WHERE call_disposition IS NOT NULL AND call_disposition != ''
      `);
      dbDisps = rows.map(r => r.d).filter(Boolean);
    } catch {
      dbDisps = [];
    }
  }

  if (role === 'admin' && (!qaEntry || qaEntry.dispositions.length === 0)) {
    return dbDisps;
  }

  if (isManorathi(cleanEmail)) {
    const otherQADispositions = new Set(
      map
        .filter(e => !isManorathi(e.email))
        .flatMap(e => e.dispositions || [])
        .map(d => d.trim().toLowerCase())
    );

    const manorathiAssigned = qaEntry?.dispositions ?? [];
    const unassignedFromDb = dbDisps.filter(d => !otherQADispositions.has(d.trim().toLowerCase()));

    const resultSet = new Set<string>();
    for (const d of manorathiAssigned) resultSet.add(d);
    for (const d of unassignedFromDb) resultSet.add(d);
    return Array.from(resultSet);
  }

  if (qaEntry && qaEntry.dispositions.length > 0) {
    return qaEntry.dispositions;
  }

  if (role === 'quality') {
    const configUser = config.users.find(u => (u.email || u.username || '').toLowerCase() === cleanEmail);
    return (configUser as any)?.assignedCallDispositions ?? [];
  }

  return [];
}
