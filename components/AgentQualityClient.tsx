'use client';

import { useState, useEffect, useCallback } from 'react';
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

function iqsColor(iqs: number) {
  if (iqs >= 90) return { text: '#15803d', bar: '#22c55e', label: 'Excellent' };
  if (iqs >= 80) return { text: '#92400e', bar: '#f59e0b', label: 'Good' };
  if (iqs >= 70) return { text: '#c2410c', bar: '#f97316', label: 'Average' };
  return { text: '#b91c1c', bar: '#ef4444', label: 'Needs work' };
}

function csatBadge(csat?: string) {
  if (csat === '5') return { label: 'Good',  cls: 'bg-emerald-50 text-emerald-700' };
  if (csat === '3') return { label: 'CBB',   cls: 'bg-stone-100 text-stone-600' };
  if (csat === '1') return { label: 'Bad',   cls: 'bg-red-50 text-red-600' };
  return null;
}

function typeBadge(type?: string) {
  if (type === 'bot') return <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-violet-50 text-violet-600">Bot</span>;
  if (type === 'hybrid') return <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-sky-50 text-sky-600">Hybrid</span>;
  return <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-stone-100 text-stone-500">Human</span>;
}

function delta(next: number | null, prev: number | null, inverse = false) {
  if (next == null || prev == null) return null;
  const d = next - prev;
  const good = inverse ? d < 0 : d > 0;
  if (d === 0) return <span className="text-stone-400 text-xs">–</span>;
  return (
    <span className={`text-xs font-semibold ${good ? 'text-emerald-600' : 'text-red-500'}`}>
      {d > 0 ? '+' : ''}{d}
    </span>
  );
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

function inRange(e: IQSScoreEntry, from: string, to: string) {
  const d = (e.scoredAt || e.date || '').slice(0, 10);
  return d >= from && d <= to;
}

// ── IQS Ring ──────────────────────────────────────────────────────────────────
function IQSRing({ iqs, size = 72 }: { iqs: number; size?: number }) {
  const c = iqsColor(iqs);
  const r = (size - 8) / 2;
  const circ = 2 * Math.PI * r;
  const dash = (iqs / 100) * circ;
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#f1f5f9" strokeWidth={6} />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={c.bar} strokeWidth={6}
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round" />
      </svg>
      <span className="absolute text-xs font-bold tabular-nums" style={{ color: c.text }}>{iqs}%</span>
    </div>
  );
}

