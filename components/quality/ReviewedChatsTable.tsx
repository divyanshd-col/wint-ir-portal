'use client';
import React, { useState, useEffect, useCallback } from 'react';
import EvalPanel from './EvalPanel';
import DateRangePicker from './DateRangePicker';
import type { ChatToReviewRow } from '@/app/api/cx/qa/chats-to-review/route';

interface Props {
  dispositions: string[];
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
function fmtDateShort(iso: string) {
  return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export default function ReviewedChatsTable({ dispositions }: Props) {
  const [chats,         setChats]         = useState<ChatToReviewRow[]>([]);
  const [total,         setTotal]         = useState(0);
  const [filteredCount, setFilteredCount] = useState(0);
  const [page,          setPage]          = useState(1);
  const [pageSize]                        = useState(50);
  const [loading,       setLoading]       = useState(true);
  const [expandedId,    setExpandedId]    = useState<string | null>(null);

  // Filters
  const [chatIdSearch, setChatIdSearch] = useState('');
  const [agentSearch,  setAgentSearch]  = useState('');
  const [customFrom,   setCustomFrom]   = useState('');
  const [customTo,     setCustomTo]     = useState('');
  const [showPicker,   setShowPicker]   = useState(false);

  const fetchData = useCallback(async (pg = 1) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ reviewed: 'true', page: String(pg), limit: String(pageSize) });
      if (chatIdSearch) params.set('chat_id', chatIdSearch);
      if (customFrom)   params.set('from', customFrom);
      if (customTo)     params.set('to',   customTo);

      const res = await fetch(`/api/cx/qa/chats-to-review?${params}`);
      if (!res.ok) return;
      const data = await res.json();
      let rows: ChatToReviewRow[] = data.chats ?? [];
      if (agentSearch) {
        rows = rows.filter(c => c.agentName.toLowerCase().includes(agentSearch.toLowerCase()));
      }
      setChats(rows);
      setTotal(data.total ?? 0);
      // When agent search is active, total from API is unfiltered — track separately
      setFilteredCount(agentSearch ? rows.length : (data.total ?? 0));
      setPage(pg);
    } finally {
      setLoading(false);
    }
  }, [chatIdSearch, agentSearch, customFrom, customTo, pageSize]);

  useEffect(() => { fetchData(1); }, [fetchData]);

  const th: React.CSSProperties = {
    height: 40, background: 'var(--qa-gray-50)', borderBottom: '1px solid var(--qa-border)',
    fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--qa-text-2)',
    fontWeight: 500, textAlign: 'left', padding: '0 16px', whiteSpace: 'nowrap',
  };
  const td: React.CSSProperties = {
    height: 52, padding: '0 16px', borderBottom: '1px solid var(--qa-border-sub)',
    fontSize: 14, color: 'var(--qa-text)', verticalAlign: 'middle',
  };
  const tdMono: React.CSSProperties = { ...td, fontFamily: 'ui-monospace, monospace', fontSize: 13, color: 'var(--qa-text-2)' };
  const tdNum: React.CSSProperties  = { ...td, textAlign: 'right', fontFamily: 'ui-monospace, monospace', fontSize: 13 };
  const tdAct: React.CSSProperties  = { ...td, textAlign: 'right' };
  const inputStyle: React.CSSProperties = {
    height: 32, padding: '0 10px', border: '1px solid var(--qa-border)', borderRadius: 8,
    background: 'var(--qa-card)', color: 'var(--qa-text)', fontSize: 13, fontFamily: 'inherit',
    outline: 'none',
  };

  return (
    <div style={{ background: 'var(--qa-card)', border: '1px solid var(--qa-border)', borderRadius: 8 }}>

      {/* Filter bar */}
      <div style={{
        minHeight: 56, borderBottom: '1px solid var(--qa-border)',
        display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, padding: '8px 16px',
        borderRadius: '8px 8px 0 0',
      }}>
        <input
          style={inputStyle}
          placeholder="Search by Chat ID…"
          value={chatIdSearch}
          onChange={e => setChatIdSearch(e.target.value)}
        />
        <input
          style={inputStyle}
          placeholder="Search by Agent…"
          value={agentSearch}
          onChange={e => setAgentSearch(e.target.value)}
        />
        {/* Date range picker */}
        <div style={{ position: 'relative' }} onClick={e => e.stopPropagation()}>
          <button
            onClick={() => setShowPicker(v => !v)}
            style={{ ...inputStyle, cursor: 'pointer', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            {customFrom && customTo ? `${fmtDateShort(customFrom)} – ${fmtDateShort(customTo)}` : 'Date range'}
            <span style={{ fontSize: 9, color: 'var(--qa-text-3)' }}>▾</span>
          </button>
          {showPicker && (
            <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 50 }}>
              <DateRangePicker
                onApply={(from, to) => { setCustomFrom(from); setCustomTo(to); setShowPicker(false); }}
                onCancel={() => setShowPicker(false)}
              />
            </div>
          )}
        </div>
        {(chatIdSearch || agentSearch || customFrom) && (
          <button
            onClick={() => { setChatIdSearch(''); setAgentSearch(''); setCustomFrom(''); setCustomTo(''); setShowPicker(false); }}
            style={{ ...inputStyle, cursor: 'pointer', color: 'var(--qa-text-2)' }}
          >
            Clear
          </button>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 13, color: 'var(--qa-text-3)' }}>
          {loading ? 'Loading…' : agentSearch ? `${filteredCount} of ${total} reviewed` : `${total} reviewed`}
        </span>
      </div>

      {/* Table */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>Chat ID</th>
              <th style={th}>Agent</th>
              <th style={{ ...th, textAlign: 'right' }}>IQS</th>
              <th style={th}>CSAT</th>
              <th style={th}>Disposition</th>
              <th style={th}>Reviewed By</th>
              <th style={th}>Reviewed At</th>
              <th style={{ ...th, textAlign: 'right' }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}>
                  {Array.from({ length: 8 }).map((_, j) => (
                    <td key={j} style={td}>
                      <div style={{ height: 12, background: 'var(--qa-fill-light)', borderRadius: 4, width: j === 0 ? '30%' : '60%' }} />
                    </td>
                  ))}
                </tr>
              ))
            ) : chats.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ ...td, textAlign: 'center', color: 'var(--qa-text-3)', padding: '40px 16px' }}>
                  No reviewed chats found
                </td>
              </tr>
            ) : (
              chats.map(chat => (
                <React.Fragment key={chat.chatId}>
                  <tr
                    style={{ background: expandedId === chat.chatId ? 'var(--qa-gray-50)' : undefined }}
                    onMouseEnter={e => { if (expandedId !== chat.chatId) e.currentTarget.style.background = 'var(--qa-fill-light)'; }}
                    onMouseLeave={e => { if (expandedId !== chat.chatId) e.currentTarget.style.background = ''; }}
                  >
                    <td style={tdMono}>
                      {/^\d+$/.test(chat.chatId.trim()) ? (
                        <a
                          href={`https://app.robylon.ai/unified-inbox/share/${chat.chatId}`}
                          target="_blank" rel="noopener noreferrer"
                          style={{ color: 'var(--qa-text-2)', textDecoration: 'none', fontFamily: 'ui-monospace, monospace', fontSize: 13 }}
                          onMouseEnter={e => (e.currentTarget.style.textDecoration = 'underline')}
                          onMouseLeave={e => (e.currentTarget.style.textDecoration = 'none')}
                        >
                          {chat.chatId}
                        </a>
                      ) : chat.chatId}
                    </td>
                    <td style={{ ...td, fontWeight: 500 }}>{chat.agentName}</td>
                    <td style={tdNum}>
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        minWidth: 36, height: 24, borderRadius: 6, fontSize: 12, fontFamily: 'ui-monospace, monospace',
                        background: chat.iqsScore < 60 ? '#fee2e2' : '#fef9c3',
                        color:      chat.iqsScore < 60 ? '#b91c1c' : '#713f12',
                      }}>
                        {chat.iqsScore}
                      </span>
                    </td>
                    <td style={td}>
                      {chat.csatScore == null ? (
                        <span style={{ color: 'var(--qa-text-3)', fontSize: 13 }}>—</span>
                      ) : (
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          minWidth: 30, height: 22, borderRadius: 6, fontSize: 12, fontWeight: 600,
                          fontFamily: 'ui-monospace, monospace',
                          background: chat.csatScore === 1 ? '#fee2e2' : chat.csatScore === 3 ? '#fef9c3' : '#dcfce7',
                          color:      chat.csatScore === 1 ? '#b91c1c' : chat.csatScore === 3 ? '#713f12' : '#15803d',
                        }}>
                          {chat.csatScore === 1 ? 'Bad' : chat.csatScore === 3 ? 'Neutral' : 'Good'}
                        </span>
                      )}
                    </td>
                    <td style={{ ...td, fontSize: 13, color: 'var(--qa-text-2)' }}>
                      {chat.disposition}
                      {chat.subDisposition && <span style={{ color: 'var(--qa-text-3)' }}> › {chat.subDisposition}</span>}
                    </td>
                    <td style={{ ...td, fontSize: 13, color: 'var(--qa-text-2)' }}>{chat.reviewedBy ?? '—'}</td>
                    <td style={{ ...td, fontSize: 13, color: 'var(--qa-text-2)' }}>
                      {chat.reviewedAt ? fmtDate(chat.reviewedAt) : '—'}
                    </td>
                    <td style={tdAct}>
                      <button
                        onClick={() => setExpandedId(prev => prev === chat.chatId ? null : chat.chatId)}
                        style={{
                          background: 'none', border: 0, padding: 0,
                          fontFamily: 'inherit', fontSize: 13, fontWeight: 500,
                          color: 'var(--qa-text)', cursor: 'pointer',
                          display: 'inline-flex', alignItems: 'center', gap: 5,
                        }}
                      >
                        View{' '}
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
                      reviewedBy={chat.reviewedBy}
                      reviewedAt={chat.reviewedAt}
                      reviewNote={chat.reviewNote}
                      mode="view"
                      onDone={() => setExpandedId(null)}
                      onClose={() => setExpandedId(null)}
                      colSpan={8}
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
              background: 'var(--qa-card)', fontSize: 13, fontFamily: 'inherit',
              cursor: page >= Math.ceil(total / pageSize) ? 'not-allowed' : 'pointer',
              color: page >= Math.ceil(total / pageSize) ? 'var(--qa-text-3)' : 'var(--qa-text)',
            }}>Next →</button>
          </div>
        </div>
      )}
    </div>
  );
}
