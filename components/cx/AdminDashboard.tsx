'use client';
import { useEffect, useState, useCallback, Fragment } from 'react';
import Link from 'next/link';

// ── Types ─────────────────────────────────────────────────────────────────────
type DatePreset = 'today' | '7d' | '30d' | 'all' | 'custom';
type ViewTab    = 'tl' | 'qa';
type MainTab    = 'metrics' | 'teams';

interface OverviewData {
  volume: number;
  // CSAT
  csat_pct: number | null;
  csat_good: number;
  csat_cbb: number;
  csat_bad: number;
  with_csat: number;
  // IQS
  avg_iqs: number | null;
  iqs_excellent: number;
  iqs_warn: number;
  iqs_risk: number;
  with_iqs: number;
  // Timing
  avg_resolution: number | null;
  avg_frt: number | null;
  avg_handoff: number | null;
  frt_sla_met: number;
  with_frt: number;
  // Channel split
  bot_volume: number;
  agent_volume: number;
  hybrid_volume: number;
  bot_csat_pct: number | null;
  agent_csat_pct: number | null;
  bot_avg_frt: number | null;
  agent_avg_frt: number | null;
  bot_avg_resolution: number | null;
  agent_avg_resolution: number | null;
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

// ── Helpers ───────────────────────────────────────────────────────────────────
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
  if (val == null) return <span className="text-stone-400 text-xs">—</span>;
  const color =
    val >= 85 ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
    val >= 70 ? 'bg-amber-50 text-amber-700 border border-amber-200' :
                'bg-red-50 text-red-700 border border-red-200';
  return (
    <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-bold tabular-nums ${color}`}>
      {val.toFixed(1)}%
    </span>
  );
}

function CsatBadge({ val }: { val: number | null | undefined }) {
  if (val == null) return <span className="text-stone-400 text-xs">—</span>;
  const color =
    val >= 90 ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
    val >= 75 ? 'bg-amber-50 text-amber-700 border border-amber-200' :
                'bg-red-50 text-red-700 border border-red-200';
  return (
    <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-bold tabular-nums ${color}`}>
      {val.toFixed(1)}%
    </span>
  );
}

function ResolutionCell({ secs }: { secs: number | null | undefined }) {
  if (secs == null) return <span className="text-stone-400 text-xs">—</span>;
  const hours = secs / 3600;
  const cls = hours > 10 ? 'text-red-600 font-semibold' : hours > 5 ? 'text-amber-600' : 'text-stone-600';
  return <span className={`text-xs tabular-nums ${cls}`}>{fmtDuration(secs)}</span>;
}

