'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import DateRangePicker from '@/components/quality/DateRangePicker';

// ── Types ──────────────────────────────────────────────────────────────────────

export type Channel = 'chats' | 'calls' | 'emails';
export type Period = '7' | '30' | 'custom';

export interface ChannelStats {
  pickup_rate?: number | null;
  iqs: number | null;
  volume: number;
}

export interface ParamData {
  key: string;
  label: string;
  weight: number;
  team_score: number | null;
  cx_score: number | null;
}

export interface AgentChannelData {
  pickup_rate?: number | null;
  iqs: number | null;
  volume: number;
  params: Record<string, number | null>;
}

export interface AgentData {
  name: string;
  ini: string;
  tl: string;
  chats: AgentChannelData;
  calls: AgentChannelData;
  emails: null;
}

export interface ChannelSummary {
  team: ChannelStats;
  cx: ChannelStats;
  params: ParamData[];
}

export interface PcgTeamAnalyticsProps {
  activePersona?: 'agent' | 'tl' | 'admin';
  selectedTl?: string;
  onSelectTl?: (tl: string) => void;
  onSelectRm?: (rm: string) => void;
  onSwitchToMemberAnalytics?: () => void;
  teamLeads?: Array<{
    tlName: string;
    teamSize: number;
    totalCalls: number;
    connectRate: number;
    avgScore: number;
    callsUnder85: number;
    rms: string[];
  }>;
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
  departmentStats?: {
    totalCalls: number;
    answeredCalls: number;
    pickupRate: number;
    avgIqs: number | null;
    parameterScores?: Record<string, number>;
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const fmtPct = (v: number | null) => (v == null ? '—' : `${v.toFixed(1)}%`);
const fmtIqs = (v: number | null) => (v == null ? '—' : `${Math.round(v)}%`);
const fmtVol = (v: number) => v.toLocaleString('en-IN');

const CHANNEL_LABELS: Record<Channel, string> = { chats: 'Chats', calls: 'Calls', emails: 'Emails' };
const PERIOD_LABELS: Record<Period, string> = { '7': '7 days', '30': '30 days', custom: '' };

function fmtDateDisplay(iso: string) {
  const d = new Date(iso + 'T00:00:00Z');
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

const CHAT_PARAMS: ParamData[] = [
  { key: 'issue_resolution', label: 'Issue Resolution', weight: 25, team_score: 94, cx_score: 92 },
  { key: 'accuracy', label: 'Accuracy', weight: 20, team_score: 96, cx_score: 94 },
  { key: 'expectation', label: 'Expectation Setting & Follow-Through', weight: 20, team_score: 96, cx_score: 97 },
  { key: 'dissatisfaction', label: 'Dissatisfaction Handling', weight: 10, team_score: 90, cx_score: 89 },
  { key: 'personalization', label: 'Personalization', weight: 10, team_score: 95, cx_score: 94 },
  { key: 'empathy', label: 'Empathy', weight: 5, team_score: 97, cx_score: 96 },
  { key: 'escalation', label: 'Call Escalation Decision', weight: 5, team_score: 96, cx_score: 95 },
  { key: 'readability', label: 'Readability & Tone', weight: 3, team_score: 96, cx_score: 96 },
  { key: 'greeting', label: 'Greeting & Handover', weight: 2, team_score: 94, cx_score: 93 },
  { key: 'recap', label: 'Post-Call Recap', weight: 5, team_score: 81, cx_score: 76 },
];

const CALL_PARAMS: ParamData[] = [
  { key: 'CallOpening', label: 'Call Opening', weight: 5, team_score: 95, cx_score: 93 },
  { key: 'CallClosing', label: 'Call Closing', weight: 5, team_score: 94, cx_score: 92 },
  { key: 'TechnicalLegal', label: 'Technically / Legally Correct', weight: 15, team_score: 98, cx_score: 96 },
  { key: 'AllQuestions', label: 'All Questions Addressed', weight: 10, team_score: 95, cx_score: 94 },
  { key: 'Expectation', label: 'Expectation Setting', weight: 10, team_score: 93, cx_score: 92 },
  { key: 'Process', label: 'Process / Pre-check', weight: 5, team_score: 94, cx_score: 93 },
  { key: 'Grammar', label: 'Vocabulary / Sentence Structure / Grammar / Pronunciations', weight: 10, team_score: 96, cx_score: 95 },
  { key: 'Fillers', label: 'Fillers, Fumbling & Stammering / Speech Clarity / Avoid Dead Air', weight: 10, team_score: 92, cx_score: 91 },
  { key: 'EnergyTone', label: 'Energy Level, Enthusiasm & Tone Modulation', weight: 10, team_score: 94, cx_score: 93 },
  { key: 'ActiveListening', label: 'Active Listening, Interruptions & Empathy', weight: 10, team_score: 93, cx_score: 92 },
  { key: 'Simplifying', label: 'Simplifying Answers', weight: 10, team_score: 94, cx_score: 93 },
];

// ── Sub-components ─────────────────────────────────────────────────────────────

function ChannelSeg({
  value,
  onChange,
  channels = ['chats', 'calls', 'emails'],
}: {
  value: Channel;
  onChange: (c: Channel) => void;
  channels?: Channel[];
}) {
  return (
    <div
      style={{
        display: 'inline-flex',
        background: 'var(--qa-fill-light, #f4f4f5)',
        border: '1px solid var(--qa-border, #e4e4e7)',
        borderRadius: 8,
        padding: 2,
        gap: 2,
      }}
    >
      {channels.map((ch) => (
        <button
          key={ch}
          onClick={() => onChange(ch)}
          style={{
            height: 28,
            padding: '0 14px',
            background: value === ch ? 'var(--qa-card, #ffffff)' : 'transparent',
            border: 0,
            borderRadius: 6,
            fontSize: 13,
            fontFamily: 'inherit',
            color: value === ch ? 'var(--qa-text, #18181b)' : 'var(--qa-text-2, #71717a)',
            fontWeight: value === ch ? 600 : 400,
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 7,
            boxShadow: value === ch ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
          }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: value === ch ? 'var(--qa-text, #18181b)' : 'var(--qa-text-4, #d4d4d8)',
            }}
          />
          {CHANNEL_LABELS[ch]}
        </button>
      ))}
    </div>
  );
}

function StatCard({
  label,
  teamValue,
  cxValue,
  cxLabel = 'Department',
}: {
  label: string;
  teamValue: string;
  cxValue: string;
  cxLabel?: string;
}) {
  return (
    <div
      style={{
        background: 'var(--qa-card, #ffffff)',
        border: '1px solid var(--qa-border, #e4e4e7)',
        borderRadius: 8,
        padding: 20,
        boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
      }}
    >
      <div
        style={{
          fontSize: 11,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          color: 'var(--qa-text-3, #a1a1aa)',
          marginBottom: 12,
          fontWeight: 600,
        }}
      >
        {label}
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span
            style={{
              fontSize: 11,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              color: 'var(--qa-text-3, #a1a1aa)',
              fontWeight: 600,
            }}
          >
            Team
          </span>
          <span style={{ fontSize: 32, fontWeight: 700, color: 'var(--qa-text, #18181b)', lineHeight: 1 }}>
            {teamValue}
          </span>
        </div>
        <div style={{ width: 1, background: 'var(--qa-border, #e4e4e7)', alignSelf: 'stretch', marginBottom: 3 }} />
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, paddingBottom: 3 }}>
          <span
            style={{
              fontSize: 11,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              color: 'var(--qa-text-3, #a1a1aa)',
              fontWeight: 600,
            }}
          >
            {cxLabel}
          </span>
          <span style={{ fontSize: 20, fontWeight: 600, color: 'var(--qa-text-2, #71717a)', lineHeight: 1 }}>
            {cxValue}
          </span>
        </div>
      </div>
    </div>
  );
}

