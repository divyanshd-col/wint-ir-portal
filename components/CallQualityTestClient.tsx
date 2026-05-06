'use client';

import { useState } from 'react';
import { CALL_PARAM_ORDER, CALL_PARAM_NAMES, CALL_WEIGHTS, type CallSegment } from '@/lib/call-quality';

type Phase = 'idle' | 'transcribing' | 'scoring' | 'done' | 'error';

interface Result {
  language: string;
  segments: CallSegment[];
  interruptionCount: number;
  deadAirCount: number;
  iqs: number;
  scores: Record<string, 'Yes' | 'No' | 'NA'>;
  reasoning: Record<string, string>;
  summary: string;
  transcriptionMs: number;
  scoringMs: number;
}

function ScoreBadge({ score }: { score: 'Yes' | 'No' | 'NA' }) {
  const cls =
    score === 'Yes' ? 'bg-emerald-100 text-emerald-700'
    : score === 'No' ? 'bg-red-100 text-red-700'
    : 'bg-gray-100 text-gray-500';
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${cls}`}>
      {score}
    </span>
  );
}

function IqsBadge({ iqs }: { iqs: number }) {
  const cls =
    iqs >= 85 ? 'bg-emerald-100 text-emerald-700'
    : iqs >= 70 ? 'bg-amber-100 text-amber-700'
    : 'bg-red-100 text-red-700';
  return (
    <span className={`inline-block px-3 py-1 rounded-full text-lg font-bold ${cls}`}>
      {iqs}
    </span>
  );
}

function ProgressStep({ step, label, sub, active, done }: {
  step: number; label: string; sub: string; active: boolean; done: boolean;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 mt-0.5
        ${done ? 'bg-emerald-500 text-white' : active ? 'bg-blue-500 text-white animate-pulse' : 'bg-gray-200 text-gray-400'}`}>
        {done ? '✓' : step}
      </div>
      <div>
        <p className={`text-sm font-medium ${active ? 'text-gray-900' : done ? 'text-emerald-700' : 'text-gray-400'}`}>
          {label}
        </p>
        <p className="text-xs text-gray-400">{sub}</p>
      </div>
    </div>
  );
}

