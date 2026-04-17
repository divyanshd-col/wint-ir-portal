'use client';
import { useEffect, useState, useCallback, Fragment } from 'react';

// ── Types ────────────────────────────────────────────────────────────────────
type DatePreset = 'today' | '7d' | '30d' | 'all' | 'custom';
type ViewTab = 'tl' | 'qa';
type MainTab = 'metrics' | 'teams';

interface OverviewData {
  volume: number;
  csat_pct: number | null;
  avg_iqs: number | null;
  avg_resolution: number | null;
  avg_frt: number | null;
  avg_handoff: number | null;
  csat_good: number;
  csat_bad: number;
  with_csat: number;
}

interface AgentData {
  agent_id: string;
  name: string;
  counterpart: string;
  volume: number;
  csat_pct: number | null;
  avg_iqs: number | null;
  avg_resolution: number | null;
  avg_frt: number | null;
  avg_handoff: number | null;
}

interface GroupData {
  entity_name: string;
  agent_count: number;
  volume: number;
  csat_pct: number | null;
  avg_iqs: number | null;
  avg_resolution: number | null;
  agents: AgentData[];
}

interface TeamStructure {
  team_id: number;
  team_name: string;
  team_type: string;
  tl_name: string | null;
  agents: { agent_id: number; agent_name: string; status: string; qa_name: string | null }[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function fmtDuration(secs: number | null | undefined): string {
  if (secs == null) return '—';
  const s = Math.round(secs);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  return remM > 0 ? `${h}h ${remM}m` : `${h}h`;
}

function IqsPill({ val }: { val: number | null | undefined }) {
  if (val == null) return <span className="text-gray-600 text-xs">—</span>;
  const color =
    val >= 85 ? 'bg-emerald-900/40 text-emerald-400 border border-emerald-500/30' :
    val >= 70 ? 'bg-amber-900/40 text-amber-400 border border-amber-500/30' :
                'bg-red-900/40 text-red-400 border border-red-500/30';
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold tabular-nums ${color}`}>
      {val.toFixed(1)}%
    </span>
  );
}

// ── Date range helpers ────────────────────────────────────────────────────────
function getDateRange(preset: DatePreset, customFrom: string, customTo: string): { dateFrom: string; dateTo: string } {
  const today = new Date().toISOString().slice(0, 10);
  if (preset === 'today') return { dateFrom: today, dateTo: today };
  if (preset === '7d')  return { dateFrom: new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10), dateTo: today };
  if (preset === '30d') return { dateFrom: new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10), dateTo: today };
  if (preset === 'all') return { dateFrom: '', dateTo: '' };
  return { dateFrom: customFrom, dateTo: customTo };
}

// ── TeamsView ─────────────────────────────────────────────────────────────────
function TeamsView() {
  const [teams, setTeams] = useState<TeamStructure[]>([]);
  const [unassigned, setUnassigned] = useState<{ agent_id: number; agent_name: string; status: string; qa_name: string | null }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/cx/admin/team-structure')
      .then(r => r.ok ? r.json() : { teams: [], unassigned: [] })
      .then(d => { setTeams(d.teams || []); setUnassigned(d.unassigned || []); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div className="space-y-3 p-4">
      {[...Array(3)].map((_, i) => <div key={i} className="h-24 bg-white/5 rounded-xl animate-pulse" />)}
    </div>
  );

  return (
    <div className="p-4 space-y-4">
      {teams.map(team => (
        <div key={team.team_id} className="bg-[#1a1a1a] border border-white/8 rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b border-white/8 bg-white/2">
            <div className="flex items-center gap-3">
              <span className="text-white font-semibold">{team.team_name}</span>
              <span className="text-xs text-gray-600 bg-white/5 px-2 py-0.5 rounded-full capitalize">{team.team_type}</span>
            </div>
            <div className="flex items-center gap-4 text-xs text-gray-500">
              {team.tl_name && <span>TL: <span className="text-gray-300">{team.tl_name}</span></span>}
              <span>{team.agents.length} agent{team.agents.length !== 1 ? 's' : ''}</span>
            </div>
          </div>
          {team.agents.length === 0 ? (
            <p className="px-5 py-4 text-gray-600 text-sm italic">No agents assigned to this team.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/5">
                  <th className="px-5 py-2 text-left text-xs text-gray-600 font-medium uppercase tracking-wider">Agent</th>
                  <th className="px-5 py-2 text-left text-xs text-gray-600 font-medium uppercase tracking-wider">QA</th>
                  <th className="px-5 py-2 text-left text-xs text-gray-600 font-medium uppercase tracking-wider">Status</th>
                </tr>
              </thead>
              <tbody>
                {team.agents.map(a => (
                  <tr key={a.agent_id} className="border-b border-white/4 last:border-0 hover:bg-white/2 transition">
                    <td className="px-5 py-2.5 text-gray-200">{a.agent_name}</td>
                    <td className="px-5 py-2.5 text-gray-500">{a.qa_name || <span className="italic text-gray-700">Unassigned</span>}</td>
                    <td className="px-5 py-2.5">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${a.status === 'active' ? 'bg-emerald-900/30 text-emerald-400' : 'bg-gray-800 text-gray-500'}`}>
                        {a.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ))}

      {unassigned.length > 0 && (
        <div className="bg-[#1a1a1a] border border-amber-500/20 rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-white/8 bg-amber-900/10">
            <span className="text-amber-400 text-sm font-medium">Unassigned agents ({unassigned.length})</span>
          </div>
          <table className="w-full text-sm">
            <tbody>
              {unassigned.map(a => (
                <tr key={a.agent_id} className="border-b border-white/4 last:border-0">
                  <td className="px-5 py-2.5 text-gray-400">{a.agent_name}</td>
                  <td className="px-5 py-2.5 text-gray-600">{a.qa_name || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── KPI Card ──────────────────────────────────────────────────────────────────
function KpiCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-[#1e1e1e] border border-white/10 rounded-xl p-5">
      <p className="text-xs text-gray-500 uppercase tracking-wider font-medium mb-1">{label}</p>
      <p className="text-2xl font-bold text-white tabular-nums">{value}</p>
      {sub && <p className="text-xs text-gray-500 mt-1">{sub}</p>}
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────
export default function AdminDashboard() {
  const [mainTab, setMainTab] = useState<MainTab>('metrics');
  const [viewTab, setViewTab] = useState<ViewTab>('tl');
  const [preset, setPreset] = useState<DatePreset>('30d');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [groups, setGroups] = useState<GroupData[]>([]);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [loadingOverview, setLoadingOverview] = useState(true);
  const [loadingGroups, setLoadingGroups] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { dateFrom, dateTo } = getDateRange(preset, customFrom, customTo);

  const buildQS = useCallback(() => {
    const p = new URLSearchParams();
    if (dateFrom) p.set('dateFrom', dateFrom);
    if (dateTo)   p.set('dateTo', dateTo);
    return p.toString();
  }, [dateFrom, dateTo]);

  const fetchOverview = useCallback(async () => {
    setLoadingOverview(true);
    try {
      const r = await fetch(`/api/cx/admin/overview?${buildQS()}`);
      if (!r.ok) throw new Error(await r.text());
      setOverview(await r.json());
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoadingOverview(false); }
  }, [buildQS]);

  const fetchGroups = useCallback(async (view: ViewTab) => {
    setLoadingGroups(true);
    setExpandedRows(new Set());
    try {
      const r = await fetch(`/api/cx/admin/breakdown?view=${view}&${buildQS()}`);
      if (!r.ok) throw new Error(await r.text());
      setGroups(await r.json());
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoadingGroups(false); }
  }, [buildQS]);

  useEffect(() => {
    fetchOverview();
    fetchGroups(viewTab);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo]);

  useEffect(() => {
    fetchGroups(viewTab);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewTab]);

  const toggleRow = (name: string) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };

  const PRESETS: { id: DatePreset; label: string }[] = [
    { id: 'today', label: 'Today' },
    { id: '7d', label: '7 days' },
    { id: '30d', label: '30 days' },
    { id: 'all', label: 'All' },
    { id: 'custom', label: 'Custom' },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold text-white">CX Performance</h1>
          <div className="flex bg-white/5 rounded-lg p-0.5 gap-0.5">
            {(['metrics', 'teams'] as const).map(t => (
              <button
                key={t}
                onClick={() => setMainTab(t)}
                className={`px-3.5 py-1.5 rounded-md text-xs font-medium transition ${mainTab === t ? 'bg-white/10 text-white' : 'text-gray-500 hover:text-gray-300'}`}
              >
                {t === 'metrics' ? '📊 Metrics' : '🏢 Teams'}
              </button>
            ))}
          </div>
        </div>

        {/* Date range picker — only on Metrics tab */}
        {mainTab === 'metrics' && (
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex gap-1">
              {PRESETS.map(p => (
                <button
                  key={p.id}
                  onClick={() => setPreset(p.id)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium transition ${
                    preset === p.id
                      ? 'bg-[#2d9e4f] text-white'
                      : 'bg-white/5 text-gray-400 hover:text-white hover:bg-white/10'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            {preset === 'custom' && (
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={customFrom}
                  onChange={e => setCustomFrom(e.target.value)}
                  className="bg-[#2a2a2a] border border-white/10 rounded-lg px-2 py-1 text-xs text-gray-300 focus:outline-none focus:border-white/30"
                />
                <span className="text-gray-600 text-xs">to</span>
                <input
                  type="date"
                  value={customTo}
                  onChange={e => setCustomTo(e.target.value)}
                  className="bg-[#2a2a2a] border border-white/10 rounded-lg px-2 py-1 text-xs text-gray-300 focus:outline-none focus:border-white/30"
                />
              </div>
            )}
          </div>
        )}
      </div>

      {error && (
        <div className="bg-red-900/20 border border-red-500/30 rounded-lg p-3 text-red-400 text-sm">{error}</div>
      )}

      {/* Teams view */}
      {mainTab === 'teams' && (
        <div className="bg-[#1e1e1e] border border-white/10 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-white/10">
            <h2 className="text-white font-medium">Team Structure</h2>
            <p className="text-gray-600 text-xs mt-0.5">Teams, their TLs, assigned agents and QA reviewers</p>
          </div>
          <TeamsView />
        </div>
      )}

      {/* Metrics view */}
      {mainTab === 'metrics' && (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {loadingOverview ? (
              [...Array(4)].map((_, i) => (
                <div key={i} className="bg-[#1e1e1e] border border-white/10 rounded-xl p-5 animate-pulse">
                  <div className="h-3 bg-white/10 rounded w-2/3 mb-3" />
                  <div className="h-7 bg-white/10 rounded w-1/2" />
                </div>
              ))
            ) : (
              <>
                <KpiCard
                  label="Volume"
                  value={overview?.volume != null ? overview.volume.toLocaleString() : '—'}
                />
                <KpiCard
                  label="CSAT %"
                  value={overview?.csat_pct != null ? `${overview.csat_pct}%` : '—'}
                  sub={overview?.csat_good != null ? `Good: ${overview.csat_good}` : undefined}
                />
                <KpiCard
                  label="Avg IQS %"
                  value={overview?.avg_iqs != null ? `${overview.avg_iqs}%` : '—'}
                />
                <KpiCard
                  label="Avg Resolution"
                  value={fmtDuration(overview?.avg_resolution)}
                />
              </>
            )}
          </div>

          {/* Breakdown */}
          <div className="bg-[#1e1e1e] border border-white/10 rounded-xl overflow-hidden">
            {/* Sub-tabs */}
            <div className="flex border-b border-white/10">
              {(['tl', 'qa'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setViewTab(t)}
                  className={`px-5 py-3 text-sm font-medium transition ${viewTab === t ? 'text-white border-b-2 border-[#2d9e4f]' : 'text-gray-500 hover:text-gray-300'}`}
                >
                  {t === 'tl' ? 'By TL' : 'By QA'}
                </button>
              ))}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="px-4 py-3 text-left text-gray-500 font-medium text-xs uppercase tracking-wider w-8"></th>
                    <th className="px-4 py-3 text-left text-gray-500 font-medium text-xs uppercase tracking-wider">Name</th>
                    <th className="px-4 py-3 text-left text-gray-500 font-medium text-xs uppercase tracking-wider">Agents</th>
                    <th className="px-4 py-3 text-left text-gray-500 font-medium text-xs uppercase tracking-wider">Volume</th>
                    <th className="px-4 py-3 text-left text-gray-500 font-medium text-xs uppercase tracking-wider">CSAT %</th>
                    <th className="px-4 py-3 text-left text-gray-500 font-medium text-xs uppercase tracking-wider">IQS %</th>
                    <th className="px-4 py-3 text-left text-gray-500 font-medium text-xs uppercase tracking-wider">Avg Resolution</th>
                  </tr>
                </thead>
                <tbody>
                  {loadingGroups ? (
                    [...Array(4)].map((_, i) => (
                      <tr key={i} className="border-b border-white/5">
                        <td colSpan={7} className="px-4 py-3">
                          <div className="h-4 bg-white/5 rounded animate-pulse w-3/4" />
                        </td>
                      </tr>
                    ))
                  ) : groups.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-gray-600">No data for selected range</td>
                    </tr>
                  ) : (
                    groups.map(group => {
                      const expanded = expandedRows.has(group.entity_name);
                      const counterpartLabel = viewTab === 'tl' ? 'QA' : 'TL';
                      return (
                        <Fragment key={group.entity_name}>
                          <tr
                            key={group.entity_name}
                            onClick={() => toggleRow(group.entity_name)}
                            className="border-b border-white/5 hover:bg-white/3 transition cursor-pointer"
                          >
                            <td className="px-4 py-3 text-gray-500 text-xs">
                              {expanded ? '▼' : '▶'}
                            </td>
                            <td className="px-4 py-3 text-gray-200 font-medium">{group.entity_name}</td>
                            <td className="px-4 py-3 text-gray-400 tabular-nums">{group.agent_count}</td>
                            <td className="px-4 py-3 text-gray-400 tabular-nums">{group.volume}</td>
                            <td className="px-4 py-3 text-gray-300 tabular-nums">
                              {group.csat_pct != null ? `${group.csat_pct}%` : '—'}
                            </td>
                            <td className="px-4 py-3">
                              <IqsPill val={group.avg_iqs} />
                            </td>
                            <td className="px-4 py-3 text-gray-400 tabular-nums">
                              {fmtDuration(group.avg_resolution)}
                            </td>
                          </tr>

                          {expanded && group.agents.map(agent => (
                            <tr
                              key={`${group.entity_name}-${agent.agent_id}`}
                              className="border-b border-white/5 bg-white/[0.03]"
                            >
                              <td className="px-4 py-2.5"></td>
                              <td className="px-4 py-2.5 pl-8 text-gray-300 text-xs">
                                <span className="font-medium">{agent.name}</span>
                              </td>
                              <td className="px-4 py-2.5 text-gray-500 text-xs">
                                <span className="text-gray-600 mr-1">{counterpartLabel}:</span>
                                {agent.counterpart}
                              </td>
                              <td className="px-4 py-2.5 text-gray-500 text-xs tabular-nums">{agent.volume}</td>
                              <td className="px-4 py-2.5 text-gray-500 text-xs tabular-nums">
                                {agent.csat_pct != null ? `${agent.csat_pct}%` : '—'}
                              </td>
                              <td className="px-4 py-2.5">
                                <IqsPill val={agent.avg_iqs} />
                              </td>
                              <td className="px-4 py-2.5">
                                <div className="flex flex-col gap-0.5 text-xs text-gray-500">
                                  <span>Res: {fmtDuration(agent.avg_resolution)}</span>
                                  <span>FRT: {fmtDuration(agent.avg_frt)}</span>
                                  <span>Hnd: {fmtDuration(agent.avg_handoff)}</span>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </Fragment>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
