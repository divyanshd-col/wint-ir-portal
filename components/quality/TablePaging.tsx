'use client';

import { useState } from 'react';
import { pageCount, pageSlice } from '@/lib/email/ui';

/** Client-side paging for the email tables. `resetKey` changes (tab, filters, period) send you back to page 1. */
export function usePaging<T>(items: T[], resetKey: string) {
  const [pageSize, setPageSize] = useState(20);
  const [page, setPage] = useState(1);
  const key = `${resetKey}|${pageSize}`;
  const [seenKey, setSeenKey] = useState(key);
  if (seenKey !== key) { // tab, filters, period or page size changed: back to page 1
    setSeenKey(key);
    setPage(1);
  }
  const pages = pageCount(items.length, pageSize);
  const current = Math.min(page, pages);
  return { pageItems: pageSlice(items, current, pageSize), page: current, pages, pageSize, setPageSize, setPage, total: items.length };
}

/** Right end of a table's filter bar, same as the chat tables: "Showing X of N" + rows-per-page button. */
export function ShowingCount({ shown, total, loading, pageSize, onPageSize }: {
  shown: number; total: number; loading?: boolean; pageSize: number; onPageSize: (n: number) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
      <span style={{ fontSize: 13, color: 'var(--qa-text-3)', whiteSpace: 'nowrap' }}>
        {loading ? 'Loading…' : `Showing ${shown} of ${total}`}
      </span>
      <div style={{ position: 'relative' }}>
        <button
          type="button"
          title="Rows per page"
          aria-label="Rows per page"
          onClick={() => setOpen(o => !o)}
          style={{
            width: 28, height: 28, border: '1px solid var(--qa-border)', borderRadius: 6,
            background: 'var(--qa-card)', color: 'var(--qa-text-2)', cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" />
            <line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
          </svg>
        </button>
        {open && (
          <div style={{
            position: 'absolute', right: 0, top: '100%', marginTop: 4, zIndex: 50, minWidth: 120,
            background: 'var(--qa-card)', border: '1px solid var(--qa-border)', borderRadius: 8,
            boxShadow: '0 4px 16px rgba(0,0,0,0.08)', overflow: 'hidden',
          }}>
            <div style={{ padding: '6px 14px 4px', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--qa-text-3)' }}>
              Rows per page
            </div>
            {[20, 50, 100].map(n => (
              <div
                key={n}
                onClick={() => { onPageSize(n); setOpen(false); }}
                style={{
                  padding: '8px 14px', fontSize: 13, cursor: 'pointer', color: 'var(--qa-text)',
                  fontWeight: pageSize === n ? 600 : 400, background: pageSize === n ? 'var(--qa-gray-50)' : 'transparent',
                }}
              >
                {pageSize === n && <span style={{ fontSize: 10 }}>✓ </span>}{n}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Table footer, same as the chat tables; renders nothing when everything fits on one page. */
export function Pager({ page, pages, onPage }: { page: number; pages: number; onPage: (p: number) => void }) {
  if (pages <= 1) return null;
  const btn = (disabled: boolean): React.CSSProperties => ({
    height: 30, padding: '0 12px', border: '1px solid var(--qa-border)', borderRadius: 6,
    background: 'var(--qa-card)', fontSize: 13, fontFamily: 'inherit',
    cursor: disabled ? 'not-allowed' : 'pointer', color: disabled ? 'var(--qa-text-3)' : 'var(--qa-text)',
  });
  return (
    <div style={{ padding: '12px 16px', borderTop: '1px solid var(--qa-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <span style={{ fontSize: 13, color: 'var(--qa-text-3)' }}>Page {page} of {pages}</span>
      <div style={{ display: 'flex', gap: 8 }}>
        <button disabled={page <= 1} onClick={() => onPage(page - 1)} style={btn(page <= 1)}>← Prev</button>
        <button disabled={page >= pages} onClick={() => onPage(page + 1)} style={btn(page >= pages)}>Next →</button>
      </div>
    </div>
  );
}
