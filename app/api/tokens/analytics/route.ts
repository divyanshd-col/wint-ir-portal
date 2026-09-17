import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-guard';
import { query } from '@/lib/cx/db';
import { JOB_DISPLAY_NAMES, type JobType } from '@/lib/token-tracker';

export async function GET(req: NextRequest) {
  const { response } = await requireRole(['admin', 'quality', 'tl']);
  if (response) return response;

  const url = new URL(req.url);
  const period = url.searchParams.get('period') || '7d';
  const modelFilter = url.searchParams.get('model') || 'all';
  const featureFilter = url.searchParams.get('feature') || 'all';
  const startDate = url.searchParams.get('startDate');
  const endDate = url.searchParams.get('endDate');

  const conditions: string[] = [];
  const params: any[] = [];

  if (period === '24h') {
    conditions.push("created_at >= NOW() - INTERVAL '24 hours'");
  } else if (period === '7d') {
    conditions.push("created_at >= NOW() - INTERVAL '7 days'");
  } else if (period === '30d') {
    conditions.push("created_at >= NOW() - INTERVAL '30 days'");
  } else if (period === 'custom' && startDate && endDate) {
    params.push(`${startDate} 00:00:00`);
    conditions.push(`created_at >= $${params.length}::timestamp`);
    params.push(`${endDate} 23:59:59`);
    conditions.push(`created_at <= $${params.length}::timestamp`);
  } else {
    // Default or 'all'
    conditions.push('1=1');
  }

  if (modelFilter !== 'all') {
    params.push(modelFilter);
    conditions.push(`model_name = $${params.length}`);
  }

  if (featureFilter !== 'all') {
    params.push(featureFilter);
    conditions.push(`feature_group = $${params.length}`);
  }

  const whereClause = conditions.join(' AND ');

  try {
    // 1. Summary Totals
    const summaryRows = await query<{
      total_spend_usd: number | null;
      total_spend_inr: number | null;
      total_tokens: number | null;
      total_input_tokens: number | null;
      total_output_tokens: number | null;
      total_invocations: number | null;
    }>(
      `SELECT
        COALESCE(SUM(estimated_cost_usd), 0)::float AS total_spend_usd,
        COALESCE(SUM(estimated_cost_inr), 0)::float AS total_spend_inr,
        COALESCE(SUM(total_tokens), 0)::bigint AS total_tokens,
        COALESCE(SUM(input_tokens), 0)::bigint AS total_input_tokens,
        COALESCE(SUM(output_tokens), 0)::bigint AS total_output_tokens,
        COUNT(*)::int AS total_invocations
       FROM llm_token_logs
       WHERE ${whereClause}`,
      params
    );

    const rawSummary = summaryRows[0] || {};
    const formattedSummary = {
      total_spend_usd: Number(rawSummary.total_spend_usd ?? 0),
      total_spend_inr: Number(rawSummary.total_spend_inr ?? 0),
      total_tokens: Number(rawSummary.total_tokens ?? 0),
      total_input_tokens: Number(rawSummary.total_input_tokens ?? 0),
      total_output_tokens: Number(rawSummary.total_output_tokens ?? 0),
      total_invocations: Number(rawSummary.total_invocations ?? 0),
    };

    // 2. Feature Group Share (Chats, Calls, Analytics, Reports, Admin Tools)
    const featureRows = await query<{
      feature_group: string;
      total_tokens: number;
      total_spend_inr: number;
      total_spend_usd: number;
      invocations: number;
    }>(
      `SELECT
        feature_group,
        COALESCE(SUM(total_tokens), 0)::bigint AS total_tokens,
        COALESCE(SUM(estimated_cost_inr), 0)::float AS total_spend_inr,
        COALESCE(SUM(estimated_cost_usd), 0)::float AS total_spend_usd,
        COUNT(*)::int AS invocations
       FROM llm_token_logs
       WHERE ${whereClause}
       GROUP BY feature_group
       ORDER BY total_tokens DESC`,
      params
    );

    const formattedFeatureRows = featureRows.map((r) => ({
      ...r,
      total_tokens: Number(r.total_tokens ?? 0),
      total_spend_inr: Number(r.total_spend_inr ?? 0),
      total_spend_usd: Number(r.total_spend_usd ?? 0),
      invocations: Number(r.invocations ?? 0),
    }));

    // 3. Job-wise Bifurcation (All 18 Jobs)
    const jobRows = await query<{
      job_type: string;
      feature_group: string;
      model_name: string;
      input_tokens: number;
      output_tokens: number;
      total_tokens: number;
      total_spend_inr: number;
      total_spend_usd: number;
      invocations: number;
      avg_latency_ms: number;
    }>(
      `SELECT
        job_type,
        feature_group,
        model_name,
        COALESCE(SUM(input_tokens), 0)::bigint AS input_tokens,
        COALESCE(SUM(output_tokens), 0)::bigint AS output_tokens,
        COALESCE(SUM(total_tokens), 0)::bigint AS total_tokens,
        COALESCE(SUM(estimated_cost_inr), 0)::float AS total_spend_inr,
        COALESCE(SUM(estimated_cost_usd), 0)::float AS total_spend_usd,
        COUNT(*)::int AS invocations,
        ROUND(AVG(latency_ms))::int AS avg_latency_ms
       FROM llm_token_logs
       WHERE ${whereClause}
       GROUP BY job_type, feature_group, model_name
       ORDER BY total_spend_inr DESC`,
      params
    );

    const existingJobTypes = new Set(jobRows.map((r) => r.job_type));
    const jobsFormatted = jobRows.map((r) => {
      const jobInfo = JOB_DISPLAY_NAMES[r.job_type as JobType];
      return {
        ...r,
        input_tokens: Number(r.input_tokens ?? 0),
        output_tokens: Number(r.output_tokens ?? 0),
        total_tokens: Number(r.total_tokens ?? 0),
        total_spend_inr: Number(r.total_spend_inr ?? 0),
        total_spend_usd: Number(r.total_spend_usd ?? 0),
        invocations: Number(r.invocations ?? 0),
        avg_latency_ms: Number(r.avg_latency_ms ?? 0),
        label: jobInfo ? jobInfo.label : r.job_type,
      };
    });

    // Fill in any of the 18 AI jobs that had 0 runs in this filter period
    (Object.keys(JOB_DISPLAY_NAMES) as JobType[]).forEach((jType) => {
      if (!existingJobTypes.has(jType)) {
        const info = JOB_DISPLAY_NAMES[jType];
        if (featureFilter !== 'all' && info.group !== featureFilter) return;

        let defaultModel = 'gemini-3.5-flash';
        if (jType.includes('pyannote') || jType.includes('diarization')) defaultModel = 'pyannote-precision-2';
        else if (jType.includes('sonnet') || jType.includes('synthesizer') || jType.includes('scorecard')) defaultModel = 'claude-3-5-sonnet';

        jobsFormatted.push({
          job_type: jType,
          feature_group: info.group,
          model_name: defaultModel,
          input_tokens: 0,
          output_tokens: 0,
          total_tokens: 0,
          total_spend_inr: 0,
          total_spend_usd: 0,
          invocations: 0,
          avg_latency_ms: 0,
          label: info.label,
        });
      }
    });

    // 4. Token Consumption Trend over time
    const truncUnit = period === '24h' ? 'hour' : 'day';
    const trendRows = await query<{
      bucket: string;
      total_tokens: number;
      total_duration_seconds: number;
      total_spend_inr: number;
      invocations: number;
    }>(
      `SELECT
        date_trunc('${truncUnit}', created_at)::text AS bucket,
        COALESCE(SUM(total_tokens), 0)::bigint AS total_tokens,
        COALESCE(SUM(duration_seconds), 0)::bigint AS total_duration_seconds,
        COALESCE(SUM(estimated_cost_inr), 0)::float AS total_spend_inr,
        COUNT(*)::int AS invocations
       FROM llm_token_logs
       WHERE ${whereClause}
       GROUP BY 1
       ORDER BY 1 ASC`,
      params
    );

    const formattedTrend = trendRows.map((r) => ({
      ...r,
      total_tokens: Number(r.total_tokens ?? 0),
      total_duration_seconds: Number(r.total_duration_seconds ?? 0),
      total_spend_inr: Number(r.total_spend_inr ?? 0),
      invocations: Number(r.invocations ?? 0),
    }));

    // 5. Recent Invocation Stream (50 logs)
    const recentRows = await query<any>(
      `SELECT
        id, job_type, feature_group, model_name, entity_id, user_email,
        input_tokens, output_tokens, total_tokens, duration_seconds, latency_ms,
        estimated_cost_inr, estimated_cost_usd, created_at
       FROM llm_token_logs
       WHERE ${whereClause}
       ORDER BY created_at DESC
       LIMIT 50`,
      params
    );

    const formattedRecentLogs = recentRows.map((r: any) => ({
      ...r,
      input_tokens: Number(r.input_tokens ?? 0),
      output_tokens: Number(r.output_tokens ?? 0),
      total_tokens: Number(r.total_tokens ?? 0),
      estimated_cost_inr: Number(r.estimated_cost_inr ?? 0),
      estimated_cost_usd: Number(r.estimated_cost_usd ?? 0),
      duration_seconds: r.duration_seconds != null ? Number(r.duration_seconds) : null,
      latency_ms: r.latency_ms != null ? Number(r.latency_ms) : null,
    }));

    // 6. Model Consumption Share (Doughnut breakdown)
    const modelShareRows = await query<{
      model_name: string;
      total_tokens: number;
      total_spend_inr: number;
      invocations: number;
    }>(
      `SELECT
        model_name,
        COALESCE(SUM(total_tokens), 0)::bigint AS total_tokens,
        COALESCE(SUM(estimated_cost_inr), 0)::float AS total_spend_inr,
        COUNT(*)::int AS invocations
       FROM llm_token_logs
       WHERE ${whereClause}
       GROUP BY model_name
       ORDER BY total_tokens DESC`,
      params
    );

    const formattedModelShare = modelShareRows.map((r) => ({
      ...r,
      total_tokens: Number(r.total_tokens ?? 0),
      total_spend_inr: Number(r.total_spend_inr ?? 0),
      invocations: Number(r.invocations ?? 0),
    }));

    // 7. Available Models Filter Options
    const availableModels = await query<{ model_name: string }>(
      `SELECT DISTINCT model_name FROM llm_token_logs ORDER BY model_name`
    );

    return NextResponse.json({
      summary: formattedSummary,
      featureBifurcation: formattedFeatureRows,
      jobBifurcation: jobsFormatted,
      trend: formattedTrend,
      modelShare: formattedModelShare,
      recentLogs: formattedRecentLogs,
      availableModels: availableModels.map((m) => m.model_name),
    });
  } catch (err: any) {
    console.error('[tokens-analytics] Error fetching analytics:', err.message);
    return NextResponse.json({ error: 'Database error', detail: err.message }, { status: 500 });
  }
}