// ── Agent Drawer ──────────────────────────────────────────────────────────────
function AgentDrawer({ agent, onClose }: { agent: AgentData | null; onClose: () => void }) {
  useEffect(() => {
    if (agent) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = '';
    return () => { document.body.style.overflow = ''; };
  }, [agent]);

  if (!agent) return null;
  const qualityUrl = `/quality?agent=${encodeURIComponent(agent.name)}&tab=log`;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="fixed inset-0 bg-black/20" onClick={onClose} />
      <div className="relative bg-white w-full max-w-sm h-full flex flex-col shadow-2xl" style={{ zIndex: 51 }}>
        <div className="px-5 py-4 border-b border-stone-200 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-stone-800">{agent.name}</h3>
            <p className="text-xs text-stone-500 mt-0.5">Agent performance overview</p>
          </div>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-600 text-xl leading-none">×</button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'Volume', value: String(agent.volume), plain: true },
              { label: 'CSAT %', value: agent.csat_pct != null ? `${agent.csat_pct.toFixed(1)}%` : '—',
                color: agent.csat_pct == null ? '' : agent.csat_pct >= 90 ? 'text-emerald-700' : agent.csat_pct >= 75 ? 'text-amber-700' : 'text-red-700' },
              { label: 'Avg IQS', value: agent.avg_iqs != null ? `${agent.avg_iqs.toFixed(1)}%` : '—',
                color: agent.avg_iqs == null ? '' : agent.avg_iqs >= 85 ? 'text-emerald-700' : agent.avg_iqs >= 70 ? 'text-amber-700' : 'text-red-700' },
              { label: 'Avg FRT', value: fmtDuration(agent.avg_frt), plain: true },
              { label: 'Resolution', value: fmtDuration(agent.avg_resolution),
                color: agent.avg_resolution == null ? '' : agent.avg_resolution > 36000 ? 'text-red-600' : agent.avg_resolution > 18000 ? 'text-amber-600' : 'text-stone-700' },
              { label: 'Handoff', value: fmtDuration(agent.avg_handoff), plain: true },
            ].map(m => (
              <div key={m.label} className="bg-stone-50 rounded-xl p-3 border border-stone-100">
                <p className="text-[10px] font-bold text-stone-400 uppercase tracking-wider mb-1">{m.label}</p>
                <p className={`text-lg font-bold tabular-nums ${m.color || 'text-stone-800'}`}>{m.value}</p>
              </div>
            ))}
          </div>

          {agent.counterpart && (
            <div className="bg-stone-50 rounded-xl p-3 border border-stone-100 text-xs text-stone-600">
              <span className="font-semibold text-stone-400 uppercase tracking-wider text-[10px]">Counterpart</span>
              <p className="mt-0.5 font-medium text-stone-700">{agent.counterpart}</p>
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t border-stone-200 space-y-2">
          <Link
            href={qualityUrl}
            className="w-full flex items-center justify-center gap-2 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-xl transition"
          >
            Deep Dive in Quality
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 7h8M7 3l4 4-4 4" />
            </svg>
          </Link>
          <button onClick={onClose} className="w-full py-2 text-stone-500 text-sm hover:text-stone-700 transition">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Date helpers ──────────────────────────────────────────────────────────────
function getDateRange(preset: DatePreset, customFrom: string, customTo: string): { dateFrom: string; dateTo: string } {
  const today = new Date().toISOString().slice(0, 10);
  if (preset === 'today') return { dateFrom: today, dateTo: today };
  if (preset === '7d')  return { dateFrom: new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10), dateTo: today };
  if (preset === '30d') return { dateFrom: new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10), dateTo: today };
  if (preset === 'all') return { dateFrom: '', dateTo: '' };
  return { dateFrom: customFrom, dateTo: customTo };
}

// ── CSAT Distribution Strip ───────────────────────────────────────────────────
function CsatStrip({ good, cbb, bad, total }: { good: number; cbb: number; bad: number; total: number }) {
  if (total === 0) return null;
  const goodPct = Math.round((good / total) * 100);
  const cbbPct  = Math.round((cbb  / total) * 100);
  const badPct  = Math.round((bad  / total) * 100);
  return (
    <div>
      <div className="flex rounded-full overflow-hidden h-2.5 gap-px mb-3">
        <div className="bg-emerald-500 transition-all" style={{ width: `${goodPct}%` }} />
        <div className="bg-amber-400 transition-all"   style={{ width: `${cbbPct}%`  }} />
        <div className="bg-red-400 transition-all"     style={{ width: `${badPct}%`  }} />
      </div>
      <div className="flex items-center gap-4 text-xs">
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shrink-0" />
          <span className="text-stone-600 font-medium">Good</span>
          <span className="text-stone-500">{good} · {goodPct}%</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-amber-400 shrink-0" />
          <span className="text-stone-600 font-medium">CBB</span>
          <span className="text-stone-500">{cbb} · {cbbPct}%</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-red-400 shrink-0" />
          <span className="text-stone-600 font-medium">Bad</span>
          <span className="text-stone-500">{bad} · {badPct}%</span>
        </span>
        <span className="ml-auto text-stone-400">{total} rated</span>
      </div>
    </div>
  );
}

