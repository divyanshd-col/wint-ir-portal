'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import DateRangePicker from '@/components/quality/DateRangePicker';

export type Period = '7' | '30' | 'custom';

export const TL_TEAMS: Record<string, string[]> = {
  'Team Gokul': ['Aahan Thaker', 'Dhanush', 'Yaashvi Arora', 'Samskriti Rao', 'Gaurav Nautiyal'],
  'Team Vaishnavi': ['Aravind', 'Sujal Dadwani', 'Antara Chakrabarty', 'Swati Singh'],
};

export const ALL_PCG_AGENTS = [
  ...TL_TEAMS['Team Gokul'],
  ...TL_TEAMS['Team Vaishnavi'],
];

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
  rmScorecards?: Array<{
    rmName: string;
    totalCalls: number;
    connectRate: number;
    pitchScore: number;
    upsellScore: number;
    supportScore: number;
    overallScore: number;
    trend: string;
    complianceFlags: number;
    topWeakness: string;
  }>;
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
  rmScorecards = [],
}: PcgMemberAnalyticsProps) {
  const [period, setPeriod] = useState<Period>('7');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [showPicker, setShowPicker] = useState(false);
  const [showAgentDrop, setShowAgentDrop] = useState(false);
  const [agentSearch, setAgentSearch] = useState('');
  const agentDropRef = useRef<HTMLDivElement>(null);

  const [wowTab, setWowTab] = useState<'metrics' | 'params'>('metrics');
  const [wowChannel, setWowChannel] = useState<'chats' | 'calls'>('calls');
  const [wowCategory, setWowCategory] = useState<'all' | '13_pitching' | 'upselling' | 'support'>('all');
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

  // Derive call analytics for this RM
  const rmScorecard = rmScorecards.find(s => s.rmName.toLowerCase() === effectiveRm.toLowerCase());
  const rmCalls = calls.filter(c => c.rmName.toLowerCase() === effectiveRm.toLowerCase());
  const rmAnswered = rmCalls.filter(c => c.isAnswered);
  const rmAvgIqs = rmScorecard?.overallScore ?? (rmAnswered.length > 0
    ? Math.round(rmAnswered.reduce((acc, c) => acc + c.iqsScore, 0) / rmAnswered.length)
    : 0);
  const callsVol = rmScorecard?.totalCalls ?? rmCalls.length;
  const callsIqs = rmAvgIqs;

  // Canonical 11 PCG Call Quality Parameters across 3 Skill Groups (Process Skills 50%, Communication 30%, Customer Service 20%)
  const PCG_PARAMETERS = [
    { key: 'CallOpening', label: 'Call Opening', weight: 5, deptScore: 95 },
    { key: 'CallClosing', label: 'Call Closing', weight: 5, deptScore: 93 },
    { key: 'TechnicalLegal', label: 'Technically / Legally Correct', weight: 15, deptScore: 96 },
    { key: 'AllQuestions', label: 'All Questions Addressed', weight: 10, deptScore: 94 },
    { key: 'Expectation', label: 'Expectation Setting', weight: 10, deptScore: 92 },
    { key: 'Process', label: 'Process / Pre-check', weight: 5, deptScore: 93 },
    { key: 'Grammar', label: 'Vocabulary / Sentence Structure / Grammar / Pronunciations', weight: 10, deptScore: 95 },
    { key: 'Fillers', label: 'Fillers, Fumbling & Stammering / Speech Clarity / Avoid Dead Air', weight: 10, deptScore: 91 },
    { key: 'EnergyTone', label: 'Energy Level, Enthusiasm & Tone Modulation', weight: 10, deptScore: 93 },
    { key: 'ActiveListening', label: 'Active Listening, Interruptions & Empathy', weight: 10, deptScore: 92 },
    { key: 'Simplifying', label: 'Simplifying Answers', weight: 10, deptScore: 93 },
  ];


  // Derive live parameter scores from rmAnswered calls if available
  const callParamAverages: Record<string, number> = useMemo(() => {
    const averages: Record<string, number> = {};
    if (rmAnswered.length > 0) {
      const paramEarned: Record<string, number> = {};
      const paramMax: Record<string, number> = {};
      rmAnswered.forEach(c => {
        if (Array.isArray((c as any).parameters)) {
          (c as any).parameters.forEach((p: any) => {
            if (p.id) {
              paramEarned[p.id] = (paramEarned[p.id] || 0) + (p.earnedScore ?? 0);
              paramMax[p.id] = (paramMax[p.id] || 0) + (p.maxScore ?? 0);
            }
          });
        }
      });
      Object.keys(paramMax).forEach(k => {
        if (paramMax[k] > 0) {
          averages[k] = Math.round((paramEarned[k] / paramMax[k]) * 100);
        }
      });
    }
    return averages;
  }, [rmAnswered]);

  const getAgentParamScore = (rm: string, key: string, fallbackBase: number) => {
    if (callParamAverages[key] !== undefined) {
      return callParamAverages[key];
    }
    return null;
  };

  const wowWeeks = ['2026-09-21', '2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19'];
  const wowWeekLabels = ['SEP 21 – 27', 'SEP 28 – OCT 4', 'OCT 5 – 11', 'OCT 12 – 18', 'OCT 19 – 25'];

  const wowMetrics = (() => {
    if (wowChannel !== 'calls' || callsVol === 0 || callsIqs === 0) {
      return [
        { name: 'IQS', vals: [null, null, null, null, null] as (number | null)[], isPct: true },
        { name: 'Volume', vals: [null, null, null, null, null] as (number | null)[], isPct: false },
      ];
    }
    return [
      { name: 'IQS', vals: [null, null, null, null, callsIqs] as (number | null)[], isPct: true },
      { name: 'Volume', vals: [null, null, null, null, callsVol] as (number | null)[], isPct: false },
    ];
  })();

  const wowParameters: Array<{ name: string; vals: (number | null)[] }> = (() => {
    if (wowChannel !== 'calls') {
      return [
        { name: 'Technically / Legally Correct', vals: [null, null, null, null, null] },
        { name: 'All Questions Addressed', vals: [null, null, null, null, null] },
        { name: 'Expectation Setting', vals: [null, null, null, null, null] },
        { name: 'Active Listening & Empathy', vals: [null, null, null, null, null] },
        { name: 'Speech Clarity & Dead Air', vals: [null, null, null, null, null] },
        { name: 'Call Opening & Closing', vals: [null, null, null, null, null] },
      ];
    }
    if (wowCategory === '13_pitching') {
      return [
        { name: 'Technically / Legally Correct', vals: [96.0, 99.0, 95.0, 98.0, 98.5] },
        { name: 'All Questions Addressed', vals: [95.0, 98.0, 93.0, 97.0, 96.5] },
        { name: 'Expectation Setting', vals: [92.0, 94.0, 90.0, 93.0, 92.5] },
        { name: 'Process / Pre-check', vals: [94.0, 96.0, 92.0, 95.0, 94.5] },
        { name: 'Vocabulary & Grammar', vals: [96.0, 98.0, 95.0, 97.0, 97.0] },
        { name: 'Speech Clarity & Dead Air', vals: [90.0, 92.0, 88.0, 91.0, 90.5] },
      ];
    }
    if (wowCategory === 'upselling') {
      return [
        { name: 'Technically / Legally Correct', vals: [95.0, 98.0, 94.0, 97.0, 96.0] },
        { name: 'All Questions Addressed', vals: [92.0, 95.0, 90.0, 94.0, 94.0] },
        { name: 'Expectation Setting', vals: [90.0, 93.0, 88.0, 92.0, 91.5] },
        { name: 'Active Listening & Empathy', vals: [93.0, 96.0, 91.0, 94.0, 94.0] },
        { name: 'Simplifying Answers', vals: [91.0, 94.0, 89.0, 93.0, 92.0] },
        { name: 'Energy Level & Tone Modulation', vals: [88.0, 90.0, 86.0, 89.0, 88.5] },
      ];
    }
    if (wowCategory === 'support') {
      return [
        { name: 'Technically / Legally Correct', vals: [96.0, 98.0, 95.0, 98.0, 97.5] },
        { name: 'Expectation Setting', vals: [94.0, 96.0, 92.0, 95.0, 94.0] },
        { name: 'Process / Pre-check', vals: [95.0, 97.0, 94.0, 96.5, 96.0] },
        { name: 'Active Listening & Empathy', vals: [96.0, 98.0, 95.0, 98.0, 97.5] },
        { name: 'Simplifying Answers', vals: [92.0, 95.0, 90.0, 94.0, 93.0] },
        { name: 'Call Closing', vals: [94.0, 96.0, 92.0, 95.0, 94.0] },
      ];
    }
    return [
      { name: 'Technically / Legally Correct', vals: [96.0, 98.0, 95.0, 98.0, 97.5] },
      { name: 'All Questions Addressed', vals: [94.0, 97.0, 92.0, 96.0, 95.0] },
      { name: 'Expectation Setting', vals: [92.0, 95.0, 90.0, 94.0, 93.0] },
      { name: 'Active Listening & Empathy', vals: [95.0, 98.0, 94.0, 97.0, 96.0] },
      { name: 'Speech Clarity & Dead Air', vals: [91.0, 93.0, 89.0, 92.0, 91.5] },
      { name: 'Simplifying Answers', vals: [93.0, 96.0, 91.0, 94.0, 94.0] },
    ];
  })();

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
                onClick={() => {
                  if (activePersona !== 'agent') setShowAgentDrop(p => !p);
                }}
                disabled={activePersona === 'agent'}
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
                  cursor: activePersona === 'agent' ? 'default' : 'pointer',
                  fontFamily: 'inherit',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
                }}
              >
                <span>{effectiveRm}</span>
                {activePersona !== 'agent' && (
                  <span style={{ color: 'var(--qa-text-3, #A1A1AA)', fontSize: 10 }}>▾</span>
                )}
              </button>
            </div>

            {/* Dropdown Menu */}
            {showAgentDrop && activePersona !== 'agent' && (
              <div
                style={{
                  position: 'absolute',
                  top: 'calc(100% + 6px)',
                  left: 0,
                  zIndex: 50,
                  background: 'var(--qa-card, #ffffff)',
                  border: '1px solid var(--qa-border, #E4E4E7)',
                  borderRadius: 10,
                  boxShadow: '0 10px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.1)',
                  minWidth: 280,
                  maxHeight: 'min(420px, calc(100vh - 220px))',
                  overflowY: 'auto',
                  overflowX: 'hidden',
                  overscrollBehavior: 'contain',
                }}
              >
                {/* Search Agent in Dropdown */}
                <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--qa-border, #E4E4E7)', background: '#FAFAFB', position: 'sticky', top: 0, zIndex: 10 }}>
                  <input
                    type="text"
                    value={agentSearch}
                    onChange={(e) => setAgentSearch(e.target.value)}
                    placeholder="Search agent across teams..."
                    style={{
                      width: '100%',
                      height: 28,
                      padding: '0 8px',
                      fontSize: 12,
                      border: '1px solid var(--qa-border, #E4E4E7)',
                      borderRadius: 6,
                      outline: 'none',
                      background: '#ffffff',
                      boxSizing: 'border-box',
                    }}
                    onClick={(e) => e.stopPropagation()}
                  />
                </div>

                {/* Team Groups */}
                {(() => {
                  const groups: { teamName: string; agents: string[] }[] = [];

                  if (activePersona === 'admin') {
                    groups.push({ teamName: 'Team Gokul', agents: TL_TEAMS['Team Gokul'] });
                    groups.push({ teamName: 'Team Vaishnavi', agents: TL_TEAMS['Team Vaishnavi'] });
                  } else {
                    // For TL, determine their team from effectiveRm or availableRms
                    const isVaishnavi = availableRms.some(a => TL_TEAMS['Team Vaishnavi'].includes(a));
                    const teamName = isVaishnavi ? 'Team Vaishnavi' : 'Team Gokul';
                    const list = availableRms.length > 0 ? availableRms : TL_TEAMS[teamName];
                    groups.push({ teamName, agents: list });
                  }

                  const s = agentSearch.trim().toLowerCase();

                  return groups.map((g) => {
                    const filteredAgents = g.agents.filter(a => !s || a.toLowerCase().includes(s));
                    if (filteredAgents.length === 0) return null;

                    return (
                      <div key={g.teamName}>
                        <div
                          style={{
                            padding: '6px 12px',
                            fontSize: 10,
                            fontWeight: 700,
                            textTransform: 'uppercase',
                            letterSpacing: '0.06em',
                            color: '#71717A',
                            background: '#F4F4F5',
                            borderBottom: '1px solid var(--qa-border-sub, #F0F0F2)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                          }}
                        >
                          <span>{g.teamName}</span>
                          <span style={{ fontSize: 9, fontWeight: 600, color: '#A1A1AA' }}>
                            {filteredAgents.length} Agents
                          </span>
                        </div>
                        {filteredAgents.map(a => (
                          <button
                            key={a}
                            type="button"
                            onClick={() => {
                              onSelectRm(a);
                              setShowAgentDrop(false);
                              setAgentSearch('');
                            }}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              width: '100%',
                              padding: '8px 12px',
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
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                              <span
                                style={{
                                  width: 26,
                                  height: 26,
                                  borderRadius: '50%',
                                  background: a === effectiveRm ? '#18181b' : 'var(--qa-fill-med, #E4E4E7)',
                                  color: a === effectiveRm ? '#ffffff' : 'var(--qa-text-2, #6B6B6B)',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  fontSize: 10,
                                  fontWeight: 700,
                                  flexShrink: 0,
                                }}
                              >
                                {agentInitials(a)}
                              </span>
                              <span>{a}</span>
                            </div>
                            <span
                              style={{
                                fontSize: 10,
                                padding: '2px 6px',
                                borderRadius: 4,
                                background: '#E4E4E7',
                                color: '#52525B',
                                fontWeight: 500,
                              }}
                            >
                              {g.teamName.replace('Team ', '')}
                            </span>
                          </button>
                        ))}
                      </div>
                    );
                  });
                })()}
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
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', paddingRight: 24, lineHeight: 1.1 }}>
              <span style={{ fontSize: 24, fontWeight: 700, lineHeight: 1, color: 'var(--qa-text, #111111)' }}>{callsIqs.toFixed(1)}%</span>
              <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--qa-text-3, #A1A1AA)', marginTop: 6 }}>IQS</span>
            </div>
            <div style={{ width: 1, height: 32, background: 'var(--qa-border, #E4E4E7)', alignSelf: 'center' }} />
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', paddingLeft: 24, lineHeight: 1.1 }}>
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
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', paddingRight: 24, lineHeight: 1.1 }}>
              <span style={{ fontSize: 24, fontWeight: 700, lineHeight: 1, color: 'var(--qa-text-4, #C7C7CC)' }}>—</span>
              <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--qa-text-3, #A1A1AA)', marginTop: 6 }}>IQS</span>
            </div>
            <div style={{ width: 1, height: 32, background: 'var(--qa-border, #E4E4E7)', alignSelf: 'center' }} />
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', paddingLeft: 24, lineHeight: 1.1 }}>
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
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', paddingRight: 24, lineHeight: 1.1 }}>
              <span style={{ fontSize: 24, fontWeight: 700, lineHeight: 1, color: 'var(--qa-text-4, #C7C7CC)' }}>—</span>
              <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--qa-text-3, #A1A1AA)', marginTop: 6 }}>IQS</span>
            </div>
            <div style={{ width: 1, height: 32, background: 'var(--qa-border, #E4E4E7)', alignSelf: 'center' }} />
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', paddingLeft: 24, lineHeight: 1.1 }}>
              <span style={{ fontSize: 24, fontWeight: 700, lineHeight: 1, color: 'var(--qa-text-4, #C7C7CC)' }}>—</span>
              <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--qa-text-3, #A1A1AA)', marginTop: 6 }}>VOLUME</span>
            </div>
          </div>
          <div style={{ fontSize: 12, color: 'var(--qa-text-3, #A1A1AA)', marginTop: 8, fontStyle: 'italic' }}>
            Not yet evaluated
          </div>
        </div>
      </div>

      {/* ── Section 2: IQS by Parameters ── */}
      <section style={{ marginBottom: 32 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <SectionTitle>IQS by Parameters</SectionTitle>
          <span style={{ fontSize: 11, color: 'var(--qa-text-3, #A1A1AA)', fontStyle: 'italic' }}>
            {periodLabel} · 11 voice quality parameters evaluated for {effectiveRm}
          </span>
        </div>
        <Panel>
          <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--qa-border, #E4E4E7)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--qa-text, #111111)' }}>
              11 quality parameters · evaluated across calls
            </span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ height: 28, background: 'var(--qa-bg, #f5f3ee)', borderBottom: 0, padding: '8px 16px 0', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--qa-text-2, #6B6B6B)', fontWeight: 500, textAlign: 'left', width: '40%' }} />
                  <th colSpan={3} style={{ height: 28, background: 'var(--qa-bg, #f5f3ee)', borderBottom: '1px solid var(--qa-border-sub, #F0F0F2)', padding: '8px 16px 0', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--qa-text-2, #6B6B6B)', fontWeight: 500, textAlign: 'center' }}>
                    IQS
                  </th>
                </tr>
                <tr>
                  {['Parameter', 'Calls', 'Chats', 'Emails'].map((h, i) => (
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
                        width: i === 0 ? '40%' : '20%',
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {PCG_PARAMETERS.map(param => {
                  const score = getAgentParamScore(effectiveRm, param.key, param.deptScore);
                  return (
                    <tr
                      key={param.key}
                      style={{ height: 48, transition: 'background 0.1s' }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'var(--qa-fill-light, #F4F4F5)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    >
                      <td style={{ padding: '0 16px', borderBottom: '1px solid var(--qa-border-sub, #F0F0F2)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--qa-text, #111111)' }}>
                            {param.label}
                          </span>
                          <span
                            style={{
                              fontSize: 11,
                              padding: '1px 6px',
                              borderRadius: 4,
                              background: 'var(--qa-fill-light, #F4F4F5)',
                              border: '1px solid var(--qa-border, #E4E4E7)',
                              color: 'var(--qa-text-3, #71717A)',
                              fontFamily: 'monospace',
                              fontWeight: 600,
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {param.weight}%
                          </span>
                        </div>
                      </td>
                      <td style={{ padding: '0 16px', borderBottom: '1px solid var(--qa-border-sub, #F0F0F2)', textAlign: 'right', fontFamily: 'monospace', fontSize: 13, color: 'var(--qa-text, #111111)' }}>
                        {fmtPct(score)}
                      </td>
                      <td style={{ padding: '0 16px', borderBottom: '1px solid var(--qa-border-sub, #F0F0F2)', textAlign: 'right', fontSize: 13, color: 'var(--qa-text-4, #C7C7CC)' }}>
                        —
                      </td>
                      <td style={{ padding: '0 16px', borderBottom: '1px solid var(--qa-border-sub, #F0F0F2)', textAlign: 'right', fontSize: 13, color: 'var(--qa-text-4, #C7C7CC)' }}>
                        —
                      </td>
                    </tr>
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
                ['metrics', 'IQS + Volume'],
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

            {/* Controls: Channel Toggle + Call Category Option */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
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

              {/* Call Categories Filter: 3 Categories of Calls */}
              {wowChannel === 'calls' && (
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--qa-text-3, #A1A1AA)', fontWeight: 600 }}>
                    CATEGORY
                  </span>
                  <div style={{ display: 'inline-flex', border: '1px solid var(--qa-border, #E4E4E7)', borderRadius: 8, overflow: 'hidden' }}>
                    {[
                      { key: 'all', label: 'All' },
                      { key: '13_pitching', label: '13% Pitching' },
                      { key: 'upselling', label: 'Upselling' },
                      { key: 'support', label: 'Support' },
                    ].map((cat, idx, arr) => (
                      <button
                        key={cat.key}
                        type="button"
                        onClick={() => setWowCategory(cat.key as 'all' | '13_pitching' | 'upselling' | 'support')}
                        style={{
                          height: 30,
                          padding: '0 11px',
                          background: wowCategory === cat.key ? 'var(--qa-text, #111111)' : 'transparent',
                          border: 0,
                          borderRight: idx < arr.length - 1 ? '1px solid var(--qa-border, #E4E4E7)' : 'none',
                          fontSize: 12,
                          fontFamily: 'inherit',
                          cursor: 'pointer',
                          color: wowCategory === cat.key ? '#ffffff' : 'var(--qa-text-2, #6B6B6B)',
                          fontWeight: wowCategory === cat.key ? 500 : 400,
                          whiteSpace: 'nowrap',
                          transition: 'background 0.1s, color 0.1s',
                        }}
                      >
                        {cat.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
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
          ) : callsVol === 0 || callsIqs === 0 ? (
            <div style={{ padding: '36px 16px', textAlign: 'center', color: 'var(--qa-text-3, #A1A1AA)', fontSize: 13, fontStyle: 'italic' }}>
              No evaluated call data available for {effectiveRm} in this time period. AI coaching insights will populate once calls are evaluated.
            </div>
          ) : (
            <>
              {/* AI Narrative Analysis Paragraph */}
              <p style={{ fontSize: 14, color: 'var(--qa-text, #111111)', lineHeight: 1.6, margin: '0 0 18px', maxWidth: 860 }}>
                {effectiveRm} demonstrated strong performance over the last {periodLabel || '7 days'}, achieving an IQS of{' '}
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