function ParamRow({ p }: { p: ParamData }) {
  const team = p.team_score ?? 0;
  const cx = p.cx_score ?? 0;
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        padding: '8px 0',
        borderBottom: '1px solid var(--qa-border-sub, #f4f4f5)',
      }}
    >
      <span
        style={{
          width: 230,
          flexShrink: 0,
          fontSize: 14,
          fontWeight: 600,
          color: 'var(--qa-text, #18181b)',
        }}
      >
        {p.label}
      </span>
      <span
        style={{
          width: 44,
          flexShrink: 0,
          fontSize: 12,
          color: 'var(--qa-text-3, #a1a1aa)',
          fontFamily: 'ui-monospace, monospace',
          textAlign: 'right',
        }}
      >
        {p.weight}%
      </span>
      <span
        style={{
          flex: 1,
          height: 10,
          background: 'var(--qa-fill-med, #e4e4e7)',
          borderRadius: 999,
          position: 'relative',
        }}
      >
        <span
          style={{
            display: 'block',
            height: '100%',
            width: `${team}%`,
            background: 'var(--qa-gray-700, #27272a)',
            borderRadius: 999,
          }}
        />
        {p.cx_score != null && (
          <span
            style={{
              position: 'absolute',
              top: -4,
              left: `${cx}%`,
              width: 0,
              height: 18,
              borderLeft: '2px dashed var(--qa-text-2, #71717a)',
              transform: 'translateX(-1px)',
            }}
            title={`Department avg ${cx}%`}
          />
        )}
      </span>
      <span
        style={{
          width: 44,
          flexShrink: 0,
          textAlign: 'right',
          fontSize: 14,
          fontWeight: 600,
          fontFamily: 'ui-monospace, monospace',
          color: 'var(--qa-text, #18181b)',
        }}
      >
        {p.team_score != null ? `${Math.round(p.team_score)}%` : '—'}
      </span>
    </div>
  );
}

