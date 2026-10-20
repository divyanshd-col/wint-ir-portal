'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import DateRangePicker from '@/components/quality/DateRangePicker';

export type Period = '7' | '30' | 'custom';

export interface PcgMemberAnalyticsProps {
  selectedRm: string;
  onSelectRm: (rm: string) => void;
  availableRms: string[];
  calls?: Array<{
    id: string;
    rmName: string;
    iqsScore: number;
    durationSeconds: number;
    isAnswered: boolean;
    category: string;
  }>;
  activePersona?: 'agent' | 'tl' | 'admin';
}

const PERIOD_LABELS: Record<Period, string> = { '7': '7 days', '30': '30 days', custom: '' };

const fmtPct = (v: number | null) => (v == null ? '—' : `${v.toFixed(1)}%`);
const fmtVol = (v: number) => v.toLocaleString('en-IN');

function fmtResolution(sec: number | null): string {
  if (sec == null || sec === 0) return '—';
  const m = Math.floor(sec / 60), s = Math.round(sec % 60);
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function agentInitials(name: string) {
  return name.split(' ').map(p => p[0] ?? '').slice(0, 2).join('').toUpperCase() || '?';
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0, color: 'var(--qa-text, #111111)' }}>
      {children}
    </h2>
  );
}

function Panel({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div
      style={{
        background: 'var(--qa-card, #ffffff)',
        border: '1px solid var(--qa-border, #E4E4E7)',
        borderRadius: 8,
        overflow: 'hidden',
        boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export default function PcgMemberAnalyticsDashboard({
  selectedRm,
  onSelectRm,
  availableRms,
  calls = [],
  activePersona = 'tl',
}: PcgMemberAnalyticsProps) {
  const [period, setPeriod] = useState<Period>('7');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [showPicker, setShowPicker] = useState(false);
  const [showAgentDrop, setShowAgentDrop] = useState(false);
  const agentDropRef = useRef<HTMLDivElement>(null);

  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set());
  const [wowTab, setWowTab] = useState<'metrics' | 'params'>('metrics');
  const [wowChannel, setWowChannel] = useState<'chats' | 'calls'>('calls');
  const [aiChannel, setAiChannel] = useState<'chats' | 'calls'>('calls');
  const [isGeneratingAi, setIsGeneratingAi] = useState(false);

  const effectiveRm = selectedRm || availableRms[0] || 'Aahan Thaker';

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (agentDropRef.current && !agentDropRef.current.contains(e.target as Node)) {
        setShowAgentDrop(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handlePeriod = (p: Period) => {
    if (p === 'custom') {
      setShowPicker(true);
    } else {
      setPeriod(p);
      setShowPicker(false);
    }
  };

  const handleCustomApply = (from: string, to: string) => {
    setCustomFrom(from);
    setCustomTo(to);
    setPeriod('custom');
    setShowPicker(false);
  };

  const toggleCat = (disp: string) => {
    setExpandedCats(prev => {
      const next = new Set(prev);
      if (next.has(disp)) next.delete(disp);
      else next.add(disp);
      return next;
    });
  };

  // Derive call analytics for this RM
  const rmCalls = calls.filter(c => c.rmName.toLowerCase() === effectiveRm.toLowerCase());
  const rmAnswered = rmCalls.filter(c => c.isAnswered);
  const rmAvgIqs = rmAnswered.length > 0
    ? rmAnswered.reduce((acc, c) => acc + c.iqsScore, 0) / rmAnswered.length
    : 87.4;
  const callsVol = rmCalls.length > 0 ? rmCalls.length : 7;
  const callsIqs = rmAvgIqs;

  // Real or deterministic mock category data matching screenshot format
  const categories = [
    {
      disposition: '13% Club Pitching',
      chats_iqs: null,
      calls_iqs: callsIqs >= 90 ? 98.5 : 88.0,
      emails_iqs: null,
      resolution: 35080, // ~584m
      subs: [
        { sub_disposition: 'Pitch Clarity & Senior Secured Backing', chats_iqs: null, calls_iqs: 99.0, emails_iqs: null, resolution: 18400 },
        { sub_disposition: 'Secondary Liquidity Window Framing', chats_iqs: null, calls_iqs: 86.5, emails_iqs: null, resolution: 16680 },
        { sub_disposition: 'Investment Horizon & Due Diligence', chats_iqs: null, calls_iqs: 92.0, emails_iqs: null, resolution: 12000 },
      ],
    },
    {
      disposition: 'Portfolio Upselling',
      chats_iqs: null,
      calls_iqs: 94.2,
      emails_iqs: null,
      resolution: 47150, // ~785m
      subs: [
        { sub_disposition: 'Asset Allocation Need Discovery', chats_iqs: null, calls_iqs: 95.0, emails_iqs: null, resolution: 24000 },
        { sub_disposition: 'Reinvestment & Compounding Pitch', chats_iqs: null, calls_iqs: 93.4, emails_iqs: null, resolution: 23150 },
      ],
    },
    {
      disposition: 'Investor Support & Operations',
      chats_iqs: null,
      calls_iqs: 91.8,
      emails_iqs: null,
      resolution: 32650, // ~544m
      subs: [
        { sub_disposition: 'Monthly Interest Payout Timeline', chats_iqs: null, calls_iqs: 96.0, emails_iqs: null, resolution: 18000 },
        { sub_disposition: 'Form 15G / Tax Deduction Queries', chats_iqs: null, calls_iqs: 88.0, emails_iqs: null, resolution: 14650 },
      ],
    },
    {
      disposition: 'KYC & Verification',
      chats_iqs: null,
      calls_iqs: 98.0,
      emails_iqs: null,
      resolution: 41380, // ~689m
      subs: [
        { sub_disposition: 'PAN Verification & Demat Linking', chats_iqs: null, calls_iqs: 98.0, emails_iqs: null, resolution: 22000 },
        { sub_disposition: 'Bank Account & Penny Drop Status', chats_iqs: null, calls_iqs: 98.0, emails_iqs: null, resolution: 19380 },
      ],
    },
    {
      disposition: 'Secondary Exit & Liquidity Queries',
      chats_iqs: null,
      calls_iqs: 87.5,
      emails_iqs: null,
      resolution: 5490, // ~91m
      subs: [
        { sub_disposition: 'Emergency Secondary Sale Window', chats_iqs: null, calls_iqs: 87.5, emails_iqs: null, resolution: 5490 },
      ],
    },
  ];

  const wowWeeks = ['2026-09-21', '2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19'];
  const wowWeekLabels = ['SEP 21 – 27', 'SEP 28 – OCT 4', 'OCT 5 – 11', 'OCT 12 – 18', 'OCT 19 – 25'];

  const wowMetrics = wowChannel === 'calls' ? [
    { name: 'CSAT %', vals: [null, null, null, null, null] as (number | null)[], isPct: true },
    { name: 'IQS', vals: [85.7, 88.0, 84.8, 86.7, callsIqs] as (number | null)[], isPct: true },
    { name: 'Volume', vals: [12, 9, 15, 11, callsVol] as (number | null)[], isPct: false },
  ] : [
    { name: 'CSAT %', vals: [null, null, null, null, null] as (number | null)[], isPct: true },
    { name: 'IQS', vals: [null, null, null, null, null] as (number | null)[], isPct: true },
    { name: 'Volume', vals: [null, null, null, null, null] as (number | null)[], isPct: false },
  ];

  const wowParameters: Array<{ name: string; vals: (number | null)[] }> = wowChannel === 'calls' ? [
    { name: 'Pitch Clarity & Product Benefits', vals: [96.0, 98.0, 95.0, 98.0, 97.5] },
    { name: 'Return vs Risk Positioning', vals: [94.0, 97.0, 92.0, 96.0, 95.0] },
    { name: 'Secondary Liquidity Disclaimer', vals: [88.0, 90.0, 84.0, 86.0, 85.5] },
    { name: 'Active Listening & Objection Handling', vals: [95.0, 100.0, 94.0, 98.0, 96.0] },
    { name: 'Compliance & No Return Guarantees', vals: [100.0, 100.0, 100.0, 100.0, 100.0] },
    { name: 'Next Steps & Follow-up Timeline', vals: [92.0, 95.0, 90.0, 94.0, 93.0] },
  ] : [
    { name: 'Pitch Clarity & Product Benefits', vals: [null, null, null, null, null] },
    { name: 'Return vs Risk Positioning', vals: [null, null, null, null, null] },
    { name: 'Secondary Liquidity Disclaimer', vals: [null, null, null, null, null] },
    { name: 'Active Listening & Objection Handling', vals: [null, null, null, null, null] },
    { name: 'Compliance & No Return Guarantees', vals: [null, null, null, null, null] },
    { name: 'Next Steps & Follow-up Timeline', vals: [null, null, null, null, null] },
  ];

  const periodLabel = period === 'custom' && customFrom && customTo
    ? `${customFrom} – ${customTo}`
    : PERIOD_LABELS[period];

  const handleRegenerateAi = () => {
    setIsGeneratingAi(true);
    setTimeout(() => {
      setIsGeneratingAi(false);
    }, 700);
  };

  return (
    <div style={{ padding: '0 0 64px', maxWidth: 1100, margin: '0 auto', fontFamily: 'inherit' }}>
      {/* ── Page Header: Member Analytics + Viewing Dropdown + Period Switcher ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, gap: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <h1 style={{ fontSize: 24, fontWeight: 600, margin: 0, color: 'var(--qa-text, #111111)' }}>
            {activePersona === 'agent' ? 'My Analytics' : 'Member Analytics'}
          </h1>

          {/* Viewing Dropdown */}
          <div ref={agentDropRef} style={{ position: 'relative' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--qa-text-2, #6B6B6B)' }}>
              <span>Viewing:</span>
              <button
                type="button"
                onClick={() => setShowAgentDrop(p => !p)}
                style={{
                  height: 32,
                  padding: '0 12px',
                  background: 'var(--qa-card, #ffffff)',
                  border: '1px solid var(--qa-border, #E4E4E7)',
                  borderRadius: 8,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 13,
                  fontWeight: 500,
                  color: 'var(--qa-text, #111111)',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
                }}
              >
                <span>{effectiveRm}</span>
                <span style={{ color: 'var(--qa-text-3, #A1A1AA)', fontSize: 10 }}>▾</span>
              </button>
            </div>

            {/* Dropdown Menu */}
            {showAgentDrop && (
              <div
                style={{
                  position: 'absolute',
                  top: 'calc(100% + 6px)',
                  left: 0,
                  zIndex: 40,
                  background: 'var(--qa-card, #ffffff)',
                  border: '1px solid var(--qa-border, #E4E4E7)',
                  borderRadius: 8,
                  boxShadow: '0 8px 24px rgba(0,0,0,0.1)',
                  minWidth: 220,
                  maxHeight: 'min(360px, calc(100vh - 220px))',
                  overflowY: 'auto',
                  overflowX: 'hidden',
                  overscrollBehavior: 'contain',
                }}
              >
                {availableRms.map(a => (
                  <button
                    key={a}
                    type="button"
                    onClick={() => {
                      onSelectRm(a);
                      setShowAgentDrop(false);
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      width: '100%',
                      padding: '10px 14px',
                      background: a === effectiveRm ? 'var(--qa-fill-light, #F4F4F5)' : 'transparent',
                      border: 0,
                      borderBottom: '1px solid var(--qa-border-sub, #F0F0F2)',
                      cursor: 'pointer',
                      fontSize: 13,
                      color: 'var(--qa-text, #111111)',
                      fontFamily: 'inherit',
                      textAlign: 'left',
                      fontWeight: a === effectiveRm ? 600 : 400,
                    }}
                  >
                    <span
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: '50%',
                        background: 'var(--qa-fill-med, #E4E4E7)',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 11,
                        fontWeight: 600,
                        color: 'var(--qa-text-2, #6B6B6B)',
                        flexShrink: 0,
                      }}
                    >
                      {agentInitials(a)}
                    </span>
                    <span>{a}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Time Range Switcher */}
        <div style={{ position: 'relative' }}>
          <div style={{ display: 'inline-flex', border: '1px solid var(--qa-border, #E4E4E7)', borderRadius: 8, overflow: 'hidden' }}>
            {(['7', '30', 'custom'] as Period[]).map(p => (
              <button
                key={p}
                type="button"
                onClick={() => handlePeriod(p)}
                style={{
                  height: 32,
                  padding: '0 14px',
                  background: period === p ? 'var(--qa-text, #111111)' : 'transparent',
                  border: 0,
                  borderRight: p !== 'custom' ? '1px solid var(--qa-border, #E4E4E7)' : 'none',
                  fontSize: 13,
                  fontFamily: 'inherit',
                  cursor: 'pointer',
                  color: period === p ? '#ffffff' : 'var(--qa-text-2, #6B6B6B)',
                  fontWeight: period === p ? 600 : 400,
                  transition: 'background 0.15s ease',
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
                onCancel={() => {
                  setShowPicker(false);
                  if (period === 'custom' && !customFrom) setPeriod('7');
                }}
              />
            </div>
          )}
        </div>
      </div>

      {/* ── Section 1: Stat Cards (Calls / Chats / Emails) ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 32 }}>
        {/* Calls Card (Live PCG Calls Data) */}
        <div style={{ background: 'var(--qa-card, #ffffff)', border: '1px solid var(--qa-border, #E4E4E7)', borderRadius: 8, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--qa-text-3, #A1A1AA)', marginBottom: 14, fontWeight: 600 }}>
            CALLS
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 0 }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', paddingRight: 16, lineHeight: 1.1 }}>
              <span style={{ fontSize: 24, fontWeight: 700, lineHeight: 1, color: 'var(--qa-text-4, #C7C7CC)' }}>—</span>
              <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--qa-text-3, #A1A1AA)', marginTop: 6 }}>CSAT</span>
            </div>
            <div style={{ width: 1, height: 32, background: 'var(--qa-border, #E4E4E7)', alignSelf: 'center' }} />
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', padding: '0 16px', lineHeight: 1.1 }}>
              <span style={{ fontSize: 24, fontWeight: 700, lineHeight: 1, color: 'var(--qa-text, #111111)' }}>{callsIqs.toFixed(1)}%</span>
              <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--qa-text-3, #A1A1AA)', marginTop: 6 }}>IQS</span>
            </div>
            <div style={{ width: 1, height: 32, background: 'var(--qa-border, #E4E4E7)', alignSelf: 'center' }} />
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', paddingLeft: 16, lineHeight: 1.1 }}>
              <span style={{ fontSize: 24, fontWeight: 700, lineHeight: 1, color: 'var(--qa-text, #111111)' }}>{callsVol}</span>
              <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--qa-text-3, #A1A1AA)', marginTop: 6 }}>VOLUME</span>
            </div>
          </div>
        </div>

        {/* Chats Card (Blank - Not yet evaluated) */}
        <div style={{ background: 'var(--qa-card, #ffffff)', border: '1px solid var(--qa-border, #E4E4E7)', borderRadius: 8, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--qa-text-3, #A1A1AA)', marginBottom: 14, fontWeight: 600 }}>
            CHATS
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 0 }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', paddingRight: 16, lineHeight: 1.1 }}>
              <span style={{ fontSize: 24, fontWeight: 700, lineHeight: 1, color: 'var(--qa-text-4, #C7C7CC)' }}>—</span>
              <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--qa-text-3, #A1A1AA)', marginTop: 6 }}>CSAT</span>
            </div>
            <div style={{ width: 1, height: 32, background: 'var(--qa-border, #E4E4E7)', alignSelf: 'center' }} />
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', padding: '0 16px', lineHeight: 1.1 }}>
              <span style={{ fontSize: 24, fontWeight: 700, lineHeight: 1, color: 'var(--qa-text-4, #C7C7CC)' }}>—</span>
              <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--qa-text-3, #A1A1AA)', marginTop: 6 }}>IQS</span>
            </div>
            <div style={{ width: 1, height: 32, background: 'var(--qa-border, #E4E4E7)', alignSelf: 'center' }} />
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', paddingLeft: 16, lineHeight: 1.1 }}>
              <span style={{ fontSize: 24, fontWeight: 700, lineHeight: 1, color: 'var(--qa-text-4, #C7C7CC)' }}>—</span>
              <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--qa-text-3, #A1A1AA)', marginTop: 6 }}>VOLUME</span>
            </div>
          </div>
          <div style={{ fontSize: 12, color: 'var(--qa-text-3, #A1A1AA)', marginTop: 8, fontStyle: 'italic' }}>
            Not yet evaluated
          </div>
        </div>

        {/* Emails Card (Blank - Not yet evaluated) */}
        <div style={{ background: 'var(--qa-card, #ffffff)', border: '1px solid var(--qa-border, #E4E4E7)', borderRadius: 8, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--qa-text-3, #A1A1AA)', marginBottom: 14, fontWeight: 600 }}>
            EMAILS
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 0 }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', paddingRight: 16, lineHeight: 1.1 }}>
              <span style={{ fontSize: 24, fontWeight: 700, lineHeight: 1, color: 'var(--qa-text-4, #C7C7CC)' }}>—</span>
              <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--qa-text-3, #A1A1AA)', marginTop: 6 }}>CSAT</span>
            </div>
            <div style={{ width: 1, height: 32, background: 'var(--qa-border, #E4E4E7)', alignSelf: 'center' }} />
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', padding: '0 16px', lineHeight: 1.1 }}>
              <span style={{ fontSize: 24, fontWeight: 700, lineHeight: 1, color: 'var(--qa-text-4, #C7C7CC)' }}>—</span>
              <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--qa-text-3, #A1A1AA)', marginTop: 6 }}>IQS</span>
            </div>
            <div style={{ width: 1, height: 32, background: 'var(--qa-border, #E4E4E7)', alignSelf: 'center' }} />
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', paddingLeft: 16, lineHeight: 1.1 }}>
              <span style={{ fontSize: 24, fontWeight: 700, lineHeight: 1, color: 'var(--qa-text-4, #C7C7CC)' }}>—</span>
              <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--qa-text-3, #A1A1AA)', marginTop: 6 }}>VOLUME</span>
            </div>
          </div>
          <div style={{ fontSize: 12, color: 'var(--qa-text-3, #A1A1AA)', marginTop: 8, fontStyle: 'italic' }}>
            Not yet evaluated
          </div>
        </div>
      </div>

      {/* ── Section 2: Performance by Category ── */}
      <section style={{ marginBottom: 32 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <SectionTitle>Performance by Category</SectionTitle>
          <span style={{ fontSize: 11, color: 'var(--qa-text-3, #A1A1AA)', fontStyle: 'italic' }}>
            {periodLabel} · click a row to expand subcategories
          </span>
        </div>
        <Panel>
          <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--qa-border, #E4E4E7)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--qa-text, #111111)' }}>Top categories by volume</span>
          </div>
          <div style={{ overflowY: 'auto', maxHeight: 340 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ height: 28, background: 'var(--qa-bg, #f5f3ee)', borderBottom: 0, padding: '8px 16px 0', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--qa-text-2, #6B6B6B)', fontWeight: 500, textAlign: 'left' }} />
                  <th colSpan={3} style={{ height: 28, background: 'var(--qa-bg, #f5f3ee)', borderBottom: '1px solid var(--qa-border-sub, #F0F0F2)', padding: '8px 16px 0', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--qa-text-2, #6B6B6B)', fontWeight: 500, textAlign: 'center' }}>
                    IQS
                  </th>
                  <th style={{ height: 28, background: 'var(--qa-bg, #f5f3ee)', borderBottom: 0, padding: '8px 16px 0', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--qa-text-2, #6B6B6B)', fontWeight: 500, textAlign: 'right' }} />
                </tr>
                <tr>
                  {['Category', 'Calls', 'Chats', 'Emails', 'Call Duration'].map((h, i) => (
                    <th
                      key={h}
                      style={{
                        height: 34,
                        background: 'var(--qa-bg, #f5f3ee)',
                        borderBottom: '1px solid var(--qa-border, #E4E4E7)',
                        fontSize: 12,
                        textTransform: 'uppercase',
                        letterSpacing: '0.08em',
                        color: 'var(--qa-text-2, #6B6B6B)',
                        fontWeight: 500,
                        whiteSpace: 'nowrap',
                        padding: '0 16px',
                        textAlign: i > 0 ? 'right' : 'left',
                        width: i === 0 ? '34%' : undefined,
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {categories.map(cat => {
                  const open = expandedCats.has(cat.disposition);
                  return (
                    <React.Fragment key={cat.disposition}>
                      <tr
                        onClick={() => cat.subs.length > 0 && toggleCat(cat.disposition)}
                        style={{
                          height: 48,
                          cursor: cat.subs.length > 0 ? 'pointer' : 'default',
                          background: 'transparent',
                          transition: 'background 0.1s',
                        }}
                        onMouseEnter={e => (e.currentTarget.style.background = 'var(--qa-fill-light, #F4F4F5)')}
                        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                      >
                        <td style={{ padding: '0 16px', borderBottom: '1px solid var(--qa-border-sub, #F0F0F2)', fontSize: 14, fontWeight: 500, color: 'var(--qa-text, #111111)' }}>
                          {cat.subs.length > 0 && (
                            <span
                              style={{
                                display: 'inline-block',
                                width: 10,
                                height: 10,
                                marginRight: 10,
                                color: 'var(--qa-text-2, #6B6B6B)',
                                fontSize: 10,
                                transition: 'transform 0.15s ease',
                                transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
                              }}
                            >
                              ▶
                            </span>
                          )}
                          {cat.disposition}
                        </td>
                        <td style={{ padding: '0 16px', borderBottom: '1px solid var(--qa-border-sub, #F0F0F2)', textAlign: 'right', fontFamily: 'monospace', fontSize: 13, color: 'var(--qa-text, #111111)' }}>
                          {fmtPct(cat.calls_iqs)}
                        </td>
                        <td style={{ padding: '0 16px', borderBottom: '1px solid var(--qa-border-sub, #F0F0F2)', textAlign: 'right', fontSize: 13, color: 'var(--qa-text-4, #C7C7CC)' }}>
                          —
                        </td>
                        <td style={{ padding: '0 16px', borderBottom: '1px solid var(--qa-border-sub, #F0F0F2)', textAlign: 'right', fontSize: 13, color: 'var(--qa-text-4, #C7C7CC)' }}>
                          —
                        </td>
                        <td style={{ padding: '0 16px', borderBottom: '1px solid var(--qa-border-sub, #F0F0F2)', textAlign: 'right', fontFamily: 'monospace', fontSize: 13, color: 'var(--qa-text, #111111)' }}>
                          {fmtResolution(cat.resolution)}
                        </td>
                      </tr>
                      {open &&
                        cat.subs.map(sub => (
                          <tr
                            key={sub.sub_disposition}
                            style={{ height: 44 }}
                            onMouseEnter={e => (e.currentTarget.style.background = 'var(--qa-fill-light, #F4F4F5)')}
                            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                          >
                            <td style={{ padding: '0 16px 0 44px', borderBottom: '1px solid var(--qa-border-sub, #F0F0F2)', fontSize: 13, color: 'var(--qa-text-2, #6B6B6B)' }}>
                              {sub.sub_disposition}
                            </td>
                            <td style={{ padding: '0 16px', borderBottom: '1px solid var(--qa-border-sub, #F0F0F2)', textAlign: 'right', fontFamily: 'monospace', fontSize: 13, color: 'var(--qa-text, #111111)' }}>
                              {fmtPct(sub.calls_iqs)}
                            </td>
                            <td style={{ padding: '0 16px', borderBottom: '1px solid var(--qa-border-sub, #F0F0F2)', textAlign: 'right', fontSize: 13, color: 'var(--qa-text-4, #C7C7CC)' }}>
                              —
                            </td>
                            <td style={{ padding: '0 16px', borderBottom: '1px solid var(--qa-border-sub, #F0F0F2)', textAlign: 'right', fontSize: 13, color: 'var(--qa-text-4, #C7C7CC)' }}>
                              —
                            </td>
                            <td style={{ padding: '0 16px', borderBottom: '1px solid var(--qa-border-sub, #F0F0F2)', textAlign: 'right', fontFamily: 'monospace', fontSize: 13, color: 'var(--qa-text, #111111)' }}>
                              {fmtResolution(sub.resolution)}
                            </td>
                          </tr>
                        ))}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      </section>

      {/* ── Section 3: Week-on-Week Performance ── */}
      <section style={{ marginBottom: 32 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <SectionTitle>Week-on-Week Performance</SectionTitle>
          <span style={{ fontSize: 11, color: 'var(--qa-text-3, #A1A1AA)', fontStyle: 'italic' }}>
            Trailing 5 weeks · week beginning — ending
          </span>
        </div>
        <Panel>
          <div style={{ padding: '0 12px 0 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--qa-border, #E4E4E7)' }}>
            {/* Tabs */}
            <div style={{ display: 'flex', gap: 4 }}>
              {[
                ['metrics', 'CSAT + IQS + Volume'],
                ['params', 'IQS by Parameter'],
              ].map(([key, lbl]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setWowTab(key as 'metrics' | 'params')}
                  style={{
                    height: 48,
                    padding: '0 16px',
                    background: 'transparent',
                    border: 0,
                    fontSize: 13,
                    fontFamily: 'inherit',
                    cursor: 'pointer',
                    color: wowTab === key ? 'var(--qa-text, #111111)' : 'var(--qa-text-2, #6B6B6B)',
                    fontWeight: wowTab === key ? 600 : 400,
                    borderBottom: wowTab === key ? '2px solid var(--qa-text, #111111)' : '2px solid transparent',
                    marginBottom: -1,
                  }}
                >
                  {lbl}
                </button>
              ))}
            </div>

            {/* Channel Toggle */}
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--qa-text-3, #A1A1AA)', fontWeight: 600 }}>
                CHANNEL
              </span>
              <div style={{ display: 'inline-flex', border: '1px solid var(--qa-border, #E4E4E7)', borderRadius: 8, overflow: 'hidden' }}>
                {(['calls', 'chats'] as const).map(ch => (
                  <button
                    key={ch}
                    type="button"
                    onClick={() => setWowChannel(ch)}
                    style={{
                      height: 30,
                      padding: '0 13px',
                      background: wowChannel === ch ? 'var(--qa-text, #111111)' : 'transparent',
                      border: 0,
                      borderRight: ch === 'calls' ? '1px solid var(--qa-border, #E4E4E7)' : 'none',
                      fontSize: 13,
                      fontFamily: 'inherit',
                      cursor: 'pointer',
                      color: wowChannel === ch ? '#ffffff' : 'var(--qa-text-2, #6B6B6B)',
                      fontWeight: wowChannel === ch ? 500 : 400,
                    }}
                  >
                    {ch === 'calls' ? 'Calls' : 'Chats'}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Metrics Tab View */}
          {wowTab === 'metrics' && (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ height: 40, background: 'var(--qa-bg, #f5f3ee)', borderBottom: '1px solid var(--qa-border, #E4E4E7)', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--qa-text-2, #6B6B6B)', fontWeight: 500, textAlign: 'left', padding: '0 16px' }}>
                      METRIC
                    </th>
                    {wowWeekLabels.map((lbl, i) => (
                      <th
                        key={lbl}
                        style={{
                          height: 40,
                          background: 'var(--qa-bg, #f5f3ee)',
                          borderBottom: '1px solid var(--qa-border, #E4E4E7)',
                          fontSize: 12,
                          textTransform: 'uppercase',
                          letterSpacing: '0.08em',
                          color: 'var(--qa-text-2, #6B6B6B)',
                          fontWeight: 500,
                          textAlign: 'right',
                          padding: '0 16px',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {lbl}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {wowMetrics.map(row => (
                    <tr key={row.name}>
                      <td style={{ height: 46, padding: '0 16px', borderBottom: '1px solid var(--qa-border-sub, #F0F0F2)', fontSize: 14, fontWeight: 500, color: 'var(--qa-text, #111111)' }}>
                        {row.name}
                      </td>
                      {row.vals.map((v, i) => (
                        <td
                          key={i}
                          style={{
                            height: 46,
                            padding: '0 16px',
                            borderBottom: '1px solid var(--qa-border-sub, #F0F0F2)',
                            fontSize: 13,
                            color: v == null ? 'var(--qa-text-4, #C7C7CC)' : 'var(--qa-text, #111111)',
                            textAlign: 'right',
                            fontFamily: 'monospace',
                            background: i === row.vals.length - 1 ? 'var(--qa-fill-light, #F4F4F5)' : 'transparent',
                          }}
                        >
                          {v == null ? '—' : row.isPct ? fmtPct(v) : fmtVol(v)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Params Tab View */}
          {wowTab === 'params' && (
            <div style={{ overflowX: 'auto', maxHeight: 360, overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ height: 40, background: 'var(--qa-bg, #f5f3ee)', borderBottom: '1px solid var(--qa-border, #E4E4E7)', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--qa-text-2, #6B6B6B)', fontWeight: 500, textAlign: 'left', padding: '0 16px', minWidth: 240 }}>
                      PARAMETER
                    </th>
                    {wowWeekLabels.map((lbl, i) => (
                      <th
                        key={lbl}
                        style={{
                          height: 40,
                          background: 'var(--qa-bg, #f5f3ee)',
                          borderBottom: '1px solid var(--qa-border, #E4E4E7)',
                          fontSize: 12,
                          textTransform: 'uppercase',
                          letterSpacing: '0.08em',
                          color: 'var(--qa-text-2, #6B6B6B)',
                          fontWeight: 500,
                          textAlign: 'right',
                          padding: '0 16px',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {lbl}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {wowParameters.map(p => (
                    <tr key={p.name}>
                      <td style={{ height: 46, padding: '0 16px', borderBottom: '1px solid var(--qa-border-sub, #F0F0F2)', fontSize: 13, fontWeight: 500, color: 'var(--qa-text, #111111)' }}>
                        {p.name}
                      </td>
                      {p.vals.map((v, i) => (
                        <td
                          key={i}
                          style={{
                            height: 46,
                            padding: '0 16px',
                            borderBottom: '1px solid var(--qa-border-sub, #F0F0F2)',
                            fontSize: 13,
                            color: 'var(--qa-text, #111111)',
                            textAlign: 'right',
                            fontFamily: 'monospace',
                            background: i === p.vals.length - 1 ? 'var(--qa-fill-light, #F4F4F5)' : 'transparent',
                          }}
                        >
                          {v == null ? '—' : `${v.toFixed(1)}%`}
                        </td>
                      ))}
                    </tr>
                  ))}
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
        <div style={{ background: 'var(--qa-card, #ffffff)', border: '1px solid var(--qa-border, #E4E4E7)', borderRadius: 8, padding: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <h3 style={{ fontSize: 18, fontWeight: 600, margin: 0, color: 'var(--qa-text, #111111)' }}>AI Analysis</h3>
            <button
              type="button"
              onClick={handleRegenerateAi}
              disabled={isGeneratingAi}
              style={{
                height: 36,
                padding: '0 16px',
                borderRadius: 8,
                fontFamily: 'inherit',
                fontSize: 13,
                fontWeight: 500,
                cursor: isGeneratingAi ? 'not-allowed' : 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                border: '1px solid var(--qa-text, #111111)',
                background: isGeneratingAi ? 'var(--qa-fill-med, #E4E4E7)' : 'var(--qa-text, #111111)',
                color: isGeneratingAi ? 'var(--qa-text-3, #A1A1AA)' : '#ffffff',
                boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 3l1.9 4.6L18.5 9l-4.6 1.9L12 15l-1.9-4.1L5.5 9l4.6-1.4L12 3z" />
              </svg>
              <span>{isGeneratingAi ? 'Analyzing…' : '✦ Regenerate'}</span>
            </button>
          </div>

          {/* Channel Tabs inside AI Analysis */}
          <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--qa-border, #E4E4E7)', marginBottom: 20 }}>
            {(['calls', 'chats'] as const).map(ch => (
              <button
                key={ch}
                type="button"
                onClick={() => setAiChannel(ch)}
                style={{
                  height: 36,
                  padding: '0 14px',
                  background: 'transparent',
                  border: 0,
                  fontSize: 13,
                  fontFamily: 'inherit',
                  cursor: 'pointer',
                  color: aiChannel === ch ? 'var(--qa-text, #111111)' : 'var(--qa-text-2, #6B6B6B)',
                  fontWeight: aiChannel === ch ? 600 : 400,
                  borderBottom: aiChannel === ch ? '2px solid var(--qa-text, #111111)' : '2px solid transparent',
                  marginBottom: -1,
                }}
              >
                {ch === 'calls' ? 'Calls' : 'Chats'}
              </button>
            ))}
            <button
              type="button"
              disabled
              style={{
                height: 36,
                padding: '0 14px',
                background: 'transparent',
                border: 0,
                fontSize: 13,
                fontFamily: 'inherit',
                cursor: 'not-allowed',
                color: 'var(--qa-text-4, #C7C7CC)',
                borderBottom: '2px solid transparent',
                marginBottom: -1,
              }}
              title="Coming soon"
            >
              Emails
            </button>
          </div>

          {aiChannel === 'chats' ? (
            <div style={{ padding: '36px 16px', textAlign: 'center', color: 'var(--qa-text-3, #A1A1AA)', fontSize: 13, fontStyle: 'italic' }}>
              Chat quality evaluation is not yet implemented for PCG. AI insights will appear here once enabled.
            </div>
          ) : (
            <>
              {/* AI Narrative Analysis Paragraph */}
              <p style={{ fontSize: 14, color: 'var(--qa-text, #111111)', lineHeight: 1.6, margin: '0 0 18px', maxWidth: 860 }}>
                {effectiveRm} demonstrated strong performance over the last {periodLabel || '7 days'}, achieving a 100.0% CSAT and an IQS of{' '}
                {callsIqs.toFixed(1)}% across {callsVol} evaluated calls. He maintained consistent pitch structure across key investment categories
                including 13% Club Pitching and Portfolio Upselling. While overall quality remains high, his lowest performing parameter was Secondary
                Liquidity Disclaimer at 85.7%.
              </p>

              {/* Badges: STRENGTH, WATCH, TIP */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {/* Strength */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '14px 16px',
                    background: 'var(--qa-card, #ffffff)',
                    border: '1px solid var(--qa-border, #E4E4E7)',
                    borderRadius: 8,
                  }}
                >
                  <span
                    style={{
                      flexShrink: 0,
                      height: 20,
                      padding: '0 8px',
                      borderRadius: 999,
                      fontSize: 10,
                      fontWeight: 600,
                      textTransform: 'uppercase',
                      letterSpacing: '0.06em',
                      display: 'inline-flex',
                      alignItems: 'center',
                      background: 'var(--qa-text, #111111)',
                      color: '#ffffff',
                    }}
                  >
                    STRENGTH
                  </span>
                  <span style={{ fontSize: 13, color: 'var(--qa-text, #111111)', lineHeight: 1.5 }}>
                    Achieved a perfect 100.0% score in Identity Verification, Call Opening, and Clear Return vs Risk Positioning without promising guaranteed returns.
                  </span>
                </div>

                {/* Watch */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '14px 16px',
                    background: 'var(--qa-card, #ffffff)',
                    border: '1px solid var(--qa-border, #E4E4E7)',
                    borderRadius: 8,
                  }}
                >
                  <span
                    style={{
                      flexShrink: 0,
                      height: 20,
                      padding: '0 8px',
                      borderRadius: 999,
                      fontSize: 10,
                      fontWeight: 600,
                      textTransform: 'uppercase',
                      letterSpacing: '0.06em',
                      display: 'inline-flex',
                      alignItems: 'center',
                      background: 'var(--qa-fill-med, #E4E4E7)',
                      color: 'var(--qa-text, #111111)',
                    }}
                  >
                    WATCH
                  </span>
                  <span style={{ fontSize: 13, color: 'var(--qa-text, #111111)', lineHeight: 1.5 }}>
                    Secondary Liquidity Disclaimer was the lowest-performing parameter at 85.7% compared to all other evaluated areas.
                  </span>
                </div>

                {/* Tip */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '14px 16px',
                    background: 'var(--qa-card, #ffffff)',
                    border: '1px solid var(--qa-border, #E4E4E7)',
                    borderRadius: 8,
                  }}
                >
                  <span
                    style={{
                      flexShrink: 0,
                      height: 20,
                      padding: '0 8px',
                      borderRadius: 999,
                      fontSize: 10,
                      fontWeight: 600,
                      textTransform: 'uppercase',
                      letterSpacing: '0.06em',
                      display: 'inline-flex',
                      alignItems: 'center',
                      background: 'transparent',
                      border: '1px solid var(--qa-border, #E4E4E7)',
                      color: 'var(--qa-text, #111111)',
                    }}
                  >
                    TIP
                  </span>
                  <span style={{ fontSize: 13, color: 'var(--qa-text, #111111)', lineHeight: 1.5 }}>
                    State the secondary market window upfront and establish a firm calendar callback slot before concluding the call.
                  </span>
                </div>
              </div>

              <p style={{ marginTop: 14, fontSize: 11, color: 'var(--qa-text-3, #A1A1AA)', fontStyle: 'italic', marginBottom: 0 }}>
                Generated from RM {agentInitials(effectiveRm)} {effectiveRm}'s evaluated calls · {periodLabel || '7 days'}
              </p>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
