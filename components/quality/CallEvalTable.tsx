'use client';
import React, { useState, useEffect, useCallback } from 'react';
import CallEvalPanel from './CallEvalPanel';
import DateRangePicker from './DateRangePicker';
import type { CallToReviewRow } from '@/app/api/cx/qa/calls-to-review/route';

interface Props {
  dispositions:   string[];
  onCountChange?: (count: number) => void;
  agentFilter?:   'all' | 'human_only';
  initialCallId?: string;
  onCallNotFound?: () => void;
}

const chip: React.CSSProperties = {
  height: 32, padding: '0 10px',
  borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--qa-border)',
  borderRadius: 8,
  background: 'var(--qa-card)', color: 'var(--qa-text)', fontSize: 13, fontFamily: 'inherit',
  display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', whiteSpace: 'nowrap',
  position: 'relative',
};
const chipActive: React.CSSProperties = {
  ...chip, background: 'var(--qa-gray-700)', color: '#fff', borderColor: 'var(--qa-gray-700)',
};
const dropdown: React.CSSProperties = {
  position: 'absolute', top: '100%', left: 0, zIndex: 40, marginTop: 4,
  background: 'var(--qa-card)', border: '1px solid var(--qa-border)', borderRadius: 8,
  boxShadow: '0 4px 12px rgba(0,0,0,0.08)', minWidth: 200, maxHeight: 280,
  overflowY: 'auto', padding: '6px 0',
};
const dropItem: React.CSSProperties = {
  padding: '8px 14px', fontSize: 13, color: 'var(--qa-text)', cursor: 'pointer',
  display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap',
};

