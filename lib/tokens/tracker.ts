import { query } from '@/lib/cx/db';
import { calculateCost, getModelPricing, USD_TO_INR_RATE } from './pricing';

export interface TokenUsageRecord {
  provider?: string;
  model: string;
  feature: string; // 'chat' | 'quality_scoring' | 'call_analysis' | 'analytics' | 'corrections' | 'ir_report' | etc.
  inputTokens: number;
  outputTokens: number;
  latencyMs?: number;
  status?: 'success' | 'error';
  requestCount?: number;
  userEmail?: string | null;
  metadata?: Record<string, any> | null;
  createdAt?: Date | string;
}

let tableEnsured = false;

export async function ensureTokenUsageTable(): Promise<void> {
  if (tableEnsured) return;
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS token_usage_logs (
        id            BIGSERIAL PRIMARY KEY,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        provider      VARCHAR(40) NOT NULL,
        model         VARCHAR(80) NOT NULL,
        feature       VARCHAR(60) NOT NULL,
        input_tokens  INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        total_tokens  INTEGER NOT NULL DEFAULT 0,
        cost_usd      NUMERIC(12, 6) NOT NULL DEFAULT 0,
        latency_ms    INTEGER,
        status        VARCHAR(20) NOT NULL DEFAULT 'success',
        request_count INTEGER NOT NULL DEFAULT 1,
        user_email    VARCHAR(255),
        metadata      JSONB
      );

      CREATE INDEX IF NOT EXISTS idx_token_usage_created_at ON token_usage_logs (created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_token_usage_model      ON token_usage_logs (model);
      CREATE INDEX IF NOT EXISTS idx_token_usage_feature    ON token_usage_logs (feature);
      CREATE INDEX IF NOT EXISTS idx_token_usage_provider   ON token_usage_logs (provider);
    `);
    tableEnsured = true;
  } catch (err: any) {
    console.error('[token-tracker] Failed to ensure token_usage_logs table:', err?.message || err);
  }
}

/**
 * Asynchronously records a token usage event.
 * Never throws — failures are logged to console to protect main application logic.
 */
export async function recordTokenUsage(record: TokenUsageRecord): Promise<void> {
  // Fire-and-forget inside promise to never block LLM caller
  Promise.resolve().then(async () => {
    try {
      await ensureTokenUsageTable();

      const model = (record.model || 'unknown').trim();
      const pricing = getModelPricing(model);
      const provider = record.provider || pricing.provider;
      const feature = (record.feature || 'general').trim();

      const inputTokens = Math.max(0, Math.round(record.inputTokens || 0));
      const outputTokens = Math.max(0, Math.round(record.outputTokens || 0));
      const totalTokens = inputTokens + outputTokens;

      if (totalTokens === 0 && record.status !== 'error') {
        // Skip zero token recordings if not error
        return;
      }

      const costUsd = calculateCost(model, inputTokens, outputTokens);
      const latencyMs = record.latencyMs != null ? Math.round(record.latencyMs) : null;
      const status = record.status || 'success';
      const requestCount = record.requestCount != null ? Math.max(1, Math.round(record.requestCount)) : 1;
      const userEmail = record.userEmail ? record.userEmail.toLowerCase().trim() : null;
      const metadataStr = record.metadata ? JSON.stringify(record.metadata) : null;
      const createdAt = record.createdAt ? new Date(record.createdAt).toISOString() : new Date().toISOString();

      await query(
        `INSERT INTO token_usage_logs
          (created_at, provider, model, feature, input_tokens, output_tokens, total_tokens, cost_usd, latency_ms, status, request_count, user_email, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          createdAt,
          provider,
          model,
          feature,
          inputTokens,
          outputTokens,
          totalTokens,
          costUsd,
          latencyMs,
          status,
          requestCount,
          userEmail,
          metadataStr,
        ]
      );
    } catch (err: any) {
      console.error('[token-tracker] Error recording token usage:', err?.message || err);
    }
  });
}

export interface MetricsFilter {
  timeframe?: '24h' | '7d' | '30d' | 'all';
  model?: string;
  feature?: string;
}

export interface ModelUsageMetric {
  model: string;
  provider: string;
  displayName: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  costInr: number;
  requestCount: number;
  avgTokensPerRequest: number;
  sharePercent: number;
}

export interface FeatureUsageMetric {
  feature: string;
  displayName: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  costInr: number;
  requestCount: number;
  sharePercent: number;
}

export interface TimeSeriesPoint {
  date: string;       // e.g. "2026-09-08" or "14:00"
  label: string;
  totalTokens: number;
  costUsd: number;
  requests: number;
  [modelKey: string]: any; // dynamic model tokens
}

