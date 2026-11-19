import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { query } from '@/lib/cx/db';
import { isSamePcgAgent, canonicalizePcgRmName } from '@/lib/pcg/canonical-names';
import { readConfig } from '@/lib/config';
import { listUsers } from '@/lib/users';
import { TL_TEAMS } from '@/app/api/admin/pcg-calls/route';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }

  const email = session.user.email;
  const { getUserByEmail } = await import('@/lib/users');
  const dbUser = await getUserByEmail(email).catch(() => null);
  const config = await readConfig().catch(() => null);
  const role = dbUser?.role || (session.user as any)?.role || 'agent';
  const userName = dbUser?.name || (session.user as any)?.name || '';

  const { searchParams } = new URL(req.url);
  const rmFilter = searchParams.get('rm');
  const weekFilter = searchParams.get('week');
  const channel = (searchParams.get('channel') || 'calls').toLowerCase();
  const startDate = searchParams.get('startDate') || searchParams.get('date_from') || searchParams.get('start');
  const endDate = searchParams.get('endDate') || searchParams.get('date_to') || searchParams.get('end');
  const period = searchParams.get('period') || searchParams.get('date_range') || searchParams.get('dateRange');

  try {
    // Find mapped RMs for this TL
    const customTeamMap: Record<string, string> = config?.pcgTeamAssignments || {};
    const cleanTl = userName.replace(/^Team\s+/i, '').trim().toLowerCase();
    const directRms = Object.entries(customTeamMap)
      .filter(([_, tl]) => (tl || '').toLowerCase().trim() === cleanTl)
      .map(([rm]) => rm.toLowerCase());
    const fallbackRms = (TL_TEAMS[userName] || TL_TEAMS[cleanTl] || [])
      .filter((r) => {
        const customTl = customTeamMap[r.toLowerCase().trim()] || customTeamMap[canonicalizePcgRmName(r).toLowerCase().trim()];
        return !customTl || customTl.toLowerCase().trim() === cleanTl;
      })
      .map((r) => r.toLowerCase());
    const allRms = Array.from(new Set([...directRms, ...fallbackRms]));

    // Unified scorecards flow (Calls + Chats + Emails)
    let whereClauses: string[] = ["status = 'published'"];
    let params: any[] = [];

    // Strictly exclude Team Leads and Admins from appearing in scorecards
    const nonRmList = [
      'gokul', 'gokul_admin', 'aahan thaker', 'aahan', 'unknown', 'unknown rm', 'test-pcg-admin', 'test-cx-tl',
      'dheeraj', 'dheeraj bhojwani', 'swetha', 'swetha jayakumar', 'saiyam', 'saiyam rastogi', 'tanisha', 'tanisha mittal', 'sravanthi'
    ];
    params.push(nonRmList);
    whereClauses.push(`LOWER(rm_name) != ALL($${params.length})`);

    if (role === 'agent') {
      const canonicalRm = canonicalizePcgRmName(userName);
      params.push(canonicalRm);
      whereClauses.push(`LOWER(rm_name) = LOWER($${params.length})`);
    } else if (role === 'tl') {
      if (allRms.length > 0) {
        params.push(allRms);
        whereClauses.push(`LOWER(rm_name) = ANY($${params.length})`);
      }
    } else if (role === 'admin' && rmFilter && rmFilter !== 'all') {
      params.push(canonicalizePcgRmName(rmFilter));
      whereClauses.push(`LOWER(rm_name) = LOWER($${params.length})`);
    }

    if (weekFilter && weekFilter !== 'all') {
      params.push(weekFilter);
      whereClauses.push(`week_start::date = $${params.length}::date`);
    } else {
      if (startDate) {
        params.push(startDate);
        whereClauses.push(`week_start::date >= $${params.length}::date`);
      }
      if (endDate) {
        params.push(endDate);
        whereClauses.push(`week_end::date <= $${params.length}::date`);
      }
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
    const rows = await query<any>(
      `SELECT id, rm_name, tl_name, week_start::date::text AS week_start, week_end::date::text AS week_end, 
              status, generated, comments, viewed_at, generated_at
       FROM pcg_reports
       ${whereSql}
       ORDER BY week_start DESC, rm_name ASC`,
      params
    );

    // Map rows into clean unified PcgWeeklyReport objects
    const reports = rows.map((r) => {
      const g = r.generated || {};
      const num = g.numbers || {};
      const callsMetric = num.calls || {
        handled: num.callsHandled ?? 0,
        avgScore: num.averageScore ?? 0,
        below85Count: num.below85Count ?? 0,
        pickupRateText: num.pickupRateText || num.connectRateText || '—',
        breachesCount: num.complianceBreachesCount ?? 0,
      };
      const chatsMetric = num.chats || {
        handled: 0,
        avgScore: null,
        below85Count: 0,
        firstResponseText: '—',
        breachesCount: 0,
      };
      const emailsMetric = num.emails || {
        handled: 0,
        avgScore: null,
        below85Count: 0,
        resolutionText: '—',
        breachesCount: 0,
      };

      const totalInteractions = num.totalInteractions ?? ((callsMetric.handled || 0) + (chatsMetric.handled || 0) + (emailsMetric.handled || 0));
      const blendedAvgScore = num.blendedAvgScore ?? num.averageScore ?? callsMetric.avgScore ?? 0;
      const totalBelow85Count = num.totalBelow85Count ?? ((callsMetric.below85Count || 0) + (chatsMetric.below85Count || 0));
      const totalComplianceBreaches = num.totalComplianceBreaches ?? ((callsMetric.breachesCount || 0) + (chatsMetric.breachesCount || 0));

      return {
        id: r.id,
        rmName: r.rm_name,
        tlName: r.tl_name || 'PCG Team',
        weekStart: r.week_start,
        weekEnd: r.week_end,
        status: r.status,
        viewedAt: r.viewed_at,
        generatedAt: r.generated_at,
        comments: r.comments || [],
        numbers: {
          callsHandled: callsMetric.handled,
          averageScore: blendedAvgScore,
          below85Count: totalBelow85Count,
          pickupRateText: callsMetric.pickupRateText,
          connectRateText: callsMetric.pickupRateText,
          complianceBreachesCount: totalComplianceBreaches,
          calls: callsMetric,
          chats: chatsMetric,
          emails: emailsMetric,
          totalInteractions,
          blendedAvgScore,
          totalBelow85Count,
          totalComplianceBreaches,
        },
        whatWentWell: g.whatWentWell || '',
        themes: (g.themes || []).map((t: any) => ({ ...t, channel: t.channel || 'call' })),
        breaches: (g.breaches || []).map((b: any) => ({ ...b, channel: b.channel || 'call' })),
        evidence: (g.evidence || []).map((e: any) => ({ ...e, channel: e.channel || 'call' })),
      };
    });

    // 1. Determine latest system week from pcg_reports
    const latestWeekRes = await query<any>(
      `SELECT MAX(week_start)::date::text AS latest_week FROM pcg_reports WHERE status = 'published'`
    );
    const latestSystemWeek = latestWeekRes[0]?.latest_week || '2026-10-19';
    const activeWeekStart = weekFilter && weekFilter !== 'all' ? weekFilter : latestSystemWeek;
    const nextMonday = new Date(new Date(activeWeekStart).getTime() + 7 * 86400000).toISOString().split('T')[0];

    // 2. Fetch call counts for all RMs in the active week window
    const callCountRows = await query<any>(
      `SELECT 
        COALESCE(NULLIF(e.rm_name, 'Unknown'), r.called_by, r.agent_name) AS rm_name,
        COUNT(r.id) AS calls_count
       FROM pcg_call_recordings r
       LEFT JOIN pcg_call_evaluations e ON (e.call_id = r.call_id OR e.call_id = r.id::text)
       WHERE r.start_time >= $1 AND r.start_time < $2
         AND COALESCE(NULLIF(e.rm_name, 'Unknown'), r.called_by, r.agent_name) IS NOT NULL
       GROUP BY 1`,
      [`${activeWeekStart}T00:00:00.000Z`, `${nextMonday}T00:00:00.000Z`]
    );

    const callStats: Record<string, number> = {};
    callCountRows.forEach((row) => {
      const canonical = canonicalizePcgRmName(row.rm_name).toLowerCase();
      callStats[canonical] = Number(row.calls_count || 0);
    });

    // 3. Determine available agents according to role/scoping
    const allUsers = await listUsers().catch(() => []);
    const pcgDbUsers = allUsers.filter(
      (u) => (u.platform_domain === 'pcg' || u.platform_domain === 'both') && u.role === 'agent' && u.status !== 'disabled'
    );

    const agentSet = new Set<string>();
    pcgDbUsers.forEach((u) => agentSet.add(canonicalizePcgRmName(u.name)));
    reports.forEach((r) => agentSet.add(canonicalizePcgRmName(r.rmName)));

    // Include mapped RMs from config & TL_TEAMS
    if (role === 'tl') {
      const cleanTl = userName.replace(/^Team\s+/i, '').trim().toLowerCase();
      const directRms = Object.entries(customTeamMap)
        .filter(([_, tl]) => (tl || '').toLowerCase().trim() === cleanTl)
        .map(([rm]) => canonicalizePcgRmName(rm));
      const fallbackRms = (TL_TEAMS[userName] || TL_TEAMS[cleanTl] || [])
        .filter((r) => {
          const customTl = customTeamMap[r.toLowerCase().trim()] || customTeamMap[canonicalizePcgRmName(r).toLowerCase().trim()];
          return !customTl || customTl.toLowerCase().trim() === cleanTl;
        })
        .map((r) => canonicalizePcgRmName(r));
      agentSet.clear();
      [...directRms, ...fallbackRms].forEach((rm) => agentSet.add(rm));
    } else if (role === 'admin') {
      Object.keys(customTeamMap).forEach((rm) => agentSet.add(canonicalizePcgRmName(rm)));
      Object.values(TL_TEAMS).forEach((members) => {
        members.forEach((rm) => agentSet.add(canonicalizePcgRmName(rm)));
      });
    }

    // Filter out non-RMs
    nonRmList.forEach((n) => {
      agentSet.delete(n);
      agentSet.delete(canonicalizePcgRmName(n));
    });

    const availableAgents = Array.from(agentSet).sort((a, b) => a.localeCompare(b));

    return NextResponse.json({
      success: true,
      reports,
      latestSystemWeek,
      activeWeek: activeWeekStart,
      callStats,
      availableAgents,
    });
  } catch (err: any) {
    console.error('[pcg-reports-api] GET error:', err);
    return NextResponse.json({ error: err.message || 'Failed to fetch reports' }, { status: 500 });
  }
}

// POST: Add or update comments on a scorecard
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { reportId, comment } = body;
    if (!reportId || !comment?.text) {
      return NextResponse.json({ error: 'reportId and comment.text are required' }, { status: 400 });
    }

    const existing = await query<any>(`SELECT comments FROM pcg_reports WHERE id = $1`, [reportId]);
    if (existing.length === 0) {
      return NextResponse.json({ error: 'Report not found' }, { status: 404 });
    }

    const currentComments = existing[0].comments || [];
    const newComment = {
      id: comment.id || `c-${Date.now()}`,
      targetKey: comment.targetKey || 'general',
      text: comment.text.trim(),
      highlighted: !!comment.highlighted,
      createdAt: new Date().toISOString(),
      author: session.user.name || session.user.email,
    };

    const updatedComments = [...currentComments, newComment];
    await query(`UPDATE pcg_reports SET comments = $1 WHERE id = $2`, [JSON.stringify(updatedComments), reportId]);

    return NextResponse.json({ success: true, comments: updatedComments });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// PATCH: Mark report as viewed
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'Missing report id' }, { status: 400 });

    await query(`UPDATE pcg_reports SET viewed_at = NOW() WHERE id = $1 AND viewed_at IS NULL`, [id]);
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

