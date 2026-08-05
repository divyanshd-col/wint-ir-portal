'use client';

import React, { useState, useEffect, useCallback } from 'react';
import EvalPanel from './EvalPanel';
import { ErrorBoundary } from '../../scratch/ErrorBoundary';

interface UnscoredChatRow {
  id: string;
  startedAt: string;
  closedAt: string | null;
  agentId: number | null;
  agentName: string;
  conversationType: string;
  disposition: string;
  subDisposition: string;
  msgCount: number;
  iqsStatus: 'unscored' | 'skipped';
  skipReason: string | null;
  messages?: any[];
  callRecordings?: any[];
}

interface Props {
  agentFilter?: 'bot_only' | 'all' | 'human_only' | 'has_calls';
  onCountChange?: (count: number) => void;
}

function fmtDate(iso: string | null) {
  if (!iso) return '-';
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function UnscoredChatsTable({ agentFilter = 'all', onCountChange }: Props) {
  const [chats, setChats] = useState<UnscoredChatRow[]>([]);
  const [total, setTotal] = useState(0);
  const [unscoredCount, setUnscoredCount] = useState(0);
  const [skippedCount, setSkippedCount] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [loading, setLoading] = useState(true);
  const [scoringChatId, setScoringChatId] = useState<string | null>(null);
  const [scoringBatch, setScoringBatch] = useState(false);
  const [batchStatus, setBatchStatus] = useState<string | null>(null);

  // Filters
  const [chatIdSearch, setChatIdSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'no_iqs_row' | 'skipped'>('all');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchData = useCallback(async (pg = 1) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(pg), limit: String(pageSize) });
      params.set('agent_filter', agentFilter);
      params.set('status_filter', statusFilter);
      if (chatIdSearch) params.set('chat_id', chatIdSearch);
      if (customFrom) params.set('from', customFrom);
      if (customTo) params.set('to', customTo);

      const res = await fetch(`/api/admin/unscored-chats?${params}`);
      if (!res.ok) return;
      const data = await res.json();
      setChats(data.chats ?? []);
      setTotal(data.total ?? 0);
      setUnscoredCount(data.unscoredCount ?? 0);
      setSkippedCount(data.skippedCount ?? 0);
      if (onCountChange) onCountChange(data.total ?? 0);
      setPage(pg);
    } finally {
      setLoading(false);
    }
  }, [chatIdSearch, statusFilter, customFrom, customTo, pageSize, agentFilter, onCountChange]);

  useEffect(() => {
    fetchData(1);
  }, [fetchData]);

  const handleScoreSingle = async (chatId: string) => {
    setScoringChatId(chatId);
    try {
      const res = await fetch('/api/admin/unscored-chats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId }),
      });
      const data = await res.json();
      if (data.ok) {
        fetchData(page);
      } else {
        alert(data.message || 'Could not score conversation');
      }
    } catch (err: any) {
      alert('Error scoring conversation: ' + err.message);
    } finally {
      setScoringChatId(null);
    }
  };

  const handleScoreBatch = async () => {
    if (!confirm('Run auto-scoring batch on unscored chats now?')) return;
    setScoringBatch(true);
    setBatchStatus('Processing unscored queue...');
    try {
      let done = false;
      let count = 0;
      while (!done && count < 20) {
        const res = await fetch('/api/admin/run-pending-scores', { method: 'POST' });
        if (!res.ok) break;
        const data = await res.json();
        if (data.done || !data.ok) {
          done = true;
        } else {
          count++;
          setBatchStatus(`Scored ${count} chats... (${data.remaining} remaining)`);
        }
      }
      fetchData(1);
    } catch (err: any) {
      alert('Batch scoring error: ' + err.message);
    } finally {
      setScoringBatch(false);
      setBatchStatus(null);
    }
  };

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
  const inputStyle: React.CSSProperties = {
    height: 32, padding: '0 10px', border: '1px solid var(--qa-border)', borderRadius: 8,
    background: 'var(--qa-card)', color: 'var(--qa-text)', fontSize: 13, fontFamily: 'inherit',
    outline: 'none',
  };

  return (
    <div style={{ background: 'var(--qa-card)', border: '1px solid var(--qa-border)', borderRadius: 8 }}>
      {/* Header bar */}
      <div style={{
        minHeight: 56, borderBottom: '1px solid var(--qa-border)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, padding: '12px 16px',
        borderRadius: '8px 8px 0 0',
      }}>
        {/* Filters */}
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <input
            type="text"
            placeholder="Search Chat ID..."
            value={chatIdSearch}
            onChange={e => setChatIdSearch(e.target.value)}
            style={{ ...inputStyle, width: 140 }}
          />

          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value as any)}
            style={{ ...inputStyle, cursor: 'pointer' }}
          >
            <option value="all">All Statuses ({total})</option>
            <option value="no_iqs_row">No IQS Row ({unscoredCount})</option>
            <option value="skipped">Skipped Sentinels ({skippedCount})</option>
          </select>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              type="date"
              value={customFrom}
              onChange={e => setCustomFrom(e.target.value)}
              title="From Date"
              style={{ ...inputStyle, padding: '0 6px' }}
            />
            <span style={{ fontSize: 12, color: 'var(--qa-text-3)' }}>to</span>
            <input
              type="date"
              value={customTo}
              onChange={e => setCustomTo(e.target.value)}
              title="To Date"
              style={{ ...inputStyle, padding: '0 6px' }}
            />
          </div>
        </div>

        {/* Action Button */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {batchStatus && (
            <span style={{ fontSize: 12, color: 'var(--qa-text-2)', fontStyle: 'italic' }}>
              {batchStatus}
            </span>
          )}
          <button
            onClick={handleScoreBatch}
            disabled={scoringBatch || loading}
            style={{
              height: 32, padding: '0 14px', borderRadius: 8, border: 'none',
              background: scoringBatch ? 'var(--qa-gray-400)' : '#2563eb',
              color: '#fff', fontSize: 13, fontWeight: 500, cursor: scoringBatch ? 'not-allowed' : 'pointer',
              display: 'inline-flex', alignItems: 'center', gap: 6,
            }}
          >
            {scoringBatch ? 'Running Batch...' : '⚡ Score Pending Batch'}
          </button>
        </div>
      </div>

      {/* Table */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>Chat ID</th>
              <th style={th}>Started At</th>
              <th style={th}>Agent</th>
              <th style={th}>Disposition</th>
              <th style={th}>Msgs</th>
              <th style={th}>Status</th>
              <th style={th}>Reason / Details</th>
              <th style={{ ...th, textAlign: 'right' }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} style={{ ...td, textAlign: 'center', color: 'var(--qa-text-3)', padding: 32 }}>
                  Loading unscored conversations...
                </td>
              </tr>
            ) : chats.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ ...td, textAlign: 'center', color: 'var(--qa-text-3)', padding: 32 }}>
                  🎉 No unscored conversations found matching filters.
                </td>
              </tr>
            ) : (
              chats.map(chat => {
                const isExpanded = expandedId === chat.id;
                return (
                  <React.Fragment key={chat.id}>
                    <tr
                      style={{
                        background: isExpanded ? 'var(--qa-gray-50)' : undefined,
                        cursor: 'pointer',
                      }}
                      onMouseEnter={e => { if (!isExpanded) e.currentTarget.style.background = 'var(--qa-fill-light)'; }}
                      onMouseLeave={e => { if (!isExpanded) e.currentTarget.style.background = ''; }}
                      onClick={(e) => {
                        const target = e.target as HTMLElement;
                        if (target.closest('button') || target.closest('a')) return;
                        setExpandedId(isExpanded ? null : chat.id);
                      }}
                    >
                      <td style={tdMono}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{
                            fontSize: 11, color: 'var(--qa-text-2)',
                            transform: isExpanded ? 'rotate(180deg)' : 'none',
                            transition: 'transform 0.15s', display: 'inline-block',
                          }}>▾</span>
                          <a
                            href={`/chat?id=${chat.id}`}
                            target="_blank"
                            rel="noreferrer"
                            style={{ color: '#3b82f6', textDecoration: 'none', fontWeight: 500 }}
                          >
                            #{chat.id}
                          </a>
                        </div>
                      </td>
                      <td style={td}>{fmtDate(chat.startedAt)}</td>
                      <td style={td}>
                        <div style={{ fontWeight: 500 }}>{chat.agentName}</div>
                        <div style={{ fontSize: 11, color: 'var(--qa-text-3)', textTransform: 'capitalize' }}>{chat.conversationType}</div>
                      </td>
                      <td style={td}>
                        <div style={{ fontSize: 13, fontWeight: 500 }}>{chat.disposition}</div>
                        {chat.subDisposition && <div style={{ fontSize: 11, color: 'var(--qa-text-3)' }}>{chat.subDisposition}</div>}
                      </td>
                      <td style={tdMono}>{chat.msgCount}</td>
                      <td style={td}>
                        <span style={{
                          fontSize: 11, padding: '2px 8px', borderRadius: 12, fontWeight: 600,
                          background: chat.iqsStatus === 'skipped' ? 'rgba(234, 179, 8, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                          color: chat.iqsStatus === 'skipped' ? '#ca8a04' : '#dc2626',
                        }}>
                          {chat.iqsStatus === 'skipped' ? 'Skipped' : 'Unscored'}
                        </span>
                      </td>
                      <td style={{ ...td, fontSize: 12, color: 'var(--qa-text-2)' }}>
                        {chat.skipReason || (chat.msgCount === 0 ? 'No transcript' : 'Pending automated evaluation')}
                      </td>
                      <td style={{ ...td, textAlign: 'right' }}>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <button
                            onClick={() => setExpandedId(isExpanded ? null : chat.id)}
                            style={{
                              height: 28, padding: '0 12px',
                              border: '1px solid var(--qa-border)', borderRadius: 6,
                              background: isExpanded ? 'var(--qa-gray-700)' : 'var(--qa-card)',
                              color: isExpanded ? '#fff' : 'var(--qa-text)',
                              fontSize: 12, fontWeight: 500, cursor: 'pointer',
                              display: 'inline-flex', alignItems: 'center', gap: 4,
                            }}
                          >
                            Evaluate
                            <span style={{
                              fontSize: 11,
                              transform: isExpanded ? 'rotate(180deg)' : 'none',
                              transition: 'transform 0.15s', display: 'inline-block',
                            }}>▾</span>
                          </button>
                          <button
                            onClick={() => handleScoreSingle(chat.id)}
                            disabled={scoringChatId === chat.id}
                            style={{
                              height: 28, padding: '0 12px', border: 'none', borderRadius: 6,
                              background: '#2563eb', color: '#fff', fontSize: 12,
                              cursor: scoringChatId === chat.id ? 'wait' : 'pointer', fontWeight: 500,
                            }}
                          >
                            {scoringChatId === chat.id ? 'Scoring...' : 'Score Now'}
                          </button>
                        </div>
                      </td>
                    </tr>

                    {isExpanded && (
                      <ErrorBoundary>
                        <EvalPanel
                          chatId={chat.id}
                          agentName={chat.agentName}
                          iqsScore={0}
                          closedAt={chat.closedAt || chat.startedAt}
                          disposition={chat.disposition}
                          parameters={{}}
                          mode="submit"
                          onDone={() => {
                            setExpandedId(null);
                            fetchData(page);
                          }}
                          onClose={() => setExpandedId(null)}
                          colSpan={8}
                          conversationType={chat.conversationType as any}
                        />
                      </ErrorBoundary>
                    )}
                  </React.Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Footer */}
      <div style={{
        height: 48, padding: '0 16px', borderTop: '1px solid var(--qa-border)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        fontSize: 13, color: 'var(--qa-text-2)',
      }}>
        <div>
          Showing {chats.length ? (page - 1) * pageSize + 1 : 0} to {Math.min(page * pageSize, total)} of {total} items
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={() => fetchData(page - 1)}
            disabled={page <= 1 || loading}
            style={{
              height: 28, padding: '0 10px', border: '1px solid var(--qa-border)', borderRadius: 6,
              background: 'var(--qa-card)', color: 'var(--qa-text)', cursor: page <= 1 ? 'not-allowed' : 'pointer',
              opacity: page <= 1 ? 0.5 : 1,
            }}
          >
            Previous
          </button>
          <button
            onClick={() => fetchData(page + 1)}
            disabled={page * pageSize >= total || loading}
            style={{
              height: 28, padding: '0 10px', border: '1px solid var(--qa-border)', borderRadius: 6,
              background: 'var(--qa-card)', color: 'var(--qa-text)', cursor: page * pageSize >= total ? 'not-allowed' : 'pointer',
              opacity: page * pageSize >= total ? 0.5 : 1,
            }}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
