'use client';

import { useEffect, useState, useCallback } from 'react';
import MetricCard from './MetricCard';
import WoWChart from './WoWChart';

interface PerformancePoint {
  week_start: string;
  in_progress: boolean;
  qa_score: number | null;
  csat_avg: number | null;
  volume: number;
  cx_benchmark: { qa: number | null; csat: number | null; volume: number | null };
  wow_delta: { qa: number | null; csat: number | null; volume: number } | null;
}

interface Top3Data {
  week_start: string;
  top3: { rank: number; composite_score: number }[];
  my_rank: number | null;
  my_composite_score: number | null;
  my_metrics_used: string[];
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

export default function AgentDashboard() {
  const currentWeek = getWeekStart();
  const [selectedWeek, setSelectedWeek] = useState(currentWeek);
  const [performance, setPerformance] = useState<PerformancePoint[]>([]);
  const [top3, setTop3] = useState<Top3Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async (week: string) => {
    setLoading(true);
    setError(null);
    try {
      const from = addWeeks(week, -8);
      const [perfRes, top3Res] = await Promise.all([
        fetch(`/api/cx/agent/my-performance?from=${from}&to=${week}`),
        fetch(`/api/cx/agent/top3?week_start=${week}`),
      ]);
      if (!perfRes.ok) throw new Error(await perfRes.text());
      if (!top3Res.ok) throw new Error(await top3Res.text());
      const [perfData, top3Data] = await Promise.all([perfRes.json(), top3Res.json()]);
      setPerformance(perfData);
      setTop3(top3Data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(selectedWeek); }, [selectedWeek, fetchData]);

  const isCurrentWeek = selectedWeek === currentWeek;
  const canGoNext = selectedWeek < currentWeek;

  // Current week's data point
  const currentPoint = performance.find(p => p.week_start === selectedWeek)
    ?? performance[performance.length - 1]
    ?? null;

  const wowDelta = currentPoint?.wow_delta ?? null;

  const chartData = performance.map(p => ({
    week_start: p.week_start,
    qa: p.qa_score,
    csat: p.csat_avg,
    volume: p.volume,
    in_progress: p.in_progress,
  }));

  const missingMetrics = top3?.my_metrics_used && top3.my_metrics_used.length < 3
    ? ['qa', 'csat', 'volume'].filter(m => !top3.my_metrics_used.includes(m))
    : [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-white">My Performance</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setSelectedWeek(addWeeks(selectedWeek, -1))}
            className="p-1.5 rounded-lg bg-white/5 hover:bg-stone-100 text-stone-400 hover:text-white transition"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M10 12L6 8l4-4"/>
            </svg>
          </button>
          <span className="text-sm text-stone-600 min-w-[160px] text-center">
            {formatWeekLabel(selectedWeek, isCurrentWeek)}
          </span>
          <button
            onClick={() => canGoNext && setSelectedWeek(addWeeks(selectedWeek, 1))}
            disabled={!canGoNext}
            className="p-1.5 rounded-lg bg-white/5 hover:bg-stone-100 text-stone-400 hover:text-white transition disabled:opacity-30 disabled:cursor-not-allowed"
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

      {/* Metric cards */}
      {loading ? (
        <div className="grid grid-cols-3 gap-4">
          {[0, 1, 2].map(i => (
            <div key={i} className="bg-white border border-stone-200 rounded-xl p-4 h-24 animate-pulse" />
          ))}
        </div>
      ) : currentPoint ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <MetricCard
            label="QA Score"
            value={currentPoint.qa_score}
            benchmark={currentPoint.cx_benchmark.qa}
            wowDelta={wowDelta?.qa ?? null}
            format="score"
          />
          <MetricCard
            label="CSAT"
            value={currentPoint.csat_avg}
            benchmark={currentPoint.cx_benchmark.csat}
            wowDelta={wowDelta?.csat ?? null}
            format="csat"
          />
          <MetricCard
            label="Tickets Resolved"
            value={currentPoint.volume}
            benchmark={currentPoint.cx_benchmark.volume}
            wowDelta={typeof wowDelta?.volume === 'number' ? wowDelta.volume : null}
            format="count"
          />
        </div>
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Chart */}
        <div className="lg:col-span-2 bg-white border border-stone-200 rounded-xl p-4">
          <h2 className="text-sm font-medium text-stone-400 mb-4">Week-over-Week Trend</h2>
          {chartData.length > 0 ? (
            <WoWChart data={chartData} metrics={['qa', 'csat', 'volume']} />
          ) : (
            <p className="text-stone-400 text-sm text-center py-8">No trend data available</p>
          )}
        </div>

        {/* Leaderboard */}
        <div className="bg-white border border-stone-200 rounded-xl p-4">
          <h2 className="text-sm font-medium text-stone-400 mb-4">Top Performers</h2>
          {loading ? (
            <div className="space-y-2">
              {[0, 1, 2].map(i => <div key={i} className="h-8 bg-white/5 rounded animate-pulse" />)}
            </div>
          ) : top3 && top3.top3.length > 0 ? (
            <div className="space-y-2">
              {top3.top3.map(entry => (
                <div key={entry.rank} className="flex items-center justify-between px-3 py-2 rounded-lg bg-white/5">
                  <span className="text-stone-400 text-sm font-medium">
                    {entry.rank === 1 ? '🥇' : entry.rank === 2 ? '🥈' : '🥉'} #{entry.rank}
                  </span>
                  <span className="text-white text-sm tabular-nums font-semibold">
                    {entry.composite_score.toFixed(2)}
                  </span>
                </div>
              ))}

              <div className="mt-3 pt-3 border-t border-stone-200">
                {top3.my_rank !== null ? (
                  <div className="flex items-center justify-between">
                    <span className="text-stone-400 text-sm">Your rank</span>
                    <span className="text-white text-sm font-semibold tabular-nums">
                      #{top3.my_rank} — {top3.my_composite_score?.toFixed(2) ?? '—'}
                    </span>
                  </div>
                ) : (
                  <p className="text-stone-400 text-sm text-center">Not ranked this week</p>
                )}
                {missingMetrics.length > 0 && (
                  <p className="text-stone-400 text-xs mt-1.5">
                    Score based on: {top3.my_metrics_used.join(', ') || 'none'}
                    {' '}(missing: {missingMetrics.join(', ')})
                  </p>
                )}
              </div>
            </div>
          ) : (
            <p className="text-stone-400 text-sm text-center py-4">No rankings available</p>
          )}
        </div>
      </div>
    </div>
  );
}
