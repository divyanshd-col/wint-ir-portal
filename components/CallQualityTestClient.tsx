'use client';

import { useState } from 'react';
import { CALL_PARAM_ORDER, CALL_PARAM_NAMES, CALL_PARAM_GROUPS, CALL_WEIGHTS } from '@/lib/call-quality';
import type { CallSegment, CallParamScore } from '@/lib/call-quality';

// ── Helpers ───────────────────────────────────────────────────────────────────

function iqsTheme(iqs: number) {
  if (iqs >= 90) return { text: '#15803d', bg: '#dcfce7', bar: '#22c55e', label: 'Excellent' };
  if (iqs >= 80) return { text: '#92400e', bg: '#fef3c7', bar: '#f59e0b', label: 'Good' };
  if (iqs >= 70) return { text: '#c2410c', bg: '#ffedd5', bar: '#f97316', label: 'Average' };
  return           { text: '#b91c1c', bg: '#fee2e2', bar: '#ef4444', label: 'Needs Work' };
}

function ScoreBadge({ score }: { score?: string }) {
  if (score === 'Yes') return <span className="px-2 py-0.5 rounded text-xs font-bold bg-emerald-50 text-emerald-700">Yes</span>;
  if (score === 'No')  return <span className="px-2 py-0.5 rounded text-xs font-bold bg-red-50 text-red-600">No</span>;
  return                      <span className="px-2 py-0.5 rounded text-xs font-bold bg-slate-100 text-slate-500">NA</span>;
}

// ── Segment row ───────────────────────────────────────────────────────────────

