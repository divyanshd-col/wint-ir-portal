import type { AnalyticsFilters, TemplateExtras } from './types';

// ── IQS parameter keys (PascalCase — must match DB storage) ──────────────────
const IQS_PARAMS = [
  'Technical', 'AllQuestions', 'Expectation', 'Contextual',
  'FollowUp', 'Sentences', 'Process', 'Opening',
  'Call', 'Tags', 'Grammar', 'Empathy',
] as const;

// ── Shared WHERE builder ──────────────────────────────────────────────────────

interface WhereResult {
  clauses: string[];
  params: any[];
  next: number;
}

function buildWhere(f: AnalyticsFilters, alias = 'c', startIdx = 1): WhereResult {
  const clauses: string[] = [];
  const params: any[] = [];
  let i = startIdx;

  clauses.push(`${alias}.closed_at >= $${i++}::timestamptz`);
  params.push(f.dateFrom + 'T00:00:00Z');

  clauses.push(`${alias}.closed_at < $${i++}::timestamptz`);
  params.push(f.dateTo + 'T23:59:59.999Z');

  if (f.dispositions.length) {
    clauses.push(`${alias}.tags->>'disposition' = ANY($${i++}::text[])`);
    params.push(f.dispositions);
  }
  if (f.subDispositions.length) {
    clauses.push(`${alias}.tags->>'sub_disposition' = ANY($${i++}::text[])`);
    params.push(f.subDispositions);
  }
  if (f.teams.length) {
    clauses.push(`${alias}.team_id = ANY($${i++}::int[])`);
    params.push(f.teams);
  }
  if (f.csatLabels.length) {
    clauses.push(`${alias}.csat_label = ANY($${i++}::text[])`);
    params.push(f.csatLabels);
  }
  if (f.conversationTypes.length) {
    clauses.push(`${alias}.conversation_type = ANY($${i++}::text[])`);
    params.push(f.conversationTypes);
  }
  if (f.agentIds.length) {
    clauses.push(`${alias}.agent_id = ANY($${i++}::int[])`);
    params.push(f.agentIds);
  }

  return { clauses, params, next: i };
}

function toWhere(clauses: string[]): string {
  return clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
}

// ── Template functions ────────────────────────────────────────────────────────

export function count_by_disposition(f: AnalyticsFilters): { sql: string; params: any[] } {
  const { clauses, params } = buildWhere(f);
  return {
    sql: `
      SELECT
        c.tags->>'disposition' AS disposition,
        COUNT(*)::int AS count
      FROM conversations c
      ${toWhere([...clauses, `c.tags->>'disposition' IS NOT NULL`, `c.tags->>'disposition' != ''`])}
      GROUP BY 1
      ORDER BY 2 DESC
      LIMIT 51
    `,
    params,
  };
}

export function count_by_sub_disposition(f: AnalyticsFilters): { sql: string; params: any[] } {
  const { clauses, params } = buildWhere(f);
  return {
    sql: `
      SELECT
        c.tags->>'sub_disposition' AS sub_disposition,
        COUNT(*)::int AS count
      FROM conversations c
      ${toWhere([...clauses, `c.tags->>'sub_disposition' IS NOT NULL`, `c.tags->>'sub_disposition' != ''`])}
      GROUP BY 1
      ORDER BY 2 DESC
      LIMIT 51
    `,
    params,
  };
}

export function csat_distribution(f: AnalyticsFilters): { sql: string; params: any[] } {
  const { clauses, params } = buildWhere(f);
  return {
    sql: `
      SELECT
        c.csat_label,
        COUNT(*)::int AS count,
        ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 1)::float AS pct
      FROM conversations c
      ${toWhere([...clauses, `c.csat_label IS NOT NULL`])}
      GROUP BY 1
      ORDER BY
        CASE c.csat_label
          WHEN 'good'           THEN 1
          WHEN 'could_be_better' THEN 2
          WHEN 'bad'            THEN 3
          ELSE 4
        END
    `,
    params,
  };
}