function TranscriptPanel({ segments }: { segments: CallSegment[] }) {
  return (
    <div className="overflow-y-auto max-h-[600px] space-y-2 pr-1">
      {segments.map((seg, i) => {
        if (seg.event_type === 'interruption') {
          return (
            <div key={i} className="flex items-center gap-2 text-xs text-amber-600 py-0.5">
              <span>⚡</span>
              <span className="italic">{seg.speaker.replace('_', ' ')} cut off — interrupted</span>
            </div>
          );
        }
        if (seg.event_type === 'dead_air') {
          const dur = seg.end - seg.start;
          return (
            <div key={i} className="flex items-center gap-2 text-xs text-gray-400 py-0.5">
              <span>⏸</span>
              <span className="italic">Dead air ~{dur.toFixed(0)}s — resumed by {seg.speaker.replace('_', ' ')}</span>
            </div>
          );
        }
        const isExec = seg.speaker === 'IR_EXECUTIVE';
        return (
          <div key={i} className="flex gap-2 items-start">
            <span
              className={`mt-0.5 w-3 h-3 rounded-full flex-shrink-0 ${isExec ? 'bg-amber-400' : 'bg-emerald-400'}`}
              title={seg.speaker.replace('_', ' ')}
            />
            <div className="min-w-0">
              <p className={`text-[10px] font-semibold mb-0.5 ${isExec ? 'text-amber-600' : 'text-emerald-600'}`}>
                {seg.speaker.replace('_', ' ')}
                {seg.translated && <span className="ml-1 text-blue-400">🌐</span>}
              </p>
              <p className="text-sm text-gray-700 leading-relaxed">{seg.text}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ScoresPanel({ scores, reasoning, iqs }: {
  scores: Record<string, 'Yes' | 'No' | 'NA'>;
  reasoning: Record<string, string>;
  iqs: number;
}) {
  const [expandedParam, setExpandedParam] = useState<string | null>(null);

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <span className="text-sm font-medium text-gray-500">IQS Score</span>
        <IqsBadge iqs={iqs} />
      </div>
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b border-gray-100">
            <th className="text-left text-xs text-gray-400 font-medium py-1.5 pr-2">Parameter</th>
            <th className="text-center text-xs text-gray-400 font-medium py-1.5 px-2">Score</th>
            <th className="text-right text-xs text-gray-400 font-medium py-1.5 pl-2">Wt</th>
          </tr>
        </thead>
        <tbody>
          {CALL_PARAM_ORDER.map(param => (
            <>
              <tr
                key={param}
                className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer"
                onClick={() => setExpandedParam(expandedParam === param ? null : param)}
              >
                <td className="py-1.5 pr-2 text-gray-700">{CALL_PARAM_NAMES[param]}</td>
                <td className="py-1.5 px-2 text-center">
                  <ScoreBadge score={scores[param] ?? 'NA'} />
                </td>
                <td className="py-1.5 pl-2 text-right text-xs text-gray-400">
                  {Math.round(CALL_WEIGHTS[param] * 100)}%
                </td>
              </tr>
              {expandedParam === param && reasoning[param] && (
                <tr key={`${param}-reason`} className="bg-blue-50">
                  <td colSpan={3} className="px-2 py-2 text-xs text-gray-600 italic">
                    {reasoning[param]}
                  </td>
                </tr>
              )}
            </>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-gray-400">Click a row to see reasoning.</p>
    </div>
  );
}

export default function CallQualityTestClient() {
  const [phase, setPhase]             = useState<Phase>('idle');
  const [recordingUrl, setRecordingUrl] = useState('');
  const [chatTranscript, setChatTranscript] = useState('');
  const [result, setResult]           = useState<Result | null>(null);
  const [error, setError]             = useState('');

  async function handleAnalyze() {
    if (!recordingUrl.trim()) return;
    setPhase('transcribing');
    setError('');
    setResult(null);

    // Visual: switch to scoring label after a few seconds (pipeline is server-side)
    const scoringTimer = setTimeout(() => setPhase('scoring'), 8_000);

    try {
      const res = await fetch('/api/call-quality/test', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          recording_url:   recordingUrl.trim(),
          chat_transcript: chatTranscript.trim(),
        }),
      });

      clearTimeout(scoringTimer);

      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error ?? 'Analysis failed');
        setPhase('error');
        return;
      }

      setResult(data);
      setPhase('done');
    } catch (err: any) {
      clearTimeout(scoringTimer);
      setError(err.message ?? 'Network error');
      setPhase('error');
    }
  }

  function handleReset() {
    setPhase('idle');
    setResult(null);
    setError('');
  }

  const isRunning = phase === 'transcribing' || phase === 'scoring';

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Call Quality — Test Mode</h1>
          <p className="text-sm text-gray-500 mt-1">
            Paste a recording URL to transcribe and score a call. No data is saved.
          </p>
        </div>

        {/* Input form */}
        {(phase === 'idle' || phase === 'error') && (
          <div className="bg-white rounded-2xl border border-gray-200 p-6 mb-6 shadow-sm">
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Recording URL
              </label>
              <input
                type="url"
                value={recordingUrl}
                onChange={e => setRecordingUrl(e.target.value)}
                placeholder="https://…/recording.mp3"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>
            <div className="mb-5">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                WhatsApp Chat Context{' '}
                <span className="text-gray-400 font-normal">(optional — paste transcript)</span>
              </label>
              <textarea
                value={chatTranscript}
                onChange={e => setChatTranscript(e.target.value)}
                rows={5}
                placeholder="Agent: Hi, I'm Priya from Wint Wealth…&#10;Customer: I have a question about my payout…"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 resize-y"
              />
            </div>
            {phase === 'error' && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                {error}
              </div>
            )}
            <button
              onClick={handleAnalyze}
              disabled={!recordingUrl.trim()}
              className="px-5 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Analyze Call
            </button>
          </div>
        )}

        {/* Progress */}
        {isRunning && (
          <div className="bg-white rounded-2xl border border-gray-200 p-6 mb-6 shadow-sm space-y-4">
            <ProgressStep
              step={1}
              label="Transcribing audio…"
              sub="Fetching recording and running Gemini transcription"
              active={phase === 'transcribing'}
              done={phase === 'scoring'}
            />
            <ProgressStep
              step={2}
              label="Scoring call quality…"
              sub="Running IQS evaluation across 12 parameters"
              active={phase === 'scoring'}
              done={false}
            />
          </div>
        )}

        {/* Results */}
        {phase === 'done' && result && (
          <div>
            {/* Summary bar */}
            <div className="bg-white rounded-2xl border border-gray-200 p-4 mb-4 shadow-sm flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="text-green-500 text-lg">✓</span>
                <span className="text-sm font-medium text-gray-700">Analysis complete</span>
              </div>
              <div className="text-sm text-gray-500">
                Language: <span className="font-medium text-gray-800">{result.language}</span>
              </div>
              <div className="flex items-center gap-1 text-sm text-gray-500">
                IQS: <IqsBadge iqs={result.iqs} />
              </div>
              {result.interruptionCount > 0 && (
                <span className="text-sm text-amber-600">⚡ {result.interruptionCount} interruption{result.interruptionCount !== 1 ? 's' : ''}</span>
              )}
              {result.deadAirCount > 0 && (
                <span className="text-sm text-gray-400">⏸ {result.deadAirCount} dead air</span>
              )}
              <div className="ml-auto text-xs text-gray-400">
                Transcription: {(result.transcriptionMs / 1000).toFixed(1)}s &nbsp;|&nbsp;
                Scoring: {(result.scoringMs / 1000).toFixed(1)}s
              </div>
            </div>

            {/* Summary text */}
            {result.summary && (
              <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 mb-4 text-sm text-gray-700 leading-relaxed">
                {result.summary}
              </div>
            )}

            {/* Two-column: transcript + scores */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
              <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm">
                <h2 className="text-sm font-semibold text-gray-700 mb-3">Call Transcript</h2>
                {result.segments.length > 0
                  ? <TranscriptPanel segments={result.segments} />
                  : <p className="text-sm text-gray-400 italic">No transcript segments returned.</p>
                }
              </div>
              <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm">
                <h2 className="text-sm font-semibold text-gray-700 mb-3">Call IQS Scores</h2>
                <ScoresPanel scores={result.scores} reasoning={result.reasoning} iqs={result.iqs} />
              </div>
            </div>

            <button
              onClick={handleReset}
              className="px-5 py-2.5 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200 transition-colors"
            >
              Analyze another call
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
