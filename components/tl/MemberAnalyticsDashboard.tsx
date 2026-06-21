'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import DateRangePicker from '@/components/quality/DateRangePicker';

// ── Types ──────────────────────────────────────────────────────────────────────
type Period = '7' | '30' | 'custom';

interface StatValues   { csat_pct: number|null; iqs: number|null; volume: number; }
interface WowWeek      { week_start: string; csat_pct: number|null; iqs: number|null; volume: number; params: Record<string, number|null>; }

interface CatSub {
  sub_disposition: string;
  chats_iqs: number|null; chats_volume: number; chats_resolution_seconds: number|null;
  calls_iqs: number|null; calls_volume: number;
}
interface CatRow {
  disposition: string;
  chats_iqs: number|null; chats_volume: number; chats_resolution_seconds: number|null;
  calls_iqs: number|null; calls_volume: number;
  subs: CatSub[];
}
interface ChannelData  { stats: StatValues; categories: CatRow[]; wow: WowWeek[]; }
interface MemberData {
  agentName: string; agents: string[];
  dateFrom: string; dateTo: string; wowWeekStarts: string[];
  channels: { chats: ChannelData; calls: ChannelData; emails: null; };
}
interface AiResult     { summary: string; items: Array<{ type: string; text: string }>; }

// ── Constants ──────────────────────────────────────────────────────────────────
const PERIOD_LABELS: Record<Period, string> = { '7': '7 days', '30': '30 days', custom: '' };

const PARAM_DEFS = [
  { key: 'technical',     label: 'Technically / Legally Correct' },
  { key: 'all_questions', label: 'All Questions Answered' },
  { key: 'expectation',   label: 'Expectation Setting' },
  { key: 'contextual',    label: 'Contextual & Personal' },
  { key: 'follow_up',     label: 'Follow-up & Closing' },
  { key: 'sentences',     label: 'Sentences / Tone' },
  { key: 'process',       label: 'Process-wise' },
  { key: 'opening',       label: 'First Response & Opening' },
  { key: 'call',          label: 'Call (when required)' },
  { key: 'grammar',       label: 'Grammar / Structure' },
  { key: 'empathy',       label: 'Empathy' },
];

// ── Helpers ────────────────────────────────────────────────────────────────────
const fmtPct = (v: number|null) => v == null ? '—' : `${v.toFixed(1)}%`;
const fmtVol = (v: number)       => v.toLocaleString('en-IN');

function fmtResolution(sec: number|null): string {
  if (sec == null || sec === 0) return '—';
  const m = Math.floor(sec / 60), s = Math.round(sec % 60);
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function fmtWeekLabel(ws: string): string {
  const d = new Date(ws + 'T00:00:00Z');
  const e = new Date(d); e.setUTCDate(e.getUTCDate() + 6);
  const MO = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const sm = MO[d.getUTCMonth()], em = MO[e.getUTCMonth()];
  return sm === em
    ? `${sm} ${d.getUTCDate()} – ${e.getUTCDate()}`
    : `${sm} ${d.getUTCDate()} – ${em} ${e.getUTCDate()}`;
}

function agentInitials(name: string) {
  return name.split(' ').map(p => p[0] ?? '').slice(0, 2).join('').toUpperCase() || '?';
}

// ── Sub-components ─────────────────────────────────────────────────────────────
function Skeleton({ w = 80, h = 16 }: { w?: number; h?: number }) {
  return <div style={{ width: w, height: h, background: 'var(--qa-fill-med)', borderRadius: 4, display: 'inline-block' }} />;
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0, color: 'var(--qa-text)' }}>{children}</h2>
  );
}

