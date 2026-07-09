import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-guard';
import { readConfig, writeConfig } from '@/lib/config';
import { query } from '@/lib/cx/db';
import { log, withLogging } from '@/lib/log';

const ROUTE = 'cx/qa/disposition-config';

// GET — returns the current QA's assigned dispositions (or all mappings for admin)
async function _GET() {
  const { session, response } = await requireRole(['quality', 'admin']);
  if (response) return response;
  const role = (session.user as any).role;
  const email = (session.user as any).email || '';

  const config = await readConfig();
  const map = config.qaDispositionMap ?? [];

  // Fetch available dispositions dynamically from DB
  const rows = await query<{ disposition: string }>(
    `SELECT DISTINCT tags->>'disposition' AS disposition
     FROM conversations
     WHERE tags->>'disposition' IS NOT NULL AND tags->>'disposition' != ''
     ORDER BY 1`
  );
  const availableDispositions = rows.map(r => r.disposition);

  if (role === 'admin') {
    log.info(ROUTE, 'GET admin', { mapEntries: map.length, availableCount: availableDispositions.length });
    return NextResponse.json({ map, availableDispositions });
  }

  // QA sees only their own assigned dispositions
  const entry = map.find(e => e.email.toLowerCase() === email.toLowerCase());
  log.info(ROUTE, 'GET qa', { email, dispositionCount: entry?.dispositions.length ?? 0 });
  return NextResponse.json({
    dispositions: entry?.dispositions ?? [],
    availableDispositions,
  });
}

// PATCH — admin only: upsert a QA's disposition list
async function _PATCH(req: NextRequest) {
  const { session, response } = await requireRole('admin');
  if (response) return response;

  const body = await req.json();
  const { email, dispositions } = body as { email: string; dispositions: string[] };
  if (!email || !Array.isArray(dispositions)) {
    return NextResponse.json({ error: 'email and dispositions[] required' }, { status: 400 });
  }

  const config = await readConfig();
  const map = config.qaDispositionMap ? [...config.qaDispositionMap] : [];
  const idx = map.findIndex(e => e.email.toLowerCase() === email.toLowerCase());
  if (idx >= 0) {
    map[idx] = { email, dispositions };
  } else {
    map.push({ email, dispositions });
  }

  await writeConfig({ ...config, qaDispositionMap: map });
  log.info(ROUTE, 'PATCH', { by: (session.user as any).email, targetEmail: email, dispositionCount: dispositions.length });
  return NextResponse.json({ ok: true, map });
}

export const GET = withLogging(ROUTE, _GET);
export const PATCH = withLogging(ROUTE, _PATCH);
