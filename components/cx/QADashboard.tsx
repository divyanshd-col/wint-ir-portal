'use client';

import { useEffect, useState, useCallback } from 'react';

interface AgentRow {
  agent_id: string;
  display_name: string;
  week_start: string;
  qa_score: number | null;
  qa_audit_count: number;
  csat_avg: number | null;
  csat_response_count: number;
  volume: number;
  cx_benchmark: {
    qa: number | null;
    csat: number | null;
    volume: number | null;
  };
}

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

function DeltaCell({ value, benchmark, format }: { value: number | null; benchmark: number | null; format: 'score' | 'csat' | 'count' }) {
  const formatVal = (v: number | null) => {
    if (v === null) return '—';
    if (format === 'score') return `${v.toFixed(1)}%`;
    if (format === 'csat') return v.toFixed(2);
    return Math.round(v).toString();
  };

  const isAbove = value !== null && benchmark !== null && value > benchmark;
  const isBelow = value !== null && benchmark !== null && value < benchmark;

  return (
    <td className="px-4 py-3 tabular-nums">
      <span className={`font-medium ${isAbove ? 'text-emerald-400' : isBelow ? 'text-red-400' : 'text-gray-300'}`}>
        {formatVal(value)}
      </span>
      {benchmark !== null && (
        <span className="text-gray-600 text-xs ml-1">/ {formatVal(benchmark)}</span>
      )}
    </td>
  );
}

export default function QADashboard() {
  const currentWeek = getWeekStart();
  const [selectedWeek, setSelectedWeek] = useState(currentWeek);
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async (week: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/cx/qa/agents-vs-benchmark?week_start=${week}`);
      if (!res.ok) throw new Error(await res.text());
      setAgents(await res.json());
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(selectedWeek); }, [selectedWeek, fetchData]);

  const isCurrentWeek = selectedWeek === currentWeek;
  const canGoNext = selectedWeek < currentWeek;

  const benchmark = agents[0]?.cx_benchmark ?? { qa: null, csat: null, volume: null };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-white">My Agents — QA View</h1>
          <p className="text-gray-500 text-sm mt-0.5">{agents.length} agent{agents.length !== 1 ? 's' : ''} assigned</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setSelectedWeek(addWeeks(selectedWeek, -1))}
            className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white transition"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M10 12L6 8l4-4"/>
            </svg>
          </button>
          <span className="text-sm text-gray-300 min-w-[160px] text-center">
            {formatWeekLabel(selectedWeek, isCurrentWeek)}
          </span>
          <button
            onClick={() => canGoNext && setSelectedWeek(addWeeks(selectedWeek, 1))}
            disabled={!canGoNext}
            className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white transition disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M6 4l4 4-4 4"/>
            </svg>
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-900/20 border border-red-500/30 rounded-lg p-3 text-red-400 text-sm">{error}</div>
      )}

      <div className="bg-[#1e1e1e] border border-white/10 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10">
              <th className="px-4 py-3 text-left text-gray-500 font-medium text-xs uppercase tracking-wider">Agent</th>
              <th className="px-4 py-3 text-left text-gray-500 font-medium text-xs uppercase tracking-wider">
                QA Score
                {benchmark.qa !== null && <span className="text-gray-600 normal-case ml-1">(CX avg: {benchmark.qa.toFixed(1)}%)</span>}
              </th>
              <th className="px-4 py-3 text-left text-gray-500 font-medium text-xs uppercase tracking-wider">
                CSAT
                {benchmark.csat !== null && <span className="text-gray-600 normal-case ml-1">(CX avg: {benchmark.csat.toFixed(2)})</span>}
              </th>
              <th className="px-4 py-3 text-left text-gray-500 font-medium text-xs uppercase tracking-wider">
                Volume
                {benchmark.volume !== null && <span className="text-gray-600 normal-case ml-1">(CX avg: {benchmark.volume.toFixed(0)})</span>}
              </th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              [...Array(3)].map((_, i) => (
                <tr key={i} className="border-b border-white/5">
                  <td className="px-4 py-3" colSpan={4}>
                    <div className="h-4 bg-white/5 rounded animate-pulse w-3/4" />
                  </td>
                </tr>
              ))
            ) : agents.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-gray-600">No agents found</td>
              </tr>
            ) : (
              agents.map(agent => (
                <tr key={agent.agent_id} className="border-b border-white/5 hover:bg-white/3 transition">
                  <td className="px-4 py-3 text-gray-200 font-medium">{agent.display_name}</td>
                  <DeltaCell value={agent.qa_score} benchmark={agent.cx_benchmark.qa} format="score" />
                  <DeltaCell value={agent.csat_avg} benchmark={agent.cx_benchmark.csat} format="csat" />
                  <DeltaCell value={agent.volume} benchmark={agent.cx_benchmark.volume} format="count" />
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
