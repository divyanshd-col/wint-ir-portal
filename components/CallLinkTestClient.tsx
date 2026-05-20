'use client';

import { useState } from 'react';
import { CALL_PARAM_NAMES, CALL_PARAM_GROUPS, CALL_WEIGHTS } from '@/lib/call-quality';
import type { CallSegment } from '@/lib/call-quality';

// ── Helpers ───────────────────────────────────────────────────────────────────

function iqsTheme(iqs: number) {
  if (iqs >= 90) return { text: '#15803d', bg: '#dcfce7', label: 'Excellent' };
  if (iqs >= 80) return { text: '#92400e', bg: '#fef3c7', label: 'Good' };
  if (iqs >= 70) return { text: '#c2410c', bg: '#ffedd5', label: 'Average' };
  return           { text: '#b91c1c', bg: '#fee2e2', label: 'Needs Work' };
}

function ScoreBadge({ score }: { score?: string }) {
  if (score === 'Yes') return <span className="px-2 py-0.5 rounded text-xs font-bold bg-emerald-50 text-emerald-700">Yes</span>;
  if (score === 'No')  return <span className="px-2 py-0.5 rounded text-xs font-bold bg-red-50 text-red-600">No</span>;
  return                      <span className="px-2 py-0.5 rounded text-xs font-bold bg-slate-100 text-slate-500">NA</span>;
}

