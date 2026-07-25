'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import type { CSSProperties } from 'react';
import type { IQSScoreEntry } from '@/lib/quality';
import { PARAM_NAMES } from '@/lib/quality';
import IRScorePanel from './IRScorePanel';

const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
const SANS = '-apple-system, BlinkMacSystemFont, "Inter", "Helvetica Neue", Arial, sans-serif';

// ─── Types ────────────────────────────────────────────────────────────────────

interface DisputeRow {
  flagId: string;
  chatId: string;
  iqsScore: number | null;
  closedAt: string;
  status: string;
  paramCategory: string;
  challengedParams: { param: string; note: string }[];
  agentNote: string;
  reviewNote: string;
  reviewedBy: string;
  reviewedAt: string;
  parameters: Record<string, any> | null;
  flaggedAt: string;
}

interface Props {
  agentName: string;
}

// ─── Chip button ─────────────────────────────────────────────────────────────

function Chip({
  label, value, active, disabled, onClick,
}: { label: string; value?: string; active?: boolean; disabled?: boolean; onClick?: React.MouseEventHandler<HTMLButtonElement> }) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      style={{
        height: 32, padding: '0 10px',
        border: `1px solid ${active ? '#2D2D31' : '#E4E4E7'}`,
        borderRadius: 8,
        background: active ? '#F4F4F5' : '#FFFFFF',
        color: disabled ? '#C7C7CC' : '#111111',
        fontSize: 13, fontFamily: SANS,
        display: 'inline-flex', alignItems: 'center', gap: 6,
        cursor: disabled ? 'default' : 'pointer',
        whiteSpace: 'nowrap',
      }}
    >
      {value || label}
      <span style={{ color: '#A1A1AA', fontSize: 9 }}>▾</span>
    </button>
  );
}

// ─── Dropdown ─────────────────────────────────────────────────────────────────

interface DropdownProps {
  anchorRect: DOMRect | null;
  onClose: () => void;
  children: React.ReactNode;
}

function Dropdown({ anchorRect, onClose, children }: DropdownProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  if (!anchorRect) return null;
  return (
    <div
      ref={ref}
      style={{
        position: 'fixed',
        top: anchorRect.bottom + 4,
        left: anchorRect.left,
        zIndex: 2000,
        minWidth: 184,
        maxHeight: 300,
        overflowY: 'auto',
        background: '#FFFFFF',
        border: '1px solid #E4E4E7',
        borderRadius: 10,
        boxShadow: '0 10px 28px rgba(17,17,17,0.12)',
        padding: 4,
        fontFamily: SANS,
      }}
    >
      {children}
    </div>
  );
}

function MenuItem({
  label, selected, muted, onSelect,
}: { label: string; selected?: boolean; muted?: boolean; onSelect: () => void }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onClick={onSelect}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        height: 34, padding: '0 10px', borderRadius: 6,
        fontSize: 13, color: muted ? '#A1A1AA' : '#111111',
        cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: hovered ? '#F4F4F5' : 'transparent',
      }}
    >
      {label}
      {selected && <span style={{ fontSize: 12, color: '#111111' }}>✓</span>}
    </div>
  );
}

// ─── Calendar popup ───────────────────────────────────────────────────────────