export function trend_by_week(f: AnalyticsFilters, extras?: TemplateExtras): { sql: string; params: any[] } {
  const { clauses, params } = buildWhere(f);
  const bucket = extras?.bucket === 'day' ? 'day' : 'week';
  return {
    sql: `
      SELECT
        DATE_TRUNC('${bucket}', c.closed_at)::date AS period,
        COUNT(*)::int AS count
      FROM conversations c
      ${toWhere(clauses)}
      GROUP BY 1
      ORDER BY 1
    `,
    params,
  };
}

export function bad_csat_trend_by_week(f: AnalyticsFilters, extras?: TemplateExtras): { sql: string; params: any[] } {
  const { clauses, params } = buildWhere(f);
  const bucket = extras?.bucket === 'day' ? 'day' : 'week';
  return {
    sql: `
      SELECT
        DATE_TRUNC('${bucket}', c.closed_at)::date AS period,
        COUNT(*)::int AS count
      FROM conversations c
      ${toWhere([...clauses, `c.csat_label IN ('bad', 'could_be_better')`])}
      GROUP BY 1
      ORDER BY 1
    `,
    params,
  };
}

export function top_agents_by_metric(f: AnalyticsFilters, extras?: TemplateExtras): { sql: string; params: any[] } {
  const { clauses, params, next } = buildWhere(f, 'c');
  const topN = extras?.topN ?? 10;
  const metric = extras?.metricName || 'bad_csat_count';

  if (metric === 'avg_iqs') {
    params.push(topN);
    return {
      sql: `
        SELECT
          a.name AS agent,
          ROUND(AVG(s.iqs_score), 1)::float AS avg_iqs,
          COUNT(*)::int AS chats
        FROM conversations c
        JOIN agents a ON a.id = c.agent_id
        JOIN iqs_scores s ON s.chat_id = c.id
        ${toWhere([...clauses, `c.agent_id IS NOT NULL`])}
        GROUP BY a.id, a.name
        HAVING COUNT(*) >= 3
        ORDER BY avg_iqs ASC
        LIMIT $${next}
      `,
      params,
    };
  }

  // bad_csat_count (default) or cbb_count
  const badFilter = metric === 'cbb_count'
    ? `c.csat_label = 'could_be_better'`
    : `c.csat_label IN ('bad', 'could_be_better')`;

  params.push(topN);
  return {
    sql: `
      SELECT
        a.name AS agent,
        COUNT(*) FILTER (WHERE ${badFilter})::int AS bad_csat_count,
        COUNT(*)::int AS total_chats
      FROM conversations c
      JOIN agents a ON a.id = c.agent_id
      ${toWhere([...clauses, `c.agent_id IS NOT NULL`])}
      GROUP BY a.id, a.name
      ORDER BY bad_csat_count DESC
      LIMIT $${next}
    `,
    params,
  };
}

export function top_dispositions_by_count(f: AnalyticsFilters, extras?: TemplateExtras): { sql: string; params: any[] } {
  const { clauses, params, next } = buildWhere(f);
  const topN = extras?.topN ?? 10;
  const metric = extras?.metricName || 'count';
  const baseWhere = [...clauses, `c.tags->>'disposition' IS NOT NULL`, `c.tags->>'disposition' != ''`];

  params.push(topN);
  if (metric === 'bad_csat_count') {
    return {
      sql: `
        SELECT
          c.tags->>'disposition' AS disposition,
          COUNT(*) FILTER (WHERE c.csat_label IN ('bad','could_be_better'))::int AS bad_csat_count,
          COUNT(*)::int AS total
        FROM conversations c
        ${toWhere(baseWhere)}
        GROUP BY 1
        ORDER BY bad_csat_count DESC
        LIMIT $${next}
      `,
      params,
    };
  }

  return {
    sql: `
      SELECT
        c.tags->>'disposition' AS disposition,
        COUNT(*)::int AS count
      FROM conversations c
      ${toWhere(baseWhere)}
      GROUP BY 1
      ORDER BY 2 DESC
      LIMIT $${next}
    `,
    params,
  };
}