// ── IQS Health bar ────────────────────────────────────────────────────────────
function IqsHealth({ excellent, warn, risk }: { excellent: number; warn: number; risk: number }) {
  const total = excellent + warn + risk;
  if (total === 0) return <p className="text-xs text-stone-400">No IQS data</p>;
  const excPct  = Math.round((excellent / total) * 100);
  const warnPct = Math.round((warn      / total) * 100);
  const riskPct = Math.round((risk      / total) * 100);
  return (
    <div>
      <div className="flex rounded-full overflow-hidden h-2.5 gap-px mb-3">
        <div className="bg-emerald-500 transition-all" style={{ width: `${excPct}%` }} />
        <div className="bg-amber-400 transition-all"   style={{ width: `${warnPct}%` }} />
        <div className="bg-red-400 transition-all"     style={{ width: `${riskPct}%` }} />
      </div>
      <div className="flex items-center gap-4 text-xs">
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shrink-0" />
          <span className="text-stone-600 font-medium">≥85</span>
          <span className="text-stone-500">{excellent} chats</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-amber-400 shrink-0" />
          <span className="text-stone-600 font-medium">70–84</span>
          <span className="text-stone-500">{warn} chats</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-red-400 shrink-0" />
          <span className="text-stone-600 font-medium">&lt;70</span>
          <span className="text-stone-500">{risk} chats</span>
        </span>
      </div>
    </div>
  );
}

// ── Quick Insights ────────────────────────────────────────────────────────────
function QuickInsights({ groups, overview }: { groups: GroupData[]; overview: OverviewData | null }) {
  const allAgents = groups.flatMap(g => g.agents);

  const topCsat = [...allAgents]
    .filter(a => a.csat_pct != null && a.volume >= 5)
    .sort((a, b) => (b.csat_pct ?? 0) - (a.csat_pct ?? 0))[0];

  const atRiskAgents = allAgents
    .filter(a => a.avg_iqs != null && a.avg_iqs < 70)
    .sort((a, b) => (a.avg_iqs ?? 0) - (b.avg_iqs ?? 0));

  const slowestResolution = [...allAgents]
    .filter(a => a.avg_resolution != null)
    .sort((a, b) => (b.avg_resolution ?? 0) - (a.avg_resolution ?? 0))[0];

  const frtSlaPct = overview && overview.with_frt > 0
    ? Math.round((overview.frt_sla_met / overview.with_frt) * 100)
    : null;

  const csatResponseRate = overview && overview.volume > 0
    ? Math.round((overview.with_csat / overview.volume) * 100)
    : null;

  const flags: { type: 'good' | 'warn' | 'bad' | 'info'; text: string }[] = [];

  if (topCsat) {
    flags.push({ type: 'good', text: `Top agent: ${topCsat.name} — ${topCsat.csat_pct?.toFixed(0)}% CSAT across ${topCsat.volume} chats` });
  }

  if (atRiskAgents.length > 0) {
    const names = atRiskAgents.slice(0, 3).map(a => `${a.name} (${a.avg_iqs?.toFixed(0)}%)`).join(', ');
    flags.push({ type: 'bad', text: `${atRiskAgents.length} agent${atRiskAgents.length > 1 ? 's' : ''} below IQS threshold: ${names}` });
  }

  if (frtSlaPct != null && frtSlaPct < 60) {
    flags.push({ type: 'warn', text: `FRT SLA compliance low: only ${frtSlaPct}% of chats responded within 3 minutes` });
  } else if (frtSlaPct != null && frtSlaPct >= 85) {
    flags.push({ type: 'good', text: `FRT SLA on track: ${frtSlaPct}% of chats responded within 3 minutes` });
  }

  if (csatResponseRate != null && csatResponseRate < 40) {
    flags.push({ type: 'warn', text: `Low CSAT response rate: only ${csatResponseRate}% of chats received a rating` });
  }

  if (slowestResolution && slowestResolution.avg_resolution && slowestResolution.avg_resolution > 36000) {
    flags.push({ type: 'warn', text: `Slow resolution: ${slowestResolution.name} averaging ${fmtDuration(slowestResolution.avg_resolution)} per chat` });
  }

  if (flags.length === 0) {
    flags.push({ type: 'info', text: 'All metrics within normal range.' });
  }

  const dotCls = { good: 'bg-emerald-500', warn: 'bg-amber-400', bad: 'bg-red-400', info: 'bg-stone-300' };
  const bgCls  = { good: 'bg-emerald-50 border-emerald-100', warn: 'bg-amber-50 border-amber-100', bad: 'bg-red-50 border-red-100', info: 'bg-stone-50 border-stone-100' };
  const txtCls = { good: 'text-emerald-800', warn: 'text-amber-800', bad: 'text-red-800', info: 'text-stone-600' };

  return (
    <div className="space-y-2">
      {flags.map((f, i) => (
        <div key={i} className={`flex items-start gap-2.5 px-3.5 py-2.5 rounded-xl border text-sm ${bgCls[f.type]}`}>
          <span className={`w-2 h-2 rounded-full shrink-0 mt-1.5 ${dotCls[f.type]}`} />
          <span className={txtCls[f.type]}>{f.text}</span>
        </div>
      ))}
    </div>
  );
}

