'use client';

import { useState } from 'react';

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
    ? new Date(rec.calledAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
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
        {rec.durationSeconds && <span className="text-xs text-slate-400">{Math.round(rec.durationSeconds / 60)}m {rec.durationSeconds % 60}s</span>}
        <div className="flex gap-2 ml-auto text-[10px] text-slate-500">
          {rec.interruptionCount > 0 && <span>⚡ {rec.interruptionCount}</span>}
          {rec.deadAirCount > 0 && <span>⏸ {rec.deadAirCount}</span>}
          <span className="text-slate-400">{speechSegs.length} turns</span>
        </div>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" className={`shrink-0 ml-1 transition-transform ${open ? 'rotate-180' : ''}`}><path d="M1 3l4 4 4-4"/></svg>
      </button>

      {open && (
        <div>
          {/* Start marker */}
          <div className="flex items-center gap-3 px-4 py-2">
            <div className="flex-1 h-px bg-amber-200" />
            <span className="text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-3 py-0.5 rounded-full whitespace-nowrap">
              📞 {rec.label} started{callDate ? ` · ${callDate}` : ''}
            </span>
            <div className="flex-1 h-px bg-amber-200" />
          </div>

          {/* Read-only transcript */}
          <div className="overflow-x-auto">
            <table className="w-full">
              <tbody>
                {rec.segments.map((seg: any, i: number) => {
                  if (seg.type === 'interruption') return (
                    <tr key={i}>
                      <td colSpan={2} className="px-4 py-1.5">
                        <div className="flex items-center gap-2 px-3 py-1.5 rounded bg-red-50 border border-red-100">
                          <span className="text-red-500 text-xs">⚡</span>
                          <span className="text-xs text-red-700"><strong>{seg.interrupted_speaker}</strong> interrupted by <strong>{seg.interrupted_by}</strong>{seg.words_spoken != null ? ` — ${seg.words_spoken} words` : ''}</span>
                        </div>
                      </td>
                    </tr>
                  );
                  if (seg.type === 'dead_air') return (
                    <tr key={i}>
                      <td colSpan={2} className="px-4 py-1.5">
                        <div className="flex items-center gap-2 px-3 py-1.5 rounded bg-slate-50 border border-slate-200">
                          <span className="text-slate-400 text-xs">⏸</span>
                          <span className="text-xs text-slate-500">Dead air{seg.duration ? ` — ${seg.duration}` : ''}{seg.resumed_by ? ` — resumed by ${seg.resumed_by}` : ''}</span>
                        </div>
                      </td>
                    </tr>
                  );
                  if (seg.type === 'poor_listening') return (
                    <tr key={i}>
                      <td colSpan={2} className="px-4 py-1.5">
                        <div className="flex items-center gap-2 px-3 py-1.5 rounded bg-orange-50 border border-orange-100">
                          <span className="text-orange-500 text-xs">👂</span>
                          <span className="text-xs text-orange-700">Poor listening{seg.phrase ? `: "${seg.phrase}"` : ''}</span>
                        </div>
                      </td>
                    </tr>
                  );
                  const isIR = seg.speaker === 'IR EXECUTIVE';
                  return (
                    <tr key={i} className="border-b border-slate-50 align-top hover:bg-slate-50/50">
                      <td className="px-4 py-2.5 w-36 shrink-0">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${isIR ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>
                          {isIR ? '🟡' : '🟢'} {seg.speaker}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-sm text-slate-700 leading-relaxed">
                        {seg.text}
                        {seg.translated && <span className="ml-2 px-1 py-0.5 rounded text-[10px] font-semibold bg-blue-50 text-blue-500">🌐 translated</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* End marker */}
          <div className="flex items-center gap-3 px-4 py-2">
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