export function bot_vs_human_resolution_rate(f: AnalyticsFilters): { sql: string; params: any[] } {
  const { clauses, params } = buildWhere(f);
  return {
    sql: `
      SELECT
        c.conversation_type,
        COUNT(*)::int AS count,
        ROUND(AVG(c.resolution_seconds))::int AS avg_resolution_seconds,
        ROUND(AVG(c.frt_seconds))::int AS avg_frt_seconds
      FROM conversations c
      ${toWhere([...clauses, `c.conversation_type IS NOT NULL`])}
      GROUP BY 1
      ORDER BY 1
    `,
    params,
  };
}

export function avg_resolution_time(f: AnalyticsFilters): { sql: string; params: any[] } {
  const { clauses, params } = buildWhere(f);
  return {
    sql: `
      SELECT
        ROUND(AVG(c.frt_seconds))::int            AS avg_frt_seconds,
        ROUND(AVG(c.bot_to_team_seconds))::int    AS avg_bot_to_team_seconds,
        ROUND(AVG(c.resolution_seconds))::int     AS avg_resolution_seconds,
        COUNT(*)::int                             AS total_chats
      FROM conversations c
      ${toWhere(clauses)}
    `,
    params,
  };
}

export function iqs_score_distribution(f: AnalyticsFilters): { sql: string; params: any[] } {
  const { clauses, params } = buildWhere(f, 'c');
  return {
    sql: `
      SELECT
        (FLOOR(s.iqs_score / 10) * 10)::int AS bucket_start,
        COUNT(*)::int AS count
      FROM iqs_scores s
      JOIN conversations c ON c.id = s.chat_id
      ${toWhere(clauses)}
      GROUP BY 1
      ORDER BY 1
    `,
    params,
  };
}

export function iqs_parameter_failure_rates(f: AnalyticsFilters): { sql: string; params: any[] } {
  const { clauses, params } = buildWhere(f, 'c');

  const cols = IQS_PARAMS.flatMap(p => {
    const col = p.toLowerCase();
    return [
      `COUNT(*) FILTER (WHERE (s.parameters->'${p}'->>'score') IN ('true','false'))::int AS ${col}_applicable`,
      `COUNT(*) FILTER (WHERE (s.parameters->'${p}'->>'score') = 'false')::int AS ${col}_failed`,
    ];
  }).join(',\n        ');

  return {
    sql: `
      SELECT
        ${cols},
        COUNT(*)::int AS n
      FROM iqs_scores s
      JOIN conversations c ON c.id = s.chat_id
      ${toWhere(clauses)}
    `,
    params,
  };
}

export function team_breakdown(f: AnalyticsFilters, extras?: TemplateExtras): { sql: string; params: any[] } {
  const { clauses, params } = buildWhere(f, 'c');
  const metric = extras?.metricName || 'count';
  const baseWhere = [...clauses, `c.team_id IS NOT NULL`];

  if (metric === 'avg_iqs') {
    return {
      sql: `
        SELECT
          t.name AS team,
          t.type AS team_type,
          ROUND(AVG(s.iqs_score), 1)::float AS avg_iqs,
          COUNT(*)::int AS chats
        FROM conversations c
        JOIN teams t ON t.id = c.team_id
        JOIN iqs_scores s ON s.chat_id = c.id
        ${toWhere(baseWhere)}
        GROUP BY t.id, t.name, t.type
        ORDER BY avg_iqs DESC
      `,
      params,
    };
  }

  if (metric === 'bad_csat_pct') {
    return {
      sql: `
        SELECT
          t.name AS team,
          t.type AS team_type,
          COUNT(*) FILTER (WHERE c.csat_label IN ('bad','could_be_better'))::int AS bad_csat,
          COUNT(*) FILTER (WHERE c.csat_label IS NOT NULL)::int AS with_csat,
          ROUND(
            COUNT(*) FILTER (WHERE c.csat_label IN ('bad','could_be_better')) * 100.0
            / NULLIF(COUNT(*) FILTER (WHERE c.csat_label IS NOT NULL), 0),
            1
          )::float AS bad_csat_pct
        FROM conversations c
        JOIN teams t ON t.id = c.team_id
        ${toWhere(baseWhere)}
        GROUP BY t.id, t.name, t.type
        ORDER BY bad_csat_pct DESC NULLS LAST
      `,
      params,
    };
  }

  return {
    sql: `
      SELECT
        t.name AS team,
        t.type AS team_type,
        COUNT(*)::int AS count
      FROM conversations c
      JOIN teams t ON t.id = c.team_id
      ${toWhere(baseWhere)}
      GROUP BY t.id, t.name, t.type
      ORDER BY 3 DESC
    `,
    params,
  };
}

