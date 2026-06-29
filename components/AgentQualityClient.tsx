'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import Link from 'next/link';
import { PARAM_ORDER, PARAM_NAMES, WEIGHTS } from '@/lib/quality';
import type { IQSScoreEntry } from '@/lib/quality';
import CallQualityClient from '@/components/CallQualityClient';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDuration(secs: number | undefined | null): string {
  if (secs == null || secs < 0) return '—';
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60), s = secs % 60;
  if (secs < 3600) return s > 0 ? `${m}m ${s}s` : `${m}m`;
  const h = Math.floor(secs / 3600), rm = Math.floor((secs % 3600) / 60);
  return rm > 0 ? `${h}h ${rm}m` : `${h}h`;
}

function iqsTheme(iqs: number) {
  if (iqs >= 90) return { text: '#15803d', bg: '#dcfce7', bar: '#22c55e', label: 'Excellent' };
  if (iqs >= 80) return { text: '#92400e', bg: '#fef3c7', bar: '#f59e0b', label: 'Good' };
  if (iqs >= 70) return { text: '#c2410c', bg: '#ffedd5', bar: '#f97316', label: 'Average' };
  return { text: '#b91c1c', bg: '#fee2e2', bar: '#ef4444', label: 'Needs Work' };
}

function csatLabel(c?: string) {
  if (c === '5') return { label: 'Good',  cls: 'bg-emerald-50 text-emerald-700' };
  if (c === '3') return { label: 'CBB',   cls: 'bg-amber-50 text-amber-700' };
  if (c === '1') return { label: 'Bad',   cls: 'bg-red-50 text-red-600' };
  return null;
}

function TypeBadge({ type }: { type?: string }) {
  if (type === 'bot')    return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-violet-100 text-violet-700">Bot</span>;
  if (type === 'hybrid') return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-700">Hybrid</span>;
  return                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-700">Human</span>;
}

// ── IQS Ring ──────────────────────────────────────────────────────────────────
function IQSRing({ iqs, size = 52 }: { iqs: number; size?: number }) {
  const t = iqsTheme(iqs);
  const r = (size - 6) / 2;
  const circ = 2 * Math.PI * r;
  const dash = (iqs / 100) * circ;
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#f1f5f9" strokeWidth={5} />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={t.bar} strokeWidth={5}
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round" />
      </svg>
      <span className="absolute text-xs font-bold tabular-nums" style={{ color: t.text }}>{iqs}</span>
    </div>
  );
}

function IQSPill({ iqs }: { iqs: number }) {
  const t = iqsTheme(iqs);
  return (
    <span className="inline-block px-2 py-0.5 rounded-full text-xs font-bold tabular-nums"
      style={{ background: t.bg, color: t.text }}>{iqs}%</span>
  );
}

function ParamBadge({ val }: { val: string | undefined }) {
  if (val === 'Yes') return <span className="text-emerald-500 font-bold text-sm">✓</span>;
  if (val === 'No')  return <span className="text-red-500 font-bold text-sm">✗</span>;
  return <span className="text-gray-300 text-sm">—</span>;
}

// ── Transcript bubbles ────────────────────────────────────────────────────────
const BOT_NAMES = new Set(['myra', 'bot', 'wint bot', 'wintbot']);
const CUSTOMER_LABELS = new Set(['user', 'customer', 'visitor']);

function renderContentWithLinks(text: string, isOutgoing?: boolean) {
  if (!text) return '';
  const urlRegex = /(https?:\/\/[^\s\]\)\>]+)/gi;
  const parts = text.split(urlRegex);
  if (parts.length === 1) return text;

  const linkClass = isOutgoing
    ? "underline text-white font-medium hover:opacity-90 break-all"
    : "underline text-blue-600 font-medium hover:text-blue-800 break-all";

  return parts.map((part, index) => {
    if (urlRegex.test(part)) {
      return (
        <a
          key={index}
          href={part}
          target="_blank"
          rel="noopener noreferrer"
          className={linkClass}
        >
          Link
        </a>
      );
    }
    return part;
  });
}

