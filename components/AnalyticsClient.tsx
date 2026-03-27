'use client';

import { useEffect, useState, useRef } from 'react';
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
}
interface QAMessage { role: 'user' | 'assistant'; content: string; }

const CAT_COLORS: Record<string, string> = {
  'Repayment': '#16a34a',
  'Account & KYC': '#2563eb',
  'Investment': '#7c3aed',
  'Withdrawal': '#ea580c',
  'Platform Issue': '#dc2626',
  'General': '#6b7280',
};

function StatCard({ label, value, sub, accent }: { label: string; value: string | number; sub?: string; accent?: string }) {
  return (
    <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100" style={{ borderLeftColor: accent, borderLeftWidth: accent ? 4 : 1 }}>
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2">{label}</p>
      <p className="text-3xl font-bold text-gray-900 tracking-tight">{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  );
}

export default function AnalyticsClient() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [messages, setMessages] = useState<QAMessage[]>([]);
  const [input, setInput] = useState('');
  const [asking, setAsking] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const examples = [
    'What are the most common issues agents ask about?',
    'Which agent is most active this week?',
    'Are there any queries that keep repeating without resolution?',
    'How has usage trended over the last 2 weeks?',
  ];

  function loadStats() {
    setLoading(true);
    fetch('/api/analytics', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      .then(r => r.json())
      .then(d => { setStats(d.stats); setLoading(false); })
      .catch(() => setLoading(false));
  }

  useEffect(() => { loadStats(); }, []);

  async function syncNow() {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch('/api/cron/sync-logs', { method: 'POST' });
      const data = await res.json();
      if (data.error) {
        setSyncResult(`Error: ${data.error}`);
      } else {
        setSyncResult(data.synced === 0 ? 'Already up to date.' : `Synced ${data.synced} new row${data.synced !== 1 ? 's' : ''}.`);
        loadStats();
      }
    } catch {
      setSyncResult('Sync failed.');
    } finally {
      setSyncing(false);
    }
  }

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, asking]);

  async function ask(question: string) {
    if (!question.trim() || asking) return;
    const q = question.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: q }]);
    setAsking(true);
    try {
      const res = await fetch('/api/analytics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q }),
      });
      const data = await res.json();
      setMessages(prev => [...prev, { role: 'assistant', content: data.answer || 'No answer returned.' }]);
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Failed to get an answer. Please try again.' }]);
    } finally {
      setAsking(false);
    }
  }

  const maxDaily = stats ? Math.max(...stats.dailyTrend.map(d => d.count), 1) : 1;
  const totalModel = stats ? Object.values(stats.modelDistribution).reduce((a, b) => a + b, 0) || 1 : 1;

  return (
    <div className="h-screen flex flex-col bg-gray-50 font-sans antialiased">

      {/* Header */}
      <header className="shrink-0 bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-gray-400 hover:text-gray-600 transition">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M11 4L6 9l5 5"/>
            </svg>
          </Link>
          <div>
            <h1 className="text-base font-bold text-gray-900 tracking-tight">Usage Analytics</h1>
            <p className="text-xs text-gray-400">Wint Wealth · Admin only</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {stats && (
            <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${stats.source === 'sheet' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-amber-50 text-amber-700 border border-amber-200'}`}>
              {stats.source === 'sheet' ? `${stats.totalInSheet?.toLocaleString()} rows · Google Sheet` : 'KV store'}
            </span>
          )}
          <button
            onClick={syncNow}
            disabled={syncing}
            className="text-xs px-3 py-1.5 bg-[#2d6a4f] text-white rounded-lg hover:bg-[#245a41] disabled:opacity-50 transition font-semibold"
          >
            {syncing ? 'Syncing…' : 'Sync Sheet'}
          </button>
          {syncResult && (
            <span className={`text-xs font-medium ${syncResult.startsWith('Error') ? 'text-red-500' : 'text-green-600'}`}>{syncResult}</span>
          )}
        </div>
      </header>

      {/* Body */}
      <div className="flex-1 flex overflow-hidden">

        {/* Left: scrollable stats */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

          {loading && (
            <div className="flex items-center justify-center h-40">
              <p className="text-gray-400 text-sm animate-pulse">Loading analytics…</p>
            </div>
          )}

          {!loading && stats && (
            <>
              {/* Stat cards */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard label="Total Queries" value={stats.totalQueries.toLocaleString()} accent="#2d6a4f" />
                <StatCard label="Unique Agents" value={stats.uniqueAgents} accent="#2563eb" />
                <StatCard label="Today" value={stats.queriesToday} sub="queries" accent="#7c3aed" />
                <StatCard label="Most Active" value={stats.mostActiveAgent} sub="top agent" accent="#ea580c" />
              </div>

              {/* Row: Agents + Top Queries */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

                {/* Top 5 Agents */}
                <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
                  <h2 className="text-sm font-bold text-gray-900 mb-4">Top Agents</h2>
                  {stats.agentBreakdown.slice(0, 5).map((row, i) => {
                    const maxCount = stats.agentBreakdown[0]?.count || 1;
                    const pct = Math.round((row.count / maxCount) * 100);
                    return (
                      <div key={row.username} className="mb-3 last:mb-0">
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-gray-300 w-4">{i + 1}</span>
                            <span className="text-sm font-semibold text-gray-800">{row.username}</span>
                          </div>
                          <span className="text-xs font-bold text-gray-500">{row.count} queries</span>
                        </div>
                        <div className="ml-6 bg-gray-100 rounded-full h-1.5">
                          <div className="bg-[#2d6a4f] rounded-full h-1.5 transition-all" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Top 5 Queries */}
                <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
                  <h2 className="text-sm font-bold text-gray-900 mb-4">Top Queries</h2>
                  <div className="space-y-2.5">
                    {stats.topQueries.slice(0, 5).map((q, i) => (
                      <div key={i} className="flex items-start gap-3">
                        <span className="text-xs font-bold text-gray-300 w-4 pt-0.5 shrink-0">{i + 1}</span>
                        <span className="flex-1 text-sm text-gray-700 leading-snug">{q.query}</span>
                        <span className="shrink-0 text-xs font-bold bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{q.count}×</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Row: Unanswered + Category */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

                {/* Top 5 Unanswered */}
                <div className="bg-white rounded-2xl p-5 shadow-sm border border-red-100">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-2 h-2 rounded-full bg-red-500" />
                    <h2 className="text-sm font-bold text-gray-900">Likely Unanswered</h2>
                    <span className="text-xs text-gray-400 ml-auto">based on query keywords</span>
                  </div>
                  {(!stats.unansweredQueries || stats.unansweredQueries.length === 0) ? (
                    <p className="text-sm text-gray-400">No problem queries detected.</p>
                  ) : (
                    <div className="space-y-2.5">
                      {stats.unansweredQueries.slice(0, 5).map((q, i) => (
                        <div key={i} className="flex items-start gap-3">
                          <span className="text-xs font-bold text-red-300 w-4 pt-0.5 shrink-0">{i + 1}</span>
                          <span className="flex-1 text-sm text-gray-700 leading-snug">{q.query}</span>
                          <span className="shrink-0 text-xs font-bold bg-red-50 text-red-500 px-2 py-0.5 rounded-full">{q.count}×</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* By Category */}
                <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
                  <h2 className="text-sm font-bold text-gray-900 mb-4">By Category</h2>
                  {(!stats.categoryBreakdown || stats.categoryBreakdown.length === 0) ? (
                    <p className="text-sm text-gray-400">No data yet.</p>
                  ) : (
                    <div className="space-y-3">
                      {stats.categoryBreakdown.map(c => (
                        <div key={c.category}>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-sm font-semibold text-gray-700">{c.category}</span>
                            <span className="text-xs font-bold text-gray-400">{c.count} · {c.pct}%</span>
                          </div>
                          <div className="bg-gray-100 rounded-full h-2">
                            <div
                              className="rounded-full h-2 transition-all"
                              style={{ width: `${c.pct}%`, backgroundColor: CAT_COLORS[c.category] || '#6b7280' }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Row: Daily trend + Model */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
                  <h2 className="text-sm font-bold text-gray-900 mb-4">Daily Trend (14 days)</h2>
                  {stats.dailyTrend.length === 0 ? (
                    <p className="text-sm text-gray-400">No data yet.</p>
                  ) : (
                    <div className="space-y-1.5">
                      {stats.dailyTrend.map(d => (
                        <div key={d.date} className="flex items-center gap-3 text-xs">
                          <span className="w-12 text-gray-400 shrink-0">{d.date.slice(5)}</span>
                          <div className="flex-1 bg-gray-100 rounded-full h-2">
                            <div className="bg-[#2d6a4f] rounded-full h-2" style={{ width: `${Math.round((d.count / maxDaily) * 100)}%` }} />
                          </div>
                          <span className="w-6 text-right font-semibold text-gray-600 shrink-0">{d.count}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
                  <h2 className="text-sm font-bold text-gray-900 mb-4">Model Usage</h2>
                  <div className="space-y-3">
                    {Object.entries(stats.modelDistribution).map(([m, c]) => (
                      <div key={m}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-semibold text-gray-700 capitalize">{m}</span>
                          <span className="text-xs font-bold text-gray-400">{c} · {Math.round((c / totalModel) * 100)}%</span>
                        </div>
                        <div className="bg-gray-100 rounded-full h-2">
                          <div
                            className="rounded-full h-2"
                            style={{ width: `${Math.round((c / totalModel) * 100)}%`, backgroundColor: m === 'claude' ? '#7c3aed' : '#2d6a4f' }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Recent logs */}
              <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
                <h2 className="text-sm font-bold text-gray-900 mb-4">Recent Queries</h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100">
                        <th className="text-left py-2 text-xs font-semibold text-gray-400 uppercase tracking-wide">Time</th>
                        <th className="text-left py-2 text-xs font-semibold text-gray-400 uppercase tracking-wide">Agent</th>
                        <th className="text-left py-2 text-xs font-semibold text-gray-400 uppercase tracking-wide">Query</th>
                        <th className="text-left py-2 text-xs font-semibold text-gray-400 uppercase tracking-wide hidden sm:table-cell">Model</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.recentLogs.map((log, i) => (
                        <tr key={i} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                          <td className="py-2 text-gray-400 text-xs whitespace-nowrap">{log.timestamp.slice(0, 16).replace('T', ' ')}</td>
                          <td className="py-2 font-semibold text-gray-800 whitespace-nowrap text-xs">{log.username}</td>
                          <td className="py-2 text-gray-600 max-w-xs truncate text-xs">{log.query}</td>
                          <td className="py-2 text-gray-400 text-xs hidden sm:table-cell">{log.model}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Right: sticky Q&A */}
        <div className="w-[360px] shrink-0 border-l border-gray-200 bg-white flex flex-col">
          <div className="px-5 py-4 border-b border-gray-100 shrink-0">
            <h2 className="text-sm font-bold text-gray-900">Ask about the data</h2>
            <p className="text-xs text-gray-400 mt-0.5">Powered by Gemini Flash over your logs</p>
          </div>

          {messages.length === 0 && (
            <div className="px-4 py-4 flex flex-col gap-2 shrink-0">
              {examples.map((ex, i) => (
                <button
                  key={i}
                  onClick={() => ask(ex)}
                  className="text-left text-xs bg-gray-50 hover:bg-gray-100 text-gray-600 border border-gray-200 rounded-xl px-3 py-2.5 transition-colors leading-snug"
                >
                  {ex}
                </button>
              ))}
            </div>
          )}

          {messages.length > 0 && (
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
              {messages.map((m, i) => (
                <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[280px] text-xs rounded-2xl px-4 py-3 whitespace-pre-wrap leading-relaxed ${
                    m.role === 'user'
                      ? 'bg-[#2d6a4f] text-white rounded-br-sm'
                      : 'bg-gray-100 text-gray-800 rounded-bl-sm'
                  }`}>
                    {m.content}
                  </div>
                </div>
              ))}
              {asking && (
                <div className="flex justify-start">
                  <div className="bg-gray-100 rounded-2xl rounded-bl-sm px-4 py-3 text-xs text-gray-400">Analysing…</div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>
          )}

          {messages.length > 0 && !asking && (
            <div className="shrink-0" />
          )}

          <div className="px-4 py-3 border-t border-gray-100 shrink-0 flex gap-2">
            <input
              className="flex-1 text-xs border border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-[#2d6a4f]/30 placeholder:text-gray-300 bg-gray-50"
              placeholder="e.g. What does Priya ask most often?"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && ask(input)}
              disabled={asking}
            />
            <button
              onClick={() => ask(input)}
              disabled={asking || !input.trim()}
              className="px-3 py-2.5 bg-[#2d6a4f] text-white text-xs rounded-xl hover:bg-[#245a41] disabled:opacity-40 transition font-semibold"
            >
              Ask
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