function Panel({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: 'var(--qa-card)', border: '1px solid var(--qa-border)', borderRadius: 8, overflow: 'hidden', ...style }}>
      {children}
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function MemberAnalyticsDashboard() {
  const [period, setPeriod]           = useState<Period>('30');
  const [customFrom, setCustomFrom]   = useState('');
  const [customTo, setCustomTo]       = useState('');
  const [showPicker, setShowPicker]   = useState(false);
  const [selectedAgent, setSelectedAgent] = useState('');
  const [agents, setAgents]           = useState<string[]>([]);
  const [data, setData]               = useState<MemberData | null>(null);
  const [loading, setLoading]         = useState(true);
  const [wowChannel, setWowChannel]   = useState<'chats' | 'calls'>('chats');
  const [wowTab, setWowTab]           = useState<'metrics' | 'params'>('metrics');
  const [showAgentDrop, setShowAgentDrop] = useState(false);
  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set());
  const [aiStates, setAiStates]       = useState<Record<string, 'empty'|'loading'|'insights'>>({ chats: 'empty', calls: 'empty' });
  const [aiResults, setAiResults]     = useState<Record<string, AiResult|null>>({ chats: null, calls: null });
  const [aiChannel, setAiChannel]     = useState<'chats' | 'calls'>('chats');

  const lastFetch = useRef('');
  const agentDropRef = useRef<HTMLDivElement>(null);

  // ── Data fetch ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    const key = `${selectedAgent}|${period}|${customFrom}|${customTo}`;
    if (key === lastFetch.current) return;
    if (period === 'custom' && (!customFrom || !customTo)) return;
    lastFetch.current = key;

    let cancelled = false;
    setLoading(true);
    const qs = new URLSearchParams({ period });
    if (selectedAgent) qs.set('agent', selectedAgent);
    if (period === 'custom' && customFrom && customTo) { qs.set('from', customFrom); qs.set('to', customTo); }

    fetch(`/api/cx/tl/member-analytics?${qs}`)
      .then(r => r.json())
      .then((json: MemberData) => {
        if (cancelled) return;
        setData(json);
        if (json.agents?.length) setAgents(json.agents);
        if (!selectedAgent && json.agentName) {
          lastFetch.current = `${json.agentName}|${period}|${customFrom}|${customTo}`;
          setSelectedAgent(json.agentName);
        }
        setLoading(false);
      })
      .catch(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [selectedAgent, period, customFrom, customTo]);

  // ── Click outside agent dropdown ───────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (agentDropRef.current && !agentDropRef.current.contains(e.target as Node)) {
        setShowAgentDrop(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ── Reset AI state when agent or period changes ───────────────────────────────
  useEffect(() => {
    setAiStates({ chats: 'empty', calls: 'empty' });
    setAiResults({ chats: null, calls: null });
  }, [selectedAgent, period, customFrom, customTo]);

  // ── Handlers ──────────────────────────────────────────────────────────────────
  const handlePeriod = (p: Period) => {
    if (p === 'custom') { setShowPicker(true); return; }
    setPeriod(p);
    setCustomFrom(''); setCustomTo('');
  };

  const handleCustomApply = (from: string, to: string) => {
    setCustomFrom(from); setCustomTo(to);
    setPeriod('custom');
    setShowPicker(false);
  };

  const handleAgentSelect = (name: string) => {
    setSelectedAgent(name);
    setShowAgentDrop(false);
    setExpandedCats(new Set());
  };

  const toggleCat = (disp: string) => {
    setExpandedCats(prev => {
      const next = new Set(prev);
      next.has(disp) ? next.delete(disp) : next.add(disp);
      return next;
    });
  };

  const handleGenerateAI = useCallback(async () => {
    setAiStates(prev => ({ ...prev, [aiChannel]: 'loading' }));
    const qs = new URLSearchParams({ channel: aiChannel, period, agent: selectedAgent });
    if (period === 'custom' && customFrom && customTo) { qs.set('from', customFrom); qs.set('to', customTo); }
    try {
      const res = await fetch(`/api/cx/tl/member-analytics/ai?${qs}`);
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setAiResults(prev => ({ ...prev, [aiChannel]: json }));
      setAiStates(prev => ({ ...prev, [aiChannel]: 'insights' }));
    } catch (err) {
      console.error(err);
      setAiStates(prev => ({ ...prev, [aiChannel]: 'empty' }));
    }
  }, [aiChannel, period, selectedAgent, customFrom, customTo]);

  // ── Derived data ───────────────────────────────────────────────────────────────
  const chats   = data?.channels.chats;
  const calls   = data?.channels.calls;
  const wowData = (wowChannel === 'chats' ? chats : calls)?.wow ?? [];
  const wowWeeks = data?.wowWeekStarts ?? [];
  const categories = chats?.categories ?? [];

  const periodLabel = period === 'custom' && customFrom && customTo
    ? (() => {
        const fmtD = (s: string) => new Date(s + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
        return `${fmtD(customFrom)} – ${fmtD(customTo)}`;
      })()
    : PERIOD_LABELS[period];

  // ── Render ──────────────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: 32, maxWidth: 1100, margin: '0 auto' }}>

      {/* ── Page header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, gap: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <h1 style={{ fontSize: 24, fontWeight: 600, margin: 0, color: 'var(--qa-text)' }}>Member Analytics</h1>

          {/* Agent selector */}
          <div ref={agentDropRef} style={{ position: 'relative' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--qa-text-2)' }}>
              <span>Viewing:</span>
              <button
                onClick={() => setShowAgentDrop(p => !p)}
                style={{
                  height: 32, padding: '0 12px', background: 'var(--qa-card)', border: '1px solid var(--qa-border)',
                  borderRadius: 8, display: 'inline-flex', alignItems: 'center', gap: 8,
                  fontSize: 13, fontWeight: 500, color: 'var(--qa-text)', cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                {loading && !selectedAgent ? <Skeleton w={80} h={14} /> : (selectedAgent || '—')}
                <span style={{ color: 'var(--qa-text-3)', fontSize: 10 }}>▾</span>
              </button>
            </div>
            {showAgentDrop && agents.length > 0 && (
              <div style={{
                position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 40,
                background: 'var(--qa-card)', border: '1px solid var(--qa-border)', borderRadius: 8,
                boxShadow: '0 8px 24px rgba(0,0,0,0.1)', minWidth: 180, overflow: 'hidden',
              }}>
                {agents.map(a => (
                  <button
                    key={a}
                    onClick={() => handleAgentSelect(a)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      width: '100%', padding: '10px 14px', background: a === selectedAgent ? 'var(--qa-fill-light)' : 'transparent',
                      border: 0, borderBottom: '1px solid var(--qa-border-sub)', cursor: 'pointer',
                      fontSize: 13, color: 'var(--qa-text)', fontFamily: 'inherit', textAlign: 'left',
                      fontWeight: a === selectedAgent ? 600 : 400,
                    }}
                  >
                    <span style={{
                      width: 28, height: 28, borderRadius: '50%', background: 'var(--qa-fill-med)',
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 11, fontWeight: 600, color: 'var(--qa-text-2)', flexShrink: 0,
                    }}>{agentInitials(a)}</span>
                    {a}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Time range */}
        <div style={{ position: 'relative' }}>
          <div style={{ display: 'inline-flex', border: '1px solid var(--qa-border)', borderRadius: 8, overflow: 'hidden' }}>
            {(['7', '30', 'custom'] as Period[]).map((p) => (
              <button
                key={p}
                onClick={() => handlePeriod(p)}
                style={{
                  height: 32, padding: '0 14px',
                  background: period === p ? 'var(--qa-text)' : 'transparent',
                  border: 0, borderRight: p !== 'custom' ? '1px solid var(--qa-border)' : 'none',
                  fontSize: 13, fontFamily: 'inherit', cursor: 'pointer',
                  color: period === p ? '#fff' : 'var(--qa-text-2)',
                  fontWeight: period === p ? 600 : 400,
                }}
              >
                {p === '7' ? '7 days' : p === '30' ? '30 days' : period === 'custom' && customFrom && customTo ? periodLabel : 'Custom range'}
              </button>
            ))}
          </div>
          {showPicker && (
            <div style={{ position: 'absolute', top: 'calc(100% + 8px)', right: 0, zIndex: 50 }}>
              <DateRangePicker
                onApply={handleCustomApply}
                onCancel={() => { setShowPicker(false); if (period === 'custom' && !customFrom) setPeriod('30'); }}
              />
            </div>
          )}
        </div>
      </div>

      {/* ── Section 1: Stat cards ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 32 }}>
        {([
          { label: 'Chats', data: chats },
          { label: 'Calls', data: calls },
          { label: 'Emails', data: null },
        ] as { label: string; data: ChannelData | null | undefined }[]).map(({ label, data: cd }) => (
          <div key={label} style={{ background: 'var(--qa-card)', border: '1px solid var(--qa-border)', borderRadius: 8, padding: 20 }}>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--qa-text-3)', marginBottom: 14 }}>{label}</div>
            {loading ? (
              <div style={{ display: 'flex', gap: 16 }}>
                <Skeleton w={60} h={32} /><Skeleton w={60} h={32} /><Skeleton w={60} h={32} />
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 0 }}>
                {[
                  { cap: 'CSAT',   val: cd ? fmtPct(cd.stats.csat_pct) : '—', empty: !cd },
                  { cap: 'IQS',    val: cd ? fmtPct(cd.stats.iqs)      : '—', empty: !cd },
                  { cap: 'Volume', val: cd ? fmtVol(cd.stats.volume)    : '—', empty: !cd },
                ].map((item, i) => (
                  <div key={item.cap} style={{ display: 'flex', alignItems: 'flex-end', gap: 0 }}>
                    {i > 0 && <div style={{ width: 1, alignSelf: 'stretch', background: 'var(--qa-border)', marginBottom: 2, marginLeft: 0 }} />}
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', padding: i > 0 ? '0 16px' : '0 16px 0 0', lineHeight: 1.1 }}>
                      <span style={{
                        fontSize: 24, fontWeight: 700, lineHeight: 1,
                        color: item.empty ? 'var(--qa-text-4)' : 'var(--qa-text)',
                        fontVariantNumeric: 'tabular-nums',
                      }}>{item.val}</span>
                      <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--qa-text-3)', marginTop: 6 }}>{item.cap}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {label === 'Emails' && !loading && (
              <div style={{ fontSize: 12, color: 'var(--qa-text-3)', marginTop: 8, fontStyle: 'italic' }}>Not yet evaluated</div>
            )}
          </div>
        ))}
      </div>

      {/* ── Section 2: Performance by Category ── */}
      <section style={{ marginBottom: 32 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <SectionTitle>Performance by Category</SectionTitle>
          <span style={{ fontSize: 11, color: 'var(--qa-text-3)', fontStyle: 'italic' }}>
            {periodLabel} · click a row to expand subcategories
          </span>
        </div>
        <Panel>
          <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--qa-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--qa-text)' }}>Top categories by volume</span>
          </div>
          <div style={{ overflowY: 'auto', maxHeight: 320 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th colSpan={1} style={{ height: 28, background: 'var(--qa-bg)', borderBottom: 0, padding: '8px 16px 0', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--qa-text-2)', fontWeight: 500, textAlign: 'left', position: 'sticky', top: 0, zIndex: 3 }} />
                  <th colSpan={3} style={{ height: 28, background: 'var(--qa-bg)', borderBottom: '1px solid var(--qa-border-sub)', padding: '8px 16px 0', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--qa-text-2)', fontWeight: 500, textAlign: 'center', position: 'sticky', top: 0, zIndex: 3 }}>IQS</th>
                  <th style={{ height: 28, background: 'var(--qa-bg)', borderBottom: 0, padding: '8px 16px 0', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--qa-text-2)', fontWeight: 500, textAlign: 'right', position: 'sticky', top: 0, zIndex: 3 }} />
                </tr>
                <tr>
                  {['Category', 'Chats', 'Calls', 'Emails', 'Chat Resolution'].map((h, i) => (
                    <th key={h} style={{
                      height: 34, background: 'var(--qa-bg)', borderBottom: '1px solid var(--qa-border)',
                      fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em',
                      color: 'var(--qa-text-2)', fontWeight: 500, whiteSpace: 'nowrap',
                      padding: '0 16px', textAlign: i > 0 ? 'right' : 'left',
                      position: 'sticky', top: 28, zIndex: 2,
                      width: i === 0 ? '34%' : undefined,
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  Array.from({ length: 4 }).map((_, i) => (
                    <tr key={i}>
                      {[34, 60, 60, 40, 80].map((w, j) => (
                        <td key={j} style={{ height: 46, padding: '0 16px', borderBottom: '1px solid var(--qa-border-sub)' }}>
                          <Skeleton w={w} h={14} />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : categories.length === 0 ? (
                  <tr><td colSpan={5} style={{ height: 80, textAlign: 'center', color: 'var(--qa-text-3)', fontSize: 13 }}>No category data for this period</td></tr>
                ) : (
                  categories.map(cat => {
                    const open = expandedCats.has(cat.disposition);
                    return (
                      <>
                        <tr
                          key={cat.disposition}
                          onClick={() => cat.subs.length > 0 && toggleCat(cat.disposition)}
                          style={{
                            height: 48, cursor: cat.subs.length > 0 ? 'pointer' : 'default',
                            background: 'transparent',
                          }}
                          onMouseEnter={e => (e.currentTarget as HTMLTableRowElement).style.background = 'var(--qa-fill-light)'}
                          onMouseLeave={e => (e.currentTarget as HTMLTableRowElement).style.background = 'transparent'}
                        >
                          <td style={{ padding: '0 16px', borderBottom: '1px solid var(--qa-border-sub)', fontSize: 14, fontWeight: 500, color: 'var(--qa-text)' }}>
                            {cat.subs.length > 0 && (
                              <span style={{
                                display: 'inline-block', width: 10, height: 10, marginRight: 10,
                                color: 'var(--qa-text-2)', fontSize: 10, transition: 'transform 0.15s',
                                transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
                              }}>▶</span>
                            )}
                            {cat.disposition}
                          </td>
                          <td style={{ padding: '0 16px', borderBottom: '1px solid var(--qa-border-sub)', textAlign: 'right', fontFamily: 'var(--qa-mono, ui-monospace, monospace)', fontSize: 13, color: cat.chats_iqs == null ? 'var(--qa-text-4)' : 'var(--qa-text)' }}>
                            {fmtPct(cat.chats_iqs)}
                          </td>
                          <td style={{ padding: '0 16px', borderBottom: '1px solid var(--qa-border-sub)', textAlign: 'right', fontFamily: 'var(--qa-mono, ui-monospace, monospace)', fontSize: 13, color: cat.calls_iqs == null ? 'var(--qa-text-4)' : 'var(--qa-text)' }}>
                            {fmtPct(cat.calls_iqs)}
                          </td>
                          <td style={{ padding: '0 16px', borderBottom: '1px solid var(--qa-border-sub)', textAlign: 'right', fontSize: 13, color: 'var(--qa-text-4)' }}>—</td>
                          <td style={{ padding: '0 16px', borderBottom: '1px solid var(--qa-border-sub)', textAlign: 'right', fontFamily: 'var(--qa-mono, ui-monospace, monospace)', fontSize: 13, color: cat.chats_resolution_seconds == null ? 'var(--qa-text-4)' : 'var(--qa-text)' }}>
                            {fmtResolution(cat.chats_resolution_seconds)}
                          </td>
                        </tr>
                        {open && cat.subs.map(sub => (
                          <tr key={sub.sub_disposition} style={{ height: 44 }}
                            onMouseEnter={e => (e.currentTarget as HTMLTableRowElement).style.background = 'var(--qa-fill-light)'}
                            onMouseLeave={e => (e.currentTarget as HTMLTableRowElement).style.background = 'transparent'}
                          >
                            <td style={{ padding: '0 16px 0 44px', borderBottom: '1px solid var(--qa-border-sub)', fontSize: 13, color: 'var(--qa-text-2)' }}>
                              {sub.sub_disposition}
                            </td>
                            <td style={{ padding: '0 16px', borderBottom: '1px solid var(--qa-border-sub)', textAlign: 'right', fontFamily: 'var(--qa-mono, ui-monospace, monospace)', fontSize: 13, color: sub.chats_iqs == null ? 'var(--qa-text-4)' : 'var(--qa-text)' }}>
                              {fmtPct(sub.chats_iqs)}
                            </td>
                            <td style={{ padding: '0 16px', borderBottom: '1px solid var(--qa-border-sub)', textAlign: 'right', fontFamily: 'var(--qa-mono, ui-monospace, monospace)', fontSize: 13, color: sub.calls_iqs == null ? 'var(--qa-text-4)' : 'var(--qa-text)' }}>
                              {fmtPct(sub.calls_iqs)}
                            </td>
                            <td style={{ padding: '0 16px', borderBottom: '1px solid var(--qa-border-sub)', textAlign: 'right', fontSize: 13, color: 'var(--qa-text-4)' }}>—</td>
                            <td style={{ padding: '0 16px', borderBottom: '1px solid var(--qa-border-sub)', textAlign: 'right', fontFamily: 'var(--qa-mono, ui-monospace, monospace)', fontSize: 13, color: sub.chats_resolution_seconds == null ? 'var(--qa-text-4)' : 'var(--qa-text)' }}>
                              {fmtResolution(sub.chats_resolution_seconds)}
                            </td>
                          </tr>
                        ))}
                      </>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      </section>

      {/* ── Section 3: Week-on-Week ── */}
      <section style={{ marginBottom: 32 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <SectionTitle>Week-on-Week Performance</SectionTitle>
          <span style={{ fontSize: 11, color: 'var(--qa-text-3)', fontStyle: 'italic' }}>Trailing 5 weeks · week beginning – ending</span>
        </div>
        <Panel>
          <div style={{ padding: '0 12px 0 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--qa-border)' }}>
            {/* Tabs */}
            <div style={{ display: 'flex', gap: 4 }}>
              {([['metrics', 'CSAT + IQS + Volume'], ['params', 'IQS by Parameter']] as [string, string][]).map(([key, lbl]) => (
                <button
                  key={key}
                  onClick={() => setWowTab(key as 'metrics' | 'params')}
                  style={{
                    height: 48, padding: '0 16px', background: 'transparent', border: 0,
                    fontSize: 13, fontFamily: 'inherit', cursor: 'pointer',
                    color: wowTab === key ? 'var(--qa-text)' : 'var(--qa-text-2)',
                    fontWeight: wowTab === key ? 600 : 400,
                    borderBottom: wowTab === key ? '2px solid var(--qa-text)' : '2px solid transparent',
                    marginBottom: -1,
                  }}
                >{lbl}</button>
              ))}
            </div>
            {/* Channel selector */}
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--qa-text-3)' }}>Channel</span>
              <div style={{ display: 'inline-flex', border: '1px solid var(--qa-border)', borderRadius: 8, overflow: 'hidden' }}>
                {(['chats', 'calls'] as const).map(ch => (
                  <button key={ch} onClick={() => setWowChannel(ch)} style={{
                    height: 30, padding: '0 13px', background: wowChannel === ch ? 'var(--qa-text)' : 'transparent',
                    border: 0, borderRight: ch === 'chats' ? '1px solid var(--qa-border)' : 'none',
                    fontSize: 13, fontFamily: 'inherit', cursor: 'pointer',
                    color: wowChannel === ch ? '#fff' : 'var(--qa-text-2)',
                    fontWeight: wowChannel === ch ? 500 : 400,
                  }}>{ch === 'chats' ? 'Chats' : 'Calls'}</button>
                ))}
              </div>
            </div>
          </div>

          {/* Metrics tab */}
          {wowTab === 'metrics' && (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={thStyle()}>Metric</th>
                    {wowWeeks.map((w, i) => (
                      <th key={w} style={thStyle(true, i === wowWeeks.length - 1)}>{fmtWeekLabel(w)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    Array.from({ length: 3 }).map((_, i) => (
                      <tr key={i}>
                        {Array.from({ length: (wowWeeks.length || 5) + 1 }).map((__, j) => (
                          <td key={j} style={tdStyle(false, false)}><Skeleton w={50} h={14} /></td>
                        ))}
                      </tr>
                    ))
                  ) : (
                    ([
                      { name: 'CSAT %',  key: 'csat_pct', fmt: fmtPct },
                      { name: 'IQS',     key: 'iqs',      fmt: fmtPct },
                      { name: 'Volume',  key: 'volume',   fmt: (v: number|null) => v == null ? '—' : fmtVol(v as number) },
                    ] as { name: string; key: keyof WowWeek; fmt: (v: any) => string }[]).map(row => (
                      <tr key={row.name}>
                        <td style={tdStyle(false, false, true)}>{row.name}</td>
                        {wowWeeks.map((w, i) => {
                          const week = wowData.find(wd => wd.week_start === w);
                          const val = week ? (week[row.key] as any) : null;
                          return (
                            <td key={w} style={tdStyle(true, i === wowWeeks.length - 1)}>
                              {row.fmt(val)}
                            </td>
                          );
                        })}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* Params tab */}
          {wowTab === 'params' && (
            <div style={{ overflowX: 'auto', maxHeight: 360, overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ ...thStyle(), minWidth: 200 }}>Parameter</th>
                    {wowWeeks.map((w, i) => (
                      <th key={w} style={thStyle(true, i === wowWeeks.length - 1)}>{fmtWeekLabel(w)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <tr key={i}>
                        {Array.from({ length: (wowWeeks.length || 5) + 1 }).map((__, j) => (
                          <td key={j} style={tdStyle(false, false)}><Skeleton w={50} h={14} /></td>
                        ))}
                      </tr>
                    ))
                  ) : (
                    PARAM_DEFS.map(param => (
                      <tr key={param.key}>
                        <td style={tdStyle(false, false, true)}>{param.label}</td>
                        {wowWeeks.map((w, i) => {
                          const week = wowData.find(wd => wd.week_start === w);
                          const val = week?.params?.[param.key] ?? null;
                          return (
                            <td key={w} style={{ ...tdStyle(true, i === wowWeeks.length - 1), color: val == null ? 'var(--qa-text-4)' : 'var(--qa-text)' }}>
                              {val == null ? '—' : `${val.toFixed(1)}%`}
                            </td>
                          );
                        })}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </section>

      {/* ── Section 4: AI Analysis ── */}
      <section style={{ marginBottom: 32 }}>
        <div style={{ marginBottom: 12 }}>
          <SectionTitle>AI Analysis</SectionTitle>
        </div>
        <div style={{ background: 'var(--qa-bg)', border: '1px solid var(--qa-border)', borderRadius: 8, padding: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <h3 style={{ fontSize: 18, fontWeight: 600, margin: 0, color: 'var(--qa-text)' }}>AI Analysis</h3>
            <button
              onClick={handleGenerateAI}
              disabled={aiStates[aiChannel] === 'loading' || !selectedAgent}
              style={{
                height: 36, padding: '0 16px', borderRadius: 8, fontFamily: 'inherit', fontSize: 13,
                fontWeight: 500, cursor: aiStates[aiChannel] === 'loading' || !selectedAgent ? 'not-allowed' : 'pointer',
                display: 'inline-flex', alignItems: 'center', gap: 8, border: '1px solid var(--qa-text)',
                background: aiStates[aiChannel] === 'loading' || !selectedAgent ? 'var(--qa-fill-med)' : 'var(--qa-text)',
                color: aiStates[aiChannel] === 'loading' || !selectedAgent ? 'var(--qa-text-3)' : '#fff',
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 3l1.9 4.6L18.5 9l-4.6 1.9L12 15l-1.9-4.1L5.5 9l4.6-1.4L12 3z"/>
              </svg>
              {aiStates[aiChannel] === 'insights' ? 'Regenerate' : 'Generate Analysis'}
            </button>
          </div>

          {/* AI Channel tabs */}
          <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--qa-border)', marginBottom: 20 }}>
            {(['chats', 'calls'] as const).map(ch => (
              <button key={ch} onClick={() => setAiChannel(ch)} style={{
                height: 36, padding: '0 14px', background: 'transparent', border: 0,
                fontSize: 13, fontFamily: 'inherit', cursor: 'pointer',
                color: aiChannel === ch ? 'var(--qa-text)' : 'var(--qa-text-2)',
                fontWeight: aiChannel === ch ? 600 : 400,
                borderBottom: aiChannel === ch ? '2px solid var(--qa-text)' : '2px solid transparent',
                marginBottom: -1,
              }}>{ch === 'chats' ? 'Chats' : 'Calls'}</button>
            ))}
            <button disabled style={{
              height: 36, padding: '0 14px', background: 'transparent', border: 0,
              fontSize: 13, fontFamily: 'inherit', cursor: 'not-allowed',
              color: 'var(--qa-text-4)', borderBottom: '2px solid transparent', marginBottom: -1,
            }} title="Coming soon">Emails</button>
          </div>

          {/* Loading state */}
          {aiStates[aiChannel] === 'loading' && (
            <div style={{ minHeight: 160, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, color: 'var(--qa-text-2)', fontSize: 13 }}>
              <div style={{
                width: 16, height: 16, border: '2px solid var(--qa-fill-med)', borderTopColor: 'var(--qa-text)',
                borderRadius: '50%', animation: 'spin 0.7s linear infinite',
              }} />
              Analysing {aiChannel}…
            </div>
          )}

          {/* Empty state */}
          {aiStates[aiChannel] === 'empty' && (
            <div style={{ minHeight: 160, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, textAlign: 'center' }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="var(--qa-text-4)" stroke="none">
                <path d="M12 3l1.9 4.6L18.5 9l-4.6 1.9L12 15l-1.9-4.1L5.5 9l4.6-1.4L12 3z"/>
              </svg>
              <p style={{ fontSize: 13, color: 'var(--qa-text-3)', margin: 0, maxWidth: 340 }}>
                Click <strong>Generate Analysis</strong> to get AI-powered performance insights.
              </p>
            </div>
          )}

          {/* Insights */}
          {aiStates[aiChannel] === 'insights' && aiResults[aiChannel] && (
            <div>
              <p style={{ fontSize: 14, color: 'var(--qa-text)', lineHeight: 1.6, margin: '0 0 18px', maxWidth: 760 }}>
                {aiResults[aiChannel]!.summary}
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {aiResults[aiChannel]!.items.map((item, i) => (
                  <div key={i} style={{
                    display: 'flex', gap: 12, padding: '14px 16px',
                    background: 'var(--qa-card)', border: '1px solid var(--qa-border)', borderRadius: 8,
                  }}>
                    <span style={{
                      flexShrink: 0, height: 20, padding: '0 8px', borderRadius: 999,
                      fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em',
                      display: 'inline-flex', alignItems: 'center',
                      background: item.type === 'strength' ? 'var(--qa-text)' : item.type === 'watch' ? 'var(--qa-fill-med)' : 'transparent',
                      color: item.type === 'strength' ? '#fff' : 'var(--qa-text)',
                      border: item.type === 'tip' ? '1px solid var(--qa-border)' : 'none',
                    }}>
                      {item.type === 'strength' ? 'Strength' : item.type === 'watch' ? 'Watch' : 'Tip'}
                    </span>
                    <span style={{ fontSize: 13, color: 'var(--qa-text)', lineHeight: 1.5 }}>{item.text}</span>
                  </div>
                ))}
              </div>
              <p style={{ marginTop: 14, fontSize: 11, color: 'var(--qa-text-3)', fontStyle: 'italic' }}>
                Generated from {agentInitials(selectedAgent)} {selectedAgent}'s evaluated {aiChannel} · {periodLabel}
              </p>
            </div>
          )}
        </div>
      </section>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ── Table style helpers ────────────────────────────────────────────────────────
function thStyle(num = false, recent = false): React.CSSProperties {
  return {
    height: 40, background: recent ? 'var(--qa-bg)' : 'var(--qa-bg)',
    borderBottom: '1px solid var(--qa-border)',
    fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em',
    color: 'var(--qa-text-2)', fontWeight: 500, textAlign: num ? 'right' : 'left',
    padding: '0 16px', whiteSpace: 'nowrap', position: 'sticky', top: 0, zIndex: 2,
  };
}

function tdStyle(num = false, recent = false, bold = false): React.CSSProperties {
  return {
    height: 46, padding: '0 16px', borderBottom: '1px solid var(--qa-border-sub)',
    fontSize: num ? 13 : 14, color: 'var(--qa-text)',
    textAlign: num ? 'right' : 'left', verticalAlign: 'middle',
    fontFamily: num ? 'var(--qa-mono, ui-monospace, monospace)' : 'inherit',
    fontWeight: bold ? 500 : 400,
    background: recent ? 'var(--qa-fill-light)' : 'transparent',
  };
}