export interface TokenMetricsResponse {
  summary: {
    totalTokens: number;
    inputTokens: number;
    outputTokens: number;
    totalCostUsd: number;
    totalCostInr: number;
    totalRequests: number;
    topModel: string;
    topModelTokens: number;
    topFeature: string;
    timeframe: string;
  };
  byModel: ModelUsageMetric[];
  byFeature: FeatureUsageMetric[];
  timeSeries: TimeSeriesPoint[];
  recentLogs: Array<{
    id: string;
    createdAt: string;
    provider: string;
    model: string;
    feature: string;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    costUsd: number;
    latencyMs: number | null;
    status: string;
    userEmail: string | null;
  }>;
}

const FEATURE_NAMES: Record<string, string> = {
  quality_scoring: 'Quality Scoring (IQS)',
  call_analysis: 'Call Quality Analysis',
  chat: 'CX Knowledge Chat',
  analytics: 'Analytics & SQL Agent',
  corrections: 'Agent Corrections',
  ir_report: 'IR Weekly Report',
  general: 'General / Other',
};

export async function getTokenUsageMetrics(filter: MetricsFilter = {}): Promise<TokenMetricsResponse> {
  await ensureTokenUsageTable();

  const timeframe = filter.timeframe || '30d';

  let timeClause = '';
  const params: any[] = [];

  if (timeframe === '24h') {
    timeClause = `WHERE created_at >= NOW() - INTERVAL '24 hours'`;
  } else if (timeframe === '7d') {
    timeClause = `WHERE created_at >= NOW() - INTERVAL '7 days'`;
  } else if (timeframe === '30d') {
    timeClause = `WHERE created_at >= NOW() - INTERVAL '30 days'`;
  } else {
    // 'all'
    timeClause = `WHERE 1=1`;
  }

  let filterClause = timeClause;
  if (filter.model && filter.model !== 'all') {
    params.push(filter.model);
    filterClause += ` AND model = $${params.length}`;
  }
  if (filter.feature && filter.feature !== 'all') {
    params.push(filter.feature);
    filterClause += ` AND feature = $${params.length}`;
  }

  // 1. Overall Summary
  const summaryRows = await query<{
    total_tokens: string | null;
    input_tokens: string | null;
    output_tokens: string | null;
    total_cost: string | null;
    total_requests: string | null;
  }>(
    `SELECT
      COALESCE(SUM(total_tokens), 0) AS total_tokens,
      COALESCE(SUM(input_tokens), 0) AS input_tokens,
      COALESCE(SUM(output_tokens), 0) AS output_tokens,
      COALESCE(SUM(cost_usd), 0) AS total_cost,
      COALESCE(SUM(request_count), COUNT(*)) AS total_requests
     FROM token_usage_logs
     ${filterClause}`,
    params
  );

  const rawSummary = summaryRows[0] || {
    total_tokens: '0',
    input_tokens: '0',
    output_tokens: '0',
    total_cost: '0',
    total_requests: '0',
  };

  const totalTokens = Number(rawSummary.total_tokens || 0);
  const inputTokens = Number(rawSummary.input_tokens || 0);
  const outputTokens = Number(rawSummary.output_tokens || 0);
  const totalCostUsd = Number(rawSummary.total_cost || 0);
  const totalCostInr = Number((totalCostUsd * USD_TO_INR_RATE).toFixed(2));
  const totalRequests = Number(rawSummary.total_requests || 0);

  // 2. Breakdown By Model
  const modelRows = await query<{
    model: string;
    provider: string;
    input_tokens: string;
    output_tokens: string;
    total_tokens: string;
    cost_usd: string;
    request_count: string;
  }>(
    `SELECT
      model,
      provider,
      SUM(input_tokens) AS input_tokens,
      SUM(output_tokens) AS output_tokens,
      SUM(total_tokens) AS total_tokens,
      SUM(cost_usd) AS cost_usd,
      COALESCE(SUM(request_count), COUNT(*)) AS request_count
     FROM token_usage_logs
     ${filterClause}
     GROUP BY model, provider
     ORDER BY SUM(total_tokens) DESC`,
    params
  );

  const modelsTotalTokens = modelRows.reduce((acc, r) => acc + Number(r.total_tokens || 0), 0);

  const byModel: ModelUsageMetric[] = modelRows.map((r) => {
    const mTotal = Number(r.total_tokens || 0);
    const mInput = Number(r.input_tokens || 0);
    const mOutput = Number(r.output_tokens || 0);
    const mCost = Number(Number(r.cost_usd || 0).toFixed(6));
    const mReqs = Number(r.request_count || 0);
    const pricing = getModelPricing(r.model);

    return {
      model: r.model,
      provider: r.provider || pricing.provider,
      displayName: pricing.displayName || r.model,
      inputTokens: mInput,
      outputTokens: mOutput,
      totalTokens: mTotal,
      costUsd: mCost,
      costInr: Number((mCost * USD_TO_INR_RATE).toFixed(2)),
      requestCount: mReqs,
      avgTokensPerRequest: mReqs > 0 ? Math.round(mTotal / mReqs) : 0,
      sharePercent: modelsTotalTokens > 0 ? Number(((mTotal / modelsTotalTokens) * 100).toFixed(1)) : 0,
    };
  });

  const topModel = byModel[0]?.displayName || (byModel[0]?.model ?? 'None');
  const topModelTokens = byModel[0]?.totalTokens || 0;

  // 3. Breakdown By Feature
  const featureRows = await query<{
    feature: string;
    input_tokens: string;
    output_tokens: string;
    total_tokens: string;
    cost_usd: string;
    request_count: string;
  }>(
    `SELECT
      feature,
      SUM(input_tokens) AS input_tokens,
      SUM(output_tokens) AS output_tokens,
      SUM(total_tokens) AS total_tokens,
      SUM(cost_usd) AS cost_usd,
      COALESCE(SUM(request_count), COUNT(*)) AS request_count
     FROM token_usage_logs
     ${filterClause}
     GROUP BY feature
     ORDER BY SUM(total_tokens) DESC`,
    params
  );

  const featuresTotalTokens = featureRows.reduce((acc, r) => acc + Number(r.total_tokens || 0), 0);

  const byFeature: FeatureUsageMetric[] = featureRows.map((r) => {
    const fTotal = Number(r.total_tokens || 0);
    const fCost = Number(Number(r.cost_usd || 0).toFixed(6));
    return {
      feature: r.feature,
      displayName: FEATURE_NAMES[r.feature] || r.feature.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      inputTokens: Number(r.input_tokens || 0),
      outputTokens: Number(r.output_tokens || 0),
      totalTokens: fTotal,
      costUsd: fCost,
      costInr: Number((fCost * USD_TO_INR_RATE).toFixed(2)),
      requestCount: Number(r.request_count || 0),
      sharePercent: featuresTotalTokens > 0 ? Number(((fTotal / featuresTotalTokens) * 100).toFixed(1)) : 0,
    };
  });

  const topFeature = byFeature[0]?.displayName || (byFeature[0]?.feature ?? 'None');

  // 4. Time Series aggregation
  const isHourly = timeframe === '24h';
  const dateFormat = isHourly ? 'YYYY-MM-DD HH24:00' : 'YYYY-MM-DD';

  const timeSeriesRows = await query<{
    bucket: string;
    model: string;
    total_tokens: string;
    cost_usd: string;
    request_count: string;
  }>(
    `SELECT
      TO_CHAR(created_at, '${dateFormat}') AS bucket,
      model,
      SUM(total_tokens) AS total_tokens,
      SUM(cost_usd) AS cost_usd,
      COALESCE(SUM(request_count), COUNT(*)) AS request_count
     FROM token_usage_logs
     ${filterClause}
     GROUP BY bucket, model
     ORDER BY bucket ASC`,
    params
  );

  // Pivot buckets into TimeSeriesPoint array
  const pointsMap = new Map<string, TimeSeriesPoint>();
  for (const row of timeSeriesRows) {
    let point = pointsMap.get(row.bucket);
    if (!point) {
      const label = isHourly
        ? row.bucket.split(' ')[1] || row.bucket
        : new Date(row.bucket).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

      point = {
        date: row.bucket,
        label,
        totalTokens: 0,
        costUsd: 0,
        requests: 0,
      };
      pointsMap.set(row.bucket, point);
    }
    const tTokens = Number(row.total_tokens || 0);
    const cUsd = Number(row.cost_usd || 0);
    const reqs = Number(row.request_count || 0);

    point.totalTokens += tTokens;
    point.costUsd = Number((point.costUsd + cUsd).toFixed(6));
    point.requests += reqs;

    // Model specific property for stacked charts
    const modelKey = row.model.replace(/[^a-zA-Z0-9]/g, '_');
    point[modelKey] = (point[modelKey] || 0) + tTokens;
  }

  const timeSeries = Array.from(pointsMap.values());

  // 5. Recent Logs (last 50)
  const recentLogRows = await query<any>(
    `SELECT
      id,
      created_at,
      provider,
      model,
      feature,
      input_tokens,
      output_tokens,
      total_tokens,
      cost_usd,
      latency_ms,
      status,
      user_email
     FROM token_usage_logs
     ${filterClause}
     ORDER BY created_at DESC
     LIMIT 50`,
    params
  );

  const recentLogs = recentLogRows.map((r) => ({
    id: String(r.id),
    createdAt: new Date(r.created_at).toISOString(),
    provider: r.provider,
    model: r.model,
    feature: r.feature,
    inputTokens: Number(r.input_tokens || 0),
    outputTokens: Number(r.output_tokens || 0),
    totalTokens: Number(r.total_tokens || 0),
    costUsd: Number(Number(r.cost_usd || 0).toFixed(6)),
    latencyMs: r.latency_ms != null ? Number(r.latency_ms) : null,
    status: r.status,
    userEmail: r.user_email,
  }));

  return {
    summary: {
      totalTokens,
      inputTokens,
      outputTokens,
      totalCostUsd: Number(totalCostUsd.toFixed(4)),
      totalCostInr,
      totalRequests,
      topModel,
      topModelTokens,
      topFeature,
      timeframe,
    },
    byModel,
    byFeature,
    timeSeries,
    recentLogs,
  };
}
