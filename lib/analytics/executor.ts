import { query } from '@/lib/cx/db';
import { buildQuery, IQS_PARAMS } from './templates';
import type { AnalyticsFilters, TemplateExtras } from './types';

const QUERY_TIMEOUT_MS = 30_000;
const ROW_CAP = 10_000;

export interface ExecuteResult {
  rows: any[];
  templateId: string;
  rowCount: number;
  latencyMs: number;
}

function dateDiff(dateFrom: string, dateTo: string): number {
  return Math.abs(
    (new Date(dateTo).getTime() - new Date(dateFrom).getTime()) / (1000 * 60 * 60 * 24),
  );
}

function resolveExtras(templateId: string, filters: AnalyticsFilters, extras?: TemplateExtras): TemplateExtras {
  const resolved = { ...extras };
  // Auto-determine day vs week bucketing for trend templates
  if (templateId === 'trend_by_week' || templateId === 'bad_csat_trend_by_week') {
    if (!resolved.bucket) {
      resolved.bucket = dateDiff(filters.dateFrom, filters.dateTo) <= 30 ? 'day' : 'week';
    }
  }
  return resolved;
}

export async function executeTemplate(
  templateId: string,
  filters: AnalyticsFilters,
  extras?: TemplateExtras,
): Promise<ExecuteResult> {
  const start = Date.now();
  const resolvedExtras = resolveExtras(templateId, filters, extras);
  const { sql, params } = buildQuery(templateId, filters, resolvedExtras);

  const rows = await Promise.race([
    query(sql, params),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error('Query timed out after 30 seconds. Try narrowing the time range.')),
        QUERY_TIMEOUT_MS,
      ),
    ),
  ]);

  if (rows.length > ROW_CAP) {
    throw new Error(`Result too large (${rows.length.toLocaleString()} rows). Apply more filters.`);
  }

  return {
    rows,
    templateId,
    rowCount: rows.length,
    latencyMs: Date.now() - start,
  };
}

// ── Audit log ─────────────────────────────────────────────────────────────────

export async function writeAuditLog(data: {
  userEmail: string;
  queryText: string;
  queryType: 1 | 2;
  templateId: string | null;
  rowCount: number;
  latencyMs: number;
}): Promise<void> {
  try {
    await query(
      `INSERT INTO analytics_audit_log
         (user_email, query_text, query_type, template_id, row_count, latency_ms)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [data.userEmail, data.queryText, data.queryType, data.templateId, data.rowCount, data.latencyMs],
    );
  } catch (err: any) {
    // Non-fatal — log but don't surface to user
    console.error('[analytics] audit log write failed:', err?.message);
  }
}

// ── IQS failure rate helper (shared with themes.ts) ──────────────────────────

export interface ParamFailureRate {
  param: string;       // PascalCase key
  displayName: string;
  failureRate: number; // 0–1
  applicable: number;
  applicability: number; // 0–1
}

export function computeParamFailureRates(
  conversations: Array<{ parameters: any }>,
): ParamFailureRate[] {
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

  const N = conversations.length;
  if (!N) return [];

  return IQS_PARAMS.map(p => {
    let applicable = 0;
    let failed = 0;
    for (const c of conversations) {
      let params = c.parameters;
      if (typeof params === 'string') { try { params = JSON.parse(params); } catch { params = {}; } }
      const score = params?.[p]?.score;
      if (score === true || score === false) {
        applicable++;
        if (score === false) failed++;
      }
    }
    return {
      param: p,
      displayName: PARAM_NAMES[p] ?? p,
      failureRate: applicable >= 10 ? failed / applicable : -1,
      applicable,
      applicability: N > 0 ? applicable / N : 0,
    };
  })
    .filter(r => r.failureRate >= 0)
    .sort((a, b) => b.failureRate - a.failureRate);
}
