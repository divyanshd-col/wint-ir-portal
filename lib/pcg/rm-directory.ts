/**
 * lib/pcg/rm-directory.ts
 *
 * Source-of-truth service for PCG Relationship Managers and Team Leads.
 * Dynamically loads and caches the `pcg_rm_directory` table from Postgres,
 * providing RM-to-TL mapping, role detection (RM vs TL), phone number lookup,
 * and seamless fallback when offline.
 *
 * NOTE: The `pcg_rm_directory` table is managed directly in DB by admin/leadership.
 * Do not make schema or row modifications to that table.
 */

import { query } from '@/lib/cx/db';
import { canonicalizePcgRmName } from '@/lib/pcg/canonical-names';
import { log } from '@/lib/log';

const ROUTE = 'pcg-rm-directory';

export interface PcgRmDirectoryRow {
  id: string | number;
  rm_name: string;
  tl_name: string;
  role: 'rm' | 'tl' | string;
  email?: string | null;
  phone_number?: string | null;
  status?: string | null;
}

// ── In-Memory Static Fallback (Snapshot of pcg_rm_directory) ─────────────────
export const STATIC_PCG_DIRECTORY: PcgRmDirectoryRow[] = [
  // Team Swetha
  { id: '2', rm_name: 'Ankita Agarwal', tl_name: 'Team Swetha', email: 'ankita.a@wintwealth.com', role: 'rm', phone_number: '917001428772', status: 'active' },
  { id: '8', rm_name: 'Diya Sharma', tl_name: 'Team Swetha', email: 'diya.sharma@wintwealth.com', role: 'rm', phone_number: '919187709725', status: 'active' },
  { id: '18', rm_name: 'Nishtha Veerwani', tl_name: 'Team Swetha', email: 'nishtha.veerwani@wintwealth.com', role: 'rm', phone_number: '918839218181', status: 'active' },
  { id: '22', rm_name: 'Mishra Richa Santoshkumar', tl_name: 'Team Swetha', email: 'richa.mishra@wintwealth.com', role: 'rm', phone_number: '917001428773', status: 'active' },
  { id: '29', rm_name: 'Shreya Premkumar Mundada', tl_name: 'Team Swetha', email: 'shreya.mundada@wintwealth.com', role: 'rm', phone_number: '919187709726', status: 'active' },
  { id: '34', rm_name: 'Sujal Dadwani', tl_name: 'Team Swetha', email: 'sujal.dadwani@wintwealth.com', role: 'rm', phone_number: '919187709724', status: 'active' },
  { id: '35', rm_name: 'Suryansh Sharma', tl_name: 'Team Swetha', email: 'suryansh.sharma@wintwealth.com', role: 'rm', phone_number: '919187709727', status: 'active' },
  { id: '36', rm_name: 'Swetha', tl_name: 'Team Swetha', email: 'swetha@wintwealth.com', role: 'tl', phone_number: '919108891628', status: 'active' },
  { id: '38', rm_name: 'Vaishnavi N J', tl_name: 'Team Swetha', email: 'vaishnavi@wintwealth.com', role: 'rm', phone_number: '919187709714', status: 'active' },
  { id: '39', rm_name: 'Vaishnavi Naghat', tl_name: 'Team Swetha', email: 'vaishnavi.naghat@wintwealth.com', role: 'rm', phone_number: '919187709728', status: 'active' },
  { id: '40', rm_name: 'Vidisha Jaiswal', tl_name: 'Team Swetha', email: 'vidisha.jaiswal@wintwealth.com', role: 'rm', phone_number: '919187709717', status: 'active' },
  { id: '43', rm_name: 'Vishyata Tulsani', tl_name: 'Team Swetha', email: 'vishyata.tulsani@wintwealth.com', role: 'rm', phone_number: '919187709729', status: 'active' },

  // Team Saiyam Rastogi
  { id: '5', rm_name: 'Ayan Kumar Garg', tl_name: 'Team Saiyam Rastogi', email: 'ayan.garg@wintwealth.com', role: 'rm', phone_number: '918447524484', status: 'active' },
  { id: '9', rm_name: 'Gaurav Nautiyal', tl_name: 'Team Saiyam Rastogi', email: 'gaurav.nautiyal@wintwealth.com', role: 'rm', phone_number: '919187709723', status: 'active' },
  { id: '15', rm_name: 'Mahi Agarwal', tl_name: 'Team Saiyam Rastogi', email: 'mahi.agarwal@wintwealth.com', role: 'rm', phone_number: '917430880385', status: 'active' },
  { id: '16', rm_name: 'Nandini', tl_name: 'Team Saiyam Rastogi', email: 'Nandini.j@wintwealth.com', role: 'rm', phone_number: '919729123268', status: 'active' },
  { id: '23', rm_name: 'Rukmini Mundhara', tl_name: 'Team Saiyam Rastogi', email: 'rukmini.mundhara@wintwealth.com', role: 'rm', phone_number: '919187709730', status: 'active' },
  { id: '24', rm_name: 'Sahil Joshi', tl_name: 'Team Saiyam Rastogi', email: 'sahil.j@wintwealth.com', role: 'rm', phone_number: '919187709731', status: 'active' },
  { id: '25', rm_name: 'Saiyam Rastogi', tl_name: 'Team Saiyam Rastogi', email: 'saiyam@wintwealth.com', role: 'tl', phone_number: '919036315550', status: 'active' },
  { id: '31', rm_name: 'Shruti Sharma', tl_name: 'Team Saiyam Rastogi', email: 'shruti.sharma@wintwealth.com', role: 'rm', phone_number: '919187709722', status: 'active' },
  { id: '42', rm_name: 'Vishal Kumar Yadav', tl_name: 'Team Saiyam Rastogi', email: 'vishalkumar@wintwealth.com', role: 'rm', phone_number: '919187709712', status: 'active' },

  // Team Tanisha Mittal
  { id: '3', rm_name: 'Antara Chakraborty', tl_name: 'Team Tanisha Mittal', email: 'antara@wintwealth.com', role: 'rm', phone_number: '919187709715', status: 'active' },
  { id: '6', rm_name: 'Deshna Dugar', tl_name: 'Team Tanisha Mittal', email: 'deshna@wintwealth.com', role: 'rm', phone_number: '919187709718', status: 'active' },
  { id: '10', rm_name: 'Harshita Dhona', tl_name: 'Team Tanisha Mittal', email: 'harshita@wintwealth.com', role: 'rm', phone_number: '919741437057', status: 'active' },
  { id: '12', rm_name: 'Keshvi Suresh Thacker', tl_name: 'Team Tanisha Mittal', email: 'keshvi.thacker@wintwealth.com', role: 'rm', phone_number: '919998838100', status: 'active' },
  { id: '13', rm_name: 'Maniyar Kriya Jignesh', tl_name: 'Team Tanisha Mittal', email: 'kriya.maniyar@wintwealth.com', role: 'rm', phone_number: '919187980517', status: 'active' },
  { id: '17', rm_name: 'Nischay Manish Jain', tl_name: 'Team Tanisha Mittal', email: 'nischay.jain@wintwealth.com', role: 'rm', phone_number: '917600440691', status: 'active' },
  { id: '26', rm_name: 'Samskrithi Rao N', tl_name: 'Team Tanisha Mittal', email: 'samskrithi@wintwealth.com', role: 'rm', phone_number: '919187709713', status: 'active' },
  { id: '37', rm_name: 'Tanisha Mittal', tl_name: 'Team Tanisha Mittal', email: 'tanisha@wintwealth.com', role: 'tl', phone_number: '919036265556', status: 'active' },

  // Team Dheeraj Bhojwani
  { id: '7', rm_name: 'Dheeraj Bhojwani', tl_name: 'Team Dheeraj Bhojwani', email: 'dheeraj@wintwealth.com', role: 'tl', phone_number: '916366385390', status: 'active' },
  { id: '11', rm_name: 'Ishaan Kapoor', tl_name: 'Team Dheeraj Bhojwani', email: 'ishaan.kapoor@wintwealth.com', role: 'rm', phone_number: '919187709711', status: 'active' },
  { id: '19', rm_name: 'Paritosh Ashiya', tl_name: 'Team Dheeraj Bhojwani', email: 'paritosh.ashiya@wintwealth.com', role: 'rm', phone_number: '919187709721', status: 'active' },
  { id: '21', rm_name: 'Ramita Kapoor', tl_name: 'Team Dheeraj Bhojwani', email: 'ramita.kapoor@wintwealth.com', role: 'rm', phone_number: '919187709720', status: 'active' },
  { id: '27', rm_name: 'Sargun Singh', tl_name: 'Team Dheeraj Bhojwani', email: 'sargun.singh@wintwealth.com', role: 'rm', phone_number: '919187709719', status: 'active' },
  { id: '28', rm_name: 'Shivam Kumar Baghel', tl_name: 'Team Dheeraj Bhojwani', email: 'shivam.baghel@wintwealth.com', role: 'rm', phone_number: '919187709732', status: 'active' },
  { id: '30', rm_name: 'Shrey Jain', tl_name: 'Team Dheeraj Bhojwani', email: 'shrey.jain@wintwealth.com', role: 'rm', phone_number: '919187709716', status: 'active' },
  { id: '44', rm_name: 'Yaashvi Arora', tl_name: 'Team Dheeraj Bhojwani', email: 'yaashvi.arora@wintwealth.com', role: 'rm', phone_number: '919187709710', status: 'active' },

  // Team Sravanthi
  { id: '4', rm_name: 'Anurag Negi', tl_name: 'Team Sravanthi', email: 'anurag.negi@wintwealth.com', role: 'rm', phone_number: '918433264610', status: 'active' },
  { id: '14', rm_name: 'Mahek Bihani', tl_name: 'Team Sravanthi', email: 'mahek.bihani@wintwealth.com', role: 'rm', phone_number: '919187980521', status: 'active' },
  { id: '32', rm_name: 'Sravanthi', tl_name: 'Team Sravanthi', email: 'sravanthi@wintwealth.com', role: 'tl', phone_number: '919036335553', status: 'active' },
  { id: '41', rm_name: 'Vidyul Kapoor', tl_name: 'Team Sravanthi', email: 'vidyul.kapoor@wintwealth.com', role: 'rm', phone_number: '919187980522', status: 'active' },

  // Team Admin
  { id: '1', rm_name: 'Aboli Jawkhedkar', tl_name: 'Team Admin', email: 'aboli.jawkhedkar@quicksell.co', role: 'rm', phone_number: '917039038853', status: 'active' },
  { id: '20', rm_name: 'Pranav Sharma', tl_name: 'Team Admin', email: 'pranav.s@wintwealth.com', role: 'rm', phone_number: '919187980516', status: 'active' },
  { id: '33', rm_name: 'Sreeram', tl_name: 'Team Admin', email: 'sreeram.v@wintwealth.com', role: 'rm', phone_number: '919187980515', status: 'active' },
];

