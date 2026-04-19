import type { AnalyticsFilters, InsightBlock, QueryShape } from './types';
import { IQS_PARAMS } from './templates';

// ── Helpers ───────────────────────────────────────────────────────────────────

export function fmtSecs(s: number | null | undefined): string {
  if (s == null || isNaN(s)) return 'N/A';
  const mins = Math.floor(s / 60);
  const secs = Math.round(s % 60);
  if (mins === 0) return `${secs}s`;
  return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
}

const PARAM_NAMES: Record<string, string> = {
  Technical:    'Technically / Legally Correct',
  AllQuestions: 'All Questions Answered',
  Expectation:  'Expectation Setting',
  Contextual:   'Contextual & Personal',
  FollowUp:     'Follow-up & Closing',
  Sentences:    'Sentences / Tone',
  Process:      'Process-wise',
  Opening:      'First Response & Opening',
  Call:         'Call (when required)',
  Tags:         'Tags Accuracy',
  Grammar:      'Grammar / Structure',
  Empathy:      'Empathy',
};

// ── Filter header ─────────────────────────────────────────────────────────────

export function formatFilterHeader(filters: AnalyticsFilters): InsightBlock {
  const parts: string[] = [];

  // Date range
  parts.push(`${filters.dateFrom} → ${filters.dateTo}`);

  // CSAT
  if (filters.csatLabels.length === 0) {
    parts.push('All CSAT');
  } else {
    const csatMap: Record<string, string> = {
      bad: 'Bad',
      could_be_better: 'Could Be Better',
      good: 'Good',
    };
    parts.push(filters.csatLabels.map(c => csatMap[c] ?? c).join(' + ') + ' CSAT');
  }

  // Team
  if (filters.teams.length > 0) {
    parts.push(`Team IDs: ${filters.teams.join(', ')}`);
  } else {
    parts.push('All teams');
  }

  // Disposition
  if (filters.dispositions.length > 0) {
    parts.push(`Disposition: ${filters.dispositions.slice(0, 2).join(', ')}${filters.dispositions.length > 2 ? ` +${filters.dispositions.length - 2}` : ''}`);
  }

  // Conversation type
  if (filters.conversationTypes.length > 0) {
    parts.push(filters.conversationTypes.map(t => t.charAt(0).toUpperCase() + t.slice(1)).join(' / '));
  }

  // Agent
  if (filters.agentIds.length > 0) {
    parts.push(`${filters.agentIds.length} agent(s) filtered`);
  }

  return { type: 'filter_header', summary: parts.join(' · ') };
}

// ── Dynamic result formatter (text-to-sql mode) ───────────────────────────────

export function formatDynamicResult(
  rows: any[],
  chartHint: 'bar' | 'line' | 'table' | 'stat',
  title: string,
): InsightBlock[] {
  if (!rows.length) {
    return [{ type: 'insight', severity: 'info', text: 'No data found for the selected filters.' }];
  }

  if (chartHint === 'stat') {
    // Single row with multiple columns → one stat per column
    if (rows.length === 1) {
      const stats = Object.entries(rows[0]).map(([k, v]) => ({
        label: k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
        value: v != null ? String(v) : '—',
      }));
      return [{ type: 'stat_row', stats }];
    }
    // Multiple rows with label/value columns
    const stats = rows.map(r => ({
      label: String(r.label ?? r.name ?? Object.values(r)[0] ?? ''),
      value: String(r.value ?? Object.values(r)[1] ?? ''),
    }));
    return [{ type: 'stat_row', stats }];
  }

  if (chartHint === 'bar') {
    const data = rows.map(r => ({
      name:  String(r.name  ?? ''),
      value: Number(r.value ?? 0),
      ...(r.sub != null ? { sub: String(r.sub) } : {}),
    }));
    return [{ type: 'bar_chart', title, data }];
  }

  if (chartHint === 'line') {
    const data = rows.map(r => ({
      date:  String(r.date  ?? ''),
      value: Number(r.value ?? 0),
    }));
    return [{ type: 'line_chart', title, data }];
  }

  // Default: table
  const columns = Object.keys(rows[0]).map(k =>
    k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
  );
  const tableRows = rows.map(r =>
    Object.values(r).map(v => (v != null ? String(v) : '—')),
  );
  return [{ type: 'table', title, columns, rows: tableRows }];
}

// ── Main formatter ────────────────────────────────────────────────────────────

