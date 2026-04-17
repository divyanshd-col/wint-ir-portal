'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { PARAM_ORDER, PARAM_NAMES, WEIGHTS } from '@/lib/quality';
import type { IQSScoreEntry } from '@/lib/quality';

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
  return { text: '#b91c1c', bg: '#fee2e2', bar: '#ef4444', label: 'At Risk' };
}

function csatLabel(csat?: string) {
  if (csat === '5') return { label: 'Good', cls: 'bg-emerald-100 text-emerald-700' };
  if (csat === '3') return { label: 'CBB',  cls: 'bg-amber-100 text-amber-700' };
  if (csat === '1') return { label: 'Bad',  cls: 'bg-red-100 text-red-600' };
  return null;
}

function convTypeBadge(type?: string) {
  if (type === 'bot')    return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-violet-100 text-violet-700">Bot</span>;
  if (type === 'hybrid') return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-700">Hybrid</span>;
  return                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-700">Human</span>;
}

function deltaIcon(val: number, inverse = false) {
  const up = inverse ? val < 0 : val > 0;
  const dn = inverse ? val > 0 : val < 0;
  if (up) return <span className="text-emerald-600 text-[10px] font-bold">▲</span>;
  if (dn) return <span className="text-red-500 text-[10px] font-bold">▼</span>;
  return <span className="text-gray-400 text-[10px]">–</span>;
}

function getWeekBounds(weeksAgo = 0) {
  const now = new Date();
  const day = now.getUTCDay() || 7;
  const mon = new Date(now);
  mon.setUTCDate(now.getUTCDate() - (day - 1) - weeksAgo * 7);
  mon.setUTCHours(0, 0, 0, 0);
  const sun = new Date(mon);
  sun.setUTCDate(mon.getUTCDate() + 6);
  sun.setUTCHours(23, 59, 59, 999);
  return { from: mon.toISOString().slice(0, 10), to: sun.toISOString().slice(0, 10) };
}

function inRange(entry: IQSScoreEntry, from: string, to: string) {
  const d = (entry.scoredAt || entry.date || '').slice(0, 10);
  return d >= from && d <= to;
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function IQSRing({ iqs, size = 64 }: { iqs: number; size?: number }) {
  const t = iqsTheme(iqs);
  const r = (size - 8) / 2;
  const circ = 2 * Math.PI * r;
  const dash = (iqs / 100) * circ;
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#f1f5f9" strokeWidth={6} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={t.bar} strokeWidth={6}
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round" />
      </svg>
      <span className="absolute text-xs font-bold tabular-nums" style={{ color: t.text }}>{iqs}</span>
    </div>
  );
}