function TranscriptBubbles({ messages }: { messages: Array<{ sender: string; content: string; timestamp?: string }> }) {
  return (
    <div className="space-y-2 py-1">
      {messages.map((m, i) => {
        const lc = (m.sender || '').toLowerCase().trim();
        const isCustomer = CUSTOMER_LABELS.has(lc);
        const isBot = BOT_NAMES.has(lc);
        const isActivity = lc === 'activity' || lc === 'system';
        const time = m.timestamp
          ? new Date(m.timestamp).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
          : '';
        if (isActivity) return (
          <div key={i} className="flex justify-center my-2">
            <span className="text-[11px] text-gray-400 bg-gray-100 rounded-full px-3 py-1 font-sans italic border border-gray-200">
              {m.content}{time && `  •  ${time}`}
            </span>
          </div>
        );
        if (isCustomer) return (
          <div key={i} className="flex gap-2">
            <div className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center shrink-0 mt-1">
              <span className="text-[9px] font-bold text-gray-500">U</span>
            </div>
            <div className="max-w-[78%]">
              <p className="text-[9px] font-semibold text-gray-400 mb-0.5">{m.sender}{time && ` · ${time}`}</p>
              <div className="bg-gray-100 text-gray-800 px-3.5 py-2 rounded-2xl rounded-tl-sm text-xs leading-relaxed font-sans">{renderContentWithLinks(m.content, false)}</div>
            </div>
          </div>
        );
        if (isBot) return (
          <div key={i} className="flex justify-end gap-2">
            <div className="max-w-[78%]">
              <p className="text-[9px] font-semibold text-violet-400 text-right mb-0.5 pr-1">{m.sender}{time && ` · ${time}`}</p>
              <div className="bg-violet-500 text-white px-3.5 py-2 rounded-2xl rounded-tr-sm text-xs leading-relaxed font-sans">{renderContentWithLinks(m.content, true)}</div>
            </div>
          </div>
        );
        return (
          <div key={i} className="flex justify-end gap-2">
            <div className="max-w-[78%]">
              <p className="text-[9px] font-semibold text-emerald-600 text-right mb-0.5 pr-1">{m.sender}{time && ` · ${time}`}</p>
              <div className="bg-emerald-500 text-white px-3.5 py-2 rounded-2xl rounded-tr-sm text-xs leading-relaxed font-sans">{renderContentWithLinks(m.content, true)}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Challenge modal ───────────────────────────────────────────────────────────
function ChallengeModal({ entry, onClose, onDone }: { entry: IQSScoreEntry; onClose: () => void; onDone: () => void }) {
  const failedParams = PARAM_ORDER.filter(p => entry.scores[p] === 'No');
  const [selectedParams, setSelectedParams] = useState<Set<string>>(new Set(failedParams));
  const [paramNotes, setParamNotes] = useState<Record<string, string>>({});
  const [generalNote, setGeneralNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const toggleParam = (p: string) => setSelectedParams(prev => {
    const next = new Set(prev);
    next.has(p) ? next.delete(p) : next.add(p);
    return next;
  });

  async function submit() {
    if (selectedParams.size === 0 && !generalNote.trim()) {
      setErr('Select at least one parameter to challenge, or add a general note.');
      return;
    }
    const missingNotes = [...selectedParams].filter(p => !(paramNotes[p] ?? '').trim());
    if (missingNotes.length > 0) {
      setErr('Add a note for each challenged parameter.');
      return;
    }
    setBusy(true); setErr('');
    try {
      const challengedParams = [...selectedParams].map(p => ({
        param: p,
        note: (paramNotes[p] || '').trim(),
      }));
      const res = await fetch('/api/quality/flag', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scoreId: entry.id, chatId: entry.chatId,
          agentNote: generalNote.trim(),
          challengedParams,
          raisedByRole: 'ir',
        }),
      });
      const d = await res.json();
      if (d.error) { setErr(d.error); return; }
      onDone();
    } catch { setErr('Request failed.'); }
    finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-[70] flex items-center justify-center px-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 z-[71] max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <h3 className="text-sm font-bold text-gray-900 mb-1">Challenge this IQS score</h3>
        <p className="text-xs text-gray-500 mb-4">Chat #{entry.chatId} · IQS {entry.iqs}% — select the parameters you think are wrong</p>

        {failedParams.length > 0 ? (
          <div className="space-y-2 mb-4">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Failed Parameters</p>
            {failedParams.map(p => (
              <div key={p} className={`rounded-xl border transition ${selectedParams.has(p) ? 'border-amber-300 bg-amber-50' : 'border-gray-200 bg-gray-50'}`}>
                <label className="flex items-center gap-3 px-3.5 py-2.5 cursor-pointer">
                  <input type="checkbox" checked={selectedParams.has(p)} onChange={() => toggleParam(p)}
                    className="w-3.5 h-3.5 rounded accent-amber-500" />
                  <span className="text-xs font-semibold text-gray-700 flex-1">{PARAM_NAMES[p]}</span>
                  <span className="text-[10px] text-red-500 font-bold">Fail</span>
                </label>
                {selectedParams.has(p) && (
                  <div className="px-3.5 pb-2.5">
                    <input
                      type="text"
                      value={paramNotes[p] || ''}
                      onChange={e => setParamNotes(prev => ({ ...prev, [p]: e.target.value }))}
                      placeholder={`Required: why should ${PARAM_NAMES[p]} be Yes?`}
                      className="w-full text-xs border border-amber-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-amber-400/30"
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-3.5 py-2.5 mb-4">
            <p className="text-xs text-emerald-700 font-semibold">No failed parameters — all scored Yes.</p>
            <p className="text-[11px] text-emerald-600 mt-0.5">Use the general note below if you disagree with the overall score.</p>
          </div>
        )}

        <div className="mb-4">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">General Note (optional)</p>
          <textarea value={generalNote} onChange={e => setGeneralNote(e.target.value)} rows={3}
            placeholder="Any additional context for the Quality team…"
            className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-xs text-gray-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 resize-none" />
        </div>

        {err && <p className="text-xs text-red-500 mb-3">{err}</p>}
        <div className="flex gap-2">
          <button onClick={submit} disabled={busy}
            className="flex-1 py-2.5 bg-emerald-600 text-white text-sm font-bold rounded-xl disabled:opacity-50 hover:bg-emerald-700 transition">
            {busy ? 'Sending…' : `Send to Quality Team${selectedParams.size > 0 ? ` (${selectedParams.size} param${selectedParams.size > 1 ? 's' : ''})` : ''}`}
          </button>
          <button onClick={onClose}
            className="px-4 py-2.5 border border-gray-200 text-gray-500 rounded-xl text-sm hover:bg-gray-50 transition">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Score Detail Modal ────────────────────────────────────────────────────────
function ScoreDetailModal({ entry, flagged, onClose }: { entry: IQSScoreEntry; flagged: boolean; onClose: () => void }) {
  const [activeTab, setActiveTab] = useState<'scores' | 'transcript'>('scores');
  const [transcript, setTranscript] = useState<{ timedMessages?: any[]; rawTranscript?: string } | null>(null);
  const [txLoading, setTxLoading] = useState(false);
  const [txError, setTxError] = useState('');
  const [showChallenge, setShowChallenge] = useState(false);
  const [challenged, setChallenged] = useState(flagged);

  useEffect(() => {
    if (activeTab !== 'transcript') return;
    if (transcript !== null) return;
    setTxLoading(true); setTxError('');
    fetch(`/api/quality/transcript?chatId=${encodeURIComponent(entry.chatId)}`)
      .then(r => r.json())
      .then(d => { if (d.found) setTranscript({ timedMessages: d.timedMessages, rawTranscript: d.rawTranscript }); else setTranscript({}); })
      .catch(() => setTxError('Failed to load transcript'))
      .finally(() => setTxLoading(false));
  }, [activeTab, entry.chatId, transcript]);

  const fails = PARAM_ORDER.filter(p => entry.scores[p] === 'No');
  const t = iqsTheme(entry.iqs);
  const cs = csatLabel(entry.csat);
  const chatUrl = /^\d+$/.test(entry.chatId.trim())
    ? `https://app.robylon.ai/unified-inbox/share/${entry.chatId}` : null;

  return (
    <>
      <div className="fixed inset-0 bg-black/70 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
        <div className="bg-white w-full sm:rounded-2xl sm:max-w-3xl max-h-[94vh] flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>

          {/* Header */}
          <div className="shrink-0 bg-white border-b border-gray-100 px-6 py-4 flex items-center gap-4 rounded-t-2xl">
            <IQSRing iqs={entry.iqs} size={52} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                {chatUrl
                  ? <a href={chatUrl} target="_blank" rel="noopener noreferrer"
                      className="font-mono text-sm text-emerald-600 hover:underline flex items-center gap-1">
                      #{entry.chatId}
                      <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M5 2H2a1 1 0 00-1 1v7a1 1 0 001 1h7a1 1 0 001-1V8M8 1h3m0 0v3m0-3L5 7"/></svg>
                    </a>
                  : <span className="font-mono text-sm text-gray-600">#{entry.chatId}</span>
                }
                {fails.length === 0
                  ? <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">Clean</span>
                  : <span className="text-[10px] font-bold text-red-600 bg-red-50 px-2 py-0.5 rounded-full">{fails.length} fail{fails.length > 1 ? 's' : ''}</span>}
                {challenged && <span className="text-[10px] font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">⚑ Challenged</span>}
              </div>
              <p className="text-xs text-gray-400 mt-0.5 flex items-center gap-2 flex-wrap">
                <span>{entry.scoredAt?.slice(0, 10)}</span>
                {cs && <><span>·</span><span className={`font-semibold text-xs px-1.5 py-0.5 rounded-full ${cs.cls}`}>{cs.label}</span></>}
                {entry.disposition && <><span>·</span><span className="text-gray-500">{entry.disposition}</span></>}
                {entry.frt != null && <><span>·</span><span>FRT {fmtDuration(entry.frt)}</span></>}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {!challenged ? (
                <button onClick={() => setShowChallenge(true)}
                  className="px-3 py-1.5 text-xs font-semibold rounded-xl border border-gray-200 text-gray-600 hover:border-gray-400 transition">
                  Challenge
                </button>
              ) : (
                <span className="text-xs text-amber-600 font-semibold bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-xl">
                  Sent to Quality
                </span>
              )}
              <button onClick={onClose} className="p-2 rounded-xl hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 2l12 12M14 2L2 14"/></svg>
              </button>
            </div>
          </div>

          {/* Tab bar */}
          <div className="shrink-0 flex border-b border-gray-100 px-6">
            {(['scores', 'transcript'] as const).map(tab => (
              <button key={tab} onClick={() => setActiveTab(tab)}
                className={`px-4 py-2.5 text-xs font-semibold border-b-2 transition -mb-px ${activeTab === tab ? 'border-emerald-500 text-emerald-600' : 'border-transparent text-gray-400 hover:text-gray-600'}`}>
                {tab === 'scores' ? 'IQS Scores' : 'Transcript'}
              </button>
            ))}
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto">
            {activeTab === 'scores' && (
              <div className="px-6 py-5 grid md:grid-cols-2 gap-6">
                <div>
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">Parameter Scores</p>
                  <div className="space-y-2">
                    {PARAM_ORDER.map(p => {
                      const val = entry.scores[p];
                      return (
                        <div key={p} className={`rounded-xl p-3 ${val === 'No' ? 'bg-red-50 border border-red-100' : 'bg-gray-50'}`}>
                          <div className="flex items-center gap-2">
                            <ParamBadge val={val} />
                            <span className="text-xs font-semibold text-gray-700 flex-1">{PARAM_NAMES[p]}</span>
                            <span className="text-[10px] text-gray-400">{Math.round(WEIGHTS[p] * 100)}%</span>
                          </div>
                          {entry.reasoning[p] && (
                            <p className="text-[11px] text-gray-500 leading-relaxed mt-1.5 ml-5">{entry.reasoning[p]}</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div className="space-y-4">
                  {entry.summary && (
                    <div>
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">AI Summary</p>
                      <p className="text-sm text-gray-700 bg-gray-50 rounded-xl px-4 py-3 leading-relaxed">{entry.summary}</p>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { label: 'FRT', val: fmtDuration(entry.frt) },
                      { label: 'Resolution', val: fmtDuration(entry.resolutionTime) },
                      { label: 'Type', val: entry.conversationType || '—' },
                      { label: 'IQS', val: `${entry.iqs}%` },
                    ].map(k => (
                      <div key={k.label} className="bg-gray-50 rounded-xl px-3 py-2.5 text-center">
                        <p className="text-lg font-bold text-gray-800">{k.val}</p>
                        <p className="text-[10px] text-gray-400 uppercase tracking-wide mt-0.5">{k.label}</p>
                      </div>
                    ))}
                  </div>
                  {!challenged && (
                    <div className="pt-2">
                      <button onClick={() => setShowChallenge(true)}
                        className="w-full py-2.5 border border-gray-200 text-gray-600 text-sm font-semibold rounded-xl hover:border-gray-400 transition">
                        ⚑ Challenge this score
                      </button>
                      <p className="text-[10px] text-gray-400 mt-1.5 text-center">
                        If the AI scoring seems wrong, send it to the Quality team
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'transcript' && (
              <div className="px-6 py-5">
                {txLoading && (
                  <div className="flex items-center justify-center py-12 text-gray-400 gap-2 text-sm">
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="animate-spin"><path d="M8 2a6 6 0 1 0 6 6"/></svg>
                    Loading transcript…
                  </div>
                )}
                {txError && <p className="text-sm text-red-500 text-center py-8">{txError}</p>}
                {!txLoading && !txError && transcript !== null && (
                  transcript?.timedMessages && transcript.timedMessages.length > 0 ? (
                    <>
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-4">{transcript.timedMessages.length} messages</p>
                      <TranscriptBubbles messages={transcript.timedMessages} />
                    </>
                  ) : transcript?.rawTranscript ? (
                    <>
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">Raw Transcript</p>
                      <pre className="text-xs text-gray-600 bg-gray-50 rounded-xl px-4 py-3 whitespace-pre-wrap leading-relaxed font-sans">{renderContentWithLinks(transcript.rawTranscript, false)}</pre>
                    </>
                  ) : (
                    <div className="text-center py-12">
                      <p className="text-sm text-gray-400">No transcript saved for this chat.</p>
                    </div>
                  )
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {showChallenge && (
        <ChallengeModal
          entry={entry}
          onClose={() => setShowChallenge(false)}
          onDone={() => { setChallenged(true); setShowChallenge(false); }}
        />
      )}
    </>
  );
}

// ── Nav Item ──────────────────────────────────────────────────────────────────
function NavItem({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
        active ? 'bg-emerald-600 text-white shadow-sm shadow-emerald-600/30' : 'text-slate-400 hover:text-white hover:bg-white/8'
      }`}>
      <span className="shrink-0">{icon}</span>
      <span className="flex-1 text-left">{label}</span>
    </button>
  );
}

// ── Interfaces ────────────────────────────────────────────────────────────────
interface TeamAvg {
  avgIqs: number | null;
  avgFrt: number | null;
  avgResolution: number | null;
  avgCsat: number | null;
  top3ParamRates: Record<string, number | null>;
  top3Count: number;
}

interface WeeklyRow { key: string; label: string; total: number; params: Record<string, number>; }

interface SummaryMetrics {
  totalConvos: number; botConvos: number; agentConvos: number;
  overallCsat: number | null; good: number; cbbBad: number;
  avgFrt: number | null; avgResolution: number | null;
  avgIqs: number | null; iqsSampleSize: number;
}

interface LogFilters {
  minScore: number; maxScore: number; csat: string; type: string;
  dateRange: 'today' | '7d' | '30d' | 'all'; dateFrom: string; dateTo: string;
  flaggedOnly: boolean; disposition: string; subDisposition: string;
}

const DEFAULT_FILTERS: LogFilters = {
  minScore: 0, maxScore: 100, csat: '', type: '',
  dateRange: '30d', dateFrom: '', dateTo: '', flaggedOnly: false,
  disposition: '', subDisposition: '',
};

function buildParams(page: number, f: LogFilters) {
  const p = new URLSearchParams();
  p.set('page', String(page));
  if (f.minScore > 0)  p.set('minScore', String(f.minScore));
  if (f.maxScore < 100) p.set('maxScore', String(f.maxScore));
  if (f.csat)  p.set('csat', f.csat);
  if (f.type)  p.set('type', f.type);
  if (f.disposition) p.set('tag', f.disposition);
  if (f.subDisposition) p.set('subTag', f.subDisposition);
  if (f.dateRange === 'today') p.set('dateFrom', new Date().toISOString().slice(0, 10));
  else if (f.dateRange === '7d')  p.set('dateFrom', new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10));
  else if (f.dateRange === '30d') p.set('dateFrom', new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
  else if (f.dateRange === 'all') {}
  return p;
}

// ── Main component ─────────────────────────────────────────────────────────────
interface Props { userEmail: string; selfAgentName?: string; }

export default function AgentQualityClient({ userEmail, selfAgentName }: Props) {
  const [tab, setTab] = useState<'performance' | 'log' | 'calls'>('performance');

  // Performance state
  const [perfPeriod, setPerfPeriod] = useState<'today'|'7d'|'30d'|'all'>('30d');
  const [perfEntries, setPerfEntries] = useState<IQSScoreEntry[]>([]);
  const [summary, setSummary] = useState<SummaryMetrics | null>(null);
  const [weeklyParamData, setWeeklyParamData] = useState<WeeklyRow[]>([]);
  const [teamAvg, setTeamAvg] = useState<TeamAvg | null>(null);
  const [perfLoading, setPerfLoading] = useState(true);
  const [showAllWeeks, setShowAllWeeks] = useState(false);
  const [showAllDispositions, setShowAllDispositions] = useState(false);
  const perfAbortRef = useRef<AbortController | null>(null);
  const [availableDispositions, setAvailableDispositions] = useState<string[]>([]);
  const [availableSubDispositions, setAvailableSubDispositions] = useState<string[]>([]);

  // Score Log state
  const [entries, setEntries] = useState<IQSScoreEntry[]>([]);
  const [logLoading, setLogLoading] = useState(false);
  const [logError, setLogError] = useState<string | null>(null);
  const [logLoaded, setLogLoaded] = useState(false);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(0);
  const [pendingFilters, setPendingFilters] = useState<LogFilters>(DEFAULT_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState<LogFilters>(DEFAULT_FILTERS);
  const logAbortRef = useRef<AbortController | null>(null);

  // Flags
  const [flags, setFlags] = useState<Record<string, boolean>>({});  // chatId → challenged

  // Sort state for score log
  const [sortCol, setSortCol] = useState<'iqs' | 'date' | 'csat' | 'frt' | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  // Detail modal
  const [detailEntry, setDetailEntry] = useState<IQSScoreEntry | null>(null);

  // Toast
  const [toast, setToast] = useState<string | null>(null);
  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3000); };

  // ── Fetch performance data ────────────────────────────────────────────────
  const loadPerf = useCallback(async (period: 'today'|'7d'|'30d'|'all') => {
    perfAbortRef.current?.abort();
    const ctrl = new AbortController();
    perfAbortRef.current = ctrl;
    setPerfLoading(true);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const from = period === 'today' ? today
        : period === '7d'  ? new Date(Date.now() - 6*86400000).toISOString().slice(0, 10)
        : period === '30d' ? new Date(Date.now() - 29*86400000).toISOString().slice(0, 10) : '';
      const params = new URLSearchParams({ page: '0' });
      if (from) { params.set('dateFrom', from); params.set('dateTo', today); }
      const [scoresRes, teamRes, flagsRes] = await Promise.all([
        fetch(`/api/quality/scores?${params}`, { signal: ctrl.signal }),
        fetch('/api/quality/team-avg', { signal: ctrl.signal }),
        fetch('/api/quality/flag', { signal: ctrl.signal }),
      ]);
      if (ctrl.signal.aborted) return;
      const [scoresData, teamData, flagsData] = await Promise.all([
        scoresRes.json(), teamRes.json(), flagsRes.json(),
      ]);
      if (ctrl.signal.aborted) return;
      // Performance tab uses all entries (up to 2000) for stats
      setPerfEntries(scoresData.entries || []);
      if (scoresData.summary) setSummary(scoresData.summary);
      setWeeklyParamData(scoresData.weeklyParamData || []);
      setTeamAvg(teamData);
      // Build flag map: chatId → true
      if (Array.isArray(flagsData.flags)) {
        const m: Record<string, boolean> = {};
        for (const f of flagsData.flags) if (f.chatId) m[f.chatId] = true;
        setFlags(m);
      }
      if (Array.isArray(scoresData.availableDispositions)) setAvailableDispositions(scoresData.availableDispositions);
      if (Array.isArray(scoresData.availableSubDispositions)) setAvailableSubDispositions(scoresData.availableSubDispositions);
    } catch {}
    setPerfLoading(false);
  }, []);

  // ── Fetch score log ───────────────────────────────────────────────────────
  const loadLog = useCallback(async (pg: number, f: LogFilters) => {
    logAbortRef.current?.abort();
    const ctrl = new AbortController();
    logAbortRef.current = ctrl;
    setLogLoading(true); setLogError(null);
    try {
      const params = buildParams(pg, f);
      params.set('skipStats', '1');
      const res = await fetch(`/api/quality/scores?${params}`, { signal: ctrl.signal });
      if (ctrl.signal.aborted) return;
      let data: any;
      try { data = await res.json(); } catch {
        if (!ctrl.signal.aborted) setLogError(`Server error ${res.status}`);
        setLogLoading(false); return;
      }
      if (ctrl.signal.aborted) return;
      if (!res.ok) { setLogError(`${data?.error || res.statusText}`); setLogLoading(false); return; }
      setEntries(data.entries || []);
      setTotal(data.total ?? 0);
      setHasMore(data.hasMore ?? false);
      setLogLoaded(true);
      if (Array.isArray(data.availableDispositions)) setAvailableDispositions(data.availableDispositions);
      if (Array.isArray(data.availableSubDispositions)) setAvailableSubDispositions(data.availableSubDispositions);
    } catch (e: any) {
      if (!ctrl.signal.aborted) setLogError(e?.message || 'Failed to load');
    }
    setLogLoading(false);
  }, []);

  // Apply log filters
  const applyFilters = () => {
    setAppliedFilters(pendingFilters);
    setPage(0);
    loadLog(0, pendingFilters);
  };

  useEffect(() => { loadPerf('30d'); }, [loadPerf]);

  const switchTab = (t: typeof tab) => {
    setTab(t);
    if (t === 'log' && !logLoaded) loadLog(0, appliedFilters);
  };

  // ── Perf derived metrics ──────────────────────────────────────────────────
  const scored = perfEntries.filter(e => e.iqs != null);
  const avgIqs = scored.length ? Math.round(scored.reduce((s, e) => s + e.iqs, 0) / scored.length) : null;
  const t = avgIqs != null ? iqsTheme(avgIqs) : null;

  const myParamRates: Record<string, number | null> = {};
  for (const p of PARAM_ORDER) {
    const rel = scored.filter(e => e.scores?.[p] != null && e.scores[p] !== 'NA');
    const yes = rel.filter(e => e.scores[p] === 'Yes').length;
    myParamRates[p] = rel.length ? Math.round((yes / rel.length) * 100) : null;
  }

  const top3Rates = teamAvg?.top3ParamRates ?? {};

  // Sort params: worst first
  const paramsSorted = useMemo(() => [...PARAM_ORDER].sort((a, b) => {
    const ra = myParamRates[a] ?? 101, rb = myParamRates[b] ?? 101;
    return ra - rb;
  }), [JSON.stringify(myParamRates)]);

  const worstParams = useMemo(() => paramsSorted
    .filter(p => myParamRates[p] != null && myParamRates[p]! < 100)
    .slice(0, 4), [paramsSorted]);

  const gaps = useMemo(() => PARAM_ORDER
    .filter(p => myParamRates[p] != null && top3Rates[p] != null && (top3Rates[p]! - myParamRates[p]!) >= 10)
    .sort((a, b) => (top3Rates[b]! - myParamRates[b]!) - (top3Rates[a]! - myParamRates[a]!))
    .slice(0, 3), [JSON.stringify(myParamRates), JSON.stringify(top3Rates)]);

  const dispositionStats = useMemo(() => {
    const map: Record<string, { count: number; iqsSum: number; csatGood: number; csatTotal: number }> = {};
    for (const e of scored) {
      const d = e.disposition?.trim() || 'Untagged';
      if (!map[d]) map[d] = { count: 0, iqsSum: 0, csatGood: 0, csatTotal: 0 };
      map[d].count++;
      map[d].iqsSum += e.iqs;
      if (e.csat === '5' || e.csat === '3' || e.csat === '1') {
        map[d].csatTotal++;
        if (e.csat === '5') map[d].csatGood++;
      }
    }
    return Object.entries(map)
      .map(([disp, d]) => ({
        disp,
        count: d.count,
        avgIqs: Math.round(d.iqsSum / d.count),
        csatPct: d.csatTotal > 0 ? Math.round(d.csatGood / d.csatTotal * 100) : null,
      }))
      .filter(d => d.count >= 2)
      .sort((a, b) => a.avgIqs - b.avgIqs);
  }, [scored]);

  // ── Filtered + sorted log entries ────────────────────────────────────────
  const displayedEntries = useMemo(() => {
    let list = pendingFilters.flaggedOnly ? entries.filter(e => flags[e.chatId]) : entries;
    if (sortCol) {
      list = [...list].sort((a, b) => {
        let av: number, bv: number;
        if (sortCol === 'iqs') { av = a.iqs; bv = b.iqs; }
        else if (sortCol === 'date') { av = new Date(a.scoredAt || '').getTime(); bv = new Date(b.scoredAt || '').getTime(); }
        else if (sortCol === 'csat') { av = parseInt(a.csat || '0') || 0; bv = parseInt(b.csat || '0') || 0; }
        else { av = a.frt ?? 999999; bv = b.frt ?? 999999; }
        return sortDir === 'asc' ? av - bv : bv - av;
      });
    }
    return list;
  }, [entries, pendingFilters.flaggedOnly, flags, sortCol, sortDir]);

  const icons = {
    performance: <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2 12l3-4 3 2 3-5 3 3"/><rect x="1" y="1" width="14" height="14" rx="1.5"/></svg>,
    log: <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="2" width="12" height="12" rx="1.5"/><path d="M5 6h6M5 8.5h4M5 11h3"/></svg>,
    calls: <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 3.5c0 5.5 4 9.5 9.5 9.5l1-2.5-2.5-1-1 1c-1.5-.5-3-2-3.5-3.5l1-1-1-2.5L3 3.5z"/></svg>,
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="h-screen flex font-sans antialiased overflow-hidden" style={{ background: '#f5f3ee' }}>

      {detailEntry && (
        <ScoreDetailModal
          entry={detailEntry}
          flagged={!!flags[detailEntry.chatId]}
          onClose={() => setDetailEntry(null)}
        />
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-gray-900 text-white text-sm font-medium px-5 py-3 rounded-2xl shadow-xl">
          {toast}
        </div>
      )}

      {/* ── Left sidebar ── */}
      <aside className="w-64 shrink-0 bg-[#111827] flex flex-col h-full">
        <div className="px-4 py-4 border-b border-white/10">
          <Link href="/chat" className="flex items-center gap-2 text-slate-400 hover:text-white transition mb-4 text-xs font-medium">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 3L5 8l5 5"/></svg>
            Back to chat
          </Link>
          <div className="bg-white rounded-lg px-2.5 py-1.5 inline-block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/wint-logo.png" alt="Wint" width={64} height={22} className="object-contain block" />
          </div>
          <p className="text-slate-500 text-[10px] mt-1.5 font-semibold uppercase tracking-wider">My Quality</p>
        </div>

        <nav className="px-3 py-4 flex-1 space-y-1">
          <NavItem icon={icons.performance} label="Performance" active={tab === 'performance'} onClick={() => switchTab('performance')} />
          <NavItem icon={icons.log} label="Score Log" active={tab === 'log'} onClick={() => switchTab('log')} />
          <NavItem icon={icons.calls} label="My Calls" active={tab === 'calls'} onClick={() => setTab('calls')} />
        </nav>

        {/* Agent identity */}
        <div className="px-4 py-4 border-t border-white/10">
          <p className="text-xs text-slate-400 truncate">{selfAgentName || userEmail.split('@')[0]}</p>
          <p className="text-[10px] text-slate-600 mt-0.5">Agent</p>
        </div>
      </aside>

      {/* ── Main content ── */}
      <div className="flex-1 flex flex-col h-full overflow-hidden">

        {/* Top bar */}
        <header className="shrink-0 bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between gap-4">
          <div className="shrink-0">
            <h1 className="text-base font-bold text-gray-900">
              {tab === 'performance' ? 'My Performance' : 'Score Log'}
            </h1>
            <p className="text-xs text-gray-500 mt-0.5">
              {tab === 'performance' && `${scored.length} scored · ${perfEntries.length} total chats`}
              {tab === 'log' && `${displayedEntries.length} of ${total} chats`}
            </p>
          </div>

          {tab === 'performance' && (
            <div className="flex items-center gap-2 ml-auto">
              {(['today','7d','30d','all'] as const).map(r => (
                <button key={r} onClick={() => { setPerfPeriod(r); loadPerf(r); }}
                  className={`text-xs px-3 py-1.5 rounded-lg font-semibold transition ${
                    perfPeriod === r ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                  }`}>
                  {r === 'today' ? 'Today' : r === '7d' ? '7 days' : r === '30d' ? '30 days' : 'All time'}
                </button>
              ))}
            </div>
          )}

          {tab === 'log' && (
            <div className="flex items-center gap-1.5 ml-auto">
              {(['today','7d','30d','all'] as const).map(r => (
                <button key={r}
                  onClick={() => {
                    const f = { ...pendingFilters, dateRange: r };
                    setPendingFilters(f); setAppliedFilters(f); setPage(0); loadLog(0, f);
                  }}
                  className={`text-xs px-3 py-1.5 rounded-lg font-semibold transition ${
                    appliedFilters.dateRange === r ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                  }`}>
                  {r === 'today' ? 'Today' : r === '7d' ? '7 days' : r === '30d' ? '30 days' : 'All time'}
                </button>
              ))}
              <button onClick={() => loadLog(page, appliedFilters)} disabled={logLoading}
                className="text-xs px-3 py-1.5 border border-gray-200 text-gray-500 rounded-lg hover:border-gray-400 disabled:opacity-40 transition font-medium ml-1">
                {logLoading ? '…' : '↻'}
              </button>
            </div>
          )}
        </header>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto p-6">

          {/* ── PERFORMANCE TAB ── */}
          {tab === 'performance' && (
            <div className="space-y-6 max-w-5xl mx-auto">
              {perfLoading ? (
                <div className="flex items-center justify-center h-48 text-gray-400 gap-2 text-sm">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="animate-spin"><path d="M8 2a6 6 0 1 0 6 6"/></svg>
                  Loading…
                </div>
              ) : (
                <>
                  {/* KPI cards */}
                  {(() => {
                    const botPct = summary && summary.totalConvos > 0 ? Math.round(summary.botConvos / summary.totalConvos * 100) : 0;
                    const humanPct = Math.max(0, 100 - botPct);
                    const ratedEntries = perfEntries.filter(e => ['5','3','1'].includes(e.csat || ''));
                    const good = ratedEntries.filter(e => e.csat === '5').length;
                    const bad  = ratedEntries.filter(e => e.csat !== '5' && e.csat != null).length;
                    const humanFrts = perfEntries.filter(e => e.conversationType !== 'bot' && e.frt != null).map(e => e.frt as number);
                    const avgHumanFrt = humanFrts.length ? Math.round(humanFrts.reduce((s, n) => s + n, 0) / humanFrts.length) : null;
                    return (
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                        <div className="bg-white rounded-2xl px-5 py-4 shadow-sm border border-gray-100">
                          <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">Chats</p>
                          <p className="text-3xl font-bold text-gray-900">{perfEntries.length}</p>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {botPct > 0 && <span className="text-[10px] font-semibold bg-violet-100 text-violet-700 px-2 py-0.5 rounded-full">{botPct}% Bot</span>}
                            {humanPct > 0 && <span className="text-[10px] font-semibold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">{humanPct}% Human</span>}
                          </div>
                        </div>
                        <div className="bg-white rounded-2xl px-5 py-4 shadow-sm border border-gray-100">
                          <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">Avg Resolution</p>
                          <p className="text-3xl font-bold text-gray-900">{fmtDuration(summary?.avgResolution ?? null)}</p>
                          <p className="text-[11px] text-gray-400 mt-1">all conversations</p>
                        </div>
                        <div className="bg-white rounded-2xl px-5 py-4 shadow-sm border border-gray-100">
                          <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">CSAT</p>
                          <p className="text-3xl font-bold text-gray-900">{summary?.overallCsat != null ? `${summary.overallCsat}%` : '—'}</p>
                          <p className="text-[11px] text-gray-400 mt-1">{good} good · {bad} bad</p>
                        </div>
                        <div className="bg-white rounded-2xl px-5 py-4 shadow-sm border border-gray-100">
                          <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">Avg FRT (Human)</p>
                          <p className="text-3xl font-bold text-gray-900">{fmtDuration(avgHumanFrt)}</p>
                          <p className="text-[11px] text-gray-400 mt-1">first response time</p>
                        </div>
                      </div>
                    );
                  })()}

                  {/* My scorecard */}
                  {avgIqs != null && (
                    <div>
                      <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-3">My Scorecard</p>
                      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                        <div className="px-5 pt-5 pb-4">
                          <div className="flex items-start gap-3">
                            <IQSRing iqs={avgIqs} size={64} />
                            <div className="flex-1 min-w-0 pt-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className="font-bold text-gray-900 text-lg tabular-nums" style={{ color: t?.text }}>{avgIqs}%</p>
                                <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: t?.bg, color: t?.text }}>{t?.label}</span>
                              </div>
                              <p className="text-xs text-gray-500 mt-0.5">{scored.length} scored chats · range {Math.min(...scored.map(e => e.iqs))}–{Math.max(...scored.map(e => e.iqs))}%</p>
                              <div className="flex items-center gap-2 mt-2 flex-wrap">
                                {scored.filter(e => e.iqs >= 90).length > 0 && (
                                  <span className="text-[10px] bg-emerald-50 text-emerald-700 font-semibold px-2 py-0.5 rounded-full">
                                    {scored.filter(e => e.iqs >= 90).length} excellent
                                  </span>
                                )}
                                {scored.filter(e => e.iqs < 70).length > 0 && (
                                  <span className="text-[10px] bg-red-50 text-red-600 font-semibold px-2 py-0.5 rounded-full">
                                    {scored.filter(e => e.iqs < 70).length} need review
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>

                        <div className="border-t border-gray-100 bg-gray-50/40 px-5 py-3.5">
                          {worstParams.length === 0 ? (
                            <p className="text-xs text-emerald-600 font-semibold text-center py-1">✓ No consistent failure areas</p>
                          ) : (
                            <>
                              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2.5">Coaching Focus</p>
                              <div className="space-y-1.5">
                                {worstParams.map(p => {
                                  const rate = myParamRates[p]!;
                                  const failPct = 100 - rate;
                                  const bench = top3Rates[p];
                                  const aboveBench = bench != null && failPct > (100 - bench);
                                  return (
                                    <div key={p} className="flex items-center justify-between gap-2">
                                      <span className="text-[11.5px] text-gray-600 truncate">{PARAM_NAMES[p]}</span>
                                      <div className="flex items-center gap-1.5 shrink-0">
                                        {aboveBench && <span className="text-[9px] text-amber-500 font-semibold">↑ top-3</span>}
                                        <span className={`text-[12px] font-bold tabular-nums ${failPct >= 40 ? 'text-red-500' : failPct >= 20 ? 'text-amber-500' : 'text-gray-500'}`}>
                                          {failPct}% fail
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
                    </div>
                  )}

                  {/* Disposition Breakdown */}
                  {dispositionStats.length > 0 && (
                    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                      <div className="px-5 py-4 border-b border-gray-100">
                        <p className="text-sm font-bold text-gray-900">Disposition Performance</p>
                        <p className="text-xs text-gray-500 mt-0.5">Your IQS by conversation topic — {dispositionStats.length} disposition{dispositionStats.length !== 1 ? 's' : ''}</p>
                      </div>

                      {/* Highlights row */}
                      <div className="grid grid-cols-2 divide-x divide-gray-100">
                        {/* Weakest */}
                        <div className="px-5 py-4">
                          <p className="text-[10px] font-bold text-red-400 uppercase tracking-widest mb-2.5">Needs Focus</p>
                          <div className="space-y-2">
                            {dispositionStats.slice(0, 3).map(d => {
                              const theme = iqsTheme(d.avgIqs);
                              return (
                                <div key={d.disp} className="flex items-center gap-2">
                                  <div className="flex-1 min-w-0">
                                    <p className="text-xs font-semibold text-gray-700 truncate">{d.disp}</p>
                                    <p className="text-[10px] text-gray-400">{d.count} chat{d.count !== 1 ? 's' : ''}</p>
                                  </div>
                                  <span className="text-sm font-bold tabular-nums shrink-0" style={{ color: theme.text }}>{d.avgIqs}%</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                        {/* Strongest */}
                        <div className="px-5 py-4">
                          <p className="text-[10px] font-bold text-emerald-500 uppercase tracking-widest mb-2.5">Strong Points</p>
                          <div className="space-y-2">
                            {[...dispositionStats].reverse().slice(0, 3).map(d => {
                              const theme = iqsTheme(d.avgIqs);
                              return (
                                <div key={d.disp} className="flex items-center gap-2">
                                  <div className="flex-1 min-w-0">
                                    <p className="text-xs font-semibold text-gray-700 truncate">{d.disp}</p>
                                    <p className="text-[10px] text-gray-400">{d.count} chat{d.count !== 1 ? 's' : ''}</p>
                                  </div>
                                  <span className="text-sm font-bold tabular-nums shrink-0" style={{ color: theme.text }}>{d.avgIqs}%</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>

                      {/* Full table */}
                      {dispositionStats.length > 3 && (
                        <>
                          <div className="border-t border-gray-100">
                            <div className="px-5 py-2.5 flex items-center justify-between">
                              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">All Dispositions</p>
                              {dispositionStats.length > 6 && (
                                <button onClick={() => setShowAllDispositions(v => !v)} className="text-xs text-emerald-600 font-semibold hover:underline">
                                  {showAllDispositions ? 'Show less ↑' : `View all ${dispositionStats.length} →`}
                                </button>
                              )}
                            </div>
                            <div className="overflow-x-auto">
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="bg-gray-50/60 border-t border-b border-gray-100">
                                    <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Disposition</th>
                                    <th className="text-right px-4 py-2.5 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Chats</th>
                                    <th className="text-right px-4 py-2.5 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Avg IQS</th>
                                    <th className="text-right px-4 py-2.5 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">CSAT</th>
                                    <th className="px-4 py-2.5 w-24"></th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {(showAllDispositions ? dispositionStats : dispositionStats.slice(0, 6)).map((d, i) => {
                                    const theme = iqsTheme(d.avgIqs);
                                    return (
                                      <tr key={d.disp} className={`border-b border-gray-50 ${i % 2 === 1 ? 'bg-gray-50/20' : ''}`}>
                                        <td className="px-4 py-2.5 font-medium text-gray-700 truncate max-w-[180px]">{d.disp}</td>
                                        <td className="px-4 py-2.5 text-right text-gray-500 tabular-nums">{d.count}</td>
                                        <td className="px-4 py-2.5 text-right">
                                          <span className="font-bold tabular-nums" style={{ color: theme.text }}>{d.avgIqs}%</span>
                                        </td>
                                        <td className="px-4 py-2.5 text-right text-gray-500 tabular-nums">
                                          {d.csatPct != null ? `${d.csatPct}%` : '—'}
                                        </td>
                                        <td className="px-4 py-2.5">
                                          <div className="h-1.5 bg-gray-100 rounded-full w-20 ml-auto">
                                            <div className="h-1.5 rounded-full" style={{ width: `${d.avgIqs}%`, background: theme.bar }} />
                                          </div>
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  )}

                  {/* Parameter fail rates vs top-3 benchmark */}
                  {teamAvg && (
                    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                      <div className="flex items-center justify-between mb-4">
                        <div>
                          <p className="text-sm font-bold text-gray-900">Parameter Fail Rates</p>
                          <p className="text-xs text-gray-500 mt-0.5">Your fail% vs top-3 benchmark — lower is better</p>
                        </div>
                        <div className="flex items-center gap-3 text-[10px] text-gray-400">
                          <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm bg-red-400" />Mine</span>
                          <span className="flex items-center gap-1"><span className="inline-block w-0.5 h-3 rounded-sm bg-gray-400" />Top 3</span>
                        </div>
                      </div>
                      <div className="space-y-3">
                        {paramsSorted.map(p => {
                          const passRate = myParamRates[p];
                          const benchPass = top3Rates[p] ?? null;
                          const myFail   = passRate != null ? 100 - passRate : null;
                          const benchFail = benchPass != null ? 100 - benchPass : null;
                          const barColor = myFail == null ? '#e5e7eb' : myFail === 0 ? '#22c55e' : myFail <= 20 ? '#f59e0b' : '#ef4444';
                          const textColor = myFail == null ? '#9ca3af' : myFail === 0 ? '#15803d' : myFail <= 20 ? '#92400e' : '#b91c1c';
                          return (
                            <div key={p}>
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-xs text-gray-600 font-medium truncate pr-2">{PARAM_NAMES[p]}</span>
                                <div className="flex items-center gap-2 shrink-0">
                                  {benchFail != null && myFail != null && myFail - benchFail >= 10 && (
                                    <span className="text-[9px] text-red-400 font-semibold">+{myFail - benchFail}pp above top-3</span>
                                  )}
                                  <span className="text-xs font-bold tabular-nums" style={{ color: textColor }}>
                                    {myFail != null ? `${myFail}% fail` : '—'}
                                  </span>
                                </div>
                              </div>
                              <div className="relative h-1.5 bg-gray-100 rounded-full">
                                <div className="h-1.5 rounded-full transition-all" style={{ width: `${myFail ?? 0}%`, background: barColor }} />
                                {benchFail != null && (
                                  <div className="absolute top-0 bottom-0 w-0.5 bg-gray-400 rounded-full" style={{ left: `${benchFail}%`, transform: 'translateX(-50%)' }} />
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Weekly parameter breakdown */}
                  {weeklyParamData.length > 0 && (
                    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                        <div>
                          <p className="text-sm font-bold text-gray-900">Parameter Failure by Week</p>
                          <p className="text-xs text-gray-500 mt-0.5">% of your chats failing each parameter</p>
                        </div>
                        {weeklyParamData.length > 4 && (
                          <button onClick={() => setShowAllWeeks(v => !v)} className="text-xs text-emerald-600 font-semibold hover:underline shrink-0">
                            {showAllWeeks ? 'Show less ↑' : `View all ${weeklyParamData.length} weeks →`}
                          </button>
                        )}
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs min-w-[900px]">
                          <thead>
                            <tr className="bg-gray-50/80 border-b border-gray-100">
                              <th className="text-left px-4 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap sticky left-0 bg-gray-50/80">Week</th>
                              <th className="text-right px-3 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Chats</th>
                              {PARAM_ORDER.map(p => (
                                <th key={p} className="text-right px-3 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap" title={PARAM_NAMES[p]}>
                                  {p === 'AllQuestions' ? 'All Q' : p === 'Expectation' ? 'Expect' : p === 'Contextual' ? 'Context' : p === 'FollowUp' ? 'Follow' : p === 'Sentences' ? 'Tone' : p === 'Technical' ? 'Tech' : p}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {(showAllWeeks ? weeklyParamData : weeklyParamData.slice(0, 4)).map((row, i) => (
                              <tr key={row.key} className={`border-b border-gray-50 hover:bg-emerald-50/20 transition ${i % 2 === 1 ? 'bg-gray-50/20' : ''}`}>
                                <td className="px-4 py-3 font-medium text-gray-700 whitespace-nowrap sticky left-0 bg-white">{row.label}</td>
                                <td className="px-3 py-3 text-right text-gray-500 tabular-nums">{row.total}</td>
                                {PARAM_ORDER.map(p => {
                                  const pct = row.params[p];
                                  const color = pct >= 40 ? 'text-red-600 font-bold' : pct >= 20 ? 'text-amber-600 font-semibold' : pct > 0 ? 'text-gray-600' : 'text-gray-300';
                                  return (
                                    <td key={p} className={`px-3 py-3 text-right tabular-nums ${color}`}>
                                      {pct > 0 ? `${pct}%` : '—'}
                                    </td>
                                  );
                                })}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* ── MY CALLS TAB ── */}
          {tab === 'calls' && (
            <div className="p-6 overflow-y-auto flex-1">
              <CallQualityClient selfAgentName={selfAgentName} agentOnly />
            </div>
          )}

          {/* ── SCORE LOG TAB ── */}
          {tab === 'log' && (
            <div className="space-y-4 max-w-5xl mx-auto">

              {/* Filters */}
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                <div className="flex flex-wrap items-end gap-4">
                  {/* CSAT */}
                  <div>
                    <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">CSAT</p>
                    <select value={pendingFilters.csat} onChange={e => setPendingFilters(f => ({ ...f, csat: e.target.value }))}
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
                        className="w-14 text-xs border border-gray-200 rounded-xl px-2 py-1.5 text-center focus:outline-none focus:ring-2 focus:ring-emerald-500/30" />
                      <span className="text-gray-400 text-xs">–</span>
                      <input type="number" min={0} max={100} value={pendingFilters.maxScore}
                        onChange={e => setPendingFilters(f => ({ ...f, maxScore: parseInt(e.target.value) || 100 }))}
                        className="w-14 text-xs border border-gray-200 rounded-xl px-2 py-1.5 text-center focus:outline-none focus:ring-2 focus:ring-emerald-500/30" />
                    </div>
                  </div>
                  {/* Type */}
                  <div>
                    <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Type</p>
                    <select value={pendingFilters.type} onChange={e => setPendingFilters(f => ({ ...f, type: e.target.value }))}
                      className="text-xs border border-gray-200 rounded-xl px-3 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 min-w-[100px]">
                      <option value="">All</option>
                      <option value="agent">Human</option>
                      <option value="bot">Bot</option>
                      <option value="hybrid">Hybrid</option>
                    </select>
                  </div>
                  {/* Disposition */}
                  {availableDispositions.length > 0 && (
                    <div>
                      <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Disposition</p>
                      <select value={pendingFilters.disposition}
                        onChange={e => setPendingFilters(f => ({ ...f, disposition: e.target.value, subDisposition: '' }))}
                        className="text-xs border border-gray-200 rounded-xl px-3 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 min-w-[140px] max-w-[180px]">
                        <option value="">Any</option>
                        {availableDispositions.map(d => <option key={d} value={d}>{d}</option>)}
                      </select>
                    </div>
                  )}
                  {/* Sub-Disposition */}
                  {availableSubDispositions.length > 0 && (
                    <div>
                      <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Sub-Disposition</p>
                      <select value={pendingFilters.subDisposition}
                        onChange={e => setPendingFilters(f => ({ ...f, subDisposition: e.target.value }))}
                        className="text-xs border border-gray-200 rounded-xl px-3 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 min-w-[140px] max-w-[180px]">
                        <option value="">Any</option>
                        {availableSubDispositions.map(d => <option key={d} value={d}>{d}</option>)}
                      </select>
                    </div>
                  )}
                  {/* Flagged toggle */}
                  <div>
                    <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Show</p>
                    <button
                      onClick={() => setPendingFilters(f => ({ ...f, flaggedOnly: !f.flaggedOnly }))}
                      className={`text-xs px-3 py-1.5 rounded-xl font-semibold border transition ${
                        pendingFilters.flaggedOnly
                          ? 'bg-amber-50 border-amber-300 text-amber-700'
                          : 'bg-white border-gray-200 text-gray-500 hover:border-gray-400'
                      }`}>
                      ⚑ Flagged only
                    </button>
                  </div>
                  {/* Apply button */}
                  <div className="ml-auto">
                    <button onClick={applyFilters} disabled={logLoading}
                      className="text-xs px-4 py-1.5 bg-emerald-600 text-white rounded-xl font-bold hover:bg-emerald-700 disabled:opacity-50 transition">
                      {logLoading ? 'Loading…' : 'Apply'}
                    </button>
                  </div>
                </div>
              </div>

              {logError && (
                <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-red-700 text-sm">{logError}</div>
              )}

              {/* Table */}
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between">
                  <p className="text-sm font-bold text-gray-900">{displayedEntries.length} chats</p>
                  <p className="text-xs text-gray-400">click any row to view scores + transcript</p>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-gray-50/60 border-b border-gray-100">
                        {[
                          { col: 'Chat ID', key: null },
                          { col: 'Date', key: 'date' as const },
                          { col: 'Type', key: null },
                          { col: 'CSAT', key: 'csat' as const },
                          { col: 'IQS', key: 'iqs' as const },
                          { col: 'FRT', key: 'frt' as const },
                          { col: 'Resolution', key: null },
                          { col: 'Disposition', key: null },
                          { col: '', key: null },
                        ].map(({ col, key }) => (
                          <th key={col}
                            className={`text-left px-4 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap ${key ? 'cursor-pointer hover:text-gray-700 select-none' : ''}`}
                            onClick={() => {
                              if (!key) return;
                              if (sortCol === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
                              else { setSortCol(key); setSortDir('desc'); }
                            }}>
                            {col}
                            {key && sortCol === key && <span className="ml-1">{sortDir === 'asc' ? '↑' : '↓'}</span>}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {logLoading && !displayedEntries.length && (
                        <tr><td colSpan={9} className="text-center text-sm text-gray-400 py-12">
                          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="animate-spin inline mr-2"><path d="M8 2a6 6 0 1 0 6 6"/></svg>
                          Loading…
                        </td></tr>
                      )}
                      {!logLoading && displayedEntries.length === 0 && (
                        <tr><td colSpan={9} className="text-center text-sm text-gray-400 py-14">No chats match these filters.</td></tr>
                      )}
                      {displayedEntries.map((e, i) => {
                        const theme = iqsTheme(e.iqs);
                        const cs = csatLabel(e.csat);
                        const isFlagged = !!flags[e.chatId];
                        return (
                          <tr key={e.id}
                            onClick={() => setDetailEntry(e)}
                            className={`border-b border-gray-50 hover:bg-emerald-50/30 cursor-pointer transition ${i % 2 === 1 ? 'bg-gray-50/20' : ''}`}>
                            <td className="px-4 py-3 font-mono text-emerald-700 font-semibold whitespace-nowrap">
                              {e.chatId}
                              {isFlagged && <span className="ml-1.5 text-amber-500 text-[10px]">⚑</span>}
                            </td>
                            <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{e.scoredAt?.slice(0, 10) || e.date || '—'}</td>
                            <td className="px-4 py-3"><TypeBadge type={e.conversationType} /></td>
                            <td className="px-4 py-3">
                              {cs
                                ? <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${cs.cls}`}>{cs.label}</span>
                                : <span className="text-gray-300">—</span>}
                            </td>
                            <td className="px-4 py-3">
                              <IQSPill iqs={e.iqs} />
                            </td>
                            <td className="px-4 py-3 text-gray-500 tabular-nums">{fmtDuration(e.frt)}</td>
                            <td className="px-4 py-3 text-gray-500 tabular-nums">{fmtDuration(e.resolutionTime)}</td>
                            <td className="px-4 py-3 text-gray-500 max-w-[120px] truncate">
                              {e.disposition || '—'}
                              {e.subDisposition && <span className="text-gray-400"> / {e.subDisposition}</span>}
                            </td>
                            <td className="px-4 py-3 text-gray-300">→</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {hasMore && (
                  <div className="px-5 py-3 border-t border-gray-50 flex items-center justify-between">
                    <p className="text-xs text-gray-400">Showing {displayedEntries.length} of {total}</p>
                    <button onClick={() => { const next = page + 1; setPage(next); loadLog(next, appliedFilters); }}
                      disabled={logLoading}
                      className="text-xs font-semibold text-emerald-600 hover:underline disabled:opacity-40">
                      Load more →
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