export function agent_breakdown_in_team(f: AnalyticsFilters, extras?: TemplateExtras): { sql: string; params: any[] } {
  const { clauses, params, next } = buildWhere(f, 'c');
  const teamId = extras?.teamId;
  const teamClauses = [...clauses, `c.agent_id IS NOT NULL`];
  if (teamId != null) {
    teamClauses.push(`c.team_id = $${next}`);
    params.push(teamId);
  }
  return {
    sql: `
      SELECT
        a.name AS agent,
        COUNT(*)::int AS chats,
        COUNT(*) FILTER (WHERE c.csat_label IN ('bad','could_be_better'))::int AS bad_csat,
        ROUND(AVG(s.iqs_score), 1)::float AS avg_iqs,
        ROUND(AVG(c.frt_seconds))::int AS avg_frt_seconds
      FROM conversations c
      JOIN agents a ON a.id = c.agent_id
      LEFT JOIN iqs_scores s ON s.chat_id = c.id
      ${toWhere(teamClauses)}
      GROUP BY a.id, a.name
      ORDER BY chats DESC
      LIMIT 50
    `,
    params,
  };
}

export function compare_two_windows(f: AnalyticsFilters, extras?: TemplateExtras): { sql: string; params: any[] } {
  const winA = extras?.windowA ?? { dateFrom: f.dateFrom, dateTo: f.dateTo };
  const winB = extras?.windowB ?? { dateFrom: f.dateFrom, dateTo: f.dateTo };
  const metric = extras?.metricName || 'count';

  // Shared dimension filters (disposition, team, csat, type, agent) — same for both windows
  const sharedF: AnalyticsFilters = {
    ...f,
    dateFrom: '1970-01-01',
    dateTo: '9999-12-31',
  };

  const { clauses: sharedClauses, params: sharedParams } = buildWhere(sharedF);
  // Remove the date clauses (first two) since we inject per-window dates
  const dimClauses = sharedClauses.slice(2);

  const params: any[] = [];
  let i = 1;

  function windowSql(win: { dateFrom: string; dateTo: string }, label: string): string {
    const wClauses = [
      `c.closed_at >= $${i++}::timestamptz`,
      `c.closed_at < $${i++}::timestamptz`,
      ...dimClauses.map(cl => {
        // Remap $N placeholders — they're already at correct positions since params grows
        return cl;
      }),
    ];
    params.push(win.dateFrom + 'T00:00:00Z', win.dateTo + 'T23:59:59.999Z');
    // Push shared dim params for this window
    params.push(...sharedParams.slice(2));

    const metricExpr = metric === 'avg_iqs'
      ? `ROUND(AVG(s.iqs_score), 1)::float`
      : `COUNT(*)::int`;
    const iqsJoin = metric === 'avg_iqs'
      ? `JOIN iqs_scores s ON s.chat_id = c.id`
      : '';

    return `SELECT '${label}' AS window_label, ${metricExpr} AS value, COUNT(*)::int AS count
            FROM conversations c ${iqsJoin}
            ${toWhere(wClauses)}`;
  }

  // Rebuild with correct $N numbering
  function buildWindowSql(win: { dateFrom: string; dateTo: string }, label: string, baseIdx: number) {
    const localParams: any[] = [];
    const wClauses: string[] = [];
    let li = baseIdx;
    wClauses.push(`c.closed_at >= $${li++}::timestamptz`);
    localParams.push(win.dateFrom + 'T00:00:00Z');
    wClauses.push(`c.closed_at < $${li++}::timestamptz`);
    localParams.push(win.dateTo + 'T23:59:59.999Z');

    // Shared dimension clauses with correct numbering
    const { clauses: dimC, params: dimP } = buildWhere(
      { ...f, dateFrom: '1970-01-01', dateTo: '9999-12-31' },
      'c',
      li,
    );
    wClauses.push(...dimC.slice(2));
    localParams.push(...dimP.slice(2));

    const metricExpr = metric === 'avg_iqs'
      ? `ROUND(AVG(s.iqs_score), 1)::float`
      : `COUNT(*)::int`;
    const iqsJoin = metric === 'avg_iqs' ? `JOIN iqs_scores s ON s.chat_id = c.id` : '';

    return {
      sql: `SELECT '${label}' AS window_label, ${metricExpr} AS value, COUNT(*)::int AS count
            FROM conversations c ${iqsJoin}
            ${toWhere(wClauses)}`,
      params: localParams,
      nextIdx: li + dimP.slice(2).length,
    };
  }

  const aResult = buildWindowSql(winA, 'A', 1);
  const bResult = buildWindowSql(winB, 'B', aResult.nextIdx);

  return {
    sql: `${aResult.sql} UNION ALL ${bResult.sql}`,
    params: [...aResult.params, ...bResult.params],
  };
}

