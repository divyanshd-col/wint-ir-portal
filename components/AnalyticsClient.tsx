'use client';

import { useEffect, useState, useRef } from 'react';
import Link from 'next/link';

interface AgentRow {
  username: string;
  count: number;
  lastSeen: string;
  topQuery: string;
}
interface TopQuery {
  query: string;
  count: number;
  agents: string[];
}
interface DayCount {
  date: string;
  count: number;
}
interface LogEntry {
  timestamp: string;
  username: string;
  query: string;
  model: string;
}
interface Stats {
  totalQueries: number;
  uniqueAgents: number;
  queriesToday: number;
  mostActiveAgent: string;
  agentBreakdown: AgentRow[];
  topQueries: TopQuery[];
  modelDistribution: Record<string, number>;
  hourlyDistribution: number[];
  dailyTrend: DayCount[];
  recentLogs: LogEntry[];
}

interface QAMessage {
  role: 'user' | 'assistant';
  content: string;
}

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 px-5 py-4">
      <p className="text-xs text-gray-400 uppercase tracking-wide font-medium mb-1">{label}</p>
      <p className="text-2xl font-semibold text-[#1a1a1a]">{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  );
}

function MiniBar({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-6 text-gray-400 text-right shrink-0">{label}</span>
      <div className="flex-1 bg-gray-100 rounded-full h-1.5">
        <div className="bg-[#2d6a4f] rounded-full h-1.5" style={{ width: `${pct}%` }} />
      </div>
      <span className="w-6 text-gray-500 shrink-0">{value}</span>
    </div>
  );
}

