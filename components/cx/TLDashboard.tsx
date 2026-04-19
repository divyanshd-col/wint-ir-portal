'use client';

import { useEffect, useState, useCallback } from 'react';
import MetricCard from './MetricCard';
import WoWChart from './WoWChart';

interface TeamVsBenchmarkMetrics {
  team_avg: number | null;
  cx_avg: number | null;
  delta: number | null;
}

interface TeamVsBenchmarkData {
  week_start: string;
  team_agent_count: number;
  metrics: {
    qa: TeamVsBenchmarkMetrics;
    csat: TeamVsBenchmarkMetrics;
    volume: TeamVsBenchmarkMetrics;
  };
}

interface WoWPoint {
  week_start: string;
  in_progress: boolean;
  metrics: {
    qa: TeamVsBenchmarkMetrics;
    csat: TeamVsBenchmarkMetrics;
    volume: TeamVsBenchmarkMetrics;
  };
  wow_delta: { qa: number | null; csat: number | null; volume: number | null } | null;
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

export default function TLDashboard() {
  const currentWeek = getWeekStart();
  const [selectedWeek, setSelectedWeek] = useState(currentWeek);
  const [summary, setSummary] = useState<TeamVsBenchmarkData | null>(null);
  const [trend, setTrend] = useState<WoWPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async (week: string) => {
    setLoading(true);
    setError(null);
    try {
      const [sumRes, trendRes] = await Promise.all([
        fetch(`/api/cx/tl/team-vs-benchmark?week_start=${week}`),
        fetch(`/api/cx/tl/wow-trend?from=${addWeeks(week, -8)}&to=${week}`),
      ]);
      if (!sumRes.ok) throw new Error(await sumRes.text());
      if (!trendRes.ok) throw new Error(await trendRes.text());
      const [sumData, trendData] = await Promise.all([sumRes.json(), trendRes.json()]);
      setSummary(sumData);
      setTrend(trendData);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(selectedWeek); }, [selectedWeek, fetchData]);

  const isCurrentWeek = selectedWeek === currentWeek;
  const canGoNext = selectedWeek < currentWeek;

  const wowDelta = trend.length >= 2
    ? trend[trend.length - (isCurrentWeek ? 1 : 1)]?.wow_delta
    : null;

  const chartData = trend.map(t => ({
    week_start: t.week_start,
    qa: t.metrics.qa.team_avg,
    csat: t.metrics.csat.team_avg,
    volume: t.metrics.volume.team_avg,
    in_progress: t.in_progress,
  }));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-white">Team Performance</h1>
          {summary && (
            <p className="text-gray-500 text-sm mt-0.5">{summary.team_agent_count} active agents</p>
          )}
        </div>
        {/* Week selector */}
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

      {loading ? (
        <div className="grid grid-cols-3 gap-4">
          {[0, 1, 2].map(i => (
            <div key={i} className="bg-[#1e1e1e] border border-white/10 rounded-xl p-4 h-24 animate-pulse" />
          ))}
        </div>
      ) : summary ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <MetricCard
            label="QA Score"
            value={summary.metrics.qa.team_avg}
            benchmark={summary.metrics.qa.cx_avg}
            wowDelta={wowDelta?.qa ?? null}
            format="score"
          />
          <MetricCard
            label="CSAT"
            value={summary.metrics.csat.team_avg}
            benchmark={summary.metrics.csat.cx_avg}
            wowDelta={wowDelta?.csat ?? null}
            format="csat"
          />
          <MetricCard
            label="Tickets Resolved"
            value={summary.metrics.volume.team_avg}
            benchmark={summary.metrics.volume.cx_avg}
            wowDelta={wowDelta?.volume ?? null}
            format="count"
          />
        </div>
      ) : null}

      {/* Trend chart */}
      <div className="bg-[#1e1e1e] border border-white/10 rounded-xl p-4">
        <h2 className="text-sm font-medium text-gray-400 mb-4">Week-over-Week Trend (last 8 weeks)</h2>
        {chartData.length > 0 ? (
          <WoWChart data={chartData} metrics={['qa', 'csat', 'volume']} />
        ) : (
          <p className="text-gray-600 text-sm text-center py-8">No trend data available</p>
        )}
      </div>
    </div>
  );
}
