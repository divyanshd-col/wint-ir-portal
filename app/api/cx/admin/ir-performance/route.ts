import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { query } from '@/lib/cx/db';
import { readConfig } from '@/lib/config';

export const dynamic = 'force-dynamic';

const PARAM_NAME_MAP: Record<string, string> = {
  // Calls parameters
  P1: 'Technically / Legally Correct',
  P2: 'All Questions Addressed',
  P3: 'Expectation Setting',
  P5: 'Call Opening',
  P6: 'Call Closing',
  P7: 'Context & Pre-Check',
  P8: 'Simplifying & Jargon',
  P9: 'Active Listening & Empathy',
  P10: 'Fillers & Dead Air',
  P11: 'Energy, Warmth & Pace',
  TechnicalLegal: 'Technically / Legally Correct',
  AllQuestions: 'All Questions Addressed',
  Expectation: 'Expectation Setting',
  CallOpening: 'Call Opening',
  CallClosing: 'Call Closing',
  Process: 'Process',
  Grammar: 'Vocabulary & Grammar',
  Fillers: 'Fillers & Speech Clarity',
  EnergyTone: 'Energy Level & Tone',
  ActiveListening: 'Active Listening & Empathy',
  Simplifying: 'Simplifying Answers',
  // Chats & Emails parameters
  empathy: 'Active Listening & Empathy',
  accuracy: 'Technically / Legally Correct',
  readability: 'Clarity & Readability',
  personalisation: 'Personalisation',
  personalization: 'Personalisation',
  issue_resolution: 'Issue Resolution',
  expectation_setting: 'Expectation Setting',
  expectation_follow_through: 'Expectation Setting',
  opening_and_closing: 'Call Opening & Closing',
  greeting_handover: 'Greeting & Handover',
  sentences_simple_to_understand: 'Simplicity & Structure',
  clarity: 'Clarity & Structure',
  no_repetition: 'No Repetition',
  escalation_decision: 'Escalation Handling',
  dissatisfactionhandling: 'Dissatisfaction Handling',
  post_call_recap: 'Post-Call Recap',
};

const IGNORED_PARAMS = new Set([
  '__gates',
  '__reasoning',
  '__scores',
  '__breaches',
  '__bot_model_version',
  'core_query',
]);

interface AgentStatsRow {
  agent_id: number;
  agent_name: string;
  tl_name: string;
  period_volume: number;
  period_answered: number;
  period_iqs: number | null;
  curr_14d: number | null;
  prior_14d: number | null;
  compliance_breaches: number;
  off_hours_total?: number;
  off_hours_answered?: number;
}

