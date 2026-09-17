'use client';

import React, { useState, useEffect, useCallback } from 'react';

type Period = '24h' | '7d' | '30d' | 'custom';

const JOB_DISPLAY_NAMES: Record<string, { label: string; group: string }> = {
  bot_leg_scoring:                 { label: 'Bot Chat Evaluation', group: 'Chats' },
  human_leg_scoring:               { label: 'Agent Chat Evaluation', group: 'Chats' },
  compliance_gate_audit:           { label: 'Chat Compliance Audit', group: 'Chats' },
  on_demand_chat_rescore:          { label: 'On-Demand Chat Re-evaluation', group: 'Chats' },
  corrections_apply:               { label: 'Chat Dispute Correction', group: 'Chats' },
  call_diarization_pass1:          { label: 'Call Speaker Diarization', group: 'Calls' },
  call_transcription_pass2:         { label: 'Call Audio Transcription', group: 'Calls' },
  call_gates_audit:                { label: 'Call Compliance Audit', group: 'Calls' },
  call_iqs_scoring:                { label: 'Call Quality Scoring', group: 'Calls' },
  call_disposition_classify:       { label: 'Call Disposition Classifier', group: 'Calls' },
  on_demand_call_score:            { label: 'On-Demand Call Evaluation', group: 'Calls' },
  bulk_call_retranscribe:          { label: 'Bulk Call Retranscription', group: 'Calls' },
  link_test_call_scoring:          { label: 'Test Call Evaluation', group: 'Calls' },
  kb_query_expansion:              { label: 'Knowledge Base Search Helper', group: 'Analytics' },
  analytics_routing_extraction:    { label: 'Analytics Question Router', group: 'Analytics' },
  analytics_insight_synthesizer:   { label: 'Analytics Insights Generator', group: 'Analytics' },
  chat_draft_generator:            { label: 'Customer Response Draft Generator', group: 'Analytics' },
  cron_scorecard_gen:              { label: 'Weekly Performance Report', group: 'Reports' },
};

interface SummaryData {
  total_spend_usd: number;
  total_spend_inr: number;
  total_tokens: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_invocations: number;
}

interface FeatureShare {
  feature_group: string;
  total_tokens: number;
  total_spend_inr: number;
  total_spend_usd: number;
  invocations: number;
}

interface ModelShare {
  model_name: string;
  total_tokens: number;
  total_spend_inr: number;
  invocations: number;
}

interface JobShare {
  job_type: string;
  label: string;
  feature_group: string;
  model_name: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  total_spend_inr: number;
  total_spend_usd: number;
  invocations: number;
  avg_latency_ms: number;
}

interface TrendPoint {
  bucket: string;
  total_tokens: number;
  total_spend_inr: number;
  invocations: number;
}

interface RecentLog {
  id: string;
  job_type: string;
  feature_group: string;
  model_name: string;
  entity_id: string | null;
  user_email: string | null;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  duration_seconds: number;
  latency_ms: number;
  estimated_cost_inr: number;
  estimated_cost_usd: number;
  created_at: string;
}

interface AnalyticsPayload {
  summary: SummaryData;
  featureBifurcation: FeatureShare[];
  jobBifurcation: JobShare[];
  trend: TrendPoint[];
  modelShare: ModelShare[];
  recentLogs: RecentLog[];
  availableModels: string[];
}

const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

const MODEL_COLORS: Record<string, string> = {
  'gemini-3.5-flash': '#10B981',
  'gemini-1.5-flash': '#10B981',
  'pyannote-precision-2': '#2563EB',
  'claude-3-5-sonnet': '#8B5CF6',
  'gemini-1.5-pro': '#F59E0B',
};

const FEATURE_LABELS: Record<string, string> = {
  Chats: 'Quality Scoring (IQS)',
  Calls: 'Call Quality Analysis',
  Reports: 'Reports & Scorecards',
  Analytics: 'Analytics & SQL Agent',
};

function formatModelLabel(name: string): string {
  if (name.includes('gemini-3.5') || name.includes('gemini-1.5-flash')) return 'Gemini 3.5 Flash';
  if (name.includes('pyannote')) return 'Pyannote Precision-2';
  if (name.includes('claude')) return 'Claude 3.5 Sonnet';
  if (name.includes('gemini-1.5-pro') || name.includes('gemini-3.5-pro')) return 'Gemini 1.5 Pro';
  return name;
}