export function unclassified_count(f: AnalyticsFilters): { sql: string; params: any[] } {
  const { clauses, params } = buildWhere(f);
  return {
    sql: `
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE tags->>'disposition' IS NULL OR tags->>'disposition' = '')::int AS unclassified_disposition,
        COUNT(*) FILTER (WHERE tags->>'sub_disposition' IS NULL OR tags->>'sub_disposition' = '')::int AS unclassified_sub_disposition,
        COUNT(*) FILTER (
          WHERE (tags->>'disposition' IS NULL OR tags->>'disposition' = '')
             OR (tags->>'sub_disposition' IS NULL OR tags->>'sub_disposition' = '')
        )::int AS either_unclassified
      FROM conversations c
      ${toWhere(clauses)}
    `,
    params,
  };
}

// ── Dispatcher ────────────────────────────────────────────────────────────────

export function buildQuery(
  templateId: string,
  f: AnalyticsFilters,
  extras?: TemplateExtras,
): { sql: string; params: any[] } {
  switch (templateId) {
    case 'count_by_disposition':         return count_by_disposition(f);
    case 'count_by_sub_disposition':     return count_by_sub_disposition(f);
    case 'csat_distribution':            return csat_distribution(f);
    case 'trend_by_week':                return trend_by_week(f, extras);
    case 'bad_csat_trend_by_week':       return bad_csat_trend_by_week(f, extras);
    case 'top_agents_by_metric':         return top_agents_by_metric(f, extras);
    case 'top_dispositions_by_count':    return top_dispositions_by_count(f, extras);
    case 'bot_vs_human_resolution_rate': return bot_vs_human_resolution_rate(f);
    case 'avg_resolution_time':          return avg_resolution_time(f);
    case 'iqs_score_distribution':       return iqs_score_distribution(f);
    case 'iqs_parameter_failure_rates':  return iqs_parameter_failure_rates(f);
    case 'team_breakdown':               return team_breakdown(f, extras);
    case 'agent_breakdown_in_team':      return agent_breakdown_in_team(f, extras);
    case 'compare_two_windows':          return compare_two_windows(f, extras);
    case 'unclassified_count':           return unclassified_count(f);
    default:                             return count_by_disposition(f);
  }
}

export { IQS_PARAMS };