function buildScorecardsForChannel(
  rows: AgentStatsRow[],
  agentParamScores: Map<number, Record<string, number>>,
  knownExclusions: Set<string>,
  channelType: 'calls' | 'chats' | 'emails',
  teamLeadsMap: Map<string, string[]>
) {
  const scorecards: any[] = [];

  for (const r of rows) {
    const cleanName = (r.agent_name || '').trim();
    const lowerName = cleanName.toLowerCase();

    // Check exclusion & minimum volume threshold
    if (
      knownExclusions.has(lowerName) ||
      lowerName.includes('admin') ||
      lowerName.includes('unknown')
    ) {
      continue;
    }

    const periodVolume = Number(r.period_volume) || 0;
    const periodAnswered = Number(r.period_answered) || 0;
    const connectRate = periodVolume > 0 ? Math.round((periodAnswered / periodVolume) * 100) : 0;

    const offHoursTotal = Number(r.off_hours_total) || 0;
    const offHoursAnswered = Number(r.off_hours_answered) || 0;
    const offHoursPickupRate = offHoursTotal > 0 ? Math.round((offHoursAnswered / offHoursTotal) * 100) : 0;

    const periodIqs = r.period_iqs != null ? Number(r.period_iqs) : 0;
    const current14d = r.curr_14d != null ? Number(r.curr_14d) : periodIqs;
    const prior14d = r.prior_14d != null ? Number(r.prior_14d) : current14d;
    const delta2Wk = r.curr_14d != null && r.prior_14d != null
      ? Math.round((current14d - prior14d) * 10) / 10
      : 0;

    const trend = delta2Wk > 0 ? 'improving' : delta2Wk < 0 ? 'declining' : 'stable';

    // Top weakness based on lowest scoring parameter
    const params = agentParamScores.get(r.agent_id) || {};
    let lowestKey = '';
    let lowestScore = 101;
    for (const [k, score] of Object.entries(params)) {
      if (IGNORED_PARAMS.has(k)) continue;
      if (score < lowestScore) {
        lowestScore = score;
        lowestKey = k;
      }
    }
    let topWeakness = '—';
    if (periodIqs > 0 && periodIqs < 85 && lowestKey) {
      topWeakness = PARAM_NAME_MAP[lowestKey] || lowestKey;
    }

    // Team Lead mapping
    const tl = r.tl_name ? r.tl_name.replace(/^team\s+/i, '').trim() : '';
    if (tl && tl.toLowerCase() !== 'unassigned') {
      if (!teamLeadsMap.has(tl)) {
        teamLeadsMap.set(tl, []);
      }
      if (!teamLeadsMap.get(tl)!.includes(cleanName)) {
        teamLeadsMap.get(tl)!.push(cleanName);
      }
    }

    const parts = cleanName.split(/\s+/);
    const ini = parts.length > 1
      ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
      : parts[0].slice(0, 2).toUpperCase();

    scorecards.push({
      id: `ir-${channelType}-${r.agent_id}`,
      agentId: r.agent_id,
      rmName: cleanName,
      agentName: cleanName,
      ini,
      tl,
      channel: channelType,
      periodVolume,
      periodAnswered,
      periodIqs,
      // Backward compatibility aliases
      totalVolume: periodVolume,
      answeredVolume: periodAnswered,
      totalCalls: periodVolume,
      answeredCalls: periodAnswered,
      clientTotalCalls: periodVolume,
      clientAnsweredCalls: periodAnswered,
      clientPickupRate: connectRate,
      connectRate,
      offHoursClientTotal: offHoursTotal,
      offHoursClientAnswered: offHoursAnswered,
      offHoursPickupRate: offHoursPickupRate,
      overallScore: periodIqs,
      currentIqs: periodIqs,
      current14dIqs: current14d,
      prev2WkIqs: prior14d,
      delta2Wk,
      trend,
      complianceFlags: Number(r.compliance_breaches) || 0,
      topWeakness,
      parameterScores: params,
    });
  }

  const deptStats = {
    totalAgents: scorecards.length,
    totalVolume: scorecards.reduce((sum, sc) => sum + sc.periodVolume, 0),
    totalCalls: scorecards.reduce((sum, sc) => sum + sc.periodVolume, 0),
    totalAnswered: scorecards.reduce((sum, sc) => sum + sc.periodAnswered, 0),
    avgIqs: scorecards.filter(sc => sc.periodIqs > 0).length > 0
      ? Math.round(
          (scorecards.filter(sc => sc.periodIqs > 0).reduce((sum, sc) => sum + sc.periodIqs, 0) /
            scorecards.filter(sc => sc.periodIqs > 0).length) *
            10
        ) / 10
      : 0,
  };

  return { scorecards, deptStats };
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }

  const user = session.user as any;
  const role = user.role || (user.isAdmin ? 'admin' : '');
  if (role !== 'admin' && !user.isAdmin) {
    return NextResponse.json({ error: 'Forbidden. Admin role required.' }, { status: 403 });
  }

  try {
    const url = new URL(req.url);
    const requestedChannel = (url.searchParams.get('channel') || '').toLowerCase();
    const period = (url.searchParams.get('period') || '7d').toLowerCase();
    const customFrom = url.searchParams.get('from');
    const customTo = url.searchParams.get('to');

    // Build period SQL clause for Top & Bottom performers
    // Most Improved ALWAYS uses rolling 14-day window: (curr_14d vs prior_14d)
    let callPeriodCond = `cr.called_at >= (SELECT max_ts FROM max_ref) - INTERVAL '7 days'`;
    let chatPeriodCond = `c.closed_at >= (SELECT max_ts FROM max_ref) - INTERVAL '7 days'`;
    let emailPeriodCond = `COALESCE(e.sent_at, e.evaluated_at) >= (SELECT max_ts FROM max_ref) - INTERVAL '7 days'`;
    let queryParams: any[] = [];

    if (period === 'custom' && customFrom && customTo) {
      const fromTs = `${customFrom}T00:00:00.000Z`;
      const toTs = `${customTo}T23:59:59.999Z`;
      queryParams = [fromTs, toTs];
      callPeriodCond = `cr.called_at >= $1 AND cr.called_at <= $2`;
      chatPeriodCond = `c.closed_at >= $1 AND c.closed_at <= $2`;
      emailPeriodCond = `COALESCE(e.sent_at, e.evaluated_at) >= $1 AND COALESCE(e.sent_at, e.evaluated_at) <= $2`;
    } else if (period === '14d') {
      callPeriodCond = `cr.called_at >= (SELECT max_ts FROM max_ref) - INTERVAL '14 days'`;
      chatPeriodCond = `c.closed_at >= (SELECT max_ts FROM max_ref) - INTERVAL '14 days'`;
      emailPeriodCond = `COALESCE(e.sent_at, e.evaluated_at) >= (SELECT max_ts FROM max_ref) - INTERVAL '14 days'`;
    } else if (period === '30d') {
      callPeriodCond = `cr.called_at >= (SELECT max_ts FROM max_ref) - INTERVAL '30 days'`;
      chatPeriodCond = `c.closed_at >= (SELECT max_ts FROM max_ref) - INTERVAL '30 days'`;
      emailPeriodCond = `COALESCE(e.sent_at, e.evaluated_at) >= (SELECT max_ts FROM max_ref) - INTERVAL '30 days'`;
    } else if (period === '90d') {
      callPeriodCond = `cr.called_at >= (SELECT max_ts FROM max_ref) - INTERVAL '90 days'`;
      chatPeriodCond = `c.closed_at >= (SELECT max_ts FROM max_ref) - INTERVAL '90 days'`;
      emailPeriodCond = `COALESCE(e.sent_at, e.evaluated_at) >= (SELECT max_ts FROM max_ref) - INTERVAL '90 days'`;
    } else if (period === 'all') {
      callPeriodCond = `1=1`;
      chatPeriodCond = `1=1`;
      emailPeriodCond = `1=1`;
    }

    const config = await readConfig();

    // 1. Compile exclusion list of non-IR entities (Admins, TLs, Bots, External Accounts)
    const configAdmins = (config.users as any[])
      .filter((u: any) => u.role === 'admin' || u.isAdmin)
      .map((u: any) => (u.agentName || u.name || u.email || '').toLowerCase().trim())
      .filter(Boolean);

    const configTLs = (config.users as any[])
      .filter((u: any) => u.role === 'tl')
      .map((u: any) => (u.agentName || u.name || u.email || '').toLowerCase().trim())
      .filter(Boolean);

    const dbTLsRows = await query<{ tl: string }>(`
      SELECT DISTINCT LOWER(TRIM(tl_name)) AS tl
      FROM agents
      WHERE tl_name IS NOT NULL AND TRIM(tl_name) != ''
    `).catch(() => []);
    const dbTLs = dbTLsRows.map(r => r.tl).filter(Boolean);

    const knownExclusions = new Set<string>([
      ...configAdmins,
      ...configTLs,
      ...dbTLs,
      'aahan thaker',
      'aahan',
      'dheeraj bhojwani',
      'saiyam rastogi',
      'tanisha mittal',
      'swetha',
      'swetha jayakumar',
      'gokul_admin',
      'gokul',
      'unknown rm',
      'unknown agent',
      'unknown',
      'meta account support',
      'pinterest',
      'unassigned',
      'robylon',
      'robylon ai',
      'robylon automation',
    ]);

    // 2. Fetch queries across Calls, Chats, and Emails in parallel
    const [
      callsRows,
      chatsRows,
      emailsRows,
      callsParamRows,
      chatsParamRows,
      emailsParamRows,
    ] = await Promise.all([
      // CALLS STATS: Top & Bottom use selected period; Most Improved uses rolling 14-day comparison
      query<AgentStatsRow>(`
        WITH max_ref AS (SELECT COALESCE(MAX(called_at), NOW()) AS max_ts FROM call_recordings)
        SELECT
          a.id AS agent_id,
          a.name AS agent_name,
          COALESCE(TRIM(a.tl_name), '') AS tl_name,
          COUNT(DISTINCT CASE WHEN ${callPeriodCond} THEN cr.id END)::int AS period_volume,
          COUNT(DISTINCT CASE WHEN ${callPeriodCond} AND cr.duration_seconds > 0 THEN cr.id END)::int AS period_answered,
          COUNT(DISTINCT CASE WHEN ${callPeriodCond} AND (
                               EXTRACT(DOW FROM cr.called_at AT TIME ZONE 'Asia/Kolkata') IN (0, 6)
                               OR EXTRACT(HOUR FROM cr.called_at AT TIME ZONE 'Asia/Kolkata') < 10
                               OR EXTRACT(HOUR FROM cr.called_at AT TIME ZONE 'Asia/Kolkata') >= 19
                             ) THEN cr.id END)::int AS off_hours_total,
          COUNT(DISTINCT CASE WHEN ${callPeriodCond} AND (
                               EXTRACT(DOW FROM cr.called_at AT TIME ZONE 'Asia/Kolkata') IN (0, 6)
                               OR EXTRACT(HOUR FROM cr.called_at AT TIME ZONE 'Asia/Kolkata') < 10
                               OR EXTRACT(HOUR FROM cr.called_at AT TIME ZONE 'Asia/Kolkata') >= 19
                             ) AND cr.duration_seconds > 0 THEN cr.id END)::int AS off_hours_answered,
          ROUND(AVG(CASE WHEN ${callPeriodCond} THEN ce.iqs_percent END)::numeric, 1)::float AS period_iqs,
          -- Rolling 14-day metrics for Most Improved
          ROUND(AVG(CASE WHEN cr.called_at >= (SELECT max_ts FROM max_ref) - INTERVAL '14 days' THEN ce.iqs_percent END)::numeric, 1)::float AS curr_14d,
          ROUND(AVG(CASE WHEN cr.called_at >= (SELECT max_ts FROM max_ref) - INTERVAL '28 days' AND cr.called_at < (SELECT max_ts FROM max_ref) - INTERVAL '14 days' THEN ce.iqs_percent END)::numeric, 1)::float AS prior_14d,
          COUNT(DISTINCT CASE WHEN ${callPeriodCond} AND ce.breach_mentions IS NOT NULL AND ce.breach_mentions::text != '[]' THEN cr.id END)::int AS compliance_breaches
        FROM agents a
        JOIN call_recordings cr ON cr.agent_id = a.id
        LEFT JOIN call_evaluations ce ON (ce.call_id = cr.id OR (ce.chat_id IS NOT NULL AND ce.chat_id = cr.chat_id))
        WHERE a.status = 'active'
        GROUP BY a.id, a.name, a.tl_name
      `, queryParams).catch(() => []),

      // CHATS STATS: Top & Bottom use selected period; Most Improved uses rolling 14-day comparison
      query<AgentStatsRow>(`
        WITH max_ref AS (SELECT COALESCE(MAX(closed_at), NOW()) AS max_ts FROM conversations)
        SELECT
          a.id AS agent_id,
          a.name AS agent_name,
          COALESCE(TRIM(a.tl_name), '') AS tl_name,
          COUNT(DISTINCT CASE WHEN ${chatPeriodCond} THEN c.id END)::int AS period_volume,
          COUNT(DISTINCT CASE WHEN ${chatPeriodCond} AND c.closed_at IS NOT NULL THEN c.id END)::int AS period_answered,
          0 AS off_hours_total,
          0 AS off_hours_answered,
          ROUND(AVG(CASE WHEN ${chatPeriodCond} THEN s.iqs_score END)::numeric, 1)::float AS period_iqs,
          -- Rolling 14-day metrics for Most Improved
          ROUND(AVG(CASE WHEN c.closed_at >= (SELECT max_ts FROM max_ref) - INTERVAL '14 days' THEN s.iqs_score END)::numeric, 1)::float AS curr_14d,
          ROUND(AVG(CASE WHEN c.closed_at >= (SELECT max_ts FROM max_ref) - INTERVAL '28 days' AND c.closed_at < (SELECT max_ts FROM max_ref) - INTERVAL '14 days' THEN s.iqs_score END)::numeric, 1)::float AS prior_14d,
          COUNT(DISTINCT CASE WHEN ${chatPeriodCond} AND s.parameters::jsonb ? '__breaches' AND jsonb_array_length(COALESCE(s.parameters::jsonb->'__breaches', '[]'::jsonb)) > 0 THEN c.id END)::int AS compliance_breaches
        FROM agents a
        JOIN conversations c ON c.agent_id = a.id
        LEFT JOIN iqs_scores s ON s.chat_id = c.id
        WHERE a.status = 'active'
        GROUP BY a.id, a.name, a.tl_name
      `, queryParams).catch(() => []),

      // EMAILS STATS: Top & Bottom use selected period; Most Improved uses rolling 14-day comparison
      query<AgentStatsRow>(`
        WITH max_ref AS (SELECT COALESCE(MAX(COALESCE(sent_at, evaluated_at)), NOW()) AS max_ts FROM email_reply_evaluations)
        SELECT
          a.id AS agent_id,
          a.name AS agent_name,
          COALESCE(TRIM(a.tl_name), '') AS tl_name,
          COUNT(DISTINCT CASE WHEN ${emailPeriodCond} THEN e.id END)::int AS period_volume,
          COUNT(DISTINCT CASE WHEN ${emailPeriodCond} THEN e.id END)::int AS period_answered,
          0 AS off_hours_total,
          0 AS off_hours_answered,
          ROUND(AVG(CASE WHEN ${emailPeriodCond} THEN COALESCE(e.qa_override_score, e.quality_score) END)::numeric, 1)::float AS period_iqs,
          -- Rolling 14-day metrics for Most Improved
          ROUND(AVG(CASE WHEN COALESCE(e.sent_at, e.evaluated_at) >= (SELECT max_ts FROM max_ref) - INTERVAL '14 days' THEN COALESCE(e.qa_override_score, e.quality_score) END)::numeric, 1)::float AS curr_14d,
          ROUND(AVG(CASE WHEN COALESCE(e.sent_at, e.evaluated_at) >= (SELECT max_ts FROM max_ref) - INTERVAL '28 days' AND COALESCE(e.sent_at, e.evaluated_at) < (SELECT max_ts FROM max_ref) - INTERVAL '14 days' THEN COALESCE(e.qa_override_score, e.quality_score) END)::numeric, 1)::float AS prior_14d,
          COUNT(DISTINCT CASE WHEN ${emailPeriodCond} AND (e.compliance_passed = false OR (e.compliance_issues IS NOT NULL AND e.compliance_issues::text != '[]')) THEN e.id END)::int AS compliance_breaches
        FROM agents a
        JOIN email_reply_evaluations e ON (LOWER(TRIM(e.agent_name)) = LOWER(TRIM(a.name)) OR e.agent_id = a.id::text)
        WHERE a.status = 'active'
        GROUP BY a.id, a.name, a.tl_name
      `, queryParams).catch(() => []),

      // CALLS PARAMETERS
      query<{ agent_id: number; param_key: string; total_evals: number; earned_score: number }>(`
        SELECT
          ce.agent_id,
          p.key AS param_key,
          COUNT(*)::int AS total_evals,
          SUM(
            CASE
              WHEN p.val IN ('1', 'true', 'Yes') THEN 1
              WHEN p.val IN ('0.5', 'Half') THEN 0.5
              WHEN p.val = '2' THEN 1
              ELSE 0
            END
          )::float AS earned_score
        FROM call_evaluations ce
        CROSS JOIN LATERAL jsonb_each_text(
          CASE
            WHEN ce.iqs_scores::jsonb ? 'scores' THEN ce.iqs_scores::jsonb->'scores'
            ELSE ce.iqs_scores::jsonb
          END
        ) AS p(key, val)
        WHERE ce.agent_id IS NOT NULL AND p.val NOT IN ('NA', 'na', 'null', '')
        GROUP BY ce.agent_id, p.key
      `).catch(() => []),

      // CHATS PARAMETERS
      query<{ agent_id: number; param_key: string; total_evals: number; earned_score: number }>(`
        SELECT
          c.agent_id,
          p.key AS param_key,
          COUNT(*)::int AS total_evals,
          SUM(
            CASE
              WHEN p.val->>'score' IN ('true', '1') THEN 1
              WHEN p.val->>'score' = '0.5' THEN 0.5
              ELSE 0
            END
          )::float AS earned_score
        FROM conversations c
        JOIN iqs_scores s ON s.chat_id = c.id
        CROSS JOIN LATERAL jsonb_each(
          CASE
            WHEN s.parameters::jsonb ? '__agent_parameters' THEN s.parameters::jsonb->'__agent_parameters'
            ELSE '{}'::jsonb
          END
        ) AS p(key, val)
        WHERE c.agent_id IS NOT NULL AND p.val->>'score' IS NOT NULL AND p.val->>'score' NOT IN ('null', 'NA')
        GROUP BY c.agent_id, p.key
      `).catch(() => []),

      // EMAILS PARAMETERS
      query<{ agent_id: number; param_key: string; total_evals: number; earned_score: number }>(`
        SELECT
          a.id AS agent_id,
          p.key AS param_key,
          COUNT(*)::int AS total_evals,
          SUM(
            CASE
              WHEN LOWER(TRIM(p.val)) IN ('yes', '1', 'true') THEN 1
              WHEN LOWER(TRIM(p.val)) IN ('half', '0.5') THEN 0.5
              ELSE 0
            END
          )::float AS earned_score
        FROM agents a
        JOIN email_reply_evaluations e ON (LOWER(TRIM(e.agent_name)) = LOWER(TRIM(a.name)) OR e.agent_id = a.id::text)
        CROSS JOIN LATERAL jsonb_each_text(
          CASE
            WHEN e.parameter_scores::jsonb ? '__reasoning' THEN e.parameter_scores::jsonb - '__reasoning'
            ELSE COALESCE(e.parameter_scores::jsonb, '{}'::jsonb)
          END
        ) AS p(key, val)
        WHERE a.status = 'active' AND p.key != '__reasoning'
        GROUP BY a.id, p.key
      `).catch(() => [])
    ]);

    // Helper to map parameter averages
    const mapParams = (rows: any[]) => {
      const map = new Map<number, Record<string, number>>();
      for (const r of rows) {
        if (!map.has(r.agent_id)) {
          map.set(r.agent_id, {});
        }
        const pct = r.total_evals > 0 ? Math.round((r.earned_score / r.total_evals) * 100) : 0;
        map.get(r.agent_id)![r.param_key] = pct;
      }
      return map;
    };

    const callsParamScores = mapParams(callsParamRows);
    const chatsParamScores = mapParams(chatsParamRows);
    const emailsParamScores = mapParams(emailsParamRows);

    const teamLeadsMap = new Map<string, string[]>();

    const { scorecards: callsScorecards, deptStats: callsDeptStats } = buildScorecardsForChannel(
      callsRows,
      callsParamScores,
      knownExclusions,
      'calls',
      teamLeadsMap
    );

    const { scorecards: chatsScorecards, deptStats: chatsDeptStats } = buildScorecardsForChannel(
      chatsRows,
      chatsParamScores,
      knownExclusions,
      'chats',
      teamLeadsMap
    );

    const { scorecards: emailsScorecards, deptStats: emailsDeptStats } = buildScorecardsForChannel(
      emailsRows,
      emailsParamScores,
      knownExclusions,
      'emails',
      teamLeadsMap
    );

    const teamLeads = Array.from(teamLeadsMap.entries()).map(([tlName, agents]) => ({
      tlName,
      rms: agents,
      agents,
    }));

    // Choose default channel
    const activeScorecards = requestedChannel === 'chats'
      ? chatsScorecards
      : requestedChannel === 'emails'
      ? emailsScorecards
      : callsScorecards;

    const activeDeptStats = requestedChannel === 'chats'
      ? chatsDeptStats
      : requestedChannel === 'emails'
      ? emailsDeptStats
      : callsDeptStats;

    return NextResponse.json({
      period,
      customFrom: customFrom || null,
      customTo: customTo || null,
      channel: requestedChannel || 'calls',
      channels: {
        calls: {
          irScorecards: callsScorecards,
          departmentStats: callsDeptStats,
        },
        chats: {
          irScorecards: chatsScorecards,
          departmentStats: chatsDeptStats,
        },
        emails: {
          irScorecards: emailsScorecards,
          departmentStats: emailsDeptStats,
        },
      },
      irScorecards: activeScorecards,
      teamLeads,
      departmentStats: activeDeptStats,
    });
  } catch (err: any) {
    console.error('[ir-performance-api] GET error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