function CalendarPopup({
  anchorRect, dateFrom, dateTo, onSetFrom, onSetTo, onClear, onClose,
}: {
  anchorRect: DOMRect | null;
  dateFrom: string; dateTo: string;
  onSetFrom: (d: string) => void; onSetTo: (d: string) => void;
  onClear: () => void; onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth());
  const [year, setYear] = useState(now.getFullYear());
  const [picking, setPicking] = useState<'from' | 'to'>('from');

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  if (!anchorRect) return null;

  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [...Array(firstDay).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];

  const toIso = (d: number) => `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

  const selectDay = (d: number) => {
    const iso = toIso(d);
    if (picking === 'from') { onSetFrom(iso); setPicking('to'); }
    else { onSetTo(iso); onClose(); }
  };

  const rangeLabel = dateFrom || dateTo
    ? `${dateFrom || '—'} → ${dateTo || '—'}`
    : 'Select start date';

  return (
    <div ref={ref} style={{
      position: 'fixed',
      top: anchorRect.bottom + 4,
      left: anchorRect.left,
      zIndex: 2000, width: 256,
      background: '#FFFFFF', border: '1px solid #E4E4E7',
      borderRadius: 10, boxShadow: '0 10px 28px rgba(17,17,17,0.12)',
      padding: 12, fontFamily: SANS,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <button
          onClick={() => { if (month === 0) { setMonth(11); setYear(y => y - 1); } else setMonth(m => m - 1); }}
          style={{ width: 26, height: 26, border: '1px solid #E4E4E7', borderRadius: 6, background: '#FFFFFF', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13 }}
        >‹</button>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#111111' }}>{MONTHS[month]} {year}</span>
        <button
          onClick={() => { if (month === 11) { setMonth(0); setYear(y => y + 1); } else setMonth(m => m + 1); }}
          style={{ width: 26, height: 26, border: '1px solid #E4E4E7', borderRadius: 6, background: '#FFFFFF', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13 }}
        >›</button>
      </div>
      {/* Day headers */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, marginBottom: 4 }}>
        {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(d => (
          <div key={d} style={{ height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: '#A1A1AA' }}>{d}</div>
        ))}
      </div>
      {/* Day cells */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
        {cells.map((d, i) => {
          if (!d) return <div key={i} />;
          const iso = toIso(d);
          const isFrom = iso === dateFrom;
          const isTo = iso === dateTo;
          const selected = isFrom || isTo;
          return (
            <div
              key={i}
              onClick={() => selectDay(d)}
              style={{
                height: 30, borderRadius: 6, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12, fontFamily: MONO,
                background: selected ? '#2D2D31' : 'transparent',
                color: selected ? '#fff' : '#111111',
              }}
            >
              {d}
            </div>
          );
        })}
      </div>
      {/* Footer */}
      <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 11, color: '#A1A1AA' }}>{rangeLabel}</span>
        <button
          onClick={() => { onClear(); onClose(); }}
          style={{ background: 'none', border: 0, fontSize: 12, color: '#A1A1AA', cursor: 'pointer', fontFamily: SANS }}
        >
          Clear
        </button>
      </div>
    </div>
  );
}

// ─── Table styles ─────────────────────────────────────────────────────────────

const TH_BASE: CSSProperties = {
  height: 40, background: '#FAFAFB', borderBottom: '1px solid #E4E4E7',
  fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em',
  color: '#6B6B6B', fontWeight: 500, padding: '0 16px', textAlign: 'left',
  whiteSpace: 'nowrap',
};
const TD_BASE: CSSProperties = {
  height: 52, padding: '0 12px', fontSize: 14, color: '#111111', verticalAlign: 'middle',
};

// ─── Section A: Evaluated Chats ───────────────────────────────────────────────

const PARAM_LIST = Object.entries(PARAM_NAMES).map(([key, label]) => ({ key, label }));

const CSAT_OPTS = [
  { value: '5', label: 'Good (5)' },
  { value: '3', label: 'CBB (3)' },
  { value: '1', label: 'Bad (1)' },
];

function EvaluatedSection({ agentName }: { agentName: string }) {
  const [entries, setEntries] = useState<IQSScoreEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const [disposition, setDisposition] = useState('');
  const [subDisposition, setSubDisposition] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [csat, setCsat] = useState('');
  const [qualityParam, setQualityParam] = useState('');

  const [dispositions, setDispositions] = useState<string[]>([]);
  const [dispositionSubMap, setDispositionSubMap] = useState<Record<string, string[]>>({});

  const [applied, setApplied] = useState({
    disposition: '', subDisposition: '', dateFrom: '', dateTo: '', csat: '', qualityParam: '',
  });

  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Open dropdown tracking
  const [openMenu, setOpenMenu] = useState<'disposition' | 'subdisposition' | 'csat' | 'param' | 'calendar' | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<DOMRect | null>(null);

  const openDropdown = (name: typeof openMenu, e: React.MouseEvent<HTMLButtonElement>) => {
    if (openMenu === name) { setOpenMenu(null); return; }
    setMenuAnchor(e.currentTarget.getBoundingClientRect());
    setOpenMenu(name);
  };

  const fetchData = useCallback(async (filters: typeof applied) => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ agent: agentName, page: '0', skipStats: '1' });
      if (filters.disposition) p.set('tag', filters.disposition);
      if (filters.subDisposition) p.set('subTag', filters.subDisposition);
      if (filters.dateFrom) p.set('dateFrom', filters.dateFrom);
      if (filters.dateTo) p.set('dateTo', filters.dateTo);
      if (filters.csat) p.set('csat', filters.csat);
      const res = await fetch(`/api/quality/scores?${p}`);
      const data = await res.json();
      const rows: IQSScoreEntry[] = Array.isArray(data.entries) ? data.entries : [];
      const filtered = filters.qualityParam
        ? rows.filter(e => e.scores?.[filters.qualityParam] === 'No')
        : rows;
      setEntries(filtered);
      if (data.availableDispositions) setDispositions(data.availableDispositions);
      if (data.dispositionSubMap) setDispositionSubMap(data.dispositionSubMap);
    } catch {
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [agentName]);

  useEffect(() => { fetchData(applied); }, [fetchData, applied]);

  const hasFilters = !!(applied.disposition || applied.subDisposition || applied.dateFrom || applied.dateTo || applied.csat || applied.qualityParam);
  const hasPending = !!(disposition !== applied.disposition || subDisposition !== applied.subDisposition || dateFrom !== applied.dateFrom || dateTo !== applied.dateTo || csat !== applied.csat || qualityParam !== applied.qualityParam);

  const handleApply = () => {
    setApplied({ disposition, subDisposition, dateFrom, dateTo, csat, qualityParam });
    setExpandedId(null);
    setOpenMenu(null);
  };

  const handleReset = () => {
    setDisposition(''); setSubDisposition(''); setDateFrom(''); setDateTo(''); setCsat(''); setQualityParam('');
    setApplied({ disposition: '', subDisposition: '', dateFrom: '', dateTo: '', csat: '', qualityParam: '' });
    setExpandedId(null);
  };

  const subDispsForPicked = disposition && dispositionSubMap[disposition] ? dispositionSubMap[disposition] : [];
  const dateLabel = dateFrom || dateTo ? `${dateFrom || '—'} — ${dateTo || '—'}` : 'Date Range';
  const csatLabel = csat ? (CSAT_OPTS.find(o => o.value === csat)?.label ?? 'CSAT') : 'CSAT';
  const paramLabel = qualityParam ? (PARAM_NAMES[qualityParam] ?? 'Parameter') : 'Quality Param';

  return (
    <div style={{ marginBottom: 40 }}>
      <div style={{
        background: '#FFFFFF', border: '1px solid #E4E4E7', borderRadius: 8, overflow: 'hidden',
      }}>
        {/* Filter bar */}
        <div style={{
          minHeight: 56, background: '#FFFFFF', borderBottom: '1px solid #E4E4E7',
          display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, padding: '11px 16px',
        }}>
          {/* Disposition */}
          <Chip
            label="Disposition"
            value={disposition || undefined}
            active={!!disposition}
            onClick={e => openDropdown('disposition', e)}
          />
          {openMenu === 'disposition' && (
            <Dropdown anchorRect={menuAnchor} onClose={() => setOpenMenu(null)}>
              <MenuItem label="All dispositions" muted selected={!disposition} onSelect={() => { setDisposition(''); setSubDisposition(''); setOpenMenu(null); }} />
              {dispositions.map(d => (
                <MenuItem key={d} label={d} selected={disposition === d} onSelect={() => { setDisposition(d); setSubDisposition(''); setOpenMenu(null); }} />
              ))}
            </Dropdown>
          )}

          {/* Subdisposition */}
          <Chip
            label="Subdisposition"
            value={subDisposition || undefined}
            active={!!subDisposition}
            disabled={!disposition}
            onClick={e => openDropdown('subdisposition', e)}
          />
          {openMenu === 'subdisposition' && disposition && (
            <Dropdown anchorRect={menuAnchor} onClose={() => setOpenMenu(null)}>
              <MenuItem label="All subdispositions" muted selected={!subDisposition} onSelect={() => { setSubDisposition(''); setOpenMenu(null); }} />
              {subDispsForPicked.map(d => (
                <MenuItem key={d} label={d} selected={subDisposition === d} onSelect={() => { setSubDisposition(d); setOpenMenu(null); }} />
              ))}
            </Dropdown>
          )}

          {/* Date range */}
          <button
            onClick={e => openDropdown('calendar', e)}
            style={{
              height: 32, padding: '0 10px',
              border: `1px solid ${dateFrom || dateTo ? '#2D2D31' : '#E4E4E7'}`,
              borderRadius: 8, background: dateFrom || dateTo ? '#F4F4F5' : '#FFFFFF',
              color: '#111111', fontSize: 13, fontFamily: SANS,
              display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', whiteSpace: 'nowrap',
            }}
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="#A1A1AA" strokeWidth="1.5">
              <rect x="1" y="3" width="14" height="12" rx="1.5"/>
              <path d="M5 1v4M11 1v4M1 7h14"/>
            </svg>
            {dateLabel}
          </button>
          {openMenu === 'calendar' && (
            <CalendarPopup
              anchorRect={menuAnchor}
              dateFrom={dateFrom} dateTo={dateTo}
              onSetFrom={setDateFrom} onSetTo={setDateTo}
              onClear={() => { setDateFrom(''); setDateTo(''); }}
              onClose={() => setOpenMenu(null)}
            />
          )}

          {/* CSAT */}
          <Chip
            label="CSAT"
            value={csat ? csatLabel : undefined}
            active={!!csat}
            onClick={e => openDropdown('csat', e)}
          />
          {openMenu === 'csat' && (
            <Dropdown anchorRect={menuAnchor} onClose={() => setOpenMenu(null)}>
              <MenuItem label="Any CSAT" muted selected={!csat} onSelect={() => { setCsat(''); setOpenMenu(null); }} />
              {CSAT_OPTS.map(o => (
                <MenuItem key={o.value} label={o.label} selected={csat === o.value} onSelect={() => { setCsat(o.value); setOpenMenu(null); }} />
              ))}
            </Dropdown>
          )}

          {/* Quality param */}
          <Chip
            label="Quality Param"
            value={qualityParam ? paramLabel : undefined}
            active={!!qualityParam}
            onClick={e => openDropdown('param', e)}
          />
          {openMenu === 'param' && (
            <Dropdown anchorRect={menuAnchor} onClose={() => setOpenMenu(null)}>
              <MenuItem label="All parameters" muted selected={!qualityParam} onSelect={() => { setQualityParam(''); setOpenMenu(null); }} />
              {PARAM_LIST.map(p => (
                <MenuItem key={p.key} label={p.label} selected={qualityParam === p.key} onSelect={() => { setQualityParam(p.key); setOpenMenu(null); }} />
              ))}
            </Dropdown>
          )}

          {/* Right side */}
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 13, color: '#A1A1AA' }}>Showing {entries.length} chats</span>
            <button
              onClick={handleReset}
              disabled={!hasFilters}
              style={{
                background: 'none', border: 0, fontSize: 13, color: '#6B6B6B',
                cursor: hasFilters ? 'pointer' : 'default', fontFamily: SANS,
                opacity: hasFilters ? 1 : 0.4,
              }}
            >
              Reset
            </button>
            <button
              onClick={handleApply}
              disabled={!hasPending}
              style={{
                height: 36, padding: '0 16px', borderRadius: 8, fontSize: 13, fontWeight: 500,
                background: '#111111', color: '#fff', border: '1px solid #111111',
                cursor: hasPending ? 'pointer' : 'default', fontFamily: SANS,
                opacity: hasPending ? 1 : 0.4,
              }}
            >
              Apply
            </button>
          </div>
        </div>

        {/* Table */}
        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: 200 }} />
            <col style={{ width: 72 }} />
            <col style={{ width: 120 }} />
            <col style={{ width: 100 }} />
          </colgroup>
          <thead>
            <tr>
              <th style={TH_BASE}>Chat ID</th>
              <th style={{ ...TH_BASE, textAlign: 'right' }}>IQS</th>
              <th style={TH_BASE}>Date</th>
              <th style={{ ...TH_BASE, textAlign: 'right' }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={4} style={{ textAlign: 'center', color: '#A1A1AA', fontSize: 13, padding: '32px 0' }}>Loading…</td></tr>
            ) : entries.length === 0 ? (
              <tr><td colSpan={4} style={{ textAlign: 'center', color: '#A1A1AA', fontSize: 13, padding: '32px 0' }}>No evaluated chats found</td></tr>
            ) : entries.map((e, idx) => {
              const isOpen = expandedId === e.id;
              const isLast = idx === entries.length - 1;
              return (
                <>
                  <EvalRow
                    key={e.id}
                    entry={e}
                    isOpen={isOpen}
                    isLast={isLast && !isOpen}
                    onToggle={() => setExpandedId(isOpen ? null : e.id)}
                  />
                  {isOpen && (
                    <IRScorePanel
                      key={`panel-${e.id}`}
                      chatId={e.chatId}
                      agentName={e.agentName}
                      iqsScore={e.iqs}
                      closedAt={e.date || e.scoredAt || ''}
                      parameters={buildParams(e)}
                      mode="evaluated"
                      colSpan={4}
                      onClose={() => setExpandedId(null)}
                      onDisputeRaised={() => {}}
                    />
                  )}
                </>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const ROBYLON_BASE = 'https://app.robylon.ai/unified-inbox/share';

function ChatIdCell({ chatId }: { chatId: string }) {
  const id = chatId ?? '';
  const display = id.length > 16 ? id.slice(0, 16) + '…' : id;
  const isRobylon = /^\d+$/.test(id.trim());
  if (isRobylon) {
    return (
      <a
        href={`${ROBYLON_BASE}/${id}`}
        target="_blank"
        rel="noopener noreferrer"
        style={{ color: '#111111', textDecoration: 'underline', textDecorationColor: '#C7C7CC', fontFamily: MONO, fontSize: 13 }}
      >
        {display}
      </a>
    );
  }
  return <span style={{ color: '#6B6B6B', fontFamily: MONO, fontSize: 13 }}>{display}</span>;
}

function EvalRow({ entry: e, isOpen, isLast, onToggle }: {
  entry: IQSScoreEntry; isOpen: boolean; isLast: boolean; onToggle: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <tr
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ background: isOpen ? '#FAFAFB' : hovered ? '#F4F4F5' : '#FFFFFF' }}
    >
      <td style={{ ...TD_BASE, borderBottom: isLast ? 'none' : '1px solid #F0F0F2', fontFamily: MONO, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        <ChatIdCell chatId={e.chatId} />
      </td>
      <td style={{ ...TD_BASE, borderBottom: isLast ? 'none' : '1px solid #F0F0F2', textAlign: 'right', fontFamily: MONO, fontSize: 13 }}>
        {e.iqs != null ? e.iqs : '—'}
      </td>
      <td style={{ ...TD_BASE, borderBottom: isLast ? 'none' : '1px solid #F0F0F2' }}>
        {e.date || '—'}
      </td>
      <td style={{ ...TD_BASE, borderBottom: isLast ? 'none' : '1px solid #F0F0F2', textAlign: 'right' }}>
        <RowActionBtn open={isOpen} onClick={onToggle} />
      </td>
    </tr>
  );
}

// ─── Row action button ────────────────────────────────────────────────────────

function RowActionBtn({ open, onClick }: { open: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: 'none', border: 0, fontSize: 13, color: '#111111', fontWeight: 500,
        cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: SANS,
      }}
    >
      {open ? 'Close' : 'View'}
      <span style={{
        color: '#6B6B6B', fontSize: 11,
        display: 'inline-block',
        transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
        transition: 'transform 0.15s',
      }}>▾</span>
    </button>
  );
}

// ─── Section B: Disputes ──────────────────────────────────────────────────────

function DisputesSection() {
  const [tab, setTab] = useState<'pending' | 'reviewed'>('pending');
  const [pending, setPending] = useState<DisputeRow[]>([]);
  const [reviewed, setReviewed] = useState<DisputeRow[]>([]);
  const [loadingP, setLoadingP] = useState(true);
  const [loadingR, setLoadingR] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);

  const fetchDisputes = useCallback(async () => {
    setLoadingP(true); setLoadingR(true);
    try {
      const [pRes, rRes] = await Promise.all([
        fetch('/api/ir/disputes?status=pending'),
        fetch('/api/ir/disputes?status=resolved'),
      ]);
      const [pData, rData] = await Promise.all([pRes.json(), rRes.json()]);
      setPending(Array.isArray(pData.disputes) ? pData.disputes : []);
      setReviewed(Array.isArray(rData.disputes) ? rData.disputes : []);
    } catch {
      setPending([]); setReviewed([]);
    } finally {
      setLoadingP(false); setLoadingR(false);
    }
  }, []);

  useEffect(() => { fetchDisputes(); }, [fetchDisputes]);

  const cancelDispute = async (flagId: string) => {
    setCancelling(flagId);
    try {
      await fetch('/api/quality/flag', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: flagId, status: 'cancelled', action: 'cancel' }),
      });
      await fetchDisputes();
    } finally {
      setCancelling(null);
    }
  };

  const rows = tab === 'pending' ? pending : reviewed;
  const loading = tab === 'pending' ? loadingP : loadingR;
  const colSpan = 5;

  return (
    <div>
      <div style={{ fontSize: 20, fontWeight: 600, color: '#111111', margin: '0 0 16px' }}>My Disputes</div>
      <div style={{ background: '#FFFFFF', border: '1px solid #E4E4E7', borderRadius: 8, overflow: 'hidden' }}>
        {/* Tabs */}
        <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid #E4E4E7' }}>
          {(['pending', 'reviewed'] as const).map(t => (
            <button
              key={t}
              onClick={() => { setTab(t); setExpandedId(null); }}
              style={{
                height: 40, padding: '0 16px', background: 'transparent', border: 0,
                fontSize: 13, color: tab === t ? '#111111' : '#A1A1AA',
                fontWeight: tab === t ? 600 : 400,
                cursor: 'pointer', fontFamily: SANS,
                borderBottom: `2px solid ${tab === t ? '#111111' : 'transparent'}`,
                marginBottom: -1,
              }}
            >
              {t === 'pending' ? 'Pending' : 'Reviewed'}
            </button>
          ))}
        </div>

        {/* Table */}
        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: 200 }} />
            <col style={{ width: 72 }} />
            <col style={{ width: 120 }} />
            <col />
            <col style={{ width: 160 }} />
          </colgroup>
          <thead>
            <tr>
              <th style={TH_BASE}>Chat ID</th>
              <th style={{ ...TH_BASE, textAlign: 'right' }}>IQS</th>
              <th style={TH_BASE}>Date</th>
              <th style={TH_BASE}>{tab === 'pending' ? 'Status' : 'Outcome'}</th>
              <th style={{ ...TH_BASE, textAlign: 'right' }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={colSpan} style={{ textAlign: 'center', color: '#A1A1AA', fontSize: 13, padding: '32px 0' }}>Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={colSpan} style={{ textAlign: 'center', color: '#A1A1AA', fontSize: 13, padding: '32px 0' }}>No {tab} disputes</td></tr>
            ) : rows.map((row, idx) => {
              const isOpen = expandedId === row.flagId;
              const isLast = idx === rows.length - 1;
              const isRejected = row.reviewNote?.toLowerCase().includes('reject');
              // 'pending'/'ir_pending_tl' both mean "raised, awaiting QA" — the
              // latter only appears on disputes raised before the CAT1/CAT2/TL
              // stage was removed. 'tl_forwarded' is likewise historical.
              const statusText = tab === 'pending'
                ? (row.status === 'tl_forwarded' ? 'Under Review' : 'Raised')
                : (isRejected ? 'Rejected' : 'Accepted');
              return (
                <>
                  <DisputeRowComp
                    key={row.flagId}
                    row={row}
                    tab={tab}
                    statusText={statusText}
                    isOpen={isOpen}
                    isLast={isLast && !isOpen}
                    cancelling={cancelling}
                    onCancel={() => cancelDispute(row.flagId)}
                    onToggle={() => setExpandedId(isOpen ? null : row.flagId)}
                  />
                  {isOpen && (
                    <IRScorePanel
                      key={`panel-${row.flagId}`}
                      chatId={row.chatId}
                      agentName=""
                      iqsScore={row.iqsScore}
                      closedAt={row.closedAt}
                      parameters={row.parameters}
                      mode={tab === 'pending' ? 'pending' : 'reviewed'}
                      challengedParams={row.challengedParams}
                      reviewNote={row.reviewNote}
                      flagId={row.flagId}
                      flagStatus={row.status}
                      colSpan={colSpan}
                      onClose={() => setExpandedId(null)}
                    />
                  )}
                </>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DisputeRowComp({ row, tab, statusText, isOpen, isLast, cancelling, onCancel, onToggle }: {
  row: DisputeRow; tab: 'pending' | 'reviewed'; statusText: string;
  isOpen: boolean; isLast: boolean; cancelling: string | null;
  onCancel: () => void; onToggle: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const dateStr = row.flaggedAt ? new Date(row.flaggedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
  return (
    <tr
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ background: isOpen ? '#FAFAFB' : hovered ? '#F4F4F5' : '#FFFFFF' }}
    >
      <td style={{ ...TD_BASE, borderBottom: isLast ? 'none' : '1px solid #F0F0F2', fontFamily: MONO, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        <ChatIdCell chatId={row.chatId} />
      </td>
      <td style={{ ...TD_BASE, borderBottom: isLast ? 'none' : '1px solid #F0F0F2', textAlign: 'right', fontFamily: MONO, fontSize: 13 }}>
        {row.iqsScore != null ? row.iqsScore : '—'}
      </td>
      <td style={{ ...TD_BASE, borderBottom: isLast ? 'none' : '1px solid #F0F0F2' }}>{dateStr}</td>
      <td style={{ ...TD_BASE, borderBottom: isLast ? 'none' : '1px solid #F0F0F2', fontSize: 13, color: '#6B6B6B' }}>
        {statusText}
      </td>
      <td style={{ ...TD_BASE, borderBottom: isLast ? 'none' : '1px solid #F0F0F2', textAlign: 'right' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          {tab === 'pending' && (row.status === 'pending' || row.status === 'ir_pending_tl') && (
            <button
              disabled={cancelling === row.flagId}
              onClick={onCancel}
              style={{
                height: 28, padding: '0 12px', borderRadius: 8, fontSize: 12, fontWeight: 500,
                background: '#FFFFFF', border: '1px solid #E4E4E7', color: '#111111',
                cursor: cancelling === row.flagId ? 'default' : 'pointer', fontFamily: SANS,
                opacity: cancelling === row.flagId ? 0.5 : 1,
              }}
            >
              {cancelling === row.flagId ? 'Cancelling…' : 'Cancel Dispute'}
            </button>
          )}
          <RowActionBtn open={isOpen} onClick={onToggle} />
        </div>
      </td>
    </tr>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildParams(e: IQSScoreEntry): Record<string, { score: boolean | number | null; reasoning: string }> {
  const out: Record<string, { score: boolean | number | null; reasoning: string }> = {};
  for (const [k, v] of Object.entries(e.scores || {})) {
    // Keep 0.5 distinct — IRScorePanel renders it as 'Half', not NA.
    out[k] = { score: v === 'Yes' ? true : v === 'No' ? false : v === 'Half' ? 0.5 : null, reasoning: e.reasoning?.[k] || '' };
  }
  return out;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function MyQualityChatsPage({ agentName }: Props) {
  return (
    <div style={{ padding: 24, background: '#F7F7F8', minHeight: '100%', fontFamily: SANS, WebkitFontSmoothing: 'antialiased' }}>
      <div style={{ fontSize: 24, fontWeight: 600, color: '#111111', margin: '0 0 24px' }}>
        My Quality Chats
      </div>
      <EvaluatedSection agentName={agentName} />
      <DisputesSection />
    </div>
  );
}
