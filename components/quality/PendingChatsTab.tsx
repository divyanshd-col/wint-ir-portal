'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { PARAM_ORDER, PARAM_NAMES, WEIGHTS } from '@/lib/quality';
import type { IQSFlagComment, PendingReviewItem, LogFilters } from './types';
import { PENDING_DEFAULT_FILTERS } from './types';
import { IQSRing } from '@/components/quality/IQSRing';
import TranscriptBubbles, { renderContentWithLinks } from '@/components/quality/TranscriptBubbles';
import { ChatLink } from './helpers';

function buildPendingParams(f: LogFilters): URLSearchParams {
  const p = new URLSearchParams();
  if (f.agent)           p.set('agent', f.agent);
  if (f.minScore > 0)    p.set('minScore', String(f.minScore));
  if (f.maxScore < 100)  p.set('maxScore', String(f.maxScore));
  if (f.disposition)     p.set('tag', f.disposition);
  if (f.subDisposition)  p.set('subTag', f.subDisposition);
  if (f.dateRange === 'today') {
    const d = new Date().toISOString().slice(0, 10);
    p.set('dateFrom', d); p.set('dateTo', d);
  } else if (f.dateRange === 'yesterday') {
    const d = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    p.set('dateFrom', d); p.set('dateTo', d);
  } else if (f.dateRange === '1w') {
    p.set('dateFrom', new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10));
    p.set('dateTo', new Date().toISOString().slice(0, 10));
  } else if (f.dateRange === 'custom') {
    if (f.dateFrom) p.set('dateFrom', f.dateFrom);
    if (f.dateTo)   p.set('dateTo', f.dateTo);
  }
  return p;
}

