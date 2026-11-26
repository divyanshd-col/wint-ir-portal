'use client';

import React, { useEffect, useState } from 'react';
import { fmtDay } from '@/components/roster/ui';

export { fmtDay };
export type Half = 'full' | 'first' | 'second';
export const HALF_LABEL: Record<Half, string> = { full: 'Full day', first: 'First half', second: 'Second half' };
export const card: React.CSSProperties = { background: 'var(--qa-card)', border: '1px solid var(--qa-border)', borderRadius: 12, padding: 16 };
export const muted: React.CSSProperties = { fontSize: 12, color: 'var(--qa-text-3)' };

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string; status: number };
export async function api<T = unknown>(url: string, method = 'GET', body?: unknown): Promise<ApiResult<T>> {
  try {
    const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    return r.ok ? { ok: true, data: j as T } : { ok: false, error: (j as { error?: string }).error || 'Something went wrong. Try again.', status: r.status };
  } catch { return { ok: false, error: 'Couldn’t reach the server. Try again.', status: 0 }; }
}

/** Seconds left until an instant, ticking every second. Null when there is no target. */
export function useCountdown(target?: string | null): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { if (!target) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [target]);
  return target ? Math.max(0, Math.ceil((Date.parse(target) - now) / 1000)) : null;
}
export const fmtCountdown = (s: number) => { const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; const p = (n: number) => String(n).padStart(2, '0'); return h > 0 ? `${h}:${p(m)}:${p(x)}` : `${m}:${p(x)}`; };

/** 'Thu, 19 Nov 2026 · 3:06 pm IST' */
export function fmtWhen(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).replace(',', ',');
  const time = d.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true }).replace(/\s?(am|pm)/i, (_, ap) => ` ${ap.toLowerCase()}`);
  return `${date} · ${time} IST`;
}
export function fmtRange(start: string, end: string, sh: Half, eh: Half): string {
  if (start === end) return `${fmtDay(start)}${sh !== 'full' ? ` (${HALF_LABEL[sh].toLowerCase()})` : ''}`;
  return `${fmtDay(start)}${sh !== 'full' ? ` (${HALF_LABEL[sh].toLowerCase()})` : ''} to ${fmtDay(end)}${eh !== 'full' ? ` (${HALF_LABEL[eh].toLowerCase()})` : ''}`;
}
export const typeLabel = (leave: number, lop: number) => lop > 0 && leave > 0 ? 'Leave + LOP' : lop > 0 ? 'LOP' : 'Leave';

const TONE: Record<string, string> = { 'Approved': 'var(--pass)', 'Auto-approved': 'var(--pass)', 'Taken': 'var(--qa-text-2)', 'Rejected': 'var(--fail)', 'Auto-rejected': 'var(--fail)', 'Auto-cancelled': 'var(--qa-text-3)', 'Cancelled': 'var(--qa-text-3)', 'Cancelled (exit)': 'var(--qa-text-3)', 'Pending for approval': 'var(--marker)', 'In process': 'var(--marker)' };
/** One label and colour per status, always with the text. */
export function StatusBadge({ status }: { status: string }) {
  const c = TONE[status] ?? 'var(--qa-text-2)';
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: c, border: `1px solid ${c}`, borderRadius: 999, padding: '1px 9px', whiteSpace: 'nowrap' }}><i style={{ width: 6, height: 6, borderRadius: 3, background: c, display: 'inline-block' }} />{status}</span>;
}
export function CopyId({ id }: { id: string }) {
  const [done, setDone] = useState(false);
  return <button type="button" title="Copy leave ID" onClick={e => { e.stopPropagation(); try { void navigator.clipboard?.writeText(id); } catch { /* ignore */ } setDone(true); setTimeout(() => setDone(false), 1200); }}
    style={{ border: 0, background: 'transparent', cursor: 'pointer', fontFamily: 'monospace', fontSize: 12, color: 'var(--qa-text)', padding: 0, whiteSpace: 'nowrap' }}>{id} <span style={{ color: 'var(--qa-text-3)' }}>{done ? '✓' : '⧉'}</span></button>;
}