function formatJobLabel(jType: string): string {
  const info = JOB_DISPLAY_NAMES[jType];
  if (info?.label) return info.label;
  return jType
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (l) => l.toUpperCase());
}

function fmtMillions(n: number): string {
  const val = Number(n || 0);
  if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(2)}M`;
  if (val >= 1_000) return `${(val / 1_000).toFixed(0)}k`;
  return `${val}`;
}

export default function TokensClient() {
  const [period, setPeriod] = useState<Period>('7d');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [modelFilter, setModelFilter] = useState<string>('all');
  const [featureFilter, setFeatureFilter] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<AnalyticsPayload | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<string | null>(null);

  // Pagination state for Recent Invocations stream
  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 10;

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const query = new URLSearchParams({
        period,
        model: modelFilter,
        feature: featureFilter,
        _t: String(Date.now()), // Cache buster
      });
      if (period === 'custom' && startDate && endDate) {
        query.append('startDate', startDate);
        query.append('endDate', endDate);
      }
      const res = await fetch(`/api/tokens/analytics?${query.toString()}`);
      if (res.ok) {
        const json = await res.json();
        setData(json);
        setLastRefreshed(new Date().toLocaleTimeString());
        setCurrentPage(1); // Reset to page 1 on refresh/filter change
      }
    } catch (err) {
      console.error('Failed to load token analytics:', err);
    } finally {
      setLoading(false);
    }
  }, [period, modelFilter, featureFilter, startDate, endDate]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const fmtNumber = (n: any) => Number(n ?? 0).toLocaleString('en-IN');
  const fmtCurrencyInr = (n: any) => `₹${Number(n ?? 0).toFixed(2)}`;
  const fmtCurrencyUsd = (n: any) => `$${Number(n ?? 0).toFixed(4)}`;

  // Calculate Doughnut Chart based on Spend Share (INR ₹) so Pyannote is accurately represented
  const modelShareList = data?.modelShare || [];
  const totalModelSpend = modelShareList.reduce((acc, curr) => acc + Number(curr.total_spend_inr || 0), 0) || 1;

  let cumulativeAngle = 0;
  const doughnutSlices = modelShareList.map((m) => {
    const spendVal = Number(m.total_spend_inr || 0);
    const fraction = spendVal / totalModelSpend;
    const startAngle = cumulativeAngle;
    cumulativeAngle += fraction * 360;
    const color = MODEL_COLORS[m.model_name] || '#6B7280';
    return {
      model_name: m.model_name,
      label: formatModelLabel(m.model_name),
      fraction,
      startAngle,
      endAngle: cumulativeAngle,
      color,
      spendVal,
      tokensVal: Number(m.total_tokens || 0),
    };
  });

  // Determine if active view should plot spend (INR ₹) instead of tokens (e.g. for Pyannote audio model or when tokens = 0)
  const isAudioOrSpendView =
    modelFilter.includes('pyannote') ||
    (data?.summary?.total_tokens === 0 && (data?.summary?.total_spend_inr || 0) > 0);

  // Feature Bar Chart max scale calculation dynamically based on actual data
  const featureList = data?.featureBifurcation || [];
  const actualMaxFeature = Math.max(
    ...featureList.map((f) => Number(isAudioOrSpendView ? f.total_spend_inr : f.total_tokens || 0)),
    isAudioOrSpendView ? 10 : 1_000
  );
  const maxFeatureTokens = isAudioOrSpendView ? actualMaxFeature * 1.15 : Math.ceil(actualMaxFeature * 1.15); // Add 15% headroom
  const yTicksBar = [
    maxFeatureTokens,
    maxFeatureTokens * 0.75,
    maxFeatureTokens * 0.5,
    maxFeatureTokens * 0.25,
    0,
  ];

  // Smooth Line Trend Chart calculation dynamically based on actual data
  const trendList = data?.trend || [];
  const actualMaxTrend = Math.max(
    ...trendList.map((t) => Number(isAudioOrSpendView ? t.total_spend_inr : t.total_tokens || 0)),
    isAudioOrSpendView ? 10 : 1_000
  );
  const maxTrendTokens = isAudioOrSpendView ? actualMaxTrend * 1.15 : Math.ceil(actualMaxTrend * 1.15); // Add 15% headroom
  const yTicksTrend = [
    maxTrendTokens,
    maxTrendTokens * 0.75,
    maxTrendTokens * 0.5,
    maxTrendTokens * 0.25,
    0,
  ];

  const chartWidth = 900;
  const chartHeight = 180;
  const paddingX = isAudioOrSpendView ? 75 : 60;
  const paddingY = 20;

  const trendPoints = trendList.map((t, idx) => {
    const x = paddingX + (idx / Math.max(trendList.length - 1, 1)) * (chartWidth - paddingX - 20);
    const val = isAudioOrSpendView ? Number(t.total_spend_inr || 0) : Number(t.total_tokens || 0);
    const y = chartHeight - paddingY - (val / (maxTrendTokens || 1)) * (chartHeight - 2 * paddingY);
    return { x, y, bucket: t.bucket, tokens: t.total_tokens, spend: t.total_spend_inr };
  });

  let dPath = '';
  let fillPath = '';
  if (trendPoints.length > 0) {
    dPath = `M ${trendPoints[0].x} ${trendPoints[0].y}`;
    for (let i = 0; i < trendPoints.length - 1; i++) {
      const p0 = trendPoints[i];
      const p1 = trendPoints[i + 1];
      const cx1 = p0.x + (p1.x - p0.x) * 0.5;
      const cy1 = p0.y;
      const cx2 = p0.x + (p1.x - p0.x) * 0.5;
      const cy2 = p1.y;
      dPath += ` C ${cx1} ${cy1}, ${cx2} ${cy2}, ${p1.x} ${p1.y}`;
    }
    const lastP = trendPoints[trendPoints.length - 1];
    const firstP = trendPoints[0];
    fillPath = `${dPath} L ${lastP.x} ${chartHeight - paddingY} L ${firstP.x} ${chartHeight - paddingY} Z`;
  }

  // Recent Invocations Pagination calculations
  const recentLogsList = data?.recentLogs || [];
  const totalLogsCount = recentLogsList.length;
  const totalPages = Math.max(1, Math.ceil(totalLogsCount / ITEMS_PER_PAGE));
  const currentLogs = recentLogsList.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);

  return (
    <div style={{ minHeight: '100vh', background: 'var(--qa-bg, #F9FAFB)', color: 'var(--qa-text, #111827)', padding: '24px 32px' }}>
      
      {/* ── Top Navigation & Header ────────────────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, letterSpacing: '-0.02em' }}>Token Usage & Cost Intelligence</h1>
            <span style={{ background: '#dcfce7', color: '#15803d', fontSize: 12, fontWeight: 600, padding: '2px 8px', borderRadius: 12 }}>
              Real Data Tracking
            </span>
            {lastRefreshed && (
              <span style={{ fontSize: 11, color: '#6B7280', background: '#F3F4F6', padding: '2px 8px', borderRadius: 10 }}>
                Refreshed at {lastRefreshed}
              </span>
            )}
          </div>
          <p style={{ margin: 0, fontSize: 14, color: 'var(--qa-text-2, #6B7280)' }}>
            Monitor LLM token consumption, compare model spend, and audit job-level execution traffic across Chats, Calls, and Reports.
          </p>
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          
          {/* Model Filter */}
          <select
            value={modelFilter}
            onChange={(e) => setModelFilter(e.target.value)}
            style={{
              padding: '8px 12px',
              borderRadius: 8,
              border: '1px solid var(--qa-border, #E5E7EB)',
              background: '#FFFFFF',
              fontSize: 13,
              color: '#374151',
              cursor: 'pointer',
            }}
          >
            <option value="all">All Models</option>
            {data?.availableModels?.map((m) => (
              <option key={m} value={m}>{formatModelLabel(m)} ({m})</option>
            ))}
          </select>

          {/* Feature Filter */}
          <select
            value={featureFilter}
            onChange={(e) => setFeatureFilter(e.target.value)}
            style={{
              padding: '8px 12px',
              borderRadius: 8,
              border: '1px solid var(--qa-border, #E5E7EB)',
              background: '#FFFFFF',
              fontSize: 13,
              color: '#374151',
              cursor: 'pointer',
            }}
          >
            <option value="all">All Feature Groups</option>
            <option value="Chats">Chats</option>
            <option value="Calls">Calls</option>
            <option value="Analytics">Analytics</option>
            <option value="Reports">Reports</option>
          </select>

          {/* Time Segment Selector */}
          <div style={{ background: '#E5E7EB', padding: 3, borderRadius: 8, display: 'flex', gap: 2, alignItems: 'center' }}>
            {(['24h', '7d', '30d', 'custom'] as Period[]).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                style={{
                  padding: '6px 12px',
                  borderRadius: 6,
                  border: 'none',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                  background: period === p ? '#111827' : 'transparent',
                  color: period === p ? '#FFFFFF' : '#4B5563',
                  transition: 'all 0.15s ease',
                }}
              >
                {p === '24h' ? '24 Hours' : p === '7d' ? '7 Days' : p === '30d' ? '30 Days' : '📅 Custom Range'}
              </button>
            ))}
          </div>

          {/* Custom Date Range Calendar Inputs */}
          {period === 'custom' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#FFFFFF', padding: '4px 8px', borderRadius: 8, border: '1px solid #D1D5DB' }}>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                style={{ padding: '4px 6px', borderRadius: 6, border: '1px solid #E5E7EB', fontSize: 12, color: '#374151' }}
              />
              <span style={{ fontSize: 12, color: '#6B7280', fontWeight: 500 }}>to</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                style={{ padding: '4px 6px', borderRadius: 6, border: '1px solid #E5E7EB', fontSize: 12, color: '#374151' }}
              />
            </div>
          )}

          {/* Active Working Reload Button */}
          <button
            onClick={fetchData}
            disabled={loading}
            title="Refresh analytics data"
            style={{
              height: 38,
              width: 38,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 8,
              border: '1px solid var(--qa-border, #E5E7EB)',
              background: '#FFFFFF',
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.6 : 1,
            }}
          >
            <span style={{ display: 'inline-block', transform: loading ? 'rotate(360deg)' : 'none', transition: 'transform 0.6s linear' }}>
              🔄
            </span>
          </button>
        </div>
      </div>

      {/* ── Summary Headline Cards ────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 24 }}>
        <SummaryCard title="TOTAL ESTIMATED SPEND" main={fmtCurrencyInr(data?.summary?.total_spend_inr ?? 0)} sub="Real-time INR Tracking" />
        <SummaryCard title="TOTAL TOKENS CONSUMED" main={fmtNumber(data?.summary?.total_tokens ?? 0)} sub={`In: ${fmtNumber(data?.summary?.total_input_tokens ?? 0)} | Out: ${fmtNumber(data?.summary?.total_output_tokens ?? 0)}`} />
        <SummaryCard title="TOTAL AI INVOCATIONS" main={fmtNumber(data?.summary?.total_invocations ?? 0)} sub="Across all 18 AI jobs" />
      </div>

      {/* ── Section 1: Top Charts (Model Share Doughnut + Feature Bar Chart) ────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 24 }}>
        
        {/* Card 1: Model Spend Share (Doughnut Chart in ₹ Spend) */}
        <div style={{ background: '#FFFFFF', border: '1px solid var(--qa-border, #E5E7EB)', borderRadius: 12, padding: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
            <h3 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>Model Spend & Usage Share</h3>
            <span style={{ fontSize: 11, background: '#EFF6FF', color: '#1D4ED8', padding: '2px 8px', borderRadius: 4, fontWeight: 600 }}>
              Based on Spend (₹)
            </span>
          </div>
          <p style={{ fontSize: 13, color: '#6B7280', margin: '0 0 20px 0' }}>Proportional spend and processing volume by model</p>

          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 220 }}>
            {/* SVG Doughnut Ring */}
            <div style={{ position: 'relative', width: 150, height: 150, marginBottom: 24 }}>
              <svg viewBox="0 0 100 100" style={{ width: '100%', height: '100%', transform: 'rotate(-90deg)' }}>
                {doughnutSlices.map((slice, i) => {
                  const strokeWidth = 14;
                  const radius = 38;
                  const circumference = 2 * Math.PI * radius;
                  const strokeDasharray = `${Math.max(slice.fraction, 0.02) * circumference} ${circumference}`;
                  const strokeDashoffset = -(slice.startAngle / 360) * circumference;

                  return (
                    <circle
                      key={i}
                      cx="50"
                      cy="50"
                      r={radius}
                      fill="transparent"
                      stroke={slice.color}
                      strokeWidth={strokeWidth}
                      strokeDasharray={strokeDasharray}
                      strokeDashoffset={strokeDashoffset}
                      style={{ transition: 'all 0.3s ease' }}
                    />
                  );
                })}
              </svg>
            </div>

            {/* Model Legend with Spend & Tokens */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, justifyContent: 'center' }}>
              {doughnutSlices.map((slice, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 500, color: '#374151' }}>
                  <div style={{ width: 12, height: 12, borderRadius: 3, background: slice.color }} />
                  <span>
                    <strong>{slice.label}</strong>: {fmtCurrencyInr(slice.spendVal)} ({Math.round(slice.fraction * 100)}%)
                    {slice.model_name.includes('pyannote') ? ' • Audio Diarization' : ` • ${fmtNumber(slice.tokensVal)} tokens`}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Card 2: Consumption by Feature (Vertical Bar Chart) */}
        <div style={{ background: '#FFFFFF', border: '1px solid var(--qa-border, #E5E7EB)', borderRadius: 12, padding: 20 }}>
          <h3 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 4px 0' }}>
            {isAudioOrSpendView ? 'Spend & Consumption by Feature' : 'Consumption by Feature'}
          </h3>
          <p style={{ fontSize: 13, color: '#6B7280', margin: '0 0 20px 0' }}>
            {isAudioOrSpendView
              ? 'Spend (₹ INR) incurred across Call Diarization & Feature Groups'
              : 'Tokens utilized by Quality Scoring, Chat, Call Analysis, etc.'}
          </p>

          <div style={{ display: 'flex', height: 210, position: 'relative' }}>
            {/* Y-Axis Labels */}
            <div style={{ width: isAudioOrSpendView ? 75 : 65, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', paddingRight: 8, fontSize: 11, color: '#9CA3AF', fontFamily: MONO, textAlign: 'right' }}>
              {yTicksBar.map((val, idx) => (
                <span key={idx}>{isAudioOrSpendView ? fmtCurrencyInr(val) : fmtMillions(val)}</span>
              ))}
            </div>

            {/* Bars & Gridlines Container */}
            <div style={{ flex: 1, height: 170, borderLeft: '1px solid #E5E7EB', borderBottom: '1px solid #E5E7EB', position: 'relative', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-around', padding: '0 16px' }}>
              {/* Gridlines */}
              <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', pointerEvents: 'none' }}>
                {yTicksBar.map((_, idx) => (
                  <div key={idx} style={{ width: '100%', height: 1, borderTop: '1px dashed #F3F4F6' }} />
                ))}
              </div>

              {/* Render Bars */}
              {featureList.map((f, idx) => {
                const val = isAudioOrSpendView ? Number(f.total_spend_inr || 0) : Number(f.total_tokens || 0);
                const heightPx = Math.max(12, Math.round((val / (maxFeatureTokens || 1)) * 150));
                const label = FEATURE_LABELS[f.feature_group] || f.feature_group;
                return (
                  <div key={idx} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 65, zIndex: 1, position: 'relative' }}>
                    <span style={{ fontSize: 9, color: '#059669', fontWeight: 600, marginBottom: 4, fontFamily: MONO }}>
                      {isAudioOrSpendView ? fmtCurrencyInr(f.total_spend_inr) : fmtMillions(f.total_tokens)}
                    </span>
                    <div
                      style={{
                        width: '100%',
                        height: heightPx,
                        background: '#10B981',
                        borderRadius: '4px 4px 0 0',
                        transition: 'height 0.4s ease',
                      }}
                      title={isAudioOrSpendView ? `${label}: ${fmtCurrencyInr(f.total_spend_inr)} (${f.invocations} invocations)` : `${label}: ${fmtNumber(f.total_tokens)} tokens (${fmtCurrencyInr(f.total_spend_inr)})`}
                    />
                    <span style={{ fontSize: 10, color: '#4B5563', marginTop: 6, textAlign: 'center', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden', maxWidth: 85, transform: 'rotate(-12deg)', transformOrigin: 'top left' }}>
                      {label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

      </div>

      {/* ── Section 2: Token Consumption Trend (Smooth Curved Area Line Chart) ───── */}
      <div style={{ background: '#FFFFFF', border: '1px solid var(--qa-border, #E5E7EB)', borderRadius: 12, padding: 20, marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>
              {isAudioOrSpendView ? 'Spend & Diarization Trend' : 'Token Consumption Trend'}
            </h3>
            <p style={{ fontSize: 13, color: '#6B7280', margin: '4px 0 0 0' }}>
              {isAudioOrSpendView ? 'Total spend (₹ INR) incurred over time' : 'Total volume of tokens consumed over time'}
            </p>
          </div>
          <span style={{ fontSize: 12, fontWeight: 600, color: '#4B5563', background: '#F3F4F6', padding: '4px 10px', borderRadius: 6 }}>
            Timeframe: {period.toUpperCase()}
          </span>
        </div>

        <div style={{ height: 200, position: 'relative' }}>
          <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} style={{ width: '100%', height: '100%', overflow: 'visible' }}>
            <defs>
              <linearGradient id="trendGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#10B981" stopOpacity="0.25" />
                <stop offset="100%" stopColor="#10B981" stopOpacity="0.0" />
              </linearGradient>
            </defs>

            {/* Gridlines & Y-Axis Labels */}
            {yTicksTrend.map((val, idx) => {
              const yPos = paddingY + (idx / 4) * (chartHeight - 2 * paddingY);
              return (
                <g key={idx}>
                  <line x1={paddingX} y1={yPos} x2={chartWidth - 20} y2={yPos} stroke="#F3F4F6" strokeDasharray="3 3" />
                  <text x={paddingX - 10} y={yPos + 4} textAnchor="end" fontSize="10" fill="#9CA3AF" fontFamily={MONO}>
                    {isAudioOrSpendView ? fmtCurrencyInr(val) : fmtMillions(val)}
                  </text>
                </g>
              );
            })}

            {/* Gradient Fill Area */}
            {fillPath && <path d={fillPath} fill="url(#trendGradient)" />}

            {/* Smooth Line Path */}
            {dPath && <path d={dPath} fill="none" stroke="#10B981" strokeWidth="2.5" strokeLinecap="round" />}

            {/* X-Axis Labels */}
            {trendPoints.map((pt, idx) => {
              if (idx % Math.ceil(trendPoints.length / 8) !== 0 && idx !== trendPoints.length - 1) return null;
              const dateStr = pt.bucket ? new Date(pt.bucket).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
              return (
                <text key={idx} x={pt.x} y={chartHeight - 2} textAnchor="middle" fontSize="10" fill="#9CA3AF">
                  {dateStr}
                </text>
              );
            })}
          </svg>
        </div>
      </div>

      {/* ── Section 3: Granular 18-Job Spend & Token Bifurcation Table ──────────── */}
      <div style={{ background: '#FFFFFF', border: '1px solid var(--qa-border, #E5E7EB)', borderRadius: 12, padding: 20, marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>Granular Spend Bifurcation by AI Job</h3>
            <p style={{ fontSize: 13, color: '#6B7280', margin: '4px 0 0 0' }}>Detailed breakdown of token consumption and cost across all 18 AI execution points</p>
          </div>
          <span style={{ fontSize: 12, fontWeight: 600, color: '#4B5563', background: '#F3F4F6', padding: '4px 10px', borderRadius: 6 }}>
            Showing {data?.jobBifurcation?.length || 0} AI jobs
          </span>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#F9FAFB', borderBottom: '1px solid #E5E7EB', textTransform: 'uppercase', fontSize: 11, color: '#6B7280', letterSpacing: '0.05em' }}>
                <th style={{ padding: '10px 12px', textAlign: 'left' }}>Job Name</th>
                <th style={{ padding: '10px 12px', textAlign: 'left' }}>Feature Group</th>
                <th style={{ padding: '10px 12px', textAlign: 'left' }}>Model</th>
                <th style={{ padding: '10px 12px', textAlign: 'right' }}>Run Count</th>
                <th style={{ padding: '10px 12px', textAlign: 'right' }}>Input Tokens</th>
                <th style={{ padding: '10px 12px', textAlign: 'right' }}>Output Tokens</th>
                <th style={{ padding: '10px 12px', textAlign: 'right' }}>Total Tokens / Audio</th>
                <th style={{ padding: '10px 12px', textAlign: 'right' }}>Spend (₹ INR)</th>
              </tr>
            </thead>
            <tbody>
              {data?.jobBifurcation?.map((j, idx) => (
                <tr key={idx} style={{ borderBottom: '1px solid #F3F4F6' }}>
                  <td style={{ padding: '12px' }}>
                    <div style={{ fontWeight: 600, color: '#111827' }}>{j.label}</div>
                  </td>
                  <td style={{ padding: '12px' }}>
                    <span style={{
                      padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                      background: j.feature_group === 'Chats' ? '#EFF6FF' : j.feature_group === 'Calls' ? '#ECFDF5' : j.feature_group === 'Analytics' ? '#FFFBEB' : '#F5F3FF',
                      color: j.feature_group === 'Chats' ? '#1D4ED8' : j.feature_group === 'Calls' ? '#047857' : j.feature_group === 'Analytics' ? '#B45309' : '#6D28D9'
                    }}>
                      {j.feature_group}
                    </span>
                  </td>
                  <td style={{ padding: '12px', fontFamily: MONO, fontSize: 12, color: '#374151' }}>{j.model_name}</td>
                  <td style={{ padding: '12px', textAlign: 'right', fontWeight: 600 }}>{fmtNumber(j.invocations)}</td>
                  <td style={{ padding: '12px', textAlign: 'right', fontFamily: MONO }}>
                    {j.model_name.includes('pyannote') ? '—' : fmtNumber(j.input_tokens)}
                  </td>
                  <td style={{ padding: '12px', textAlign: 'right', fontFamily: MONO }}>
                    {j.model_name.includes('pyannote') ? '—' : fmtNumber(j.output_tokens)}
                  </td>
                  <td style={{ padding: '12px', textAlign: 'right', fontFamily: MONO, fontWeight: 600 }}>
                    {j.model_name.includes('pyannote') ? '—' : fmtNumber(j.total_tokens)}
                  </td>
                  <td style={{ padding: '12px', textAlign: 'right', fontWeight: 700, color: '#059669' }}>{fmtCurrencyInr(j.total_spend_inr)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Section 4: Paginated Recent AI Requests Stream ──────────────────────── */}
      <div style={{ background: '#FFFFFF', border: '1px solid var(--qa-border, #E5E7EB)', borderRadius: 12, padding: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>Recent AI Invocations Stream</h3>
            <p style={{ fontSize: 13, color: '#6B7280', margin: '4px 0 0 0' }}>Audit log of recent AI model requests across all portal endpoints</p>
          </div>
          <span style={{ fontSize: 12, color: '#6B7280' }}>
            Showing {Math.min((currentPage - 1) * ITEMS_PER_PAGE + 1, totalLogsCount)} – {Math.min(currentPage * ITEMS_PER_PAGE, totalLogsCount)} of {totalLogsCount} invocations
          </span>
        </div>

        <div style={{ overflowX: 'auto', marginBottom: 16 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: '#F9FAFB', borderBottom: '1px solid #E5E7EB', textTransform: 'uppercase', fontSize: 10, color: '#6B7280', letterSpacing: '0.05em' }}>
                <th style={{ padding: '10px', textAlign: 'left' }}>Time</th>
                <th style={{ padding: '10px', textAlign: 'left' }}>Job Name</th>
                <th style={{ padding: '10px', textAlign: 'left' }}>Model</th>
                <th style={{ padding: '10px', textAlign: 'left' }}>Entity ID</th>
                <th style={{ padding: '10px', textAlign: 'right' }}>Total Tokens / Audio</th>
                <th style={{ padding: '10px', textAlign: 'right' }}>Latency</th>
                <th style={{ padding: '8px 10px', textAlign: 'right' }}>Spend (₹)</th>
              </tr>
            </thead>
            <tbody>
              {currentLogs.map((log) => (
                <tr key={log.id} style={{ borderBottom: '1px solid #F3F4F6' }}>
                  <td style={{ padding: '10px', color: '#6B7280', fontFamily: MONO }}>{new Date(log.created_at).toLocaleTimeString()}</td>
                  <td style={{ padding: '10px', fontWeight: 600, color: '#111827' }}>{formatJobLabel(log.job_type)}</td>
                  <td style={{ padding: '10px', color: '#374151', fontFamily: MONO }}>{log.model_name}</td>
                  <td style={{ padding: '10px', color: '#6B7280', fontFamily: MONO }}>{log.entity_id || '—'}</td>
                  <td style={{ padding: '10px', textAlign: 'right', fontFamily: MONO }}>
                    {log.model_name.includes('pyannote') ? '—' : fmtNumber(log.total_tokens)}
                  </td>
                  <td style={{ padding: '10px', textAlign: 'right', fontFamily: MONO, color: '#6B7280' }}>
                    {log.latency_ms ? `${(log.latency_ms / 1000).toFixed(1)}s` : '—'}
                  </td>
                  <td style={{ padding: '10px', textAlign: 'right', fontWeight: 600, color: '#059669' }}>{fmtCurrencyInr(log.estimated_cost_inr)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination Controls */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 12, borderTop: '1px solid #F3F4F6' }}>
          <button
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            disabled={currentPage === 1}
            style={{
              padding: '6px 14px',
              borderRadius: 6,
              border: '1px solid #D1D5DB',
              background: currentPage === 1 ? '#F3F4F6' : '#FFFFFF',
              color: currentPage === 1 ? '#9CA3AF' : '#374151',
              fontSize: 12,
              fontWeight: 600,
              cursor: currentPage === 1 ? 'not-allowed' : 'pointer',
            }}
          >
            ← Previous
          </button>

          {/* Page Indicators */}
          <div style={{ display: 'flex', gap: 6 }}>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
              <button
                key={p}
                onClick={() => setCurrentPage(p)}
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 6,
                  border: p === currentPage ? 'none' : '1px solid #E5E7EB',
                  background: p === currentPage ? '#111827' : '#FFFFFF',
                  color: p === currentPage ? '#FFFFFF' : '#4B5563',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {p}
              </button>
            ))}
          </div>

          <button
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            disabled={currentPage === totalPages}
            style={{
              padding: '6px 14px',
              borderRadius: 6,
              border: '1px solid #D1D5DB',
              background: currentPage === totalPages ? '#F3F4F6' : '#FFFFFF',
              color: currentPage === totalPages ? '#9CA3AF' : '#374151',
              fontSize: 12,
              fontWeight: 600,
              cursor: currentPage === totalPages ? 'not-allowed' : 'pointer',
            }}
          >
            Next →
          </button>
        </div>
      </div>

    </div>
  );
}

function SummaryCard({ title, main, sub, badge }: { title: string; main: string; sub: string; badge?: string }) {
  return (
    <div style={{ background: '#FFFFFF', border: '1px solid var(--qa-border, #E5E7EB)', borderRadius: 12, padding: '16px 20px', position: 'relative' }}>
      {badge && (
        <span style={{ position: 'absolute', top: 16, right: 16, background: '#EFF6FF', color: '#1D4ED8', fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4 }}>
          {badge}
        </span>
      )}
      <div style={{ fontSize: 11, fontWeight: 600, color: '#6B7280', letterSpacing: '0.05em', marginBottom: 8 }}>{title}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: '#111827', letterSpacing: '-0.02em', marginBottom: 4 }}>{main}</div>
      <div style={{ fontSize: 12, color: '#6B7280' }}>{sub}</div>
    </div>
  );
}