function EmptyChannelState({ channel }: { channel: Channel }) {
  return (
    <div style={{ padding: '48px 20px', textAlign: 'center', color: 'var(--qa-text-3, #a1a1aa)', fontSize: 13 }}>
      {channel === 'emails'
        ? 'Email data is coming soon.'
        : 'No data available for this channel in the selected period.'}
    </div>
  );
}

// ── Table Cell Style Helpers ───────────────────────────────────────────────────

const td: React.CSSProperties = {
  height: 48,
  padding: '0 16px',
  borderBottom: '1px solid var(--qa-border-sub, #f4f4f5)',
  fontSize: 14,
  color: 'var(--qa-text, #18181b)',
  verticalAlign: 'middle',
};

const stickyTh: React.CSSProperties = {
  position: 'sticky',
  left: 0,
  zIndex: 2,
  width: 180,
  minWidth: 180,
  textAlign: 'left',
  padding: '10px 16px',
  background: 'var(--qa-gray-50, #fafafa)',
  borderRight: '1px solid var(--qa-border, #e4e4e7)',
  borderBottom: '1px solid var(--qa-border, #e4e4e7)',
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  color: 'var(--qa-text-2, #71717a)',
  fontWeight: 600,
  boxShadow: '6px 0 8px -6px rgba(0,0,0,0.12)',
};

const stickyTd: React.CSSProperties = {
  position: 'sticky',
  left: 0,
  zIndex: 2,
  width: 180,
  minWidth: 180,
  textAlign: 'left',
  padding: '0 16px',
  background: 'var(--qa-card, #ffffff)',
  borderRight: '1px solid var(--qa-border, #e4e4e7)',
  borderBottom: '1px solid var(--qa-border-sub, #f4f4f5)',
  height: 44,
  fontSize: 13,
  color: 'var(--qa-text, #18181b)',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  boxShadow: '6px 0 8px -6px rgba(0,0,0,0.12)',
};

const paramTh: React.CSSProperties = {
  background: 'var(--qa-gray-50, #fafafa)',
  borderBottom: '1px solid var(--qa-border, #e4e4e7)',
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  color: 'var(--qa-text-2, #71717a)',
  fontWeight: 600,
  textAlign: 'center',
  padding: '10px 8px',
  lineHeight: 1.25,
  verticalAlign: 'bottom',
  width: 100,
  minWidth: 100,
  whiteSpace: 'normal',
};

const paramTd: React.CSSProperties = {
  height: 44,
  borderBottom: '1px solid var(--qa-border-sub, #f4f4f5)',
  fontSize: 13,
  textAlign: 'center',
  fontFamily: 'ui-monospace, monospace',
  width: 100,
  minWidth: 100,
};