export function formatResult(
  templateId: string,
  shape: QueryShape,
  rows: any[],
): InsightBlock[] {
  if (!rows.length) {
    return [{ type: 'insight', text: 'No data found for the selected filters.', severity: 'info' }];
  }

  switch (shape) {
    case 'aggregate':    return formatAggregate(templateId, rows);
    case 'breakdown':    return formatBreakdown(templateId, rows);
    case 'trend':        return formatTrend(templateId, rows);
    case 'comparison':   return formatComparison(templateId, rows);
    case 'distribution': return formatDistribution(templateId, rows);
    case 'ranked_list':  return formatRankedList(templateId, rows);
    default:
      return [{ type: 'insight', text: 'Results ready.', severity: 'info' }];
  }
}

// ── Shape formatters ──────────────────────────────────────────────────────────

function formatAggregate(templateId: string, rows: any[]): InsightBlock[] {
  const r = rows[0] ?? {};

  if (templateId === 'avg_resolution_time') {
    return [{
      type: 'stat_row',
      stats: [
        { label: 'Avg FRT', value: fmtSecs(r.avg_frt_seconds) },
        { label: 'Bot→Team', value: fmtSecs(r.avg_bot_to_team_seconds) },
        { label: 'Avg Resolution', value: fmtSecs(r.avg_resolution_seconds) },
        { label: 'Total Chats', value: String(r.total_chats ?? 0) },
      ],
    }];
  }

  if (templateId === 'unclassified_count') {
    const pct = r.total > 0
      ? Math.round((r.either_unclassified / r.total) * 100)
      : 0;
    return [{
      type: 'stat_row',
      stats: [
        { label: 'Total Chats', value: String(r.total ?? 0) },
        { label: 'Unclassified (either)', value: String(r.either_unclassified ?? 0), color: pct > 20 ? 'red' : 'orange' },
        { label: 'No Disposition', value: String(r.unclassified_disposition ?? 0) },
        { label: 'No Sub-Disposition', value: String(r.unclassified_sub_disposition ?? 0) },
      ],
    }];
  }

  // Generic single-row aggregate
  const stats = Object.entries(r).map(([k, v]) => ({
    label: k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    value: typeof v === 'number' && k.includes('second') ? fmtSecs(v as number) : String(v ?? 'N/A'),
  }));
  return [{ type: 'stat_row', stats }];
}

function formatBreakdown(templateId: string, rows: any[]): InsightBlock[] {
  const top = rows.slice(0, 10);
  const rest = rows.slice(10);

  const data = top.map(r => {
    const nameKey = Object.keys(r).find(k => typeof r[k] === 'string') ?? '';
    const valueKey = Object.keys(r).find(k => typeof r[k] === 'number') ?? '';
    return { name: String(r[nameKey] ?? 'Unknown'), value: Number(r[valueKey] ?? 0) };
  });

  if (rest.length > 0) {
    const othersSum = rest.reduce((s, r) => {
      const valueKey = Object.keys(r).find(k => typeof r[k] === 'number') ?? '';
      return s + Number(r[valueKey] ?? 0);
    }, 0);
    data.push({ name: 'Others', value: othersSum });
  }

  const titleMap: Record<string, string> = {
    count_by_disposition:      'Conversations by Disposition',
    count_by_sub_disposition:  'Conversations by Sub-Disposition',
    team_breakdown:            'Team Breakdown',
  };

  return [{
    type: 'bar_chart',
    title: titleMap[templateId] ?? 'Breakdown',
    data,
  }];
}

function formatTrend(templateId: string, rows: any[]): InsightBlock[] {
  const data = rows.map(r => ({
    date: String(r.period ?? r.week_start ?? r.date ?? ''),
    value: Number(r.count ?? 0),
  }));

  const titleMap: Record<string, string> = {
    trend_by_week:          'Conversation Volume Over Time',
    bad_csat_trend_by_week: 'Bad CSAT Trend Over Time',
  };

  return [{
    type: 'line_chart',
    title: titleMap[templateId] ?? 'Trend Over Time',
    data,
  }];
}