export default function AnalyticsClient() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  const [messages, setMessages] = useState<QAMessage[]>([]);
  const [input, setInput] = useState('');
  const [asking, setAsking] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Example questions
  const examples = [
    'What are the most common issues agents ask about?',
    'Which agent is most active this week?',
    'What time of day is the portal used most?',
    'Are there any queries that keep repeating without resolution?',
    'How has usage trended over the last 2 weeks?',
  ];

  useEffect(() => {
    fetch('/api/analytics', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      .then(r => r.json())
      .then(d => { setStats(d.stats); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, asking]);

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

  const maxHourly = stats ? Math.max(...stats.hourlyDistribution) : 1;
  const maxDaily = stats ? Math.max(...stats.dailyTrend.map(d => d.count)) : 1;
  const totalModel = stats ? Object.values(stats.modelDistribution).reduce((a, b) => a + b, 0) : 1;

  return (
    <div className="min-h-screen bg-[#f5f5f0]">
      {/* Header */}
      <header className="bg-white border-b border-gray-100 px-6 py-3.5 flex items-center justify-between">
        <div>
          <h1 className="text-[#1a1a1a] font-semibold text-sm tracking-tight">Usage Analytics</h1>
          <p className="text-gray-400 text-xs mt-0.5">Wint Wealth · Admin only</p>
        </div>
        <Link href="/" className="text-xs text-[#2d6a4f] hover:underline font-medium">← Back to Chat</Link>
      </header>

      <div className="max-w-6xl mx-auto px-6 py-6 space-y-6">

        {loading && (
          <div className="text-center py-16 text-gray-400 text-sm">Loading analytics…</div>
        )}

        {!loading && stats && (
          <>
            {/* Stat Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard label="Total Queries" value={stats.totalQueries} />
              <StatCard label="Unique Agents" value={stats.uniqueAgents} />
              <StatCard label="Today" value={stats.queriesToday} sub="queries so far" />
              <StatCard label="Most Active" value={stats.mostActiveAgent} sub="agent" />
            </div>

            {/* Main grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

              {/* Agent Breakdown */}
              <div className="bg-white rounded-xl border border-gray-100 p-5">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">Agents</h2>
                <div className="overflow-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-gray-400 border-b border-gray-50">
                        <th className="text-left py-1.5 font-medium">Agent</th>
                        <th className="text-right py-1.5 font-medium">Queries</th>
                        <th className="text-right py-1.5 font-medium hidden sm:table-cell">Last Active</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.agentBreakdown.map(row => (
                        <tr key={row.username} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                          <td className="py-2 font-medium text-[#1a1a1a]">{row.username}</td>
                          <td className="py-2 text-right text-gray-600">{row.count}</td>
                          <td className="py-2 text-right text-gray-400 hidden sm:table-cell">
                            {row.lastSeen.slice(0, 10)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Top Queries */}
              <div className="bg-white rounded-xl border border-gray-100 p-5">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">Top Queries</h2>
                <div className="space-y-2 overflow-auto max-h-64">
                  {stats.topQueries.map((q, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs py-1 border-b border-gray-50">
                      <span className="text-gray-300 font-medium w-4 shrink-0">{i + 1}</span>
                      <span className="flex-1 text-[#1a1a1a] line-clamp-2">{q.query}</span>
                      <span className="text-gray-400 shrink-0">{q.count}×</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Hourly Distribution */}
              <div className="bg-white rounded-xl border border-gray-100 p-5">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">Hourly Activity</h2>
                <div className="space-y-1">
                  {[...Array(24)].map((_, h) => (
                    <MiniBar
                      key={h}
                      value={stats.hourlyDistribution[h]}
                      max={maxHourly}
                      label={`${h.toString().padStart(2, '0')}`}
                    />
                  ))}
                </div>
              </div>

              {/* Daily Trend + Model Distribution */}
              <div className="flex flex-col gap-4">
                <div className="bg-white rounded-xl border border-gray-100 p-5">
                  <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">Daily Trend (14d)</h2>
                  <div className="space-y-1">
                    {stats.dailyTrend.map(d => (
                      <MiniBar key={d.date} value={d.count} max={maxDaily} label={d.date.slice(5)} />
                    ))}
                    {stats.dailyTrend.length === 0 && (
                      <p className="text-xs text-gray-400">No data yet.</p>
                    )}
                  </div>
                </div>

                <div className="bg-white rounded-xl border border-gray-100 p-5">
                  <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">Model Usage</h2>
                  <div className="space-y-2">
                    {Object.entries(stats.modelDistribution).map(([m, c]) => (
                      <div key={m} className="flex items-center gap-3 text-xs">
                        <span className="w-14 text-gray-600 capitalize">{m}</span>
                        <div className="flex-1 bg-gray-100 rounded-full h-2">
                          <div
                            className="rounded-full h-2"
                            style={{
                              width: `${Math.round((c / totalModel) * 100)}%`,
                              backgroundColor: m === 'claude' ? '#7c5cbf' : '#2d6a4f',
                            }}
                          />
                        </div>
                        <span className="text-gray-400 w-20 text-right">
                          {c} ({Math.round((c / totalModel) * 100)}%)
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Recent Logs */}
            <div className="bg-white rounded-xl border border-gray-100 p-5">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">Recent Queries</h2>
              <div className="overflow-auto max-h-56">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-gray-400 border-b border-gray-50">
                      <th className="text-left py-1.5 font-medium">Time</th>
                      <th className="text-left py-1.5 font-medium">Agent</th>
                      <th className="text-left py-1.5 font-medium">Query</th>
                      <th className="text-left py-1.5 font-medium hidden sm:table-cell">Model</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.recentLogs.map((log, i) => (
                      <tr key={i} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                        <td className="py-1.5 text-gray-400 whitespace-nowrap">{log.timestamp.slice(0, 16).replace('T', ' ')}</td>
                        <td className="py-1.5 text-[#1a1a1a] font-medium whitespace-nowrap">{log.username}</td>
                        <td className="py-1.5 text-gray-600 max-w-xs truncate">{log.query}</td>
                        <td className="py-1.5 text-gray-400 hidden sm:table-cell">{log.model}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {/* Q&A Section */}
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-50">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400">Ask about the data</h2>
            <p className="text-xs text-gray-400 mt-0.5">Ask any analytical question — powered by Gemini Flash over your logs.</p>
          </div>

          {/* Example chips */}
          {messages.length === 0 && (
            <div className="px-5 pt-4 pb-2 flex flex-wrap gap-2">
              {examples.map((ex, i) => (
                <button
                  key={i}
                  onClick={() => ask(ex)}
                  className="text-xs bg-gray-50 hover:bg-gray-100 text-gray-600 border border-gray-200 rounded-full px-3 py-1.5 transition-colors"
                >
                  {ex}
                </button>
              ))}
            </div>
          )}

          {/* Messages */}
          {messages.length > 0 && (
            <div className="px-5 py-4 space-y-4 max-h-96 overflow-y-auto">
              {messages.map((m, i) => (
                <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-2xl text-sm rounded-xl px-4 py-2.5 whitespace-pre-wrap ${
                      m.role === 'user'
                        ? 'bg-[#2d6a4f] text-white'
                        : 'bg-gray-50 text-[#1a1a1a] border border-gray-100'
                    }`}
                  >
                    {m.content}
                  </div>
                </div>
              ))}
              {asking && (
                <div className="flex justify-start">
                  <div className="bg-gray-50 border border-gray-100 rounded-xl px-4 py-2.5 text-sm text-gray-400">
                    Analysing…
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>
          )}

          {/* Input */}
          <div className="px-5 py-3 border-t border-gray-50 flex gap-2">
            <input
              className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-[#2d6a4f] placeholder:text-gray-300"
              placeholder="e.g. What does Priya ask most often?"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && ask(input)}
              disabled={asking}
            />
            <button
              onClick={() => ask(input)}
              disabled={asking || !input.trim()}
              className="px-4 py-2 bg-[#2d6a4f] text-white text-sm rounded-lg hover:bg-[#245a41] disabled:opacity-40 transition-colors font-medium"
            >
              Ask
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
