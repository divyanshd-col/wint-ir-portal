'use client';

import { useEffect, useState, useCallback } from 'react';

// ---- Types ----

interface SummaryRow {
  entity_id: string;
  entity_name: string;
  agent_count: number;
  qa: { avg: number | null; delta_vs_cx: number | null };
  csat: { avg: number | null; delta_vs_cx: number | null };
  volume: { avg: number | null; delta_vs_cx: number | null };
  composite_avg: number | null;
}

interface AgentRow {
  agent_id: string;
  name: string;
  team_name: string;
  tl_name: string;
  qa_name: string;
  qa_score: number | null;
  csat_avg: number | null;
  volume: number;
  composite_score: number | null;
  rank: number | null;
  wow_delta: { qa: number | null; csat: number | null; volume: number };
  delta_vs_cx: { qa: number | null; csat: number | null; volume: number | null };
}

interface TeamRow {
  team_id: string;
  team_name: string;
}

// ---- Helpers ----

function getWeekStart(date: Date = new Date()): string {
  const d = new Date(date);
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

function addWeeks(weekStart: string, n: number): string {
  const d = new Date(weekStart);
  d.setUTCDate(d.getUTCDate() + 7 * n);
  return d.toISOString().slice(0, 10);
}

function formatWeekLabel(weekStart: string, inProgress: boolean): string {
  const d = new Date(weekStart);
  const label = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  return inProgress ? `${label} (In progress)` : label;
}

function DeltaBadge({ delta }: { delta: number | null }) {
  if (delta === null) return <span className="text-gray-600">—</span>;
  const isUp = delta > 0;
  return (
    <span className={`text-xs font-medium ${isUp ? 'text-emerald-400' : delta < 0 ? 'text-red-400' : 'text-gray-500'}`}>
      {isUp ? '+' : ''}{delta.toFixed(1)}
    </span>
  );
}

type SortKey = 'entity_name' | 'agent_count' | 'qa' | 'csat' | 'volume' | 'composite_avg';

function SortableHeader({ label, sortKey, currentKey, direction, onSort }: {
  label: string; sortKey: SortKey; currentKey: SortKey; direction: 'asc' | 'desc'; onSort: (k: SortKey) => void;
}) {
  const active = currentKey === sortKey;
  return (
    <th
      className="px-4 py-3 text-left text-gray-500 font-medium text-xs uppercase tracking-wider cursor-pointer hover:text-gray-300 select-none"
      onClick={() => onSort(sortKey)}
    >
      {label}
      {active && <span className="ml-1">{direction === 'asc' ? '↑' : '↓'}</span>}
    </th>
  );
}

// ---- Reassign Modal ----

interface ReassignModalProps {
  agent: AgentRow;
  onClose: () => void;
  onSuccess: () => void;
}

function ReassignModal({ agent, onClose, onSuccess }: ReassignModalProps) {
  const [mode, setMode] = useState<'temp' | 'permanent'>('temp');
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [toTeamId, setToTeamId] = useState('');
  const [loading, setLoading] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/cx/admin/teams').then(r => r.ok ? r.json() : []).then(setTeams).catch(() => {});
  }, []);

  const handleSubmit = async () => {
    if (!toTeamId) return;
    if (mode === 'permanent' && !confirmed) { setConfirmed(true); return; }
    setLoading(true);
    setError(null);
    try {
      const endpoint = mode === 'temp' ? '/api/cx/admin/temp-assign' : '/api/cx/admin/permanent-assign';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent_id: agent.agent_id, to_team_id: toTeamId }),
      });
      if (!res.ok) throw new Error(await res.text());
      setResult(await res.json());
      onSuccess();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-[#1a1a1a] border border-white/10 rounded-xl w-full max-w-md p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-white font-semibold">Reassign Agent</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M4 4l10 10M14 4L4 14"/>
            </svg>
          </button>
        </div>

        <p className="text-gray-300 text-sm mb-4">
          Agent: <strong className="text-white">{agent.name}</strong>
          <br />
          Current team: <span className="text-gray-400">{agent.team_name}</span>
        </p>

        {/* Mode toggle */}
        <div className="flex gap-2 mb-4">
          {(['temp', 'permanent'] as const).map(m => (
            <button
              key={m}
              onClick={() => { setMode(m); setConfirmed(false); setResult(null); setError(null); }}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition ${mode === m ? 'bg-[#2d9e4f]/20 text-[#2d9e4f] border border-[#2d9e4f]/40' : 'bg-white/5 text-gray-400 hover:text-white border border-white/10'}`}
            >
              {m === 'temp' ? 'Temporary (8h)' : 'Permanent'}
            </button>
          ))}
        </div>

        {result ? (
          <div className="bg-emerald-900/20 border border-emerald-500/30 rounded-lg p-3 text-emerald-400 text-sm">
            {mode === 'temp'
              ? `Temporary assignment set. Expires at ${new Date(result.expires_at).toLocaleTimeString()}.`
              : `${result.agent_name} permanently moved from ${result.from_team} to ${result.to_team} (effective ${result.effective_date}).`
            }
          </div>
        ) : (
          <>
            <div className="mb-4">
              <label className="block text-gray-500 text-xs mb-1.5">Assign to team</label>
              <select
                value={toTeamId}
                onChange={e => { setToTeamId(e.target.value); setConfirmed(false); }}
                className="w-full bg-[#2a2a2a] border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-white/30"
              >
                <option value="">Select a team…</option>
                {teams.map(t => (
                  <option key={t.team_id} value={t.team_id}>{t.team_name}</option>
                ))}
              </select>
            </div>

            {mode === 'permanent' && confirmed && toTeamId && (
              <div className="bg-amber-900/20 border border-amber-500/30 rounded-lg p-3 text-amber-400 text-sm mb-4">
                <strong>Confirm permanent move</strong><br />
                {agent.name} → {teams.find(t => t.team_id === toTeamId)?.team_name ?? toTeamId}
                <br />Effective: {new Date().toISOString().slice(0, 10)}
              </div>
            )}

            {error && (
              <div className="bg-red-900/20 border border-red-500/30 rounded-lg p-3 text-red-400 text-sm mb-4">{error}</div>
            )}

            <div className="flex gap-2 mt-2">
              <button onClick={onClose} className="flex-1 py-2 rounded-lg bg-white/5 text-gray-400 hover:text-white text-sm transition">
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={!toTeamId || loading}
                className="flex-1 py-2 rounded-lg bg-[#2d9e4f] text-white text-sm font-medium hover:bg-[#25883f] transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {loading ? 'Saving…' : mode === 'permanent' && !confirmed ? 'Continue' : 'Confirm'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ---- Teams View ----

interface TeamStructure {
  team_id: number;
  team_name: string;
  team_type: string;
  tl_name: string | null;
  agents: { agent_id: number; agent_name: string; status: string; qa_name: string | null }[];
}

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
          {/* Team header */}
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

          {/* Agents */}
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

      {/* Unassigned agents */}
      {unassigned.length > 0 && (
        <div className="bg-[#1a1a1a] border border-amber-500/20 rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-white/8 bg-amber-900/10">
            <span className="text-amber-400 text-sm font-medium">⚠ Unassigned agents ({unassigned.length})</span>
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

// ---- Main Component ----

export default function AdminDashboard() {
  const currentWeek = getWeekStart();
  const [selectedWeek, setSelectedWeek] = useState(currentWeek);
  const [mainTab, setMainTab] = useState<'metrics' | 'teams'>('metrics');
  const [tab, setTab] = useState<'tl' | 'qa'>('tl');
  const [summary, setSummary] = useState<SummaryRow[]>([]);
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>('composite_avg');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [loadingSummary, setLoadingSummary] = useState(true);
  const [loadingAgents, setLoadingAgents] = useState(true);
  const [reassignAgent, setReassignAgent] = useState<AgentRow | null>(null);
  const [tempCount, setTempCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const isCurrentWeek = selectedWeek === currentWeek;
  const canGoNext = selectedWeek < currentWeek;

  const fetchSummary = useCallback(async (week: string, view: 'tl' | 'qa') => {
    setLoadingSummary(true);
    try {
      const res = await fetch(`/api/cx/admin/summary?view=${view}&week_start=${week}`);
      if (!res.ok) throw new Error(await res.text());
      setSummary(await res.json());
    } catch (e: any) { setError(e.message); }
    finally { setLoadingSummary(false); }
  }, []);

  const fetchAgents = useCallback(async (week: string) => {
    setLoadingAgents(true);
    try {
      const res = await fetch(`/api/cx/admin/agents?week_start=${week}`);
      if (!res.ok) throw new Error(await res.text());
      setAgents(await res.json());
    } catch (e: any) { setError(e.message); }
    finally { setLoadingAgents(false); }
  }, []);

  useEffect(() => {
    fetchSummary(selectedWeek, tab);
    fetchAgents(selectedWeek);
  }, [selectedWeek, tab, fetchSummary, fetchAgents]);

  const handleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(k); setSortDir('desc'); }
  };

  const sortedSummary = [...summary].sort((a, b) => {
    let av: number | string | null = null;
    let bv: number | string | null = null;
    if (sortKey === 'entity_name') { av = a.entity_name; bv = b.entity_name; }
    else if (sortKey === 'agent_count') { av = a.agent_count; bv = b.agent_count; }
    else if (sortKey === 'qa') { av = a.qa.avg; bv = b.qa.avg; }
    else if (sortKey === 'csat') { av = a.csat.avg; bv = b.csat.avg; }
    else if (sortKey === 'volume') { av = a.volume.avg; bv = b.volume.avg; }
    else if (sortKey === 'composite_avg') { av = a.composite_avg; bv = b.composite_avg; }
    if (av === null) return 1;
    if (bv === null) return -1;
    if (typeof av === 'string') return sortDir === 'asc' ? av.localeCompare(bv as string) : (bv as string).localeCompare(av);
    return sortDir === 'asc' ? (av as number) - (bv as number) : (bv as number) - (av as number);
  });

  return (
    <div className="space-y-6">
      {/* Temp assignment banner */}
      {tempCount > 0 && (
        <div className="bg-amber-900/20 border border-amber-500/40 rounded-lg px-4 py-3 text-amber-300 text-sm flex items-center gap-2">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1L1 14h14L8 1zm0 3l4.5 8h-9L8 4z"/></svg>
          TEMPORARY VIEW ACTIVE — {tempCount} agent{tempCount !== 1 ? 's' : ''} reassigned for this session
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold text-white">CX Performance — Admin</h1>
          {/* Main tab switcher */}
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

        {mainTab === 'metrics' && (
          <div className="flex items-center gap-2">
            <button onClick={() => setSelectedWeek(addWeeks(selectedWeek, -1))}
              className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white transition">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M10 12L6 8l4-4"/></svg>
            </button>
            <span className="text-sm text-gray-300 min-w-[160px] text-center">{formatWeekLabel(selectedWeek, isCurrentWeek)}</span>
            <button onClick={() => canGoNext && setSelectedWeek(addWeeks(selectedWeek, 1))}
              disabled={!canGoNext}
              className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white transition disabled:opacity-30 disabled:cursor-not-allowed">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M6 4l4 4-4 4"/></svg>
            </button>
          </div>
        )}
      </div>

      {error && <div className="bg-red-900/20 border border-red-500/30 rounded-lg p-3 text-red-400 text-sm">{error}</div>}

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
      {mainTab === 'metrics' && <>

      {/* Summary table tabs */}
      <div className="bg-[#1e1e1e] border border-white/10 rounded-xl overflow-hidden">
        <div className="flex border-b border-white/10">
          {(['tl', 'qa'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-5 py-3 text-sm font-medium transition ${tab === t ? 'text-white border-b-2 border-[#2d9e4f]' : 'text-gray-500 hover:text-gray-300'}`}
            >
              {t === 'tl' ? 'By TL' : 'By QA'}
            </button>
          ))}
        </div>

        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10">
              <SortableHeader label="Name" sortKey="entity_name" currentKey={sortKey} direction={sortDir} onSort={handleSort} />
              <SortableHeader label="Agents" sortKey="agent_count" currentKey={sortKey} direction={sortDir} onSort={handleSort} />
              <SortableHeader label="QA Avg" sortKey="qa" currentKey={sortKey} direction={sortDir} onSort={handleSort} />
              <SortableHeader label="CSAT Avg" sortKey="csat" currentKey={sortKey} direction={sortDir} onSort={handleSort} />
              <SortableHeader label="Vol Avg" sortKey="volume" currentKey={sortKey} direction={sortDir} onSort={handleSort} />
              <SortableHeader label="Composite" sortKey="composite_avg" currentKey={sortKey} direction={sortDir} onSort={handleSort} />
            </tr>
          </thead>
          <tbody>
            {loadingSummary ? (
              [...Array(3)].map((_, i) => (
                <tr key={i} className="border-b border-white/5">
                  <td colSpan={6} className="px-4 py-3">
                    <div className="h-4 bg-white/5 rounded animate-pulse w-2/3" />
                  </td>
                </tr>
              ))
            ) : sortedSummary.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-600">No data</td></tr>
            ) : (
              sortedSummary.map(row => (
                <tr key={row.entity_id} className="border-b border-white/5 hover:bg-white/3 transition cursor-pointer">
                  <td className="px-4 py-3 text-gray-200 font-medium">{row.entity_name}</td>
                  <td className="px-4 py-3 text-gray-400">{row.agent_count}</td>
                  <td className="px-4 py-3">
                    <span className="text-gray-200">{row.qa.avg !== null ? `${row.qa.avg.toFixed(1)}%` : '—'}</span>
                    {' '}<DeltaBadge delta={row.qa.delta_vs_cx} />
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-gray-200">{row.csat.avg !== null ? row.csat.avg.toFixed(2) : '—'}</span>
                    {' '}<DeltaBadge delta={row.csat.delta_vs_cx} />
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-gray-200">{row.volume.avg !== null ? row.volume.avg.toFixed(0) : '—'}</span>
                    {' '}<DeltaBadge delta={row.volume.delta_vs_cx} />
                  </td>
                  <td className="px-4 py-3 text-gray-200 tabular-nums">
                    {row.composite_avg !== null ? row.composite_avg.toFixed(3) : '—'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Agent table */}
      <div className="bg-[#1e1e1e] border border-white/10 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-white/10">
          <h2 className="text-sm font-medium text-gray-300">All Active Agents</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead>
              <tr className="border-b border-white/10">
                <th className="px-4 py-3 text-left text-gray-500 font-medium text-xs uppercase tracking-wider">Agent</th>
                <th className="px-4 py-3 text-left text-gray-500 font-medium text-xs uppercase tracking-wider">Team</th>
                <th className="px-4 py-3 text-left text-gray-500 font-medium text-xs uppercase tracking-wider">TL</th>
                <th className="px-4 py-3 text-left text-gray-500 font-medium text-xs uppercase tracking-wider">QA</th>
                <th className="px-4 py-3 text-left text-gray-500 font-medium text-xs uppercase tracking-wider">QA Score</th>
                <th className="px-4 py-3 text-left text-gray-500 font-medium text-xs uppercase tracking-wider">CSAT</th>
                <th className="px-4 py-3 text-left text-gray-500 font-medium text-xs uppercase tracking-wider">Volume</th>
                <th className="px-4 py-3 text-left text-gray-500 font-medium text-xs uppercase tracking-wider">Rank</th>
                <th className="px-4 py-3 text-left text-gray-500 font-medium text-xs uppercase tracking-wider">Action</th>
              </tr>
            </thead>
            <tbody>
              {loadingAgents ? (
                [...Array(4)].map((_, i) => (
                  <tr key={i} className="border-b border-white/5">
                    <td colSpan={9} className="px-4 py-3">
                      <div className="h-4 bg-white/5 rounded animate-pulse w-full" />
                    </td>
                  </tr>
                ))
              ) : agents.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-600">No agents found</td></tr>
              ) : (
                agents.map(agent => (
                  <tr key={agent.agent_id} className="border-b border-white/5 hover:bg-white/3 transition">
                    <td className="px-4 py-3 text-gray-200 font-medium whitespace-nowrap">{agent.name}</td>
                    <td className="px-4 py-3 text-gray-400 whitespace-nowrap">{agent.team_name}</td>
                    <td className="px-4 py-3 text-gray-400 whitespace-nowrap">{agent.tl_name}</td>
                    <td className="px-4 py-3 text-gray-400 whitespace-nowrap">{agent.qa_name}</td>
                    <td className="px-4 py-3 tabular-nums">
                      <span className="text-gray-200">{agent.qa_score !== null ? `${agent.qa_score.toFixed(1)}%` : '—'}</span>
                      {agent.wow_delta.qa !== null && (
                        <span className={`text-xs ml-1 ${agent.wow_delta.qa > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {agent.wow_delta.qa > 0 ? '+' : ''}{agent.wow_delta.qa.toFixed(1)}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 tabular-nums">
                      <span className="text-gray-200">{agent.csat_avg !== null ? agent.csat_avg.toFixed(2) : '—'}</span>
                      {agent.wow_delta.csat !== null && (
                        <span className={`text-xs ml-1 ${agent.wow_delta.csat > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {agent.wow_delta.csat > 0 ? '+' : ''}{agent.wow_delta.csat.toFixed(2)}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-gray-200">
                      {agent.volume}
                      {agent.wow_delta.volume !== 0 && (
                        <span className={`text-xs ml-1 ${agent.wow_delta.volume > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {agent.wow_delta.volume > 0 ? '+' : ''}{agent.wow_delta.volume}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-400 tabular-nums">
                      {agent.rank !== null ? `#${agent.rank}` : '—'}
                      {agent.composite_score !== null && (
                        <span className="text-gray-600 text-xs ml-1">({agent.composite_score.toFixed(2)})</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => setReassignAgent(agent)}
                        className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white text-xs transition"
                      >
                        Reassign
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {reassignAgent && (
        <ReassignModal
          agent={reassignAgent}
          onClose={() => setReassignAgent(null)}
          onSuccess={() => {
            setTempCount(c => c + 1);
            setReassignAgent(null);
          }}
        />
      )}
      </> /* end metrics view */}
    </div>
  );
}
