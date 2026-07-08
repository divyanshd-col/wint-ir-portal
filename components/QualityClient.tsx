'use client';

import React from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import Image from 'next/image';
import { QualityProvider, useQuality } from '@/components/quality/QualityContext';
import type { QualityClientProps, QualityTab } from '@/components/quality/types';
import { DateRangePicker } from '@/components/quality/helpers';
import ScoreDetail from '@/components/quality/ScoreDetailModal';
import AgentReportModal from '@/components/quality/AgentReportModal';
import { PARAM_ORDER, PARAM_NAMES } from '@/lib/quality';

// Dynamic Imports
const PerformanceTab = dynamic(() => import('@/components/quality/PerformanceTab'), {
  loading: () => <LoadingSpinner label="Performance Tab" />,
  ssr: false,
});
const ScoreLogTab = dynamic(() => import('@/components/quality/ScoreLogTab'), {
  loading: () => <LoadingSpinner label="Score Log Tab" />,
  ssr: false,
});
const UploadTab = dynamic(() => import('@/components/quality/UploadTab'), {
  loading: () => <LoadingSpinner label="Upload Tab" />,
  ssr: false,
});
const ReportsTab = dynamic(() => import('@/components/quality/ReportsTab'), {
  loading: () => <LoadingSpinner label="Reports Tab" />,
  ssr: false,
});
const PendingChatsTab = dynamic(() => import('@/components/quality/PendingChatsTab'), {
  loading: () => <LoadingSpinner label="Pending Chats Tab" />,
  ssr: false,
});
const CallQueueTab = dynamic(() => import('@/components/quality/CallQueueTab'), {
  loading: () => <LoadingSpinner label="Call Queue Tab" />,
  ssr: false,
});
const CallQualityClient = dynamic(() => import('@/components/CallQualityClient'), {
  loading: () => <LoadingSpinner label="Call Quality Client" />,
  ssr: false,
});
const CallLinkTestClient = dynamic(() => import('@/components/CallLinkTestClient'), {
  loading: () => <LoadingSpinner label="Call Link Test Client" />,
  ssr: false,
});
const UnifiedScoringClient = dynamic(() => import('@/components/UnifiedScoringClient'), {
  loading: () => <LoadingSpinner label="Unified Scoring Client" />,
  ssr: false,
});

function LoadingSpinner({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center p-8 text-gray-400 gap-2 text-sm">
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="animate-spin">
        <path d="M8 2a6 6 0 1 0 6 6" />
      </svg>
      Loading {label}…
    </div>
  );
}

const icons = {
  performance: (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M2 12l3-4 3 2 3-5 3 3" /><rect x="1" y="1" width="14" height="14" rx="1.5" />
    </svg>
  ),
  log: (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="2" y="2" width="12" height="12" rx="1.5" /><path d="M5 6h6M5 8.5h4M5 11h3" />
    </svg>
  ),
  upload: (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M8 10V3M5 6l3-3 3 3" /><path d="M2 12h12" />
    </svg>
  ),
  reports: (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="2" y="2" width="12" height="12" rx="1.5" /><path d="M5 10V8M8 10V6M11 10V4" />
    </svg>
  ),
  challenges: (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M8 2v7M8 12v2"/><circle cx="8" cy="8" r="7"/>
    </svg>
  ),
  calls: (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M3 3.5c0 5.5 4 9.5 9.5 9.5l1-2.5-2.5-1-1 1c-1.5-.5-3-2-3.5-3.5l1-1-1-2.5L3 3.5z"/>
    </svg>
  ),
  callTest: (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M3 2a1 1 0 00-1 1v1.5a9 9 0 009 9H12.5a1 1 0 001-1v-2a1 1 0 00-1-1h-2v.5A6 6 0 014.5 5h.5a1 1 0 001-1V2a1 1 0 00-1-1H3z"/>
      <path d="M10 6l2 2-2 2M12 8h-3"/>
    </svg>
  ),
  unified: (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="8" cy="8" r="6"/><circle cx="8" cy="8" r="2"/>
      <path d="M8 2v2M8 12v2M2 8h2M12 8h2"/>
    </svg>
  ),
};

