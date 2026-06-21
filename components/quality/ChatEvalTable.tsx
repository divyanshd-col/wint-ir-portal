'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { PARAM_NAMES, PARAM_ORDER } from '@/lib/quality';
import EvalPanel from './EvalPanel';
import DateRangePicker from './DateRangePicker';
import type { ChatToReviewRow } from '@/app/api/cx/qa/chats-to-review/route';

interface Props {
  dispositions:   string[];
  onCountChange?: (count: number) => void;
}

// ── Chip / filter styles ──────────────────────────────────────────────────────
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

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
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

export default function ChatEvalTable({ dispositions, onCountChange }: Props) {
  // ── Filter state ──────────────────────────────────────────────────────────
  const [dispFilter,    setDispFilter]    = useState('');
  const [subDispFilter, setSubDispFilter] = useState('');
  const [iqsMin,        setIqsMin]        = useState('');
  const [iqsMax,        setIqsMax]        = useState('');
  const [csatFilter,    setCsatFilter]    = useState<number[]>([]);
  const [paramFail,     setParamFail]     = useState('');
  const [customFrom,    setCustomFrom]    = useState('');
  const [customTo,      setCustomTo]      = useState('');
  const [showPicker,    setShowPicker]    = useState(false);

  // ── Dropdown open state ───────────────────────────────────────────────────
  const [openDrop, setOpenDrop] = useState<string | null>(null);

  // ── Data state ────────────────────────────────────────────────────────────
  const [chats,    setChats]    = useState<ChatToReviewRow[]>([]);
  const [total,    setTotal]    = useState(0);
  const [page,     setPage]     = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [loading,  setLoading]  = useState(true);

  // ── Expanded row state ────────────────────────────────────────────────────
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // ── Sub-disposition map ───────────────────────────────────────────────────
  const [subMap, setSubMap] = useState<Record<string, string[]>>({});

  const fetchData = useCallback(async (pg = 1, ps = pageSize) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(pg), limit: String(ps) });
      if (dispFilter)    params.set('disposition_filter', dispFilter);
      if (subDispFilter) params.set('sub_disposition',    subDispFilter);
      if (iqsMin)        params.set('iqs_min',            iqsMin);
      if (iqsMax)        params.set('iqs_max',            iqsMax);
      if (paramFail)     params.set('param_fail',         paramFail);
      csatFilter.forEach(v => params.append('csat', String(v)));
      if (customFrom)    params.set('from', customFrom);
      if (customTo)      params.set('to',   customTo);

      const res = await fetch(`/api/cx/qa/chats-to-review?${params}`);
      if (!res.ok) return;
      const data = await res.json();
      setChats(data.chats ?? []);
      setTotal(data.total ?? 0);
      setPage(pg);
      setSubMap(prev => ({ ...prev, ...buildSubMap(data.chats ?? []) }));
      onCountChange?.(data.total ?? 0);
    } finally {
      setLoading(false);
    }
  }, [dispFilter, subDispFilter, iqsMin, iqsMax, csatFilter, paramFail, customFrom, customTo, onCountChange, pageSize]);

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

  const hasFilters = !!(dispFilter || subDispFilter || iqsMin || iqsMax || csatFilter.length || paramFail || customFrom);

  return (
    <div style={{ background: 'var(--qa-card)', border: '1px solid var(--qa-border)', borderRadius: 8 }}>

      {/* Filter bar — overflow: visible so dropdowns are not clipped */}
      <div style={{
        minHeight: 56, background: 'var(--qa-card)', borderBottom: '1px solid var(--qa-border)',
        display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, padding: '8px 16px',
        borderRadius: '8px 8px 0 0',
      }}>

        {/* Disposition filter */}
        <div style={{ position: 'relative' }} onClick={e => e.stopPropagation()}>
          <button style={dispFilter ? chipActive : chip} onClick={() => setOpenDrop(openDrop === 'disp' ? null : 'disp')}>
            {dispFilter || 'Disposition'} <span style={{ fontSize: 9 }}>▾</span>
          </button>
          {openDrop === 'disp' && (
            <div style={dropdown} onClick={e => e.stopPropagation()}>
              <div style={{ ...dropItem, color: 'var(--qa-text-3)' }} onClick={() => { setDispFilter(''); setSubDispFilter(''); setOpenDrop(null); }}>
                All
              </div>
              {dispositions.map(d => (
                <div key={d} style={{ ...dropItem, fontWeight: dispFilter === d ? 600 : 400 }}
                  onClick={() => { setDispFilter(d); setSubDispFilter(''); setOpenDrop(null); }}>
                  {dispFilter === d && <span style={{ fontSize: 10 }}>✓</span>} {d}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Sub-disposition filter */}
        {dispFilter && (subMap[dispFilter] ?? []).length > 0 && (
          <div style={{ position: 'relative' }} onClick={e => e.stopPropagation()}>
            <button style={subDispFilter ? chipActive : chip} onClick={() => setOpenDrop(openDrop === 'sub' ? null : 'sub')}>
              {subDispFilter || 'Sub-disposition'} <span style={{ fontSize: 9 }}>▾</span>
            </button>
            {openDrop === 'sub' && (
              <div style={dropdown} onClick={e => e.stopPropagation()}>
                <div style={{ ...dropItem, color: 'var(--qa-text-3)' }} onClick={() => { setSubDispFilter(''); setOpenDrop(null); }}>All</div>
                {(subMap[dispFilter] ?? []).map(s => (
                  <div key={s} style={{ ...dropItem, fontWeight: subDispFilter === s ? 600 : 400 }}
                    onClick={() => { setSubDispFilter(s); setOpenDrop(null); }}>
                    {s}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Date range */}
        <div style={{ position: 'relative' }} onClick={e => e.stopPropagation()}>
          <button style={customFrom ? chipActive : chip} onClick={() => { setShowPicker(v => !v); setOpenDrop(null); }}>
            {customFrom && customTo
              ? `${fmtDateShort(customFrom)} – ${fmtDateShort(customTo)}`
              : 'Date range'}
            <span style={{ fontSize: 9 }}>▾</span>
          </button>
          {showPicker && (
            <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 50, marginTop: 4 }}>
              <DateRangePicker
                onApply={(from, to) => { setCustomFrom(from); setCustomTo(to); setShowPicker(false); }}
                onCancel={() => setShowPicker(false)}
              />
            </div>
          )}
        </div>

        {/* IQS range */}
        <div style={{ position: 'relative' }} onClick={e => e.stopPropagation()}>
          <button style={(iqsMin || iqsMax) ? chipActive : chip} onClick={() => setOpenDrop(openDrop === 'iqs' ? null : 'iqs')}>
            {(iqsMin || iqsMax) ? `IQS ${iqsMin || '0'}–${iqsMax || '79'}` : 'IQS range'} <span style={{ fontSize: 9 }}>▾</span>
          </button>
          {openDrop === 'iqs' && (
            <div style={{ ...dropdown, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }} onClick={e => e.stopPropagation()}>
              <label style={{ fontSize: 12, color: 'var(--qa-text-2)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                Min IQS
                <input type="number" min={0} max={79} value={iqsMin}
                  onChange={e => setIqsMin(e.target.value)}
                  style={{ height: 30, padding: '0 8px', border: '1px solid var(--qa-border)', borderRadius: 6, fontSize: 13, fontFamily: 'inherit', width: 80 }} />
              </label>
              <label style={{ fontSize: 12, color: 'var(--qa-text-2)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                Max IQS
                <input type="number" min={0} max={79} value={iqsMax}
                  onChange={e => setIqsMax(e.target.value)}
                  style={{ height: 30, padding: '0 8px', border: '1px solid var(--qa-border)', borderRadius: 6, fontSize: 13, fontFamily: 'inherit', width: 80 }} />
              </label>
              <button onClick={() => setOpenDrop(null)} style={{ height: 28, border: '1px solid var(--qa-border)', borderRadius: 6, background: 'var(--qa-gray-700)', color: '#fff', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
                Apply
              </button>
            </div>
          )}
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

        {/* Quality parameter fail filter */}
        <div style={{ position: 'relative' }} onClick={e => e.stopPropagation()}>
          <button style={paramFail ? chipActive : chip} onClick={() => setOpenDrop(openDrop === 'param' ? null : 'param')}>
            {paramFail ? (PARAM_NAMES[paramFail] ?? paramFail) : 'Quality parameter'} <span style={{ fontSize: 9 }}>▾</span>
          </button>
          {openDrop === 'param' && (
            <div style={dropdown} onClick={e => e.stopPropagation()}>
              <div style={{ ...dropItem, color: 'var(--qa-text-3)' }} onClick={() => { setParamFail(''); setOpenDrop(null); }}>All</div>
              {PARAM_ORDER.map(key => (
                <div key={key} style={{ ...dropItem, fontWeight: paramFail === key ? 600 : 400 }}
                  onClick={() => { setParamFail(key); setOpenDrop(null); }}>
                  {PARAM_NAMES[key]}
                </div>
              ))}
            </div>
          )}
        </div>

        {hasFilters && (
          <button style={{ ...chip, color: 'var(--qa-text-3)' }} onClick={() => {
            setDispFilter(''); setSubDispFilter(''); setIqsMin(''); setIqsMax('');
            setCsatFilter([]); setParamFail(''); setCustomFrom(''); setCustomTo('');
          }}>
            Clear filters
          </button>
        )}

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
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>Chat ID</th>
              <th style={th}>Agent</th>
              <th style={{ ...th, textAlign: 'right' }}>IQS</th>
              <th style={th}>Disposition</th>
              <th style={th}>CSAT</th>
              <th style={{ ...th, textAlign: 'right' }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}>
                  {Array.from({ length: 6 }).map((_, j) => (
                    <td key={j} style={td}>
                      <div style={{ height: 12, background: 'var(--qa-fill-light)', borderRadius: 4, width: j === 0 ? '30%' : '60%' }} />
                    </td>
                  ))}
                </tr>
              ))
            ) : chats.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ ...td, textAlign: 'center', color: 'var(--qa-text-3)', padding: '40px 16px' }}>
                  No chats pending review
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
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: 'var(--qa-text-2)', textDecoration: 'none', fontFamily: 'ui-monospace, monospace', fontSize: 13 }}
                          onMouseEnter={e => (e.currentTarget.style.textDecoration = 'underline')}
                          onMouseLeave={e => (e.currentTarget.style.textDecoration = 'none')}
                        >
                          {chat.chatId}
                        </a>
                      ) : (
                        chat.chatId
                      )}
                    </td>
                    <td style={{ ...td, fontWeight: 500 }}>{chat.agentName}</td>
                    <td style={tdNum}>
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        minWidth: 36, height: 24, borderRadius: 6, fontSize: 12,
                        fontFamily: 'ui-monospace, monospace',
                        background: chat.iqsScore < 60 ? '#fee2e2' : '#fef9c3',
                        color:      chat.iqsScore < 60 ? '#b91c1c' : '#713f12',
                      }}>
                        {chat.iqsScore}
                      </span>
                    </td>
                    <td style={{ ...td, fontSize: 13, color: 'var(--qa-text-2)' }}>
                      {chat.disposition}
                      {chat.subDisposition && (
                        <span style={{ color: 'var(--qa-text-3)' }}> › {chat.subDisposition}</span>
                      )}
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
                    <td style={tdAct}>
                      <button
                        onClick={() => toggleExpand(chat.chatId)}
                        style={{
                          background: 'none', border: 0, padding: 0,
                          fontFamily: 'inherit', fontSize: 13, fontWeight: 500,
                          color: 'var(--qa-text)', cursor: 'pointer',
                          display: 'inline-flex', alignItems: 'center', gap: 5,
                        }}
                      >
                        Evaluate{' '}
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
                      colSpan={6}
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
