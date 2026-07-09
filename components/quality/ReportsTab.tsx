'use client';

import React, { useState, useCallback } from 'react';
import { useQuality } from './QualityContext';
import { DateRangePicker, buildParams } from './helpers';
import { DEFAULT_FILTERS } from './types';

export default function ReportsTab() {
  const {
    availableAgents,
    availableDispositions,
    availableSubDispositions,
    reportFilters,
    setReportFilters,
    reportTotalFiltered,
    setReportTotalFiltered,
    reportCountLoading,
    setReportCountLoading,
    exporting,
    setExporting,
  } = useQuality();

  const [showReportPicker, setShowReportPicker] = useState(false);

  // Preview how many chats match the report filters
  const previewReportCount = useCallback(async () => {
    setReportCountLoading(true);
    try {
      const params = buildParams(0, reportFilters);
      params.set('skipStats', '1');
      const data = await fetch(`/api/quality/scores?${params}`).then(r => r.json());
      setReportTotalFiltered(data.total ?? 0);
    } catch {}
    setReportCountLoading(false);
  }, [reportFilters, setReportCountLoading, setReportTotalFiltered]);

  // Download report CSV
  const downloadReport = useCallback(async () => {
    setExporting(true);
    try {
      const params = buildParams(0, reportFilters);
      params.delete('page');
      const res = await fetch(`/api/quality/export?${params}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `wint_iqs_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {}
    setExporting(false);
  }, [reportFilters, setExporting]);

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      {/* Independent filter controls */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <p className="text-sm font-bold text-gray-900 mb-4">Report Filters</p>
        <div className="flex flex-wrap items-end gap-4">
          {/* Period chips */}
          <div>
            <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Period</p>
            <div className="flex items-center gap-1 flex-wrap">
              {(['today', 'yesterday', '1w'] as const).map(r => (
                <button key={r}
                  onClick={() => {
                    setReportFilters(f => ({ ...f, dateRange: r, dateFrom: '', dateTo: '' }));
                    setReportTotalFiltered(null);
                    setShowReportPicker(false);
                  }}
                  className={`text-xs px-3 py-1.5 rounded-lg font-semibold transition ${
                    reportFilters.dateRange === r ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                  }`}>
                  {r === 'today' ? 'Today' : r === 'yesterday' ? 'Yesterday' : '1 Week'}
                </button>
              ))}
              {/* Custom */}
              <div className="relative">
                <button
                  onClick={() => {
                    setReportFilters(f => ({ ...f, dateRange: 'custom' }));
                    setShowReportPicker(v => !v);
                    setReportTotalFiltered(null);
                  }}
                  className={`text-xs px-3 py-1.5 rounded-lg font-semibold transition ${
                    reportFilters.dateRange === 'custom' ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                  }`}>
                  {reportFilters.dateRange === 'custom' && reportFilters.dateFrom
                    ? `${reportFilters.dateFrom.slice(5)} → ${reportFilters.dateTo ? reportFilters.dateTo.slice(5) : '…'}`
                    : 'Custom'}
                </button>
                {showReportPicker && (
                  <div className="absolute left-0 top-full mt-2 bg-white border border-gray-200 rounded-2xl shadow-xl z-30 overflow-hidden">
                    <DateRangePicker
                      from={reportFilters.dateFrom} to={reportFilters.dateTo}
                      onChange={(from, to) => {
                        setReportFilters(f => ({ ...f, dateRange: 'custom', dateFrom: from, dateTo: to }));
                        setReportTotalFiltered(null);
                      }}
                      onClose={() => setShowReportPicker(false)}
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
          {/* Agent */}
          <div>
            <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Agent</p>
            <select value={reportFilters.agent}
              onChange={e => { setReportFilters(f => ({ ...f, agent: e.target.value })); setReportTotalFiltered(null); }}
              className="text-xs border border-gray-200 rounded-xl px-3 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 min-w-[140px]">
              <option value="">All agents</option>
              {availableAgents.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          {/* CSAT */}
          <div>
            <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">CSAT</p>
            <select value={reportFilters.csat}
              onChange={e => { setReportFilters(f => ({ ...f, csat: e.target.value })); setReportTotalFiltered(null); }}
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
              <input type="number" min={0} max={100} value={reportFilters.minScore}
                onChange={e => { setReportFilters(f => ({ ...f, minScore: parseInt(e.target.value) || 0 })); setReportTotalFiltered(null); }}
                className="w-14 text-xs border border-gray-200 rounded-xl px-2 py-1.5 text-center focus:outline-none bg-white text-gray-800" />
              <span className="text-gray-400 text-xs">–</span>
              <input type="number" min={0} max={100} value={reportFilters.maxScore}
                onChange={e => { setReportFilters(f => ({ ...f, maxScore: parseInt(e.target.value) || 100 })); setReportTotalFiltered(null); }}
                className="w-14 text-xs border border-gray-200 rounded-xl px-2 py-1.5 text-center focus:outline-none bg-white text-gray-800" />
            </div>
          </div>
          {/* Disposition */}
          <div>
            <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Disposition</p>
            <select value={reportFilters.disposition}
              onChange={e => { setReportFilters(f => ({ ...f, disposition: e.target.value, subDisposition: '' })); setReportTotalFiltered(null); }}
              className="text-xs border border-gray-200 rounded-xl px-3 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 min-w-[160px]">
              <option value="">All</option>
              {availableDispositions.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          {/* Sub-Disposition */}
          <div>
            <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Sub-Disposition</p>
            <select value={reportFilters.subDisposition}
              onChange={e => { setReportFilters(f => ({ ...f, subDisposition: e.target.value })); setReportTotalFiltered(null); }}
              className="text-xs border border-gray-200 rounded-xl px-3 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 min-w-[160px]">
              <option value="">All</option>
              {availableSubDispositions.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
        </div>
        {/* Reset + Preview count row */}
        <div className="flex items-center gap-3 pt-4 border-t border-gray-50 mt-4">
          <button
            onClick={previewReportCount}
            disabled={reportCountLoading}
            className="px-5 py-1.5 bg-emerald-600 text-white text-xs font-bold rounded-xl hover:bg-emerald-700 disabled:opacity-40 transition">
            {reportCountLoading ? 'Counting…' : 'Preview count'}
          </button>
          <button
            onClick={() => { setReportFilters(DEFAULT_FILTERS); setReportTotalFiltered(null); }}
            className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700 font-medium transition">
            Reset
          </button>
          {reportTotalFiltered !== null && (
            <span className="text-xs text-gray-500 ml-2">
              <span className="font-bold text-gray-900">{reportTotalFiltered.toLocaleString()}</span> chats will be exported
            </span>
          )}
        </div>
      </div>

      {/* Download buttons */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <p className="text-sm font-bold text-gray-900 mb-1">Download</p>
        <p className="text-xs text-gray-500 mb-5">Exports all chats matching the filters above — no pagination limit.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <button
            onClick={downloadReport}
            disabled={exporting}
            className="flex items-center gap-3 p-4 rounded-2xl border-2 border-emerald-200 bg-emerald-50 hover:bg-emerald-100 disabled:opacity-50 transition group">
            <div className="w-10 h-10 rounded-xl bg-emerald-600 flex items-center justify-center shrink-0">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /><polyline points="10 9 9 9 8 9" />
              </svg>
            </div>
            <div className="text-left">
              <p className="text-sm font-bold text-emerald-800">Download CSV</p>
              <p className="text-xs text-emerald-600">All columns · filtered data</p>
            </div>
          </button>

          <button
            onClick={downloadReport}
            disabled={exporting}
            className="flex items-center gap-3 p-4 rounded-2xl border-2 border-blue-200 bg-blue-50 hover:bg-blue-100 disabled:opacity-50 transition group">
            <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center shrink-0">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M8 12l2 2 4-4" />
              </svg>
            </div>
            <div className="text-left">
              <p className="text-sm font-bold text-blue-800">Download Excel</p>
              <p className="text-xs text-blue-600">CSV format · opens in Excel</p>
            </div>
          </button>
        </div>

        {exporting && (
          <div className="mt-4 flex items-center gap-2 text-sm text-gray-500">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="animate-spin"><path d="M8 2a6 6 0 1 0 6 6" /></svg>
            Preparing download…
          </div>
        )}
      </div>
    </div>
  );
}
