'use client';
import React, { useState, useEffect, useCallback } from 'react';
import EvalPanel from './EvalPanel';
import type { TLChatRow } from '@/app/api/cx/tl/chats/route';

function fmtDateShort(iso: string) {
  return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  });
}

export default function TLChatTable() {
  const [chats,       setChats]       = useState<TLChatRow[]>([]);
  const [total,       setTotal]       = useState(0);
  const [page,        setPage]        = useState(1);
  const [pageSize]                    = useState(50);
  const [loading,     setLoading]     = useState(true);
  const [expandedId,  setExpandedId]  = useState<string | null>(null);
  const [agents,      setAgents]      = useState<string[]>([]);
  const [openDrop,    setOpenDrop]    = useState<string | null>(null);

  // Filters
  const [agentFilter,  setAgentFilter]  = useState('');
  const [iqsMin,       setIqsMin]       = useState('');
  const [iqsMax,       setIqsMax]       = useState('');
  const [csatFilter,   setCsatFilter]   = useState<number[]>([]);
  const [customFrom,   setCustomFrom]   = useState('');
  const [customTo,     setCustomTo]     = useState('');

  const fetchData = useCallback(async (pg = 1) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(pg), limit: String(pageSize) });
      if (agentFilter) params.set('agent', agentFilter);
      if (iqsMin)      params.set('iqs_min', iqsMin);
      if (iqsMax)      params.set('iqs_max', iqsMax);
      csatFilter.forEach(v => params.append('csat', String(v)));
      if (customFrom)  params.set('from', customFrom);
      if (customTo)    params.set('to', customTo);

      const res = await fetch(`/api/cx/tl/chats?${params}`);
      if (!res.ok) return;
      const data = await res.json();
      setChats(data.chats ?? []);
      setTotal(data.total ?? 0);
      setPage(pg);
      if (data.agents?.length) setAgents(data.agents);
    } finally {
      setLoading(false);
    }
  }, [agentFilter, iqsMin, iqsMax, csatFilter, customFrom, customTo, pageSize]);

  useEffect(() => { fetchData(1); }, [fetchData]);

  useEffect(() => {
    if (!openDrop) return;
    const handler = () => setOpenDrop(null);
    setTimeout(() => document.addEventListener('click', handler), 0);
    return () => document.removeEventListener('click', handler);
  }, [openDrop]);

  const hasFilters = !!(agentFilter || iqsMin || iqsMax || csatFilter.length || customFrom);

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
  const chip: React.CSSProperties = {
    height: 32, padding: '0 10px', border: '1px solid var(--qa-border)', borderRadius: 8,
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

  const CSAT_OPTIONS = [{ label: 'Bad (1)', value: 1 }, { label: 'Neutral (3)', value: 3 }, { label: 'Good (5)', value: 5 }];

  return (
    <div style={{ background: 'var(--qa-card)', border: '1px solid var(--qa-border)', borderRadius: 8 }}>

      {/* Filter bar */}
      <div style={{
        minHeight: 56, background: 'var(--qa-card)', borderBottom: '1px solid var(--qa-border)',
        display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, padding: '8px 16px',
        borderRadius: '8px 8px 0 0', overflow: 'visible',
      }}>

        {/* Agent filter */}
        <div style={{ position: 'relative' }} onClick={e => e.stopPropagation()}>
          <button style={agentFilter ? chipActive : chip} onClick={() => setOpenDrop(openDrop === 'agent' ? null : 'agent')}>
            {agentFilter || 'Agent'} <span style={{ fontSize: 9 }}>▾</span>
          </button>
          {openDrop === 'agent' && (
            <div style={dropdown} onClick={e => e.stopPropagation()}>
              <div style={{ ...dropItem, color: 'var(--qa-text-3)' }} onClick={() => { setAgentFilter(''); setOpenDrop(null); }}>All Agents</div>
              {agents.map(a => (
                <div key={a} style={{ ...dropItem, fontWeight: agentFilter === a ? 600 : 400 }}
                  onClick={() => { setAgentFilter(a); setOpenDrop(null); }}>
                  {agentFilter === a && <span style={{ fontSize: 10 }}>✓</span>} {a}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* IQS range */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <input
            type="number" placeholder="IQS min" value={iqsMin} onChange={e => setIqsMin(e.target.value)}
            style={{ height: 32, width: 76, padding: '0 8px', border: '1px solid var(--qa-border)', borderRadius: 8, background: 'var(--qa-card)', color: 'var(--qa-text)', fontSize: 13, fontFamily: 'inherit' }}
          />
          <span style={{ fontSize: 11, color: 'var(--qa-text-3)' }}>–</span>
          <input
            type="number" placeholder="IQS max" value={iqsMax} onChange={e => setIqsMax(e.target.value)}
            style={{ height: 32, width: 76, padding: '0 8px', border: '1px solid var(--qa-border)', borderRadius: 8, background: 'var(--qa-card)', color: 'var(--qa-text)', fontSize: 13, fontFamily: 'inherit' }}
          />
        </div>

        {/* CSAT filter */}
        <div style={{ position: 'relative' }} onClick={e => e.stopPropagation()}>
          <button
            style={csatFilter.length ? chipActive : chip}
            onClick={() => setOpenDrop(openDrop === 'csat' ? null : 'csat')}
          >
            {csatFilter.length ? `CSAT: ${csatFilter.join(', ')}` : 'CSAT'} <span style={{ fontSize: 9 }}>▾</span>
          </button>
          {openDrop === 'csat' && (
            <div style={dropdown} onClick={e => e.stopPropagation()}>
              {CSAT_OPTIONS.map(opt => (
                <div key={opt.value} style={{ ...dropItem }}
                  onClick={() => setCsatFilter(prev => prev.includes(opt.value) ? prev.filter(v => v !== opt.value) : [...prev, opt.value])}>
                  <input type="checkbox" readOnly checked={csatFilter.includes(opt.value)} style={{ pointerEvents: 'none' }} />
                  {opt.label}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Date range */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)}
            style={{ height: 32, padding: '0 8px', border: '1px solid var(--qa-border)', borderRadius: 8, background: 'var(--qa-card)', color: 'var(--qa-text)', fontSize: 12, fontFamily: 'inherit' }}
          />
          <span style={{ fontSize: 11, color: 'var(--qa-text-3)' }}>to</span>
          <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)}
            style={{ height: 32, padding: '0 8px', border: '1px solid var(--qa-border)', borderRadius: 8, background: 'var(--qa-card)', color: 'var(--qa-text)', fontSize: 12, fontFamily: 'inherit' }}
          />
        </div>

        {hasFilters && (
          <button onClick={() => { setAgentFilter(''); setIqsMin(''); setIqsMax(''); setCsatFilter([]); setCustomFrom(''); setCustomTo(''); }}
            style={{ ...chip, color: 'var(--qa-text-3)', fontSize: 12 }}>
            Clear filters
          </button>
        )}

        <span style={{ marginLeft: 'auto', fontSize: 13, color: 'var(--qa-text-3)' }}>
          {loading ? '…' : `${total} chats`}
        </span>
      </div>

      {/* Table */}
      <div style={{ overflowX: 'auto', borderRadius: '0 0 8px 8px' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>Chat ID</th>
              <th style={th}>Agent</th>
              <th style={{ ...th, textAlign: 'right' }}>IQS</th>
              <th style={th}>CSAT</th>
              <th style={th}>Disposition</th>
              <th style={th}>Reviewed</th>
              <th style={{ ...th, textAlign: 'right' }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}>
                  {Array.from({ length: 7 }).map((_, j) => (
                    <td key={j} style={td}>
                      <div style={{ height: 12, background: 'var(--qa-fill-light)', borderRadius: 4, width: j === 0 ? '30%' : '60%' }} />
                    </td>
                  ))}
                </tr>
              ))
            ) : chats.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ ...td, textAlign: 'center', color: 'var(--qa-text-3)', padding: '40px 16px' }}>
                  No chats found for your team
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
                        <a href={`https://app.robylon.ai/unified-inbox/share/${chat.chatId}`}
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
                      }}>{chat.iqsScore}</span>
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
                    <td style={{ ...td, fontSize: 13 }}>
                      {chat.reviewedBy ? (
                        <span style={{ color: '#15803d', fontSize: 12 }}>✓ Reviewed</span>
                      ) : (
                        <span style={{ color: 'var(--qa-text-3)', fontSize: 12 }}>Pending</span>
                      )}
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
                      mode="tl-browse"
                      onDone={() => setExpandedId(null)}
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
              background: 'var(--qa-card)', fontSize: 13, fontFamily: 'inherit',
              cursor: page <= 1 ? 'not-allowed' : 'pointer', color: page <= 1 ? 'var(--qa-text-3)' : 'var(--qa-text)',
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
