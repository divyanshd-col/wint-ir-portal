'use client';

import { useEffect, useState, useCallback } from 'react';

interface Summary {
  total_convs: number;
  scored_count: number;
  avg_iqs: number | null;
  low_iqs_count: number;
  bad_csat_count: number;
  bad_csat_pct: number | null;
}

interface AgentRow {
  agent_id: number;
  agent_name: string;
  conv_count: number;
  scored_count: number;
  avg_iqs: number | null;
  low_iqs_count: number;
  bad_csat_pct: number | null;
}

interface ParamRow {
  param_name: string;
  fail_count: number;
  pass_count: number;
  scored_count: number;
  fail_rate: number | null;
}

interface AttentionRow {
  chat_id: string;
  agent_name: string | null;
  csat_label: string | null;
  iqs_score: number | null;
  disposition: string;
  closed_at: string;
}

interface OverviewData {
  summary: Summary;
  agents: AgentRow[];
  iqs_params: ParamRow[];
  attention: AttentionRow[];
}

function fmt(v: number | null | undefined, decimals = 1, suffix = '') {
  if (v == null) return '—';
  return `${v.toFixed(decimals)}${suffix}`;
}

function CsatBadge({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="text-stone-400">—</span>;
  const color = pct >= 30 ? 'text-red-600 bg-red-50' : pct >= 15 ? 'text-amber-700 bg-amber-50' : 'text-emerald-700 bg-emerald-50';
  return <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${color}`}>{pct.toFixed(1)}%</span>;
}

function IqsBadge({ iqs }: { iqs: number | null }) {
  if (iqs == null) return <span className="text-stone-400 font-medium">NIL</span>;
  const color =
    iqs >= 85 ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
    iqs >= 70 ? 'bg-amber-50 text-amber-700 border border-amber-200' :
                'bg-red-50 text-red-700 border border-red-200';
  return <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-bold tabular-nums ${color}`}>{iqs.toFixed(1)}%</span>;
}

