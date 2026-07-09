import { PARAM_ORDER, PARAM_NAMES, fmtDuration, iqsTheme } from '@/lib/quality';
import type { IQSScoreEntry } from '@/lib/quality';
import type { AgentStat } from './types';
import { IQSRing } from '@/components/quality/IQSRing';

interface AgentReportModalProps {
  stat: AgentStat;
  entries: IQSScoreEntry[];
  onClose: () => void;
  onFilterLog: (f: { agent: string; minScore?: number; maxScore?: number }) => void;
}

export default function AgentReportModal({ stat, entries, onClose, onFilterLog }: AgentReportModalProps) {
  const agentEntries = entries.filter(e => (e.agentName || 'Unknown') === stat.agent);
  const t = iqsTheme(stat.avgIqs);

  const csatGood  = stat.csatGood  ?? agentEntries.filter(e => e.csat === '5').length;
  const csatCbb   = stat.csatCbb   ?? agentEntries.filter(e => e.csat === '3').length;
  const csatBad   = stat.csatBad   ?? agentEntries.filter(e => e.csat === '1').length;
  const csatTotal = csatGood + csatCbb + csatBad;

  const dispMap: Record<string, number> = {};
  for (const e of agentEntries) if (e.disposition) dispMap[e.disposition] = (dispMap[e.disposition] || 0) + 1;
  const topDisp = Object.entries(dispMap).sort((a, b) => b[1] - a[1]).slice(0, 5);

  const subDispMap: Record<string, number> = {};
  for (const e of agentEntries) if (e.subDisposition) subDispMap[e.subDisposition] = (subDispMap[e.subDisposition] || 0) + 1;
  const topSubDisp = Object.entries(subDispMap).sort((a, b) => b[1] - a[1]).slice(0, 5);

  const paramData = PARAM_ORDER.map(p => {
    const fails = agentEntries.filter(e => e.scores[p] === 'No').length;
    return { p, failPct: agentEntries.length ? Math.round(fails / agentEntries.length * 100) : 0 };
  }).sort((a, b) => b.failPct - a.failPct);
  const worstParams = paramData.filter(d => d.failPct > 0).slice(0, 4);
  const bestParams  = [...paramData].sort((a, b) => a.failPct - b.failPct).slice(0, 3);

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 flex items-center gap-4 rounded-t-2xl">
          <IQSRing iqs={stat.avgIqs} size={52} />
          <div className="flex-1 min-w-0">
            <h2 className="font-bold text-gray-900 text-lg">{stat.agent}</h2>
            <p className="text-xs text-gray-400 mt-0.5">{stat.chats} chats · IQS range {stat.minIqs}–{stat.maxIqs}%</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 2l12 12M14 2L2 14" /></svg>
          </button>
        </div>

        <div className="px-6 py-5 space-y-6">
          {/* KPI row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Avg IQS', value: `${stat.avgIqs}%`, color: t.text },
              { label: 'CSAT Good', value: stat.csatPct != null ? `${stat.csatPct}%` : '—', color: (stat.csatPct ?? 0) >= 80 ? 'text-emerald-600' : (stat.csatPct ?? 0) >= 60 ? 'text-amber-600' : 'text-red-500' },
              { label: 'Avg FRT', value: fmtDuration(stat.avgFrt ?? null), color: 'text-gray-800' },
              { label: 'Avg Resolution', value: fmtDuration(stat.avgResolution ?? null), color: 'text-gray-800' },
            ].map(k => (
              <div key={k.label} className="bg-gray-50 rounded-xl px-4 py-3 text-center">
                <p className={`text-xl font-bold ${k.color}`}>{k.value}</p>
                <p className="text-[10px] text-gray-400 uppercase tracking-wider mt-0.5">{k.label}</p>
              </div>
            ))}
          </div>

          {/* CSAT breakdown */}
          {csatTotal > 0 && (
            <div>
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">CSAT Breakdown</p>
              <div className="flex gap-3">
                {[['Good', csatGood, 'bg-emerald-100 text-emerald-700'], ['CBB', csatCbb, 'bg-amber-100 text-amber-700'], ['Bad', csatBad, 'bg-red-100 text-red-700']].map(([label, count, cls]) => (
                  <div key={String(label)} className={`flex-1 rounded-xl px-3 py-2 text-center ${cls}`}>
                    <p className="text-lg font-bold">{count}</p>
                    <p className="text-[10px] font-semibold uppercase">{label}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Worst parameters */}
          {worstParams.length > 0 && (
            <div>
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Worst Parameters</p>
              <div className="space-y-1.5">
                {worstParams.map(d => (
                  <div key={d.p} className="flex items-center gap-3">
                    <span className="text-xs text-gray-700 w-32 shrink-0">{PARAM_NAMES[d.p] || d.p}</span>
                    <div className="flex-1 bg-gray-100 rounded-full h-1.5">
                      <div className="h-1.5 rounded-full bg-red-400" style={{ width: `${d.failPct}%` }} />
                    </div>
                    <span className="text-xs font-bold text-red-600 w-10 text-right">{d.failPct}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Best parameters */}
          {bestParams.length > 0 && (
            <div>
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Best Parameters</p>
              <div className="flex gap-2 flex-wrap">
                {bestParams.map(d => (
                  <span key={d.p} className="text-xs font-semibold bg-emerald-50 text-emerald-700 px-3 py-1 rounded-full">
                    {PARAM_NAMES[d.p] || d.p} {d.failPct === 0 ? '✓' : `${100 - d.failPct}%`}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Disposition breakdown */}
          {topDisp.length > 0 && (
            <div>
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Top Dispositions</p>
              <div className="space-y-1">
                {topDisp.map(([d, n]) => (
                  <div key={d} className="flex items-center gap-3">
                    <span className="text-xs text-gray-700 flex-1 truncate">{d}</span>
                    <div className="w-24 bg-gray-100 rounded-full h-1.5">
                      <div className="h-1.5 rounded-full bg-emerald-400" style={{ width: `${Math.round(n / agentEntries.length * 100)}%` }} />
                    </div>
                    <span className="text-xs text-gray-500 w-6 text-right">{n}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Sub-disposition breakdown */}
          {topSubDisp.length > 0 && (
            <div>
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Struggled With (Sub-Disposition)</p>
              <div className="space-y-1">
                {topSubDisp.map(([d, n]) => (
                  <div key={d} className="flex items-center gap-3">
                    <span className="text-xs text-gray-700 flex-1 truncate">{d}</span>
                    <span className="text-xs text-gray-500 ml-auto">{n} chats</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-2 border-t border-gray-100">
            <button onClick={() => { onFilterLog({ agent: stat.agent }); onClose(); }}
              className="flex-1 text-xs px-4 py-2.5 bg-emerald-600 text-white rounded-xl font-bold hover:bg-emerald-700 transition">
              View All Chats →
            </button>
            <button onClick={() => { onFilterLog({ agent: stat.agent, maxScore: 69 }); onClose(); }}
              className="flex-1 text-xs px-4 py-2.5 border border-red-200 text-red-600 bg-red-50 rounded-xl font-bold hover:bg-red-100 transition">
              At-Risk Chats Only
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
