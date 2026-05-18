'use client';

import { useState } from 'react';
import {
  CALL_PARAM_NAMES, CALL_PARAM_GROUPS, CALL_WEIGHTS,
} from '@/lib/call-quality';
import { PARAM_NAMES, PARAM_ORDER, WEIGHTS } from '@/lib/quality';

// ── Helpers ───────────────────────────────────────────────────────────────────

function iqsTheme(iqs: number | null) {
  if (iqs === null) return { text: '#94a3b8', bg: '#f1f5f9', bar: '#cbd5e1', label: '—' };
  if (iqs >= 90) return { text: '#15803d', bg: '#dcfce7', bar: '#22c55e', label: 'Excellent' };
  if (iqs >= 80) return { text: '#92400e', bg: '#fef3c7', bar: '#f59e0b', label: 'Good' };
  if (iqs >= 70) return { text: '#c2410c', bg: '#ffedd5', bar: '#f97316', label: 'Average' };
  return { text: '#b91c1c', bg: '#fee2e2', bar: '#ef4444', label: 'Needs Work' };
}

function IQSCircle({ iqs, label }: { iqs: number | null; label: string }) {
  const t = iqsTheme(iqs);
  return (
    <div className="flex flex-col items-center gap-1">
      <div
        className="w-16 h-16 rounded-full flex items-center justify-center text-xl font-black tabular-nums"
        style={{ background: t.bg, color: t.text }}
      >
        {iqs ?? '—'}
      </div>
      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">{label}</p>
      <p className="text-xs font-semibold" style={{ color: t.text }}>{t.label}</p>
    </div>
  );
}

function ScoreBadge({ score }: { score?: string }) {
  if (score === 'Yes') return <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700">Yes</span>;
  if (score === 'No')  return <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-50 text-red-600">No</span>;
  return                      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-500">NA</span>;
}

// ── Parameter panel (shared for chat + call) ──────────────────────────────────