// ── Channel comparison card ───────────────────────────────────────────────────
function ChannelCard({
  label, volume, totalVolume, csat, frt, resolution, icon,
}: {
  label: string; volume: number; totalVolume: number;
  csat: number | null; frt: number | null; resolution: number | null;
  icon: React.ReactNode;
}) {
  const pct = totalVolume > 0 ? Math.round((volume / totalVolume) * 100) : 0;
  return (
    <div className="bg-white border border-stone-200 rounded-xl p-4 flex-1">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-stone-400">{icon}</span>
        <span className="text-sm font-semibold text-stone-700">{label}</span>
        <span className="ml-auto text-xs text-stone-400 bg-stone-100 px-2 py-0.5 rounded-full">{pct}% of total</span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <p className="text-[10px] text-stone-400 font-semibold uppercase tracking-wider mb-0.5">Volume</p>
          <p className="text-xl font-bold text-stone-800 tabular-nums">{volume.toLocaleString()}</p>
        </div>
        <div>
          <p className="text-[10px] text-stone-400 font-semibold uppercase tracking-wider mb-0.5">CSAT %</p>
          <p className={`text-xl font-bold tabular-nums ${csat == null ? 'text-stone-400' : csat >= 90 ? 'text-emerald-600' : csat >= 75 ? 'text-amber-600' : 'text-red-600'}`}>
            {csat != null ? `${csat}%` : '—'}
          </p>
        </div>
        <div>
          <p className="text-[10px] text-stone-400 font-semibold uppercase tracking-wider mb-0.5">Avg FRT</p>
          <p className="text-sm font-semibold text-stone-700 tabular-nums">{fmtDuration(frt)}</p>
        </div>
        <div>
          <p className="text-[10px] text-stone-400 font-semibold uppercase tracking-wider mb-0.5">Avg Resolution</p>
          <p className={`text-sm font-semibold tabular-nums ${resolution == null ? 'text-stone-400' : resolution > 36000 ? 'text-red-600' : 'text-stone-700'}`}>
            {fmtDuration(resolution)}
          </p>
        </div>
      </div>
    </div>
  );
}

