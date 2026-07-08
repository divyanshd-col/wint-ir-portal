'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { CALL_PARAM_ORDER } from '@/lib/call-quality';
import { CallTranscriptCard } from '@/components/CallTranscriptCard';
import type { CallQueueItem } from './types';
import { CALL_QUEUE_PARAM_NAMES } from './types';

function fmtDurQ(secs: number | null | undefined): string {
  if (secs == null || secs < 0) return '—';
  const m = Math.floor(secs / 60), s = secs % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function iqsColorQ(iqs: number | null) {
  if (iqs === null) return { text: '#6b7280', bg: '#f3f4f6' };
  if (iqs >= 90) return { text: '#15803d', bg: '#dcfce7' };
  if (iqs >= 80) return { text: '#92400e', bg: '#fef3c7' };
  if (iqs >= 70) return { text: '#c2410c', bg: '#ffedd5' };
  return { text: '#b91c1c', bg: '#fee2e2' };
}

export default function CallQueueTab({ userRole, userEmail }: { userRole?: string; userEmail?: string }) {
  const [section, setSection] = useState<'pending' | 'reviewed'>('pending');
  const [items, setItems] = useState<CallQueueItem[]>([]);
  const [reviewedItems, setReviewedItems] = useState<CallQueueItem[]>([]);
  const [availableAgents, setAvailableAgents] = useState<string[]>([]);
  const [assignedCallDispositions, setAssignedCallDispositions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [reviewing, setReviewing] = useState<Record<string, boolean>>({});
  const [transcripts, setTranscripts] = useState<Record<string, any[]>>({});
  const [transcriptLoading, setTranscriptLoading] = useState<Record<string, boolean>>({});
  const [callScoreResults, setCallScoreResults] = useState<Record<string, any>>({});
  const [callScoreLoading, setCallScoreLoading] = useState<Record<string, boolean>>({});
  const [callOverrideItem, setCallOverrideItem] = useState<CallQueueItem | null>(null);
  const [callOverrideForm, setCallOverrideForm] = useState<{
    scores: Record<string, string>; reasoning: Record<string, string>; note: string;
  } | null>(null);
  const [callOverrideSaving, setCallOverrideSaving] = useState(false);

  // Filters
  const [dateRange, setDateRange] = useState<'today' | 'yesterday' | '1w' | 'custom'>('1w');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [agentFilter, setAgentFilter] = useState('');
  const [minScore, setMinScore] = useState(0);
  const [maxScore, setMaxScore] = useState(100);
  const [showFilters, setShowFilters] = useState(false);

  const canReview = ['quality', 'admin', 'tl'].includes(userRole || '');

  const buildParams = () => {
    const p = new URLSearchParams();
    if (dateRange === 'today') {
      const d = new Date().toISOString().slice(0, 10);
      p.set('dateFrom', d); p.set('dateTo', d);
    } else if (dateRange === 'yesterday') {
      const d = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      p.set('dateFrom', d); p.set('dateTo', d);
    } else if (dateRange === '1w') {
      p.set('dateFrom', new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10));
      p.set('dateTo', new Date().toISOString().slice(0, 10));
    } else if (dateRange === 'custom') {
      if (dateFrom) p.set('dateFrom', dateFrom);
      if (dateTo)   p.set('dateTo', dateTo);
    }
    if (agentFilter) p.set('agent', agentFilter);
    if (minScore > 0) p.set('minScore', String(minScore));
    if (maxScore < 100) p.set('maxScore', String(maxScore));
    return p;
  };

  const fetchQueue = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const d = await fetch(`/api/call-quality/pending-review?${buildParams()}`).then(r => r.json());
      setItems(d.items || []);
      setReviewedItems(d.reviewedItems || []);
      setAvailableAgents(d.availableAgents || []);
      setAssignedCallDispositions(d.assignedCallDispositions || []);
    } catch {
      setLoadError('Failed to load call queue');
    }
    setLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateRange, dateFrom, dateTo, agentFilter, minScore, maxScore]);

  useEffect(() => { fetchQueue(); }, [fetchQueue]);

  const onExpandCard = useCallback(async (callId: string) => {
    setExpandedId(prev => prev === callId ? null : callId);
    if (transcripts[callId] !== undefined || transcriptLoading[callId]) return;
    setTranscriptLoading(t => ({ ...t, [callId]: true }));
    try {
      const data = await fetch(`/api/call-quality/transcript?callId=${callId}`).then(r => r.json());
      setTranscripts(t => ({ ...t, [callId]: data.found ? (data.segments || []) : [] }));
    } catch {
      setTranscripts(t => ({ ...t, [callId]: [] }));
    }
    setTranscriptLoading(t => ({ ...t, [callId]: false }));
  }, [transcripts, transcriptLoading]);

  const scoreCall = async (callId: string) => {
    setCallScoreLoading(s => ({ ...s, [callId]: true }));
    try {
      const res = await fetch('/api/call-quality/score-call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callId }),
      });
      const data = await res.json();
      if (data.ok) setCallScoreResults(r => ({ ...r, [callId]: data }));
    } catch {}
    setCallScoreLoading(s => ({ ...s, [callId]: false }));
  };

  const markReviewed = async (item: CallQueueItem) => {
    setReviewing(r => ({ ...r, [item.callId]: true }));
    try {
      const res = await fetch('/api/call-quality/pending-review', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callId: item.callId, reviewNote: reviewNotes[item.callId] || '' }),
      });
      if (!res.ok) throw new Error('Server error');
      const now = new Date().toISOString();
      const reviewed = { reviewedBy: userEmail || '', reviewedAt: now, reviewNote: reviewNotes[item.callId] || '' };
      setItems(prev => prev.filter(i => i.callId !== item.callId));
      setReviewedItems(prev => [{ ...item, qaStatus: reviewed }, ...prev]);
    } catch {
      alert('Failed to mark as reviewed');
    }
    setReviewing(r => ({ ...r, [item.callId]: false }));
  };

  const openCallOverride = (item: CallQueueItem, activeScores: Record<string, string>, activeReasoning: Record<string, string>) => {
    setCallOverrideItem(item);
    setCallOverrideForm({
      scores: { ...activeScores },
      reasoning: { ...activeReasoning },
      note: '',
    });
  };

  const saveCallOverride = async () => {
    if (!callOverrideItem || !callOverrideForm) return;
    if (!callOverrideItem.chatId) { alert('Cannot override: no chat ID linked to this call'); return; }
    setCallOverrideSaving(true);
    try {
      const res = await fetch('/api/call-quality/override-scores', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: callOverrideItem.chatId,
          scores: callOverrideForm.scores,
          reasoning: callOverrideForm.reasoning,
          note: callOverrideForm.note,
        }),
      });
      if (!res.ok) throw new Error('Server error');
      const data = await res.json();
      setCallScoreResults(r => ({
        ...r,
        [callOverrideItem.callId]: {
          scores: callOverrideForm.scores,
          reasoning: callOverrideForm.reasoning,
          iqs: data.callIqsScore ?? callOverrideItem.iqs,
        },
      }));
      setCallOverrideItem(null);
      setCallOverrideForm(null);
    } catch {
      alert('Failed to save override');
    }
    setCallOverrideSaving(false);
  };

  const displayItems = section === 'pending' ? items : reviewedItems;

  const renderCard = (item: CallQueueItem) => {
    const isExpanded = expandedId === item.callId;
    const color = iqsColorQ(item.iqs);
    const isReviewed = !!item.qaStatus;
    const activeResult = callScoreResults[item.callId];
    const activeScores = activeResult?.scores || item.scores;
    const activeReasoning = activeResult?.reasoning || item.reasoning;
    const activeFailedParams = CALL_PARAM_ORDER.filter(k => activeScores[k] === 'No');

    return (
      <div key={item.callId} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <button
          onClick={() => onExpandCard(item.callId)}
          className="w-full text-left px-5 py-4 flex items-start gap-4 hover:bg-gray-50/60 transition bg-transparent"
        >
          <div className="shrink-0 flex flex-col items-center justify-center rounded-xl px-3 py-2 min-w-[56px]" style={{ background: color.bg }}>
            <span className="text-lg font-black tabular-nums leading-none" style={{ color: color.text }}>{item.iqs ?? '—'}</span>
            <span className="text-[9px] font-semibold mt-0.5 uppercase tracking-wider" style={{ color: color.text }}>IQS</span>
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-bold text-gray-900">{item.agentName || '—'}</span>
              {item.language && item.language !== 'en' && (
                <span className="text-[10px] font-bold bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full uppercase">{item.language}</span>
              )}
              {isReviewed && (
                <span className="text-[10px] font-bold bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full">Reviewed</span>
              )}
            </div>
            <div className="flex items-center gap-3 mt-1 text-xs text-gray-500 flex-wrap">
              <span>{item.date}</span>
              {item.calledAt && <span>{new Date(item.calledAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>}
              <span>⏱ {fmtDurQ(item.durationSeconds)}</span>
              {item.interruptionCount > 0 && <span className="text-orange-500">⚡ {item.interruptionCount} interruptions</span>}
              {item.deadAirCount > 0 && <span className="text-slate-400">🔇 {item.deadAirCount} dead air</span>}
            </div>
            {item.failedParams.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {item.failedParams.map(p => (
                  <span key={p} className="text-[10px] font-semibold bg-red-50 text-red-600 px-2 py-0.5 rounded-full">
                    {CALL_QUEUE_PARAM_NAMES[p] ?? p}
                  </span>
                ))}
              </div>
            )}
          </div>

          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"
            className={`shrink-0 mt-1 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}>
            <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>

        {isExpanded && (
          <div className="border-t border-gray-100 divide-y divide-gray-50">
            <div className="px-5 py-4">
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-3">Call Transcript</p>
              {transcriptLoading[item.callId] ? (
                <p className="text-xs text-gray-400 animate-pulse">Loading transcript…</p>
              ) : transcripts[item.callId]?.length ? (
                <CallTranscriptCard
                  rec={{
                    id: item.callId,
                    label: 'Call',
                    calledAt: item.calledAt || null,
                    durationSeconds: item.durationSeconds,
                    recordingUrl: null,
                    segments: transcripts[item.callId],
                    interruptionCount: item.interruptionCount,
                    deadAirCount: item.deadAirCount,
                  }}
                  index={0}
                  defaultOpen
                />
              ) : transcripts[item.callId] ? (
                <p className="text-xs text-gray-400 italic">No transcript available for this call</p>
              ) : (
                <p className="text-xs text-gray-400 italic">Loading…</p>
              )}
            </div>

            <div className="px-5 py-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Quality Scores</p>
                <div className="flex gap-2">
                  {canReview && (
                    <button
                      onClick={() => openCallOverride(item, activeScores, activeReasoning)}
                      className="text-xs px-3 py-1 rounded-lg bg-amber-50 text-amber-700 hover:bg-amber-100 font-semibold transition-colors"
                    >
                      ✏️ Override
                    </button>
                  )}
                  <button
                    onClick={() => scoreCall(item.callId)}
                    disabled={callScoreLoading[item.callId]}
                    className="text-xs px-3 py-1 rounded-lg bg-violet-50 text-violet-700 hover:bg-violet-100 disabled:opacity-50 font-semibold transition-colors"
                  >
                    {callScoreLoading[item.callId] ? '⏳ Scoring…' : '⚡ Score This Call'}
                  </button>
                </div>
              </div>
              {activeResult?.iqs !== undefined && (
                <p className="text-sm font-bold text-violet-700">Per-call IQS: {activeResult.iqs}</p>
              )}
              <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
                {Object.entries(activeScores).map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between gap-2">
                    <span className="text-xs text-gray-600 truncate">{CALL_QUEUE_PARAM_NAMES[k] ?? k}</span>
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${v === 'Yes' ? 'bg-emerald-50 text-emerald-700' : v === 'No' ? 'bg-red-50 text-red-600' : 'bg-gray-100 text-gray-500'}`}>{v as string}</span>
                  </div>
                ))}
              </div>
              {activeFailedParams.length > 0 && (
                <div className="space-y-2">
                  {activeFailedParams.map(p => activeReasoning[p] ? (
                    <div key={p} className="bg-red-50/60 rounded-xl px-3 py-2">
                      <p className="text-[10px] font-bold text-red-700 mb-0.5">{CALL_QUEUE_PARAM_NAMES[p] ?? p}</p>
                      <p className="text-[11px] text-gray-600 leading-relaxed">{activeReasoning[p]}</p>
                    </div>
                  ) : null)}
                </div>
              )}
            </div>

            <div className="px-5 py-4 space-y-3">
              {item.chatId && (
                <p className="text-xs text-gray-400">
                  Chat: <span className="font-mono text-gray-600">{item.chatId}</span>
                </p>
              )}
              {isReviewed ? (
                <div className="bg-emerald-50 rounded-xl px-4 py-3">
                  <p className="text-xs font-bold text-emerald-800">Reviewed by {item.qaStatus!.reviewedBy}</p>
                  <p className="text-[11px] text-emerald-700 mt-0.5">{new Date(item.qaStatus!.reviewedAt).toLocaleString('en-IN')}</p>
                  {item.qaStatus!.reviewNote && <p className="text-[11px] text-gray-600 mt-1 italic">"{item.qaStatus!.reviewNote}"</p>}
                </div>
              ) : canReview ? (
                <div className="space-y-2">
                  <textarea
                    rows={2}
                    value={reviewNotes[item.callId] || ''}
                    onChange={e => setReviewNotes(n => ({ ...n, [item.callId]: e.target.value }))}
                    placeholder="Optional review note…"
                    className="w-full text-xs border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 resize-none bg-white text-gray-800"
                  />
                  <button
                    onClick={() => markReviewed(item)}
                    disabled={reviewing[item.callId]}
                    className="px-4 py-1.5 bg-emerald-600 text-white text-xs font-bold rounded-xl hover:bg-emerald-700 disabled:opacity-40 transition"
                  >
                    {reviewing[item.callId] ? 'Saving…' : 'Mark as Reviewed'}
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {callOverrideItem && callOverrideForm && (
        <div className="fixed inset-0 bg-black/70 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => { setCallOverrideItem(null); setCallOverrideForm(null); }}>
          <div className="bg-white w-full sm:rounded-2xl sm:max-w-3xl max-h-[94vh] overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between">
              <div>
                <h2 className="font-bold text-gray-900">Override Call Scores</h2>
                <p className="text-xs text-gray-400">{callOverrideItem.agentName} · {callOverrideItem.date}</p>
              </div>
              <button onClick={() => { setCallOverrideItem(null); setCallOverrideForm(null); }} className="p-2 rounded-xl hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 2l12 12M14 2L2 14" /></svg>
              </button>
            </div>
            <div className="px-6 py-5 space-y-5">
              <div>
                <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-3">Parameter Scores</p>
                <div className="space-y-3">
                  {CALL_PARAM_ORDER.map(p => (
                    <div key={p} className="rounded-xl border border-gray-100 p-3 bg-gray-50/60">
                      <div className="flex items-center gap-3 mb-2">
                        <span className="text-xs font-semibold text-gray-700 flex-1">{CALL_QUEUE_PARAM_NAMES[p] ?? p}</span>
                        <div className="flex gap-1">
                          {(['Yes', 'No', 'NA'] as const).map(v => (
                            <button key={v} onClick={() => setCallOverrideForm(f => f ? { ...f, scores: { ...f.scores, [p]: v } } : f)}
                              className={`px-2.5 py-1 text-xs font-bold rounded-lg transition ${
                                callOverrideForm.scores[p] === v
                                  ? v === 'Yes' ? 'bg-emerald-500 text-white' : v === 'No' ? 'bg-red-500 text-white' : 'bg-gray-400 text-white'
                                  : 'bg-white border border-gray-200 text-gray-500 hover:border-gray-400'
                              }`}>{v}</button>
                          ))}
                        </div>
                      </div>
                      <textarea
                        value={callOverrideForm.reasoning[p] || ''}
                        onChange={e => setCallOverrideForm(f => f ? { ...f, reasoning: { ...f.reasoning, [p]: e.target.value } } : f)}
                        placeholder="Reasoning…"
                        rows={2}
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500/20 resize-y bg-white text-gray-800"
                      />
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">Quality Reviewer Note</label>
                <textarea value={callOverrideForm.note} onChange={e => setCallOverrideForm(f => f ? { ...f, note: e.target.value } : f)} rows={3}
                  placeholder="Internal note for this override…"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400/30 bg-white text-gray-800" />
              </div>
              {!callOverrideItem.chatId && (
                <p className="text-xs text-amber-600 bg-amber-50 rounded-xl px-3 py-2">
                  ⚠️ This call has no linked chat — override cannot be saved until the call is linked to a chat.
                </p>
              )}
              <div className="flex gap-3 pt-1">
                <button onClick={saveCallOverride} disabled={callOverrideSaving || !callOverrideItem.chatId}
                  className="flex-1 bg-emerald-600 text-white font-bold py-2.5 rounded-xl hover:bg-emerald-700 disabled:opacity-50 transition text-sm">
                  {callOverrideSaving ? 'Saving…' : 'Save Override'}
                </button>
                <button onClick={() => { setCallOverrideItem(null); setCallOverrideForm(null); }}
                  className="px-5 border border-gray-200 text-gray-600 font-medium py-2.5 rounded-xl hover:bg-gray-50 transition text-sm bg-white">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="shrink-0 px-6 pt-5 pb-3 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-1 bg-gray-100 rounded-xl p-1">
            <button onClick={() => setSection('pending')}
              className={`text-xs px-4 py-1.5 rounded-lg font-semibold transition ${section === 'pending' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
              Pending
              {items.length > 0 && <span className="ml-1.5 bg-amber-100 text-amber-700 text-[10px] font-bold px-1.5 py-0.5 rounded-full">{items.length}</span>}
            </button>
            <button onClick={() => setSection('reviewed')}
              className={`text-xs px-4 py-1.5 rounded-lg font-semibold transition ${section === 'reviewed' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
              Reviewed
              {reviewedItems.length > 0 && <span className="ml-1.5 bg-gray-200 text-gray-600 text-[10px] font-bold px-1.5 py-0.5 rounded-full">{reviewedItems.length}</span>}
            </button>
          </div>
          <button onClick={() => setShowFilters(v => !v)}
            className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl font-semibold border transition ${showFilters ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'}`}>
            Filters
          </button>
        </div>

        {assignedCallDispositions.length > 0 && (
          <p className="text-xs text-blue-600 bg-blue-50 rounded-xl px-3 py-2">
            Default scope: {assignedCallDispositions.join(', ')} — select a different filter to override
          </p>
        )}

        {showFilters && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-4">
            <div>
              <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-2">Date Range</p>
              <div className="flex flex-wrap gap-2">
                {(['today', 'yesterday', '1w'] as const).map(r => (
                  <button key={r} onClick={() => setDateRange(r)}
                    className={`text-xs px-3 py-1.5 rounded-lg font-semibold transition ${dateRange === r ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
                    {r === 'today' ? 'Today' : r === 'yesterday' ? 'Yesterday' : '1 Week'}
                  </button>
                ))}
                <button onClick={() => setDateRange('custom')}
                  className={`text-xs px-3 py-1.5 rounded-lg font-semibold transition ${dateRange === 'custom' ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
                  Custom
                </button>
                {dateRange === 'custom' && (
                  <div className="flex items-center gap-2 ml-1">
                    <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                      className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 bg-white text-gray-800" />
                    <span className="text-gray-400 text-xs">→</span>
                    <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                      className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 bg-white text-gray-800" />
                  </div>
                )}
              </div>
            </div>

            <div className="flex flex-wrap gap-4">
              {availableAgents.length > 0 && (
                <div>
                  <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Agent</p>
                  <select value={agentFilter} onChange={e => setAgentFilter(e.target.value)}
                    className="text-xs border border-gray-200 rounded-xl px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 bg-white text-gray-700">
                    <option value="">All agents</option>
                    {availableAgents.map(a => <option key={a} value={a}>{a}</option>)}
                  </select>
                </div>
              )}
              <div>
                <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">IQS Range</p>
                <div className="flex items-center gap-2">
                  <input type="number" min={0} max={100} value={minScore}
                    onChange={e => setMinScore(parseInt(e.target.value) || 0)}
                    className="w-14 text-xs border border-gray-200 rounded-xl px-2 py-1.5 text-center focus:outline-none focus:ring-2 focus:ring-emerald-500/30 bg-white text-gray-800" />
                  <span className="text-gray-400 text-xs">–</span>
                  <input type="number" min={0} max={100} value={maxScore}
                    onChange={e => setMaxScore(parseInt(e.target.value) || 100)}
                    className="w-14 text-xs border border-gray-200 rounded-xl px-2 py-1.5 text-center focus:outline-none focus:ring-2 focus:ring-emerald-500/30 bg-white text-gray-800" />
                </div>
              </div>
            </div>

            <div className="flex gap-3">
              <button onClick={() => { fetchQueue(); setShowFilters(false); }} disabled={loading}
                className="px-5 py-1.5 bg-emerald-600 text-white text-xs font-bold rounded-xl hover:bg-emerald-700 disabled:opacity-40 transition">
                {loading ? 'Loading…' : 'Apply Filters'}
              </button>
              <button onClick={() => {
                setDateRange('1w'); setDateFrom(''); setDateTo('');
                setAgentFilter(''); setMinScore(0); setMaxScore(100);
              }} className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700 font-medium transition">
                Reset
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-6 pb-6 space-y-3">
        {displayItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <p className="text-2xl mb-2">{section === 'pending' ? '✓' : '📋'}</p>
            <p className="text-sm font-semibold text-gray-700">
              {section === 'pending' ? 'All caught up' : 'No reviewed calls yet'}
            </p>
            <p className="text-xs text-gray-400 mt-1">
              {section === 'pending' ? 'No calls pending review for your agents.' : 'Mark some calls as reviewed to see them here.'}
            </p>
          </div>
        ) : displayItems.map(renderCard)}
      </div>
    </div>
  );
}
