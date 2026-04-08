'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import Link from 'next/link';

interface AgentRow { username: string; count: number; lastSeen: string; topQuery: string; }
interface TopQuery { query: string; count: number; agents: string[]; }
interface DayCount { date: string; count: number; }
interface LogEntry { timestamp: string; username: string; query: string; model: string; }
interface CategoryRow { category: string; count: number; pct: number; }
interface Stats {
  totalQueries: number;
  uniqueAgents: number;
  queriesToday: number;
  mostActiveAgent: string;
  agentBreakdown: AgentRow[];
  topQueries: TopQuery[];
  unansweredQueries?: TopQuery[];
  categoryBreakdown?: CategoryRow[];
  modelDistribution: Record<string, number>;
  dailyTrend: DayCount[];
  recentLogs: LogEntry[];
  source?: 'sheet' | 'kv';
  totalInSheet?: number;
  availableAgents?: string[];
}
interface QAMessage { role: 'user' | 'assistant'; content: string; }
interface SourceChunk { fileId: string; fileName: string; breadcrumb: string; excerpt: string; }
interface CorrectionEntry {
  id: string; timestamp: string; submittedBy: string;
  originalQuery: string; originalAnswer: string; correctedAnswer: string;
  agentNote?: string; sourceChunks: SourceChunk[];
  formAnswers?: Record<string, string>; category?: string;
  status: 'pending' | 'approved' | 'rejected';
  promptSuggestion?: string; promptApproved?: boolean;
  resolvedAt?: string; resolvedBy?: string;
}

// Portal palette — single green accent, no rainbow
const GREEN = '#2d6a4f';
const GREEN_HOVER = '#245a41';
const BG_PAGE = '#f5f3ee';

const CATEGORIES = ['All', 'Repayment', 'Account & KYC', 'Investment', 'Withdrawal', 'Platform Issue', 'General'];
const DATE_RANGES = [
  { label: 'Today', value: 'today' },
  { label: '7d', value: '7d' },
  { label: '30d', value: '30d' },
  { label: '90d', value: '90d' },
  { label: 'All time', value: 'all' },
];

function buildFilters(dateRange: string, agent: string, category: string) {
  const now = new Date();
  const filters: Record<string, string> = {};
  if (dateRange === 'today') {
    filters.dateFrom = now.toISOString().slice(0, 10);
  } else if (dateRange === '7d') {
    const d = new Date(now); d.setDate(d.getDate() - 7); filters.dateFrom = d.toISOString().slice(0, 10);
  } else if (dateRange === '30d') {
    const d = new Date(now); d.setDate(d.getDate() - 30); filters.dateFrom = d.toISOString().slice(0, 10);
  } else if (dateRange === '90d') {
    const d = new Date(now); d.setDate(d.getDate() - 90); filters.dateFrom = d.toISOString().slice(0, 10);
  }
  if (agent) filters.agent = agent;
  if (category && category !== 'All') filters.category = category;
  return filters;
}

// Short name: strip @wintwealth.com for display
function shortName(email: string) {
  return email.replace(/@wintwealth\.com$/i, '');
}

