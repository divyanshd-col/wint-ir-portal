import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { readConfig, writeConfig } from '@/lib/config';
import { query } from '@/lib/cx/db';
import { log } from '@/lib/log';

const ROUTE = 'cx/qa/disposition-config';

// GET — returns the current QA's assigned dispositions (or all mappings for admin)
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const role = (session.user as any).role;
  const email = (session.user as any).email || '';

  if (!['quality', 'admin'].includes(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

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
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if ((session.user as any).role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

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