// ── In-Memory Cache ───────────────────────────────────────────────────────────
let cachedDirectory: PcgRmDirectoryRow[] | null = null;
let lastCacheFetchTime = 0;
const CACHE_TTL_MS = 60_000; // 1 minute TTL

/**
 * Fetch all rows from pcg_rm_directory with 1-minute in-memory caching.
 * Falls back gracefully to STATIC_PCG_DIRECTORY if query fails.
 */
export async function getPcgRmDirectory(forceRefresh = false): Promise<PcgRmDirectoryRow[]> {
  const now = Date.now();
  if (cachedDirectory && !forceRefresh && now - lastCacheFetchTime < CACHE_TTL_MS) {
    return cachedDirectory;
  }

  try {
    const rows = await query<PcgRmDirectoryRow>(
      `SELECT id, rm_name, tl_name, role, email, phone_number, status
       FROM pcg_rm_directory
       ORDER BY id ASC`
    );

    if (Array.isArray(rows) && rows.length > 0) {
      cachedDirectory = rows;
      lastCacheFetchTime = now;
      return cachedDirectory;
    }
  } catch (err: any) {
    log.warn(ROUTE, `Could not query pcg_rm_directory: ${err?.message}. Using cached or static directory.`);
  }

  if (cachedDirectory) {
    return cachedDirectory;
  }

  cachedDirectory = [...STATIC_PCG_DIRECTORY];
  lastCacheFetchTime = now;
  return cachedDirectory;
}

