'use client';

import { useState, useEffect, useTransition } from 'react';
import PageNav from '@/components/PageNav';
import {
  formatTokenCount,
  formatUsd,
  formatInr,
} from '@/lib/tokens/pricing';
import type { TokenMetricsResponse, ModelUsageMetric, FeatureUsageMetric, TimeSeriesPoint } from '@/lib/tokens/tracker';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from 'recharts';

interface Props {
  username: string;
  role?: string;
  isAdmin: boolean;
  flags?: { callAnalysis?: boolean; cxDashboard?: boolean };
}

const COLORS = ['#2d9e4f', '#3b82f6', '#8b5cf6', '#f59e0b', '#ec4899', '#06b6d4', '#10b981', '#6366f1'];

export default function TokenUsageClient({ username, role, isAdmin, flags }: Props) {
  const [timeframe, setTimeframe] = useState<'24h' | '7d' | '30d' | 'all'>('30d');
  const [modelFilter, setModelFilter] = useState<string>('all');
  const [featureFilter, setFeatureFilter] = useState<string>('all');
  const [data, setData] = useState<TokenMetricsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const fetchMetrics = async (tf = timeframe, m = modelFilter, f = featureFilter) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ timeframe: tf });
      if (m && m !== 'all') params.set('model', m);
      if (f && f !== 'all') params.set('feature', f);

      const res = await fetch(`/api/admin/token-usage?${params.toString()}`);
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `HTTP ${res.status}`);
      }
      const json: TokenMetricsResponse = await res.json();
      startTransition(() => {
        setData(json);
      });
    } catch (err: any) {
      setError(err?.message || 'Failed to load token usage metrics');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMetrics(timeframe, modelFilter, featureFilter);
  }, [timeframe, modelFilter, featureFilter]);

  // Pie chart data for model share
  const pieData = data?.byModel.map((m) => ({
    name: m.displayName,
    value: m.totalTokens,
    cost: m.costUsd,
    share: m.sharePercent,
  })) || [];

  // Feature bar chart data
  const featureBarData = data?.byFeature.map((f) => ({
    name: f.displayName,
    tokens: f.totalTokens,
    cost: f.costUsd,
    requests: f.requestCount,
  })) || [];

  return (
    <div className="flex h-screen bg-[#f5f3ee] text-gray-900 font-sans antialiased overflow-hidden">
      <PageNav username={username} role={role} isAdmin={isAdmin} flags={flags} />

      <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
        {/* Header */}
        <header className="bg-white border-b border-gray-200 px-8 py-5 shrink-0 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 sticky top-0 z-10 shadow-xs">
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-xl font-bold text-gray-900 tracking-tight">Token Usage &amp; Cost Intelligence</h1>
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200">
                Admin
              </span>
            </div>
            <p className="text-xs text-gray-500 mt-0.5">
              Monitor LLM token consumption, compare model spend, and audit real-time request traffic
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
            {/* Model Filter Dropdown */}
            <select
              value={modelFilter}
              onChange={(e) => setModelFilter(e.target.value)}
              className="bg-gray-100 hover:bg-gray-200/70 border border-gray-200 text-xs font-semibold rounded-xl px-3 py-2 text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#2d9e4f]/30 transition"
            >
              <option value="all">All Models</option>
              {data?.byModel.map((m) => (
                <option key={m.model} value={m.model}>
                  {m.displayName}
                </option>
              ))}
            </select>

            {/* Timeframe selector pills */}
            <div className="flex rounded-xl bg-gray-100 p-1 border border-gray-200 text-xs font-semibold">
              {(
                [
                  { id: '24h', label: '24 Hours' },
                  { id: '7d', label: '7 Days' },
                  { id: '30d', label: '30 Days' },
                  { id: 'all', label: 'All Time' },
                ] as const
              ).map((tf) => (
                <button
                  key={tf.id}
                  onClick={() => setTimeframe(tf.id)}
                  className={`px-3 py-1.5 rounded-lg transition-all ${
                    timeframe === tf.id
                      ? 'bg-white text-gray-900 shadow-xs font-bold'
                      : 'text-gray-500 hover:text-gray-900'
                  }`}
                >
                  {tf.label}
                </button>
              ))}
            </div>

            {/* Refresh Button */}
            <button
              onClick={() => fetchMetrics(timeframe, modelFilter, featureFilter)}
              disabled={loading}
              title="Refresh metrics"
              className="p-2 rounded-xl bg-white border border-gray-200 hover:border-gray-300 text-gray-600 hover:text-gray-900 shadow-xs transition disabled:opacity-50"
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                className={loading ? 'animate-spin' : ''}
              >
                <path d="M14 8A6 6 0 1 1 8 2c2 0 3.8.9 5 2.4V2M13 5h-4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </header>

        {/* Content Body */}
        <main className="p-8 space-y-8 max-w-7xl w-full mx-auto">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm flex items-center justify-between">
              <span>{error}</span>
              <button onClick={() => fetchMetrics()} className="text-xs font-semibold underline hover:text-red-900">
                Retry
              </button>
            </div>
          )}

          {/* Top banner highlighting the most consuming model */}
          {data?.summary && data.summary.topModel && data.summary.totalTokens > 0 && (
            <div className="bg-gradient-to-r from-emerald-500/10 via-emerald-500/5 to-transparent border border-emerald-200/80 rounded-2xl p-5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 shadow-xs">
              <div className="flex items-center gap-3.5">
                <div className="w-10 h-10 rounded-xl bg-[#2d9e4f] flex items-center justify-center text-white shrink-0 shadow-sm">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                  </svg>
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-emerald-700">
                      Highest Token Consuming Model
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-medium">
                      {(data.byModel[0]?.sharePercent ?? 0)}% of total
                    </span>
                  </div>
                  <p className="text-base font-bold text-gray-900 mt-0.5">
                    {data.summary.topModel}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-6 text-sm">
                <div>
                  <span className="text-xs text-gray-500 block">Total Tokens</span>
                  <span className="font-bold text-gray-900">{formatTokenCount(data.summary.topModelTokens)}</span>
                </div>
                <div>
                  <span className="text-xs text-gray-500 block">Estimated Cost</span>
                  <span className="font-bold text-emerald-700">{formatUsd(data.byModel[0]?.costUsd || 0)}</span>
                  <span className="text-xs text-gray-500 block">{formatInr(data.byModel[0]?.costUsd || 0)}</span>
                </div>
                <div>
                  <span className="text-xs text-gray-500 block">Total Requests</span>
                  <span className="font-bold text-gray-900">{(data.byModel[0]?.requestCount || 0).toLocaleString()}</span>
                </div>
              </div>
            </div>
          )}

          {/* 4 Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {/* Card 1: Total Token Consumption */}
            <div className="bg-white rounded-2xl border border-gray-200/80 p-5 shadow-xs flex flex-col justify-between">
              <div>
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Total Token Consumption</span>
                <p className="text-2xl font-black text-gray-900 mt-1">
                  {formatTokenCount(data?.summary.totalTokens || 0)}
                </p>
              </div>
              <div className="mt-4 pt-3 border-t border-gray-100 flex items-center justify-between text-xs text-gray-500">
                <span>In: <strong className="text-gray-800 font-semibold">{formatTokenCount(data?.summary.inputTokens || 0)}</strong></span>
                <span>•</span>
                <span>Out: <strong className="text-gray-800 font-semibold">{formatTokenCount(data?.summary.outputTokens || 0)}</strong></span>
              </div>
            </div>

            {/* Card 2: Estimated Total Cost */}
            <div className="bg-white rounded-2xl border border-gray-200/80 p-5 shadow-xs flex flex-col justify-between">
              <div>
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Estimated Total Cost</span>
                <p className="text-2xl font-black text-emerald-700 mt-1">
                  {formatUsd(data?.summary.totalCostUsd || 0)}
                </p>
              </div>
              <div className="mt-4 pt-3 border-t border-gray-100 flex items-center justify-between text-xs text-gray-500">
                <span>INR: <strong className="text-gray-800 font-semibold">{formatInr(data?.summary.totalCostUsd || 0)}</strong></span>
                <span className="text-[11px] text-gray-400">@ ~₹86.5/$</span>
              </div>
            </div>

            {/* Card 3: Total Requests */}
            <div className="bg-white rounded-2xl border border-gray-200/80 p-5 shadow-xs flex flex-col justify-between">
              <div>
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Total LLM Calls</span>
                <p className="text-2xl font-black text-gray-900 mt-1">
                  {(data?.summary.totalRequests || 0).toLocaleString()}
                </p>
              </div>
              <div className="mt-4 pt-3 border-t border-gray-100 flex items-center justify-between text-xs text-gray-500">
                <span>Avg / Call: <strong className="text-gray-800 font-semibold">
                  {data?.summary.totalRequests ? Math.round(data.summary.totalTokens / data.summary.totalRequests).toLocaleString() : '0'} tok
                </strong></span>
              </div>
            </div>

            {/* Card 4: Top Feature */}
            <div className="bg-white rounded-2xl border border-gray-200/80 p-5 shadow-xs flex flex-col justify-between">
              <div>
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Primary Workload</span>
                <p className="text-xl font-bold text-gray-900 mt-1 truncate" title={data?.summary.topFeature}>
                  {data?.summary.topFeature || '—'}
                </p>
              </div>
              <div className="mt-4 pt-3 border-t border-gray-100 flex items-center justify-between text-xs text-gray-500">
                <span>{data?.byFeature.length || 0} active features</span>
                <span className="text-emerald-600 font-semibold">Live logged</span>
              </div>
            </div>
          </div>

          {/* Model Breakdown Table (Primary Requirement) */}
          <div className="bg-white rounded-2xl border border-gray-200/80 shadow-xs overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div>
                <h2 className="text-base font-bold text-gray-900">Model Consumption &amp; Cost Breakdown</h2>
                <p className="text-xs text-gray-500">
                  Detailed comparison across input tokens, output tokens, total tokens, and computed cost
                </p>
              </div>
              <div className="text-xs text-gray-400 font-medium">
                Sorted by consumption (descending)
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-gray-50/70 border-b border-gray-100 text-[11px] font-bold text-gray-500 uppercase tracking-wider">
                    <th className="px-6 py-3">Model</th>
                    <th className="px-4 py-3 text-right">Input Tokens</th>
                    <th className="px-4 py-3 text-right">Output Tokens</th>
                    <th className="px-4 py-3 text-right">Total Tokens</th>
                    <th className="px-6 py-3">Token Share</th>
                    <th className="px-4 py-3 text-right">Estimated Cost ($ / ₹)</th>
                    <th className="px-4 py-3 text-right">Calls</th>
                    <th className="px-6 py-3 text-right">Avg / Call</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 text-sm">
                  {(!data?.byModel || data.byModel.length === 0) ? (
                    <tr>
                      <td colSpan={8} className="px-6 py-8 text-center text-gray-400 text-xs">
                        {loading ? 'Loading model metrics…' : 'No token usage recorded for this timeframe.'}
                      </td>
                    </tr>
                  ) : (
                    data.byModel.map((m, idx) => (
                      <tr key={m.model} className="hover:bg-gray-50/60 transition-colors">
                        <td className="px-6 py-3.5">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-gray-900">{m.displayName}</span>
                            <span
                              className={`text-[10px] uppercase font-bold px-1.5 py-0.5 rounded-sm ${
                                m.provider === 'anthropic'
                                  ? 'bg-amber-100 text-amber-800'
                                  : m.provider === 'pyannote'
                                  ? 'bg-purple-100 text-purple-800'
                                  : 'bg-blue-100 text-blue-800'
                              }`}
                            >
                              {m.provider}
                            </span>
                            {idx === 0 && (
                              <span className="text-[10px] bg-emerald-100 text-emerald-800 font-semibold px-1.5 py-0.5 rounded-sm">
                                #1 Top
                              </span>
                            )}
                          </div>
                          <span className="text-xs text-gray-400 font-mono block mt-0.5">{m.model}</span>
                        </td>
                        <td className="px-4 py-3.5 text-right font-mono text-gray-600 text-xs">
                          {formatTokenCount(m.inputTokens)}
                        </td>
                        <td className="px-4 py-3.5 text-right font-mono text-gray-600 text-xs">
                          {formatTokenCount(m.outputTokens)}
                        </td>
                        <td className="px-4 py-3.5 text-right font-mono font-bold text-gray-900 text-xs">
                          {formatTokenCount(m.totalTokens)}
                        </td>
                        <td className="px-6 py-3.5 min-w-[140px]">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden">
                              <div
                                className="bg-[#2d9e4f] h-full rounded-full transition-all"
                                style={{ width: `${Math.min(100, m.sharePercent)}%` }}
                              />
                            </div>
                            <span className="text-xs font-semibold text-gray-700 w-10 text-right">
                              {m.sharePercent}%
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3.5 text-right">
                          <span className="font-bold text-emerald-700 block text-xs font-mono">{formatUsd(m.costUsd)}</span>
                          <span className="text-[11px] text-gray-400 font-mono">{formatInr(m.costUsd)}</span>
                        </td>
                        <td className="px-4 py-3.5 text-right font-mono text-gray-600 text-xs">
                          {m.requestCount.toLocaleString()}
                        </td>
                        <td className="px-6 py-3.5 text-right font-mono text-gray-600 text-xs">
                          {m.avgTokensPerRequest.toLocaleString()}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Charts Row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Chart 1: Token Share by Model */}
            <div className="bg-white rounded-2xl border border-gray-200/80 p-6 shadow-xs flex flex-col justify-between">
              <div>
                <h3 className="text-sm font-bold text-gray-900">Token Consumption Share</h3>
                <p className="text-xs text-gray-500 mt-0.5">Proportional volume of tokens consumed by each model</p>
              </div>

              <div className="h-64 w-full mt-4">
                {pieData.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-xs text-gray-400">
                    No data available
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={pieData}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={90}
                        paddingAngle={3}
                        dataKey="value"
                      >
                        {pieData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(val: any, name: any, item: any) => [
                          `${formatTokenCount(Number(val))} tokens (${item?.payload?.share}%) · ${formatUsd(item?.payload?.cost)}`,
                          name,
                        ]}
                      />
                      <Legend
                        verticalAlign="bottom"
                        height={36}
                        formatter={(value) => <span className="text-xs text-gray-600 font-medium">{value}</span>}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            {/* Chart 2: Usage by Feature */}
            <div className="bg-white rounded-2xl border border-gray-200/80 p-6 shadow-xs flex flex-col justify-between">
              <div>
                <h3 className="text-sm font-bold text-gray-900">Consumption by Feature</h3>
                <p className="text-xs text-gray-500 mt-0.5">Tokens utilized by Quality Scoring, Chat, Call Analysis, etc.</p>
              </div>

              <div className="h-64 w-full mt-4">
                {featureBarData.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-xs text-gray-400">
                    No data available
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={featureBarData} margin={{ top: 10, right: 10, left: 0, bottom: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                      <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#6b7280' }} interval={0} angle={-15} textAnchor="end" />
                      <YAxis tickFormatter={(v) => formatTokenCount(v)} tick={{ fontSize: 11, fill: '#6b7280' }} />
                      <Tooltip
                        formatter={(val: any) => [formatTokenCount(Number(val)) + ' tokens', 'Total Tokens']}
                        labelStyle={{ color: '#111827', fontWeight: 600 }}
                      />
                      <Bar dataKey="tokens" fill="#2d9e4f" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          </div>

          {/* Time Series Area Chart */}
          <div className="bg-white rounded-2xl border border-gray-200/80 p-6 shadow-xs">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
              <div>
                <h3 className="text-sm font-bold text-gray-900">Token Consumption Trend</h3>
                <p className="text-xs text-gray-500 mt-0.5">Total volume of tokens consumed over time</p>
              </div>
              <div className="text-xs text-gray-500 font-medium">
                Timeframe: <span className="font-semibold text-gray-900 uppercase">{timeframe}</span>
              </div>
            </div>

            <div className="h-72 w-full">
              {(!data?.timeSeries || data.timeSeries.length === 0) ? (
                <div className="h-full flex items-center justify-center text-xs text-gray-400">
                  No timeline data available for this timeframe.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data.timeSeries} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="tokenGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#2d9e4f" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#2d9e4f" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6b7280' }} />
                    <YAxis tickFormatter={(v) => formatTokenCount(v)} tick={{ fontSize: 11, fill: '#6b7280' }} />
                    <Tooltip
                      formatter={(val: any, name: any) => [
                        name === 'totalTokens' ? formatTokenCount(Number(val)) + ' tokens' : val,
                        'Total Tokens',
                      ]}
                      labelStyle={{ color: '#111827', fontWeight: 600 }}
                    />
                    <Area
                      type="monotone"
                      dataKey="totalTokens"
                      stroke="#2d9e4f"
                      strokeWidth={2}
                      fillOpacity={1}
                      fill="url(#tokenGradient)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Live / Recent Activity Log Table */}
          <div className="bg-white rounded-2xl border border-gray-200/80 shadow-xs overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div>
                <h3 className="text-sm font-bold text-gray-900">Recent LLM Request Activity</h3>
                <p className="text-xs text-gray-500">Live stream of the 50 most recent model invocations</p>
              </div>
              <div className="text-xs text-gray-400 font-medium">
                Auto-tracked across all endpoints
              </div>
            </div>

            <div className="overflow-x-auto max-h-96 overflow-y-auto">
              <table className="w-full text-left border-collapse">
                <thead className="sticky top-0 bg-gray-50 z-5 shadow-xs">
                  <tr className="border-b border-gray-200/80 text-[11px] font-bold text-gray-500 uppercase tracking-wider">
                    <th className="px-6 py-3">Timestamp</th>
                    <th className="px-4 py-3">Model</th>
                    <th className="px-4 py-3">Feature</th>
                    <th className="px-4 py-3 text-right">In Tokens</th>
                    <th className="px-4 py-3 text-right">Out Tokens</th>
                    <th className="px-4 py-3 text-right">Total Tokens</th>
                    <th className="px-4 py-3 text-right">Est. Cost</th>
                    <th className="px-4 py-3 text-right">Latency</th>
                    <th className="px-6 py-3 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 text-xs">
                  {(!data?.recentLogs || data.recentLogs.length === 0) ? (
                    <tr>
                      <td colSpan={9} className="px-6 py-6 text-center text-gray-400">
                        No activity logs found.
                      </td>
                    </tr>
                  ) : (
                    data.recentLogs.map((log) => (
                      <tr key={log.id} className="hover:bg-gray-50/60 transition-colors font-mono">
                        <td className="px-6 py-2.5 text-gray-500 whitespace-nowrap">
                          {new Date(log.createdAt).toLocaleString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit',
                          })}
                        </td>
                        <td className="px-4 py-2.5 font-semibold text-gray-800">
                          {log.model}
                        </td>
                        <td className="px-4 py-2.5 font-sans capitalize text-gray-600">
                          {log.feature.replace(/_/g, ' ')}
                        </td>
                        <td className="px-4 py-2.5 text-right text-gray-600">
                          {log.inputTokens.toLocaleString()}
                        </td>
                        <td className="px-4 py-2.5 text-right text-gray-600">
                          {log.outputTokens.toLocaleString()}
                        </td>
                        <td className="px-4 py-2.5 text-right font-bold text-gray-900">
                          {log.totalTokens.toLocaleString()}
                        </td>
                        <td className="px-4 py-2.5 text-right text-emerald-700 font-semibold">
                          {formatUsd(log.costUsd)}
                        </td>
                        <td className="px-4 py-2.5 text-right text-gray-500">
                          {log.latencyMs != null ? `${log.latencyMs}ms` : '—'}
                        </td>
                        <td className="px-6 py-2.5 text-center font-sans">
                          <span
                            className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                              log.status === 'success'
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-red-100 text-red-800'
                            }`}
                          >
                            {log.status}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