// ── KPI Card ──────────────────────────────────────────────────────────────────
function KpiCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: 'good' | 'warn' | 'bad' | 'neutral' }) {
  const accentCls = accent === 'good' ? 'border-l-4 border-l-emerald-400' : accent === 'warn' ? 'border-l-4 border-l-amber-400' : accent === 'bad' ? 'border-l-4 border-l-red-400' : '';
  return (
    <div className={`bg-white border border-stone-200 rounded-xl p-4 ${accentCls}`}>
      <p className="text-[11px] text-stone-500 uppercase tracking-wider font-semibold mb-1">{label}</p>
      <p className="text-2xl font-bold text-stone-800 tabular-nums">{value}</p>
      {sub && <p className="text-xs text-stone-400 mt-1">{sub}</p>}
    </div>
  );
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
      {[...Array(3)].map((_, i) => <div key={i} className="h-24 bg-stone-100 rounded-xl animate-pulse" />)}
    </div>
  );

  return (
    <div className="p-4 space-y-4">
      {teams.map(team => (
        <div key={team.team_id} className="bg-white border border-stone-200 rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b border-stone-100">
            <div className="flex items-center gap-3">
              <span className="text-stone-800 font-semibold">{team.team_name}</span>
              <span className="text-xs text-stone-400 bg-stone-100 px-2 py-0.5 rounded-full capitalize">{team.team_type}</span>
            </div>
            <div className="flex items-center gap-4 text-xs text-stone-500">
              {team.tl_name && <span>TL: <span className="text-stone-600">{team.tl_name}</span></span>}
              <span>{team.agents.length} agent{team.agents.length !== 1 ? 's' : ''}</span>
            </div>
          </div>
          {team.agents.length === 0 ? (
            <p className="px-5 py-4 text-stone-400 text-sm italic">No agents assigned to this team.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-stone-100">
                  <th className="px-5 py-2 text-left text-xs text-stone-400 font-medium uppercase tracking-wider">Agent</th>
                  <th className="px-5 py-2 text-left text-xs text-stone-400 font-medium uppercase tracking-wider">QA</th>
                  <th className="px-5 py-2 text-left text-xs text-stone-400 font-medium uppercase tracking-wider">Status</th>
                </tr>
              </thead>
              <tbody>
                {team.agents.map(a => (
                  <tr key={a.agent_id} className="border-b border-stone-50 last:border-0 hover:bg-stone-50/50 transition">
                    <td className="px-5 py-2.5 text-stone-700">{a.agent_name}</td>
                    <td className="px-5 py-2.5 text-stone-500">{a.qa_name || <span className="italic text-stone-400">Unassigned</span>}</td>
                    <td className="px-5 py-2.5">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${a.status === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-stone-100 text-stone-500'}`}>
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
        <div className="bg-white border border-amber-200 rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-amber-100 bg-amber-50">
            <span className="text-amber-700 text-sm font-medium">Unassigned agents ({unassigned.length})</span>
          </div>
          <table className="w-full text-sm">
            <tbody>
              {unassigned.map(a => (
                <tr key={a.agent_id} className="border-b border-stone-50 last:border-0">
                  <td className="px-5 py-2.5 text-stone-500">{a.agent_name}</td>
                  <td className="px-5 py-2.5 text-stone-400">{a.qa_name || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────
export default function AdminDashboard() {
  const [mainTab, setMainTab]       = useState<MainTab>('metrics');
  const [viewTab, setViewTab]       = useState<ViewTab>('tl');
  const [preset, setPreset]         = useState<DatePreset>('30d');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo]     = useState('');
  const [overview, setOverview]     = useState<OverviewData | null>(null);
  const [groups, setGroups]         = useState<GroupData[]>([]);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [loadingOverview, setLoadingOverview] = useState(true);
  const [loadingGroups, setLoadingGroups]     = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<AgentData | null>(null);

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
    { id: 'all', label: 'All time' },
    { id: 'custom', label: 'Custom' },
  ];

  const frtSlaPct = overview && overview.with_frt > 0
    ? Math.round((overview.frt_sla_met / overview.with_frt) * 100)
    : null;

  const skeletonCards = [...Array(5)].map((_, i) => (
    <div key={i} className="bg-white border border-stone-200 rounded-xl p-4 animate-pulse">
      <div className="h-3 bg-stone-100 rounded w-2/3 mb-3" />
      <div className="h-7 bg-stone-100 rounded w-1/2" />
    </div>
  ));

  return (
    <div className="space-y-6">
      <AgentDrawer agent={selectedAgent} onClose={() => setSelectedAgent(null)} />

      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold text-stone-800">CX Performance</h1>
          <div className="flex bg-stone-100 rounded-lg p-0.5 gap-0.5">
            {(['metrics', 'teams'] as const).map(t => (
              <button
                key={t}
                onClick={() => setMainTab(t)}
                className={`px-3.5 py-1.5 rounded-md text-xs font-medium transition ${mainTab === t ? 'bg-emerald-600 text-white shadow-sm' : 'text-stone-500 hover:text-stone-700'}`}
              >
                {t === 'metrics' ? 'Metrics' : 'Teams'}
              </button>
            ))}
          </div>
        </div>

        {mainTab === 'metrics' && (
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex gap-1">
              {PRESETS.map(p => (
                <button
                  key={p.id}
                  onClick={() => setPreset(p.id)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium transition ${
                    preset === p.id ? 'bg-emerald-600 text-white' : 'bg-stone-100 text-stone-500 hover:text-stone-700'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            {preset === 'custom' && (
              <div className="flex items-center gap-2">
                <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)}
                  className="bg-stone-100 border border-stone-200 rounded-lg px-2 py-1 text-xs text-stone-600 focus:outline-none focus:border-stone-300" />
                <span className="text-stone-400 text-xs">to</span>
                <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)}
                  className="bg-stone-100 border border-stone-200 rounded-lg px-2 py-1 text-xs text-stone-600 focus:outline-none focus:border-stone-300" />
              </div>
            )}
          </div>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-600 text-sm">{error}</div>
      )}

      {/* ── Teams view ── */}
      {mainTab === 'teams' && (
        <div className="bg-white border border-stone-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-stone-200">
            <h2 className="text-stone-800 font-medium">Team Structure</h2>
            <p className="text-stone-400 text-xs mt-0.5">Teams, TLs, assigned agents and QA reviewers</p>
          </div>
          <TeamsView />
        </div>
      )}

      {/* ── Metrics view ── */}
      {mainTab === 'metrics' && (
        <>
          {/* KPI row */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {loadingOverview ? skeletonCards : (
              <>
                <KpiCard label="Volume" value={overview?.volume != null ? overview.volume.toLocaleString() : '—'}
                  sub={dateFrom ? `from ${dateFrom}` : 'All time'} accent="neutral" />
                <KpiCard label="CSAT %" value={overview?.csat_pct != null ? `${overview.csat_pct}%` : '—'}
                  sub={overview?.with_csat ? `${overview.with_csat} rated` : undefined}
                  accent={overview?.csat_pct == null ? 'neutral' : overview.csat_pct >= 90 ? 'good' : overview.csat_pct >= 75 ? 'warn' : 'bad'} />
                <KpiCard label="Avg FRT" value={fmtDuration(overview?.avg_frt)}
                  sub={frtSlaPct != null ? `${frtSlaPct}% met 3min SLA` : undefined}
                  accent={frtSlaPct == null ? 'neutral' : frtSlaPct >= 70 ? 'good' : frtSlaPct >= 50 ? 'warn' : 'bad'} />
                <KpiCard label="Avg IQS" value={overview?.avg_iqs != null ? `${overview.avg_iqs}%` : '—'}
                  sub={overview?.iqs_risk ? `${overview.iqs_risk} chats at risk` : undefined}
                  accent={overview?.avg_iqs == null ? 'neutral' : overview.avg_iqs >= 85 ? 'good' : overview.avg_iqs >= 70 ? 'warn' : 'bad'} />
                <KpiCard label="Avg Resolution" value={fmtDuration(overview?.avg_resolution)}
                  sub={overview?.avg_resolution != null ? (overview.avg_resolution > 36000 ? 'Above 10h target' : 'Within target') : undefined}
                  accent={overview?.avg_resolution == null ? 'neutral' : overview.avg_resolution > 36000 ? 'bad' : overview.avg_resolution > 18000 ? 'warn' : 'good'} />
              </>
            )}
          </div>

          {/* CSAT sentiment + IQS health */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-white border border-stone-200 rounded-xl p-5">
              <p className="text-xs font-semibold text-stone-400 uppercase tracking-wider mb-4">CSAT Sentiment Breakdown</p>
              {loadingOverview ? (
                <div className="space-y-2"><div className="h-2.5 bg-stone-100 rounded-full animate-pulse" /><div className="h-4 bg-stone-100 rounded animate-pulse w-3/4" /></div>
              ) : overview ? (
                <CsatStrip good={overview.csat_good} cbb={overview.csat_cbb ?? 0} bad={overview.csat_bad} total={overview.with_csat} />
              ) : <p className="text-xs text-stone-400">No data</p>}
            </div>

            <div className="bg-white border border-stone-200 rounded-xl p-5">
              <p className="text-xs font-semibold text-stone-400 uppercase tracking-wider mb-4">IQS Score Distribution</p>
              {loadingOverview ? (
                <div className="space-y-2"><div className="h-2.5 bg-stone-100 rounded-full animate-pulse" /><div className="h-4 bg-stone-100 rounded animate-pulse w-3/4" /></div>
              ) : overview ? (
                <IqsHealth excellent={overview.iqs_excellent} warn={overview.iqs_warn} risk={overview.iqs_risk} />
              ) : <p className="text-xs text-stone-400">No data</p>}
            </div>
          </div>

          {/* Bot vs Agent comparison */}
          {!loadingOverview && overview && (overview.bot_volume > 0 || overview.agent_volume > 0) && (
            <div>
              <p className="text-xs font-semibold text-stone-400 uppercase tracking-wider mb-3">Channel Breakdown</p>
              <div className="flex gap-3 flex-wrap">
                {overview.bot_volume > 0 && (
                  <ChannelCard
                    label="Bot" volume={overview.bot_volume} totalVolume={overview.volume}
                    csat={overview.bot_csat_pct} frt={overview.bot_avg_frt} resolution={overview.bot_avg_resolution}
                    icon={<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="4" width="10" height="8" rx="2"/><path d="M6 4V2M10 4V2M1 9h2M13 9h2"/><circle cx="6" cy="8" r="1" fill="currentColor"/><circle cx="10" cy="8" r="1" fill="currentColor"/></svg>}
                  />
                )}
                {overview.agent_volume > 0 && (
                  <ChannelCard
                    label="Agent" volume={overview.agent_volume} totalVolume={overview.volume}
                    csat={overview.agent_csat_pct} frt={overview.agent_avg_frt} resolution={overview.agent_avg_resolution}
                    icon={<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="5" r="3"/><path d="M2 14c0-3 2.7-5 6-5s6 2 6 5"/></svg>}
                  />
                )}
                {overview.hybrid_volume > 0 && (
                  <ChannelCard
                    label="Hybrid" volume={overview.hybrid_volume} totalVolume={overview.volume}
                    csat={null} frt={null} resolution={null}
                    icon={<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 8h10M8 3v10"/></svg>}
                  />
                )}
              </div>
            </div>
          )}

          {/* Quick insights */}
          {!loadingGroups && (
            <div>
              <p className="text-xs font-semibold text-stone-400 uppercase tracking-wider mb-3">Insights & Flags</p>
              <QuickInsights groups={groups} overview={overview} />
            </div>
          )}

          {/* Breakdown table */}
          <div className="bg-white border border-stone-200 rounded-xl overflow-hidden">
            <div className="flex items-center justify-between border-b border-stone-200">
              <div className="flex">
                {(['tl', 'qa'] as const).map(t => (
                  <button
                    key={t}
                    onClick={() => setViewTab(t)}
                    className={`px-5 py-3 text-sm font-medium transition ${viewTab === t ? 'text-emerald-700 border-b-2 border-emerald-600' : 'text-stone-400 hover:text-stone-600'}`}
                  >
                    {t === 'tl' ? 'By Team Lead' : 'By QA Reviewer'}
                  </button>
                ))}
              </div>
              <p className="text-xs text-stone-400 px-4">Click a row to expand agents · click an agent to inspect</p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-stone-100 bg-stone-50/50">
                    <th className="px-4 py-3 text-left text-stone-400 font-semibold text-xs uppercase tracking-wider w-8"></th>
                    <th className="px-4 py-3 text-left text-stone-400 font-semibold text-xs uppercase tracking-wider">Name</th>
                    <th className="px-4 py-3 text-left text-stone-400 font-semibold text-xs uppercase tracking-wider">Agents</th>
                    <th className="px-4 py-3 text-left text-stone-400 font-semibold text-xs uppercase tracking-wider">Volume</th>
                    <th className="px-4 py-3 text-left text-stone-400 font-semibold text-xs uppercase tracking-wider">CSAT %</th>
                    <th className="px-4 py-3 text-left text-stone-400 font-semibold text-xs uppercase tracking-wider">IQS %</th>
                    <th className="px-4 py-3 text-left text-stone-400 font-semibold text-xs uppercase tracking-wider">Avg Resolution</th>
                  </tr>
                </thead>
                <tbody>
                  {loadingGroups ? (
                    [...Array(4)].map((_, i) => (
                      <tr key={i} className="border-b border-stone-100">
                        <td colSpan={7} className="px-4 py-3">
                          <div className="h-4 bg-stone-100 rounded animate-pulse w-3/4" />
                        </td>
                      </tr>
                    ))
                  ) : groups.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-10 text-center text-stone-400">No data for selected range</td>
                    </tr>
                  ) : (
                    groups.map(group => {
                      const expanded = expandedRows.has(group.entity_name);
                      const counterpartLabel = viewTab === 'tl' ? 'QA' : 'TL';
                      return (
                        <Fragment key={group.entity_name}>
                          <tr
                            onClick={() => toggleRow(group.entity_name)}
                            className="border-b border-stone-100 hover:bg-stone-50 transition cursor-pointer"
                          >
                            <td className="px-4 py-3 text-stone-400 text-xs">
                              <span className={`transition-transform inline-block ${expanded ? 'rotate-90' : ''}`}>▶</span>
                            </td>
                            <td className="px-4 py-3 text-stone-700 font-semibold">{group.entity_name}</td>
                            <td className="px-4 py-3 text-stone-400 tabular-nums">{group.agent_count}</td>
                            <td className="px-4 py-3 text-stone-600 font-medium tabular-nums">{group.volume}</td>
                            <td className="px-4 py-3"><CsatBadge val={group.csat_pct} /></td>
                            <td className="px-4 py-3"><IqsPill val={group.avg_iqs} /></td>
                            <td className="px-4 py-3"><ResolutionCell secs={group.avg_resolution} /></td>
                          </tr>

                          {expanded && group.agents.map(agent => (
                            <tr
                              key={`${group.entity_name}-${agent.agent_id}`}
                              onClick={() => setSelectedAgent(agent)}
                              className="border-b border-stone-50 bg-stone-50/40 hover:bg-emerald-50/40 cursor-pointer transition group"
                            >
                              <td className="px-4 py-2.5"></td>
                              <td className="px-4 py-2.5 pl-8 text-stone-700 text-xs">
                                <div className="flex items-center gap-2">
                                  <span className="font-semibold">{agent.name}</span>
                                  <span className="text-[10px] text-emerald-600 opacity-0 group-hover:opacity-100 transition font-medium">Inspect →</span>
                                </div>
                                <span className="text-stone-400 text-[10px]">{counterpartLabel}: {agent.counterpart}</span>
                              </td>
                              <td className="px-4 py-2.5 text-stone-400 text-xs">—</td>
                              <td className="px-4 py-2.5 text-stone-600 text-xs font-medium tabular-nums">{agent.volume}</td>
                              <td className="px-4 py-2.5"><CsatBadge val={agent.csat_pct} /></td>
                              <td className="px-4 py-2.5"><IqsPill val={agent.avg_iqs} /></td>
                              <td className="px-4 py-2.5"><ResolutionCell secs={agent.avg_resolution} /></td>
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

          {/* Quality deep-dive CTA */}
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-5 py-4 flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-emerald-900">Need to go deeper?</p>
              <p className="text-xs text-emerald-700 mt-0.5">
                The Quality dashboard has per-chat IQS scores, parameter-level failures, transcript review, and weekly trends.
              </p>
            </div>
            <Link
              href="/quality"
              className="shrink-0 flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-xl transition shadow-sm"
            >
              Open Quality Dashboard
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 7h8M7 3l4 4-4 4" />
              </svg>
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