function fmtDateShort(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

function fmtDuration(secs: number | null) {
  if (secs == null) return '—';
  const m = Math.floor(secs / 60), s = secs % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

const CALL_PARAM_NAMES: Record<string, string> = {
  P1: 'Technical Legal', P2: 'All Questions Addressed', P3: 'Expectation Setting', P5: 'Call Opening',
  P6: 'Call Closing', P7: 'No Repeat Asks', P8: 'Simplifying & Jargon', P9: 'Active Listening & Interrupts',
  P10: 'Fillers & Dead Air', P11: 'Energy, Warmth & Pace'
};

const CallEvalRow = React.memo(function CallEvalRow({
  call,
  isExpanded,
  onToggleExpand,
  onRemoveCall,
  onCloseExpand,
  td,
  tdMono,
  tdNum,
  tdAct,
}: {
  call: CallToReviewRow;
  isExpanded: boolean;
  onToggleExpand: (callId: string) => void;
  onRemoveCall: (callId: string) => void;
  onCloseExpand: () => void;
  td: React.CSSProperties;
  tdMono: React.CSSProperties;
  tdNum: React.CSSProperties;
  tdAct: React.CSSProperties;
}) {
  return (
    <React.Fragment>
      <tr
        onClick={() => onToggleExpand(call.callId)}
        style={{ background: isExpanded ? 'var(--qa-gray-50)' : undefined, cursor: 'pointer' }}
        onMouseEnter={e => { if (!isExpanded) e.currentTarget.style.background = 'var(--qa-fill-light)'; }}
        onMouseLeave={e => { if (!isExpanded) e.currentTarget.style.background = ''; }}
      >
        <td style={tdMono}>
          <div>{call.callId}</div>
          {call.calledAt && (
            <div style={{ fontSize: 11, color: 'var(--qa-text-3)', marginTop: 2 }}>
              {new Date(call.calledAt).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}
            </div>
          )}
        </td>
        <td style={{ ...td, fontWeight: 500 }}>{call.agentName}</td>
        <td style={tdMono}>{call.mobileNumber || <span style={{ color: 'var(--qa-text-3)' }}>—</span>}</td>
        <td style={td}>{call.disposition}</td>
        <td style={td} onClick={e => e.stopPropagation()}>
          {call.chatId ? (
            <a
              href={`https://app.robylon.ai/unified-inbox/share/${call.chatId}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '2px 8px',
                fontSize: 12,
                fontWeight: 500,
                borderRadius: 6,
                border: '1px solid var(--qa-border)',
                background: 'var(--qa-card)',
                color: '#2563eb',
                textDecoration: 'none',
                whiteSpace: 'nowrap',
              }}
              title={`Open chat ${call.chatId} in Robylon`}
            >
              Show chat ↗
            </a>
          ) : (
            <span style={{ color: 'var(--qa-text-3)', fontSize: 13 }}>—</span>
          )}
        </td>
        <td style={tdNum}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            minWidth: 36, height: 22, borderRadius: 6, fontSize: 12,
            fontFamily: 'ui-monospace, monospace',
            background: call.iqsScore && call.iqsScore < 60 ? '#fee2e2' : '#fef9c3',
            color:      call.iqsScore && call.iqsScore < 60 ? '#b91c1c' : '#713f12',
          }}>
            {call.iqsScore ?? '—'}
          </span>
        </td>
        <td style={td}>
          <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            height: 18,
            padding: '0 5px',
            borderRadius: 4,
            fontSize: 10,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            background: call.status === 'reopened' ? '#f3e8ff' : '#e0f2fe',
            color: call.status === 'reopened' ? '#6b21a8' : '#0369a1',
          }}>
            {call.status}
          </span>
        </td>
        <td style={tdAct}>
          <button
            onClick={e => { e.stopPropagation(); onToggleExpand(call.callId); }}
            style={{
              background: 'none', border: 0, padding: 0,
              fontFamily: 'inherit', fontSize: 13, fontWeight: 500,
              color: 'var(--qa-text)', cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', gap: 4,
            }}
          >
            Evaluate
            <span style={{
              fontSize: 11, color: 'var(--qa-text-2)',
              transform: isExpanded ? 'rotate(180deg)' : 'none',
              transition: 'transform 0.15s', display: 'inline-block',
            }}>▾</span>
          </button>
        </td>
      </tr>

      {isExpanded && (
        <CallEvalPanel
          callId={call.callId}
          chatId={call.chatId}
          agentName={call.agentName}
          iqsScore={call.iqsScore || 0}
          calledAt={call.calledAt}
          disposition={call.disposition}
          gates={call.gates}
          iqsScores={call.iqsScores}
          mode="submit"
          allowReevaluate={true}
          onDone={() => onRemoveCall(call.callId)}
          onClose={onCloseExpand}
          mobileNumber={call.mobileNumber}
          colSpan={8}
        />
      )}
    </React.Fragment>
  );
});

type SortCol = 'callId' | 'agentName' | 'iqsScore';

export default function CallEvalTable({ dispositions, onCountChange, agentFilter = 'all', initialCallId, onCallNotFound }: Props) {
  const [sortCol, setSortCol] = useState<SortCol | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const [callIdSearch, setCallIdSearch] = useState(initialCallId || '');
  const [dispFilter, setDispFilter] = useState<string[]>([]);
  const [iqsMin, setIqsMin] = useState('');
  const [iqsMax, setIqsMax] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [showPicker, setShowPicker] = useState(false);
  const [openDrop, setOpenDrop] = useState<string | null>(null);

  const [calls, setCalls] = useState<CallToReviewRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const autoExpandedRef = React.useRef(false);

  const fetchData = useCallback(async (pg = 1, ps = pageSize) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(pg), limit: String(ps) });
      if (callIdSearch) params.set('call_id', callIdSearch);
      params.set('agent_filter', agentFilter);
      dispFilter.forEach(d => params.append('disposition_filter', d));
      if (iqsMin) params.set('iqs_min', iqsMin);
      if (iqsMax) params.set('iqs_max', iqsMax);
      if (statusFilter) params.set('status', statusFilter);
      if (customFrom) params.set('from', customFrom);
      if (customTo) params.set('to', customTo);

      const res = await fetch(`/api/cx/qa/calls-to-review?${params}`);
      if (!res.ok) return;
      const data = await res.json();
      const fetchedCalls: CallToReviewRow[] = data.calls ?? [];
      setCalls(fetchedCalls);
      setTotal(data.total ?? 0);
      setPage(pg);
      onCountChange?.(data.total ?? 0);

      if (!autoExpandedRef.current && initialCallId) {
        autoExpandedRef.current = true;
        const match = fetchedCalls.find(c => c.callId === initialCallId) || fetchedCalls[0];
        if (match) {
          setExpandedId(match.callId);
        } else if (onCallNotFound) {
          onCallNotFound();
        }
      }
    } finally {
      setLoading(false);
    }
  }, [callIdSearch, dispFilter, iqsMin, iqsMax, statusFilter, customFrom, customTo, onCountChange, pageSize, agentFilter, initialCallId, onCallNotFound]);

  useEffect(() => { fetchData(1); }, [fetchData]);

  const toggleExpand = useCallback((callId: string) => {
    setExpandedId(prev => prev === callId ? null : callId);
  }, []);

  const removeCall = useCallback((callId: string) => {
    setCalls(prev => prev.filter(c => c.callId !== callId));
    setTotal(prev => {
      const nextTotal = Math.max(0, prev - 1);
      onCountChange?.(nextTotal);
      return nextTotal;
    });
    setExpandedId(null);
  }, [onCountChange]);

  const closeExpand = useCallback(() => {
    setExpandedId(null);
  }, []);

  const sortedCalls = [...calls].sort((a, b) => {
    if (!sortCol) return 0;
    let cmp = 0;
    if (sortCol === 'callId') cmp = a.callId.localeCompare(b.callId);
    if (sortCol === 'agentName') cmp = a.agentName.localeCompare(b.agentName);
    if (sortCol === 'iqsScore') cmp = (a.iqsScore ?? 0) - (b.iqsScore ?? 0);
    return sortDir === 'asc' ? cmp : -cmp;
  });

  const th: React.CSSProperties = {
    height: 40, background: 'var(--qa-gray-50)', borderBottom: '1px solid var(--qa-border)',
    fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--qa-text-2)',
    fontWeight: 500, textAlign: 'left', padding: '0 12px', whiteSpace: 'nowrap',
  };
  const thBtn: React.CSSProperties = {
    background: 'none', border: 'none', padding: 0, cursor: 'pointer',
    fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em',
    color: 'var(--qa-text-2)', fontWeight: 500, fontFamily: 'inherit',
    display: 'inline-flex', alignItems: 'center', gap: 4,
  };
  const td: React.CSSProperties = {
    height: 48, padding: '0 12px', borderBottom: '1px solid var(--qa-border-sub)',
    fontSize: 13, color: 'var(--qa-text)', verticalAlign: 'middle',
  };
  const tdMono: React.CSSProperties = { ...td, fontFamily: 'ui-monospace, monospace', fontSize: 12, color: 'var(--qa-text-2)' };
  const tdNum: React.CSSProperties  = { ...td, textAlign: 'right', fontFamily: 'ui-monospace, monospace', fontSize: 12 };
  const tdAct: React.CSSProperties  = { ...td, textAlign: 'right', width: 100 };

  return (
    <div style={{ background: 'var(--qa-card)', border: '1px solid var(--qa-border)', borderRadius: 8 }}>
      {/* Filter bar */}
      <div style={{
        minHeight: 56, background: 'var(--qa-card)', borderBottom: '1px solid var(--qa-border)',
        display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, padding: '8px 16px',
        borderRadius: '8px 8px 0 0',
      }}>
        <input
          placeholder="Search by Call ID…"
          value={callIdSearch}
          onChange={e => setCallIdSearch(e.target.value)}
          style={{
            height: 32, padding: '0 10px', border: `1px solid ${callIdSearch ? 'var(--qa-gray-700)' : 'var(--qa-border)'}`, borderRadius: 8,
            background: 'var(--qa-card)', color: 'var(--qa-text)', fontSize: 13, fontFamily: 'inherit',
            outline: 'none', width: 140
          }}
        />

        <div style={{ position: 'relative' }} onClick={e => e.stopPropagation()}>
          <button style={dispFilter.length ? chipActive : chip} onClick={() => setOpenDrop(openDrop === 'disp' ? null : 'disp')}>
            {dispFilter.length > 0 ? `${dispFilter.length} dispositions` : 'Disposition'}
            <span style={{ fontSize: 9 }}>▾</span>
          </button>
          {openDrop === 'disp' && (
            <div style={dropdown} onClick={e => e.stopPropagation()}>
              <div style={dropItem} onClick={() => setDispFilter([])}>Clear</div>
              {dispositions.map(d => {
                const checked = dispFilter.includes(d);
                return (
                  <div key={d} style={dropItem} onClick={() => setDispFilter(prev => checked ? prev.filter(x => x !== d) : [...prev, d])}>
                    <span style={{ fontSize: 10 }}>{checked ? '☑' : '☐'}</span> {d}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div style={{ position: 'relative' }} onClick={e => e.stopPropagation()}>
          <button style={statusFilter ? chipActive : chip} onClick={() => setOpenDrop(openDrop === 'status' ? null : 'status')}>
            {statusFilter || 'Status'} <span style={{ fontSize: 9 }}>▾</span>
          </button>
          {openDrop === 'status' && (
            <div style={dropdown} onClick={e => e.stopPropagation()}>
              <div style={dropItem} onClick={() => setStatusFilter('')}>All</div>
              <div style={dropItem} onClick={() => setStatusFilter('pending')}>Pending</div>
              <div style={dropItem} onClick={() => setStatusFilter('reopened')}>Reopened</div>
            </div>
          )}
        </div>

        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontSize: 12, color: 'var(--qa-text-3)' }}>IQS</span>
          <input
            placeholder="min"
            value={iqsMin}
            onChange={e => setIqsMin(e.target.value)}
            style={{ height: 32, width: 52, padding: '0 8px', textAlign: 'center', border: '1px solid var(--qa-border)', borderRadius: 8, background: 'var(--qa-card)', color: 'var(--qa-text)', fontSize: 13 }}
          />
          <input
            placeholder="max"
            value={iqsMax}
            onChange={e => setIqsMax(e.target.value)}
            style={{ height: 32, width: 52, padding: '0 8px', textAlign: 'center', border: '1px solid var(--qa-border)', borderRadius: 8, background: 'var(--qa-card)', color: 'var(--qa-text)', fontSize: 13 }}
          />
        </div>

        <div style={{ position: 'relative' }} onClick={e => e.stopPropagation()}>
          <button style={customFrom ? chipActive : chip} onClick={() => setShowPicker(v => !v)}>
            {customFrom && customTo ? `${fmtDateShort(customFrom)} – ${fmtDateShort(customTo)}` : 'Date range'}
            <span style={{ fontSize: 9 }}>▾</span>
          </button>
          {showPicker && (
            <DateRangePicker
              onApply={(from, to) => { setCustomFrom(from); setCustomTo(to); setShowPicker(false); }}
              onCancel={() => setShowPicker(false)}
            />
          )}
        </div>

        <button style={chip} onClick={() => {
          setCallIdSearch(''); setDispFilter([]); setIqsMin(''); setIqsMax(''); setStatusFilter(''); setCustomFrom(''); setCustomTo('');
        }}>Reset</button>

        <div style={{ flex: 1 }} />

        {/* Rows per page selector + count */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <span style={{ fontSize: 13, color: 'var(--qa-text-3)', whiteSpace: 'nowrap' }}>
            {loading ? 'Loading…' : `Showing ${calls.length} of ${total}`}
          </span>
          <div style={{ position: 'relative' }} onClick={e => e.stopPropagation()}>
            <button
              title="Rows per page"
              onClick={() => setOpenDrop(openDrop === 'pagesize' ? null : 'pagesize')}
              style={{
                width: 28, height: 28, border: '1px solid var(--qa-border)', borderRadius: 6,
                background: 'var(--qa-card)', color: 'var(--qa-text-2)', cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/>
                <line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
              </svg>
            </button>
            {openDrop === 'pagesize' && (
              <div style={{ ...dropdown, right: 0, left: 'auto', minWidth: 120 }} onClick={e => e.stopPropagation()}>
                <div style={{ padding: '6px 14px 4px', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--qa-text-3)' }}>
                  Rows per page
                </div>
                {[20, 50, 100].map(n => (
                  <div
                    key={n}
                    style={{ ...dropItem, fontWeight: pageSize === n ? 600 : 400 }}
                    onClick={() => { setPageSize(n); fetchData(1, n); setOpenDrop(null); }}
                  >
                    {pageSize === n && <span style={{ fontSize: 10 }}>✓</span>} {n}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>Call ID</th>
              <th style={th}>Agent</th>
              <th style={th}>Mobile</th>
              <th style={th}>Disposition</th>
              <th style={th}>Linked Chat</th>
              <th style={{ ...th, textAlign: 'right' }}>IQS</th>
              <th style={th}>Status</th>
              <th style={{ ...th, textAlign: 'right' }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} style={{ ...td, textAlign: 'center' }}>Loading…</td></tr>
            ) : sortedCalls.length === 0 ? (
              <tr><td colSpan={8} style={{ ...td, textAlign: 'center' }}>No calls pending review</td></tr>
            ) : (
              sortedCalls.map(c => (
                <CallEvalRow
                  key={c.callId}
                  call={c}
                  isExpanded={expandedId === c.callId}
                  onToggleExpand={toggleExpand}
                  onRemoveCall={removeCall}
                  onCloseExpand={closeExpand}
                  td={td}
                  tdMono={tdMono}
                  tdNum={tdNum}
                  tdAct={tdAct}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Footer */}
      {total > pageSize && !loading && (
        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--qa-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 13, color: 'var(--qa-text-3)' }}>Page {page} of {Math.ceil(total / pageSize)}</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button disabled={page <= 1} onClick={() => fetchData(page - 1)} style={{
              height: 30, padding: '0 12px', border: '1px solid var(--qa-border)', borderRadius: 6,
              background: 'var(--qa-card)', fontSize: 13, fontFamily: 'inherit', cursor: page <= 1 ? 'not-allowed' : 'pointer',
              color: page <= 1 ? 'var(--qa-text-3)' : 'var(--qa-text)',
            }}>← Prev</button>
            <button disabled={page >= Math.ceil(total / pageSize)} onClick={() => fetchData(page + 1)} style={{
              height: 30, padding: '0 12px', border: '1px solid var(--qa-border)', borderRadius: 6,
              background: 'var(--qa-card)', fontSize: 13, fontFamily: 'inherit', cursor: page >= Math.ceil(total / pageSize) ? 'not-allowed' : 'pointer',
              color: page >= Math.ceil(total / pageSize) ? 'var(--qa-text-3)' : 'var(--qa-text)',
            }}>Next →</button>
          </div>
        </div>
      )}
    </div>
  );
}
