'use client';

import { useState, useEffect, useCallback } from 'react';
import { CALL_PARAM_ORDER, CALL_PARAM_NAMES, CALL_WEIGHTS } from '@/lib/call-quality';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDuration(secs: number | null | undefined): string {
  if (secs == null || secs < 0) return '—';
  const m = Math.floor(secs / 60), s = secs % 60;
  return s > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${m}:00`;
}

function iqsTheme(iqs: number) {
  if (iqs >= 90) return { text: '#15803d', bg: '#dcfce7', bar: '#22c55e', label: 'Excellent' };
  if (iqs >= 80) return { text: '#92400e', bg: '#fef3c7', bar: '#f59e0b', label: 'Good' };
  if (iqs >= 70) return { text: '#c2410c', bg: '#ffedd5', bar: '#f97316', label: 'Average' };
  return { text: '#b91c1c', bg: '#fee2e2', bar: '#ef4444', label: 'Needs Work' };
}

function IQSBar({ iqs }: { iqs: number | null }) {
  if (iqs === null) return <span className="text-slate-400 text-xs">—</span>;
  const t = iqsTheme(iqs);
  return (
    <div className="flex items-center gap-2 min-w-[90px]">
      <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${iqs}%`, background: t.bar }} />
      </div>
      <span className="text-xs font-bold tabular-nums" style={{ color: t.text, minWidth: 28 }}>{iqs}</span>
    </div>
  );
}

