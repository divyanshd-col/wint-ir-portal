'use client';

import React, { useState, useMemo } from 'react';
import { useQuality } from './QualityContext';
import { PARAM_ORDER, PARAM_NAMES, fmtDuration } from '@/lib/quality';
import { IQSPill } from '@/components/quality/IQSRing';
import { SummaryBar, ChatLink } from './helpers';
import { DEFAULT_FILTERS } from './types';

const ALL_LOG_COLS: readonly string[] = ['Agent', 'Chat ID', 'Mobile', 'CSAT', 'FRT', 'Handoff', 'Resolution', 'Closure', 'IQS', 'Fails', 'Disposition', 'Sub-Disposition', 'Last Updated', 'Date'];

export default function ScoreLogTab() {
  const {
    entries,
    summary,
    totalFiltered,
    logsLoading,
    logsError,
    pendingFilters,
    setPendingFilters,
    appliedFilters,
    setAppliedFilters,
    logPage,
    setLogPage,
    hasMore,
    loadScores,
    selfAgentName,
    availableAgents,
    availableDispositions,
    availableSubDispositions,
    sortCol,
    setSortCol,
    sortDir,
    setSortDir,
    showFilterPanel,
    setShowFilterPanel,
    showOnlyNeedsReview,
    setShowOnlyNeedsReview,
    setDetailEntry,
    switchTab,
  } = useQuality();

  // Column visibility local state
  const [showColPicker, setShowColPicker] = useState(false);
  const [hiddenCols, setHiddenCols] = useState<Set<string>>(new Set());
  const [forcedVisibleCols, setForcedVisibleCols] = useState<Set<string>>(new Set());

  // Derived columns
  const autoHiddenLogCols = useMemo(() => {
    const hidden = new Set<string>();
    if (!entries.some(e => e.frt != null)) hidden.add('FRT');
    if (!entries.some(e => e.botToTeamSecs != null)) hidden.add('Handoff');
    if (!entries.some(e => e.resolutionTime != null)) hidden.add('Resolution');
    if (!entries.some(e => e.closureTime != null)) hidden.add('Closure');
    if (!entries.some(e => e.csat)) hidden.add('CSAT');
    if (!entries.some(e => e.disposition)) hidden.add('Disposition');
    if (!entries.some(e => e.subDisposition)) hidden.add('Sub-Disposition');
    if (!entries.some(e => (e as any).mobileNumber)) hidden.add('Mobile');
    return hidden;
  }, [entries]);

  const visibleLogCols = useMemo(() => {
    return ALL_LOG_COLS.filter(col =>
      !hiddenCols.has(col) && (!autoHiddenLogCols.has(col) || forcedVisibleCols.has(col))
    );
  }, [hiddenCols, autoHiddenLogCols, forcedVisibleCols]);

  const sortedLogEntries = useMemo(() => {
    if (!sortCol) return entries;
    return [...entries].sort((a, b) => {
      let aVal: number, bVal: number;
      if (sortCol === 'iqs') { aVal = a.iqs; bVal = b.iqs; }
      else if (sortCol === 'fails') {
        aVal = PARAM_ORDER.filter(p => a.scores[p] === 'No').length;
        bVal = PARAM_ORDER.filter(p => b.scores[p] === 'No').length;
      } else if (sortCol === 'date') {
        aVal = new Date(a.scoredAt || a.date || '').getTime();
        bVal = new Date(b.scoredAt || b.date || '').getTime();
      } else if (sortCol === 'csat') {
        aVal = parseInt(a.csat || '0') || 0;
        bVal = parseInt(b.csat || '0') || 0;
      } else {
        aVal = a.frt ?? 999999;
        bVal = b.frt ?? 999999;
      }
      return sortDir === 'asc' ? aVal - bVal : bVal - aVal;
    });
  }, [entries, sortCol, sortDir]);

  const chatIdFilteredLogEntries = useMemo(() =>
    showOnlyNeedsReview
      ? sortedLogEntries.filter(e => e.uncertainParameters && e.uncertainParameters.length > 0)
      : sortedLogEntries,
  [sortedLogEntries, showOnlyNeedsReview]);

  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (appliedFilters.chatId) n++;
    if (appliedFilters.dateRange !== '1w') n++;
    if (appliedFilters.agent && appliedFilters.agent !== selfAgentName) n++;
    if (appliedFilters.csat) n++;
    if (appliedFilters.minScore > 0 || appliedFilters.maxScore < 100) n++;
    if (appliedFilters.disposition) n++;
    if (appliedFilters.subDisposition) n++;
    return n;
  }, [appliedFilters, selfAgentName]);

  const applyFilters = () => {
    const f = selfAgentName ? { ...pendingFilters, agent: selfAgentName } : pendingFilters;
    setAppliedFilters(f);
    setLogPage(0);
    loadScores(0, f);
  };

  return (
    <div className="space-y-4 max-w-5xl mx-auto">
      {/* Collapsible filter panel */}
      {showFilterPanel && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-5">
          {/* Row 1: Date Range */}
          <div>
            <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-2">Date Range</p>
            <div className="flex flex-wrap items-center gap-2">
              {(['today', 'yesterday', '1w'] as const).map(r => (
                <button key={r}
                  onClick={() => setPendingFilters(f => ({ ...f, dateRange: r, dateFrom: '', dateTo: '' }))}
                  className={`text-xs px-3 py-1.5 rounded-lg font-semibold transition ${
                    pendingFilters.dateRange === r ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                  }`}>
                  {r === 'today' ? 'Today' : r === 'yesterday' ? 'Yesterday' : '1 Week'}
                </button>
              ))}
              <button
                onClick={() => setPendingFilters(f => ({ ...f, dateRange: 'custom' }))}
                className={`text-xs px-3 py-1.5 rounded-lg font-semibold transition ${
                  pendingFilters.dateRange === 'custom' ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                }`}>
                Custom
              </button>
              {pendingFilters.dateRange === 'custom' && (
                <div className="flex items-center gap-2 ml-1">
                  <input type="date" value={pendingFilters.dateFrom}
                    onChange={e => setPendingFilters(f => ({ ...f, dateFrom: e.target.value }))}
                    className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 bg-white text-gray-800" />
                  <span className="text-gray-400 text-xs">→</span>
                  <input type="date" value={pendingFilters.dateTo}
                    onChange={e => setPendingFilters(f => ({ ...f, dateTo: e.target.value }))}
                    className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 bg-white text-gray-800" />
                </div>
              )}
            </div>
          </div>

          {/* Row 2: Chat ID + Agent + CSAT */}
          <div className="flex flex-wrap items-end gap-4">
            {/* Chat ID */}
            <div>
              <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Chat ID</p>
              <input
                type="text"
                value={pendingFilters.chatId}
                onChange={e => setPendingFilters(f => ({ ...f, chatId: e.target.value }))}
                placeholder="Search by Chat ID…"
                className="text-xs border border-gray-200 rounded-xl px-3 py-1.5 w-44 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 text-gray-700 bg-white"
              />
            </div>
            {/* Agent */}
            <div>
              <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Agent</p>
              <select value={pendingFilters.agent}
                onChange={e => setPendingFilters(f => ({ ...f, agent: e.target.value }))}
                disabled={!!selfAgentName}
                className="text-xs border border-gray-200 rounded-xl px-3 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 min-w-[140px] disabled:opacity-60 disabled:cursor-not-allowed">
                <option value="">All agents</option>
                {availableAgents.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
            {/* CSAT */}
            <div>
              <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">CSAT</p>
              <select value={pendingFilters.csat}
                onChange={e => setPendingFilters(f => ({ ...f, csat: e.target.value }))}
                className="text-xs border border-gray-200 rounded-xl px-3 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 min-w-[110px]">
                <option value="">Any</option>
                <option value="5">Good</option>
                <option value="3">CBB</option>
                <option value="1">Bad</option>
              </select>
            </div>
            {/* IQS range */}
            <div>
              <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">IQS Range</p>
              <div className="flex items-center gap-2">
                <input type="number" min={0} max={100} value={pendingFilters.minScore}
                  onChange={e => setPendingFilters(f => ({ ...f, minScore: parseInt(e.target.value) || 0 }))}
                  className="w-14 text-xs border border-gray-200 rounded-xl px-2 py-1.5 text-center focus:outline-none bg-white text-gray-800" />
                <span className="text-gray-400 text-xs">–</span>
                <input type="number" min={0} max={100} value={pendingFilters.maxScore}
                  onChange={e => setPendingFilters(f => ({ ...f, maxScore: parseInt(e.target.value) || 100 }))}
                  className="w-14 text-xs border border-gray-200 rounded-xl px-2 py-1.5 text-center focus:outline-none bg-white text-gray-800" />
              </div>
            </div>
          </div>

          {/* Row 3: Disposition + Sub-Disposition */}
          <div className="flex flex-wrap items-end gap-4">
            {/* Disposition */}
            <div>
              <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Disposition</p>
              <select value={pendingFilters.disposition}
                onChange={e => setPendingFilters(f => ({ ...f, disposition: e.target.value, subDisposition: '' }))}
                className="text-xs border border-gray-200 rounded-xl px-3 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 min-w-[180px]">
                <option value="">All</option>
                {availableDispositions.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            {/* Sub-Disposition */}
            <div>
              <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Sub-Disposition</p>
              <select value={pendingFilters.subDisposition}
                onChange={e => setPendingFilters(f => ({ ...f, subDisposition: e.target.value }))}
                className="text-xs border border-gray-200 rounded-xl px-3 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 min-w-[180px]">
                <option value="">All</option>
                {availableSubDispositions.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
          </div>

          {/* Action row */}
          <div className="flex items-center gap-3 pt-1 border-t border-gray-100">
            <button onClick={() => { applyFilters(); setShowFilterPanel(false); }} disabled={logsLoading}
              className="px-5 py-1.5 bg-emerald-600 text-white text-xs font-bold rounded-xl hover:bg-emerald-700 disabled:opacity-40 transition">
              {logsLoading ? 'Loading…' : 'Apply Filters'}
            </button>
            <button
              onClick={() => {
                const reset = selfAgentName ? { ...DEFAULT_FILTERS, agent: selfAgentName } : DEFAULT_FILTERS;
                setPendingFilters(reset);
                setAppliedFilters(reset);
                setLogPage(0);
                loadScores(0, reset);
                setShowFilterPanel(false);
              }}
              className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700 font-medium transition">
              Reset all
            </button>
            <div className="relative ml-auto">
              <button
                onClick={() => setShowColPicker(v => !v)}
                className="text-xs px-3 py-1.5 border border-gray-200 text-gray-500 rounded-lg hover:border-gray-400 transition font-medium"
              >
                Columns ⚙
              </button>
              {showColPicker && (
                <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 shadow-lg rounded-xl z-10 p-3 min-w-[160px]">
                  {ALL_LOG_COLS.map(col => {
                    const isVisible = !hiddenCols.has(col) && (!autoHiddenLogCols.has(col) || forcedVisibleCols.has(col));
                    return (
                      <label key={col} className="flex items-center gap-2 py-1 cursor-pointer hover:text-gray-900 text-xs text-gray-600">
                        <input
                          type="checkbox"
                          checked={isVisible}
                          onChange={e => {
                            if (e.target.checked) {
                              setHiddenCols(prev => { const s = new Set(prev); s.delete(col); return s; });
                              setForcedVisibleCols(prev => { const s = new Set(prev); s.add(col); return s; });
                            } else {
                              setHiddenCols(prev => { const s = new Set(prev); s.add(col); return s; });
                              setForcedVisibleCols(prev => { const s = new Set(prev); s.delete(col); return s; });
                            }
                          }}
                        />
                        {col}
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {logsLoading && (
        <div className="flex items-center justify-center h-40 text-gray-400 text-sm animate-pulse">Loading…</div>
      )}

      {!logsLoading && entries.length === 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-16 text-center">
          <p className="text-gray-400 text-sm">No chats match these filters.</p>
          <p className="text-xs text-gray-300 mt-1">Adjust the filters above and click Apply.</p>
        </div>
      )}

      {!logsLoading && entries.length > 0 && (
        <>
          {/* Summary stats bar */}
          {summary && (
            <SummaryBar
              s={summary}
              onFilter={({ filterCsat: fc, filterType: ft, sortByIqs }) => {
                if (fc !== undefined) { setPendingFilters(f => ({ ...f, csat: fc })); }
                if (ft !== undefined) { setPendingFilters(f => ({ ...f, type: ft })); }
                if (sortByIqs) { setSortCol('iqs'); setSortDir('asc'); }
              }}
            />
          )}

          {/* ── Per-conversation table ── */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-x-auto">
            <table className="w-full text-xs GFM whitespace-nowrap">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/60">
                  {visibleLogCols.map(h => {
                    const sortKeyMap: Record<string, 'iqs' | 'fails' | 'date' | 'csat' | 'frt'> = {
                      'IQS': 'iqs', 'Fails': 'fails', 'Date': 'date', 'CSAT': 'csat', 'FRT': 'frt'
                    };
                    const colKey = sortKeyMap[h];
                    const isSortable = !!colKey;
                    const isActive = sortCol === colKey;
                    return (
                      <th
                        key={h}
                        className={`text-left px-3 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider${isSortable ? ' cursor-pointer select-none hover:text-gray-700' : ''}`}
                        onClick={isSortable ? () => {
                          if (isActive) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
                          else { setSortCol(colKey); setSortDir('desc'); }
                        } : undefined}
                      >
                        {h}{isSortable && (isActive ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ' ↕')}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {chatIdFilteredLogEntries.map((e, i) => {
                  const fails = PARAM_ORDER.filter(p => e.scores[p] === 'No');
                  const isTechFail = e.scores?.Technical === 'No';
                  const rowStyle = isTechFail
                    ? { background: '#fff1f2' }
                    : e.iqs < 50
                    ? { background: '#fef2f2' }
                    : undefined;
                  return (
                    <tr
                      key={i}
                      className="border-b border-gray-50 hover:bg-emerald-50/40 cursor-pointer transition"
                      style={rowStyle}
                      onClick={() => setDetailEntry(e)}
                    >
                      {visibleLogCols.map(col => {
                        if (col === 'Agent') return (
                          <td key={col} className="px-3 py-2.5">
                            <div className="flex items-center gap-1.5">
                              <span className="font-semibold text-gray-900">{e.agentName || '—'}</span>
                              {e.uncertainParameters && e.uncertainParameters.length > 0 && (
                                <span title={`${e.uncertainParameters.length} param(s) need QA review`}
                                  className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-amber-400 text-white text-[9px] font-bold shrink-0">
                                  ?
                                </span>
                              )}
                            </div>
                          </td>
                        );
                        if (col === 'Chat ID') return <td key={col} className="px-3 py-2.5"><ChatLink chatId={e.chatId} className="text-xs" /></td>;
                        if (col === 'Mobile') return <td key={col} className="px-3 py-2.5 text-gray-600 tabular-nums">{(e as any).mobileNumber || <span className="text-gray-300">—</span>}</td>;
                        if (col === 'CSAT') return <td key={col} className="px-3 py-2.5">
                          {e.csat === '5' ? <span className="text-[11px] font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">Good</span>
                          : e.csat === '3' ? <span className="text-[11px] font-semibold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">CBB</span>
                          : e.csat === '1' ? <span className="text-[11px] font-semibold text-red-600 bg-red-50 px-2 py-0.5 rounded-full">Bad</span>
                          : <span className="text-gray-300">—</span>}
                        </td>;
                        if (col === 'FRT') return <td key={col} className="px-3 py-2.5 text-gray-600 tabular-nums">{fmtDuration(e.frt)}</td>;
                        if (col === 'Handoff') return <td key={col} className="px-3 py-2.5 text-gray-600 tabular-nums">{fmtDuration(e.botToTeamSecs)}</td>;
                        if (col === 'Resolution') return <td key={col} className="px-3 py-2.5 text-gray-600 tabular-nums">{fmtDuration(e.resolutionTime)}</td>;
                        if (col === 'Closure') return <td key={col} className="px-3 py-2.5 text-gray-600 tabular-nums">{fmtDuration(e.closureTime)}</td>;
                        if (col === 'IQS') return <td key={col} className="px-3 py-2.5"><IQSPill iqs={e.iqs} /></td>;
                        if (col === 'Fails') return (
                          <td key={col} className="px-3 py-2.5">
                            {fails.length === 0 ? (
                              <span style={{ color: 'var(--color-text-success)' }} className="font-semibold text-xs">✓</span>
                            ) : (
                              <div className="flex items-center gap-1.5">
                                <div style={{ width: 80, height: 4, background: 'var(--color-background-tertiary)', borderRadius: 2, overflow: 'hidden', flexShrink: 0 }}>
                                  <div style={{
                                    width: `${Math.min(fails.length / 10 * 100, 100)}%`,
                                    height: '100%',
                                    background: fails.length >= 6
                                      ? 'var(--color-border-danger)'
                                      : fails.length >= 3
                                        ? 'var(--color-border-warning)'
                                        : 'var(--color-border-success)',
                                    borderRadius: 2,
                                  }} />
                                </div>
                                <span className="font-semibold text-xs tabular-nums" style={{
                                  color: fails.length >= 6
                                    ? 'var(--color-text-danger)'
                                    : fails.length >= 3
                                      ? 'var(--color-text-warning)'
                                      : 'var(--color-text-success)',
                                }}>{fails.length}</span>
                              </div>
                            )}
                          </td>
                        );
                        if (col === 'Disposition') return <td key={col} className="px-3 py-2.5 text-gray-700 text-xs max-w-[130px] truncate" title={e.disposition}>{e.disposition || <span className="text-gray-300">—</span>}</td>;
                        if (col === 'Sub-Disposition') return <td key={col} className="px-3 py-2.5 text-gray-700 text-xs max-w-[130px] truncate" title={e.subDisposition}>{e.subDisposition || <span className="text-gray-300">—</span>}</td>;
                        if (col === 'Last Updated') return (
                          <td key={col} className="px-4 py-2.5 text-[12px] text-gray-400 whitespace-nowrap">
                            {e.updatedAt && e.updatedAt !== e.scoredAt
                              ? new Date(e.updatedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
                              : '—'}
                          </td>
                        );
                        if (col === 'Date') return <td key={col} className="px-3 py-2.5 text-gray-600">{(e.date || e.scoredAt || '').slice(0, 10)}</td>;
                        return null;
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-400">
              Showing {logPage * 50 + 1}–{logPage * 50 + entries.length} of {totalFiltered.toLocaleString()}
            </p>
            <div className="flex gap-2">
              {logPage > 0 && (
                <button
                  onClick={() => { const p = logPage - 1; setLogPage(p); loadScores(p, appliedFilters, true); }}
                  className="text-xs px-4 py-1.5 border border-gray-200 rounded-xl hover:border-gray-400 transition font-medium text-gray-600 bg-white">
                  ← Previous
                </button>
              )}
              {hasMore && (
                <button
                  onClick={() => { const p = logPage + 1; setLogPage(p); loadScores(p, appliedFilters, true); }}
                  className="text-xs px-4 py-1.5 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 transition font-semibold">
                  Next 50 →
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