function formatComparison(templateId: string, rows: any[]): InsightBlock[] {
  if (templateId === 'bot_vs_human_resolution_rate') {
    const stats = rows.map(r => ({
      label: (r.conversation_type as string).charAt(0).toUpperCase() + (r.conversation_type as string).slice(1),
      value: `${r.count} chats`,
      sub: `Avg resolution: ${fmtSecs(r.avg_resolution_seconds)} · FRT: ${fmtSecs(r.avg_frt_seconds)}`,
    }));
    return [{ type: 'stat_row', stats }];
  }

  if (templateId === 'compare_two_windows') {
    const a = rows.find(r => r.window_label === 'A');
    const b = rows.find(r => r.window_label === 'B');
    if (!a || !b) return [{ type: 'insight', text: 'Comparison data incomplete.', severity: 'info' }];

    const aVal = Number(a.value ?? 0);
    const bVal = Number(b.value ?? 0);
    const delta = aVal - bVal;
    const pct = bVal > 0 ? Math.round((delta / bVal) * 100) : 0;
    const color = delta > 0 ? 'red' : delta < 0 ? 'green' : undefined;

    return [{
      type: 'stat_row',
      stats: [
        { label: 'Period A', value: String(aVal), sub: `${a.count} chats` },
        { label: 'Period B', value: String(bVal), sub: `${b.count} chats` },
        { label: 'Change', value: `${delta >= 0 ? '+' : ''}${delta}`, sub: `${pct >= 0 ? '+' : ''}${pct}%`, color },
      ],
    }];
  }

  return formatBreakdown(templateId, rows);
}

function formatDistribution(templateId: string, rows: any[]): InsightBlock[] {
  if (templateId === 'csat_distribution') {
    const colorMap: Record<string, 'green' | 'orange' | 'red'> = {
      good: 'green',
      could_be_better: 'orange',
      bad: 'red',
    };
    const labelMap: Record<string, string> = {
      good: 'Good',
      could_be_better: 'Could Be Better',
      bad: 'Bad',
    };
    const stats = rows.map(r => ({
      label: labelMap[r.csat_label] ?? r.csat_label,
      value: `${r.count} (${r.pct}%)`,
      color: colorMap[r.csat_label],
    }));
    return [{ type: 'stat_row', stats }];
  }

  if (templateId === 'iqs_score_distribution') {
    const data = rows.map(r => {
      const start = Number(r.bucket_start ?? 0);
      const end = start === 90 ? 100 : start + 9;
      return { name: `${start}–${end}`, value: Number(r.count ?? 0) };
    });
    return [{
      type: 'bar_chart',
      title: 'IQS Score Distribution',
      data,
    }];
  }

  return formatBreakdown(templateId, rows);
}

function formatRankedList(templateId: string, rows: any[]): InsightBlock[] {
  if (templateId === 'iqs_parameter_failure_rates') {
    return formatIqsFailureRates(rows);
  }

  const top = rows.slice(0, 10);
  if (!top.length) return [{ type: 'insight', text: 'No data.', severity: 'info' }];

  const columns = Object.keys(top[0]).map(k =>
    k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
  );
  const tableRows = top.map(r =>
    Object.values(r).map(v => {
      if (typeof v === 'number') {
        const str = String(v);
        // Detect seconds columns by context (not by key, since we don't have key here)
        return str;
      }
      return v == null ? '—' : String(v);
    }),
  ) as (string | number)[][];

  const titleMap: Record<string, string> = {
    top_agents_by_metric:      'Top Agents',
    top_dispositions_by_count: 'Top Dispositions',
    team_breakdown:            'Team Breakdown',
    agent_breakdown_in_team:   'Agent Breakdown',
  };

  return [{
    type: 'table',
    title: titleMap[templateId] ?? 'Results',
    columns,
    rows: tableRows,
  }];
}

function formatIqsFailureRates(rows: any[]): InsightBlock[] {
  const r = rows[0];
  if (!r) return [{ type: 'insight', text: 'No IQS data.', severity: 'info' }];

  const N = Number(r.n ?? 0);
  const rates = IQS_PARAMS.map(p => {
    const col = p.toLowerCase();
    const applicable = Number(r[`${col}_applicable`] ?? 0);
    const failed = Number(r[`${col}_failed`] ?? 0);
    const failureRate = applicable >= 10 ? failed / applicable : -1;
    return {
      param: p,
      displayName: PARAM_NAMES[p] ?? p,
      failureRate,
      applicable,
      applicability: N > 0 ? (applicable / N) : 0,
    };
  })
    .filter(x => x.failureRate >= 0)
    .sort((a, b) => b.failureRate - a.failureRate);

  if (!rates.length) {
    return [{ type: 'insight', text: 'Not enough data to rank parameters (need ≥10 applicable conversations per parameter).', severity: 'info' }];
  }

  const data = rates.map(x => ({
    name: x.displayName,
    value: Math.round(x.failureRate * 100),
    sub: `${Math.round(x.applicability * 100)}% applicable`,
  }));

  return [{
    type: 'bar_chart',
    title: 'IQS Parameter Failure Rates',
    data,
    unit: '%',
  }];
}
