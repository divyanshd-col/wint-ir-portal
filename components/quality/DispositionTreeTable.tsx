'use client';
import React, { useState } from 'react';
import type { DispositionRow } from './QAAnalyticsDashboard';

interface Props {
  mode:        'csat' | 'iqs';
  rows:        DispositionRow[];
  loading:     boolean;
  periodLabel: string;
}

function fmt(v: number | null, suffix = '%') {
  if (v == null) return '—';
  return `${v}${suffix}`;
}

function fmtIQS(v: number | null) {
  return v == null ? '—' : String(v);
}

function fmtTime(secs: number | null) {
  if (secs == null) return '—';
  const m = Math.floor(secs / 60);
  const s = Math.round(secs % 60);
  return `${m}m ${s.toString().padStart(2,'0')}s`;
}

function downloadCSV(rows: DispositionRow[], mode: 'csat' | 'iqs') {
  const headers = mode === 'csat'
    ? ['Intent','Count','Count %','CSAT · Chats','CSAT · Calls','CSAT · Emails','AI Chat CSAT','% Deflected']
    : ['Intent','Count','Count %','IQS · Chats','IQS · Calls','IQS · Emails','Resolution Time'];

  const lines: string[] = [headers.join(',')];

  function addRow(label: string, r: Pick<DispositionRow, 'count'|'pct'|'csatChat'|'csatCall'|'csatEmail'|'aiChatCsat'|'pctDeflected'|'iqsChat'|'iqsCall'|'iqsEmail'|'resolutionSecs'>, indent = '') {
    if (mode === 'csat') {
      lines.push([
        `"${indent}${label}"`,
        r.count,
        fmt(r.pct),
        fmt(r.csatChat),
        fmt(r.csatCall),
        '—',
        fmt(r.aiChatCsat),
        fmt(r.pctDeflected),
      ].join(','));
    } else {
      lines.push([
        `"${indent}${label}"`,
        r.count,
        fmt(r.pct),
        fmtIQS(r.iqsChat),
        fmtIQS(r.iqsCall),
        '—',
        fmtTime(r.resolutionSecs),
      ].join(','));
    }
  }

  for (const row of rows) {
    addRow(row.disposition, row);
    for (const child of row.children) {
      addRow(child.subDisposition, child as any, '  ');
    }
  }

  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = `qa-${mode}-by-disposition.csv`; a.click();
  URL.revokeObjectURL(url);
}

const DownloadIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 21h14"/>
  </svg>
);