// ── Modal wrapper ─────────────────────────────────────────────────────────────
function Modal({ open, onClose, title, subtitle, children, wide = false }: {
  open: boolean; onClose: () => void;
  title: string; subtitle?: string;
  children: React.ReactNode; wide?: boolean;
}) {
  useEffect(() => {
    if (open) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-16 px-4">
      <div className="fixed inset-0 bg-black/30" onClick={onClose} />
      <div
        className={`relative bg-white rounded-2xl shadow-2xl flex flex-col max-h-[80vh] w-full ${wide ? 'max-w-5xl' : 'max-w-2xl'}`}
        style={{ zIndex: 51 }}
      >
        <div className="flex items-start justify-between px-6 py-4 border-b border-gray-100 shrink-0">
          <div>
            <h2 className="text-base font-bold text-gray-900">{title}</h2>
            {subtitle && <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none ml-4">×</button>
        </div>
        <div className="overflow-y-auto flex-1 px-6 py-4">{children}</div>
      </div>
    </div>
  );
}

// ── Flag button ───────────────────────────────────────────────────────────────
function FlagButton({ entry, existingFlag }: { entry: IQSScoreEntry; existingFlag?: boolean }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(existingFlag || false);
  const [err, setErr] = useState('');

  async function submit() {
    if (!note.trim()) { setErr('Please describe why this score seems incorrect.'); return; }
    setLoading(true); setErr('');
    try {
      const res = await fetch('/api/quality/flag', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scoreId: entry.id, chatId: entry.chatId, agentNote: note }),
      });
      const data = await res.json();
      if (data.error) { setErr(data.error); return; }
      setDone(true); setOpen(false);
    } catch { setErr('Request failed.'); }
    finally { setLoading(false); }
  }

  if (done) return (
    <span className="text-[10px] font-semibold text-amber-600 bg-amber-50 border border-amber-200 px-2 py-1 rounded-lg">
      ⚑ Flagged
    </span>
  );

  return (
    <>
      <button
        onClick={e => { e.stopPropagation(); setOpen(true); }}
        className="text-[11px] font-semibold text-gray-400 hover:text-amber-600 border border-gray-200 hover:border-amber-300 px-2.5 py-1 rounded-lg transition"
        title="Flag this score for quality review"
      >
        ⚑ Flag Score
      </button>

      {open && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center px-4" onClick={() => setOpen(false)}>
          <div className="fixed inset-0 bg-black/20" />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 z-[61]" onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-gray-900 mb-1">Flag Score for Review</h3>
            <p className="text-xs text-gray-400 mb-4">Chat #{entry.chatId} · IQS {entry.iqs}% — describe what seems incorrect</p>
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              rows={4}
              placeholder="e.g. I did greet the customer properly in message 2. The opening parameter seems incorrectly marked as No."
              className="w-full border border-gray-200 rounded-xl px-3.5 py-3 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#2d9e4f]/30 resize-none"
            />
            {err && <p className="text-xs text-red-500 mt-1.5">{err}</p>}
            <div className="flex gap-2 mt-4">
              <button
                onClick={submit}
                disabled={loading}
                className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold rounded-xl disabled:opacity-50 transition"
              >
                {loading ? 'Sending…' : 'Send to Quality'}
              </button>
              <button onClick={() => setOpen(false)} className="px-4 py-2.5 border border-gray-200 text-gray-500 rounded-xl text-sm hover:bg-gray-50 transition">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── IQS Score detail drawer ───────────────────────────────────────────────────
function IQSDrawer({ entry, onClose, flagged }: { entry: IQSScoreEntry | null; onClose: () => void; flagged?: boolean }) {
  const [transcript, setTranscript] = useState<string | null>(null);
  const [loadingTx, setLoadingTx] = useState(false);

  useEffect(() => {
    if (!entry) return;
    setTranscript(null);
    setLoadingTx(true);
    fetch(`/api/quality/transcript?chatId=${encodeURIComponent(entry.chatId)}`)
      .then(r => r.json())
      .then(d => { if (d.found && d.transcript) setTranscript(d.transcript); })
      .catch(() => {})
      .finally(() => setLoadingTx(false));
  }, [entry?.id]);

  if (!entry) return null;
  const t = iqsTheme(entry.iqs);
  const cs = csatLabel(entry.csat);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="fixed inset-0 bg-black/20" onClick={onClose} />
      <div className="relative bg-white w-full max-w-[420px] h-full flex flex-col shadow-2xl" style={{ zIndex: 51 }}>
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-100 shrink-0 flex items-start justify-between">
          <div>
            <p className="text-xs text-gray-400 mb-0.5">Chat #{entry.chatId}</p>
            <div className="flex items-center gap-2">
              <span className="text-lg font-bold" style={{ color: t.text }}>{entry.iqs}%</span>
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: t.bg, color: t.text }}>{t.label}</span>
              {cs && <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${cs.cls}`}>{cs.label}</span>}
            </div>
            <p className="text-[11px] text-gray-400 mt-1">
              {entry.scoredAt?.slice(0, 10)}
              {entry.frt != null && <> &nbsp;·&nbsp; FRT {fmtDuration(entry.frt)}</>}
              {entry.resolutionTime != null && <> &nbsp;·&nbsp; Res {fmtDuration(entry.resolutionTime)}</>}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* Summary */}
          {entry.summary && (
            <div className="bg-gray-50 rounded-xl p-3.5 text-xs text-gray-700 leading-relaxed border border-gray-100">
              {entry.summary}
            </div>
          )}

          {/* Parameters */}
          <div>
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Parameter Scores</p>
            <div className="border border-gray-100 rounded-xl overflow-hidden">
              {PARAM_ORDER.map(p => {
                const val = entry.scores?.[p];
                const weight = Math.round((WEIGHTS[p] || 0) * 100);
                return (
                  <div key={p} className="flex items-start justify-between px-3.5 py-2.5 border-b border-gray-50 last:border-0">
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-gray-700 truncate">{PARAM_NAMES[p]}</p>
                      {entry.reasoning?.[p] && (
                        <p className="text-[10px] text-gray-400 mt-0.5 leading-snug">{entry.reasoning[p]}</p>
                      )}
                    </div>
                    <div className="ml-3 shrink-0 flex items-center gap-2">
                      <span className="text-[10px] text-gray-400">{weight}%</span>
                      {val === 'Yes' && <span className="text-emerald-500 font-bold text-sm">✓</span>}
                      {val === 'No'  && <span className="text-red-500 font-bold text-sm">✗</span>}
                      {val === 'NA'  && <span className="text-gray-300 text-xs">NA</span>}
                      {!val && <span className="text-gray-300 text-xs">—</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Transcript */}
          {loadingTx && <p className="text-xs text-gray-400 animate-pulse">Loading transcript…</p>}
          {!loadingTx && transcript && (
            <div>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Transcript</p>
              <div className="bg-gray-50 rounded-xl p-3.5 border border-gray-100 text-xs text-gray-700 leading-relaxed space-y-2 max-h-56 overflow-y-auto">
                {transcript.split('\n').map((line, i) => {
                  if (!line.trim()) return null;
                  const isAgent = /^(agent|rahul|priya|ankit|divya|suman)/i.test(line);
                  return (
                    <p key={i} className={isAgent ? 'text-emerald-800' : 'text-gray-700'}>
                      {line}
                    </p>
                  );
                })}
              </div>
            </div>
          )}

          {/* Flag */}
          <div className="pt-1">
            <FlagButton entry={entry} existingFlag={flagged} />
            <p className="text-[10px] text-gray-400 mt-1.5">If this score seems incorrect, flag it and our quality team will review.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── IQS Modal — all scored chats ──────────────────────────────────────────────
function IQSModal({ open, onClose, entries, flags }: {
  open: boolean; onClose: () => void;
  entries: IQSScoreEntry[]; flags: string[];
}) {
  const [filter, setFilter] = useState<'all' | 'low' | 'flagged'>('all');
  const [selected, setSelected] = useState<IQSScoreEntry | null>(null);

  const scored = entries.filter(e => e.iqs !== undefined);
  const displayed = scored.filter(e => {
    if (filter === 'low') return e.iqs < 70;
    if (filter === 'flagged') return flags.includes(e.id);
    return true;
  }).sort((a, b) => (b.scoredAt || '').localeCompare(a.scoredAt || ''));

  return (
    <>
      <Modal open={open} onClose={onClose} wide
        title="My IQS Scores"
        subtitle={`${scored.length} scored conversations — click a row to see breakdown`}
      >
        {/* Filters */}
        <div className="flex gap-2 mb-4">
          {(['all', 'low', 'flagged'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`text-xs px-3 py-1.5 rounded-lg font-semibold transition ${filter === f ? 'bg-[#2d9e4f] text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
              {f === 'all' ? 'All' : f === 'low' ? '⚠ At Risk (<70)' : '⚑ Flagged'}
            </button>
          ))}
          <span className="ml-auto text-xs text-gray-400 self-center">{displayed.length} entries</span>
        </div>

        {/* Table */}
        <div className="border border-gray-100 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Chat ID</th>
                <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Date</th>
                <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">IQS</th>
                <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">CSAT</th>
                <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Type</th>
                <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">FRT</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {displayed.length === 0 && (
                <tr><td colSpan={7} className="text-center text-sm text-gray-400 py-10">No entries match this filter.</td></tr>
              )}
              {displayed.map(e => {
                const t = iqsTheme(e.iqs);
                const cs = csatLabel(e.csat);
                const isFlagged = flags.includes(e.id);
                return (
                  <tr key={e.id} onClick={() => setSelected(e)}
                    className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer transition">
                    <td className="px-4 py-3 font-mono text-xs text-[#2d9e4f] font-semibold">{e.chatId}</td>
                    <td className="px-4 py-3 text-xs text-gray-500">{e.scoredAt?.slice(0, 10) || e.date || '—'}</td>
                    <td className="px-4 py-3">
                      <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: t.bg, color: t.text }}>
                        {e.iqs}%
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {cs
                        ? <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${cs.cls}`}>{cs.label}</span>
                        : <span className="text-gray-300 text-xs">—</span>
                      }
                    </td>
                    <td className="px-4 py-3">{convTypeBadge(e.conversationType)}</td>
                    <td className="px-4 py-3 text-xs text-gray-500 tabular-nums">{fmtDuration(e.frt)}</td>
                    <td className="px-4 py-3" onClick={e2 => e2.stopPropagation()}>
                      <FlagButton entry={e} existingFlag={isFlagged} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Modal>

      {/* Detail drawer on top of modal */}
      {selected && (
        <IQSDrawer
          entry={selected}
          onClose={() => setSelected(null)}
          flagged={flags.includes(selected.id)}
        />
      )}
    </>
  );
}

// ── CSAT Modal — all rated chats ──────────────────────────────────────────────
function CSATModal({ open, onClose, entries }: {
  open: boolean; onClose: () => void; entries: IQSScoreEntry[];
}) {
  const [filter, setFilter] = useState<'all' | '5' | '3' | '1'>('all');

  const rated = entries.filter(e => ['5', '3', '1'].includes(e.csat || ''));
  const displayed = rated
    .filter(e => filter === 'all' || e.csat === filter)
    .sort((a, b) => (b.scoredAt || '').localeCompare(a.scoredAt || ''));

  const good   = rated.filter(e => e.csat === '5').length;
  const cbb    = rated.filter(e => e.csat === '3').length;
  const bad    = rated.filter(e => e.csat === '1').length;

  return (
    <Modal open={open} onClose={onClose} wide
      title="My CSAT Ratings"
      subtitle={`${rated.length} rated conversations`}
    >
      {/* Summary strip */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        {[
          { label: 'Good (★★★★★)', count: good, cls: 'border-emerald-100 bg-emerald-50 text-emerald-700' },
          { label: 'Could Be Better', count: cbb, cls: 'border-amber-100 bg-amber-50 text-amber-700' },
          { label: 'Bad', count: bad, cls: 'border-red-100 bg-red-50 text-red-600' },
        ].map(s => (
          <div key={s.label} className={`rounded-xl border px-4 py-3 ${s.cls}`}>
            <p className="text-[10px] font-bold uppercase tracking-wide opacity-70">{s.label}</p>
            <p className="text-2xl font-bold mt-0.5">{s.count}</p>
            <p className="text-[11px] opacity-60">{rated.length > 0 ? Math.round(s.count / rated.length * 100) : 0}% of rated</p>
          </div>
        ))}
      </div>

      {/* Filter pills */}
      <div className="flex gap-2 mb-4">
        {([['all','All'],['5','Good'],['3','CBB'],['1','Bad']] as const).map(([v, l]) => (
          <button key={v} onClick={() => setFilter(v)}
            className={`text-xs px-3 py-1.5 rounded-lg font-semibold transition ${filter === v ? 'bg-[#2d9e4f] text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
            {l}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="border border-gray-100 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Chat ID</th>
              <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Date</th>
              <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">CSAT</th>
              <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">IQS</th>
              <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Type</th>
              <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Disposition</th>
            </tr>
          </thead>
          <tbody>
            {displayed.length === 0 && (
              <tr><td colSpan={6} className="text-center text-sm text-gray-400 py-10">No {filter !== 'all' ? filter + '-star ' : ''}rated chats found.</td></tr>
            )}
            {displayed.map(e => {
              const cs = csatLabel(e.csat)!;
              const t = e.iqs != null ? iqsTheme(e.iqs) : null;
              return (
                <tr key={e.id} className="border-b border-gray-50 hover:bg-gray-50 transition">
                  <td className="px-4 py-3 font-mono text-xs text-[#2d9e4f] font-semibold">{e.chatId}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">{e.scoredAt?.slice(0, 10) || e.date || '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${cs.cls}`}>{cs.label}</span>
                  </td>
                  <td className="px-4 py-3">
                    {t
                      ? <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: t.bg, color: t.text }}>{e.iqs}%</span>
                      : <span className="text-gray-300 text-xs">—</span>
                    }
                  </td>
                  <td className="px-4 py-3">{convTypeBadge(e.conversationType)}</td>
                  <td className="px-4 py-3 text-xs text-gray-500 truncate max-w-[160px]">
                    {e.disposition || '—'}
                    {e.subDisposition && <span className="text-gray-400"> / {e.subDisposition}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
interface Props {
  userEmail: string;
  selfAgentName?: string;
}

type DateRange = 'today' | '7d' | '30d' | '90d';
type ModalKind = 'iqs' | 'csat' | null;

export default function AgentQualityClient({ userEmail, selfAgentName }: Props) {
  const [entries, setEntries] = useState<IQSScoreEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [teamAvg, setTeamAvg] = useState<Record<string, number | null>>({});
  const [flags, setFlags] = useState<string[]>([]);         // flagged scoreIds
  const [dateRange, setDateRange] = useState<DateRange>('7d');
  const [modal, setModal] = useState<ModalKind>(null);
  const [drawerEntry, setDrawerEntry] = useState<IQSScoreEntry | null>(null);
  const [chatFilter, setChatFilter] = useState<'all' | 'flagged' | 'low' | 'cbb'>('all');

  // ── Fetch agent's own scores ─────────────────────────────────────────────
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [scoresRes, teamRes, flagsRes] = await Promise.all([
        fetch('/api/quality/scores'),
        fetch('/api/quality/team-avg'),
        fetch('/api/quality/flag'),
      ]);
      const scoresData = await scoresRes.json();
      const teamData   = await teamRes.json();
      const flagsData  = await flagsRes.json();

      setEntries(Array.isArray(scoresData.entries) ? scoresData.entries : []);
      setTeamAvg(teamData);
      if (Array.isArray(flagsData.flags)) {
        setFlags(flagsData.flags.map((f: any) => f.scoreId));
      }
    } catch {}
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Date filtering ────────────────────────────────────────────────────────
  function getDateBounds(range: DateRange): { from: string; to: string } {
    const now = new Date();
    const to = now.toISOString().slice(0, 10);
    if (range === 'today') return { from: to, to };
    if (range === '7d') return { from: new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10), to };
    if (range === '30d') return { from: new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10), to };
    return { from: new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10), to };
  }

  const { from, to } = getDateBounds(dateRange);
  const filtered = entries.filter(e => {
    const d = (e.scoredAt || e.date || '').slice(0, 10);
    return d >= from && d <= to;
  });

  // ── Week-over-week ────────────────────────────────────────────────────────
  const thisWeek = getWeekBounds(0);
  const lastWeek = getWeekBounds(1);
  const thisWkEntries = entries.filter(e => inRange(e, thisWeek.from, thisWeek.to));
  const lastWkEntries = entries.filter(e => inRange(e, lastWeek.from, lastWeek.to));

  function wkMetric(arr: IQSScoreEntry[]) {
    const iqsVals: number[] = arr.filter(e => e.iqs != null).map(e => e.iqs);
    const csatNum: number[] = arr.reduce<number[]>((acc, e) => {
      if (e.csat === '5') acc.push(100);
      else if (e.csat === '3') acc.push(50);
      else if (e.csat === '1') acc.push(0);
      return acc;
    }, []);
    const frtVals: number[] = arr.map(e => e.frt).filter((v): v is number => typeof v === 'number');
    const resVals: number[] = arr.map(e => e.resolutionTime).filter((v): v is number => typeof v === 'number');
    const escals  = arr.filter(e => e.scores && Object.values(e.scores).includes('No')).length;
    const sum = (nums: number[]) => nums.reduce((s, n) => s + n, 0);
    return {
      avgIqs:  iqsVals.length ? Math.round(sum(iqsVals) / iqsVals.length) : null,
      avgCsat: csatNum.length ? Math.round(sum(csatNum) / csatNum.length) : null,
      chats:   arr.length,
      avgFrt:  frtVals.length ? Math.round(sum(frtVals) / frtVals.length) : null,
      avgRes:  resVals.length ? Math.round(sum(resVals) / resVals.length) : null,
      escals,
    };
  }
  const tw = wkMetric(thisWkEntries);
  const lw = wkMetric(lastWkEntries);

  // ── Hero metrics ──────────────────────────────────────────────────────────
  const scoredFiltered = filtered.filter(e => e.iqs != null);
  const avgIqs = scoredFiltered.length
    ? Math.round(scoredFiltered.reduce((s, e) => s + e.iqs, 0) / scoredFiltered.length)
    : null;
  const ratedFiltered = filtered.filter(e => ['5','3','1'].includes(e.csat || ''));
  const csatNums: number[] = ratedFiltered.reduce<number[]>((acc, e) => {
    if (e.csat === '5') acc.push(100);
    else if (e.csat === '3') acc.push(50);
    else if (e.csat === '1') acc.push(0);
    return acc;
  }, []);
  const avgCsat = csatNums.length ? Math.round(csatNums.reduce((s, n) => s + n, 0) / csatNums.length) : null;
  const frtVals = filtered.map(e => e.frt).filter((v): v is number => typeof v === 'number');
  const avgFrt  = frtVals.length ? Math.round(frtVals.reduce((s, n) => s + n, 0) / frtVals.length) : null;
  const resVals = filtered.map(e => e.resolutionTime).filter((v): v is number => typeof v === 'number');
  const avgRes  = resVals.length ? Math.round(resVals.reduce((s, n) => s + n, 0) / resVals.length) : null;

  // ── IQS trend (last 14 days) ──────────────────────────────────────────────
  const trend14 = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(Date.now() - (13 - i) * 86400000);
    const key = d.toISOString().slice(0, 10);
    const dayEntries = entries.filter(e => (e.scoredAt || e.date || '').slice(0, 10) === key && e.iqs != null);
    const avg = dayEntries.length
      ? Math.round(dayEntries.reduce((s, e) => s + e.iqs, 0) / dayEntries.length)
      : null;
    return { date: key, label: `${d.getMonth() + 1}/${d.getDate()}`, avg, count: dayEntries.length };
  });

  // ── Param pass rates (current period) ────────────────────────────────────
  const paramRates = PARAM_ORDER.map(p => {
    const relevant = scoredFiltered.filter(e => e.scores?.[p] != null && e.scores[p] !== 'NA');
    const passes   = relevant.filter(e => e.scores[p] === 'Yes').length;
    return { key: p, name: PARAM_NAMES[p], rate: relevant.length ? Math.round(passes / relevant.length * 100) : null, weight: Math.round((WEIGHTS[p] || 0) * 100) };
  });

  // ── Chat list ─────────────────────────────────────────────────────────────
  const chatDisplayed = filtered.filter(e => {
    if (chatFilter === 'flagged') return flags.includes(e.id);
    if (chatFilter === 'low')     return e.iqs != null && e.iqs < 70;
    if (chatFilter === 'cbb')     return e.csat === '3' || e.csat === '1';
    return true;
  }).sort((a, b) => (b.scoredAt || b.date || '').localeCompare(a.scoredAt || a.date || ''));

  // ── Render ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-[#f5f3ee]">
        <p className="text-gray-400 text-sm animate-pulse">Loading your quality data…</p>
      </div>
    );
  }

  const iqsT = avgIqs != null ? iqsTheme(avgIqs) : null;

  return (
    <div className="min-h-screen bg-[#f5f3ee] font-sans antialiased">

      {/* ── Header ── */}
      <header className="sticky top-0 z-30 bg-white border-b border-gray-100 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-gray-400 hover:text-gray-600 transition">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 4L6 8l4 4"/></svg>
          </Link>
          <div className="w-px h-5 bg-gray-100" />
          <div>
            <h1 className="text-sm font-bold text-gray-900">My Quality Dashboard</h1>
            <p className="text-[11px] text-gray-400">Personal metrics · {selfAgentName || userEmail.split('@')[0]}</p>
          </div>
        </div>
        <div className="flex items-center bg-gray-100 rounded-lg p-0.5 gap-0.5">
          {(['today','7d','30d','90d'] as DateRange[]).map(r => (
            <button key={r} onClick={() => setDateRange(r)}
              className={`text-xs px-3 py-1.5 rounded-md font-semibold transition ${dateRange === r ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
              {r === 'today' ? 'Today' : r.toUpperCase()}
            </button>
          ))}
        </div>
      </header>

      <div className="px-6 py-5 space-y-5 max-w-[1400px] mx-auto">

        {/* ── Hero cards ── */}
        <div className="grid grid-cols-4 gap-4">

          {/* IQS */}
          <button
            onClick={() => setModal('iqs')}
            className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 text-left hover:shadow-md hover:border-[#2d9e4f]/30 transition-all group cursor-pointer"
          >
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-3">My IQS Score</p>
            {avgIqs != null ? (
              <div className="flex items-center gap-3">
                <IQSRing iqs={avgIqs} size={60} />
                <div>
                  <p className="text-2xl font-bold" style={{ color: iqsT?.text }}>{avgIqs}%</p>
                  <p className="text-xs font-semibold" style={{ color: iqsT?.text }}>{iqsT?.label}</p>
                  {tw.avgIqs != null && lw.avgIqs != null && (
                    <div className="flex items-center gap-1 mt-1">
                      {deltaIcon(tw.avgIqs - lw.avgIqs)}
                      <span className={`text-[10px] font-semibold ${tw.avgIqs > lw.avgIqs ? 'text-emerald-600' : tw.avgIqs < lw.avgIqs ? 'text-red-500' : 'text-gray-400'}`}>
                        {tw.avgIqs > lw.avgIqs ? '+' : ''}{tw.avgIqs - lw.avgIqs} vs last wk
                      </span>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-2xl font-bold text-gray-300">—</p>
            )}
            <p className="text-[11px] text-gray-400 mt-2">{scoredFiltered.length} scored chats</p>
            <p className="text-[10px] text-[#2d9e4f] font-semibold mt-1 opacity-0 group-hover:opacity-100 transition">View all scored chats →</p>
          </button>

          {/* CSAT */}
          <button
            onClick={() => setModal('csat')}
            className="bg-white rounded-2xl border-l-4 border-blue-400 border-t border-r border-b border-gray-100 shadow-sm p-5 text-left hover:shadow-md transition-all group cursor-pointer"
          >
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-3">My CSAT</p>
            <p className="text-3xl font-bold text-blue-600">{avgCsat != null ? `${avgCsat}%` : '—'}</p>
            {tw.avgCsat != null && lw.avgCsat != null && (
              <div className="flex items-center gap-1 mt-1.5">
                {deltaIcon(tw.avgCsat - lw.avgCsat)}
                <span className={`text-[11px] font-semibold ${tw.avgCsat >= lw.avgCsat ? 'text-emerald-600' : 'text-red-500'}`}>
                  {tw.avgCsat >= lw.avgCsat ? '+' : ''}{tw.avgCsat - lw.avgCsat}pp vs last week
                </span>
              </div>
            )}
            <p className="text-[11px] text-gray-400 mt-2">{ratedFiltered.length} rated conversations</p>
            <p className="text-[10px] text-blue-500 font-semibold mt-1 opacity-0 group-hover:opacity-100 transition">View rating breakdown →</p>
          </button>

          {/* Resolution Time (own vs team) */}
          <div className="bg-white rounded-2xl border-l-4 border-amber-400 border-t border-r border-b border-gray-100 shadow-sm p-5">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-3">Avg Resolution Time</p>
            <p className="text-3xl font-bold text-amber-600">{fmtDuration(avgRes)}</p>
            {teamAvg.avgResolution != null && (
              <div className="flex items-center gap-1 mt-1.5">
                {deltaIcon(teamAvg.avgResolution - (avgRes ?? 0))}
                <span className={`text-[11px] font-semibold ${(avgRes ?? 0) <= teamAvg.avgResolution ? 'text-emerald-600' : 'text-red-500'}`}>
                  Team avg: {fmtDuration(teamAvg.avgResolution)}
                </span>
              </div>
            )}
            <p className="text-[11px] text-gray-400 mt-2">{resVals.length} timed chats</p>
          </div>

          {/* Avg FRT */}
          <div className="bg-white rounded-2xl border-l-4 border-red-400 border-t border-r border-b border-gray-100 shadow-sm p-5">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-3">Avg FRT</p>
            <p className="text-3xl font-bold text-red-600">{fmtDuration(avgFrt)}</p>
            {tw.avgFrt != null && lw.avgFrt != null && (
              <div className="flex items-center gap-1 mt-1.5">
                {deltaIcon(lw.avgFrt - tw.avgFrt)}
                <span className={`text-[11px] font-semibold ${(tw.avgFrt ?? 0) <= (lw.avgFrt ?? 0) ? 'text-emerald-600' : 'text-red-500'}`}>
                  {tw.avgFrt <= lw.avgFrt ? 'Faster' : 'Slower'} than last week
                </span>
              </div>
            )}
            <p className="text-[11px] text-gray-400 mt-2">SLA target: ≤ 3 min</p>
          </div>

        </div>

        {/* ── Week-over-week comparison ── */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-baseline justify-between mb-4">
            <div>
              <h2 className="text-sm font-bold text-gray-900">This Week vs Last Week</h2>
              <p className="text-xs text-gray-400 mt-0.5">{thisWeek.from} – {thisWeek.to} vs {lastWeek.from} – {lastWeek.to}</p>
            </div>
            <span className="text-[10px] text-gray-400">Updated in real-time</span>
          </div>
          <div className="grid grid-cols-6 divide-x divide-gray-100 border border-gray-100 rounded-xl overflow-hidden">
            {[
              { label: 'IQS Score',   this: tw.avgIqs   != null ? `${tw.avgIqs}%` : '—', last: lw.avgIqs   != null ? `${lw.avgIqs}%`   : '—', delta: tw.avgIqs != null && lw.avgIqs != null ? tw.avgIqs - lw.avgIqs : null, unit: 'pts', inv: false },
              { label: 'CSAT',        this: tw.avgCsat  != null ? `${tw.avgCsat}%` : '—', last: lw.avgCsat  != null ? `${lw.avgCsat}%`  : '—', delta: tw.avgCsat != null && lw.avgCsat != null ? tw.avgCsat - lw.avgCsat : null, unit: 'pp', inv: false },
              { label: 'Chats',       this: String(tw.chats),  last: String(lw.chats),  delta: tw.chats - lw.chats, unit: '', inv: false },
              { label: 'Avg FRT',     this: fmtDuration(tw.avgFrt), last: fmtDuration(lw.avgFrt), delta: tw.avgFrt != null && lw.avgFrt != null ? lw.avgFrt - tw.avgFrt : null, unit: 's', inv: true },
              { label: 'Escalations', this: String(tw.escals), last: String(lw.escals), delta: lw.escals - tw.escals, unit: '', inv: true },
              { label: 'Resolution',  this: fmtDuration(tw.avgRes), last: fmtDuration(lw.avgRes), delta: tw.avgRes != null && lw.avgRes != null ? lw.avgRes - tw.avgRes : null, unit: 's', inv: true },
            ].map(col => (
              <div key={col.label} className="px-4 py-3">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">{col.label}</p>
                <p className="text-lg font-bold text-gray-900 tabular-nums">{col.this}</p>
                <p className="text-[11px] text-gray-400 tabular-nums">Last: {col.last}</p>
                {col.delta != null && (
                  <div className="flex items-center gap-1 mt-1">
                    {deltaIcon(col.delta, col.inv)}
                    <span className={`text-[10px] font-bold ${(col.inv ? col.delta > 0 : col.delta > 0) ? 'text-emerald-600' : col.delta < 0 ? 'text-red-500' : 'text-gray-400'}`}>
                      {col.delta > 0 ? '+' : ''}{col.delta}{col.unit}
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* ── Trend + params row ── */}
        <div className="grid grid-cols-[1.6fr_1fr] gap-4">

          {/* IQS trend (14 days) */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-sm font-bold text-gray-900">IQS Trend — Last 14 Days</h2>
                <p className="text-xs text-gray-400">Scored conversations only</p>
              </div>
              <div className="flex items-center gap-2 text-xs text-gray-400">
                <span className="inline-block w-2.5 h-2.5 rounded-sm bg-emerald-400" />≥80
                <span className="inline-block w-2.5 h-2.5 rounded-sm bg-amber-400 ml-2" />70–79
                <span className="inline-block w-2.5 h-2.5 rounded-sm bg-red-400 ml-2" />&lt;70
              </div>
            </div>
            <div className="flex items-end gap-1.5 h-24">
              {trend14.map(d => {
                const maxH = 96;
                const h = d.avg != null ? Math.max(8, Math.round((d.avg / 100) * maxH)) : 4;
                const color = d.avg == null ? '#e5e7eb' : d.avg >= 80 ? '#22c55e' : d.avg >= 70 ? '#f59e0b' : '#ef4444';
                return (
                  <div key={d.date} className="flex-1 flex flex-col items-center gap-1.5" title={d.avg != null ? `${d.date}: ${d.avg}%` : d.date}>
                    <div className="w-full rounded-t-sm hover:opacity-75 transition" style={{ height: h, background: color }} />
                    <span className="text-[8px] text-gray-400">{d.label}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Quality parameters */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <div className="mb-3">
              <h2 className="text-sm font-bold text-gray-900">Quality Parameters</h2>
              <p className="text-xs text-gray-400">Your pass rate · {dateRange}</p>
            </div>
            <div className="space-y-2">
              {paramRates.map(p => {
                const rate = p.rate;
                const color = rate == null ? '#e5e7eb' : rate >= 80 ? '#22c55e' : rate >= 60 ? '#f59e0b' : '#ef4444';
                const textColor = rate == null ? '#9ca3af' : rate >= 80 ? '#15803d' : rate >= 60 ? '#92400e' : '#b91c1c';
                return (
                  <div key={p.key}>
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-xs text-gray-600 font-medium truncate pr-2">{p.name}</span>
                      <span className="text-xs font-bold shrink-0 tabular-nums" style={{ color: textColor }}>
                        {rate != null ? `${rate}%` : '—'}
                      </span>
                    </div>
                    <div className="h-1.5 bg-gray-100 rounded-full">
                      <div className="h-1.5 rounded-full transition-all" style={{ width: `${rate ?? 0}%`, background: color }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* ── My chats table ── */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-gray-900">My Chats</h2>
              <p className="text-xs text-gray-400 mt-0.5">{filtered.length} conversations · click any row to see IQS detail</p>
            </div>
            <div className="flex items-center gap-1.5">
              {([['all','All'],['flagged','⚑ Flagged'],['low','Low IQS'],['cbb','CBB / Bad']] as const).map(([v, l]) => (
                <button key={v} onClick={() => setChatFilter(v)}
                  className={`text-xs px-3 py-1.5 rounded-lg font-semibold transition ${chatFilter === v ? 'bg-[#2d9e4f] text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
                  {l}
                </button>
              ))}
            </div>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50/60 border-b border-gray-100">
                {['Chat ID','Date','Type','CSAT','IQS','FRT','Resolution',''].map(col => (
                  <th key={col} className="text-left px-4 py-2.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {chatDisplayed.length === 0 && (
                <tr><td colSpan={8} className="text-center text-sm text-gray-400 py-12">
                  No chats found for this filter and period.
                </td></tr>
              )}
              {chatDisplayed.slice(0, 50).map(e => {
                const t = e.iqs != null ? iqsTheme(e.iqs) : null;
                const cs = csatLabel(e.csat);
                const isFlagged = flags.includes(e.id);
                return (
                  <tr key={e.id}
                    onClick={() => setDrawerEntry(e)}
                    className="border-b border-gray-50 hover:bg-gray-50/60 cursor-pointer transition">
                    <td className="px-4 py-3 font-mono text-xs text-[#2d9e4f] font-semibold">
                      {e.chatId}
                      {isFlagged && <span className="ml-2 text-amber-500 text-[10px]">⚑</span>}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">{e.scoredAt?.slice(0, 10) || e.date || '—'}</td>
                    <td className="px-4 py-3">{convTypeBadge(e.conversationType)}</td>
                    <td className="px-4 py-3">
                      {cs
                        ? <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${cs.cls}`}>{cs.label}</span>
                        : <span className="text-gray-300 text-xs">—</span>
                      }
                    </td>
                    <td className="px-4 py-3">
                      {t
                        ? <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: t.bg, color: t.text }}>{e.iqs}%</span>
                        : <span className="text-gray-300 text-xs">—</span>
                      }
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500 tabular-nums">{fmtDuration(e.frt)}</td>
                    <td className="px-4 py-3 text-xs text-gray-500 tabular-nums">{fmtDuration(e.resolutionTime)}</td>
                    <td className="px-4 py-3" onClick={ev => ev.stopPropagation()}>
                      <FlagButton entry={e} existingFlag={isFlagged} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {chatDisplayed.length > 50 && (
            <div className="px-5 py-3 border-t border-gray-50 text-xs text-gray-400">
              Showing 50 of {chatDisplayed.length} — use date filters to narrow down
            </div>
          )}
        </div>

      </div>

      {/* ── Modals ── */}
      <IQSModal
        open={modal === 'iqs'}
        onClose={() => setModal(null)}
        entries={entries}
        flags={flags}
      />
      <CSATModal
        open={modal === 'csat'}
        onClose={() => setModal(null)}
        entries={entries}
      />

      {/* ── Chat detail drawer ── */}
      <IQSDrawer
        entry={drawerEntry}
        onClose={() => setDrawerEntry(null)}
        flagged={drawerEntry ? flags.includes(drawerEntry.id) : false}
      />

    </div>
  );
}
