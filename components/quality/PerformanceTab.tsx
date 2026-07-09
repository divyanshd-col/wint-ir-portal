'use client';

import React, { useMemo } from 'react';
import { useQuality } from './QualityContext';
import { PARAM_ORDER, PARAM_NAMES, fmtDuration, iqsTheme } from '@/lib/quality';
import type { IQSScoreEntry } from '@/lib/quality';
import { IQSRing, IQSPill } from '@/components/quality/IQSRing';
import type { AgentStat } from './types';
import { DEFAULT_FILTERS } from './types';

// ── Agent Card ────────────────────────────────────────────────────────────────
export function AgentCard({
  stat,
  entries,
  teamParamFails,
  onFilterLog,
  onViewReport,
}: {
  stat: AgentStat;
  entries: IQSScoreEntry[];
  teamParamFails?: Record<string, number>;
  onFilterLog?: (f: { agent: string; minScore?: number; maxScore?: number }) => void;
  onViewReport?: (stat: AgentStat) => void;
}) {
  const agentEntries = entries.filter(e => (e.agentName || 'Unknown') === stat.agent);

  const paramData = useMemo(() => PARAM_ORDER.map(p => {
    const n = agentEntries.filter(e => e.scores[p] === 'No').length;
    return { p, failPct: agentEntries.length ? Math.round(n / agentEntries.length * 100) : 0 };
  }).sort((a, b) => b.failPct - a.failPct), [agentEntries]);

  const topFails = paramData.filter(d => d.failPct > 0).slice(0, 4);
  const isAtRisk = stat.avgIqs < 70;

  return (
    <div className={`bg-white rounded-2xl shadow-sm overflow-hidden border ${isAtRisk ? 'border-red-200' : 'border-gray-100'}`}>
      <div
        className={`px-5 pt-5 pb-4 ${isAtRisk ? 'bg-red-50/40' : ''} ${onViewReport ? 'cursor-pointer hover:bg-gray-50/60 transition' : ''}`}
        onClick={() => onViewReport?.(stat)}
      >
        <div className="flex items-start gap-3">
          <div className="shrink-0"><IQSRing iqs={stat.avgIqs} size={56} /></div>
          <div className="flex-1 min-w-0 pt-0.5">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-bold text-gray-900 text-sm truncate">{stat.agent}</p>
              {isAtRisk && (
                <span className="text-[10px] font-bold bg-red-100 text-red-600 px-2 py-0.5 rounded-full shrink-0">⚠ At Risk</span>
              )}
            </div>
            <p className="text-xs text-gray-500 mt-0.5">{stat.chats} chats · range {stat.minIqs}–{stat.maxIqs}%</p>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              {stat.high > 0 && (
                <button
                  className="text-[10px] bg-emerald-50 text-emerald-700 font-semibold px-2 py-0.5 rounded-full cursor-pointer hover:opacity-80"
                  onClick={(e) => {
                    e.stopPropagation();
                    onFilterLog?.({ agent: stat.agent, minScore: 90 });
                  }}
                >
                  {stat.high} excellent
                </button>
              )}
              {stat.atRisk > 0 && (
                <button
                  className="text-[10px] bg-red-50 text-red-600 font-semibold px-2 py-0.5 rounded-full cursor-pointer hover:opacity-80"
                  onClick={(e) => {
                    e.stopPropagation();
                    onFilterLog?.({ agent: stat.agent, maxScore: 69 });
                  }}
                >
                  {stat.atRisk} need review
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="border-t border-gray-100 bg-gray-50/40 px-5 py-3.5">
        {topFails.length === 0 ? (
          <p className="text-xs text-emerald-600 font-semibold text-center py-1">✓ No consistent failure areas</p>
        ) : (
          <>
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2.5">Coaching Focus</p>
            <div className="space-y-1.5">
              {topFails.map(({ p, failPct }) => {
                const teamPct = teamParamFails ? (teamParamFails[p] || 0) : 0;
                const isHigh = failPct >= 40;
                const isAboveTeam = failPct > teamPct && !isHigh;
                return (
                  <div key={p} className="flex items-center justify-between gap-2">
                    <span className="text-[11.5px] text-gray-600 truncate">{PARAM_NAMES[p]}</span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {isAboveTeam && <span className="text-[9px] text-amber-500 font-semibold">↑ team</span>}
                      <span className={`text-[12px] font-bold tabular-nums ${isHigh ? 'text-red-500' : isAboveTeam ? 'text-amber-500' : 'text-gray-500'}`}>
                        {failPct}%
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function PerformanceTab() {
  const {
    switchTab,
    summary,
    totalFiltered,
    entries,
    agentStats,
    paramFails,
    setAgentReportStat,
    setPendingFilters,
    setAppliedFilters,
    setLogPage,
    loadScores,
    logsLoading,
    logsError,
    sortAgentCol,
    setSortAgentCol,
    sortAgentDir,
    setSortAgentDir,
    agentPage,
    setAgentPage,
    showAllAgents,
    setShowAllAgents,
    showAllWeeks,
    setShowAllWeeks,
    weeklyParamData,
  } = useQuality();

  const sortedAgentStats = useMemo(() => {
    const arr = [...agentStats];
    arr.sort((a, b) => {
      if (sortAgentCol === 'agent') {
        return sortAgentDir === 'asc' ? a.agent.localeCompare(b.agent) : b.agent.localeCompare(a.agent);
      }
      let aVal: number, bVal: number;
      if (sortAgentCol === 'chats')         { aVal = a.chats;         bVal = b.chats; }
      else if (sortAgentCol === 'avgIqs')   { aVal = a.avgIqs;        bVal = b.avgIqs; }
      else if (sortAgentCol === 'avgFrt')   { aVal = a.avgFrt ?? 999999;       bVal = b.avgFrt ?? 999999; }
      else if (sortAgentCol === 'avgResolution') { aVal = a.avgResolution ?? 999999; bVal = b.avgResolution ?? 999999; }
      else if (sortAgentCol === 'csatPct')  { aVal = a.csatPct ?? -1; bVal = b.csatPct ?? -1; }
      else { // atRiskPct
        aVal = a.chats > 0 ? a.atRisk / a.chats : 0;
        bVal = b.chats > 0 ? b.atRisk / b.chats : 0;
      }
      return sortAgentDir === 'asc' ? aVal - bVal : bVal - aVal;
    });
    return arr;
  }, [agentStats, sortAgentCol, sortAgentDir]);

  const handleFilterLog = ({ agent, minScore, maxScore }: { agent: string; minScore?: number; maxScore?: number }) => {
    const f = {
      ...DEFAULT_FILTERS,
      agent,
      minScore: minScore ?? 0,
      maxScore: maxScore ?? 100,
    };
    setPendingFilters(f);
    setAppliedFilters(f);
    setLogPage(0);
    loadScores(0, f);
    switchTab('log');
  };

  return (
    <>
      {logsError && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-red-700 text-sm font-medium">
          {logsError}
        </div>
      )}
      {logsLoading && (
        <div className="flex items-center justify-center h-48">
          <div className="flex items-center gap-3 text-gray-400">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="animate-spin">
              <path d="M8 2a6 6 0 1 0 6 6" />
            </svg>
            <span className="text-sm">Loading scores…</span>
          </div>
        </div>
      )}

      {!logsLoading && agentStats.length === 0 && (
        <div className="flex flex-col items-center justify-center h-48 text-center">
          <p className="text-gray-400 text-sm">No scored chats yet.</p>
          <p className="text-xs text-gray-300 mt-1">Upload transcripts in the Upload & Score tab.</p>
          <button onClick={() => switchTab('upload')}
            className="mt-4 text-xs px-4 py-2 bg-emerald-600 text-white rounded-xl font-semibold hover:bg-emerald-700 transition">
            Go to Upload →
          </button>
        </div>
      )}

      {!logsLoading && agentStats.length > 0 && (
        <div className="space-y-6 max-w-5xl mx-auto">
          {/* ── Top 4 KPI cards ── */}
          {(() => {
            const total     = summary?.totalConvos   ?? totalFiltered;
            const botCount  = summary?.botConvos     ?? 0;
            const hybridCount = entries.filter(e => e.conversationType === 'hybrid').length;
            const botPct    = total > 0 ? Math.round(botCount    / total * 100) : 0;
            const hybridPct = total > 0 ? Math.round(hybridCount / total * 100) : 0;
            const humanPct  = Math.max(0, 100 - botPct - hybridPct);

            // FRT for human-only chats
            const humanFrts = entries.filter(e => e.conversationType !== 'bot' && e.frt != null).map(e => e.frt as number);
            const avgHumanFrt = humanFrts.length ? Math.round(humanFrts.reduce((s, n) => s + n, 0) / humanFrts.length) : null;

            return (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {/* Card 1 — No. of chats */}
                <div className="bg-white rounded-2xl px-5 py-4 shadow-sm border border-gray-100">
                  <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">Chats</p>
                  <p className="text-3xl font-bold text-gray-900">{total.toLocaleString()}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {botPct > 0 && (
                      <span className="text-[10px] font-semibold bg-violet-100 text-violet-700 px-2 py-0.5 rounded-full">
                        {botPct}% Myra
                      </span>
                    )}
                    {hybridPct > 0 && (
                      <span className="text-[10px] font-semibold bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
                        {hybridPct}% Assisted
                      </span>
                    )}
                    {humanPct > 0 && (
                      <span className="text-[10px] font-semibold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">
                        {humanPct}% Human
                      </span>
                    )}
                  </div>
                </div>
                {/* Card 2 — Resolution Time (all types) */}
                <div className="bg-white rounded-2xl px-5 py-4 shadow-sm border border-gray-100">
                  <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">Avg Resolution</p>
                  <p className="text-3xl font-bold text-gray-900">{fmtDuration(summary?.avgResolution ?? null)}</p>
                  <p className="text-[11px] text-gray-400 mt-1">all conversations</p>
                </div>
                {/* Card 3 — CSAT combined */}
                <div className="bg-white rounded-2xl px-5 py-4 shadow-sm border border-gray-100">
                  <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">CSAT</p>
                  <p className="text-3xl font-bold text-gray-900">
                    {summary?.overallCsat != null ? `${summary.overallCsat}%` : '—'}
                  </p>
                  <p className="text-[11px] text-gray-400 mt-1">
                    {summary ? `${summary.good} good · ${summary.cbbBad} bad` : ''}
                  </p>
                </div>
                {/* Card 4 — FRT for human-handled chats */}
                <div className="bg-white rounded-2xl px-5 py-4 shadow-sm border border-gray-100">
                  <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">Avg FRT (Human)</p>
                  <p className="text-3xl font-bold text-gray-900">{fmtDuration(avgHumanFrt)}</p>
                  <p className="text-[11px] text-gray-400 mt-1">first response time</p>
                </div>
              </div>
            );
          })()}

          {/* Agent Scorecards — lowest IQS first */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Needs Attention · Lowest IQS First</p>
              {agentStats.length > 3 && (
                <button onClick={() => setShowAllAgents(true)}
                  className="text-xs text-emerald-600 font-semibold hover:underline">
                  View all {agentStats.length} agents →
                </button>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {agentStats.slice(0, 3).map(a => (
                <AgentCard
                  key={a.agent}
                  stat={a}
                  entries={entries}
                  teamParamFails={paramFails}
                  onViewReport={s => setAgentReportStat(s)}
                  onFilterLog={handleFilterLog}
                />
              ))}
            </div>
          </div>

          {/* All Agents Modal */}
          {showAllAgents && (
            <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-6" onClick={() => setShowAllAgents(false)}>
              <div className="bg-white rounded-2xl w-full max-w-5xl max-h-[88vh] overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
                <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between">
                  <div>
                    <h2 className="font-bold text-gray-900">All Agent Scorecards</h2>
                    <p className="text-xs text-gray-500 mt-0.5">{agentStats.length} agents · lowest IQS first</p>
                  </div>
                  <button onClick={() => setShowAllAgents(false)} className="p-2 rounded-xl hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 2l12 12M14 2L2 14" /></svg>
                  </button>
                </div>
                <div className="p-6 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {agentStats.map(a => (
                    <AgentCard
                      key={a.agent}
                      stat={a}
                      entries={entries}
                      teamParamFails={paramFails}
                      onViewReport={s => { setShowAllAgents(false); setAgentReportStat(s); }}
                      onFilterLog={handleFilterLog}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Agent Timing Analytics Table */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <div>
                <p className="text-sm font-bold text-gray-900">Agent Wise Analytics</p>
                <p className="text-xs text-gray-500 mt-0.5">IQS, CSAT, and response times per agent · click headers to sort</p>
              </div>
              <div className="flex gap-2 text-xs text-gray-500">
                {agentPage > 0 && (
                  <button onClick={() => setAgentPage(p => p - 1)} className="px-3 py-1.5 border border-gray-200 rounded-lg hover:border-gray-400 transition font-medium">← Prev</button>
                )}
                {agentPage < Math.ceil(sortedAgentStats.length / 5) - 1 && (
                  <button onClick={() => setAgentPage(p => p + 1)} className="px-3 py-1.5 border border-gray-200 rounded-lg hover:border-gray-400 transition font-medium">Next →</button>
                )}
              </div>
            </div>
            {sortedAgentStats.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">No timing data yet</p>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-50/60 border-b border-gray-100">
                    {([
                      { key: 'agent',         label: 'Agent',         align: 'left'  },
                      { key: 'chats',         label: 'Chats',         align: 'right' },
                      { key: 'avgIqs',        label: 'Avg IQS',       align: 'right' },
                      { key: 'avgFrt',        label: 'Avg FRT',       align: 'right' },
                      { key: 'avgResolution', label: 'Avg Resolution',align: 'right' },
                      { key: 'csatPct',       label: 'CSAT Good',     align: 'right' },
                      { key: 'atRiskPct',     label: 'At Risk %',     align: 'right' },
                    ] as const).map(col => {
                      const isActive = sortAgentCol === col.key;
                      return (
                        <th key={col.key}
                          className={`${col.align === 'left' ? 'text-left px-5' : 'text-right px-4'} py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider cursor-pointer select-none hover:text-gray-800 transition whitespace-nowrap`}
                          onClick={() => {
                            if (isActive) setSortAgentDir(d => d === 'asc' ? 'desc' : 'asc');
                            else { setSortAgentCol(col.key); setSortAgentDir('asc'); }
                            setAgentPage(0);
                          }}>
                          {col.label}{isActive ? (sortAgentDir === 'asc' ? ' ↑' : ' ↓') : ' ↕'}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {sortedAgentStats.slice(agentPage * 5, agentPage * 5 + 5).map((a, i) => {
                    const atRiskPct = a.chats > 0 ? Math.round(a.atRisk / a.chats * 100) : 0;
                    return (
                      <tr key={a.agent} className={`border-b border-gray-50 hover:bg-emerald-50/30 cursor-pointer transition ${i % 2 === 1 ? 'bg-gray-50/30' : ''}`}
                        onClick={() => setAgentReportStat(a)}>
                        <td className="px-5 py-3 font-semibold text-gray-900 text-emerald-700 hover:underline">{a.agent}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-gray-700">{a.chats}</td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          <IQSPill iqs={a.avgIqs} />
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-gray-600">{fmtDuration(a.avgFrt ?? null)}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-gray-600">{fmtDuration(a.avgResolution ?? null)}</td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {a.csatPct != null
                            ? <span className={`font-semibold ${a.csatPct >= 80 ? 'text-emerald-600' : a.csatPct >= 60 ? 'text-amber-600' : 'text-red-600'}`}>{a.csatPct}%</span>
                            : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-5 py-3 text-right tabular-nums">
                          <span className={`font-semibold ${atRiskPct >= 30 ? 'text-red-600' : atRiskPct >= 15 ? 'text-amber-600' : 'text-emerald-600'}`}>
                            {atRiskPct}%
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* Weekly Parameter Breakdown Table */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <div>
                <p className="text-sm font-bold text-gray-900">Parameter Pass Rate by Week</p>
                <p className="text-xs text-gray-500 mt-0.5">% of chats passing each parameter per week · click a row to filter Score Log</p>
              </div>
              {weeklyParamData.length > 5 && (
                <button onClick={() => setShowAllWeeks(v => !v)} className="text-xs text-emerald-600 font-semibold hover:underline shrink-0">
                  {showAllWeeks ? 'Show less ↑' : `View all ${weeklyParamData.length} weeks →`}
                </button>
              )}
            </div>
            {weeklyParamData.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">No data yet</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs min-w-[900px]">
                  <thead>
                    <tr className="bg-gray-50/80 border-b border-gray-100">
                      <th className="text-left px-4 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap sticky left-0 bg-gray-50/80">Week</th>
                      <th className="text-right px-3 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Chats</th>
                      {PARAM_ORDER.map(p => (
                        <th key={p} className="text-right px-3 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap" title={PARAM_NAMES[p]}>
                          {p === 'AllQuestions' ? 'All Q' : p === 'Expectation' ? 'Expect' : p === 'Contextual' ? 'Context' : p === 'FollowUp' ? 'Follow' : p === 'Sentences' ? 'Tone' : p === 'Technical' ? 'Tech' : p === 'Grammar' ? 'Grammar' : p}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(showAllWeeks ? weeklyParamData : weeklyParamData.slice(0, 5)).map((row, i) => (
                      <tr key={row.key}
                        className={`border-b border-gray-50 hover:bg-emerald-50/20 cursor-pointer transition ${i % 2 === 1 ? 'bg-gray-50/20' : ''}`}
                        title="Click to filter Score Log to this week"
                        onClick={() => {
                          const weekEnd = new Date(row.key + 'T00:00:00Z');
                          weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
                          const dateTo = weekEnd.toISOString().slice(0, 10);
                          const f = { ...DEFAULT_FILTERS, dateRange: 'custom' as const, dateFrom: row.key, dateTo };
                          setPendingFilters(f); setAppliedFilters(f); setLogPage(0);
                          loadScores(0, f); switchTab('log');
                        }}>
                        <td className="px-4 py-3 font-medium text-gray-700 whitespace-nowrap sticky left-0 bg-white">
                          {row.label}
                        </td>
                        <td className="px-3 py-3 text-right text-gray-500 tabular-nums">{row.total}</td>
                        {PARAM_ORDER.map(p => {
                          const failPct = row.params[p];
                          const passPct = failPct > 0 ? 100 - failPct : null;
                          const color = passPct == null ? 'text-gray-300' : passPct >= 80 ? 'text-green-600 font-semibold' : passPct >= 60 ? 'text-gray-600' : 'text-red-600 font-bold';
                          return (
                            <td key={p} className={`px-3 py-3 text-right tabular-nums ${color}`}>
                              {passPct != null ? `${passPct}%` : '—'}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
