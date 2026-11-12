'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import DateRangePicker from '@/components/quality/DateRangePicker';
import { ticketUrl } from '@/lib/sla-breach';

type Period = '7d' | '30d' | 'custom';

interface Summary {
  emailsReceived: number;
  repliedWithinPct: number | null;
  breaches: number;
  lateReplies: number;
  avgTatHours: number | null;
  medianTatHours: number | null;
  unansweredPast24h: number;
}
interface Breach {
  chatId: string; ticketId: string; customerAt: string; repliedAt: string | null; noteAt: string | null; lastEventAt: string | null; missingAgentMessages: number; hoursLate: number; status: string | null; closedAfterCustomer: boolean;
}
interface Payload { range: { from: string; to: string }; generatedAt: string; summary: Summary; breaches: Breach[] }

const EARLIEST = '2026-10-01';   // SLA analytics start (matches lib/sla-analytics.ts)
const PAGE_SIZE = 25;

// ── dates: the portal works in IST days ──────────────────────────────────────────
const istDay = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d);   // YYYY-MM-DD
const addDays = (day: string, n: number) => { const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const clampStart = (day: string) => (day < EARLIEST ? EARLIEST : day);
const fmtDay = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' });
const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });

/** "45m", "6.2h", "1d 4h" */
function fmtHours(h: number | null): string {
  if (h === null) return '—';
  if (h < 1) return `${Math.max(1, Math.round(h * 60))}m`;
  if (h < 24) return `${Math.round(h * 10) / 10}h`;
  return `${Math.floor(h / 24)}d ${Math.round(h % 24)}h`;
}

const csvCell = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;

