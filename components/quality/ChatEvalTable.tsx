'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { PARAM_NAMES, PARAM_ORDER } from '@/lib/quality';
import EvalPanel from './EvalPanel';
import DateRangePicker from './DateRangePicker';
import type { ChatToReviewRow } from '@/app/api/cx/qa/chats-to-review/route';

interface Props {
  dispositions:   string[];
  onCountChange?: (count: number) => void;
  agentFilter?:   'bot_only' | 'all' | 'human_only';
}

// ── Chip / filter styles ──────────────────────────────────────────────────────
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
  return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

// Sub-dispositions derived from loaded data
function buildSubMap(chats: ChatToReviewRow[]): Record<string, string[]> {
  const m: Record<string, string[]> = {};
  for (const c of chats) {
    if (c.disposition && c.subDisposition) {
      if (!m[c.disposition]) m[c.disposition] = [];
      if (!m[c.disposition].includes(c.subDisposition)) m[c.disposition].push(c.subDisposition);
    }
  }
  return m;
}

type SortCol = 'chatId' | 'agentName' | 'iqsScore' | 'callIqsScore';
type SortDir = 'asc' | 'desc';

export default function ChatEvalTable({ dispositions, onCountChange, agentFilter = 'human_only' }: Props) {
  // ── Sort state ────────────────────────────────────────────────────────────
  const [sortCol, setSortCol] = useState<SortCol | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  function toggleSort(col: SortCol) {
    if (sortCol === col) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortCol(col);
      setSortDir('asc');
    }
  }

  // ── Filter state ──────────────────────────────────────────────────────────
  const [chatIdSearch,  setChatIdSearch]  = useState('');
  const [dispFilter,    setDispFilter]    = useState<string[]>([]);
  const [subDispFilter, setSubDispFilter] = useState<string[]>([]);
  const [iqsMin,        setIqsMin]        = useState('');
  const [iqsMax,        setIqsMax]        = useState('');
  const [csatFilter,    setCsatFilter]    = useState<number[]>([]);
  const [paramFail,     setParamFail]     = useState('');
  const [statusFilter,  setStatusFilter]  = useState('');
  const [customFrom,    setCustomFrom]    = useState('');
  const [customTo,      setCustomTo]      = useState('');
  const [showPicker,    setShowPicker]    = useState(false);

  // ── Dropdown open state ───────────────────────────────────────────────────
  const [openDrop, setOpenDrop] = useState<string | null>(null);

  // ── Data state ────────────────────────────────────────────────────────────
  const [chats,    setChats]    = useState<ChatToReviewRow[]>([]);
  const [total,    setTotal]    = useState(0);
  const [page,     setPage]     = useState(1);
  const [pageSize, setPageSize] = useState(5);
  const [loading,  setLoading]  = useState(true);

  // ── Expanded row state ────────────────────────────────────────────────────
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // ── Sub-disposition map ───────────────────────────────────────────────────
  const [subMap, setSubMap] = useState<Record<string, string[]>>({});

  const fetchData = useCallback(async (pg = 1, ps = pageSize) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(pg), limit: String(ps) });
      if (chatIdSearch)  params.set('chat_id',            chatIdSearch);
      params.set('agent_filter', agentFilter);
      dispFilter.forEach(d => params.append('disposition_filter', d));
      subDispFilter.forEach(s => params.append('sub_disposition', s));
      if (iqsMin)        params.set('iqs_min',            iqsMin);
      if (iqsMax)        params.set('iqs_max',            iqsMax);
      if (paramFail)     params.set('param_fail',         paramFail);
      if (statusFilter)  params.set('status',             statusFilter);
      csatFilter.forEach(v => params.append('csat', String(v)));
      if (customFrom)    params.set('from', customFrom);
      if (customTo)      params.set('to',   customTo);

      const url = `/api/cx/qa/chats-to-review?${params}`;
      console.log('[ChatEvalTable] fetch', url);
      const res = await fetch(url);
      if (!res.ok) {
        console.error('[ChatEvalTable] fetch failed', res.status, await res.text());
        return;
      }
      const data = await res.json();
      console.log('[ChatEvalTable] result', { total: data.total, chatsLen: data.chats?.length });
      setChats(data.chats ?? []);
      setTotal(data.total ?? 0);
      setPage(pg);
      setSubMap(prev => ({ ...prev, ...buildSubMap(data.chats ?? []) }));
      onCountChange?.(data.total ?? 0);
    } finally {
      setLoading(false);
    }
  }, [chatIdSearch, dispFilter, subDispFilter, iqsMin, iqsMax, csatFilter, paramFail, statusFilter, customFrom, customTo, onCountChange, pageSize, agentFilter]);

  useEffect(() => { fetchData(1); }, [fetchData]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!openDrop) return;
    const handler = () => setOpenDrop(null);
    setTimeout(() => document.addEventListener('click', handler), 0);
    return () => document.removeEventListener('click', handler);
  }, [openDrop]);

  function toggleExpand(chatId: string) {
    setExpandedId(prev => prev === chatId ? null : chatId);
  }

  function removeChat(chatId: string) {
    setChats(prev => prev.filter(c => c.chatId !== chatId));
    setTotal(prev => Math.max(0, prev - 1));
    setExpandedId(null);
    onCountChange?.(Math.max(0, total - 1));
  }

  // ── Sorted view of current page ──────────────────────────────────────────
  const sortedChats = [...chats].sort((a, b) => {
    if (!sortCol) return 0;
    let cmp = 0;
    if (sortCol === 'chatId')    cmp = a.chatId.localeCompare(b.chatId);
    if (sortCol === 'agentName') cmp = a.agentName.localeCompare(b.agentName);
    if (sortCol === 'iqsScore')  cmp = a.iqsScore - b.iqsScore;
    if (sortCol === 'callIqsScore')  cmp = (a.callIqsScore ?? 0) - (b.callIqsScore ?? 0);
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

  function SortIcon({ col }: { col: SortCol }) {
    if (sortCol !== col) return <span style={{ opacity: 0.3 }}>↕</span>;
    return <span>{sortDir === 'asc' ? '↑' : '↓'}</span>;
  }

  const hasFilters = !!(
    chatIdSearch ||
    dispFilter.length ||
    subDispFilter.length ||
    iqsMin ||
    iqsMax ||
    csatFilter.length ||
    paramFail ||
    statusFilter ||
    customFrom ||
    customTo
  );


  return (
    <div style={{ background: 'var(--qa-card)', border: '1px solid var(--qa-border)', borderRadius: 8 }}>

      {/* Filter bar — overflow: visible so dropdowns are not clipped */}
      <div style={{
        minHeight: 56, background: 'var(--qa-card)', borderBottom: '1px solid var(--qa-border)',
        display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, padding: '8px 16px',
        borderRadius: '8px 8px 0 0',
      }}>

        {/* Search by Chat ID */}
        <input
          placeholder="Search by Chat ID…"
          value={chatIdSearch}
          onChange={e => setChatIdSearch(e.target.value)}
          style={{
            height: 32, padding: '0 10px', border: `1px solid ${chatIdSearch ? 'var(--qa-gray-700)' : 'var(--qa-border)'}`, borderRadius: 8,
            background: 'var(--qa-card)', color: 'var(--qa-text)', fontSize: 13, fontFamily: 'inherit',
            outline: 'none', width: 140
          }}
        />

        {/* Disposition filter — multi-select */}
        <div style={{ position: 'relative' }} onClick={e => e.stopPropagation()}>
          <button style={dispFilter.length ? chipActive : chip} onClick={() => setOpenDrop(openDrop === 'disp' ? null : 'disp')}>
            {dispFilter.length > 0 ? `${dispFilter.length} disposition${dispFilter.length > 1 ? 's' : ''}` : 'Disposition'}
            <span style={{ fontSize: 9 }}>▾</span>
          </button>
          {openDrop === 'disp' && (
            <div style={dropdown} onClick={e => e.stopPropagation()}>
              <div style={dropItem} onClick={() => { setDispFilter([]); setSubDispFilter([]); }}>
                Clear
              </div>
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

        {/* Sub-disposition filter — multi-select, shown when dispositions selected */}
        {dispFilter.length > 0 && (() => {
          const allSubs = [...new Set(dispFilter.flatMap(d => subMap[d] ?? []))];
          if (!allSubs.length) return null;
          return (
            <div style={{ position: 'relative' }} onClick={e => e.stopPropagation()}>
              <button style={subDispFilter.length ? chipActive : chip} onClick={() => setOpenDrop(openDrop === 'sub' ? null : 'sub')}>
                {subDispFilter.length > 0 ? `${subDispFilter.length} sub-disp` : 'Sub-disposition'}
                <span style={{ fontSize: 9 }}>▾</span>
              </button>
              {openDrop === 'sub' && (
                <div style={dropdown} onClick={e => e.stopPropagation()}>
                  <div style={dropItem} onClick={() => { setSubDispFilter([]); setOpenDrop(null); }}>Clear</div>
                  {allSubs.map(s => {
                    const checked = subDispFilter.includes(s);
                    return (
                      <div key={s} style={dropItem} onClick={() => setSubDispFilter(prev => checked ? prev.filter(x => x !== s) : [...prev, s])}>
                        <span style={{ fontSize: 10 }}>{checked ? '☑' : '☐'}</span> {s}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })()}

        {/* Quality parameter fail filter */}
        <div style={{ position: 'relative' }} onClick={e => e.stopPropagation()}>
          <button style={paramFail ? chipActive : chip} onClick={() => setOpenDrop(openDrop === 'param' ? null : 'param')}>
            {paramFail ? (PARAM_NAMES[paramFail] ?? paramFail) : 'Quality parameter'} <span style={{ fontSize: 9 }}>▾</span>
          </button>
          {openDrop === 'param' && (
            <div style={dropdown} onClick={e => e.stopPropagation()}>
              <div style={{ ...dropItem, fontWeight: paramFail === '' ? 600 : 400 }} onClick={() => { setParamFail(''); setOpenDrop(null); }}>All</div>
              {PARAM_ORDER.map(key => (
                <div key={key} style={{ ...dropItem, fontWeight: paramFail === key ? 600 : 400 }}
                  onClick={() => { setParamFail(key); setOpenDrop(null); }}>
                  {PARAM_NAMES[key]}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Status filter (All / Pending / Re-Opened) */}
        <div style={{ position: 'relative' }} onClick={e => e.stopPropagation()}>
          <button style={statusFilter ? chipActive : chip} onClick={() => setOpenDrop(openDrop === 'status' ? null : 'status')}>
            {statusFilter === 'reopened' ? 'Re-Opened' : statusFilter === 'pending' ? 'Pending' : 'Status'} <span style={{ fontSize: 9 }}>▾</span>
          </button>
          {openDrop === 'status' && (
            <div style={dropdown} onClick={e => e.stopPropagation()}>
              <div style={{ ...dropItem, fontWeight: statusFilter === '' ? 600 : 400 }}
                onClick={() => { setStatusFilter(''); setOpenDrop(null); }}>
                All
              </div>
              <div style={{ ...dropItem, fontWeight: statusFilter === 'pending' ? 600 : 400 }}
                onClick={() => { setStatusFilter('pending'); setOpenDrop(null); }}>
                Pending
              </div>
              <div style={{ ...dropItem, fontWeight: statusFilter === 'reopened' ? 600 : 400 }}
                onClick={() => { setStatusFilter('reopened'); setOpenDrop(null); }}>
                Re-Opened
              </div>
            </div>
          )}
        </div>

        {/* IQS range — inline inputs, no spinner arrows */}
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontSize: 12, color: 'var(--qa-text-3)', whiteSpace: 'nowrap' }}>IQS</span>
          <input
            type="text" inputMode="numeric" pattern="[0-9]*"
            placeholder="min"
            value={iqsMin}
            onChange={e => setIqsMin(e.target.value.replace(/[^0-9]/g, ''))}
            style={{ height: 32, width: 52, padding: '0 8px', textAlign: 'center', border: `1px solid ${iqsMin ? 'var(--qa-gray-700)' : 'var(--qa-border)'}`, borderRadius: 8, background: 'var(--qa-card)', color: 'var(--qa-text)', fontSize: 13, fontFamily: 'inherit', outline: 'none' }}
          />
          <span style={{ fontSize: 12, color: 'var(--qa-text-3)' }}>–</span>
          <input
            type="text" inputMode="numeric" pattern="[0-9]*"
            placeholder="max"
            value={iqsMax}
            onChange={e => setIqsMax(e.target.value.replace(/[^0-9]/g, ''))}
            style={{ height: 32, width: 52, padding: '0 8px', textAlign: 'center', border: `1px solid ${iqsMax ? 'var(--qa-gray-700)' : 'var(--qa-border)'}`, borderRadius: 8, background: 'var(--qa-card)', color: 'var(--qa-text)', fontSize: 13, fontFamily: 'inherit', outline: 'none' }}
          />
        </div>

        {/* CSAT filter */}
        <div style={{ position: 'relative' }} onClick={e => e.stopPropagation()}>
          <button style={csatFilter.length ? chipActive : chip} onClick={() => setOpenDrop(openDrop === 'csat' ? null : 'csat')}>
            {csatFilter.length ? `CSAT: ${csatFilter.join(', ')}` : 'CSAT'} <span style={{ fontSize: 9 }}>▾</span>
          </button>
          {openDrop === 'csat' && (
            <div style={dropdown} onClick={e => e.stopPropagation()}>
              {[1, 3, 5].map(v => {
                const checked = csatFilter.includes(v);
                return (
                  <div key={v} style={dropItem} onClick={() => {
                    setCsatFilter(prev => checked ? prev.filter(x => x !== v) : [...prev, v]);
                  }}>
                    <span style={{ fontSize: 10 }}>{checked ? '☑' : '☐'}</span>
                    {v === 1 ? '1 — Negative' : v === 3 ? '3 — Neutral' : '5 — Positive'}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Date range */}
        <div style={{ position: 'relative' }} onClick={e => e.stopPropagation()}>
          <button style={customFrom ? chipActive : chip} onClick={() => { setShowPicker(v => !v); setOpenDrop(null); }}>
            {customFrom && customTo
              ? `${fmtDateShort(customFrom)} – ${fmtDateShort(customTo)}`
              : 'Date range'}
            <span style={{ fontSize: 9 }}>▾</span>
          </button>
          {showPicker && (
            <DateRangePicker
              onApply={(from, to) => { setCustomFrom(from); setCustomTo(to); setShowPicker(false); }}
              onCancel={() => setShowPicker(false)}
            />
          )}
        </div>

        <button
          disabled={!hasFilters}
          style={{
            ...chip,
            color: hasFilters ? 'var(--qa-text)' : 'var(--qa-text-3)',
            opacity: hasFilters ? 1 : 0.5,
            cursor: hasFilters ? 'pointer' : 'not-allowed',
          }}
          onClick={() => {
            setChatIdSearch(''); setDispFilter([]); setSubDispFilter([]); setIqsMin(''); setIqsMax('');
            setCsatFilter([]); setParamFail(''); setStatusFilter(''); setCustomFrom(''); setCustomTo('');
          }}
        >
          Reset Filters
        </button>

        <div style={{ flex: 1 }} />

        {/* Per-page selector + count */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <span style={{ fontSize: 13, color: 'var(--qa-text-3)', whiteSpace: 'nowrap' }}>
            {loading ? 'Loading…' : `Showing ${chats.length} of ${total}`}
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
                {[5, 10, 25, 50].map(n => (
                  <div key={n} style={{ ...dropItem, fontWeight: pageSize === n ? 600 : 400 }}
                    onClick={() => { setPageSize(n); fetchData(1, n); setOpenDrop(null); }}>
                    {pageSize === n && <span style={{ fontSize: 10 }}>✓</span>} {n}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Table */}
      <div style={{ overflowX: 'auto', borderRadius: '0 0 8px 8px', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: 110 }} />
            <col />
            <col style={{ width: 95 }} />
            <col style={{ width: 95 }} />
            <col style={{ width: 140 }} />
            <col style={{ width: 95 }} />
            <col style={{ width: 90 }} />
          </colgroup>
          <thead>
            <tr>
              <th style={th}>
                <button style={thBtn} onClick={() => toggleSort('chatId')}>
                  Chat ID <SortIcon col="chatId" />
                </button>
              </th>
              <th style={th}>
                <button style={thBtn} onClick={() => toggleSort('agentName')}>
                  Agent <SortIcon col="agentName" />
                </button>
              </th>
              <th style={{ ...th, textAlign: 'right' }}>
                <button style={{ ...thBtn, justifyContent: 'flex-end', width: '100%' }} onClick={() => toggleSort('iqsScore')}>
                  <SortIcon col="iqsScore" /> IQS (Chat)
                </button>
              </th>
              <th style={{ ...th, textAlign: 'right' }}>
                <button style={{ ...thBtn, justifyContent: 'flex-end', width: '100%' }} onClick={() => toggleSort('callIqsScore')}>
                  <SortIcon col="callIqsScore" /> IQS (Call)
                </button>
              </th>
              <th style={th}>Call Transcript</th>
              <th style={th}>Status</th>
              <th style={{ ...th, textAlign: 'right' }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}>
                  {Array.from({ length: 7 }).map((_, j) => (
                    <td key={j} style={td}>
                      <div style={{ height: 12, background: 'var(--qa-fill-light)', borderRadius: 4, width: j === 0 ? '50%' : '70%' }} />
                    </td>
                  ))}
                </tr>
              ))
            ) : sortedChats.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ ...td, textAlign: 'center', color: 'var(--qa-text-3)', padding: '40px 16px' }}>
                  No chats pending review
                </td>
              </tr>
            ) : (
              sortedChats.map(chat => (
                <React.Fragment key={chat.chatId}>
                  <tr
                    onClick={() => toggleExpand(chat.chatId)}
                    style={{ background: expandedId === chat.chatId ? 'var(--qa-gray-50)' : undefined, cursor: 'pointer' }}
                    onMouseEnter={e => { if (expandedId !== chat.chatId) e.currentTarget.style.background = 'var(--qa-fill-light)'; }}
                    onMouseLeave={e => { if (expandedId !== chat.chatId) e.currentTarget.style.background = ''; }}
                  >
                    <td style={tdMono}>
                      {/^\d+$/.test(chat.chatId.trim()) ? (
                        <a
                          href={`https://app.robylon.ai/unified-inbox/share/${chat.chatId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={e => e.stopPropagation()}
                          style={{ color: 'var(--qa-text-2)', textDecoration: 'none', fontFamily: 'ui-monospace, monospace', fontSize: 12 }}
                          onMouseEnter={e => (e.currentTarget.style.textDecoration = 'underline')}
                          onMouseLeave={e => (e.currentTarget.style.textDecoration = 'none')}
                        >
                          {chat.chatId}
                        </a>
                      ) : (
                        chat.chatId
                      )}
                    </td>
                    <td style={{ ...td, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {chat.agentName}
                    </td>
                    <td style={tdNum}>
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        minWidth: 36, height: 22, borderRadius: 6, fontSize: 12,
                        fontFamily: 'ui-monospace, monospace',
                        background: chat.iqsScore < 60 ? '#fee2e2' : '#fef9c3',
                        color:      chat.iqsScore < 60 ? '#b91c1c' : '#713f12',
                      }}>
                        {chat.iqsScore}
                      </span>
                    </td>
                    <td style={tdNum}>
                      {chat.callIqsScore !== null ? (
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          minWidth: 36, height: 22, borderRadius: 6, fontSize: 12,
                          fontFamily: 'ui-monospace, monospace',
                          background: chat.callIqsScore < 60 ? '#fee2e2' : '#dcfce7',
                          color:      chat.callIqsScore < 60 ? '#b91c1c' : '#15803d',
                        }}>
                          {chat.callIqsScore}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--qa-text-3)', fontSize: 12 }}>—</span>
                      )}
                    </td>
                    <td style={td}>
                      {chat.callTranscriptStatus === 'transcribed' ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: '#16a34a', fontWeight: 500 }}>
                          <span style={{ fontSize: 10 }}>✓</span> Transcribed
                        </span>
                      ) : chat.callTranscriptStatus === 'pending' ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: '#ca8a04', fontWeight: 500 }} title="Transcribing/scoring call automatically on-the-fly when Evaluated">
                          <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: '#ca8a04' }} className="animate-pulse" />
                          Pending
                        </span>
                      ) : (
                        <span style={{ color: 'var(--qa-text-3)', fontSize: 12 }}>No Call</span>
                      )}
                    </td>
                    <td style={td}>
                      {chat.status === 'reopened' ? (
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
                          background: '#f3e8ff',
                          color: '#6b21a8',
                        }}>
                          Reopened
                        </span>
                      ) : (
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
                          background: '#e0f2fe',
                          color: '#0369a1',
                        }}>
                          Pending
                        </span>
                      )}
                    </td>
                    <td style={tdAct}>
                      <button
                        onClick={e => { e.stopPropagation(); toggleExpand(chat.chatId); }}
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
                          transform: expandedId === chat.chatId ? 'rotate(180deg)' : 'none',
                          transition: 'transform 0.15s', display: 'inline-block',
                        }}>▾</span>
                      </button>
                    </td>
                  </tr>

                  {expandedId === chat.chatId && (
                    <EvalPanel
                      chatId={chat.chatId}
                      agentName={chat.agentName}
                      iqsScore={chat.iqsScore}
                      closedAt={chat.closedAt}
                      disposition={chat.disposition}
                      parameters={chat.parameters}
                      mobileNumber={chat.mobileNumber}
                      mode="submit"
                      onDone={() => removeChat(chat.chatId)}
                      onClose={() => setExpandedId(null)}
                      colSpan={7}
                    />
                  )}
                </React.Fragment>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
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