function SegmentRow({ seg }: { seg: CallSegment }) {
  if (seg.type === 'interruption') {
    return (
      <tr>
        <td colSpan={2} className="px-4 py-1.5">
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-50 border border-red-100">
            <span className="text-red-500 text-base">⚡</span>
            <span className="text-xs text-red-700">
              <strong>{seg.interrupted_speaker}</strong> interrupted by <strong>{seg.interrupted_by}</strong>
              {seg.words_spoken != null && ` — ${seg.words_spoken} word${seg.words_spoken !== 1 ? 's' : ''} spoken before cutoff`}
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
            <span className="text-slate-400 text-base">⏸</span>
            <span className="text-xs text-slate-500">
              Dead air{seg.duration ? ` — ${seg.duration}` : ''}{seg.resumed_by ? ` — resumed by ${seg.resumed_by}` : ''}
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

// ── IQS Result Panel ──────────────────────────────────────────────────────────

interface ResultData {
  language: string;
  segments: CallSegment[];
  interruptionCount: number;
  deadAirCount: number;
  iqs: number;
  scores: Record<string, string>;
  reasoning: Record<string, string>;
  summary: string;
  transcriptionMs: number;
  scoringMs: number;
}

function ResultPanel({ data, onReset }: { data: ResultData; onReset: () => void }) {
  const [expandedParam, setExpandedParam] = useState<string | null>(null);
  const t = iqsTheme(data.iqs);

  return (
    <div className="space-y-4">
      {/* Summary bar */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
        <div className="flex flex-wrap items-center gap-4">
          {/* IQS ring */}
          <div className="flex items-center justify-center rounded-full w-16 h-16 text-2xl font-black tabular-nums"
            style={{ background: t.bg, color: t.text }}>
            {data.iqs}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-slate-800">{t.label}</p>
            <p className="text-sm text-slate-500 mt-0.5">{data.summary}</p>
          </div>
          <div className="flex flex-wrap gap-3 text-sm text-slate-600 shrink-0">
            <span className="flex items-center gap-1.5">
              <span className="text-blue-400 font-bold">🌐</span> {data.language}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="text-red-400">⚡</span> {data.interruptionCount} interruption{data.interruptionCount !== 1 ? 's' : ''}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="text-slate-400">⏸</span> {data.deadAirCount} dead air
            </span>
            <span className="text-slate-400 text-xs">
              Transcribed in {(data.transcriptionMs / 1000).toFixed(1)}s · Scored in {(data.scoringMs / 1000).toFixed(1)}s
            </span>
          </div>
        </div>
      </div>

      {/* Transcript + Parameters */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Transcript */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 bg-slate-50">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Call Transcript</p>
          </div>
          <div className="overflow-y-auto max-h-[520px]">
            <table className="w-full">
              <tbody>
                {data.segments.map((seg, i) => <SegmentRow key={i} seg={seg} />)}
                {data.segments.length === 0 && (
                  <tr><td colSpan={2} className="px-5 py-8 text-center text-slate-400 text-sm">No segments returned.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* IQS Parameters */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 bg-slate-50">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Call IQS — 12 Parameters</p>
          </div>
          <div className="overflow-y-auto max-h-[520px] divide-y divide-slate-50">
            {Object.entries(CALL_PARAM_GROUPS).map(([groupKey, group]) => (
              <div key={groupKey}>
                <div className="px-5 py-2 bg-slate-50/70">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">{group.label}</p>
                </div>
                {group.keys.map(key => {
                  const score   = data.scores[key] as string | undefined;
                  const reason  = data.reasoning[key];
                  const weight  = Math.round((CALL_WEIGHTS[key] || 0) * 100);
                  const isOpen  = expandedParam === key;
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

      <div className="flex justify-center pt-2">
        <button
          onClick={onReset}
          className="px-6 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-sm transition-colors"
        >
          🔄 Analyze another call
        </button>
      </div>
    </div>
  );
}

// ── Progress indicator ────────────────────────────────────────────────────────

function ProgressStep({ n, label, sub, done, active }: {
  n: number; label: string; sub: string; done: boolean; active: boolean;
}) {
  return (
    <div className={`flex items-start gap-3 p-4 rounded-xl transition-all ${
      active ? 'bg-amber-50 border border-amber-200' : done ? 'bg-emerald-50 border border-emerald-100' : 'bg-slate-50 border border-slate-100 opacity-50'
    }`}>
      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${
        done ? 'bg-emerald-500 text-white' : active ? 'bg-amber-500 text-white animate-pulse' : 'bg-slate-200 text-slate-400'
      }`}>
        {done ? '✓' : n}
      </div>
      <div>
        <p className="font-semibold text-sm text-slate-800">{label}</p>
        <p className="text-xs text-slate-500 mt-0.5">{sub}</p>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

type Stage = 'idle' | 'transcribing' | 'scoring' | 'done' | 'error';

export default function CallQualityTestClient() {
  const [callId, setCallId]   = useState('');
  const [chatId, setChatId]   = useState('');
  const [stage, setStage]     = useState<Stage>('idle');
  const [error, setError]     = useState('');
  const [result, setResult]   = useState<ResultData | null>(null);

  async function analyze() {
    if (!callId.trim()) return;
    setStage('transcribing');
    setError('');
    setResult(null);

    try {
      const transitionTimer = setTimeout(() => setStage('scoring'), 8000);

      const res = await fetch('/api/call-quality/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ call_id: callId.trim(), chat_id: chatId.trim() || undefined }),
      });
      clearTimeout(transitionTimer);

      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || `Server error ${res.status}`);
      }
      setResult(data as ResultData);
      setStage('done');
    } catch (e: any) {
      setError(e.message || 'Unknown error');
      setStage('error');
    }
  }

  if (stage === 'done' && result) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-6">
        <ResultPanel data={result} onReset={() => { setStage('idle'); setResult(null); setCallId(''); setChatId(''); }} />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-10">
      {/* Header */}
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-amber-100 text-3xl mb-4">📞</div>
        <h1 className="text-2xl font-bold text-slate-800">Call Quality — Test Mode</h1>
        <p className="text-slate-500 mt-1.5 text-sm">
          Enter a Call ID to fetch the recording from the database and run the full pipeline.<br />
          Nothing is saved to the database.
        </p>
      </div>

      {/* Input form */}
      {(stage === 'idle' || stage === 'error') && (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 space-y-5">
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">
              Call ID <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-300 transition font-mono"
              placeholder="robylon-voice-ticket-id"
              value={callId}
              onChange={e => setCallId(e.target.value)}
            />
            <p className="text-xs text-slate-400 mt-1">The call recording must already exist in call_recordings.</p>
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">
              Chat ID <span className="text-slate-400 text-xs font-normal">(optional — loads WhatsApp context)</span>
            </label>
            <input
              type="text"
              className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-300 transition font-mono"
              placeholder="conversation-id from Robylon"
              value={chatId}
              onChange={e => setChatId(e.target.value)}
            />
            <p className="text-xs text-slate-400 mt-1">If provided, the chat transcript is fetched from conversations and used as context during scoring.</p>
          </div>

          {stage === 'error' && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
              ❌ {error}
            </div>
          )}

          <button
            onClick={analyze}
            disabled={!callId.trim()}
            className="w-full py-3 rounded-xl bg-amber-500 hover:bg-amber-600 disabled:bg-slate-200 disabled:text-slate-400 text-white font-bold text-sm transition-colors"
          >
            🔍 Analyze Call
          </button>
        </div>
      )}

      {/* Progress */}
      {(stage === 'transcribing' || stage === 'scoring') && (
        <div className="space-y-3">
          <ProgressStep
            n={1}
            label="Transcribing audio"
            sub="Fetching recording and running Gemini speech-to-text with speaker detection"
            done={stage === 'scoring'}
            active={stage === 'transcribing'}
          />
          <ProgressStep
            n={2}
            label="Scoring call quality"
            sub="Evaluating all 12 IQS parameters across Technical, Process, Grammar & Extra Mile"
            done={false}
            active={stage === 'scoring'}
          />
          <p className="text-center text-xs text-slate-400 mt-4">
            This usually takes 15–45 seconds depending on call length.
          </p>
        </div>
      )}
    </div>
  );
}