export default function PendingChatsTab({ userRole, userEmail, initialSection }: { userRole?: string; userEmail?: string; initialSection?: 'pending' | 'reviewed' }) {
  const [filter, setFilter] = useState<'all' | 'challenged' | 'uncertain'>('all');
  const [chatIdSearch, setChatIdSearch] = useState('');
  const [section, setSection] = useState<'pending' | 'reviewed'>(initialSection || 'pending');

  const switchSection = (s: 'pending' | 'reviewed') => {
    setSection(s);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.set('tab', 'pending');
      if (s === 'reviewed') url.searchParams.set('section', 'reviewed');
      else url.searchParams.delete('section');
      window.history.replaceState({}, '', url.toString());
    }
  };
  const [items, setItems] = useState<PendingReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [threads, setThreads] = useState<Record<string, IQSFlagComment[]>>({});
  const [threadLoading, setThreadLoading] = useState<Record<string, boolean>>({});
  const [replyText, setReplyText] = useState<Record<string, string>>({});
  const [replySending, setReplySending] = useState<Record<string, boolean>>({});
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [reviewing, setReviewing] = useState<Record<string, boolean>>({});
  const [transcripts, setTranscripts] = useState<Record<string, { timedMessages?: any[]; rawTranscript?: string; callRecordings?: any[] } | null>>({});
  const [transcriptLoading, setTranscriptLoading] = useState<Record<string, boolean>>({});
  // Inline edit state — keyed by chatId
  const [inlineEdit, setInlineEdit] = useState<Record<string, { scores: Record<string, string>; reasoning: Record<string, string>; note: string }>>({});
  const [overrideSaving, setOverrideSaving] = useState<Record<string, boolean>>({});
  const [overrideSaved, setOverrideSaved]   = useState<Record<string, boolean>>({});
  // Prior chat history
  const [histories, setHistories]           = useState<Record<string, any[] | null>>({});
  const [historyLoading, setHistoryLoading] = useState<Record<string, boolean>>({});
  const [showHistory, setShowHistory]       = useState<Record<string, boolean>>({});
  const [priorTranscripts, setPriorTranscripts] = useState<Record<string, { timedMessages?: any[]; rawTranscript?: string; callRecordings?: any[] } | null>>({});
  const [priorTranscriptLoading, setPriorTranscriptLoading] = useState<Record<string, boolean>>({});
  const [expandedPriorChat, setExpandedPriorChat] = useState<Record<string, string | null>>({});

  // Filter state
  const [pendingFilters, setPendingFilters] = useState<LogFilters>(PENDING_DEFAULT_FILTERS);
  const [showFilterPanel, setShowFilterPanel] = useState(false);
  const [availableDispositions, setAvailableDispositions] = useState<string[]>([]);
  const [availableAgents, setAvailableAgents] = useState<string[]>([]);
  const [dispositionSubMap, setDispositionSubMap] = useState<Record<string, string[]>>({});
  const [assignedDispositions, setAssignedDispositions] = useState<string[] | null>(null);

  const fetchPending = useCallback(async (filters: LogFilters) => {
    setLoading(true);
    setLoadError('');
    try {
      const params = buildPendingParams(filters);
      const d = await fetch(`/api/quality/pending-review?${params}`).then(r => r.json());
      setItems(d.items || []);
      setAvailableDispositions(d.availableDispositions || []);
      setAvailableAgents(d.availableAgents || []);
      setDispositionSubMap(d.dispositionSubMap || {});
      if (d.assignedDispositions) setAssignedDispositions(d.assignedDispositions);
    } catch {
      setLoadError('Failed to load pending chats');
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchPending(PENDING_DEFAULT_FILTERS); }, [fetchPending]);

  const loadThread = async (flagId: string) => {
    if (threads[flagId] !== undefined) return;
    setThreadLoading(t => ({ ...t, [flagId]: true }));
    try {
      const d = await fetch(`/api/quality/flag-thread?flagId=${encodeURIComponent(flagId)}`).then(r => r.json());
      setThreads(t => ({ ...t, [flagId]: d.comments || [] }));
    } catch {}
    setThreadLoading(t => ({ ...t, [flagId]: false }));
  };

  const loadTranscript = async (chatId: string) => {
    if (transcripts[chatId] !== undefined) return;
    setTranscriptLoading(t => ({ ...t, [chatId]: true }));
    try {
      const d = await fetch(`/api/quality/transcript?chatId=${encodeURIComponent(chatId)}`).then(r => r.json());
      setTranscripts(t => ({
        ...t,
        [chatId]: d.found
          ? { timedMessages: d.timedMessages, rawTranscript: d.rawTranscript, callRecordings: d.callRecordings || [] }
          : {},
      }));
    } catch {
      setTranscripts(t => ({ ...t, [chatId]: {} }));
    }
    setTranscriptLoading(t => ({ ...t, [chatId]: false }));
  };

  const loadHistory = async (chatId: string) => {
    if (histories[chatId] !== undefined) return;
    setHistoryLoading(h => ({ ...h, [chatId]: true }));
    try {
      const d = await fetch(`/api/quality/history?chatId=${encodeURIComponent(chatId)}`).then(r => r.json());
      setHistories(h => ({ ...h, [chatId]: d.history || [] }));
    } catch { setHistories(h => ({ ...h, [chatId]: [] })); }
    setHistoryLoading(h => ({ ...h, [chatId]: false }));
  };

  const loadPriorTranscript = async (priorChatId: string) => {
    if (priorTranscripts[priorChatId] !== undefined) return;
    setPriorTranscriptLoading(t => ({ ...t, [priorChatId]: true }));
    try {
      const d = await fetch(`/api/quality/transcript?chatId=${encodeURIComponent(priorChatId)}`).then(r => r.json());
      setPriorTranscripts(t => ({
        ...t,
        [priorChatId]: d.found
          ? { timedMessages: d.timedMessages, rawTranscript: d.rawTranscript, callRecordings: d.callRecordings || [] }
          : {},
      }));
    } catch { setPriorTranscripts(t => ({ ...t, [priorChatId]: {} })); }
    setPriorTranscriptLoading(t => ({ ...t, [priorChatId]: false }));
  };

  const togglePriorChat = (parentChatId: string, priorChatId: string) => {
    setExpandedPriorChat(s => {
      const next = s[parentChatId] === priorChatId ? null : priorChatId;
      if (next) loadPriorTranscript(next);
      return { ...s, [parentChatId]: next };
    });
  };

  const saveOverride = async (item: PendingReviewItem) => {
    const edit = inlineEdit[item.chatId];
    if (!edit) return;
    setOverrideSaving(s => ({ ...s, [item.chatId]: true }));
    try {
      const res = await fetch('/api/quality/update', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId: item.chatId, scores: edit.scores, reasoning: edit.reasoning, note: edit.note }),
      });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const data = await res.json();
      const newIqs = data.entry?.iqs;
      setItems(prev => prev.map(i =>
        i.chatId === item.chatId
          ? { ...i, scores: edit.scores, reasoning: edit.reasoning, ...(newIqs !== undefined ? { iqs: newIqs } : {}) }
          : i
      ));
      setInlineEdit(s => ({ ...s, [item.chatId]: { scores: edit.scores, reasoning: edit.reasoning, note: '' } }));
      setOverrideSaved(s => ({ ...s, [item.chatId]: true }));
      setTimeout(() => setOverrideSaved(s => ({ ...s, [item.chatId]: false })), 3000);
    } catch (e: any) { alert(e?.message || 'Failed to save override'); }
    setOverrideSaving(s => ({ ...s, [item.chatId]: false }));
  };

  const expand = (chatId: string, flagId?: string) => {
    if (expandedId === chatId) { setExpandedId(null); return; }
    setExpandedId(chatId);
    loadTranscript(chatId);
    loadHistory(chatId);
    if (flagId) loadThread(flagId);
    const it = items.find(i => i.chatId === chatId);
    if (it) {
      setInlineEdit(s => s[chatId] ? s : {
        ...s,
        [chatId]: { scores: { ...(it.scores || {}) }, reasoning: { ...(it.reasoning || {}) }, note: '' },
      });
    }
  };

  const sendReply = async (flagId: string) => {
    const text = (replyText[flagId] || '').trim();
    if (!text) return;
    setReplySending(s => ({ ...s, [flagId]: true }));
    try {
      const d = await fetch('/api/quality/flag-thread', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ flagId, content: text }),
      }).then(r => r.json());
      if (d.comment) {
        setThreads(t => ({ ...t, [flagId]: [...(t[flagId] || []), d.comment] }));
        setReplyText(r => ({ ...r, [flagId]: '' }));
      }
    } catch {}
    setReplySending(s => ({ ...s, [flagId]: false }));
  };

  const markReviewed = async (chatId: string) => {
    const canEdit = userRole === 'quality' || userRole === 'admin';
    const note = canEdit ? (inlineEdit[chatId]?.note || '') : (reviewNotes[chatId] || '');
    setReviewing(r => ({ ...r, [chatId]: true }));
    try {
      const res = await fetch('/api/quality/pending-review', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId, reviewNote: note }),
      });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const now = new Date().toISOString();
      setItems(prev => prev.map(item =>
        item.chatId === chatId
          ? { ...item, qaStatus: { reviewedBy: userEmail || '', reviewedAt: now, reviewNote: note } }
          : item
      ));
      switchSection('reviewed');
    } catch (e: any) { alert(e?.message || 'Failed to mark reviewed'); }
    setReviewing(r => ({ ...r, [chatId]: false }));
  };

  const canReview = ['quality', 'admin', 'tl'].includes(userRole || '');

  // Filter & section lists
  let filtered = items;
  if (filter === 'challenged') filtered = filtered.filter(i => !!i.flag && i.flag.status === 'pending');
  else if (filter === 'uncertain') filtered = filtered.filter(i => !!(i.uncertainParameters && i.uncertainParameters.length > 0));
  if (chatIdSearch) filtered = filtered.filter(i => i.chatId.toLowerCase().includes(chatIdSearch.toLowerCase()));
  const pendingItems  = filtered.filter(i => !i.qaStatus).sort((a, b) => new Date(b.scoredAt).getTime() - new Date(a.scoredAt).getTime());
  const reviewedItems = filtered.filter(i => !!i.qaStatus).sort((a, b) => new Date(b.qaStatus!.reviewedAt).getTime() - new Date(a.qaStatus!.reviewedAt).getTime());
  const challengedCount = items.filter(i => i.flag?.status === 'pending').length;
  const uncertainCount  = items.filter(i => !!(i.uncertainParameters && i.uncertainParameters.length > 0) && !i.qaStatus).length;

  const renderItem = (item: PendingReviewItem) => {
    const isExpanded   = expandedId === item.chatId;
    const isReviewed   = !!item.qaStatus;
    const hasFlag      = !!item.flag && item.flag.status === 'pending';
    const hasUncertain = !!(item.uncertainParameters && item.uncertainParameters.length > 0);
    const flagId       = item.flag?.id;
    const thread       = flagId ? (threads[flagId] || []) : [];
    const txData       = transcripts[item.chatId];

    const failedParams = PARAM_ORDER.filter(p => item.scores?.[p] === 'No');
    const borderColor  = hasFlag ? 'border-blue-200' : hasUncertain && !isReviewed ? 'border-amber-200' : isReviewed ? 'border-gray-100' : 'border-orange-200';
    const canEdit      = userRole === 'quality' || userRole === 'admin';
    const edit         = inlineEdit[item.chatId];

    const prevChatKeywords = /previous (chat|conversation|text|ticket)|last (chat|conversation|time we (spoke|talked|spoke))|earlier (chat|ticket|conversation)|as (discussed|mentioned) (before|earlier|last time|previously)|as per (our last|previous)|continuing from (before|last|previous)|referring to (my|our|the) (earlier|previous|last)/i;
    const txText = txData?.timedMessages?.map((m: any) => m.content || '').join(' ') || txData?.rawTranscript || '';
    const hasPrevChatRef = txText ? prevChatKeywords.test(txText) : false;

    return (
      <div key={item.chatId} className={`bg-white rounded-2xl border shadow-sm overflow-hidden transition ${borderColor}`}>
        <div className="px-5 py-4 flex items-center gap-4 cursor-pointer hover:bg-gray-50/40 transition"
          onClick={() => expand(item.chatId, flagId)}>
          <IQSRing iqs={item.iqs} size={44} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold text-gray-800">{item.agentName || 'Unknown'}</span>
              <ChatLink chatId={item.chatId} className="text-xs" />
              {hasFlag      && <span className="text-[10px] font-bold bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full">Challenged</span>}
              {hasUncertain && <span className="text-[10px] font-bold bg-amber-50 text-amber-600 px-2 py-0.5 rounded-full">Needs Review</span>}
              {failedParams.length > 0 && <span className="text-[10px] font-bold bg-red-50 text-red-600 px-2 py-0.5 rounded-full">{failedParams.length} fail{failedParams.length > 1 ? 's' : ''}</span>}
              {isReviewed
                ? <span className="text-[10px] font-bold bg-emerald-50 text-emerald-600 px-2 py-0.5 rounded-full">Reviewed</span>
                : <span className="text-[10px] font-bold bg-orange-50 text-orange-600 px-2 py-0.5 rounded-full">Pending</span>}
            </div>
            <p className="text-xs text-gray-400 mt-0.5">
              {item.date || item.scoredAt?.slice(0, 10)}
              {isReviewed && item.qaStatus?.reviewedAt && ` · Reviewed by ${(item.qaStatus.reviewedBy || '').split('@')[0] || 'QA'} · ${new Date(item.qaStatus.reviewedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}`}
            </p>
          </div>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5"
            className={`shrink-0 transition-transform ${isExpanded ? 'rotate-180' : ''}`}><path d="M2 4l4 4 4-4"/></svg>
        </div>

        {isExpanded && (
          <div className="border-t border-gray-100 flex flex-col">
            {hasPrevChatRef && (
              <div className="flex items-start gap-2 bg-amber-50 border-b border-amber-200 px-4 py-2.5">
                <svg className="shrink-0 mt-0.5 text-amber-500" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm0 3a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 8 4zm0 7.5a.875.875 0 1 1 0-1.75.875.875 0 0 1 0 1.75z"/></svg>
                <p className="text-xs text-amber-800 flex-1"><span className="font-semibold">Previous conversation referenced</span> — this transcript refers to a prior chat. Scores may not reflect the full context. Review carefully and override if needed.</p>
              </div>
            )}
            <div className="flex divide-x divide-gray-100" style={{ maxHeight: 560, minHeight: 220 }}>
              <div className="w-[42%] shrink-0 overflow-y-auto flex flex-col">
                {item.scores && Object.keys(item.scores).length > 0 && (
                  <div className="p-4 space-y-1">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">Parameter Scores</p>
                    {PARAM_ORDER.map(p => {
                      const val    = canEdit ? (edit?.scores[p] ?? item.scores?.[p]) : (item.scores?.[p] as string | undefined);
                      const isFail = val === 'No';
                      const isUnc  = !!(item.uncertainParameters?.some(u => u.parameter === p));
                      return (
                        <div key={p} className={`rounded-xl px-3 py-2 ${isFail ? 'bg-red-50 border border-red-100' : isUnc ? 'bg-amber-50 border border-amber-100' : 'bg-gray-50'}`}>
                          <div className="flex items-center gap-2">
                            {canEdit ? (
                              <div className="flex gap-1 shrink-0">
                                {(['Yes', 'No', 'NA'] as const).map(v => (
                                  <button key={v}
                                    onClick={() => setInlineEdit(s => { const cur = s[item.chatId] ?? { scores: { ...(item.scores || {}) }, reasoning: { ...(item.reasoning || {}) }, note: '' }; return { ...s, [item.chatId]: { ...cur, scores: { ...cur.scores, [p]: v } } }; })}
                                    className={`px-2 py-0.5 text-[10px] font-bold rounded transition ${
                                      val === v
                                        ? v === 'Yes' ? 'bg-emerald-500 text-white' : v === 'No' ? 'bg-red-500 text-white' : 'bg-gray-400 text-white'
                                        : 'bg-white border border-gray-200 text-gray-400 hover:border-gray-400'
                                    }`}>{v}</button>
                                ))}
                              </div>
                            ) : (
                              <span className={`shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-md ${
                                val === 'Yes' ? 'bg-emerald-100 text-emerald-700'
                                : val === 'No' ? 'bg-red-100 text-red-700'
                                : isUnc ? 'bg-amber-100 text-amber-700'
                                : 'bg-gray-200 text-gray-500'
                              }`}>{isUnc && val === 'NA' ? '?' : (val || 'NA')}</span>
                            )}
                            <span className="text-xs font-medium text-gray-700 flex-1 leading-tight">{PARAM_NAMES[p]}</span>
                            <span className="text-[10px] text-gray-400 shrink-0">{Math.round(WEIGHTS[p] * 100)}%</span>
                          </div>
                          {canEdit ? (
                            <textarea
                              value={edit?.reasoning[p] || ''}
                              onChange={e => setInlineEdit(s => { const cur = s[item.chatId] ?? { scores: { ...(item.scores || {}) }, reasoning: { ...(item.reasoning || {}) }, note: '' }; return { ...s, [item.chatId]: { ...cur, reasoning: { ...cur.reasoning, [p]: e.target.value } } }; })}
                              placeholder="Reasoning…" rows={2}
                              className="mt-1.5 w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-[11px] focus:outline-none focus:ring-1 focus:ring-emerald-400/30 resize-none bg-white text-gray-800"
                            />
                          ) : (
                            <>
                              {isFail && item.reasoning?.[p] && <p className="text-[11px] text-red-700/80 mt-1.5 ml-7 leading-relaxed">{item.reasoning[p]}</p>}
                              {isUnc && <p className="text-[11px] text-amber-700/80 mt-1.5 ml-7 leading-relaxed">{item.uncertainParameters!.find(u => u.parameter === p)?.question}</p>}
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {item.flag && (
                  <div className="px-4 pb-3 space-y-2">
                    <p className="text-[10px] font-bold text-blue-400 uppercase tracking-widest mb-1.5">IR Challenge</p>
                    {item.flag.challengedParams && item.flag.challengedParams.length > 0 && (
                      <div className="space-y-1 mb-1">
                        {item.flag.challengedParams.map(cp => (
                          <div key={cp.param} className="bg-blue-50 rounded-xl px-3 py-2 border border-blue-100">
                            <span className="text-xs font-semibold text-gray-700">{PARAM_NAMES[cp.param] || cp.param}</span>
                            {cp.note && <p className="text-[11px] text-gray-500 mt-0.5 leading-relaxed">{cp.note}</p>}
                          </div>
                        ))}
                      </div>
                    )}
                    {item.flag.agentNote && (
                      <p className="text-xs text-gray-600 bg-blue-50 rounded-xl px-3 py-2 leading-relaxed">{item.flag.agentNote}</p>
                    )}
                    {threadLoading[flagId!] && <p className="text-xs text-gray-400">Loading…</p>}
                    {thread.length > 0 && (
                      <div className="space-y-2">
                        {thread.map(c => {
                          const isQa = ['quality','admin','tl'].includes(c.role);
                          return (
                            <div key={c.id} className={`flex gap-1.5 ${isQa ? 'flex-row-reverse' : ''}`}>
                              <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-0.5 text-[8px] font-bold ${isQa ? 'bg-emerald-200 text-emerald-700' : 'bg-gray-200 text-gray-600'}`}>{c.authorName.slice(0,1).toUpperCase()}</div>
                              <div className="max-w-[85%]">
                                <p className={`text-[9px] font-semibold mb-0.5 ${isQa ? 'text-right text-emerald-600' : 'text-gray-400'}`}>{c.authorName}</p>
                                <div className={`px-2.5 py-1.5 rounded-xl text-[11px] leading-relaxed ${isQa ? 'bg-emerald-500 text-white' : 'bg-gray-100 text-gray-800'}`}>{c.content}</div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {flagId && (
                      <div className="flex gap-1.5">
                        <input type="text" value={replyText[flagId] || ''}
                          onChange={e => setReplyText(r => ({ ...r, [flagId!]: e.target.value }))}
                          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendReply(flagId); } }}
                          placeholder="Reply to challenge…" className="flex-1 text-xs border border-gray-200 rounded-xl px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 bg-white text-gray-800" />
                        <button onClick={() => sendReply(flagId)} disabled={replySending[flagId] || !replyText[flagId]?.trim()}
                          className="px-2.5 py-1.5 bg-emerald-600 text-white text-xs font-bold rounded-xl hover:bg-emerald-700 disabled:opacity-40 transition">{replySending[flagId] ? '…' : 'Send'}</button>
                      </div>
                    )}
                  </div>
                )}

                <div className="mt-auto border-t border-gray-100 p-4 space-y-2">
                  {canReview && (
                    <input
                      type="text"
                      value={canEdit ? (inlineEdit[item.chatId]?.note || '') : (reviewNotes[item.chatId] || '')}
                      onChange={e => canEdit
                        ? setInlineEdit(s => { const cur = s[item.chatId] ?? { scores: { ...(item.scores || {}) }, reasoning: { ...(item.reasoning || {}) }, note: '' }; return { ...s, [item.chatId]: { ...cur, note: e.target.value } }; })
                        : setReviewNotes(r => ({ ...r, [item.chatId]: e.target.value }))}
                      placeholder="Review note (optional)…"
                      className="w-full text-xs border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400/30 bg-white text-gray-800"
                    />
                  )}
                  <div className="flex gap-2">
                    {canReview && !isReviewed && (
                      <button onClick={() => markReviewed(item.chatId)} disabled={reviewing[item.chatId]}
                        className="flex-1 px-3 py-2 bg-amber-500 text-white text-xs font-bold rounded-xl hover:bg-amber-600 disabled:opacity-40 transition">
                        {reviewing[item.chatId] ? '…' : 'Mark Reviewed'}
                      </button>
                    )}
                    {canEdit && (
                      <button onClick={() => saveOverride(item)} disabled={overrideSaving[item.chatId]}
                        className="flex-1 px-3 py-2 bg-emerald-600 text-white text-xs font-bold rounded-xl hover:bg-emerald-700 disabled:opacity-40 transition">
                        {overrideSaving[item.chatId] ? 'Saving…' : overrideSaved[item.chatId] ? 'Saved ✓' : 'Save Override'}
                      </button>
                    )}
                  </div>
                  {isReviewed && (
                    <p className="text-[10px] text-center text-emerald-600 font-semibold">
                      ✓ Reviewed by {(item.qaStatus?.reviewedBy || '').split('@')[0]}
                      {item.qaStatus?.reviewNote && ` · ${item.qaStatus.reviewNote}`}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Customer's Prior Chats</p>
                    {(histories[item.chatId]?.length ?? 0) > 0 && (
                      <button onClick={() => setShowHistory(s => ({ ...s, [item.chatId]: !s[item.chatId] }))}
                        className="text-[10px] font-semibold text-emerald-600 hover:underline flex items-center gap-1">
                        {showHistory[item.chatId] ? 'Hide' : `Show (${histories[item.chatId]!.length})`}
                        <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5"
                          className={`transition-transform ${showHistory[item.chatId] ? 'rotate-180' : ''}`}><path d="M2 4l4 4 4-4"/></svg>
                      </button>
                    )}
                    {historyLoading[item.chatId] && (
                      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="animate-spin text-gray-400"><path d="M8 2a6 6 0 1 0 6 6"/></svg>
                    )}
                  </div>
                  {showHistory[item.chatId] && (
                    <div className="space-y-1">
                      {(histories[item.chatId] || []).length === 0 && (
                        <p className="text-xs text-gray-400 text-center py-2">No prior chats found.</p>
                      )}
                      {(histories[item.chatId] || []).map((h: any) => {
                        const isPriorExpanded = expandedPriorChat[item.chatId] === h.chatId;
                        const ptx = priorTranscripts[h.chatId];
                        return (
                          <div key={h.chatId} className="rounded-xl border border-gray-100 overflow-hidden">
                            <button
                              onClick={() => togglePriorChat(item.chatId, h.chatId)}
                              className={`w-full flex items-center gap-3 px-3 py-2 text-left transition-colors ${isPriorExpanded ? 'bg-gray-50' : 'hover:bg-gray-50'}`}>
                              <IQSRing iqs={h.iqs} size={28} />
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  {h.chatId && /^\d+$/.test(h.chatId.trim()) ? (
                                    <a
                                      href={`https://app.robylon.ai/unified-inbox/share/${h.chatId}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      onClick={e => e.stopPropagation()}
                                      className="text-xs font-semibold text-emerald-600 hover:underline"
                                    >
                                      {h.chatId}
                                    </a>
                                  ) : (
                                    <span className="text-xs font-semibold text-gray-700">{h.chatId}</span>
                                  )}
                                  <span className="text-[10px] text-gray-500">{h.agentName}</span>
                                  {h.disposition && <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full">{h.disposition}</span>}
                                </div>
                                <p className="text-[10px] text-gray-400 mt-0.5">{h.date}</p>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                {h.csat === '5' && <span className="text-[10px] bg-emerald-50 text-emerald-600 font-bold px-1.5 py-0.5 rounded-full">Good</span>}
                                {h.csat === '3' && <span className="text-[10px] bg-yellow-50 text-yellow-600 font-bold px-1.5 py-0.5 rounded-full">CBB</span>}
                                {h.csat === '1' && <span className="text-[10px] bg-red-50 text-red-600 font-bold px-1.5 py-0.5 rounded-full">Bad</span>}
                                <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5"
                                  className={`text-gray-400 transition-transform ${isPriorExpanded ? 'rotate-180' : ''}`}><path d="M2 4l4 4 4-4"/></svg>
                              </div>
                            </button>
                            {isPriorExpanded && (
                              <div className="border-t border-gray-100 bg-gray-50/60 px-3 py-3 max-h-80 overflow-y-auto">
                                {priorTranscriptLoading[h.chatId] && (
                                  <div className="flex items-center gap-2 text-gray-400 text-xs justify-center py-4">
                                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="animate-spin"><path d="M8 2a6 6 0 1 0 6 6"/></svg>
                                    Loading transcript…
                                  </div>
                                )}
                                {ptx && ((ptx.timedMessages && ptx.timedMessages.length > 0) || (ptx.callRecordings && ptx.callRecordings.length > 0)) && (
                                  <TranscriptBubbles messages={ptx.timedMessages || []} callRecordings={ptx.callRecordings} />
                                )}
                                {ptx?.rawTranscript && !ptx.timedMessages?.length && (!ptx.callRecordings || !ptx.callRecordings.length) && (
                                  <pre className="text-[11px] text-gray-600 whitespace-pre-wrap leading-relaxed font-sans">{renderContentWithLinks(ptx.rawTranscript, false)}</pre>
                                )}
                                {ptx && !ptx.timedMessages?.length && !ptx.rawTranscript && (!ptx.callRecordings || !ptx.callRecordings.length) && !priorTranscriptLoading[h.chatId] && (
                                  <p className="text-xs text-gray-400 text-center py-3">No transcript saved for this chat.</p>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div>
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">Transcript</p>
                  {transcriptLoading[item.chatId] && (
                    <div className="flex items-center gap-2 text-gray-400 text-xs justify-center py-8">
                      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="animate-spin"><path d="M8 2a6 6 0 1 0 6 6"/></svg>
                      Loading…
                    </div>
                  )}
                  {txData && ((txData.timedMessages && txData.timedMessages.length > 0) || (txData.callRecordings && txData.callRecordings.length > 0)) && (
                    <TranscriptBubbles messages={txData.timedMessages || []} callRecordings={txData.callRecordings} />
                  )}
                  {txData && txData.rawTranscript && !txData.timedMessages?.length && (!txData.callRecordings || !txData.callRecordings.length) && (
                    <pre className="text-[11px] text-gray-600 bg-gray-50 rounded-xl px-3 py-2 whitespace-pre-wrap leading-relaxed font-sans">{renderContentWithLinks(txData.rawTranscript, false)}</pre>
                  )}
                  {txData && !txData.timedMessages?.length && !txData.rawTranscript && (!txData.callRecordings || !txData.callRecordings.length) && !transcriptLoading[item.chatId] && (
                    <p className="text-xs text-gray-400 text-center py-6">No transcript saved for this chat.</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  const displayItems = section === 'pending' ? pendingItems : reviewedItems;

  const activeFilterCount = [
    pendingFilters.dateRange !== '1w',
    pendingFilters.minScore > 0,
    pendingFilters.maxScore < 100,
    !!pendingFilters.disposition,
    !!pendingFilters.subDisposition,
  ].filter(Boolean).length;

  const subDispositionOptions = pendingFilters.disposition
    ? (dispositionSubMap[pendingFilters.disposition] || [])
    : Object.values(dispositionSubMap).flat().filter((v, i, a) => a.indexOf(v) === i).sort();

  return (
    <div className="space-y-5 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex-1 min-w-[160px]">
          <h2 className="text-sm font-bold text-gray-900">Chats Pending Review</h2>
          <p className="text-xs text-gray-400 mt-0.5">IQS &lt; 80% or needs bot review — scoped to your agents</p>
        </div>
        <div className="flex items-center bg-gray-100 rounded-xl p-1 gap-0.5">
          <button onClick={() => setFilter('all')}
            className={`text-xs px-3 py-1.5 rounded-lg font-semibold transition ${filter === 'all' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            All
          </button>
          <button onClick={() => setFilter('uncertain')}
            className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-semibold transition ${filter === 'uncertain' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            Needs Review
            {uncertainCount > 0 && <span className="bg-amber-100 text-amber-600 text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none">{uncertainCount}</span>}
          </button>
          <button onClick={() => setFilter('challenged')}
            className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-semibold transition ${filter === 'challenged' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            Challenged
            {challengedCount > 0 && <span className="bg-blue-100 text-blue-600 text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none">{challengedCount}</span>}
          </button>
        </div>
        <div className="flex items-center bg-gray-100 rounded-xl p-1 gap-0.5">
          <button onClick={() => switchSection('pending')}
            className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-semibold transition ${section === 'pending' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            Pending
            {pendingItems.length > 0 && <span className="bg-amber-100 text-amber-700 text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none">{pendingItems.length}</span>}
          </button>
          <button onClick={() => switchSection('reviewed')}
            className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-semibold transition ${section === 'reviewed' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            Reviewed
            {reviewedItems.length > 0 && <span className="bg-gray-200 text-gray-600 text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none">{reviewedItems.length}</span>}
          </button>
        </div>
        <input type="text" value={chatIdSearch} onChange={e => setChatIdSearch(e.target.value)}
          placeholder="Filter by Chat ID…"
          className="text-xs border border-gray-200 rounded-xl px-3 py-1.5 w-40 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 bg-white text-gray-800" />
        <button
          onClick={() => setShowFilterPanel(v => !v)}
          className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl font-semibold border transition ${
            showFilterPanel ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
          }`}>
          Filters
          {activeFilterCount > 0 && (
            <span className={`inline-flex items-center justify-center w-4 h-4 rounded-full text-[10px] font-bold ${showFilterPanel ? 'bg-white text-emerald-700' : 'bg-emerald-600 text-white'}`}>
              {activeFilterCount}
            </span>
          )}
        </button>
      </div>

      {showFilterPanel && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-5">
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

          <div>
            <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">IQS Range</p>
            <div className="flex items-center gap-2">
              <input type="number" min={0} max={100} value={pendingFilters.minScore}
                onChange={e => setPendingFilters(f => ({ ...f, minScore: parseInt(e.target.value) || 0 }))}
                className="w-14 text-xs border border-gray-200 rounded-xl px-2 py-1.5 text-center focus:outline-none focus:ring-2 focus:ring-emerald-500/30 bg-white text-gray-800" />
              <span className="text-gray-400 text-xs">–</span>
              <input type="number" min={0} max={100} value={pendingFilters.maxScore}
                onChange={e => setPendingFilters(f => ({ ...f, maxScore: parseInt(e.target.value) || 100 }))}
                className="w-14 text-xs border border-gray-200 rounded-xl px-2 py-1.5 text-center focus:outline-none focus:ring-2 focus:ring-emerald-500/30 bg-white text-gray-800" />
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-4">
            <div>
              <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Agent</p>
              <select value={pendingFilters.agent}
                onChange={e => setPendingFilters(f => ({ ...f, agent: e.target.value }))}
                className="text-xs border border-gray-200 rounded-xl px-3 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 min-w-[180px]">
                <option value="">All agents</option>
                {availableAgents.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
          </div>

          {assignedDispositions && (
            <p className="text-[11px] text-emerald-700 font-medium">
              Default view: {assignedDispositions.join(', ')} — select a different disposition below to override
            </p>
          )}
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Disposition</p>
              <select value={pendingFilters.disposition}
                onChange={e => setPendingFilters(f => ({ ...f, disposition: e.target.value, subDisposition: '' }))}
                className="text-xs border border-gray-200 rounded-xl px-3 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 min-w-[180px]">
                <option value="">All</option>
                {availableDispositions.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div>
              <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Sub-Disposition</p>
              <select value={pendingFilters.subDisposition}
                onChange={e => setPendingFilters(f => ({ ...f, subDisposition: e.target.value }))}
                className="text-xs border border-gray-200 rounded-xl px-3 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 min-w-[180px]">
                <option value="">All</option>
                {subDispositionOptions.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
          </div>

          <div className="flex items-center gap-3 pt-1 border-t border-gray-100">
            <button onClick={() => { fetchPending(pendingFilters); setShowFilterPanel(false); }} disabled={loading}
              className="px-5 py-1.5 bg-emerald-600 text-white text-xs font-bold rounded-xl hover:bg-emerald-700 disabled:opacity-40 transition">
              {loading ? 'Loading…' : 'Apply Filters'}
            </button>
            <button
              onClick={() => {
                setPendingFilters(PENDING_DEFAULT_FILTERS);
                fetchPending(PENDING_DEFAULT_FILTERS);
                setShowFilterPanel(false);
              }}
              className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700 font-medium transition">
              Reset all
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-48 text-gray-400 gap-2 text-sm">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="animate-spin"><path d="M8 2a6 6 0 1 0 6 6"/></svg>
          Loading…
        </div>
      ) : displayItems.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-6 py-14 text-center">
          <p className="text-2xl mb-2">{section === 'pending' ? '✓' : '📋'}</p>
          <p className="text-sm font-semibold text-gray-700">{section === 'pending' ? 'All caught up' : 'No reviewed chats yet'}</p>
          <p className="text-xs text-gray-400 mt-1">{section === 'pending' ? 'No chats pending review for your agents.' : 'Mark some chats as reviewed to see them here.'}</p>
        </div>
      ) : (
        <div className="space-y-3">{displayItems.map(renderItem)}</div>
      )}
    </div>
  );
}
