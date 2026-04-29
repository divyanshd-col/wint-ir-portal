'use client';

import { useRef, useState } from 'react';
import PageNav from '@/components/PageNav';
import type { CallAnalysisResult } from '@/lib/call-analyzer';

interface Props {
  username: string;
  role: string;
  isAdmin: boolean;
}

type Phase = 'idle' | 'uploading' | 'pass1' | 'pass2' | 'done' | 'error';

const SENTIMENT_COLOR: Record<string, string> = {
  positive: 'text-emerald-600',
  neutral:  'text-gray-500',
  negative: 'text-red-500',
};

const CONFIDENCE_COLOR = (v: number) =>
  v >= 7 ? 'text-emerald-600' : v >= 4 ? 'text-amber-500' : 'text-red-500';

function ScorePill({ label, value, invert = false }: { label: string; value: number | null; invert?: boolean }) {
  if (value === null) return <span className="text-gray-300 text-xs">—</span>;
  const color = invert
    ? value <= 3 ? 'bg-emerald-100 text-emerald-700' : value <= 6 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'
    : value >= 7 ? 'bg-emerald-100 text-emerald-700' : value >= 4 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700';
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${color}`}>
      {label} {value}
    </span>
  );
}

function SummaryCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 px-4 py-3">
      <p className="text-xs text-gray-400 mb-0.5">{label}</p>
      <p className="text-xl font-bold text-gray-900">{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

export default function CallAnalysisClient({ username, role, isAdmin }: Props) {
  const [phase, setPhase]       = useState<Phase>('idle');
  const [logs, setLogs]         = useState<string[]>([]);
  const [result, setResult]     = useState<CallAnalysisResult | null>(null);
  const [error, setError]       = useState<string>('');
  const [dragOver, setDragOver] = useState(false);
  const [fileName, setFileName] = useState('');
  const [expandedSeg, setExpandedSeg] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const logRef  = useRef<HTMLDivElement>(null);

  const phaseLabel: Record<Phase, string> = {
    idle:       '',
    uploading:  'Uploading audio…',
    pass1:      'Pass 1 — Extracting structure…',
    pass2:      'Pass 2 — Transcribing & analysing…',
    done:       'Analysis complete',
    error:      'Analysis failed',
  };

  function addLog(msg: string) {
    setLogs(prev => [...prev, msg]);
    setTimeout(() => logRef.current?.scrollTo({ top: 9999, behavior: 'smooth' }), 50);
  }

  function inferPhase(msg: string): Phase {
    if (msg.includes('Uploading')) return 'uploading';
    if (msg.includes('Pass 1'))    return 'pass1';
    if (msg.includes('Pass 2') || msg.includes('Building')) return 'pass2';
    return phase;
  }

  async function handleFile(file: File) {
    setResult(null);
    setError('');
    setLogs([]);
    setFileName(file.name);
    setPhase('uploading');

    const form = new FormData();
    form.append('audio', file);

    try {
      const res = await fetch('/api/call-analysis', { method: 'POST', body: form });

      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => '');
        let msg = 'Request failed';
        try { msg = JSON.parse(text).error ?? msg; } catch {}
        setError(msg);
        setPhase('error');
        return;
      }

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer    = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const parts = buffer.split(/\n\n/);
        buffer = parts.pop() ?? '';

        for (const part of parts) {
          const eventMatch = part.match(/^event:\s*(.+)$/m);
          const dataMatch  = part.match(/^data:\s*([\s\S]+)$/);
          if (!eventMatch || !dataMatch) continue;

          const event = eventMatch[1].trim();
          const data  = JSON.parse(dataMatch[1].trim());

          if (event === 'progress') {
            addLog(data.message);
            setPhase(inferPhase(data.message));
          } else if (event === 'result') {
            setResult(data as CallAnalysisResult);
            setPhase('done');
          } else if (event === 'error') {
            setError(data.message ?? 'Unknown error');
            setPhase('error');
          }
        }
      }
    } catch (err: any) {
      setError(err?.message ?? 'Network error');
      setPhase('error');
    }
  }

  function onInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  }

  const running = phase === 'uploading' || phase === 'pass1' || phase === 'pass2';

  const execSpeaker = result
    ? Object.entries(result.speaker_map).find(([, r]) => r === 'IR_EXECUTIVE')?.[0]
    : null;

  return (
    <div className="flex h-screen bg-[#f5f3ee]">
      <PageNav username={username} role={role} isAdmin={isAdmin} />

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Header */}
        <div className="bg-white border-b border-gray-100 px-6 py-4 shrink-0">
          <h1 className="text-base font-semibold text-gray-900">Call Quality Analyser</h1>
          <p className="text-xs text-gray-400 mt-0.5">Two-pass Gemini analysis — structure extraction then transcription &amp; tone</p>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">

          {/* Upload zone */}
          <div
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => !running && fileRef.current?.click()}
            className={`border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-colors select-none
              ${dragOver ? 'border-emerald-400 bg-emerald-50' : 'border-gray-200 bg-white hover:border-gray-300'}
              ${running ? 'opacity-60 pointer-events-none' : ''}`}
          >
            <input ref={fileRef} type="file" accept=".mp3,.wav,.m4a,.ogg,.flac" className="hidden" onChange={onInputChange} />
            <svg className="mx-auto mb-3 text-gray-300" width="36" height="36" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 9l3-3m0 0l3 3m-3-3v12M5 20h14" />
            </svg>
            {fileName && !running ? (
              <p className="text-sm font-medium text-gray-700">{fileName}</p>
            ) : (
              <p className="text-sm text-gray-400">
                Drop an audio file here or <span className="text-emerald-600 font-medium">click to browse</span>
              </p>
            )}
            <p className="text-xs text-gray-300 mt-1">MP3 · WAV · M4A · OGG · FLAC · max 500 MB</p>
          </div>

          {/* Progress */}
          {(running || logs.length > 0) && (
            <div className="bg-white rounded-2xl border border-gray-100 p-5">
              <div className="flex items-center gap-2 mb-3">
                {running && (
                  <svg className="animate-spin text-emerald-500 shrink-0" width="16" height="16" fill="none" viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="31.4" strokeDashoffset="10" />
                  </svg>
                )}
                <span className="text-sm font-medium text-gray-700">{phaseLabel[phase]}</span>
              </div>

              {/* Pass indicators */}
              <div className="flex gap-3 mb-4">
                {(['uploading', 'pass1', 'pass2'] as Phase[]).map((p, i) => {
                  const labels = ['Upload', 'Pass 1 — Structure', 'Pass 2 — Analysis'];
                  const isDone = (phase === 'done') || (p === 'uploading' && ['pass1','pass2','done'].includes(phase)) || (p === 'pass1' && ['pass2','done'].includes(phase));
                  const isActive = phase === p;
                  return (
                    <div key={p} className="flex items-center gap-1.5">
                      <div className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold
                        ${isDone ? 'bg-emerald-500 text-white' : isActive ? 'bg-emerald-100 text-emerald-600 ring-2 ring-emerald-300' : 'bg-gray-100 text-gray-400'}`}>
                        {isDone ? '✓' : i + 1}
                      </div>
                      <span className={`text-xs ${isActive ? 'text-emerald-600 font-medium' : isDone ? 'text-gray-500' : 'text-gray-300'}`}>
                        {labels[i]}
                      </span>
                      {i < 2 && <span className="text-gray-200 text-xs mx-1">›</span>}
                    </div>
                  );
                })}
              </div>

              <div ref={logRef} className="bg-gray-50 rounded-lg p-3 max-h-32 overflow-y-auto font-mono text-xs text-gray-500 space-y-0.5">
                {logs.map((l, i) => <div key={i}>{l}</div>)}
                {running && <div className="text-emerald-500 animate-pulse">▌</div>}
              </div>
            </div>
          )}

          {/* Error */}
          {phase === 'error' && (
            <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-sm text-red-700">
              <span className="font-semibold">Analysis failed: </span>{error}
            </div>
          )}

          {/* Results */}
          {result && (
            <div className="space-y-5">

              {/* Call overview */}
              <div className="bg-white rounded-2xl border border-gray-100 p-5">
                <h2 className="text-sm font-semibold text-gray-900 mb-4">Call Overview</h2>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                  <SummaryCard label="Duration" value={`${Math.round(result.duration_seconds)}s`} sub={`${(result.duration_seconds / 60).toFixed(1)} min`} />
                  <SummaryCard label="Language" value={result.detected_language} />
                  <SummaryCard label="Segments" value={result.summary.total_segments} sub={`${result.summary.total_overlaps} interruptions`} />
                  <SummaryCard label="Overall Sentiment" value={result.summary.overall_sentiment.charAt(0).toUpperCase() + result.summary.overall_sentiment.slice(1)} />
                </div>

                {/* Speaker ID */}
                <div className="border-t border-gray-50 pt-4">
                  <div className="flex items-start gap-3">
                    <div className={`mt-0.5 px-2 py-0.5 rounded-full text-xs font-semibold
                      ${result.speaker_identification_confidence === 'high' ? 'bg-emerald-100 text-emerald-700' :
                        result.speaker_identification_confidence === 'medium' ? 'bg-amber-100 text-amber-700' :
                        'bg-red-100 text-red-700'}`}>
                      {result.speaker_identification_confidence.toUpperCase()} confidence
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">
                        <span className="font-medium text-gray-700">Speaker {execSpeaker}</span> identified as IR Executive
                        {result.speaker_identification_signal
                          ? <> — "<span className="italic">{result.speaker_identification_signal}</span>"</>
                          : ' (inferred from call behaviour)'}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Quality metrics */}
              <div className="bg-white rounded-2xl border border-gray-100 p-5">
                <h2 className="text-sm font-semibold text-gray-900 mb-4">Quality Metrics</h2>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <SummaryCard label="Exec Avg Confidence" value={`${result.summary.executive_avg_confidence}/10`} />
                  <SummaryCard label="Exec Avg Empathy" value={`${result.summary.executive_avg_empathy}/10`} />
                  <SummaryCard label="Exec Aggression" value={`${result.summary.executive_avg_aggression}/10`} />
                  <SummaryCard label="Investor Aggression" value={`${result.summary.investor_avg_aggression}/10`} />
                </div>
                {result.summary.dead_air_events > 0 && (
                  <div className="mt-3 flex items-center gap-2 text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
                    <svg width="14" height="14" fill="none" viewBox="0 0 16 16" stroke="currentColor" strokeWidth="1.5">
                      <path d="M8 2l5.5 11H2.5z"/>
                    </svg>
                    {result.summary.dead_air_events} dead air event{result.summary.dead_air_events > 1 ? 's' : ''} detected
                  </div>
                )}
              </div>

              {/* Transcript */}
              <div className="bg-white rounded-2xl border border-gray-100 p-5">
                <h2 className="text-sm font-semibold text-gray-900 mb-4">
                  Transcript
                  <span className="ml-2 text-xs font-normal text-gray-400">{result.segments.length} events</span>
                </h2>
                <div className="space-y-1">
                  {result.segments.map((seg, i) => {
                    if (seg.event_type === 'silence') {
                      return (
                        <div key={i} className="flex items-center gap-2 py-1.5 px-3 rounded-lg bg-gray-50">
                          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded
                            ${seg.silence_type === 'dead_air' ? 'bg-red-100 text-red-600' : 'bg-gray-200 text-gray-500'}`}>
                            {seg.silence_type === 'dead_air' ? 'DEAD AIR' : seg.silence_type === 'hold' ? 'HOLD' : 'PAUSE'}
                          </span>
                          <span className="text-xs text-gray-400">{seg.duration.toFixed(1)}s · {seg.start.toFixed(1)}s–{seg.end.toFixed(1)}s</span>
                        </div>
                      );
                    }
                    if (seg.event_type === 'overlap') {
                      return (
                        <div key={i} className="flex items-center gap-2 py-1.5 px-3 rounded-lg bg-amber-50">
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-200 text-amber-700">INTERRUPT</span>
                          <span className="text-xs text-amber-700">
                            {seg.interruption_by.replace('_', ' ')} interrupted {seg.speaker_interrupted.replace('_', ' ')}
                          </span>
                          <span className="text-xs text-amber-400 ml-auto">{seg.start.toFixed(1)}s</span>
                        </div>
                      );
                    }
                    // Turn segment
                    const isExec  = seg.speaker === 'IR_EXECUTIVE';
                    const expanded = expandedSeg === i;
                    return (
                      <div key={i}
                        onClick={() => setExpandedSeg(expanded ? null : i)}
                        className={`rounded-xl px-4 py-2.5 cursor-pointer transition-colors
                          ${isExec ? 'bg-blue-50 hover:bg-blue-100' : 'bg-gray-50 hover:bg-gray-100'}`}
                      >
                        <div className="flex items-start gap-3">
                          <div className={`shrink-0 mt-0.5 w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold
                            ${isExec ? 'bg-blue-500 text-white' : 'bg-gray-300 text-gray-700'}`}>
                            {isExec ? 'E' : 'I'}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-0.5">
                              <span className={`text-[10px] font-semibold ${isExec ? 'text-blue-600' : 'text-gray-500'}`}>
                                {seg.speaker.replace('_', ' ')}
                              </span>
                              <span className="text-[10px] text-gray-300">{seg.start.toFixed(1)}s</span>
                              {seg.translated && (
                                <span className="text-[10px] bg-purple-100 text-purple-600 px-1 rounded">translated</span>
                              )}
                            </div>
                            <p className={`text-sm text-gray-800 ${expanded ? '' : 'line-clamp-2'}`}>{seg.text}</p>
                          </div>
                          <div className="shrink-0 flex flex-wrap gap-1 items-start justify-end max-w-[160px]">
                            <span className={`text-xs font-medium ${SENTIMENT_COLOR[seg.sentiment]}`}>
                              {seg.sentiment}
                            </span>
                            {isExec && (
                              <>
                                <ScorePill label="conf" value={seg.confidence} />
                                <ScorePill label="emp" value={seg.empathy} />
                              </>
                            )}
                            <ScorePill label="agg" value={seg.aggression} invert />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Raw JSON */}
              <details className="bg-white rounded-2xl border border-gray-100 p-5">
                <summary className="text-sm font-semibold text-gray-900 cursor-pointer select-none">Raw JSON output</summary>
                <pre className="mt-3 text-xs text-gray-500 overflow-x-auto whitespace-pre-wrap bg-gray-50 rounded-lg p-3 max-h-96 overflow-y-auto">
                  {JSON.stringify(result, null, 2)}
                </pre>
              </details>

            </div>
          )}
        </div>
      </div>
    </div>
  );
}
