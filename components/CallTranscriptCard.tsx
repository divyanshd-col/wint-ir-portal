'use client';

import { useState } from 'react';

function formatTs(ts?: string): string {
  if (!ts) return '';
  const parts = ts.split(':');
  if (parts.length === 2) {
    const mins = parts[0];
    const secs = parts[1].padStart(2, '0');
    return `${mins}:${secs}`;
  }
  return ts;
}

export interface CallTranscriptRec {
  id: string;
  label: string;
  calledAt: string | null;
  durationSeconds: number | null;
  recordingUrl?: string | null;
  segments: any[];
  interruptionCount: number;
  deadAirCount: number;
}

export function CallTranscriptCard({
  rec, index, defaultOpen,
}: {
  rec: CallTranscriptRec;
  index: number;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen ?? index === 0);

  const callDate = rec.calledAt
    ? new Date(rec.calledAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true })
    : null;

  const speechSegs = rec.segments.filter((s: any) => s.type === 'speech');

  return (
    <div className="bg-white rounded-2xl border border-amber-100 shadow-sm overflow-hidden">
      {/* Header */}
      <button
        className="w-full px-5 py-3 flex items-center gap-3 bg-amber-50/60 hover:bg-amber-50 transition text-left"
        onClick={() => setOpen(o => !o)}
      >
        <span className="text-amber-600 font-bold text-sm">📞 {rec.label}</span>
        {callDate && <span className="text-xs text-slate-500">{callDate}</span>}
        {Boolean(rec.durationSeconds) && (
          <span className="text-xs text-slate-400">{Math.round(rec.durationSeconds! / 60)}m {rec.durationSeconds! % 60}s</span>
        )}
        <div className="flex items-center gap-2.5 ml-auto text-[10px] text-slate-500">
          {rec.id && (
            <a
              href={`/quality/call-evaluation?callId=${encodeURIComponent(rec.id)}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold bg-amber-100 hover:bg-amber-200 text-amber-900 border border-amber-300/80 transition-colors shrink-0 ml-1 shadow-2xs cursor-pointer"
              title="Open call evaluation in new tab"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                <polyline points="15 3 21 3 21 9"></polyline>
                <line x1="10" y1="14" x2="21" y2="3"></line>
              </svg>
              Show Evaluation
            </a>
          )}
        </div>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" className={`shrink-0 ml-1 transition-transform ${open ? 'rotate-180' : ''}`}><path d="M1 3l4 4 4-4"/></svg>
      </button>

      {open && (
        <div>
          {rec.recordingUrl && (
            <div className="px-5 py-3.5 bg-slate-50 border-b border-slate-100 flex flex-col gap-1.5">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Audio Recording</span>
              <audio
                src={rec.recordingUrl ? `/api/quality/audio-proxy?url=${encodeURIComponent(rec.recordingUrl)}` : undefined}
                controls
                className="w-full h-9 rounded-lg"
              />
            </div>
          )}
          {/* Start marker */}
          <div className="flex items-center gap-3 px-4 py-2">
            <div className="flex-1 h-px bg-amber-200" />
            <span className="text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-3 py-0.5 rounded-full whitespace-nowrap">
              📞 {rec.label} started{callDate ? ` · ${callDate}` : ''}
            </span>
            <div className="flex-1 h-px bg-amber-200" />
          </div>

          {/* Transcript Message Bubbles */}
          <div className="px-5 py-4 space-y-4 max-h-[480px] overflow-y-auto bg-slate-50/30">
            {rec.segments.map((seg: any, i: number) => {
              if (seg.type === 'interruption') {
                return (
                  <div key={i} className="flex justify-center my-2">
                    <span className="text-[11px] text-red-500 bg-red-50 border border-red-100 rounded-full px-3 py-1 font-sans italic text-center">
                      ⚡ <strong>{seg.interrupted_speaker}</strong> interrupted by <strong>{seg.interrupted_by}</strong>{seg.words_spoken != null ? ` — ${seg.words_spoken} words` : ''}
                    </span>
                  </div>
                );
              }

              if (seg.type === 'dead_air') {
                return (
                  <div key={i} className="flex justify-center my-2">
                    <span className="text-[11px] text-slate-400 bg-slate-100 border border-slate-200 rounded-full px-3 py-1 font-sans italic text-center">
                      ⏸ Dead air — {seg.duration || ''}{seg.resumed_by ? ` — resumed by ${seg.resumed_by}` : ''}
                    </span>
                  </div>
                );
              }

              if (seg.type === 'poor_listening') {
                return (
                  <div key={i} className="flex justify-center my-2">
                    <span className="text-[11px] text-orange-600 bg-orange-50 border border-orange-100 rounded-full px-3 py-1 font-sans italic text-center">
                      👂 Poor listening{seg.phrase ? `: "${seg.phrase}"` : ''}
                    </span>
                  </div>
                );
              }

              const textContent = (seg.text || seg.translation || '').trim();
              if (!textContent) return null;

              const isIR = seg.speaker === 'IR EXECUTIVE';
              const timeOffset = formatTs(seg.ts);

              if (!isIR) {
                // Customer / Investor bubble -> LEFT
                return (
                  <div key={i} className="flex gap-2">
                    <div className="w-6 h-6 rounded-full bg-slate-200 flex items-center justify-center shrink-0 mt-1">
                      <span className="text-[9px] font-bold text-slate-500">I</span>
                    </div>
                    <div className="max-w-[78%]">
                      <p className="text-[9px] font-semibold text-slate-400 mb-0.5">
                        Investor{timeOffset && ` · ${timeOffset}`}
                      </p>
                      <div className="bg-white border border-slate-150 text-slate-800 px-3.5 py-2 rounded-2xl rounded-tl-sm text-[12.5px] leading-relaxed font-sans shadow-sm">
                        {seg.text}
                        {seg.translated && (
                          <span className="ml-2 inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] font-semibold bg-blue-50 text-blue-500 border border-blue-100">
                            🌐 translated
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              }

              // IR Executive bubble -> RIGHT
              return (
                <div key={i} className="flex justify-end gap-2">
                  <div className="max-w-[78%]">
                    <p className="text-[9px] font-semibold text-slate-500 text-right mb-0.5 pr-1">
                      IR Executive{timeOffset && ` · ${timeOffset}`}
                    </p>
                    <div className="bg-[#2d3139] dark:bg-[var(--qa-gray-700)] text-white px-3.5 py-2 rounded-2xl rounded-tr-sm text-[12.5px] leading-relaxed font-sans shadow-sm">
                      {seg.text}
                      {seg.translated && (
                        <span className="ml-2 inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] font-semibold bg-white/10 text-white/90 border border-white/10">
                          🌐 translated
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* End marker */}
          <div className="flex items-center gap-3 px-4 py-2 border-t border-slate-100 bg-slate-50/50">
            <div className="flex-1 h-px bg-slate-200" />
            <span className="text-[10px] font-bold text-slate-500 bg-slate-50 border border-slate-200 px-3 py-0.5 rounded-full whitespace-nowrap">
              📞 {rec.label} ended
            </span>
            <div className="flex-1 h-px bg-slate-200" />
          </div>
        </div>
      )}
    </div>
  );
}