// ── Compact stat card ─────────────────────────────────────────────────────────
function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  const display = typeof value === 'string' && value.includes('@') ? shortName(value) : value;
  return (
    <div className="bg-white rounded-xl px-4 py-3.5 border border-gray-100 shadow-sm min-w-0">
      <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1 truncate">{label}</p>
      <p className="text-xl font-bold text-gray-900 truncate" title={String(value)}>{display}</p>
      {sub && <p className="text-[11px] text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

// ── Correction card ───────────────────────────────────────────────────────────
function CorrectionCard({ correction, onAction }: { correction: CorrectionEntry; onAction: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [editedAnswer, setEditedAnswer] = useState(correction.correctedAnswer);
  const [applyPrompt, setApplyPrompt] = useState(false);
  const [acting, setActing] = useState(false);
  const [done, setDone] = useState(false);
  const [doneAction, setDoneAction] = useState('');
  const [error, setError] = useState('');
  const [promptSuggestion, setPromptSuggestion] = useState(correction.promptSuggestion || '');

  async function handleAction(action: 'approve' | 'reject') {
    setActing(true); setError('');
    try {
      const res = await fetch('/api/corrections/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: correction.id, action,
          editedCorrection: action === 'approve' ? editedAnswer : undefined,
          applyPromptChange: action === 'approve' ? applyPrompt : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      if (action === 'approve' && data.promptSuggestion && !promptSuggestion) setPromptSuggestion(data.promptSuggestion);
      setDoneAction(action); setDone(true);
      setTimeout(onAction, 1200);
    } catch (err: any) { setError(err.message || 'Action failed'); }
    finally { setActing(false); }
  }

  const statusColor = {
    pending: 'bg-amber-50 text-amber-700 border-amber-200',
    approved: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    rejected: 'bg-gray-100 text-gray-500 border-gray-200',
  }[correction.status];

  if (done) {
    return (
      <div className={`rounded-xl p-4 border text-sm font-medium flex items-center gap-2 ${doneAction === 'approve' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-gray-50 border-gray-200 text-gray-500'}`}>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 8l4 4 6-6"/></svg>
        {doneAction === 'approve' ? 'Approved & applied.' : 'Rejected.'}
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-50">
        <div className="flex items-start justify-between gap-3 mb-2">
          <p className="text-sm font-semibold text-gray-800 leading-snug flex-1">{correction.originalQuery}</p>
          <div className="flex items-center gap-2 shrink-0">
            {correction.category && <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 font-medium">{correction.category}</span>}
            <span className={`text-xs px-2 py-0.5 rounded-full border font-semibold ${statusColor}`}>{correction.status}</span>
          </div>
        </div>
        <p className="text-xs text-gray-400">by <span className="font-semibold text-gray-600">{shortName(correction.submittedBy)}</span> · {correction.timestamp.slice(0, 16).replace('T', ' ')}</p>
      </div>

      <div className="grid grid-cols-2 divide-x divide-gray-100 text-xs">
        <div className="px-4 py-3"><p className="font-semibold text-gray-400 uppercase tracking-wide mb-1.5 text-[10px]">Original</p><p className="text-gray-600 leading-relaxed line-clamp-4">{correction.originalAnswer}</p></div>
        <div className="px-4 py-3 bg-emerald-50/30"><p className="font-semibold text-emerald-700 uppercase tracking-wide mb-1.5 text-[10px]">Corrected</p><p className="text-gray-700 leading-relaxed line-clamp-4">{correction.correctedAnswer}</p></div>
      </div>

      {correction.agentNote && (
        <div className="px-5 py-2.5 bg-amber-50/60 border-t border-amber-100/60">
          <p className="text-xs text-amber-700"><span className="font-semibold">Note:</span> {correction.agentNote}</p>
        </div>
      )}

      {correction.status === 'pending' && (
        <div className="px-5 py-3 border-t border-gray-50 flex items-center gap-2">
          {!expanded ? (
            <>
              <button onClick={() => setExpanded(true)} className="text-xs px-3.5 py-2 rounded-lg font-semibold text-white transition" style={{ background: GREEN }}>Review & Approve</button>
              <button onClick={() => handleAction('reject')} disabled={acting} className="text-xs px-3.5 py-2 border border-gray-200 text-gray-500 rounded-lg hover:border-red-300 hover:text-red-500 transition disabled:opacity-50">{acting ? 'Rejecting…' : 'Reject'}</button>
              {error && <p className="text-xs text-red-500 ml-2">{error}</p>}
            </>
          ) : (
            <button onClick={() => setExpanded(false)} className="text-xs text-gray-400 hover:text-gray-600 transition">← Collapse</button>
          )}
        </div>
      )}

      {expanded && correction.status === 'pending' && (
        <div className="px-5 pb-5 space-y-4 border-t border-gray-100 pt-4">
          <div>
            <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-1.5">Edit Corrected Answer</label>
            <textarea value={editedAnswer} onChange={e => setEditedAnswer(e.target.value)} rows={5} className="w-full border border-gray-200 rounded-lg px-3.5 py-3 text-xs text-gray-800 leading-relaxed focus:outline-none focus:ring-2 resize-none" style={{ '--tw-ring-color': GREEN + '40' } as any} />
          </div>
          {promptSuggestion && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 space-y-2">
              <p className="text-[11px] font-bold text-amber-800 uppercase tracking-widest">AI Prompt Suggestion</p>
              <p className="text-xs text-amber-900 leading-relaxed">{promptSuggestion}</p>
              <label className="flex items-center gap-2 cursor-pointer mt-1">
                <input type="checkbox" checked={applyPrompt} onChange={e => setApplyPrompt(e.target.checked)} className="rounded" />
                <span className="text-xs text-amber-800 font-medium">Apply this change to the system prompt</span>
              </label>
            </div>
          )}
          {correction.sourceChunks.length > 0 && <p className="text-[11px] text-gray-400">Will update: {correction.sourceChunks.map(c => c.fileName).filter((v, i, a) => a.indexOf(v) === i).join(', ')}</p>}
          {error && <p className="text-xs text-red-500">{error}</p>}
          <div className="flex gap-2">
            <button onClick={() => handleAction('approve')} disabled={acting} className="text-xs px-4 py-2 rounded-lg font-semibold text-white disabled:opacity-50 transition" style={{ background: GREEN }}>{acting ? 'Applying…' : 'Approve & Apply'}</button>
            <button onClick={() => handleAction('reject')} disabled={acting} className="text-xs px-4 py-2 border border-gray-200 text-gray-500 rounded-lg hover:border-red-300 hover:text-red-500 transition disabled:opacity-50">Reject</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function AnalyticsClient() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [messages, setMessages] = useState<QAMessage[]>([]);
  const [input, setInput] = useState('');
  const [asking, setAsking] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const [dateRange, setDateRange] = useState('all');
  const [agentFilter, setAgentFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [activeTab, setActiveTab] = useState<'analytics' | 'corrections'>('analytics');
  const [corrections, setCorrections] = useState<CorrectionEntry[]>([]);
  const [correctionsLoading, setCorrectionsLoading] = useState(false);
  const [corrStatusFilter, setCorrStatusFilter] = useState<'pending' | 'all'>('pending');

  // ── Draggable panel width ──────────────────────────────────────────────────
  const [chatWidth, setChatWidth] = useState(320);
  const dragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartW = useRef(320);

  const onDragStart = useCallback((e: React.MouseEvent) => {
    dragging.current = true;
    dragStartX.current = e.clientX;
    dragStartW.current = chatWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [chatWidth]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const delta = dragStartX.current - e.clientX; // dragging left = wider chat
      const newW = Math.max(240, Math.min(560, dragStartW.current + delta));
      setChatWidth(newW);
    };
    const onUp = () => {
      dragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, []);

  const examples = [
    'What are the most common issues agents ask about?',
    'Which agent is most active this week?',
    'Are there any queries repeating without resolution?',
    'How has usage trended over the last 2 weeks?',
  ];

  const loadStats = useCallback((dr = dateRange, af = agentFilter, cf = categoryFilter) => {
    setLoading(true);
    const filters = buildFilters(dr, af, cf);
    fetch('/api/analytics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filters: Object.keys(filters).length ? filters : undefined }),
    })
      .then(r => r.json())
      .then(d => { setStats(d.stats); setLoading(false); })
      .catch(() => setLoading(false));
  }, [dateRange, agentFilter, categoryFilter]);

  useEffect(() => { loadStats(); }, []);
  useEffect(() => { loadStats(dateRange, agentFilter, categoryFilter); }, [dateRange, agentFilter, categoryFilter]);

  const loadCorrections = useCallback(() => {
    setCorrectionsLoading(true);
    fetch(`/api/corrections?status=${corrStatusFilter}`)
      .then(r => r.json())
      .then(d => { setCorrections(d.corrections || []); setCorrectionsLoading(false); })
      .catch(() => setCorrectionsLoading(false));
  }, [corrStatusFilter]);

  useEffect(() => { if (activeTab === 'corrections') loadCorrections(); }, [activeTab, corrStatusFilter]);

  async function syncNow() {
    setSyncing(true); setSyncResult(null);
    try {
      const res = await fetch('/api/cron/sync-logs', { method: 'POST' });
      const data = await res.json();
      if (data.error) setSyncResult(`Error: ${data.error}`);
      else { setSyncResult(data.synced === 0 ? 'Already up to date.' : `Synced ${data.synced} new row${data.synced !== 1 ? 's' : ''}.`); loadStats(dateRange, agentFilter, categoryFilter); }
    } catch { setSyncResult('Sync failed.'); }
    finally { setSyncing(false); }
  }

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, asking]);

  async function ask(question: string) {
    if (!question.trim() || asking) return;
    const q = question.trim(); setInput('');
    setMessages(prev => [...prev, { role: 'user', content: q }]);
    setAsking(true);
    try {
      const filters = buildFilters(dateRange, agentFilter, categoryFilter);
      const res = await fetch('/api/analytics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q, filters: Object.keys(filters).length ? filters : undefined }),
      });
      const data = await res.json();
      setMessages(prev => [...prev, { role: 'assistant', content: data.answer || 'No answer returned.' }]);
    } catch { setMessages(prev => [...prev, { role: 'assistant', content: 'Failed. Please try again.' }]); }
    finally { setAsking(false); }
  }

  const maxDaily = stats ? Math.max(...stats.dailyTrend.map(d => d.count), 1) : 1;
  const availableAgents = stats?.availableAgents || [];
  const pendingCount = corrections.filter(c => c.status === 'pending').length;

  return (
    <div className="h-screen flex flex-col font-sans antialiased" style={{ background: BG_PAGE }}>

      {/* ── Header ── */}
      <header className="shrink-0 bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <Link href="/" className="text-gray-400 hover:text-gray-600 transition shrink-0">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4L6 9l5 5"/></svg>
          </Link>
          <div className="min-w-0">
            <h1 className="text-base font-bold text-gray-900 truncate">Usage Analytics</h1>
            <p className="text-xs text-gray-400">Wint Wealth · Admin only</p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 ml-4">
          {/* Tab switcher */}
          <div className="flex items-center bg-gray-100 rounded-lg p-0.5 gap-0.5">
            <button onClick={() => setActiveTab('analytics')} className={`text-xs px-3 py-1.5 rounded-md font-semibold transition ${activeTab === 'analytics' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>Analytics</button>
            <button onClick={() => setActiveTab('corrections')} className={`text-xs px-3 py-1.5 rounded-md font-semibold transition flex items-center gap-1.5 ${activeTab === 'corrections' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
              Corrections
              {pendingCount > 0 && <span className="text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none" style={{ background: GREEN }}>{pendingCount}</span>}
            </button>
          </div>

          {stats?.source && activeTab === 'analytics' && (
            <span className="text-xs text-gray-500 border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white">
              {stats.source === 'sheet' ? `${stats.totalInSheet?.toLocaleString()} rows · Sheet` : 'KV store'}
            </span>
          )}

          <button onClick={syncNow} disabled={syncing} className="text-xs px-3 py-1.5 rounded-lg font-semibold text-white disabled:opacity-50 transition" style={{ background: GREEN }}>
            {syncing ? 'Syncing…' : 'Sync Sheet'}
          </button>
          {syncResult && (
            <span className={`text-xs font-medium ${syncResult.startsWith('Error') ? 'text-red-500' : 'text-emerald-700'}`}>{syncResult}</span>
          )}
        </div>
      </header>

      {/* ── Body ── */}
      <div className="flex-1 flex overflow-hidden">

        {/* ── Left: scrollable analytics ── */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 min-w-0">

          {/* === ANALYTICS TAB === */}
          {activeTab === 'analytics' && (
            <>
              {/* Filter bar — single row */}
              <div className="bg-white rounded-xl border border-gray-100 shadow-sm px-4 py-3">
                <div className="flex flex-wrap items-center gap-3">
                  {/* Period */}
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider shrink-0">Period</span>
                    <div className="flex gap-1">
                      {DATE_RANGES.map(dr => (
                        <button key={dr.value} onClick={() => setDateRange(dr.value)}
                          className={`text-xs px-2.5 py-1 rounded-md font-semibold transition ${dateRange === dr.value ? 'text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
                          style={dateRange === dr.value ? { background: GREEN } : {}}>
                          {dr.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="w-px h-5 bg-gray-200 shrink-0" />

                  {/* Agent */}
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider shrink-0">Agent</span>
                    <select value={agentFilter} onChange={e => setAgentFilter(e.target.value)}
                      className="text-xs border border-gray-200 rounded-md px-2.5 py-1 bg-white text-gray-700 focus:outline-none min-w-[130px]">
                      <option value="">All agents</option>
                      {availableAgents.map(a => <option key={a} value={a}>{shortName(a)}</option>)}
                    </select>
                  </div>

                  <div className="w-px h-5 bg-gray-200 shrink-0" />

                  {/* Category */}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider shrink-0">Category</span>
                    <div className="flex gap-1 flex-wrap">
                      {CATEGORIES.map(cat => (
                        <button key={cat} onClick={() => setCategoryFilter(cat)}
                          className={`text-xs px-2.5 py-1 rounded-md font-semibold transition ${categoryFilter === cat ? 'text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
                          style={categoryFilter === cat ? { background: GREEN } : {}}>
                          {cat}
                        </button>
                      ))}
                    </div>
                  </div>

                  {(dateRange !== 'all' || agentFilter || categoryFilter !== 'All') && (
                    <button onClick={() => { setDateRange('all'); setAgentFilter(''); setCategoryFilter('All'); }}
                      className="text-xs text-gray-400 hover:text-gray-600 transition underline ml-auto">
                      Clear
                    </button>
                  )}
                </div>
              </div>

              {loading && (
                <div className="flex items-center justify-center h-40">
                  <p className="text-gray-400 text-sm animate-pulse">Loading…</p>
                </div>
              )}

              {!loading && stats && (
                <>
                  {/* Compact stat strip */}
                  <div className="grid grid-cols-4 gap-3">
                    <StatCard label="Total Queries" value={stats.totalQueries.toLocaleString()} />
                    <StatCard label="Unique Agents" value={stats.uniqueAgents} />
                    <StatCard label="Today" value={stats.queriesToday} sub="queries" />
                    <StatCard label="Most Active" value={stats.mostActiveAgent} sub="top agent" />
                  </div>

                  {/* Row: Top Agents + Top Queries */}
                  <div className="grid grid-cols-2 gap-4">

                    {/* Top Agents */}
                    <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
                      <h2 className="text-sm font-bold text-gray-900 mb-3">Top Agents</h2>
                      <div className="space-y-2.5">
                        {stats.agentBreakdown.slice(0, 6).map((row, i) => {
                          const maxCount = stats.agentBreakdown[0]?.count || 1;
                          const pct = Math.round((row.count / maxCount) * 100);
                          return (
                            <div key={row.username} className="min-w-0">
                              <div className="flex items-center justify-between mb-1 gap-2">
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className="text-[11px] font-bold text-gray-300 shrink-0 w-3">{i + 1}</span>
                                  <span className="text-xs font-semibold text-gray-800 truncate" title={row.username}>{shortName(row.username)}</span>
                                </div>
                                <span className="text-xs text-gray-400 shrink-0 tabular-nums">{row.count}</span>
                              </div>
                              <div className="ml-5 bg-gray-100 rounded-full h-1.5">
                                <div className="rounded-full h-1.5 transition-all" style={{ width: `${pct}%`, background: GREEN }} />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Top Queries */}
                    <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
                      <h2 className="text-sm font-bold text-gray-900 mb-3">Repeated Queries</h2>
                      <div className="space-y-2.5">
                        {stats.topQueries.slice(0, 6).map((q, i) => (
                          <div key={i} className="flex items-start gap-2">
                            <span className="text-[11px] font-bold text-gray-300 w-3 pt-0.5 shrink-0">{i + 1}</span>
                            <span className="flex-1 text-xs text-gray-700 leading-snug">{q.query}</span>
                            <span className="shrink-0 text-[11px] font-bold text-gray-400 tabular-nums">{q.count}×</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Row: By Category + Daily Trend */}
                  <div className="grid grid-cols-2 gap-4">

                    {/* By Category */}
                    <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
                      <h2 className="text-sm font-bold text-gray-900 mb-3">By Category</h2>
                      {(!stats.categoryBreakdown || stats.categoryBreakdown.length === 0) ? (
                        <p className="text-xs text-gray-400">No data yet.</p>
                      ) : (
                        <div className="space-y-2.5">
                          {stats.categoryBreakdown.map(c => (
                            <div key={c.category}>
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-xs font-semibold text-gray-700">{c.category}</span>
                                <span className="text-xs text-gray-400 tabular-nums">{c.count} · {c.pct}%</span>
                              </div>
                              <div className="bg-gray-100 rounded-full h-1.5">
                                <div className="rounded-full h-1.5 transition-all" style={{ width: `${c.pct}%`, background: GREEN }} />
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Daily Trend */}
                    <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
                      <h2 className="text-sm font-bold text-gray-900 mb-3">Daily Volume <span className="text-gray-400 font-normal text-xs">(14 days)</span></h2>
                      {stats.dailyTrend.length === 0 ? (
                        <p className="text-xs text-gray-400">No data yet.</p>
                      ) : (
                        <div className="space-y-1.5">
                          {stats.dailyTrend.map(d => (
                            <div key={d.date} className="flex items-center gap-2 text-xs">
                              <span className="w-10 text-gray-400 shrink-0 tabular-nums">{d.date.slice(5)}</span>
                              <div className="flex-1 bg-gray-100 rounded-full h-1.5">
                                <div className="rounded-full h-1.5 transition-all" style={{ width: `${Math.round((d.count / maxDaily) * 100)}%`, background: GREEN }} />
                              </div>
                              <span className="w-5 text-right font-semibold text-gray-600 shrink-0 tabular-nums">{d.count}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Likely Unanswered */}
                  {stats.unansweredQueries && stats.unansweredQueries.length > 0 && (
                    <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
                      <div className="flex items-center gap-2 mb-3">
                        <span className="w-1.5 h-1.5 rounded-full bg-red-400 shrink-0" />
                        <h2 className="text-sm font-bold text-gray-900">Likely Unanswered</h2>
                        <span className="text-xs text-gray-400 ml-auto">based on query keywords</span>
                      </div>
                      <div className="space-y-2">
                        {stats.unansweredQueries.slice(0, 5).map((q, i) => (
                          <div key={i} className="flex items-start gap-2">
                            <span className="text-[11px] font-bold text-red-300 w-3 pt-0.5 shrink-0">{i + 1}</span>
                            <span className="flex-1 text-xs text-gray-700 leading-snug">{q.query}</span>
                            <span className="shrink-0 text-[11px] font-bold text-red-400 tabular-nums">{q.count}×</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Recent Queries */}
                  <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
                    <h2 className="text-sm font-bold text-gray-900 mb-3">Recent Queries</h2>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-gray-100">
                            <th className="text-left pb-2 text-[11px] font-semibold text-gray-500 uppercase tracking-wider pr-4">Time</th>
                            <th className="text-left pb-2 text-[11px] font-semibold text-gray-500 uppercase tracking-wider pr-4">Agent</th>
                            <th className="text-left pb-2 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Query</th>
                          </tr>
                        </thead>
                        <tbody>
                          {stats.recentLogs.map((log, i) => (
                            <tr key={i} className="border-b border-gray-50 hover:bg-gray-50/60 transition-colors">
                              <td className="py-2 text-gray-400 whitespace-nowrap pr-4 tabular-nums">{log.timestamp.slice(0, 16).replace('T', ' ')}</td>
                              <td className="py-2 font-semibold text-gray-700 whitespace-nowrap pr-4 max-w-[140px] truncate" title={log.username}>{shortName(log.username)}</td>
                              <td className="py-2 text-gray-600 max-w-xs truncate">{log.query}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )}
            </>
          )}

          {/* === CORRECTIONS TAB === */}
          {activeTab === 'corrections' && (
            <>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <button onClick={() => setCorrStatusFilter('pending')}
                    className={`text-xs px-3 py-1.5 rounded-lg font-semibold transition ${corrStatusFilter === 'pending' ? 'text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
                    style={corrStatusFilter === 'pending' ? { background: GREEN } : {}}>
                    Pending {pendingCount > 0 && `(${pendingCount})`}
                  </button>
                  <button onClick={() => setCorrStatusFilter('all')}
                    className={`text-xs px-3 py-1.5 rounded-lg font-semibold transition ${corrStatusFilter === 'all' ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
                    All
                  </button>
                </div>
                <button onClick={loadCorrections} className="text-xs text-gray-400 hover:text-gray-600 transition">↻ Refresh</button>
              </div>

              {correctionsLoading && <div className="flex items-center justify-center h-40"><p className="text-gray-400 text-sm animate-pulse">Loading…</p></div>}
              {!correctionsLoading && corrections.length === 0 && (
                <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-10 text-center">
                  <p className="text-sm text-gray-400">No corrections {corrStatusFilter === 'pending' ? 'pending review' : 'found'}.</p>
                </div>
              )}
              {!correctionsLoading && corrections.length > 0 && (
                <div className="space-y-3">
                  {corrections.map(c => <CorrectionCard key={c.id} correction={c} onAction={loadCorrections} />)}
                </div>
              )}
            </>
          )}
        </div>

        {/* ── Drag handle ── */}
        {activeTab === 'analytics' && (
          <div
            onMouseDown={onDragStart}
            className="w-1.5 shrink-0 hover:bg-gray-300 transition-colors cursor-col-resize flex items-center justify-center group"
            style={{ background: 'transparent' }}
            title="Drag to resize"
          >
            <div className="w-0.5 h-10 rounded-full bg-gray-200 group-hover:bg-gray-400 transition-colors" />
          </div>
        )}

        {/* ── Right: Q&A panel ── */}
        {activeTab === 'analytics' && (
          <div className="shrink-0 border-l border-gray-200 bg-white flex flex-col" style={{ width: chatWidth }}>
            <div className="px-4 py-3.5 border-b border-gray-100 shrink-0">
              <h2 className="text-sm font-bold text-gray-900">Ask about the data</h2>
              <p className="text-[11px] text-gray-400 mt-0.5">Gemini Flash · over your logs</p>
            </div>

            {messages.length === 0 && (
              <div className="px-3 py-3 flex flex-col gap-1.5 shrink-0">
                {examples.map((ex, i) => (
                  <button key={i} onClick={() => ask(ex)}
                    className="text-left text-xs text-gray-600 border border-gray-100 rounded-lg px-3 py-2.5 hover:bg-gray-50 transition-colors leading-snug bg-white">
                    {ex}
                  </button>
                ))}
              </div>
            )}

            {messages.length > 0 && (
              <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2.5">
                {messages.map((m, i) => (
                  <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[85%] text-xs rounded-xl px-3.5 py-2.5 whitespace-pre-wrap leading-relaxed ${
                      m.role === 'user' ? 'text-white rounded-br-sm' : 'bg-gray-100 text-gray-800 rounded-bl-sm'
                    }`} style={m.role === 'user' ? { background: GREEN } : {}}>
                      {m.content}
                    </div>
                  </div>
                ))}
                {asking && (
                  <div className="flex justify-start">
                    <div className="bg-gray-100 rounded-xl rounded-bl-sm px-3.5 py-2.5 text-xs text-gray-400">Analysing…</div>
                  </div>
                )}
                <div ref={bottomRef} />
              </div>
            )}

            <div className="px-3 py-3 border-t border-gray-100 shrink-0 flex gap-2">
              <input
                className="flex-1 text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none bg-gray-50 placeholder:text-gray-300"
                placeholder="Ask about usage…"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !e.shiftKey && ask(input)}
                disabled={asking}
              />
              <button onClick={() => ask(input)} disabled={asking || !input.trim()}
                className="px-3 py-2 text-xs rounded-lg font-semibold text-white disabled:opacity-40 transition"
                style={{ background: GREEN }}>
                Ask
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