function NavItem({ icon, label, active, badge, onClick, collapsed }: {
  icon: React.ReactNode; label: string; active: boolean; badge?: number; onClick: () => void; collapsed?: boolean;
}) {
  return (
    <button onClick={onClick} title={collapsed ? label : undefined}
      className={`w-full flex items-center gap-3 rounded-xl text-sm font-medium transition-all ${
        collapsed ? 'justify-center px-0 py-2.5' : 'px-3 py-2.5'
      } ${
        active
          ? 'bg-emerald-600 text-white shadow-sm shadow-emerald-600/30'
          : 'text-slate-400 hover:text-white hover:bg-white/8'
      }`}>
      <span className="relative shrink-0">
        {icon}
        {collapsed && badge !== undefined && badge > 0 && (
          <span className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-red-500 text-white text-[8px] font-bold rounded-full flex items-center justify-center leading-none">
            {badge > 9 ? '9+' : badge}
          </span>
        )}
      </span>
      {!collapsed && <span className="flex-1 text-left">{label}</span>}
      {!collapsed && badge !== undefined && badge > 0 && (
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${active ? 'bg-white/20 text-white' : 'bg-slate-700 text-slate-300'}`}>
          {badge > 999 ? '999+' : badge}
        </span>
      )}
    </button>
  );
}

function QualityClientInner({
  userRole,
  userEmail,
  initialSection,
  initialChatId
}: {
  userRole?: string;
  userEmail?: string;
  initialSection?: 'pending' | 'reviewed';
  initialChatId?: string;
}) {
  const {
    tab,
    switchTab,
    selfAgentName,
    challengeCount,
    detailEntry,
    setDetailEntry,
    editEntry,
    setEditEntry,
    editForm,
    setEditForm,
    savingEdit,
    saveEdit,
    openEditModal,
    agentReportStat,
    setAgentReportStat,
    toast,
    sidebarExpanded,
    setSidebarExpanded,
    perfPeriod,
    setPerfPeriod,
    perfDateFrom,
    setPerfDateFrom,
    perfDateTo,
    setPerfDateTo,
    showPerfPicker,
    setShowPerfPicker,
    loadPerfData,
    runPendingScores,
    batchRunning,
    batchProgress,
    backfillSheet,
    sheetBackfilling,
    sheetBackfillResult,
    showOnlyNeedsReview,
    setShowOnlyNeedsReview,
    entries,
    totalFiltered,
    totalStored,
    agentStats,
    perfTotal,
  } = useQuality();

  return (
    <div className="h-screen flex font-sans antialiased overflow-hidden" style={{ background: '#f5f3ee' }}>
      {detailEntry && (
        <ScoreDetail
          entry={detailEntry}
          onClose={() => setDetailEntry(null)}
          onEdit={openEditModal}
          userRole={userRole}
        />
      )}

      {/* ── Edit/Override Modal ── */}
      {editEntry && editForm && (
        <div className="fixed inset-0 bg-black/70 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => { setEditEntry(null); setEditForm(null); }}>
          <div className="bg-white w-full sm:rounded-2xl sm:max-w-3xl max-h-[94vh] overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between">
              <div>
                <h2 className="font-bold text-gray-900">Override Score</h2>
                <p className="text-xs text-gray-400">Chat {editEntry.chatId}</p>
              </div>
              <button onClick={() => { setEditEntry(null); setEditForm(null); }} className="p-2 rounded-xl hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 2l12 12M14 2L2 14" /></svg>
              </button>
            </div>
            <div className="px-6 py-5 space-y-5">
              {/* Basic fields */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">Agent Name</label>
                  <input type="text" value={editForm.agentName} onChange={e => setEditForm(f => f ? { ...f, agentName: e.target.value } : f)}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30" />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">CSAT</label>
                  <select value={editForm.csat} onChange={e => setEditForm(f => f ? { ...f, csat: e.target.value } : f)}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30 bg-white">
                    <option value="">None</option>
                    <option value="5">Good</option>
                    <option value="3">Could be better</option>
                    <option value="1">Bad</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">Disposition</label>
                  <input type="text" value={editForm.disposition} onChange={e => setEditForm(f => f ? { ...f, disposition: e.target.value } : f)}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30" />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">Sub-Disposition</label>
                  <input type="text" value={editForm.subDisposition} onChange={e => setEditForm(f => f ? { ...f, subDisposition: e.target.value } : f)}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30" />
                </div>
              </div>
              <div>
                <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">Summary</label>
                <textarea value={editForm.summary} onChange={e => setEditForm(f => f ? { ...f, summary: e.target.value } : f)} rows={3}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30 resize-y" />
              </div>

              {/* Parameter scores */}
              <div>
                <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-3">Parameter Scores</p>
                <div className="space-y-3">
                  {PARAM_ORDER.map(p => (
                    <div key={p} className="rounded-xl border border-gray-100 p-3 bg-gray-50/60">
                      <div className="flex items-center gap-3 mb-2">
                        <span className="text-xs font-semibold text-gray-700 flex-1">{PARAM_NAMES[p]}</span>
                        <div className="flex gap-1">
                          {(['Yes', 'No', 'NA'] as const).map(v => (
                            <button key={v} onClick={() => setEditForm(f => f ? { ...f, scores: { ...f.scores, [p]: v } } : f)}
                              className={`px-2.5 py-1 text-xs font-bold rounded-lg transition ${
                                editForm.scores[p] === v
                                  ? v === 'Yes' ? 'bg-emerald-500 text-white' : v === 'No' ? 'bg-red-500 text-white' : 'bg-gray-400 text-white'
                                  : 'bg-white border border-gray-200 text-gray-500 hover:border-gray-400'
                              }`}>{v}</button>
                          ))}
                        </div>
                      </div>
                      <textarea
                        value={editForm.reasoning[p] || ''}
                        onChange={e => setEditForm(f => f ? { ...f, reasoning: { ...f.reasoning, [p]: e.target.value } } : f)}
                        placeholder="Reasoning…"
                        rows={2}
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500/20 resize-y bg-white"
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* Reviewer note */}
              <div>
                <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">Quality Reviewer Note</label>
                <textarea value={editForm.note} onChange={e => setEditForm(f => f ? { ...f, note: e.target.value } : f)} rows={3}
                  placeholder="Internal note for this override…"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400/30 resize-y" />
              </div>

              <div className="flex gap-3 pt-1">
                <button onClick={saveEdit} disabled={savingEdit}
                  className="flex-1 bg-emerald-600 text-white font-bold py-2.5 rounded-xl hover:bg-emerald-700 disabled:opacity-50 transition text-sm">
                  {savingEdit ? 'Saving…' : 'Save Override'}
                </button>
                <button onClick={() => { setEditEntry(null); setEditForm(null); }}
                  className="px-5 border border-gray-200 text-gray-600 font-medium py-2.5 rounded-xl hover:bg-gray-50 transition text-sm">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {agentReportStat && (
        <AgentReportModal
          stat={agentReportStat}
          entries={entries}
          onClose={() => setAgentReportStat(null)}
          onFilterLog={({ agent, minScore, maxScore }) => {
            // Context/State handler logic already maps filters
            switchTab('log');
          }}
        />
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-gray-900 text-white text-sm font-medium px-5 py-3 rounded-2xl shadow-xl">
          {toast}
        </div>
      )}

      {/* ── Left Panel — hover-expand ── */}
      <aside
        onMouseEnter={() => setSidebarExpanded(true)}
        onMouseLeave={() => setSidebarExpanded(false)}
        className={`shrink-0 bg-[#111827] flex flex-col h-full transition-all duration-200 overflow-hidden ${sidebarExpanded ? 'w-60' : 'w-14'}`}
      >
        {/* Logo / header */}
        <div className={`border-b border-white/10 flex flex-col ${sidebarExpanded ? 'px-4 py-4' : 'px-2 py-4 items-center'}`}>
          {sidebarExpanded ? (
            <>
              <Link href="/" className="flex items-center gap-2 text-slate-400 hover:text-white transition mb-4 text-xs font-medium">
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 3L5 8l5 5" /></svg>
                Back to chat
              </Link>
              <div className="bg-white rounded-lg px-2.5 py-1.5 inline-block">
                <Image src="/wint-logo.png" alt="Wint" width={64} height={22} className="object-contain block" unoptimized />
              </div>
              <p className="text-slate-500 text-[10px] mt-1.5 font-semibold uppercase tracking-wider">Quality Intelligence</p>
            </>
          ) : (
            <Link href="/" title="Back to chat"
              className="w-8 h-8 flex items-center justify-center text-slate-500 hover:text-white transition rounded-lg hover:bg-white/10">
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 3L5 8l5 5" /></svg>
            </Link>
          )}
        </div>

        {/* Nav */}
        <nav className={`py-4 flex-1 space-y-1 ${sidebarExpanded ? 'px-3' : 'px-2'}`}>
          <NavItem icon={icons.performance} label="Performance" active={tab === 'performance'}
            collapsed={!sidebarExpanded} onClick={() => switchTab('performance')} />
          <NavItem icon={icons.log} label="Score Log" active={tab === 'log'}
            collapsed={!sidebarExpanded} onClick={() => switchTab('log')} />
          {!selfAgentName && (
            <NavItem icon={icons.upload} label="Upload & Score" active={tab === 'upload'}
              collapsed={!sidebarExpanded} onClick={() => switchTab('upload')} />
          )}
          <NavItem icon={icons.reports} label="Reports" active={tab === 'reports'}
            collapsed={!sidebarExpanded} onClick={() => switchTab('reports')} />
          <NavItem icon={icons.challenges} label="Chats Pending" active={tab === 'pending'}
            collapsed={!sidebarExpanded} badge={challengeCount} onClick={() => switchTab('pending')} />
          <NavItem icon={icons.calls} label="Call Quality" active={tab === 'calls'}
            collapsed={!sidebarExpanded} onClick={() => switchTab('calls')} />
          <NavItem icon={icons.challenges} label="Call Queue" active={tab === 'call-queue'}
            collapsed={!sidebarExpanded} onClick={() => switchTab('call-queue')} />
          {!selfAgentName && (
            <NavItem icon={icons.callTest} label="Call Test" active={tab === 'call-test'}
              collapsed={!sidebarExpanded} onClick={() => switchTab('call-test')} />
          )}
          {!selfAgentName && (
            <NavItem icon={icons.unified} label="Unified Score" active={tab === 'unified'}
              collapsed={!sidebarExpanded} onClick={() => switchTab('unified')} />
          )}
        </nav>
      </aside>

      {/* ── Content ── */}
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        {/* Top bar */}
        <header className="shrink-0 bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between gap-4">
          <div className="shrink-0">
            <h1 className="text-base font-bold text-gray-900">
              {tab === 'performance' ? 'Team Performance' : tab === 'log' ? 'Score Log' : tab === 'reports' ? 'Reports' : tab === 'pending' ? 'Chats Pending' : tab === 'calls' ? 'Call Quality' : tab === 'call-queue' ? 'Call Queue' : tab === 'call-test' ? 'Call Test' : tab === 'unified' ? 'Unified Score' : 'Upload & Score'}
            </h1>
            <p className="text-xs text-gray-500 mt-0.5">
              {tab === 'performance' && `${agentStats.length} agents · ${perfTotal} chats`}
              {tab === 'log' && `${entries.length} of ${totalFiltered} · ${totalStored.toLocaleString()} all-time`}
              {tab === 'upload' && 'Drop a Wint CSV export to begin'}
              {tab === 'reports' && 'Download filtered data as CSV'}
              {tab === 'pending' && `${challengeCount} pending review`}
              {tab === 'calls' && 'Scored IR call recordings'}
              {tab === 'call-queue' && 'Calls pending QA review — scoped to your agents'}
              {tab === 'call-test' && 'Link a call to a chat and run the full scoring pipeline'}
              {tab === 'unified' && 'Score chat + call together — transcribe, retrieve KB, and evaluate both in one run'}
            </p>
          </div>

          {/* Performance tab — independent period picker */}
          {tab === 'performance' && (
            <div className="flex items-center gap-2 ml-auto flex-wrap justify-end">
              {(['today', 'yesterday', '1w'] as const).map(r => (
                <button key={r}
                  onClick={() => { setPerfPeriod(r); setShowPerfPicker(false); loadPerfData(r); }}
                  className={`text-xs px-3 py-1.5 rounded-lg font-semibold transition ${
                    perfPeriod === r ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                  }`}>
                  {r === 'today' ? 'Today' : r === 'yesterday' ? 'Yesterday' : '1 Week'}
                </button>
              ))}
              {/* Custom date range */}
              <div className="relative">
                <button
                  onClick={() => { setPerfPeriod('custom'); setShowPerfPicker(v => !v); }}
                  className={`text-xs px-3 py-1.5 rounded-lg font-semibold transition ${
                    perfPeriod === 'custom' ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                  }`}>
                  {perfPeriod === 'custom' && perfDateFrom
                    ? `${perfDateFrom.slice(5)} → ${perfDateTo ? perfDateTo.slice(5) : '…'}`
                    : 'Custom'}
                </button>
                {showPerfPicker && (
                  <div className="absolute right-0 top-full mt-2 bg-white border border-gray-200 rounded-2xl shadow-xl z-30 overflow-hidden">
                    <DateRangePicker
                      from={perfDateFrom} to={perfDateTo}
                      onChange={(f, t) => { setPerfDateFrom(f); setPerfDateTo(t); loadPerfData('custom', f, t); }}
                      onClose={() => setShowPerfPicker(false)}
                    />
                  </div>
                )}
              </div>
              {userRole === 'admin' && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={runPendingScores}
                    disabled={batchRunning}
                    title="Score all unscored conversations in the DB"
                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-semibold bg-blue-50 text-blue-700 hover:bg-blue-100 disabled:opacity-50 transition border border-blue-200"
                  >
                    {batchRunning ? (
                      <>
                        <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" strokeOpacity=".25"/><path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round"/></svg>
                        {batchProgress ? `${batchProgress.scored} done · ${batchProgress.remaining} left` : 'Starting…'}
                      </>
                    ) : batchProgress ? (
                      <>
                        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M13.5 2.5L6 10l-3.5-3.5L1 8l5 5 9-9z"/></svg>
                        {batchProgress.scored} scored{batchProgress.errors > 0 ? ` · ${batchProgress.errors} errors` : ''}
                      </>
                    ) : (
                      <>
                        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M8 1l1.8 3.6L14 5.6l-3 2.9.7 4.1L8 10.5l-3.7 2.1.7-4.1-3-2.9 4.2-.4z"/></svg>
                        Score Pending
                      </>
                    )}
                  </button>
                  <button
                    onClick={backfillSheet}
                    disabled={sheetBackfilling}
                    title="Send today's critical-parameter failures to the Google Sheet"
                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-semibold bg-emerald-50 text-emerald-700 hover:bg-emerald-100 disabled:opacity-50 transition border border-emerald-200"
                  >
                    {sheetBackfilling ? (
                      <>
                        <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" strokeOpacity=".25"/><path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round"/></svg>
                        Sending…
                      </>
                    ) : sheetBackfillResult ? (
                      <>
                        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M13.5 2.5L6 10l-3.5-3.5L1 8l5 5 9-9z"/></svg>
                        {sheetBackfillResult.sent} sent
                      </>
                    ) : (
                      <>
                        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="3" width="12" height="10" rx="1"/><path d="M5 7h6M5 10h4"/></svg>
                        Fill Sheet Today
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Score Log tab — Filters button */}
          {tab === 'log' && (
            <div className="flex items-center gap-2 ml-auto">
              <button
                onClick={() => setShowOnlyNeedsReview(v => !v)}
                className={`flex items-center gap-1.5 text-xs px-3.5 py-1.5 rounded-xl font-semibold transition border ${
                  showOnlyNeedsReview
                    ? 'bg-amber-500 text-white border-amber-500'
                    : 'bg-white text-amber-600 border-amber-300 hover:bg-amber-50'
                }`}
                title="Show only chats needing QA review"
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="8" cy="8" r="7"/><path d="M8 5v3.5M8 11v.5" strokeLinecap="round"/></svg>
                Needs Review
              </button>
            </div>
          )}
        </header>

        {/* Tab Content Panel */}
        <div className="flex-1 overflow-y-auto p-6">
          {tab === 'performance' && <PerformanceTab />}
          {tab === 'log' && <ScoreLogTab />}
          {tab === 'upload' && <UploadTab />}
          {tab === 'reports' && <ReportsTab />}
          {tab === 'pending' && <PendingChatsTab userRole={userRole} userEmail={userEmail} initialSection={initialSection} />}
          {tab === 'calls' && <CallQualityClient userRole={userRole} userEmail={userEmail} />}
          {tab === 'call-queue' && <CallQueueTab userRole={userRole} userEmail={userEmail} />}
          {tab === 'call-test' && <CallLinkTestClient />}
          {tab === 'unified' && <UnifiedScoringClient initialChatId={initialChatId} />}
        </div>
      </div>
    </div>
  );
}

export default function QualityClient({
  userRole,
  userEmail,
  selfAgentName,
  initialAgent,
  initialTab,
  initialSection,
  initialChatId,
}: QualityClientProps = {}) {
  return (
    <QualityProvider
      userRole={userRole}
      userEmail={userEmail}
      selfAgentName={selfAgentName}
      initialTab={initialTab}
      initialAgent={initialAgent}
    >
      <QualityClientInner
        userRole={userRole}
        userEmail={userEmail}
        initialSection={initialSection}
        initialChatId={initialChatId}
      />
    </QualityProvider>
  );
}
