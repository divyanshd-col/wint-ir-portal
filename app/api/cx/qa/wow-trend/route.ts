import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { readConfig } from '@/lib/config';
import { query } from '@/lib/cx/db';

interface WeekRow {
  week_start:        string;
  sum_iqs:           string | null;
  iqs_count:         string;
  bot_count:         string;
  total_count:       string;
  sum_resolution:    string | null;
  resolution_count:  string;
}

function isoWeekStart(date: Date): string {
  const d = new Date(date);
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day; // Monday-based
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

function weekLabel(start: string): string {
  const d = new Date(start + 'T00:00:00Z');
  const end = new Date(d);
  end.setUTCDate(d.getUTCDate() + 6);
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()} – ${MONTHS[end.getUTCMonth()]} ${end.getUTCDate()}`;
}

function secsToLabel(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.round(secs % 60);
  return `${m}m ${s.toString().padStart(2, '0')}s`;
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
  const dispositionFilter = searchParams.get('disposition') ?? 'all';

  // Date range
  const p = searchParams.get('period');
  let from: Date, to: Date;
  const now = new Date();
  if (p === 'custom') {
    const f = searchParams.get('from');
    const t = searchParams.get('to');
    if (!f || !t) return NextResponse.json({ error: 'from and to required' }, { status: 400 });
    from = new Date(f);
    to   = new Date(t + 'T23:59:59Z');
  } else {
    const days = p === '7' ? 7 : 30;
    from = new Date(now);
    from.setDate(from.getDate() - days);
    from.setHours(0, 0, 0, 0);
    to = now;
  }

  // Resolve dispositions for this QA
  const config = await readConfig();
  let dispositions: string[];
  if (role === 'admin') {
    const explicit = searchParams.getAll('disposition_filter');
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

  if (!dispositions.length) return NextResponse.json([]);

  // If a specific disposition filter is selected, narrow further
  const effectiveDispositions = dispositionFilter !== 'all'
    ? dispositions.filter(d => d === dispositionFilter)
    : dispositions;

  if (!effectiveDispositions.length) return NextResponse.json([]);

  const rows = await query<WeekRow>(
    `SELECT
       date_trunc('week', c.closed_at)::date::text                   AS week_start,
       SUM(i.iqs_score)    FILTER (WHERE i.iqs_score IS NOT NULL)::text AS sum_iqs,
       COUNT(i.iqs_score)  FILTER (WHERE i.iqs_score IS NOT NULL)::text AS iqs_count,
       COUNT(*) FILTER (WHERE c.conversation_type = 'bot')::text         AS bot_count,
       COUNT(*)::text                                                     AS total_count,
       SUM(c.resolution_seconds)   FILTER (WHERE c.resolution_seconds IS NOT NULL)::text AS sum_resolution,
       COUNT(c.resolution_seconds) FILTER (WHERE c.resolution_seconds IS NOT NULL)::text AS resolution_count
     FROM conversations c
     JOIN iqs_scores i ON c.id = i.chat_id
     WHERE c.tags->>'disposition' = ANY($1)
       AND c.closed_at >= $2 AND c.closed_at <= $3
     GROUP BY 1
     ORDER BY 1`,
    [effectiveDispositions, from.toISOString(), to.toISOString()]
  );

  const result = rows.map(r => {
    const iqsCnt = parseInt(r.iqs_count);
    const total  = parseInt(r.total_count);
    const bot    = parseInt(r.bot_count);
    const resCnt = parseInt(r.resolution_count);

    const avgIqs = iqsCnt > 0 && r.sum_iqs ? Math.round(parseFloat(r.sum_iqs) / iqsCnt) : null;
    const autoPct = total > 0 ? Math.round((bot / total) * 100) : null;
    const avgRes  = resCnt > 0 && r.sum_resolution
      ? Math.round(parseFloat(r.sum_resolution) / resCnt)
      : null;

    return {
      weekStart:          r.week_start,
      weekLabel:          weekLabel(r.week_start),
      iqsPct:             avgIqs,
      automationPct:      autoPct,
      avgResolutionSecs:  avgRes,
      avgResolutionLabel: avgRes != null ? secsToLabel(avgRes) : null,
    };
  });

  return NextResponse.json(result);
}