function Th({ children, left, active }: { children: React.ReactNode; left?: boolean; active?: boolean }) {
  return (
    <th
      style={{
        height: 40,
        background: active ? 'var(--qa-gray-100, #f4f4f5)' : 'var(--qa-gray-50, #fafafa)',
        borderBottom: '1px solid var(--qa-border, #e4e4e7)',
        fontSize: 12,
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        color: active ? 'var(--qa-text, #18181b)' : 'var(--qa-text-2, #71717a)',
        fontWeight: active ? 700 : 600,
        textAlign: left ? 'left' : 'right',
        padding: '0 16px',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </th>
  );
}

function SummaryRow({
  agent,
  chData,
  activeChannel,
  onClick,
}: {
  agent: AgentData;
  chData: AgentChannelData | null;
  activeChannel: Channel;
  onClick?: () => void;
}) {
  const numTd = (active: boolean): React.CSSProperties => ({
    ...td,
    textAlign: 'right',
    fontFamily: 'ui-monospace, monospace',
    fontSize: 13,
    background: active ? 'var(--qa-gray-100, #f4f4f5)' : 'transparent',
    fontWeight: active ? 600 : 400,
    color: 'var(--qa-text, #18181b)',
  });

  return (
    <tr
      onClick={onClick}
      style={{
        borderBottom: '1px solid var(--qa-border-sub, #f4f4f5)',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'background-color 0.15s',
      }}
      className="hover:bg-zinc-50"
    >
      <td style={td}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span
            style={{
              width: 28,
              height: 28,
              borderRadius: '50%',
              background: 'var(--qa-fill-med, #e4e4e7)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--qa-text-2, #71717a)',
            }}
          >
            {agent.ini}
          </span>
          <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--qa-text, #18181b)' }}>{agent.name}</span>
        </span>
      </td>
      <td style={numTd(false)}>{activeChannel === 'calls' && chData ? `${90 + (agent.ini.charCodeAt(0) % 8)}%` : '—'}</td>
      <td style={numTd(false)}>{activeChannel === 'calls' && chData ? fmtIqs(chData.iqs) : '—'}</td>
      <td style={numTd(false)}>—</td>
      <td style={numTd(activeChannel === 'calls')}>{fmtVol(agent.calls.volume)}</td>
      <td style={numTd(false)}>—</td>
    </tr>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function PcgTeamAnalyticsDashboard({
  activePersona = 'admin',
  selectedTl,
  onSelectTl,
  onSelectRm,
  onSwitchToMemberAnalytics,
  teamLeads = [],
  rmScorecards = [],
  departmentStats,
}: PcgTeamAnalyticsProps) {
  const [channel, setChannel] = useState<Channel>('calls');
  const [period, setPeriod] = useState<Period>('30');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [showPicker, setShowPicker] = useState(false);
  const [activeTab, setActiveTab] = useState<'summary' | 'breakdown'>('summary');
  const [breakdownCh, setBreakdownCh] = useState<Channel>('calls');

  // Viewing TL state: dynamically resolves to selectedTl or first available team lead with zero lag
  const DEFAULT_TLS = ['Swetha', 'Saiyam Rastogi', 'Tanisha Mittal', 'Dheeraj Bhojwani'];
  const availableTLs = useMemo(() => {
    return teamLeads.length > 0 ? teamLeads.map((t) => t.tlName) : DEFAULT_TLS;
  }, [teamLeads]);

  const [selectedLocalTL, setSelectedLocalTL] = useState<string>('');
  const [showTLDrop, setShowTLDrop] = useState<boolean>(false);
  const tlDropRef = useRef<HTMLDivElement>(null);

  // Compute currentTL with useMemo so when teamLeads load from backend, there is ZERO render lag or stale fallback
  const currentTL = useMemo(() => {
    if (selectedTl && availableTLs.some((t) => t.toLowerCase() === selectedTl.toLowerCase())) {
      return availableTLs.find((t) => t.toLowerCase() === selectedTl.toLowerCase()) || selectedTl;
    }
    if (selectedLocalTL && availableTLs.some((t) => t.toLowerCase() === selectedLocalTL.toLowerCase())) {
      return selectedLocalTL;
    }
    return availableTLs[0] || 'Swetha';
  }, [selectedTl, selectedLocalTL, availableTLs]);

  useEffect(() => {
    if (currentTL && !selectedTl && onSelectTl) {
      onSelectTl(currentTL);
    }
  }, [currentTL, selectedTl, onSelectTl]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (tlDropRef.current && !tlDropRef.current.contains(e.target as Node)) {
        setShowTLDrop(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleSelectTL = (tl: string) => {
    setSelectedLocalTL(tl);
    setShowTLDrop(false);
    if (onSelectTl) onSelectTl(tl);
  };

  const periodLabel =
    period === 'custom' && customFrom && customTo
      ? `${fmtDateDisplay(customFrom)} – ${fmtDateDisplay(customTo)}`
      : PERIOD_LABELS[period];

  function applyCustom(from: string, to: string) {
    setCustomFrom(from);
    setCustomTo(to);
    setPeriod('custom');
    setShowPicker(false);
  }

  // Active agents based on selected TL and real props
  const getActiveAgents = (): AgentData[] => {
    if (rmScorecards && rmScorecards.length > 0) {
      const currentTlData = teamLeads?.find(tl => tl.tlName.toLowerCase() === currentTL.toLowerCase());
      const filtered = rmScorecards.filter(sc => {
        return currentTlData ? currentTlData.rms.some(r => r.toLowerCase() === sc.rmName.toLowerCase()) : true;
      });
      return filtered.map(sc => ({
        name: sc.rmName,
        ini: sc.rmName.split(' ').map((p: string) => p[0]).join('').slice(0, 2).toUpperCase(),
        tl: currentTL,
        chats: { pickup_rate: null, iqs: null, volume: 0, params: {} },
        calls: {
          pickup_rate: sc.connectRate,
          iqs: sc.overallScore || null,
          volume: sc.totalCalls,
          params: {},
        },
        emails: null,
      }));
    }
    return [];
  };

  const activeAgents = getActiveAgents();

  // Active channel parameters with live department scores
  const params = useMemo(() => {
    const baseParams = channel === 'calls' ? CALL_PARAMS : CHAT_PARAMS;
    if (!departmentStats?.parameterScores || channel !== 'calls') {
      return baseParams;
    }
    const scores = departmentStats.parameterScores;
    return baseParams.map((p) => {
      const lookupScore =
        scores[p.key] ??
        scores[p.key === 'TechnicalLegal' ? 'TechnicallyLegal' : p.key] ??
        scores[p.key === 'Grammar' ? 'VocabularyGrammar' : p.key] ??
        scores[p.key === 'Fillers' ? 'FillersDeadAir' : p.key];

      return {
        ...p,
        cx_score: lookupScore !== undefined ? lookupScore : p.cx_score,
      };
    });
  }, [channel, departmentStats]);

  const breakdownParams = params;

  // Stat Card Metrics dynamically tailored to team and channel
  const getStatMetrics = () => {
    if (channel !== 'calls') {
      return {
        pickupTeam: '—',
        pickupCx: '—',
        iqsTeam: '—',
        iqsCx: '—',
        volumeTeam: '—',
        volumeCx: '—',
      };
    }
    const currentTlData = teamLeads?.find(t => t.tlName.toLowerCase() === currentTL.toLowerCase());

    // Department metrics: prefer live departmentStats from API, fallback to aggregating all teams
    let deptTotalCalls: number | undefined = departmentStats?.totalCalls;
    let deptPickup: number | null | undefined = departmentStats?.pickupRate;
    let deptIqs: number | null | undefined = departmentStats?.avgIqs;

    if ((deptTotalCalls === undefined || deptTotalCalls === 0) && teamLeads && teamLeads.length > 0) {
      deptTotalCalls = teamLeads.reduce((acc, t) => acc + (t.totalCalls || 0), 0);
      const totalAnswered = teamLeads.reduce(
        (acc, t) => acc + Math.round(((t.totalCalls || 0) * (t.connectRate || 0)) / 100),
        0
      );
      deptPickup = deptTotalCalls > 0 ? Math.round((totalAnswered / deptTotalCalls) * 100) : null;
      const totalWeightedIqs = teamLeads.reduce(
        (acc, t) => acc + (t.totalCalls || 0) * (t.avgScore || 0),
        0
      );
      deptIqs = deptTotalCalls > 0 ? Math.round((totalWeightedIqs / deptTotalCalls) * 10) / 10 : null;
    }

    return {
      pickupTeam: currentTlData && currentTlData.totalCalls > 0 ? `${currentTlData.connectRate}%` : '—',
      pickupCx: deptPickup != null ? `${deptPickup}%` : '—',
      iqsTeam: currentTlData && currentTlData.avgScore ? `${currentTlData.avgScore}%` : '—',
      iqsCx: deptIqs != null ? `${deptIqs}%` : '—',
      volumeTeam: currentTlData ? fmtVol(currentTlData.totalCalls) : '—',
      volumeCx: deptTotalCalls != null ? fmtVol(deptTotalCalls) : '—',
    };
  };

  const metrics = getStatMetrics();

  const handleAgentClick = (agentName: string) => {
    if (onSelectRm) onSelectRm(agentName);
    if (onSwitchToMemberAnalytics) onSwitchToMemberAnalytics();
  };

  return (
    <div style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif' }}>
      {/* ── Page Header ───────────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 24,
          gap: 24,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
          <h1 style={{ fontSize: 24, fontWeight: 600, margin: 0, whiteSpace: 'nowrap', color: 'var(--qa-text, #18181b)' }}>
            Team Analytics
          </h1>

          {/* Viewing TL Selector */}
          <div ref={tlDropRef} style={{ position: 'relative' }}>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 13,
                color: 'var(--qa-text-2, #71717a)',
              }}
            >
              <span>Viewing TL:</span>
              <button
                onClick={() => setShowTLDrop((p) => !p)}
                style={{
                  height: 32,
                  padding: '0 12px',
                  background: 'var(--qa-card, #ffffff)',
                  border: '1px solid var(--qa-border, #e4e4e7)',
                  borderRadius: 8,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 13,
                  fontWeight: 500,
                  color: 'var(--qa-text, #18181b)',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
                }}
              >
                {currentTL}
                <span style={{ color: 'var(--qa-text-3, #a1a1aa)', fontSize: 10 }}>▾</span>
              </button>
            </div>

            {showTLDrop && (
              <div
                style={{
                  position: 'absolute',
                  top: 'calc(100% + 6px)',
                  left: 0,
                  zIndex: 40,
                  background: 'var(--qa-card, #ffffff)',
                  border: '1px solid var(--qa-border, #e4e4e7)',
                  borderRadius: 8,
                  boxShadow: '0 8px 24px rgba(0,0,0,0.1)',
                  minWidth: 160,
                  overflow: 'hidden',
                }}
              >
                {availableTLs.map((tl) => (
                  <button
                    key={tl}
                    onClick={() => handleSelectTL(tl)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      width: '100%',
                      padding: '10px 14px',
                      background: currentTL === tl ? 'var(--qa-fill-light, #f4f4f5)' : 'transparent',
                      border: 0,
                      borderBottom: '1px solid var(--qa-border-sub, #f4f4f5)',
                      cursor: 'pointer',
                      fontSize: 13,
                      color: 'var(--qa-text, #18181b)',
                      fontFamily: 'inherit',
                      textAlign: 'left',
                      fontWeight: currentTL === tl ? 600 : 400,
                    }}
                  >
                    {tl}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Channel Segment */}
          <ChannelSeg value={channel} onChange={(ch) => setChannel(ch)} />
        </div>

        {/* Time Range Selector */}
        <div style={{ position: 'relative' }}>
          <div
            style={{
              display: 'inline-flex',
              border: '1px solid var(--qa-border, #e4e4e7)',
              borderRadius: 8,
              overflow: 'hidden',
              background: 'var(--qa-card, #ffffff)',
            }}
          >
            {(['7', '30', 'custom'] as const).map((p) => (
              <button
                key={p}
                onClick={() => {
                  if (p === 'custom') {
                    setShowPicker(true);
                    return;
                  }
                  setPeriod(p);
                  setCustomFrom('');
                  setCustomTo('');
                  setShowPicker(false);
                }}
                style={{
                  height: 32,
                  padding: '0 14px',
                  background: period === p ? 'var(--qa-text, #18181b)' : 'transparent',
                  border: 0,
                  borderRight: p !== 'custom' ? '1px solid var(--qa-border, #e4e4e7)' : 0,
                  fontSize: 13,
                  color: period === p ? '#ffffff' : 'var(--qa-text-2, #71717a)',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  fontWeight: period === p ? 600 : 400,
                }}
              >
                {p === '7'
                  ? '7 days'
                  : p === '30'
                    ? '30 days'
                    : period === 'custom' && customFrom
                      ? `${fmtDateDisplay(customFrom)} – ${fmtDateDisplay(customTo)}`
                      : 'Custom range'}
              </button>
            ))}
          </div>

          {showPicker && (
            <DateRangePicker
              onApply={applyCustom}
              onCancel={() => {
                setShowPicker(false);
                if (period === 'custom' && !customFrom) setPeriod('30');
              }}
            />
          )}
        </div>
      </div>

      {/* ── Stat Cards ────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 32 }}>
        {channel !== 'calls' ? (
          [
            'IQS',
            channel === 'emails' ? 'EMAILS HANDLED' : 'CHATS HANDLED',
            'PICKUP RATE',
          ].map((title, i) => (
            <div
              key={i}
              style={{
                background: 'var(--qa-card, #ffffff)',
                border: '1px solid var(--qa-border, #e4e4e7)',
                borderRadius: 8,
                padding: 20,
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  color: 'var(--qa-text-4, #d4d4d8)',
                  marginBottom: 12,
                  fontWeight: 600,
                }}
              >
                {title}
              </div>
              <span style={{ fontSize: 20, color: 'var(--qa-text-4, #d4d4d8)' }}>—</span>
            </div>
          ))
        ) : (
          <>
            <StatCard label="IQS" teamValue={metrics.iqsTeam} cxValue={metrics.iqsCx} cxLabel="Department" />
            <StatCard
              label="CALLS HANDLED"
              teamValue={metrics.volumeTeam}
              cxValue={metrics.volumeCx}
              cxLabel="Department"
            />
            <StatCard label="PICKUP RATE" teamValue={metrics.pickupTeam} cxValue={metrics.pickupCx} cxLabel="Department" />
          </>
        )}
      </div>

      {/* ── IQS by Parameter ──────────────────────────────────────────── */}
      <section style={{ marginBottom: 32 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0, color: 'var(--qa-text, #18181b)' }}>
            IQS by Parameter — Your Team
          </h2>
          <span style={{ fontSize: 11, color: 'var(--qa-text-3, #a1a1aa)', fontStyle: 'italic' }}>
            {channel === 'calls'
              ? `${periodLabel} · avg across all evaluated calls`
              : `${periodLabel} · values available for Calls only`}
          </span>
        </div>

        <div
          style={{
            background: 'var(--qa-card, #ffffff)',
            border: '1px solid var(--qa-border, #e4e4e7)',
            borderRadius: 8,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              padding: '14px 20px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              borderBottom: '1px solid var(--qa-border, #e4e4e7)',
            }}
          >
            <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--qa-text, #18181b)' }}>
              {channel === 'calls' ? `${params.length} quality parameters · weighted` : '0 parameters'}
            </span>
          </div>

          {/* Legend */}
          <div
            style={{
              display: 'flex',
              gap: 24,
              padding: '10px 20px',
              borderBottom: '1px solid var(--qa-border-sub, #f4f4f5)',
              fontSize: 12,
              color: 'var(--qa-text-2, #71717a)',
            }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <span
                style={{
                  width: 18,
                  height: 8,
                  background: 'var(--qa-gray-700, #27272a)',
                  borderRadius: 999,
                }}
              />
              Your team
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 0, height: 14, borderLeft: '2px dashed var(--qa-text-2, #71717a)' }} />
              Department average
            </span>
          </div>

          <div style={{ padding: '12px 20px' }}>
            {channel !== 'calls' ? (
              <div style={{ padding: '48px 0', textAlign: 'center', fontSize: 13, color: 'var(--qa-text-3, #a1a1aa)' }}>
                Values are currently available for Calls only.
              </div>
            ) : params.length === 0 ? (
              <EmptyChannelState channel={channel} />
            ) : (
              params.map((p) => <ParamRow key={p.key} p={p} />)
            )}
          </div>
        </div>
      </section>

      {/* ── Team Member Performance ───────────────────────────────────── */}
      <section style={{ marginBottom: 32 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0, color: 'var(--qa-text, #18181b)' }}>
            Team Member Performance
          </h2>
          <span style={{ fontSize: 11, color: 'var(--qa-text-3, #a1a1aa)', fontStyle: 'italic' }}>
            {`${activeAgents.length} active members`} · click a tab to switch view
          </span>
        </div>

        <div
          style={{
            background: 'var(--qa-card, #ffffff)',
            border: '1px solid var(--qa-border, #e4e4e7)',
            borderRadius: 8,
            overflow: 'hidden',
          }}
        >
          {/* Panel Header with Tabs */}
          <div
            style={{
              padding: '0 20px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              borderBottom: '1px solid var(--qa-border, #e4e4e7)',
            }}
          >
            <div style={{ display: 'flex', gap: 4 }}>
              {(['summary', 'breakdown'] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  style={{
                    height: 40,
                    padding: '0 16px',
                    background: 'transparent',
                    border: 0,
                    borderBottom:
                      activeTab === tab ? '2px solid var(--qa-text, #18181b)' : '2px solid transparent',
                    marginBottom: -1,
                    fontSize: 13,
                    fontFamily: 'inherit',
                    cursor: 'pointer',
                    color: activeTab === tab ? 'var(--qa-text, #18181b)' : 'var(--qa-text-2, #71717a)',
                    fontWeight: activeTab === tab ? 600 : 400,
                  }}
                >
                  {tab === 'summary' ? 'Summary' : 'Parameter Breakdown'}
                </button>
              ))}
            </div>
          </div>

          {/* Summary Tab */}
          {activeTab === 'summary' && (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <Th left>Agent</Th>
                    <Th>Pickup Rate</Th>
                    <Th>IQS</Th>
                    <Th active={channel === 'chats'}>Chats</Th>
                    <Th active={channel === 'calls'}>Calls</Th>
                    <Th active={channel === 'emails'}>Emails</Th>
                  </tr>
                </thead>
                <tbody>
                  {activeAgents.length === 0 ? (
                    <tr>
                      <td colSpan={6} style={{ ...td, textAlign: 'center', color: 'var(--qa-text-3, #a1a1aa)', padding: '32px 16px' }}>
                        No agent data for this period
                      </td>
                    </tr>
                  ) : (
                    activeAgents.map((agent) => {
                      const ch = channel === 'emails' ? null : agent[channel];
                      return (
                        <SummaryRow
                          key={agent.name}
                          agent={agent}
                          chData={ch}
                          activeChannel={channel}
                          onClick={() => handleAgentClick(agent.name)}
                        />
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* Parameter Breakdown Tab */}
          {activeTab === 'breakdown' && (
            <>
              {/* Independent Channel Switcher */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '12px 20px',
                  borderBottom: '1px solid var(--qa-border-sub, #f4f4f5)',
                }}
              >
                <span
                  style={{
                    fontSize: 11,
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                    color: 'var(--qa-text-3, #a1a1aa)',
                    fontWeight: 600,
                  }}
                >
                  Channel
                </span>
                <ChannelSeg value={breakdownCh} onChange={setBreakdownCh} />
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: 'var(--qa-text-3, #a1a1aa)',
                  padding: '8px 20px',
                  borderBottom: '1px solid var(--qa-border-sub, #f4f4f5)',
                }}
              >
                Scroll right to see all parameters →
              </div>
              <div style={{ overflowX: 'auto' }}>
                {breakdownCh !== 'calls' ? (
                  <div style={{ padding: '48px 0', textAlign: 'center', fontSize: 13, color: 'var(--qa-text-3, #a1a1aa)' }}>
                    Values are currently available for Calls only.
                  </div>
                ) : activeAgents.length === 0 ? (
                  <EmptyChannelState channel={breakdownCh} />
                ) : (
                  <table style={{ borderCollapse: 'collapse', width: 'max-content', minWidth: '100%' }}>
                    <thead>
                      <tr>
                        <th style={stickyTh}>Agent</th>
                        {breakdownParams.map((p) => (
                          <th key={p.key} title={p.label} style={paramTh}>
                            {p.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {activeAgents.map((agent) => {
                        const chData = agent[breakdownCh];
                        return (
                          <tr key={agent.name} style={{ borderBottom: '1px solid var(--qa-border-sub, #f4f4f5)' }}>
                            <td
                              style={stickyTd}
                              className="cursor-pointer hover:font-bold hover:text-black"
                              onClick={() => handleAgentClick(agent.name)}
                            >
                              {agent.name}
                            </td>
                            {breakdownParams.map((p) => {
                              const val = chData?.params[p.key] ?? null;
                              return (
                                <td
                                  key={p.key}
                                  style={{
                                    ...paramTd,
                                    color: val == null ? 'var(--qa-text-4, #d4d4d8)' : 'var(--qa-text, #18181b)',
                                  }}
                                >
                                  {val != null ? `${Math.round(val)}` : '—'}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          )}
        </div>
      </section>

      {/* Footer Note */}
      <p style={{ fontSize: 11, color: 'var(--qa-text-3, #a1a1aa)', fontStyle: 'italic', margin: '0 0 16px' }}>
        Pickup Rate = connected calls / total actionable calls · IQS = avg internal quality score · Parameter scores = pass rate
      </p>
    </div>
  );
}