// ── Challenge (flag) modal ────────────────────────────────────────────────────
function ChallengeButton({ entry }: { entry: IQSScoreEntry }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState('');

  async function submit() {
    if (!note.trim()) { setErr('Describe what seems wrong.'); return; }
    setBusy(true); setErr('');
    try {
      const res = await fetch('/api/quality/flag', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scoreId: entry.id, chatId: entry.chatId, agentNote: note }),
      });
      const d = await res.json();
      if (d.error) { setErr(d.error); return; }
      setDone(true); setOpen(false);
    } catch { setErr('Request failed.'); }
    finally { setBusy(false); }
  }

  if (done) return (
    <span className="text-xs font-semibold text-stone-500 bg-stone-100 border border-stone-200 px-3 py-1.5 rounded-lg">
      Sent to quality team
    </span>
  );

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="text-xs font-semibold text-stone-500 hover:text-stone-800 border border-stone-200 hover:border-stone-400 px-3 py-1.5 rounded-lg transition"
      >
        Challenge score
      </button>

      {open && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center px-4" onClick={() => setOpen(false)}>
          <div className="fixed inset-0 bg-black/25" />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 z-[71]" onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-stone-900 mb-1">Challenge this IQS score</h3>
            <p className="text-xs text-stone-500 mb-4">Chat #{entry.chatId} · IQS {entry.iqs}% — tell us what seems incorrect</p>
            <textarea
              value={note} onChange={e => setNote(e.target.value)} rows={4}
              placeholder="e.g. I greeted the customer in my first message — the opening parameter should be Yes."
              className="w-full border border-stone-200 rounded-xl px-3.5 py-3 text-sm text-stone-800 focus:outline-none focus:ring-2 focus:ring-stone-300 resize-none"
            />
            {err && <p className="text-xs text-red-500 mt-1.5">{err}</p>}
            <div className="flex gap-2 mt-4">
              <button onClick={submit} disabled={busy}
                className="flex-1 py-2.5 bg-stone-800 hover:bg-stone-900 text-white text-sm font-semibold rounded-xl disabled:opacity-50 transition">
                {busy ? 'Sending…' : 'Send to Quality'}
              </button>
              <button onClick={() => setOpen(false)}
                className="px-4 py-2.5 border border-stone-200 text-stone-500 rounded-xl text-sm hover:bg-stone-50 transition">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── Chat detail drawer ────────────────────────────────────────────────────────
function ChatDrawer({ entry, onClose }: { entry: IQSScoreEntry | null; onClose: () => void }) {
  const [transcript, setTranscript] = useState<string | null>(null);
  const [loadingTx, setLoadingTx] = useState(false);
  const [txOpen, setTxOpen] = useState(true);

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

  useEffect(() => {
    if (entry) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = '';
    return () => { document.body.style.overflow = ''; };
  }, [entry]);

  if (!entry) return null;
  const c = iqsColor(entry.iqs);
  const cs = csatBadge(entry.csat);

  const failedParams = PARAM_ORDER.filter(p => entry.scores?.[p] === 'No');
  const passedParams = PARAM_ORDER.filter(p => entry.scores?.[p] === 'Yes');
  const naParams     = PARAM_ORDER.filter(p => !entry.scores?.[p] || entry.scores[p] === 'NA');

  // Parse transcript into messages
  const messages: { sender: string; content: string }[] = [];
  if (transcript) {
    transcript.split('\n').forEach(line => {
      const t = line.trim();
      if (!t) return;
      const m = t.match(/^([^:]+):\s*(.+)$/);
      if (m) messages.push({ sender: m[1].trim(), content: m[2].trim() });
      else if (messages.length) messages[messages.length - 1].content += ' ' + t;
    });
  }

  const isAgent = (s: string) => !['user','customer','visitor','myra','bot','wintbot'].includes(s.toLowerCase());

  const ROBYLON_BASE = 'https://app.robylon.ai/unified-inbox/share';
  const chatUrl = /^\d+$/.test(entry.chatId.trim()) ? `${ROBYLON_BASE}/${entry.chatId}` : null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="fixed inset-0 bg-black/20" onClick={onClose} />
      <div className="relative bg-white w-full max-w-2xl h-full flex flex-col shadow-2xl" style={{ zIndex: 51 }}>

        {/* Header */}
        <div className="px-5 py-4 border-b border-stone-100 shrink-0 flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              {chatUrl
                ? <a href={chatUrl} target="_blank" rel="noopener noreferrer"
                    className="text-xs font-mono text-emerald-600 hover:underline flex items-center gap-1">
                    #{entry.chatId}
                    <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M5 2H2a1 1 0 00-1 1v7a1 1 0 001 1h7a1 1 0 001-1V8M8 1h3m0 0v3m0-3L5 7" />
                    </svg>
                  </a>
                : <span className="text-xs font-mono text-stone-500">#{entry.chatId}</span>
              }
              <span className="text-stone-300">·</span>
              <span className="text-xs text-stone-500">{(entry.scoredAt || entry.date || '').slice(0, 10)}</span>
              {typeBadge(entry.conversationType)}
            </div>
            <div className="flex items-center gap-2.5">
              <span className="text-2xl font-bold tabular-nums" style={{ color: c.text }}>{entry.iqs}%</span>
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-stone-100 text-stone-600">{c.label}</span>
              {cs && <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${cs.cls}`}>{cs.label}</span>}
            </div>
            <p className="text-[11px] text-stone-400 mt-1">
              {entry.frt != null && <>FRT {fmtDuration(entry.frt)}</>}
              {entry.resolutionTime != null && <> · Res {fmtDuration(entry.resolutionTime)}</>}
              {entry.disposition && <> · {entry.disposition}</>}
            </p>
          </div>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-700 text-xl leading-none ml-4">×</button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">

          {/* Summary */}
          {entry.summary && (
            <div className="bg-stone-50 rounded-xl p-3.5 text-xs text-stone-700 leading-relaxed border border-stone-100">
              <p className="text-[10px] font-bold text-stone-400 uppercase tracking-wider mb-1.5">AI Summary</p>
              {entry.summary}
            </div>
          )}

          {/* Failed parameters — most important, shown first */}
          {failedParams.length > 0 && (
            <div>
              <p className="text-[10px] font-bold text-stone-400 uppercase tracking-wider mb-2">
                Needs improvement ({failedParams.length})
              </p>
              <div className="space-y-2">
                {failedParams.map(p => (
                  <div key={p} className="bg-red-50 border border-red-100 rounded-xl px-4 py-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-semibold text-stone-800">{PARAM_NAMES[p]}</span>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] text-stone-400">{Math.round((WEIGHTS[p] || 0) * 100)}%</span>
                        <span className="text-red-500 font-bold text-sm">✗</span>
                      </div>
                    </div>
                    {entry.reasoning?.[p] && (
                      <p className="text-xs text-stone-600 leading-relaxed">{entry.reasoning[p]}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Passed parameters */}
          {passedParams.length > 0 && (
            <div>
              <p className="text-[10px] font-bold text-stone-400 uppercase tracking-wider mb-2">
                Passed ({passedParams.length})
              </p>
              <div className="border border-stone-100 rounded-xl overflow-hidden">
                {passedParams.map((p, i) => (
                  <div key={p} className={`flex items-start justify-between px-4 py-2.5 ${i < passedParams.length - 1 ? 'border-b border-stone-50' : ''}`}>
                    <div className="min-w-0">
                      <span className="text-xs font-medium text-stone-700">{PARAM_NAMES[p]}</span>
                      {entry.reasoning?.[p] && (
                        <p className="text-[10px] text-stone-400 mt-0.5 leading-snug">{entry.reasoning[p]}</p>
                      )}
                    </div>
                    <div className="ml-3 shrink-0 flex items-center gap-1.5">
                      <span className="text-[10px] text-stone-300">{Math.round((WEIGHTS[p] || 0) * 100)}%</span>
                      <span className="text-emerald-500 font-bold text-sm">✓</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* NA parameters — collapsed */}
          {naParams.length > 0 && (
            <p className="text-[10px] text-stone-400">
              {naParams.map(p => PARAM_NAMES[p]).join(', ')} — marked N/A
            </p>
          )}

          {/* Transcript */}
          <div className="border border-stone-100 rounded-xl overflow-hidden">
            <button
              onClick={() => setTxOpen(o => !o)}
              className="w-full flex items-center justify-between px-4 py-3 bg-stone-50 text-left hover:bg-stone-100 transition"
            >
              <span className="text-[10px] font-bold text-stone-400 uppercase tracking-wider">Transcript</span>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5"
                className={`transition-transform ${txOpen ? 'rotate-180' : ''}`}>
                <path d="M2 4l4 4 4-4"/>
              </svg>
            </button>
            {txOpen && (
              <div className="px-4 py-3 max-h-72 overflow-y-auto space-y-2">
                {loadingTx && <p className="text-xs text-stone-400 animate-pulse">Loading…</p>}
                {!loadingTx && messages.length === 0 && <p className="text-xs text-stone-400">No transcript available.</p>}
                {messages.map((msg, i) => {
                  const agent = isAgent(msg.sender);
                  return (
                    <div key={i} className={`flex ${agent ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[80%] rounded-xl px-3 py-2 ${agent ? 'bg-emerald-50 text-emerald-900' : 'bg-stone-100 text-stone-700'}`}>
                        <p className="text-[9px] font-bold uppercase tracking-wide mb-1 opacity-60">{msg.sender}</p>
                        <p className="text-xs leading-relaxed">{msg.content}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Challenge */}
          <div className="pt-1 flex items-start justify-between">
            <div>
              <ChallengeButton entry={entry} />
              <p className="text-[10px] text-stone-400 mt-1.5 max-w-[280px]">
                If you disagree with the AI score, send it to the quality team for review.
              </p>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

interface TeamAvg {
  avgIqs: number | null;
  avgFrt: number | null;
  avgResolution: number | null;
  avgCsat: number | null;
  top3ParamRates: Record<string, number | null>;
  top3Count: number;
}

type DateRange = 'today' | '7d' | '30d' | '90d';
type ChatFilter = 'all' | 'low' | 'cbb' | 'flagged';

interface Props {
  userEmail: string;
  selfAgentName?: string;
}

export default function AgentQualityClient({ userEmail, selfAgentName }: Props) {
  const [entries, setEntries] = useState<IQSScoreEntry[]>([]);
  const [teamAvg, setTeamAvg] = useState<TeamAvg | null>(null);
  const [flags, setFlags] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState<DateRange>('30d');
  const [chatFilter, setChatFilter] = useState<ChatFilter>('all');
  const [drawerEntry, setDrawerEntry] = useState<IQSScoreEntry | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [sRes, tRes, fRes] = await Promise.all([
        fetch('/api/quality/scores'),
        fetch('/api/quality/team-avg'),
        fetch('/api/quality/flag'),
      ]);
      const [sData, tData, fData] = await Promise.all([sRes.json(), tRes.json(), fRes.json()]);
      setEntries(Array.isArray(sData.entries) ? sData.entries : []);
      setTeamAvg(tData);
      if (Array.isArray(fData.flags)) setFlags(fData.flags.map((f: any) => f.scoreId));
    } catch {}
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Date filtering ────────────────────────────────────────────────────────
  function dateBounds(r: DateRange) {
    const to = new Date().toISOString().slice(0, 10);
    if (r === 'today') return { from: to, to };
    if (r === '7d')  return { from: new Date(Date.now() -  7 * 86400000).toISOString().slice(0, 10), to };
    if (r === '30d') return { from: new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10), to };
    return { from: new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10), to };
  }
  const { from, to } = dateBounds(dateRange);
  const filtered = entries.filter(e => { const d = (e.scoredAt || e.date || '').slice(0, 10); return d >= from && d <= to; });

  // ── KPI calculations ──────────────────────────────────────────────────────
  const scored    = filtered.filter(e => e.iqs != null);
  const avgIqs    = scored.length ? Math.round(scored.reduce((s, e) => s + e.iqs, 0) / scored.length) : null;
  const rated     = filtered.filter(e => ['5','3','1'].includes(e.csat || ''));
  const csatNums: number[]  = rated.map(e => e.csat === '5' ? 100 : e.csat === '3' ? 50 : 0);
  const avgCsat   = csatNums.length ? Math.round(csatNums.reduce((s, n) => s + n, 0) / csatNums.length) : null;
  const resVals   = filtered.map(e => e.resolutionTime).filter((v): v is number => typeof v === 'number');
  const avgRes    = resVals.length ? Math.round(resVals.reduce((s, n) => s + n, 0) / resVals.length) : null;
  const frtVals   = filtered.map(e => e.frt).filter((v): v is number => typeof v === 'number');
  const avgFrt    = frtVals.length ? Math.round(frtVals.reduce((s, n) => s + n, 0) / frtVals.length) : null;

  // ── Week-over-week ────────────────────────────────────────────────────────
  const tw = getWeekBounds(0);
  const lw = getWeekBounds(1);

  function wkStats(entries: IQSScoreEntry[]) {
    const s = entries.filter(e => inRange(e, tw.from, tw.to));
    const l = entries.filter(e => inRange(e, lw.from, lw.to));
    const stat = (arr: IQSScoreEntry[]) => {
      const iq = arr.filter(e => e.iqs != null).map(e => e.iqs);
      const cs = arr.reduce<number[]>((a, e) => { if (e.csat === '5') a.push(100); else if (e.csat === '3') a.push(50); else if (e.csat === '1') a.push(0); return a; }, []);
      return {
        avgIqs:  iq.length ? Math.round(iq.reduce((a, v) => a + v, 0) / iq.length) : null,
        avgCsat: cs.length ? Math.round(cs.reduce((a, v) => a + v, 0) / cs.length) : null,
        chats: arr.length,
      };
    };
    return { this: stat(s), last: stat(l) };
  }
  const wow = wkStats(entries);

  // ── My parameter pass rates ───────────────────────────────────────────────
  const myParamRates: Record<string, number | null> = {};
  for (const p of PARAM_ORDER) {
    const relevant = scored.filter(e => e.scores?.[p] != null && e.scores[p] !== 'NA');
    const yes      = relevant.filter(e => e.scores[p] === 'Yes').length;
    myParamRates[p] = relevant.length ? Math.round((yes / relevant.length) * 100) : null;
  }

  // Sort params: failed/low first
  const paramsSorted = [...PARAM_ORDER].sort((a, b) => {
    const ra = myParamRates[a] ?? 101, rb = myParamRates[b] ?? 101;
    return ra - rb;
  });

  // ── Chat list ─────────────────────────────────────────────────────────────
  const displayed = filtered.filter(e => {
    if (chatFilter === 'low')     return e.iqs != null && e.iqs < 70;
    if (chatFilter === 'cbb')     return e.csat === '3' || e.csat === '1';
    if (chatFilter === 'flagged') return flags.includes(e.id);
    return true;
  }).sort((a, b) => (b.scoredAt || b.date || '').localeCompare(a.scoredAt || a.date || ''));

  // ── Improvement areas ─────────────────────────────────────────────────────
  const top3 = teamAvg?.top3ParamRates ?? {};
  const gaps = PARAM_ORDER
    .filter(p => myParamRates[p] != null && top3[p] != null && (top3[p]! - myParamRates[p]!) >= 10)
    .sort((a, b) => (top3[b]! - myParamRates[b]!) - (top3[a]! - myParamRates[a]!))
    .slice(0, 3);

  if (loading) return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <p className="text-stone-400 text-sm animate-pulse">Loading your quality data…</p>
    </div>
  );

  const iqsC = avgIqs != null ? iqsColor(avgIqs) : null;

  return (
    <div className="space-y-5">

      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-base font-bold text-stone-800">My Quality</h1>
          <p className="text-xs text-stone-500 mt-0.5">{selfAgentName || userEmail.split('@')[0]}</p>
        </div>
        <div className="flex items-center bg-stone-100 rounded-lg p-0.5 gap-0.5">
          {(['today','7d','30d','90d'] as DateRange[]).map(r => (
            <button key={r} onClick={() => setDateRange(r)}
              className={`text-xs px-3 py-1.5 rounded-md font-semibold transition ${dateRange === r ? 'bg-white text-stone-800 shadow-sm' : 'text-stone-500 hover:text-stone-700'}`}>
              {r === 'today' ? 'Today' : r.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* ── KPI cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">

        {/* IQS */}
        <div className="bg-white rounded-2xl border border-stone-100 p-5">
          <p className="text-[10px] font-bold text-stone-400 uppercase tracking-wider mb-3">IQS Score</p>
          {avgIqs != null ? (
            <div className="flex items-center gap-3">
              <IQSRing iqs={avgIqs} size={56} />
              <div>
                <p className="text-2xl font-bold leading-none tabular-nums" style={{ color: iqsC?.text }}>{avgIqs}<span className="text-sm">%</span></p>
                <p className="text-xs text-stone-400 mt-0.5">{iqsC?.label}</p>
              </div>
            </div>
          ) : <p className="text-2xl font-bold text-stone-300">—</p>}
          <p className="text-[10px] text-stone-400 mt-2">{scored.length} scored chats</p>
        </div>

        {/* CSAT */}
        <div className="bg-white rounded-2xl border border-stone-100 p-5">
          <p className="text-[10px] font-bold text-stone-400 uppercase tracking-wider mb-3">CSAT</p>
          <p className="text-2xl font-bold text-stone-800 tabular-nums">{avgCsat != null ? `${avgCsat}%` : '—'}</p>
          <div className="flex items-center gap-2 mt-1.5">
            {delta(wow.this.avgCsat, wow.last.avgCsat)}
            {wow.this.avgCsat != null && <span className="text-[10px] text-stone-400">vs last wk</span>}
          </div>
          <p className="text-[10px] text-stone-400 mt-1">{rated.length} rated</p>
        </div>

        {/* Chats */}
        <div className="bg-white rounded-2xl border border-stone-100 p-5">
          <p className="text-[10px] font-bold text-stone-400 uppercase tracking-wider mb-3">Chats Handled</p>
          <p className="text-2xl font-bold text-stone-800 tabular-nums">{filtered.length}</p>
          <div className="flex items-center gap-2 mt-1.5">
            {delta(wow.this.chats, wow.last.chats)}
            {<span className="text-[10px] text-stone-400">vs last wk</span>}
          </div>
          <p className="text-[10px] text-stone-400 mt-1">in selected period</p>
        </div>

        {/* Resolution */}
        <div className="bg-white rounded-2xl border border-stone-100 p-5">
          <p className="text-[10px] font-bold text-stone-400 uppercase tracking-wider mb-3">Avg Resolution</p>
          <p className="text-2xl font-bold text-stone-800 tabular-nums">{fmtDuration(avgRes)}</p>
          {avgFrt != null && <p className="text-[10px] text-stone-400 mt-1.5">FRT {fmtDuration(avgFrt)}</p>}
          {teamAvg?.avgResolution != null && avgRes != null && (
            <p className="text-[10px] text-stone-400 mt-1">
              Team avg {fmtDuration(teamAvg.avgResolution)}
              {avgRes > teamAvg.avgResolution
                ? <span className="text-red-500 ml-1">↑ slower</span>
                : <span className="text-emerald-600 ml-1">↓ faster</span>
              }
            </p>
          )}
        </div>
      </div>

      {/* ── Middle row: params + wow ── */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-4">

        {/* Parameter benchmark */}
        <div className="bg-white rounded-2xl border border-stone-100 p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-bold text-stone-800">Quality Parameters</h2>
              <p className="text-xs text-stone-400 mt-0.5">Your pass rate vs top-3 benchmark</p>
            </div>
            <div className="flex items-center gap-3 text-[10px] text-stone-400">
              <span className="flex items-center gap-1">
                <span className="inline-block w-2.5 h-2.5 rounded-sm bg-emerald-400" />Mine
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block w-1 h-3 rounded-sm bg-stone-300" />Top 3
              </span>
            </div>
          </div>

          <div className="space-y-3">
            {paramsSorted.map(p => {
              const mine = myParamRates[p];
              const bench = top3[p] ?? null;
              const gap = mine != null && bench != null ? bench - mine : null;
              const barColor = mine == null ? '#e5e7eb' : mine >= 80 ? '#22c55e' : mine >= 60 ? '#f59e0b' : '#ef4444';
              const textColor = mine == null ? '#9ca3af' : mine >= 80 ? '#15803d' : mine >= 60 ? '#92400e' : '#b91c1c';

              return (
                <div key={p}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-stone-600 font-medium truncate pr-2">{PARAM_NAMES[p]}</span>
                    <div className="flex items-center gap-2 shrink-0">
                      {gap != null && gap > 0 && (
                        <span className="text-[9px] text-stone-400">−{gap}pp</span>
                      )}
                      <span className="text-xs font-bold tabular-nums" style={{ color: textColor }}>
                        {mine != null ? `${mine}%` : '—'}
                      </span>
                    </div>
                  </div>
                  <div className="relative h-1.5 bg-stone-100 rounded-full">
                    <div className="h-1.5 rounded-full transition-all" style={{ width: `${mine ?? 0}%`, background: barColor }} />
                    {bench != null && (
                      <div className="absolute top-0 bottom-0 w-0.5 bg-stone-400 rounded-full" style={{ left: `${bench}%`, transform: 'translateX(-50%)' }} />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* WoW + improvement areas */}
        <div className="space-y-4">

          {/* Week comparison */}
          <div className="bg-white rounded-2xl border border-stone-100 p-5">
            <h2 className="text-sm font-bold text-stone-800 mb-3">This week vs last week</h2>
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: 'IQS', this: wow.this.avgIqs, last: wow.last.avgIqs, fmt: (v: number | null) => v != null ? `${v}%` : '—' },
                { label: 'CSAT', this: wow.this.avgCsat, last: wow.last.avgCsat, fmt: (v: number | null) => v != null ? `${v}%` : '—' },
                { label: 'Chats', this: wow.this.chats, last: wow.last.chats, fmt: (v: number | null) => String(v ?? 0) },
              ].map(col => (
                <div key={col.label}>
                  <p className="text-[10px] font-bold text-stone-400 uppercase tracking-wider mb-1">{col.label}</p>
                  <p className="text-lg font-bold text-stone-800 tabular-nums">{col.fmt(col.this)}</p>
                  <p className="text-[10px] text-stone-400 tabular-nums">Last: {col.fmt(col.last)}</p>
                  <div className="mt-1">{delta(col.this, col.last)}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Improvement focus */}
          {gaps.length > 0 && (
            <div className="bg-white rounded-2xl border border-stone-100 p-5">
              <h2 className="text-sm font-bold text-stone-800 mb-1">Focus areas</h2>
              <p className="text-[10px] text-stone-400 mb-3">Biggest gaps vs top-3 benchmark</p>
              <div className="space-y-2.5">
                {gaps.map(p => {
                  const mine = myParamRates[p]!;
                  const bench = top3[p]!;
                  return (
                    <div key={p} className="flex items-center justify-between">
                      <span className="text-xs text-stone-700 font-medium">{PARAM_NAMES[p]}</span>
                      <div className="flex items-center gap-2 text-xs tabular-nums">
                        <span className="text-stone-800 font-semibold">{mine}%</span>
                        <span className="text-stone-300">vs</span>
                        <span className="text-stone-500">{bench}%</span>
                        <span className="text-red-500 font-semibold text-[10px]">−{bench - mine}pp</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* CBB/Bad quick stat */}
          {rated.length > 0 && (
            <div className="bg-white rounded-2xl border border-stone-100 p-5">
              <h2 className="text-sm font-bold text-stone-800 mb-3">CSAT breakdown</h2>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: 'Good', count: rated.filter(e => e.csat === '5').length, color: 'text-emerald-600' },
                  { label: 'CBB',  count: rated.filter(e => e.csat === '3').length, color: 'text-stone-600' },
                  { label: 'Bad',  count: rated.filter(e => e.csat === '1').length, color: 'text-red-500' },
                ].map(s => (
                  <div key={s.label} className="text-center">
                    <p className={`text-xl font-bold tabular-nums ${s.color}`}>{s.count}</p>
                    <p className="text-[10px] text-stone-400">{s.label}</p>
                    <p className="text-[10px] text-stone-300">{rated.length > 0 ? Math.round(s.count / rated.length * 100) : 0}%</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Chat log ── */}
      <div className="bg-white rounded-2xl border border-stone-100 overflow-hidden">
        <div className="px-5 py-4 border-b border-stone-100 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-stone-800">My Chats</h2>
            <p className="text-xs text-stone-400 mt-0.5">Click any row to see IQS breakdown and transcript</p>
          </div>
          <div className="flex items-center gap-1.5">
            {([['all','All'],['low','Low IQS'],['cbb','CBB / Bad'],['flagged','Flagged']] as const).map(([v, l]) => (
              <button key={v} onClick={() => setChatFilter(v)}
                className={`text-xs px-3 py-1.5 rounded-lg font-semibold transition ${chatFilter === v ? 'bg-stone-800 text-white' : 'bg-stone-100 text-stone-500 hover:bg-stone-200'}`}>
                {l}
              </button>
            ))}
          </div>
        </div>

        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-stone-100 bg-stone-50/60">
              {['Chat','Date','Type','CSAT','IQS','FRT','Resolution',''].map(col => (
                <th key={col} className="text-left px-4 py-2.5 text-[10px] font-semibold text-stone-400 uppercase tracking-wider">{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {displayed.length === 0 && (
              <tr><td colSpan={8} className="text-center text-sm text-stone-400 py-14">
                No chats for this filter and period.
              </td></tr>
            )}
            {displayed.slice(0, 60).map(e => {
              const c = e.iqs != null ? iqsColor(e.iqs) : null;
              const cs = csatBadge(e.csat);
              const isFlagged = flags.includes(e.id);
              return (
                <tr key={e.id} onClick={() => setDrawerEntry(e)}
                  className="border-b border-stone-50 hover:bg-stone-50/70 cursor-pointer transition">
                  <td className="px-4 py-3 font-mono text-xs text-emerald-600 font-semibold">
                    {e.chatId}{isFlagged && <span className="ml-1.5 text-stone-400 text-[10px]">⚑</span>}
                  </td>
                  <td className="px-4 py-3 text-xs text-stone-500">{(e.scoredAt || e.date || '').slice(0, 10)}</td>
                  <td className="px-4 py-3">{typeBadge(e.conversationType)}</td>
                  <td className="px-4 py-3">
                    {cs
                      ? <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${cs.cls}`}>{cs.label}</span>
                      : <span className="text-stone-300 text-xs">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    {c
                      ? <span className="text-xs font-bold tabular-nums" style={{ color: c.text }}>{e.iqs}%</span>
                      : <span className="text-stone-300 text-xs">—</span>}
                  </td>
                  <td className="px-4 py-3 text-xs text-stone-500 tabular-nums">{fmtDuration(e.frt)}</td>
                  <td className="px-4 py-3 text-xs text-stone-500 tabular-nums">{fmtDuration(e.resolutionTime)}</td>
                  <td className="px-4 py-3">
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-stone-300">
                      <path d="M5 2h5m0 0v5m0-5L2 10"/>
                    </svg>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {displayed.length > 60 && (
          <div className="px-5 py-3 border-t border-stone-50 text-xs text-stone-400">
            Showing 60 of {displayed.length} — narrow the date range to see more
          </div>
        )}
      </div>

      {/* ── Chat drawer ── */}
      <ChatDrawer entry={drawerEntry} onClose={() => setDrawerEntry(null)} />

    </div>
  );
}