function ScoreBadge({ score }: { score?: string }) {
  if (score === 'Yes') return <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700">Yes</span>;
  if (score === 'No')  return <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-50 text-red-600">No</span>;
  return <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-500">NA</span>;
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface CallEntry {
  callId: string;
  chatId?: string | null;
  agentName: string;
  date: string;
  calledAt: string;
  durationSeconds: number | null;
  language: string;
  interruptionCount: number;
  deadAirCount: number;
  iqs: number | null;
  scores: Record<string, string>;
  reasoning: Record<string, string>;
  failedParams: string[];
  scoredAt: string;
  mobileNumber?: string | null;
}

interface CallSegment {
  type: 'speech' | 'interruption' | 'dead_air' | 'poor_listening';
  speaker?: string;
  text?: string;
  translation?: string;
  translated?: boolean;
  interrupted_speaker?: string;
  interrupted_by?: string;
  words_spoken?: number;
  duration?: string;
  resumed_by?: string;
  phrase?: string;
}

interface Stats {
  totalCalls: number;
  avgIqs: number | null;
  avgInterruptions: number | null;
  avgDeadAir: number | null;
  paramFailRates: Record<string, number>;
}

interface Props {
  userRole?: string;
  userEmail?: string;
  selfAgentName?: string;
  agentOnly?: boolean;
}

// ── Segment Transcript Renderer ───────────────────────────────────────────────

function SegmentRow({ seg }: { seg: CallSegment }) {
  if (seg.type === 'interruption') {
    return (
      <tr>
        <td colSpan={2} className="px-4 py-1.5">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded bg-red-50 border border-red-100">
            <span className="text-red-500 font-bold text-sm">⚡</span>
            <span className="text-xs text-red-700 font-medium">
              <strong>{seg.interrupted_speaker}</strong> interrupted by <strong>{seg.interrupted_by}</strong>
              {seg.words_spoken != null ? ` — ${seg.words_spoken} word${seg.words_spoken !== 1 ? 's' : ''} spoken before cutoff` : ''}
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
          <div className="flex items-center gap-2 px-3 py-1.5 rounded bg-slate-50 border border-slate-200">
            <span className="text-slate-400 font-bold text-sm">⏸</span>
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
          <div className="flex items-center gap-2 px-3 py-1.5 rounded bg-amber-50 border border-amber-200">
            <span className="text-amber-500 font-bold text-sm">🔁</span>
            <span className="text-xs text-amber-700">
              IR asked investor to repeat{seg.phrase ? ` — "${seg.phrase}"` : ''}
            </span>
          </div>
        </td>
      </tr>
    );
  }

  const isIR = seg.speaker === 'IR EXECUTIVE';
  const displayText = (seg.translation || seg.text || '').trim();
  if (!displayText) return null;
  const wasTranslated = seg.translated || !!seg.translation;
  return (
    <tr className="align-top border-b border-slate-50 hover:bg-slate-50/50">
      <td className="px-4 py-2 w-36 shrink-0">
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
          isIR ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'
        }`}>
          {isIR ? '🟡' : '🟢'} {seg.speaker}
        </span>
      </td>
      <td className="px-4 py-2 text-sm text-slate-700">
        {displayText}
        {wasTranslated && (
          <span className="ml-1.5 px-1 py-0.5 rounded text-[9px] font-bold bg-blue-50 text-blue-500 align-middle">🌐 translated</span>
        )}
      </td>
    </tr>
  );
}

// ── Detail Modal ──────────────────────────────────────────────────────────────

function DetailModal({ entry, onClose, agentOnly }: { entry: CallEntry; onClose: () => void; agentOnly?: boolean }) {
  const [segments, setSegments] = useState<CallSegment[]>([]);
  const [loadingTranscript, setLoadingTranscript] = useState(true);
  const [expandedParam, setExpandedParam] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/call-quality/transcript?callId=${encodeURIComponent(entry.callId)}`)
      .then(r => r.json())
      .then(d => { if (d.segments) setSegments(d.segments); })
      .catch(() => {})
      .finally(() => setLoadingTranscript(false));
  }, [entry.callId]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-slate-100">
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <span className="font-mono text-sm text-slate-500">{entry.callId}</span>
              <span className="font-semibold text-slate-800">{entry.agentName || '—'}</span>
              <span className="text-slate-400 text-sm">{entry.date}</span>
              {entry.durationSeconds != null && (
                <span className="text-slate-400 text-sm">⏱ {fmtDuration(entry.durationSeconds)}</span>
              )}
              {entry.language && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-600">{entry.language}</span>
              )}
              {entry.iqs != null && (
                <span className="px-2.5 py-0.5 rounded-full text-xs font-bold" style={entry.iqs != null ? { background: iqsTheme(entry.iqs).bg, color: iqsTheme(entry.iqs).text } : {}}>
                  IQS: {entry.iqs}
                </span>
              )}
              {entry.mobileNumber && (
                <span className="px-2 py-0.5 rounded-full text-[11px] font-mono font-medium bg-slate-100 text-slate-700">
                  📱 {entry.mobileNumber}
                </span>
              )}
              {entry.chatId && (
                <a
                  href={`https://app.robylon.ai/unified-inbox/share/${entry.chatId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 transition-colors"
                  title={`Open chat ${entry.chatId} in Robylon`}
                >
                  <span>💬</span> Show Chat ↗
                </a>
              )}
            </div>
            <div className="flex items-center gap-4 mt-1.5 text-xs text-slate-500">
              <span><span className="text-red-500 font-bold">⚡</span> {entry.interruptionCount} interruption{entry.interruptionCount !== 1 ? 's' : ''}</span>
              <span><span className="text-slate-400 font-bold">⏸</span> {entry.deadAirCount} dead air</span>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">✕</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-hidden flex min-h-0">
          {/* Transcript pane */}
          <div className="flex-1 overflow-y-auto border-r border-slate-100">
            <div className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide bg-slate-50 border-b border-slate-100">Transcript</div>
            {loadingTranscript ? (
              <div className="px-6 py-8 text-sm text-slate-400">Loading transcript…</div>
            ) : segments.length === 0 ? (
              <div className="px-6 py-8 text-sm text-slate-400">No transcript available.</div>
            ) : (
              <table className="w-full">
                <tbody>
                  {segments.map((seg, i) => <SegmentRow key={i} seg={seg} />)}
                </tbody>
              </table>
            )}
          </div>

          {/* IQS params pane */}
          <div className="w-72 shrink-0 overflow-y-auto">
            <div className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide bg-slate-50 border-b border-slate-100">IQS Parameters</div>
            <div className="divide-y divide-slate-50">
              {CALL_PARAM_ORDER.map(key => {
                const score   = entry.scores[key] as string | undefined;
                const reason  = entry.reasoning[key];
                const weight  = Math.round((CALL_WEIGHTS[key] || 0) * 100);
                const isOpen  = expandedParam === key;
                return (
                  <div key={key} className="px-4 py-2">
                    <button
                      className="w-full flex items-center justify-between gap-2 text-left"
                      onClick={() => setExpandedParam(isOpen ? null : key)}
                    >
                      <span className="text-xs text-slate-700 font-medium flex-1">{CALL_PARAM_NAMES[key]}</span>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="text-[10px] text-slate-400">{weight}%</span>
                        <ScoreBadge score={score} />
                        {reason && <span className="text-slate-300 text-xs">{isOpen ? '▲' : '▼'}</span>}
                      </div>
                    </button>
                    {isOpen && reason && (
                      <p className="mt-1.5 text-[11px] text-slate-500 leading-relaxed">{reason}</p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Filters ───────────────────────────────────────────────────────────────────

interface Filters {
  agent: string;
  minScore: number;
  maxScore: number;
  dateRange: 'today' | 'yesterday' | '1w' | 'custom';
  dateFrom: string;
  dateTo: string;
}

const DEFAULT_FILTERS: Filters = {
  agent: '', minScore: 0, maxScore: 100,
  dateRange: '1w', dateFrom: '', dateTo: '',
};

function buildParams(page: number, f: Filters): URLSearchParams {
  const p = new URLSearchParams();
  p.set('page', String(page));
  if (f.agent) p.set('agent', f.agent);
  if (f.minScore > 0) p.set('minScore', String(f.minScore));
  if (f.maxScore < 100) p.set('maxScore', String(f.maxScore));
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

// ── Main Component ────────────────────────────────────────────────────────────

export default function CallQualityClient({ agentOnly }: Props) {
  const [entries, setEntries] = useState<CallEntry[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);

  const [pendingFilters, setPendingFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState<Filters>(DEFAULT_FILTERS);

  const [detailEntry, setDetailEntry] = useState<CallEntry | null>(null);

  const load = useCallback(async (f: Filters, pg: number) => {
    setLoading(true);
    setError(null);
    try {
      const params = buildParams(pg, f);
      const res = await fetch(`/api/call-quality/scores?${params}`);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Failed to load');
      if (pg === 0) setEntries(data.entries);
      else setEntries(prev => [...prev, ...data.entries]);
      setStats(data.stats);
      setTotal(data.total);
      setHasMore(data.hasMore);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(appliedFilters, 0);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function applyFilters() {
    setPage(0);
    setAppliedFilters(pendingFilters);
    load(pendingFilters, 0);
  }

  function loadMore() {
    const next = page + 1;
    setPage(next);
    load(appliedFilters, next);
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Filters bar */}
      <div className="flex flex-wrap items-end gap-3 px-1">
        {!agentOnly && (
          <div>
            <label className="block text-[10px] font-semibold text-slate-400 uppercase mb-1">Agent</label>
            <input
              className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm w-36 focus:outline-none focus:ring-2 focus:ring-amber-200"
              placeholder="All agents"
              value={pendingFilters.agent}
              onChange={e => setPendingFilters(f => ({ ...f, agent: e.target.value }))}
            />
          </div>
        )}
        <div>
          <label className="block text-[10px] font-semibold text-slate-400 uppercase mb-1">Min Score</label>
          <input
            type="number" min={0} max={100}
            className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm w-20 focus:outline-none focus:ring-2 focus:ring-amber-200"
            value={pendingFilters.minScore}
            onChange={e => setPendingFilters(f => ({ ...f, minScore: Number(e.target.value) }))}
          />
        </div>
        <div>
          <label className="block text-[10px] font-semibold text-slate-400 uppercase mb-1">Period</label>
          <select
            className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-200"
            value={pendingFilters.dateRange}
            onChange={e => setPendingFilters(f => ({ ...f, dateRange: e.target.value as Filters['dateRange'] }))}
          >
            <option value="today">Today</option>
            <option value="yesterday">Yesterday</option>
            <option value="1w">Last 7 days</option>
            <option value="custom">Custom</option>
          </select>
        </div>
        {pendingFilters.dateRange === 'custom' && (
          <>
            <div>
              <label className="block text-[10px] font-semibold text-slate-400 uppercase mb-1">From</label>
              <input type="date" className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm" value={pendingFilters.dateFrom}
                onChange={e => setPendingFilters(f => ({ ...f, dateFrom: e.target.value }))} />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-slate-400 uppercase mb-1">To</label>
              <input type="date" className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm" value={pendingFilters.dateTo}
                onChange={e => setPendingFilters(f => ({ ...f, dateTo: e.target.value }))} />
            </div>
          </>
        )}
        <button
          onClick={applyFilters}
          className="px-4 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold transition-colors"
        >
          Apply
        </button>
      </div>

      {/* Stats bar */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Total Calls', value: stats.totalCalls },
            { label: 'Avg IQS', value: stats.avgIqs ?? '—' },
            { label: 'Avg Interruptions', value: stats.avgInterruptions ?? '—' },
            { label: 'Avg Dead Air', value: stats.avgDeadAir ?? '—' },
          ].map(s => (
            <div key={s.label} className="bg-white border border-slate-100 rounded-xl p-3 shadow-sm">
              <p className="text-[10px] font-semibold text-slate-400 uppercase">{s.label}</p>
              <p className="text-2xl font-bold text-slate-800 mt-0.5 tabular-nums">{s.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        {error && (
          <div className="px-6 py-4 text-sm text-red-600 bg-red-50">{error}</div>
        )}
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50">
              <th className="px-4 py-3 text-left text-[11px] font-semibold text-slate-400 uppercase">Call ID</th>
              {!agentOnly && <th className="px-4 py-3 text-left text-[11px] font-semibold text-slate-400 uppercase">Agent</th>}
              <th className="px-4 py-3 text-left text-[11px] font-semibold text-slate-400 uppercase">Mobile</th>
              <th className="px-4 py-3 text-left text-[11px] font-semibold text-slate-400 uppercase">Date</th>
              <th className="px-4 py-3 text-left text-[11px] font-semibold text-slate-400 uppercase">Duration</th>
              <th className="px-4 py-3 text-left text-[11px] font-semibold text-slate-400 uppercase">Linked Chat</th>
              <th className="px-4 py-3 text-left text-[11px] font-semibold text-slate-400 uppercase">IQS</th>
              <th className="px-4 py-3 text-left text-[11px] font-semibold text-slate-400 uppercase">⚡ / ⏸</th>
              <th className="px-4 py-3 text-left text-[11px] font-semibold text-slate-400 uppercase">Fails</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {entries.map(entry => (
              <tr
                key={entry.callId}
                className="hover:bg-amber-50/40 cursor-pointer transition-colors"
                onClick={() => setDetailEntry(entry)}
              >
                <td className="px-4 py-2.5">
                  <span className="font-mono text-xs text-slate-500">{entry.callId}</span>
                </td>
                {!agentOnly && (
                  <td className="px-4 py-2.5 font-medium text-slate-700">{entry.agentName || '—'}</td>
                )}
                <td className="px-4 py-2.5 font-mono text-xs text-slate-600">
                  {entry.mobileNumber || <span className="text-slate-300">—</span>}
                </td>
                <td className="px-4 py-2.5 text-slate-500 text-xs">{entry.date}</td>
                <td className="px-4 py-2.5 text-slate-500 text-xs tabular-nums">{fmtDuration(entry.durationSeconds)}</td>
                <td className="px-4 py-2.5" onClick={e => e.stopPropagation()}>
                  {entry.chatId ? (
                    <a
                      href={`https://app.robylon.ai/unified-inbox/share/${entry.chatId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 border border-blue-100 transition-colors"
                      title={`Open chat ${entry.chatId} in Robylon`}
                    >
                      Show chat ↗
                    </a>
                  ) : (
                    <span className="text-slate-300 text-xs">—</span>
                  )}
                </td>
                <td className="px-4 py-2.5"><IQSBar iqs={entry.iqs} /></td>
                <td className="px-4 py-2.5">
                  <span className="text-xs tabular-nums">
                    <span className="text-red-500 font-semibold">{entry.interruptionCount}</span>
                    <span className="text-slate-300 mx-1">/</span>
                    <span className="text-slate-400">{entry.deadAirCount}</span>
                  </span>
                </td>
                <td className="px-4 py-2.5">
                  {entry.failedParams.length > 0 ? (
                    <span className="text-xs text-red-500">{entry.failedParams.map(k => CALL_PARAM_NAMES[k] || k).join(', ')}</span>
                  ) : (
                    <span className="text-xs text-emerald-500">None</span>
                  )}
                </td>
              </tr>
            ))}
            {!loading && entries.length === 0 && (
              <tr>
                <td colSpan={agentOnly ? 8 : 9} className="px-6 py-12 text-center text-slate-400 text-sm">
                  No scored calls found for the selected filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {loading && (
          <div className="px-6 py-4 text-sm text-slate-400 text-center">Loading…</div>
        )}
        {hasMore && !loading && (
          <div className="px-6 py-4 text-center">
            <button
              onClick={loadMore}
              className="px-5 py-2 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50 transition-colors"
            >
              Load more ({total - entries.length} remaining)
            </button>
          </div>
        )}
      </div>

      {/* Detail modal */}
      {detailEntry && <DetailModal entry={detailEntry} onClose={() => setDetailEntry(null)} agentOnly={agentOnly} />}
    </div>
  );
}