function CsatLabelPill({ label }: { label: string | null }) {
  if (!label) return <span className="text-stone-400">—</span>;
  const color = label === 'bad' ? 'bg-red-50 text-red-600' : label === 'could_be_better' ? 'bg-amber-50 text-amber-700' : label === 'good' ? 'bg-emerald-50 text-emerald-700' : 'bg-stone-100 text-stone-500';
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${color}`}>{label.replace(/_/g, ' ')}</span>;
}

function SummaryCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-white border border-stone-200 rounded-xl p-4">
      <p className="text-xs text-stone-500 font-medium uppercase tracking-wider mb-1">{label}</p>
      <p className="text-2xl font-bold text-stone-800">{value}</p>
      {sub && <p className="text-xs text-stone-400 mt-1">{sub}</p>}
    </div>
  );
}

export default function QADashboard() {
  const today = new Date().toISOString().slice(0, 10);
  const thirtyAgo = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);

  const [dateFrom, setDateFrom] = useState(thirtyAgo);
  const [dateTo, setDateTo] = useState(today);
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async (from: string, to: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/cx/quality/overview?dateFrom=${from}&dateTo=${to}`);
      if (!res.ok) throw new Error(await res.text());
      setData(await res.json());
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(dateFrom, dateTo); }, [dateFrom, dateTo, fetchData]);

  const s = data?.summary;

  return (
    <div className="space-y-6">
      {/* Header + date range */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-stone-800">Quality Overview</h1>
          <p className="text-sm text-stone-500 mt-0.5">IQS scores &amp; conversation quality analysis</p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <label className="text-stone-500">From</label>
          <input type="date" value={dateFrom} max={dateTo}
            onChange={e => setDateFrom(e.target.value)}
            className="border border-stone-200 rounded-lg px-2 py-1.5 text-stone-700 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
          />
          <label className="text-stone-500">To</label>
          <input type="date" value={dateTo} min={dateFrom} max={today}
            onChange={e => setDateTo(e.target.value)}
            className="border border-stone-200 rounded-lg px-2 py-1.5 text-stone-700 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
          />
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-red-600 text-sm">{error}</div>
      )}

      {/* Summary cards */}
      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[0,1,2,3].map(i => (
            <div key={i} className="bg-white border border-stone-200 rounded-xl p-4 h-20 animate-pulse" />
          ))}
        </div>
      ) : s ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <SummaryCard label="Scored Conversations" value={s.scored_count?.toLocaleString() ?? '0'} sub={`of ${s.total_convs?.toLocaleString()} total`} />
          <SummaryCard label="Avg IQS Score" value={fmt(s.avg_iqs, 1)} sub={`${s.low_iqs_count} below 60`} />
          <SummaryCard label="Bad CSAT" value={fmt(s.bad_csat_pct, 1, '%')} sub={`${s.bad_csat_count} conversations`} />
          <SummaryCard label="Low IQS (&lt;60)" value={s.low_iqs_count?.toLocaleString() ?? '0'} sub="needs attention" />
        </div>
      ) : null}

      {/* IQS Parameter Failures — full width with progress bars */}
      <div className="bg-white border border-stone-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-stone-100">
          <h2 className="text-sm font-semibold text-stone-700">IQS Parameter Failure Rates</h2>
          <p className="text-xs text-stone-400 mt-0.5">Sorted by highest failure rate — identify coaching priorities</p>
        </div>
        <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3">
          {loading ? (
            [...Array(8)].map((_, i) => (
              <div key={i} className="h-6 bg-stone-100 rounded animate-pulse" />
            ))
          ) : !data?.iqs_params.length ? (
            <p className="text-stone-400 text-sm py-4 col-span-2 text-center">No parameter data for this period</p>
          ) : (
            data.iqs_params.map(p => (
              <div key={p.param_name}>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-stone-700 font-medium capitalize">{p.param_name.replace(/_/g, ' ')}</span>
                  <span className="text-stone-500 tabular-nums">
                    {p.fail_count} fail / {p.scored_count} scored
                    <span className={`ml-1.5 font-semibold ${(p.fail_rate ?? 0) >= 30 ? 'text-red-600' : (p.fail_rate ?? 0) >= 15 ? 'text-amber-600' : 'text-emerald-600'}`}>
                      {fmt(p.fail_rate, 1, '%')}
                    </span>
                  </span>
                </div>
                <div className="h-2 bg-stone-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${(p.fail_rate ?? 0) >= 30 ? 'bg-red-400' : (p.fail_rate ?? 0) >= 15 ? 'bg-amber-400' : 'bg-emerald-400'}`}
                    style={{ width: `${Math.min(p.fail_rate ?? 0, 100)}%` }}
                  />
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Agent IQS breakdown */}
      <div className="bg-white border border-stone-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-stone-100">
          <h2 className="text-sm font-semibold text-stone-700">Agent IQS Breakdown</h2>
          <p className="text-xs text-stone-400 mt-0.5">Sorted by lowest average IQS score first</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-stone-50 border-b border-stone-100">
                <th className="px-4 py-2.5 text-left text-xs text-stone-500 font-semibold uppercase tracking-wider">Agent</th>
                <th className="px-4 py-2.5 text-right text-xs text-stone-500 font-semibold uppercase tracking-wider">Convs</th>
                <th className="px-4 py-2.5 text-right text-xs text-stone-500 font-semibold uppercase tracking-wider">Scored</th>
                <th className="px-4 py-2.5 text-center text-xs text-stone-500 font-semibold uppercase tracking-wider">Avg IQS</th>
                <th className="px-4 py-2.5 text-right text-xs text-stone-500 font-semibold uppercase tracking-wider">Low IQS</th>
                <th className="px-4 py-2.5 text-center text-xs text-stone-500 font-semibold uppercase tracking-wider">Bad CSAT %</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                [...Array(4)].map((_, i) => (
                  <tr key={i} className="border-b border-stone-50">
                    <td className="px-4 py-3" colSpan={6}>
                      <div className="h-4 bg-stone-100 rounded animate-pulse w-3/4" />
                    </td>
                  </tr>
                ))
              ) : !data?.agents.length ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-stone-400">No agent data for this period</td></tr>
              ) : (
                data.agents.map(a => (
                  <tr key={a.agent_id} className="border-b border-stone-50 hover:bg-stone-50 transition-colors">
                    <td className="px-4 py-3 font-medium text-stone-700">{a.agent_name}</td>
                    <td className="px-4 py-3 text-right text-stone-500 tabular-nums">{a.conv_count}</td>
                    <td className="px-4 py-3 text-right text-stone-500 tabular-nums">{a.scored_count}</td>
                    <td className="px-4 py-3 text-center tabular-nums"><IqsBadge iqs={a.avg_iqs} /></td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      <span className={`font-medium ${a.low_iqs_count > 0 ? 'text-red-500' : 'text-stone-400'}`}>{a.low_iqs_count}</span>
                    </td>
                    <td className="px-4 py-3 text-center"><CsatBadge pct={a.bad_csat_pct} /></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Conversations needing attention */}
      {(data?.attention.length ?? 0) > 0 && (
        <div className="bg-white border border-stone-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-stone-100">
            <h2 className="text-sm font-semibold text-stone-700">Conversations Needing Attention</h2>
            <p className="text-xs text-stone-400 mt-0.5">Low IQS (&lt;60) or bad CSAT — up to 20 most recent</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-stone-50 border-b border-stone-100">
                  <th className="px-4 py-2 text-left text-xs text-stone-500 font-semibold uppercase tracking-wider">Chat ID</th>
                  <th className="px-4 py-2 text-left text-xs text-stone-500 font-semibold uppercase tracking-wider">Agent</th>
                  <th className="px-4 py-2 text-center text-xs text-stone-500 font-semibold uppercase tracking-wider">IQS</th>
                  <th className="px-4 py-2 text-center text-xs text-stone-500 font-semibold uppercase tracking-wider">CSAT</th>
                  <th className="px-4 py-2 text-left text-xs text-stone-500 font-semibold uppercase tracking-wider">Disposition</th>
                  <th className="px-4 py-2 text-right text-xs text-stone-500 font-semibold uppercase tracking-wider">Date</th>
                </tr>
              </thead>
              <tbody>
                {data!.attention.map(r => (
                  <tr key={r.chat_id} className="border-b border-stone-50 hover:bg-stone-50 transition-colors">
                    <td className="px-4 py-2.5 font-mono text-xs text-stone-500 max-w-[120px] truncate" title={r.chat_id}>{r.chat_id}</td>
                    <td className="px-4 py-2.5 text-stone-700">{r.agent_name ?? '—'}</td>
                    <td className="px-4 py-2.5 text-center tabular-nums"><IqsBadge iqs={r.iqs_score} /></td>
                    <td className="px-4 py-2.5 text-center"><CsatLabelPill label={r.csat_label} /></td>
                    <td className="px-4 py-2.5 text-stone-500 max-w-[160px] truncate" title={r.disposition}>{r.disposition}</td>
                    <td className="px-4 py-2.5 text-right text-stone-400 text-xs tabular-nums">
                      {new Date(r.closed_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
