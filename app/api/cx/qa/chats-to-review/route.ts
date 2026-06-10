import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { readConfig } from '@/lib/config';
import { query } from '@/lib/cx/db';

// PascalCase param key → DB snake_case key (for param_fail filter)
const PASCAL_TO_DB: Record<string, string> = {
  Technical:    'technical',
  AllQuestions: 'all_questions',
  Expectation:  'expectation',
  Contextual:   'contextual',
  FollowUp:     'follow_up',
  Sentences:    'sentences',
  Process:      'process',
  Opening:      'opening',
  Call:         'call',
  Grammar:      'grammar',
  Empathy:      'empathy',
};

export interface ChatToReviewRow {
  chatId:        string;
  agentName:     string;
  iqsScore:      number;
  closedAt:      string;
  disposition:   string;
  subDisposition: string | null;
  csatScore:     number | null;
  parameters:    Record<string, { score: boolean | null; reasoning: string }>;
  failedParams:  string[]; // PascalCase keys where score === false
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const role  = (session.user as any).role as string;
  const email = ((session.user as any).email || '') as string;

  if (!['quality', 'admin'].includes(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);

  // Resolve dispositions for this QA
  const config = await readConfig();
  let dispositions: string[];
  if (role === 'admin') {
    const explicit = searchParams.getAll('disposition');
    if (explicit.length) {
      dispositions = explicit;
    } else {
      const rows = await query<{ d: string }>(
        `SELECT DISTINCT tags->>'disposition' AS d FROM conversations
         WHERE tags->>'disposition' IS NOT NULL AND tags->>'disposition' != ''`
      );
      dispositions = rows.map(r => r.d);
    }
  } else {
    const map = config.qaDispositionMap ?? [];
    const entry = map.find(e => e.email.toLowerCase() === email.toLowerCase());
    dispositions = entry?.dispositions ?? [];
  }

  if (!dispositions.length) return NextResponse.json({ chats: [], total: 0 });

  // Optional narrowing by a single disposition within the QA's set
  const dispositionFilter = searchParams.get('disposition_filter');
  const effectiveDispositions = dispositionFilter && dispositions.includes(dispositionFilter)
    ? [dispositionFilter]
    : dispositions;

  // Build dynamic WHERE clauses
  const sqlParams: unknown[] = [effectiveDispositions];
  let paramIdx = 2;
  let extraWhere = '';

  const subDispo = searchParams.get('sub_disposition');
  if (subDispo) {
    extraWhere += ` AND c.tags->>'sub_disposition' = $${paramIdx++}`;
    sqlParams.push(subDispo);
  }

  // Interpret dates as IST (UTC+05:30) so "June 2" means June 2 00:00 IST, not UTC midnight
  const from = searchParams.get('from');
  if (from) {
    const fromUTC = new Date(from + 'T00:00:00+05:30').toISOString();
    console.log(`[chats-to-review] from param="${from}" → UTC="${fromUTC}" valid=${!isNaN(new Date(from + 'T00:00:00+05:30').getTime())}`);
    extraWhere += ` AND c.closed_at >= $${paramIdx++}`;
    sqlParams.push(fromUTC);
  }

  const to = searchParams.get('to');
  if (to) {
    const toUTC = new Date(to + 'T23:59:59+05:30').toISOString();
    console.log(`[chats-to-review] to param="${to}" → UTC="${toUTC}" valid=${!isNaN(new Date(to + 'T23:59:59+05:30').getTime())}`);
    extraWhere += ` AND c.closed_at <= $${paramIdx++}`;
    sqlParams.push(toUTC);
  }

  const iqsMin = searchParams.get('iqs_min');
  if (iqsMin) {
    extraWhere += ` AND i.iqs_score >= $${paramIdx++}`;
    sqlParams.push(parseInt(iqsMin));
  }

  const iqsMax = searchParams.get('iqs_max');
  if (iqsMax !== null && iqsMax !== '') {
    extraWhere += ` AND i.iqs_score <= $${paramIdx++}`;
    sqlParams.push(parseInt(iqsMax));
  }

  const csatValues = searchParams.getAll('csat');
  if (csatValues.length) {
    extraWhere += ` AND c.csat_score = ANY($${paramIdx++})`;
    sqlParams.push(csatValues.map(Number));
  }

  // param_fail: a PascalCase key like 'Technical' — filter to chats where that param scored false
  const paramFail = searchParams.get('param_fail');
  if (paramFail && PASCAL_TO_DB[paramFail]) {
    const dbKey = PASCAL_TO_DB[paramFail];
    extraWhere += ` AND (i.parameters->'${dbKey}'->>'score')::boolean = false`;
  }

  const page  = Math.max(1, parseInt(searchParams.get('page')  ?? '1'));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? '50')));
  const offset = (page - 1) * limit;

  const baseWhere = `c.tags->>'disposition' = ANY($1)
    AND i.reviewed_by IS NULL
    AND i.call_iqs_score IS NULL
    AND i.iqs_score < 80`;

  // Count query
  const countRows = await query<{ total: string }>(
    `SELECT COUNT(*) AS total
     FROM conversations c
     JOIN iqs_scores i ON i.chat_id = c.id
     WHERE ${baseWhere}${extraWhere}`,
    sqlParams
  );
  const total = parseInt(countRows[0]?.total ?? '0');
  console.log(`[chats-to-review] total=${total} extraWhere="${extraWhere}" params=${JSON.stringify(sqlParams.slice(1))}`);

  // Data query
  sqlParams.push(limit, offset);
  const rows = await query<{
    chat_id: string;
    agent_name: string | null;
    iqs_score: string;
    closed_at: string;
    disposition: string;
    sub_disposition: string | null;
    csat_score: string | null;
    parameters: any;
  }>(
    `SELECT c.id AS chat_id, a.name AS agent_name,
            i.iqs_score, c.closed_at,
            c.tags->>'disposition'     AS disposition,
            c.tags->>'sub_disposition' AS sub_disposition,
            c.csat_score, i.parameters
     FROM conversations c
     JOIN iqs_scores i ON i.chat_id = c.id
     LEFT JOIN agents a ON a.id = c.agent_id
     WHERE ${baseWhere}${extraWhere}
     ORDER BY i.iqs_score ASC, c.closed_at DESC
     LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
    sqlParams
  );

  // Invert PASCAL_TO_DB for converting DB keys back to PascalCase
  const DB_TO_PASCAL: Record<string, string> = Object.fromEntries(
    Object.entries(PASCAL_TO_DB).map(([p, d]) => [d, p])
  );

  const chats: ChatToReviewRow[] = rows.map(r => {
    let params = r.parameters ?? {};
    if (typeof params === 'string') { try { params = JSON.parse(params); } catch { params = {}; } }

    const failedParams: string[] = [];
    for (const [dbKey, val] of Object.entries(params) as [string, any][]) {
      if (dbKey.startsWith('__')) continue;
      if (val?.score === false) {
        const pascal = DB_TO_PASCAL[dbKey];
        if (pascal) failedParams.push(pascal);
      }
    }

    return {
      chatId:         r.chat_id,
      agentName:      r.agent_name ?? 'Unknown',
      iqsScore:       parseInt(r.iqs_score),
      closedAt:       r.closed_at,
      disposition:    r.disposition,
      subDisposition: r.sub_disposition,
      csatScore:      r.csat_score ? parseInt(r.csat_score) : null,
      parameters:     params,
      failedParams,
    };
  });

  return NextResponse.json({ chats, total });
}