function downloadCsv(rows: Breach[], rangeLabel: string) {
  const head = ['Ticket', 'Customer wrote (IST)', 'Agent replied (IST)', 'Hours late', 'Status', 'Closed after customer responded', 'Last Robylon update (IST)', 'Agent messages missing from our data', 'Robylon link'];
  const lines = rows.map(b => [
    b.ticketId, fmtWhen(b.customerAt), b.repliedAt ? fmtWhen(b.repliedAt) : b.noteAt ? `Note added ${fmtWhen(b.noteAt)}` : 'No reply yet', b.hoursLate, b.status ?? '', b.closedAfterCustomer ? 'Yes' : 'No', b.lastEventAt ? fmtWhen(b.lastEventAt) : '', b.missingAgentMessages || '', ticketUrl(b.chatId),
  ].map(csvCell).join(','));
  const blob = new Blob([[head.map(csvCell).join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `sla-breaches ${rangeLabel.replace(/[^\w-]+/g, '_')}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function Card({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'bad' | 'good' }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
      <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">{label}</p>
      <p className={`mt-2 text-3xl font-bold tabular-nums ${tone === 'bad' ? 'text-red-600' : tone === 'good' ? 'text-[#1f7a4d]' : 'text-gray-900'}`}>{value}</p>
      {sub && <p className="mt-1 text-xs text-gray-400">{sub}</p>}
    </div>
  );
}

export default function SlaAnalyticsDashboard() {
  const [period, setPeriod] = useState<Period>('7d');
  const [custom, setCustom] = useState<{ from: string; to: string } | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [includeClosed, setIncludeClosed] = useState(false);   // "Closed after customer responded": off by default
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const reqId = useRef(0);

  const range = useMemo(() => {
    const today = istDay(new Date());
    if (period === 'custom' && custom) return { from: clampStart(custom.from), to: custom.to };
    return { from: clampStart(addDays(today, period === '30d' ? -29 : -6)), to: today };
  }, [period, custom]);

  const load = useCallback(async () => {
    const id = ++reqId.current;
    setLoading(true); setError('');
    try {
      const qs = new URLSearchParams({ from: range.from, to: range.to, ...(includeClosed ? { closed: '1' } : {}) });
      const res = await fetch(`/api/cx/admin/sla-analytics?${qs}`, { cache: 'no-store' });
      const body = await res.json().catch(() => ({}));
      if (id !== reqId.current) return;   // a newer request replaced this one
      if (!res.ok) throw new Error(body.error || 'Could not load SLA analytics');
      setData(body); setPage(1);
    } catch (e) {
      if (id === reqId.current) setError(e instanceof Error ? e.message : 'Could not load SLA analytics');
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, [range, includeClosed]);

  useEffect(() => { load(); }, [load]);

  const s = data?.summary;
  const rangeLabel = `${fmtDay(range.from)} – ${fmtDay(range.to)}`;
  const breaches = data?.breaches ?? [];
  const pages = Math.max(1, Math.ceil(breaches.length / PAGE_SIZE));
  const shown = breaches.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const periodBtn = (p: Period, label: string) => (
    <button key={p} type="button" aria-pressed={period === p}
      onClick={() => { if (p === 'custom') setShowPicker(true); else { setPeriod(p); setShowPicker(false); } }}
      className={`px-3.5 py-1.5 text-xs font-semibold transition ${period === p ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
      {label}
    </button>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-gray-100 pb-4">
        <div>
          <h1 className="text-[22px] font-bold text-gray-900 tracking-tight">SLA / TAT Analytics</h1>
          <p className="mt-1.5 text-[13px] text-gray-500 max-w-2xl">
            Email replies against a <strong>24-hour SLA</strong>. Every customer email has its own clock, from when it reached us to the agent&apos;s first reply.
            Data starts on 1 Oct 2026.
          </p>
        </div>

        <div className="relative flex flex-wrap items-center gap-3">
          <div className="inline-flex rounded-lg overflow-hidden border border-gray-200 divide-x divide-gray-200">
            {periodBtn('7d', 'Last 7 Days')}
            {periodBtn('30d', 'Last 30 Days')}
            {periodBtn('custom', period === 'custom' && custom ? `${fmtDay(range.from)} – ${fmtDay(range.to)}` : 'Custom range')}
          </div>
          {showPicker && (
            <div className="absolute right-0 top-full mt-2 z-40">
              <DateRangePicker
                align="right"
                initialFrom={custom?.from}
                initialTo={custom?.to}
                onApply={(from, to) => { setCustom({ from, to }); setPeriod('custom'); setShowPicker(false); }}
                onCancel={() => setShowPicker(false)}
              />
            </div>
          )}
        </div>
      </div>

      <label className="flex items-start gap-2.5 text-sm text-gray-700 cursor-pointer w-fit">
        <input type="checkbox" checked={includeClosed} onChange={e => setIncludeClosed(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[#1f7a4d]" />
        <span>
          <span className="font-semibold">Closed after customer responded</span>
          <span className="block text-xs text-gray-400">
            Include customer emails with no reply on tickets that are now Closed or Resolved (mostly closing &ldquo;thanks&rdquo; emails). Off by default.
          </span>
        </span>
      </label>

      {error && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 flex items-center justify-between gap-3">
          <span>{error}</span>
          <button type="button" onClick={load} className="font-semibold underline">Retry</button>
        </div>
      )}

      <div className={`grid grid-cols-2 lg:grid-cols-3 gap-4 transition-opacity ${loading ? 'opacity-50' : ''}`} aria-busy={loading}>
        <Card label="Customer emails received" value={s ? s.emailsReceived.toLocaleString() : '—'} sub={rangeLabel} />
        <Card label="Replied within 24h" value={s?.repliedWithinPct != null ? `${s.repliedWithinPct}%` : '—'}
          sub="of emails answered or past their 24h" tone={s?.repliedWithinPct != null ? (s.repliedWithinPct >= 90 ? 'good' : 'bad') : undefined} />
        <Card label="SLA breaches" value={s ? s.breaches.toLocaleString() : '—'}
          sub={s ? `${s.lateReplies.toLocaleString()} late replies · ${(s.breaches - s.lateReplies).toLocaleString()} unanswered` : undefined} tone={s && s.breaches > 0 ? 'bad' : undefined} />
        <Card label="Average TAT" value={fmtHours(s?.avgTatHours ?? null)} sub="customer email to first reply" />
        <Card label="Median TAT" value={fmtHours(s?.medianTatHours ?? null)} sub="half of replies are faster" />
        <Card label="Unanswered past 24h now" value={s ? s.unansweredPast24h.toLocaleString() : '—'}
          sub="open tickets, in the selected dates" tone={s && s.unansweredPast24h > 0 ? 'bad' : undefined} />
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-sm font-bold text-gray-900">Breached emails</h2>
            <p className="text-xs text-gray-400 mt-0.5">One row per breached customer email, worst first. {rangeLabel}.</p>
          </div>
          <button type="button" disabled={!breaches.length} onClick={() => downloadCsv(breaches, `${range.from} to ${range.to}`)}
            className="px-3.5 py-1.5 text-xs font-semibold rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:hover:bg-transparent">
            Export CSV ({breaches.length.toLocaleString()})
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-gray-400 border-b border-gray-100">
                <th className="px-5 py-3 font-semibold">Ticket</th>
                <th className="px-3 py-3 font-semibold">Customer wrote</th>
                <th className="px-3 py-3 font-semibold">Agent replied</th>
                <th className="px-3 py-3 font-semibold text-right">Hours late</th>
                <th className="px-5 py-3 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {shown.map(b => (
                <tr key={`${b.chatId}-${b.customerAt}`} className="hover:bg-gray-50/60">
                  <td className="px-5 py-2.5">
                    <a href={ticketUrl(b.chatId)} target="_blank" rel="noopener noreferrer" title={b.ticketId}
                      className="font-mono text-xs text-[#1f7a4d] hover:underline">{b.ticketId.length > 14 ? `${b.ticketId.slice(0, 8)}…` : b.ticketId} ↗</a>
                  </td>
                  <td className="px-3 py-2.5 text-gray-700 whitespace-nowrap">{fmtWhen(b.customerAt)}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    {b.repliedAt ? <span className="text-gray-700">{fmtWhen(b.repliedAt)}</span>
                      : b.noteAt ? <span className="text-gray-700" title="An internal note was added; no reply was sent">Note added <span className="text-gray-400">· {fmtWhen(b.noteAt)}</span></span>
                      : <span className="font-semibold text-red-600">No reply yet</span>}
                    {!b.repliedAt && b.lastEventAt && <span className="block text-[11px] text-gray-400">Last Robylon update {fmtWhen(b.lastEventAt)}</span>}
                    {!b.repliedAt && b.missingAgentMessages > 0 && (
                      <span className="mt-0.5 inline-block text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded"
                        title="Robylon's message count shows agent messages we never received. A reply may exist; check the ticket in Robylon.">
                        {b.missingAgentMessages} agent message{b.missingAgentMessages > 1 ? 's' : ''} missing from our data
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-red-600">{fmtHours(b.hoursLate)}</td>
                  <td className="px-5 py-2.5 text-gray-600">
                    {b.status ?? '—'}
                    {b.closedAfterCustomer && <span className="ml-2 text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">Closed after customer responded</span>}
                  </td>
                </tr>
              ))}
              {!loading && !error && breaches.length === 0 && (
                <tr><td colSpan={5} className="px-5 py-10 text-center text-sm text-gray-400">No SLA breaches in this period.</td></tr>
              )}
              {loading && !data && (
                <tr><td colSpan={5} className="px-5 py-10 text-center text-sm text-gray-400">Loading…</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {pages > 1 && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100 text-xs text-gray-500">
            <span>{(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, breaches.length)} of {breaches.length.toLocaleString()}</span>
            <div className="flex items-center gap-2">
              <button type="button" disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="px-2.5 py-1 rounded-md border border-gray-200 disabled:opacity-40">Previous</button>
              <span>Page {page} of {pages}</span>
              <button type="button" disabled={page >= pages} onClick={() => setPage(p => p + 1)} className="px-2.5 py-1 rounded-md border border-gray-200 disabled:opacity-40">Next</button>
            </div>
          </div>
        )}
      </div>

      <p className="text-xs text-gray-400">
        The agent&apos;s response is the first reply sent, internal forward, or other agent message after the customer&apos;s email (internal notes do not count);
        failing those, the ticket moving to Answered or Pending email sent. Tickets an agent starts count only from the customer&apos;s reply.
        Tickets in Repayment, Hold, WAITING_ON_AGENT or Entity Escalation are left out. Times are IST.
        A reply Robylon never sent us cannot be seen here; &ldquo;Last Robylon update&rdquo; on unanswered rows shows how fresh our copy of the ticket is.
        {data && <> Updated {fmtWhen(data.generatedAt)}.</>}
      </p>
    </div>
  );
}