function ParamPanel({
  title,
  groups,
  paramNames,
  weights,
  scores,
  reasoning,
}: {
  title: string;
  groups: Record<string, { label: string; keys: string[] }>;
  paramNames: Record<string, string>;
  weights: Record<string, number>;
  scores: Record<string, string>;
  reasoning: Record<string, string>;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden flex flex-col">
      <div className="px-5 py-3 border-b border-slate-100 bg-slate-50">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{title}</p>
      </div>
      <div className="overflow-y-auto flex-1 divide-y divide-slate-50">
        {Object.entries(groups).map(([gk, group]) => (
          <div key={gk}>
            <div className="px-5 py-1.5 bg-slate-50/60">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">{group.label}</p>
            </div>
            {group.keys.map(key => {
              const score  = scores[key];
              const reason = reasoning[key];
              const weight = Math.round((weights[key] || 0) * 100);
              const isOpen = expanded === key;
              return (
                <div key={key} className="px-4 py-2">
                  <button
                    className="w-full flex items-center justify-between gap-2 text-left"
                    onClick={() => setExpanded(isOpen ? null : key)}
                  >
                    <span className="text-xs text-slate-700 font-medium flex-1">{paramNames[key] || key}</span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-[10px] text-slate-400">{weight}%</span>
                      <ScoreBadge score={score} />
                      {reason && <span className="text-slate-300 text-[10px]">{isOpen ? '▲' : '▼'}</span>}
                    </div>
                  </button>
                  {isOpen && reason && (
                    <p className="mt-1 text-[11px] text-slate-500 leading-relaxed pl-1">{reason}</p>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Merged timeline item ──────────────────────────────────────────────────────

function TimelineItem({ item }: { item: { source: 'call' | 'chat'; ts?: string; data: any } }) {
  const { source, data } = item;

  if (source === 'call') {
    // Call segment
    if (data.type === 'interruption') {
      return (
        <div className="flex gap-3 items-start">
          <div className="w-12 shrink-0 text-right">
            <span className="text-[9px] font-bold text-amber-500 bg-amber-50 px-1.5 py-0.5 rounded">CALL</span>
          </div>
          <div className="flex-1 flex items-center gap-2 px-3 py-1.5 rounded bg-red-50 border border-red-100">
            <span className="text-red-500">⚡</span>
            <span className="text-xs text-red-700">
              <strong>{data.interrupted_speaker}</strong> interrupted by <strong>{data.interrupted_by}</strong>
              {data.words_spoken != null ? ` — ${data.words_spoken} words` : ''}
            </span>
          </div>
        </div>
      );
    }
    if (data.type === 'dead_air') {
      return (
        <div className="flex gap-3 items-start">
          <div className="w-12 shrink-0 text-right">
            <span className="text-[9px] font-bold text-amber-500 bg-amber-50 px-1.5 py-0.5 rounded">CALL</span>
          </div>
          <div className="flex-1 flex items-center gap-2 px-3 py-1.5 rounded bg-slate-50 border border-slate-200">
            <span className="text-slate-400">⏸</span>
            <span className="text-xs text-slate-500">
              Dead air{data.duration ? ` — ${data.duration}` : ''}{data.resumed_by ? ` — resumed by ${data.resumed_by}` : ''}
            </span>
          </div>
        </div>
      );
    }
    if (data.type === 'poor_listening') {
      return (
        <div className="flex gap-3 items-start">
          <div className="w-12 shrink-0 text-right">
            <span className="text-[9px] font-bold text-amber-500 bg-amber-50 px-1.5 py-0.5 rounded">CALL</span>
          </div>
          <div className="flex-1 flex items-center gap-2 px-3 py-1.5 rounded bg-orange-50 border border-orange-100">
            <span>👂</span>
            <span className="text-xs text-orange-700">Poor listening{data.phrase ? `: "${data.phrase}"` : ''}</span>
          </div>
        </div>
      );
    }
    const isIR = data.speaker === 'IR EXECUTIVE';
    return (
      <div className="flex gap-3 items-start">
        <div className="w-12 shrink-0 text-right pt-1">
          <span className="text-[9px] font-bold text-amber-500 bg-amber-50 px-1.5 py-0.5 rounded">CALL</span>
        </div>
        <div className="flex-1">
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold mb-1 ${
            isIR ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'
          }`}>
            {isIR ? '🟡' : '🟢'} {data.speaker}
          </span>
          <p className="text-sm text-slate-700 leading-relaxed">
            {data.translated && data.translation ? data.translation : data.text}
            {data.translated && (
              <span className="ml-1.5 px-1 py-0.5 rounded text-[9px] font-bold bg-blue-50 text-blue-500">🌐</span>
            )}
          </p>
        </div>
      </div>
    );
  }

  // Chat message
  const role = data.sender_type === 'customer' ? 'customer'
             : data.sender_type === 'bot'      ? 'bot'
             : 'agent';
  const content = (data.content || '').trim();
  if (!content) return null;

  return (
    <div className="flex gap-3 items-start">
      <div className="w-12 shrink-0 text-right pt-1">
        <span className="text-[9px] font-bold text-blue-500 bg-blue-50 px-1.5 py-0.5 rounded">CHAT</span>
      </div>
      <div className="flex-1">
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold mb-1 ${
          role === 'customer' ? 'bg-emerald-50 text-emerald-700'
          : role === 'bot'   ? 'bg-purple-50 text-purple-600'
          :                    'bg-slate-100 text-slate-600'
        }`}>
          {role === 'customer' ? '🟢 Customer' : role === 'bot' ? '🤖 Bot' : '🔵 Agent'}
        </span>
        <p className="text-sm text-slate-700 leading-relaxed">{content}</p>
      </div>
    </div>
  );
}

// ── Progress step ─────────────────────────────────────────────────────────────

function ProgressStep({ n, label, sub, done, active }: {
  n: number; label: string; sub: string; done: boolean; active: boolean;
}) {
  return (
    <div className={`flex items-start gap-3 p-3 rounded-xl transition-all ${
      active ? 'bg-amber-50 border border-amber-200'
      : done  ? 'bg-emerald-50 border border-emerald-100'
      :         'bg-slate-50 border border-slate-100 opacity-50'
    }`}>
      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${
        done ? 'bg-emerald-500 text-white'
        : active ? 'bg-amber-500 text-white animate-pulse'
        : 'bg-slate-200 text-slate-400'
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

// ── Chat param groups (derived from PARAM_ORDER) ──────────────────────────────

const CHAT_PARAM_GROUPS: Record<string, { label: string; keys: string[] }> = {
  all: { label: 'Chat IQS Parameters', keys: PARAM_ORDER },
};

// ── Main component ────────────────────────────────────────────────────────────

type Stage = 'idle' | 'running' | 'done' | 'error';

export default function UnifiedScoringClient() {
  const [chatId, setChatId]           = useState('');
  const [stage, setStage]             = useState<Stage>('idle');
  const [step, setStep]               = useState(0);
  const [error, setError]             = useState('');
  const [result, setResult]           = useState<any | null>(null);
  const [timelineView, setTimelineView] = useState<'merged' | 'call' | 'chat'>('merged');

  async function run() {
    if (!chatId.trim()) return;
    setStage('running');
    setStep(1);
    setError('');
    setResult(null);

    const t1 = setTimeout(() => setStep(2), 8_000);
    const t2 = setTimeout(() => setStep(3), 20_000);

    try {
      const res = await fetch('/api/call-quality/unified-score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId.trim() }),
      });
      [t1, t2].forEach(clearTimeout);

      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || `Server error ${res.status}`);
      setResult(data);
      setStage('done');
    } catch (e: any) {
      [t1, t2].forEach(clearTimeout);
      setError(e.message || 'Unknown error');
      setStage('error');
    }
  }

  function reset() {
    setStage('idle');
    setStep(0);
    setResult(null);
    setChatId('');
  }

  // ── Results view ────────────────────────────────────────────────────────────

  if (stage === 'done' && result) {
    const chatIqs = result.chatIqs;
    const callIqs = result.callIqs;
    const ct = iqsTheme(chatIqs);
    const kt = iqsTheme(callIqs);

    const mergedItems = (result.mergedTimeline || []).filter((item: any) =>
      item.source === 'call' || (item.data?.content || '').trim()
    );

    const chatMessages = mergedItems.filter((i: any) => i.source === 'chat');
    const callSegs = result.callSegments || [];

    return (
      <div className="space-y-4">
        {/* Score summary */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
          <div className="flex flex-wrap items-center gap-6">
            <IQSCircle iqs={chatIqs} label="Chat IQS" />
            <div className="text-slate-200 text-3xl font-thin">|</div>
            <IQSCircle iqs={callIqs} label="Call IQS" />
            <div className="flex-1 min-w-0 space-y-1">
              <p className="text-sm font-semibold text-slate-800">Unified Quality Score</p>
              {!result.hasCallRecording && (
                <p className="text-xs text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-2 py-1">
                  No call recording found for this chat — only chat was scored.
                </p>
              )}
              {result.chatSummary && <p className="text-xs text-slate-500"><span className="font-medium text-slate-600">Chat:</span> {result.chatSummary}</p>}
              {result.callSummary && <p className="text-xs text-slate-500"><span className="font-medium text-slate-600">Call:</span> {result.callSummary}</p>}
            </div>
            <div className="flex flex-wrap gap-3 text-xs text-slate-500 shrink-0">
              {result.language && <span>🌐 {result.language}</span>}
              {result.hasCallRecording && <span>⚡ {result.interruptionCount}</span>}
              {result.hasCallRecording && <span>⏸ {result.deadAirCount}</span>}
              {result.callRecordingCount > 1 && (
                <span className="text-blue-500 font-medium">📞 {result.callRecordingCount} calls merged</span>
              )}
              {result.callDisposition && <span className="text-slate-400">📞 {result.callDisposition}</span>}
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-slate-100 flex flex-wrap gap-4 text-xs text-slate-400">
            <span>Chat ID: <span className="font-mono text-slate-600">{result.chat_id}</span></span>
            <span className="ml-auto">
              Scored {(result.scoringMs / 1000).toFixed(1)}s · Total {(result.totalMs / 1000).toFixed(1)}s
            </span>
          </div>
        </div>

        {/* Timeline + Params */}
        <div className="grid grid-cols-1 xl:grid-cols-[1fr_300px_300px] gap-4">
          {/* Timeline */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden flex flex-col">
            <div className="px-5 py-3 border-b border-slate-100 bg-slate-50 flex items-center gap-3">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide flex-1">Timeline</p>
              <div className="flex rounded-lg overflow-hidden border border-slate-200 text-[10px] font-semibold">
                {(['merged', 'call', 'chat'] as const).map(v => (
                  <button
                    key={v}
                    onClick={() => setTimelineView(v)}
                    className={`px-2.5 py-1 capitalize transition-colors ${
                      timelineView === v ? 'bg-amber-500 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'
                    }`}
                  >{v}</button>
                ))}
              </div>
            </div>
            <div className="overflow-y-auto max-h-[560px] p-4 space-y-3">
              {timelineView === 'merged' && mergedItems.map((item: any, i: number) => (
                <TimelineItem key={i} item={item} />
              ))}
              {timelineView === 'call' && callSegs.map((seg: any, i: number) => (
                <TimelineItem key={i} item={{ source: 'call', data: seg }} />
              ))}
              {timelineView === 'chat' && chatMessages.map((item: any, i: number) => (
                <TimelineItem key={i} item={item} />
              ))}
              {(timelineView === 'merged' ? mergedItems : timelineView === 'call' ? callSegs : chatMessages).length === 0 && (
                <p className="text-sm text-slate-400 text-center py-8">No data for this view.</p>
              )}
            </div>
          </div>

          {/* Chat params */}
          <ParamPanel
            title="Chat IQS"
            groups={CHAT_PARAM_GROUPS}
            paramNames={PARAM_NAMES}
            weights={WEIGHTS}
            scores={result.chatScores || {}}
            reasoning={result.chatReasoning || {}}
          />

          {/* Call params */}
          <ParamPanel
            title="Call IQS"
            groups={CALL_PARAM_GROUPS}
            paramNames={CALL_PARAM_NAMES}
            weights={CALL_WEIGHTS}
            scores={result.callScores || {}}
            reasoning={result.callReasoning || {}}
          />
        </div>

        <div className="flex justify-center pt-2">
          <button
            onClick={reset}
            className="px-6 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-sm transition-colors"
          >
            🔄 Score another
          </button>
        </div>
      </div>
    );
  }

  // ── Input / Progress view ────────────────────────────────────────────────────

  return (
    <div className="max-w-xl mx-auto px-4 py-8">
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-violet-100 text-3xl mb-4">⚡</div>
        <h1 className="text-2xl font-bold text-slate-800">Unified Quality Score</h1>
        <p className="text-slate-500 mt-1.5 text-sm">
          Enter a Chat ID to score both the WhatsApp chat and any linked call recording.<br />
          Transcripts are fetched from DB — no audio URL needed.
        </p>
      </div>

      {(stage === 'idle' || stage === 'error') && (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 space-y-5">
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">
              Chat ID <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300 transition font-mono"
              placeholder="e.g. 40502"
              value={chatId}
              onChange={e => setChatId(e.target.value)}
            />
            <p className="text-xs text-slate-400 mt-1">WhatsApp conversation ID — fetches chat transcript and any linked call recording from DB.</p>
          </div>

          {stage === 'error' && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
              ❌ {error}
            </div>
          )}

          <button
            onClick={run}
            disabled={!chatId.trim()}
            className="w-full py-3 rounded-xl bg-violet-600 hover:bg-violet-700 disabled:bg-slate-200 disabled:text-slate-400 text-white font-bold text-sm transition-colors"
          >
            ⚡ Run Unified Scoring
          </button>

          <p className="text-xs text-slate-400 text-center">
            KB retrieval + dual scoring usually takes 30–60 seconds.
          </p>
        </div>
      )}

      {stage === 'running' && (
        <div className="space-y-3">
          <ProgressStep n={1} label="Fetching transcripts" sub="Loading chat + call recordings from database" done={step > 1} active={step === 1} />
          <ProgressStep n={2} label="Retrieving KB chunks" sub="Finding relevant knowledge base sections for both transcripts" done={step > 2} active={step === 2} />
          <ProgressStep n={3} label="Scoring chat + call" sub="Running IQS evaluation for both in parallel" done={false} active={step === 3} />
          <p className="text-center text-xs text-slate-400 mt-4">This usually takes 30–60 seconds.</p>
        </div>
      )}
    </div>
  );
}
