import { query } from '@/lib/cx/db';
import { buildQuery, IQS_PARAMS } from './templates';
import type { AnalyticsFilters, TemplateExtras } from './types';
import { PARAM_NAMES as QUALITY_PARAM_NAMES } from '@/lib/quality';
import { resolveParamCell } from '@/lib/param-keys';

const QUERY_TIMEOUT_MS = 30_000;
const ROW_CAP = 10_000;
const QUERY_CACHE_TTL = 300; // 5 minutes

// ── Redis query cache ─────────────────────────────────────────────────────────

const UPSTASH_URL   = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

function cacheReady() { return !!(UPSTASH_URL && UPSTASH_TOKEN); }

async function cacheGet(key: string): Promise<string | null> {
  if (!cacheReady()) return null;
  try {
    const res = await fetch(`${UPSTASH_URL}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` }, cache: 'no-store',
    });
    return (await res.json()).result ?? null;
  } catch { return null; }
}

async function cacheSet(key: string, value: string): Promise<void> {
  if (!cacheReady()) return;
  try {
    await fetch(`${UPSTASH_URL}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([['SET', key, value, 'EX', String(QUERY_CACHE_TTL)]]),
    });
  } catch {}
}

// DML keywords that must never appear in an analytics query, even inside a CTE.
const DML_PATTERN = /\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|CREATE|GRANT|REVOKE|COPY|CALL|EXECUTE)\b/i;

function isReadQuery(sql: string): boolean {
  const t = sql.trim().toUpperCase();
  if (!t.startsWith('SELECT') && !t.startsWith('WITH')) return false;
  // Reject any SQL that contains DML keywords (covers "WITH … DELETE … RETURNING" bypass).
  if (DML_PATTERN.test(sql)) return false;
  // Reject multi-statement injection (semicolon followed by non-whitespace).
  if (/;\s*\S/.test(sql)) return false;
  return true;
}

function queryCacheKey(sql: string): string {
  const normalized = sql.replace(/\s+/g, ' ').trim();
  return `wint_aq:${normalized}`;
}

function stripHeavyColumns(rows: any[]): void {
  for (const row of rows) {
    delete row.raw_payload;
    delete row.transcript;
  }
}

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

// ── Raw SQL execution (for text-to-sql mode) ──────────────────────────────────

export async function executeRawSQL(sql: string): Promise<{ rows: any[]; rowCount: number; latencyMs: number }> {
  const start = Date.now();

  // Return cached result for read queries (5-min TTL)
  if (isReadQuery(sql)) {
    const cached = await cacheGet(queryCacheKey(sql));
    if (cached) {
      try {
        const { rows, rowCount } = JSON.parse(cached);
        return { rows, rowCount, latencyMs: 0 };
      } catch {}
    }
  }

  const rows = await Promise.race([
    query<any>(sql, []),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error('Query timed out after 30 seconds. Try narrowing the time range.')),
        QUERY_TIMEOUT_MS,
      ),
    ),
  ]);

  // Strip heavy columns that should never appear in analytics results
  stripHeavyColumns(rows);

  const result = { rows, rowCount: rows.length, latencyMs: Date.now() - start };

  // Cache read queries in background — don't await
  if (isReadQuery(sql)) {
    cacheSet(queryCacheKey(sql), JSON.stringify({ rows, rowCount: rows.length })).catch(() => {});
  }

  return result;
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
  const N = conversations.length;
  if (!N) return [];

  return IQS_PARAMS.map(p => {
    let applicable = 0;
    let failed = 0;
    for (const c of conversations) {
      let params = c.parameters;
      if (typeof params === 'string') { try { params = JSON.parse(params); } catch { params = {}; } }
      // resolveParamCell handles every storage dialect (v4 nested, legacy flat,
      // old no-underscore keys). The old code indexed PascalCase at the top
      // level, which never matched a stored row — every rate came back empty.
      const safe = params?.__agent_parameters || params || {};
      const score = resolveParamCell(safe, p).score;
      if (score === true || score === false || score === 0.5) {
        applicable++;
        if (score === false) failed++;
      }
    }
    return {
      param: p,
      displayName: QUALITY_PARAM_NAMES[p] ?? p,
      failureRate: applicable >= 10 ? failed / applicable : -1,
      applicable,
      applicability: N > 0 ? applicable / N : 0,
    };
  })
    .filter(r => r.failureRate >= 0)
    .sort((a, b) => b.failureRate - a.failureRate);
}