export default function DispositionTreeTable({ mode, rows, loading, periodLabel }: Props) {
  const [openKeys, setOpenKeys] = useState<Set<string>>(new Set());

  function toggle(key: string) {
    setOpenKeys(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  const title = mode === 'csat'
    ? `CSAT by channel · ${periodLabel}`
    : `IQS by channel · ${periodLabel}`;

  const th: React.CSSProperties = {
    position: 'sticky', top: 0, zIndex: 2,
    height: 40, background: 'var(--qa-gray-50)', borderBottom: '1px solid var(--qa-border)',
    fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--qa-text-2)',
    fontWeight: 500, textAlign: 'left', padding: '0 16px',
  };
  const thNum: React.CSSProperties = { ...th, textAlign: 'right' };
  const td: React.CSSProperties = {
    padding: '0 16px', borderBottom: '1px solid var(--qa-border-sub)',
    fontSize: 14, color: 'var(--qa-text)', verticalAlign: 'middle', height: 48,
  };
  const tdNum: React.CSSProperties = { ...td, textAlign: 'right', fontFamily: 'ui-monospace, monospace', fontSize: 13 };
  const tdChild: React.CSSProperties = { ...td, height: 44, paddingLeft: 48, color: 'var(--qa-text-2)', fontSize: 13 };
  const tdChildNum: React.CSSProperties = { ...tdNum, height: 44 };

  const totalRows = rows.length;

  return (
    <div style={{ background: 'var(--qa-card)', border: '1px solid var(--qa-border)', borderRadius: 8, overflow: 'hidden' }}>
      {/* Panel header */}
      <div style={{
        padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: '1px solid var(--qa-border)',
      }}>
        <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--qa-text)' }}>{title}</span>
        <button
          onClick={() => downloadCSV(rows, mode)}
          disabled={loading || !rows.length}
          title="Export as CSV"
          style={{
            width: 28, height: 28, border: '1px solid var(--qa-border)', borderRadius: 6,
            background: 'var(--qa-card)', color: 'var(--qa-text-2)', cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <DownloadIcon />
        </button>
      </div>

      <div style={{ maxHeight: 420, overflowY: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            {mode === 'csat' ? (
              <tr>
                <th style={{ ...th, width: '30%' }}>Intent</th>
                <th style={thNum}>Count</th>
                <th style={thNum}>CSAT · Chats</th>
                <th style={thNum}>CSAT · Calls</th>
                <th style={thNum}>CSAT · Emails</th>
                <th style={thNum}>AI Chat CSAT</th>
                <th style={thNum}>% Deflected</th>
              </tr>
            ) : (
              <tr>
                <th style={{ ...th, width: '36%' }}>Intent</th>
                <th style={thNum}>Count</th>
                <th style={thNum}>IQS · Chats</th>
                <th style={thNum}>IQS · Calls</th>
                <th style={thNum}>IQS · Emails</th>
                <th style={thNum}>Resolution Time</th>
              </tr>
            )}
          </thead>

          <tbody>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}>
                  {Array.from({ length: mode === 'csat' ? 7 : 6 }).map((_, j) => (
                    <td key={j} style={j === 0 ? td : tdNum}>
                      <div style={{ height: 12, background: 'var(--qa-fill-light)', borderRadius: 4, width: j === 0 ? '60%' : '40%' }} />
                    </td>
                  ))}
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={mode === 'csat' ? 7 : 6} style={{ ...td, textAlign: 'center', color: 'var(--qa-text-3)', padding: '32px 16px' }}>
                  No data for this period
                </td>
              </tr>
            ) : (
              <>
                {rows.map(row => {
                  const isOpen = openKeys.has(row.disposition);
                  const hasChildren = row.children.length > 0;

                  return (
                    <React.Fragment key={row.disposition}>
                      {/* Parent row */}
                      <tr
                        onClick={() => hasChildren && toggle(row.disposition)}
                        style={{ cursor: hasChildren ? 'pointer' : 'default' }}
                        onMouseEnter={e => (e.currentTarget.style.background = 'var(--qa-fill-light)')}
                        onMouseLeave={e => (e.currentTarget.style.background = '')}
                      >
                        <td style={td}>
                          {hasChildren && (
                            <span style={{
                              display: 'inline-block', width: 10, marginRight: 10, fontSize: 10,
                              color: 'var(--qa-text-2)',
                              transform: isOpen ? 'rotate(90deg)' : 'none',
                              transition: 'transform 0.15s',
                              transformOrigin: 'center',
                            }}>▶</span>
                          )}
                          {row.disposition}
                        </td>
                        <td style={tdNum}>
                          {row.count.toLocaleString()}
                          {' '}<span style={{ color: 'var(--qa-text-3)', fontSize: 12 }}>{fmt(row.pct)}</span>
                        </td>
                        {mode === 'csat' ? (
                          <>
                            <td style={tdNum}>{fmt(row.csatChat)}</td>
                            <td style={tdNum}>{fmt(row.csatCall)}</td>
                            <td style={tdNum}>—</td>
                            <td style={tdNum}>{fmt(row.aiChatCsat)}</td>
                            <td style={tdNum}>{fmt(row.pctDeflected)}</td>
                          </>
                        ) : (
                          <>
                            <td style={tdNum}>{fmtIQS(row.iqsChat)}</td>
                            <td style={tdNum}>{fmtIQS(row.iqsCall)}</td>
                            <td style={tdNum}>—</td>
                            <td style={tdNum}>{fmtTime(row.resolutionSecs)}</td>
                          </>
                        )}
                      </tr>

                      {/* Child rows */}
                      {isOpen && row.children.map(child => (
                        <tr key={`${row.disposition}:${child.subDisposition}`}
                          style={{ display: isOpen ? 'table-row' : 'none' }}
                          onMouseEnter={e => (e.currentTarget.style.background = 'var(--qa-fill-light)')}
                          onMouseLeave={e => (e.currentTarget.style.background = '')}
                        >
                          <td style={tdChild}>{child.subDisposition}</td>
                          <td style={tdChildNum}>
                            {child.count.toLocaleString()}
                            {' '}<span style={{ color: 'var(--qa-text-3)', fontSize: 12 }}>{fmt(child.pct)}</span>
                          </td>
                          {mode === 'csat' ? (
                            <>
                              <td style={tdChildNum}>{fmt(child.csatChat)}</td>
                              <td style={tdChildNum}>{fmt(child.csatCall)}</td>
                              <td style={tdChildNum}>—</td>
                              <td style={tdChildNum}>{fmt(child.aiChatCsat)}</td>
                              <td style={tdChildNum}>{fmt(child.pctDeflected)}</td>
                            </>
                          ) : (
                            <>
                              <td style={tdChildNum}>{fmtIQS(child.iqsChat)}</td>
                              <td style={tdChildNum}>{fmtIQS(child.iqsCall)}</td>
                              <td style={tdChildNum}>—</td>
                              <td style={tdChildNum}>{fmtTime(child.resolutionSecs)}</td>
                            </>
                          )}
                        </tr>
                      ))}
                    </React.Fragment>
                  );
                })}

                {/* Total row */}
                {totalRows > 0 && (() => {
                  const grandCount = rows.reduce((s, r) => s + r.count, 0);

                  // Weighted averages — only include rows where the metric is non-null
                  function wavg(getValue: (r: DispositionRow) => number | null): number | null {
                    const valid = rows.filter(r => getValue(r) != null);
                    if (!valid.length) return null;
                    const wSum = valid.reduce((s, r) => s + (getValue(r) as number) * r.count, 0);
                    const wCnt = valid.reduce((s, r) => s + r.count, 0);
                    return wCnt ? Math.round(wSum / wCnt * 10) / 10 : null;
                  }

                  // % deflected: sum deflected counts / grand total
                  const totDeflected = (() => {
                    const deflectedCount = rows.reduce((s, r) =>
                      s + (r.pctDeflected != null ? r.pctDeflected / 100 * r.count : 0), 0);
                    return grandCount ? Math.round(deflectedCount / grandCount * 1000) / 10 : null;
                  })();

                  const totStyle: React.CSSProperties = {
                    ...td,
                    position: 'sticky', bottom: 0, zIndex: 2,
                    background: 'var(--qa-gray-50)', fontWeight: 600,
                    borderTop: '1px solid var(--qa-border)',
                  };
                  const totNumStyle: React.CSSProperties = {
                    ...tdNum,
                    position: 'sticky', bottom: 0, zIndex: 2,
                    background: 'var(--qa-gray-50)', fontWeight: 600,
                    borderTop: '1px solid var(--qa-border)',
                  };
                  return (
                    <tr>
                      <td style={totStyle}>Total</td>
                      <td style={totNumStyle}>
                        {grandCount.toLocaleString()}
                        {' '}<span style={{ color: 'var(--qa-text-3)', fontSize: 12 }}>100%</span>
                      </td>
                      {mode === 'csat' ? (
                        <>
                          <td style={totNumStyle}>{fmt(wavg(r => r.csatChat))}</td>
                          <td style={totNumStyle}>{fmt(wavg(r => r.csatCall))}</td>
                          <td style={totNumStyle}>—</td>
                          <td style={totNumStyle}>{fmt(wavg(r => r.aiChatCsat))}</td>
                          <td style={totNumStyle}>{fmt(totDeflected)}</td>
                        </>
                      ) : (
                        <>
                          <td style={totNumStyle}>{fmtIQS(wavg(r => r.iqsChat))}</td>
                          <td style={totNumStyle}>{fmtIQS(wavg(r => r.iqsCall))}</td>
                          <td style={totNumStyle}>—</td>
                          <td style={totNumStyle}>{fmtTime(wavg(r => r.resolutionSecs))}</td>
                        </>
                      )}
                    </tr>
                  );
                })()}
              </>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
