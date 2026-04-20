'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';

interface Summary {
  total_convs: number;
  bad_csat_count: number;
  bad_csat_pct: number | null;
  avg_iqs: number | null;
  avg_resolution_mins: number | null;
}

interface AgentRow {
  agent_id: number;
  agent_name: string;
  conv_count: number;
  bad_csat_count: number;
  bad_csat_pct: number | null;
  avg_iqs: number | null;
}

interface DispRow {
  disposition: string;
  conv_count: number;
  bad_csat_count: number;
  bad_csat_pct: number | null;
  avg_iqs: number | null;
}

interface SubDispRow {
  sub_disposition: string;
  conv_count: number;
  bad_csat_count: number;
  bad_csat_pct: number | null;
}

interface ParamRow {
  param_name: string;
  fail_count: number;
  scored_count: number;
  fail_rate: number | null;
}

interface OverviewData {
  summary: Summary;
  agents: AgentRow[];
  dispositions: DispRow[];
  sub_dispositions: SubDispRow[];
  iqs_params: ParamRow[];
}

function fmt(v: number | null | undefined, decimals = 1, suffix = '') {
  if (v == null) return '—';
  return `${v.toFixed(decimals)}${suffix}`;
}

function CsatBadge({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="text-stone-400">—</span>;
  const color = pct >= 30 ? 'text-red-700 bg-red-50 border border-red-200' : pct >= 15 ? 'text-amber-700 bg-amber-50 border border-amber-200' : 'text-emerald-700 bg-emerald-50 border border-emerald-200';
  return <span className={`text-xs font-bold px-2.5 py-0.5 rounded-full tabular-nums ${color}`}>{pct.toFixed(1)}%</span>;
}

function IqsBadge({ iqs }: { iqs: number | null }) {
  if (iqs == null) return <span className="text-stone-400">—</span>;
  const color =
    iqs >= 85 ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
    iqs >= 70 ? 'bg-amber-50 text-amber-700 border border-amber-200' :
                'bg-red-50 text-red-700 border border-red-200';
  return <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-bold tabular-nums ${color}`}>{iqs.toFixed(1)}%</span>;
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

export default function TLDashboard() {
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
      const res = await fetch(`/api/cx/tl/overview?dateFrom=${from}&dateTo=${to}`);
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
          <h1 className="text-xl font-bold text-stone-800">Team Performance</h1>
          <p className="text-sm text-stone-500 mt-0.5">CX team — conversations &amp; quality overview</p>
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
          <SummaryCard label="Total Conversations" value={s.total_convs?.toLocaleString() ?? '0'} />
          <SummaryCard
            label="Bad CSAT"
            value={fmt(s.bad_csat_pct, 1, '%')}
            sub={`${s.bad_csat_count} conversations`}
          />
          <SummaryCard label="Avg IQS Score" value={fmt(s.avg_iqs, 1)} />
          <SummaryCard
            label="Avg Resolution"
            value={s.avg_resolution_mins != null ? `${s.avg_resolution_mins}m` : '—'}
          />
        </div>
      ) : null}

      {/* Agent performance table */}
      <div className="bg-white border border-stone-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-stone-100">
          <h2 className="text-sm font-semibold text-stone-700">Agent Performance</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-stone-50 border-b border-stone-100">
                <th className="px-4 py-2.5 text-left text-xs text-stone-500 font-semibold uppercase tracking-wider">Agent</th>
                <th className="px-4 py-2.5 text-right text-xs text-stone-500 font-semibold uppercase tracking-wider">Conversations</th>
                <th className="px-4 py-2.5 text-center text-xs text-stone-500 font-semibold uppercase tracking-wider">Bad CSAT %</th>
                <th className="px-4 py-2.5 text-right text-xs text-stone-500 font-semibold uppercase tracking-wider">Avg IQS</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                [...Array(4)].map((_, i) => (
                  <tr key={i} className="border-b border-stone-50">
                    <td className="px-4 py-3" colSpan={4}>
                      <div className="h-4 bg-stone-100 rounded animate-pulse w-3/4" />
                    </td>
                  </tr>
                ))
              ) : !data?.agents.length ? (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-stone-400">No agent data for this period</td></tr>
              ) : (
                data.agents.map(a => (
                  <tr key={a.agent_id} className="border-b border-stone-50 hover:bg-emerald-50/40 transition-colors group">
                    <td className="px-4 py-3 font-medium text-stone-700">
                      <div className="flex items-center gap-2">
                        {a.agent_name}
                        <Link
                          href={`/quality?agent=${encodeURIComponent(a.agent_name)}&tab=log`}
                          className="text-[10px] text-emerald-600 font-semibold opacity-0 group-hover:opacity-100 transition"
                          onClick={e => e.stopPropagation()}
                        >
                          Quality →
                        </Link>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right text-stone-600 tabular-nums">{a.conv_count}</td>
                    <td className="px-4 py-3 text-center"><CsatBadge pct={a.bad_csat_pct} /></td>
                    <td className="px-4 py-3 text-right tabular-nums"><IqsBadge iqs={a.avg_iqs} /></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* IQS Parameter Failures */}
        <div className="bg-white border border-stone-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-stone-100">
            <h2 className="text-sm font-semibold text-stone-700">IQS Parameter Failures</h2>
            <p className="text-xs text-stone-400 mt-0.5">% of scored conversations where param failed</p>
          </div>
          <div className="p-4 space-y-2.5">
            {loading ? (
              [...Array(5)].map((_, i) => (
                <div key={i} className="h-6 bg-stone-100 rounded animate-pulse" />
              ))
            ) : !data?.iqs_params.length ? (
              <p className="text-stone-400 text-sm text-center py-4">No parameter data</p>
            ) : (
              data.iqs_params.map(p => (
                <div key={p.param_name}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-stone-600 capitalize">{p.param_name.replace(/_/g, ' ')}</span>
                    <span className="text-stone-500 tabular-nums">{p.fail_count}/{p.scored_count} ({fmt(p.fail_rate, 1, '%')})</span>
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

        {/* Dispositions by Bad CSAT */}
        <div className="bg-white border border-stone-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-stone-100">
            <h2 className="text-sm font-semibold text-stone-700">Top Dispositions by Bad CSAT</h2>
            <p className="text-xs text-stone-400 mt-0.5">Sorted by highest bad CSAT rate</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-stone-50 border-b border-stone-100">
                  <th className="px-4 py-2 text-left text-xs text-stone-500 font-semibold uppercase tracking-wider">Disposition</th>
                  <th className="px-4 py-2 text-right text-xs text-stone-500 font-semibold uppercase tracking-wider">Convs</th>
                  <th className="px-4 py-2 text-center text-xs text-stone-500 font-semibold uppercase tracking-wider">Bad CSAT</th>
                  <th className="px-4 py-2 text-right text-xs text-stone-500 font-semibold uppercase tracking-wider">Avg IQS</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  [...Array(4)].map((_, i) => (
                    <tr key={i} className="border-b border-stone-50">
                      <td className="px-4 py-2.5" colSpan={4}>
                        <div className="h-3.5 bg-stone-100 rounded animate-pulse w-2/3" />
                      </td>
                    </tr>
                  ))
                ) : !data?.dispositions.length ? (
                  <tr><td colSpan={4} className="px-4 py-6 text-center text-stone-400">No data</td></tr>
                ) : (
                  data.dispositions.map(d => (
                    <tr key={d.disposition} className="border-b border-stone-50 hover:bg-stone-50 transition-colors">
                      <td className="px-4 py-2.5 text-stone-700 max-w-[180px] truncate" title={d.disposition}>{d.disposition}</td>
                      <td className="px-4 py-2.5 text-right text-stone-500 tabular-nums">{d.conv_count}</td>
                      <td className="px-4 py-2.5 text-center"><CsatBadge pct={d.bad_csat_pct} /></td>
                      <td className="px-4 py-2.5 text-right tabular-nums"><IqsBadge iqs={d.avg_iqs} /></td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Sub-disposition breakdown */}
      {(data?.sub_dispositions.length ?? 0) > 0 && (
        <div className="bg-white border border-stone-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-stone-100">
            <h2 className="text-sm font-semibold text-stone-700">Sub-Disposition Breakdown</h2>
            <p className="text-xs text-stone-400 mt-0.5">Top 10 sub-dispositions by bad CSAT rate</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-stone-50 border-b border-stone-100">
                  <th className="px-4 py-2 text-left text-xs text-stone-500 font-semibold uppercase tracking-wider">Sub-Disposition</th>
                  <th className="px-4 py-2 text-right text-xs text-stone-500 font-semibold uppercase tracking-wider">Convs</th>
                  <th className="px-4 py-2 text-center text-xs text-stone-500 font-semibold uppercase tracking-wider">Bad CSAT</th>
                </tr>
              </thead>
              <tbody>
                {data!.sub_dispositions.map(sd => (
                  <tr key={sd.sub_disposition} className="border-b border-stone-50 hover:bg-stone-50 transition-colors">
                    <td className="px-4 py-2.5 text-stone-700">{sd.sub_disposition}</td>
                    <td className="px-4 py-2.5 text-right text-stone-500 tabular-nums">{sd.conv_count}</td>
                    <td className="px-4 py-2.5 text-center"><CsatBadge pct={sd.bad_csat_pct} /></td>
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