function SegmentRow({ seg }: { seg: CallSegment }) {
  if (seg.type === 'interruption') {
    return (
      <tr>
        <td colSpan={2} className="px-4 py-1.5">
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-50 border border-red-100">
            <span className="text-red-500">⚡</span>
            <span className="text-xs text-red-700">
              <strong>{seg.interrupted_speaker}</strong> interrupted by <strong>{seg.interrupted_by}</strong>
              {seg.words_spoken != null && ` — ${seg.words_spoken} word${seg.words_spoken !== 1 ? 's' : ''} before cutoff`}
            </span>
          </div>
        </td>
      </tr>
    );
  }
  if (seg.type === 'dead_air') {
    return (
      <tr>
        <td colSpan={2} className="px-4 py-1.5">
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-50 border border-slate-200">
            <span className="text-slate-400">⏸</span>
            <span className="text-xs text-slate-500">
              Dead air{seg.duration ? ` — ${seg.duration}` : ''}{seg.resumed_by ? ` — resumed by ${seg.resumed_by}` : ''}
            </span>
          </div>
        </td>
      </tr>
    );
  }
  if (seg.type === 'poor_listening') {
    return (
      <tr>
        <td colSpan={2} className="px-4 py-1.5">
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-orange-50 border border-orange-100">
            <span className="text-orange-500">👂</span>
            <span className="text-xs text-orange-700">
              Poor listening detected{seg.phrase ? `: "${seg.phrase}"` : ''}
            </span>
          </div>
        </td>
      </tr>
    );
  }
  const isIR = seg.speaker === 'IR EXECUTIVE';
  return (
    <tr className="border-b border-slate-50 align-top hover:bg-slate-50/50">
      <td className="px-4 py-2.5 w-40 shrink-0">
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold ${
          isIR ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'
        }`}>
          {isIR ? '🟡' : '🟢'} {seg.speaker}
        </span>
      </td>
      <td className="px-4 py-2.5 text-sm text-slate-700 leading-relaxed">
        {seg.text}
        {seg.translated && (
          <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-50 text-blue-500 align-middle">
            🌐 translated
          </span>
        )}
      </td>
    </tr>
  );
}

// ── Response shape from /api/call-quality/unified-score ───────────────────────

interface UnifiedScoreResult {
  ok: boolean;
  chat_id: string;
  hasCallRecording: boolean;
  callRecordingCount: number;
  language: string;
  interruptionCount: number;
  deadAirCount: number;
  callIqs: number | null;
  callScores: Record<string, string>;
  callReasoning: Record<string, string>;
  callSummary: string;
  callSegments: CallSegment[];
  callKbCitation: string | null;
  chatIqs: number | null;
  chatScores: Record<string, string>;
  chatReasoning: Record<string, string>;
  chatSummary: string;
  mergedTimeline: any[];
  scoringMs: number;
  totalMs: number;
}

// ── Result Panel ──────────────────────────────────────────────────────────────

function ResultPanel({
  data,
  onReset,
  userRole,
}: {
  data: UnifiedScoreResult;
  onReset: () => void;
  userRole?: string;
}) {
  const [expandedParam, setExpandedParam] = useState<string | null>(null);
  const isQuality = ['quality', 'admin', 'tl'].includes(userRole || '');

  // ── Override modal state ────────────────────────────────────────────────────
  const [overrideOpen, setOverrideOpen]   = useState(false);
  const [overrideScores, setOverrideScores]     = useState<Record<string, string>>({});
  const [overrideReasoning, setOverrideReasoning] = useState<Record<string, string>>({});
  const [overrideNote, setOverrideNote]   = useState('');
  const [saving, setSaving]               = useState(false);
  const [saveMsg, setSaveMsg]             = useState('');
  const [savedIqs, setSavedIqs]           = useState<number | null>(null);

  function openOverride() {
    setOverrideScores({ ...data.callScores });
    setOverrideReasoning({ ...data.callReasoning });
    setOverrideNote('');
    setSaveMsg('');
    setOverrideOpen(true);
  }

  async function saveOverride() {
    setSaving(true);
    setSaveMsg('');
    try {
      const res = await fetch('/api/call-quality/override-scores', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: data.chat_id,
          scores: overrideScores,
          reasoning: overrideReasoning,
          note: overrideNote,
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Save failed');
      setSavedIqs(d.callIqsScore);
      setSaveMsg('Saved!');
      setTimeout(() => { setOverrideOpen(false); setSaveMsg(''); }, 1000);
    } catch (e: any) {
      setSaveMsg(e.message || 'Error saving');
    }
    setSaving(false);
  }

  // No call recording case
  if (!data.hasCallRecording) {
    return (
      <div className="space-y-4">
        <div className="bg-amber-50 border border-amber-200 rounded-2xl px-6 py-5 flex items-center gap-3">
          <span className="text-amber-500 text-2xl">📵</span>
          <div>
            <p className="font-semibold text-amber-800">No call recordings found for this chat</p>
            <p className="text-sm text-amber-600 mt-0.5">
              Chat ID <span className="font-mono font-bold">{data.chat_id}</span> has no linked call recordings.
            </p>
          </div>
        </div>
        <div className="flex justify-center pt-2">
          <button
            onClick={onReset}
            className="px-6 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-sm transition-colors"
          >
            🔄 Score another
          </button>
        </div>
      </div>
    );
  }

  const iqs = data.callIqs ?? 0;
  const t = iqsTheme(iqs);

  return (
    <div className="space-y-4">
      {/* Summary card */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
        <div className="flex flex-wrap items-center gap-4">
          {/* IQS circle */}
          <div
            className="flex items-center justify-center rounded-full w-16 h-16 text-2xl font-black tabular-nums shrink-0"
            style={{ background: t.bg, color: t.text }}
          >
            {data.callIqs != null ? data.callIqs : '—'}
          </div>

          {/* Label + summary */}
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-slate-800">
              {data.callIqs != null ? `${t.label} — Call IQS` : 'Call IQS unavailable'}
            </p>
            {data.callSummary && (
              <p className="text-sm text-slate-500 mt-0.5 line-clamp-2">{data.callSummary}</p>
            )}
          </div>

          {/* Stats chips */}
          <div className="flex flex-wrap gap-3 text-sm text-slate-600 shrink-0">
            {data.language && (
              <span className="flex items-center gap-1">🌐 {data.language}</span>
            )}
            <span className="flex items-center gap-1" title="Interruptions">⚡ {data.interruptionCount}</span>
            <span className="flex items-center gap-1" title="Dead air events">⏸ {data.deadAirCount}</span>
            {data.callRecordingCount > 1 && (
              <span className="flex items-center gap-1 text-blue-600" title="Number of call recordings">
                📞 {data.callRecordingCount} calls
              </span>
            )}
          </div>
        </div>

        {/* Meta row */}
        <div className="mt-3 pt-3 border-t border-slate-100 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-500">
          <span><span className="font-medium text-slate-600">Chat ID:</span> {data.chat_id}</span>
          {data.callKbCitation && (
            <span><span className="font-medium text-slate-600">KB:</span> {data.callKbCitation}</span>
          )}
          <span className="ml-auto text-slate-400">
            Scored {(data.scoringMs / 1000).toFixed(1)}s · Total {(data.totalMs / 1000).toFixed(1)}s
          </span>
        </div>
      </div>

      {/* Transcript + Parameters grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Left: Call transcript */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Call Transcript</p>
            {data.callRecordingCount > 1 && (
              <span className="text-[10px] text-slate-400">{data.callRecordingCount} recordings merged</span>
            )}
          </div>
          <div className="overflow-y-auto max-h-[520px]">
            <table className="w-full">
              <tbody>
                {data.callSegments.map((seg, i) => (
                  <SegmentRow key={i} seg={seg} />
                ))}
                {data.callSegments.length === 0 && (
                  <tr>
                    <td colSpan={2} className="px-5 py-8 text-center text-slate-400 text-sm">
                      No transcript segments available.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right: Call IQS parameters */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
              Call IQS Parameters
              {savedIqs !== null && <span className="ml-2 text-emerald-600 font-bold">→ {savedIqs} (overridden)</span>}
            </p>
            {isQuality && (
              <button
                onClick={openOverride}
                className="px-3 py-1 rounded-lg text-[11px] font-semibold border border-amber-300 text-amber-700 bg-amber-50 hover:bg-amber-100 transition"
              >
                Override Score
              </button>
            )}
          </div>
          <div className="overflow-y-auto max-h-[520px] divide-y divide-slate-50">
            {Object.entries(CALL_PARAM_GROUPS).map(([groupKey, group]) => (
              <div key={groupKey}>
                <div className="px-5 py-2 bg-slate-50/70">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">{group.label}</p>
                </div>
                {group.keys.map(key => {
                  const score  = data.callScores[key];
                  const reason = data.callReasoning[key];
                  const weight = Math.round((CALL_WEIGHTS[key] || 0) * 100);
                  const isOpen = expandedParam === key;
                  return (
                    <div key={key} className="px-5 py-2.5">
                      <button
                        className="w-full flex items-center justify-between gap-2 text-left"
                        onClick={() => setExpandedParam(isOpen ? null : key)}
                      >
                        <span className="text-sm text-slate-700 font-medium flex-1">{CALL_PARAM_NAMES[key]}</span>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-[10px] text-slate-400">{weight}%</span>
                          <ScoreBadge score={score} />
                          {reason && (
                            <span className="text-slate-300 text-xs">{isOpen ? '▲' : '▼'}</span>
                          )}
                        </div>
                      </button>
                      {isOpen && reason && (
                        <p className="mt-1.5 text-xs text-slate-500 leading-relaxed pl-1">{reason}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Reset */}
      <div className="flex justify-center pt-2">
        <button
          onClick={onReset}
          className="px-6 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-sm transition-colors"
        >
          🔄 Score another
        </button>
      </div>

      {/* ── Override Score Modal ── */}
      {overrideOpen && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => setOverrideOpen(false)}>
          <div className="bg-white w-full sm:rounded-2xl sm:max-w-2xl max-h-[94vh] overflow-y-auto shadow-2xl"
            onClick={e => e.stopPropagation()}>
            <div className="sticky top-0 bg-white border-b border-slate-100 px-6 py-4 flex items-center justify-between">
              <div>
                <h2 className="font-bold text-slate-900">Override Call Score</h2>
                <p className="text-xs text-slate-400">Chat {data.chat_id}</p>
              </div>
              <button onClick={() => setOverrideOpen(false)}
                className="p-2 rounded-xl hover:bg-slate-100 text-slate-400 transition">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 2l12 12M14 2L2 14"/></svg>
              </button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Parameter Scores</p>
              <div className="space-y-3">
                {Object.entries(CALL_PARAM_GROUPS).map(([gk, group]) => (
                  <div key={gk}>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-2">{group.label}</p>
                    {group.keys.map(key => (
                      <div key={key} className="rounded-xl border border-slate-100 p-3 bg-slate-50/60 mb-2">
                        <div className="flex items-center gap-3 mb-2">
                          <span className="text-xs font-semibold text-slate-700 flex-1">{CALL_PARAM_NAMES[key]}</span>
                          <div className="flex gap-1">
                            {(['Yes', 'No', 'NA'] as const).map(v => (
                              <button key={v}
                                onClick={() => setOverrideScores(s => ({ ...s, [key]: v }))}
                                className={`px-2.5 py-1 text-xs font-bold rounded-lg transition ${
                                  overrideScores[key] === v
                                    ? v === 'Yes' ? 'bg-emerald-500 text-white' : v === 'No' ? 'bg-red-500 text-white' : 'bg-slate-400 text-white'
                                    : 'bg-white border border-slate-200 text-slate-500 hover:border-slate-400'
                                }`}>{v}</button>
                            ))}
                          </div>
                        </div>
                        <textarea
                          value={overrideReasoning[key] || ''}
                          onChange={e => setOverrideReasoning(r => ({ ...r, [key]: e.target.value }))}
                          placeholder="Reasoning…"
                          rows={2}
                          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-amber-300/40 resize-y bg-white"
                        />
                      </div>
                    ))}
                  </div>
                ))}
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">Note (internal)</label>
                <textarea value={overrideNote} onChange={e => setOverrideNote(e.target.value)}
                  placeholder="Reason for override…" rows={2}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-300/40 resize-y" />
              </div>
              <div className="flex items-center gap-3 pt-1">
                <button onClick={saveOverride} disabled={saving}
                  className="px-5 py-2.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-white text-sm font-bold rounded-xl transition">
                  {saving ? 'Saving…' : 'Save Override'}
                </button>
                <button onClick={() => setOverrideOpen(false)}
                  className="px-5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-semibold rounded-xl transition">
                  Cancel
                </button>
                {saveMsg && <span className={`text-sm font-medium ${saveMsg === 'Saved!' ? 'text-emerald-600' : 'text-red-500'}`}>{saveMsg}</span>}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  userRole?: string;
}

export default function CallLinkTestClient({ userRole }: Props) {
  const [chatId, setChatId]   = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [result, setResult]   = useState<UnifiedScoreResult | null>(null);

  async function handleSubmit() {
    if (!chatId.trim()) return;
    setLoading(true);
    setError('');
    setResult(null);

    try {
      const res = await fetch('/api/call-quality/unified-score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId.trim() }),
      });

      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || `Server error ${res.status}`);
      }

      setResult(data as UnifiedScoreResult);
    } catch (e: any) {
      setError(e.message || 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setResult(null);
    setError('');
    setChatId('');
  }

  // ── Result view ──────────────────────────────────────────────────────────────
  if (result) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-6">
        <ResultPanel data={result} onReset={reset} userRole={userRole} />
      </div>
    );
  }

  // ── Form + loading ───────────────────────────────────────────────────────────
  return (
    <div className="max-w-md mx-auto px-4 py-10">
      {/* Header */}
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-amber-100 text-3xl mb-4">📞</div>
        <h1 className="text-2xl font-bold text-slate-800">Call Transcript Test</h1>
        <p className="text-slate-500 mt-1.5 text-sm">
          Enter a Chat ID to fetch its call recording(s), run transcription and IQS scoring.
        </p>
      </div>

      {/* Form */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 space-y-5">
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1.5">
            Chat ID <span className="text-red-400">*</span>
          </label>
          <input
            type="text"
            className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-300 transition font-mono"
            placeholder="e.g. 40502"
            value={chatId}
            onChange={e => setChatId(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !loading && handleSubmit()}
            disabled={loading}
          />
          <p className="text-xs text-slate-400 mt-1">The WhatsApp conversation ID from the conversations table.</p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
            ❌ {error}
          </div>
        )}

        <button
          onClick={handleSubmit}
          disabled={!chatId.trim() || loading}
          className="w-full py-3 rounded-xl bg-amber-500 hover:bg-amber-600 disabled:bg-slate-200 disabled:text-slate-400 text-white font-bold text-sm transition-colors flex items-center justify-center gap-2"
        >
          {loading ? (
            <>
              <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              Fetching transcripts and scoring call...
            </>
          ) : (
            'Fetch Transcripts'
          )}
        </button>
      </div>
    </div>
  );
}