/**
 * Cleans phone number to last 10 digits for reliable cross-system matching.
 */
function cleanPhoneDigits(phone?: string | null): string {
  if (!phone) return '';
  const digits = String(phone).replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

/**
 * Matches candidate name against target using word boundaries.
 */
function matchesWordBoundary(text: string, queryName: string): boolean {
  if (!text || !queryName) return false;
  const t = text.trim().toLowerCase();
  const q = queryName.trim().toLowerCase();
  if (t === q) return true;

  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rx = new RegExp(`(^|\\s)${escaped}(\\s|$)`, 'i');
  return rx.test(t);
}

/**
 * Resolves a caller/agent (by name, phone, or alias) against `pcg_rm_directory`.
 * Returns canonical RM name, assigned TL name, role ('rm' | 'tl'), and email.
 */
export async function resolvePcgAgentFromDirectory(
  rawCaller: any,
  customTeamMap?: Record<string, string>
): Promise<{ rm: string; tl: string; role: 'rm' | 'tl' | string; email?: string | null }> {
  if (!rawCaller) {
    return { rm: 'Unassigned RM', tl: 'PCG Team', role: 'rm' };
  }

  const rawStr = typeof rawCaller === 'object'
    ? (rawCaller.called_by || rawCaller.agent_name || rawCaller.rm_name || '')
    : String(rawCaller);

  if (!rawStr || !rawStr.trim() || rawStr.trim().toLowerCase() === 'unknown') {
    return { rm: 'Unassigned RM', tl: 'PCG Team', role: 'rm' };
  }

  const directory = await getPcgRmDirectory();
  return matchAgentInDirectory(rawStr.trim(), directory, customTeamMap);
}

/**
 * Synchronous resolver using the current cached directory (or static snapshot).
 */
export function resolvePcgAgentSync(
  rawCaller: any,
  customTeamMap?: Record<string, string>
): { rm: string; tl: string; role: 'rm' | 'tl' | string; email?: string | null } {
  if (!rawCaller) {
    return { rm: 'Unassigned RM', tl: 'PCG Team', role: 'rm' };
  }

  const rawStr = typeof rawCaller === 'object'
    ? (rawCaller.called_by || rawCaller.agent_name || rawCaller.rm_name || '')
    : String(rawCaller);

  if (!rawStr || !rawStr.trim() || rawStr.trim().toLowerCase() === 'unknown') {
    return { rm: 'Unassigned RM', tl: 'PCG Team', role: 'rm' };
  }

  const directory = cachedDirectory || STATIC_PCG_DIRECTORY;
  return matchAgentInDirectory(rawStr.trim(), directory, customTeamMap);
}

/**
 * Internal matcher across names, aliases, canonical names, and phone numbers.
 */
function matchAgentInDirectory(
  rawStr: string,
  directory: PcgRmDirectoryRow[],
  customTeamMap?: Record<string, string>
): { rm: string; tl: string; role: 'rm' | 'tl' | string; email?: string | null } {
  const canonical = canonicalizePcgRmName(rawStr);
  const cleanInput = canonical.trim().toLowerCase();
  const rawClean = rawStr.trim().toLowerCase();
  const phoneDigits = cleanPhoneDigits(rawStr);

  // 1. Check custom override map first
  if (customTeamMap && (customTeamMap[cleanInput] || customTeamMap[rawClean])) {
    const customTl = customTeamMap[cleanInput] || customTeamMap[rawClean];
    const tlDisplay = customTl.startsWith('Team ') ? customTl : `Team ${customTl}`;
    return { rm: canonical, tl: tlDisplay, role: 'rm' };
  }

  // 2. Exact name match in directory
  for (const row of directory) {
    const rowRmClean = row.rm_name.trim().toLowerCase();
    if (rowRmClean === cleanInput || rowRmClean === rawClean) {
      const tl = row.tl_name?.startsWith('Team ') ? row.tl_name : `Team ${row.tl_name}`;
      return { rm: row.rm_name, tl, role: row.role || 'rm', email: row.email };
    }
  }

  // 3. Match by phone number if input is numeric
  if (phoneDigits.length >= 10) {
    for (const row of directory) {
      const rowPhoneDigits = cleanPhoneDigits(row.phone_number);
      if (rowPhoneDigits && rowPhoneDigits === phoneDigits) {
        const tl = row.tl_name?.startsWith('Team ') ? row.tl_name : `Team ${row.tl_name}`;
        return { rm: row.rm_name, tl, role: row.role || 'rm', email: row.email };
      }
    }
  }

  // 4. Token/Word boundary matching for aliases (e.g. "Dheeraj", "Saiyam", "Sravanthi")
  for (const row of directory) {
    const rowRmClean = row.rm_name.trim().toLowerCase();
    // Check if input matches row name tokens
    if (matchesWordBoundary(rowRmClean, cleanInput) || matchesWordBoundary(rowRmClean, rawClean)) {
      const tl = row.tl_name?.startsWith('Team ') ? row.tl_name : `Team ${row.tl_name}`;
      return { rm: row.rm_name, tl, role: row.role || 'rm', email: row.email };
    }
  }

  // 5. If caller matches a known TL name directly
  for (const row of directory) {
    if (row.role === 'tl') {
      const tlClean = row.rm_name.trim().toLowerCase();
      const tlTeamClean = (row.tl_name || '').replace(/^Team\s+/i, '').trim().toLowerCase();
      if (
        cleanInput === tlClean ||
        cleanInput === tlTeamClean ||
        rawClean === tlClean ||
        rawClean === tlTeamClean ||
        matchesWordBoundary(cleanInput, tlClean)
      ) {
        const tl = row.tl_name?.startsWith('Team ') ? row.tl_name : `Team ${row.tl_name}`;
        return { rm: row.rm_name, tl, role: 'tl', email: row.email };
      }
    }
  }

  return { rm: canonical, tl: 'PCG Team', role: 'rm' };
}

/**
 * Returns dynamic TL -> RM array mapping for team dashboards and views.
 */
export async function getPcgDynamicTlTeams(): Promise<Record<string, string[]>> {
  const directory = await getPcgRmDirectory();
  const teams: Record<string, string[]> = {};

  for (const row of directory) {
    const tlClean = (row.tl_name || 'Admin').replace(/^Team\s+/i, '').trim();
    if (!teams[tlClean]) {
      teams[tlClean] = [];
    }
    // Only add RMs to member lists (TLs lead the team)
    if (row.role !== 'tl') {
      teams[tlClean].push(row.rm_name);
    }
  }

  return teams;
}

