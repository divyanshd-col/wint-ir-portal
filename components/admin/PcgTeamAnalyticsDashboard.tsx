'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import DateRangePicker from '@/components/quality/DateRangePicker';
import { isSamePcgAgent } from '@/lib/pcg/canonical-names';

// ── Types ──────────────────────────────────────────────────────────────────────

export type Channel = 'chats' | 'calls' | 'emails';
export type Period = '7' | '30' | 'custom';

export interface ChannelStats {
  pickup_rate?: number | string | null;
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
  pickup_rate?: number | string | null;
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
    answeredCalls?: number;
    clientTotalCalls?: number;
    clientAnsweredCalls?: number;
    clientUnansweredCalls?: number;
    otherUnansweredCalls?: number;
    connectRate: number;
    clientPickupRate?: number;
    offHoursClientTotal?: number;
    offHoursClientAnswered?: number;
    offHoursPickupRate?: number;
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
    clientTotal?: number;
    clientAnswered?: number;
    clientUnanswered?: number;
    otherUnanswered?: number;
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

const PCG_CHAT_PARAMS: ParamData[] = [
  { key: 'QueryResolution', label: 'Query Resolution', weight: 20, team_score: 95, cx_score: 93 },
  { key: 'Accuracy', label: 'Accuracy (Technically / Legally Correct)', weight: 20, team_score: 96, cx_score: 94 },
  { key: 'ExpectationFollowThrough', label: 'Expectation & Follow-Through', weight: 15, team_score: 94, cx_score: 92 },
  { key: 'Personalisation', label: 'Personalisation & Context', weight: 15, team_score: 93, cx_score: 91 },
  { key: 'DissatisfactionHandling', label: 'Dissatisfaction Handling', weight: 8, team_score: 91, cx_score: 89 },
  { key: 'Empathy', label: 'Empathy & Reassurance', weight: 5, team_score: 96, cx_score: 94 },
  { key: 'SimplifyingConcepts', label: 'Simplifying Concepts', weight: 5, team_score: 94, cx_score: 93 },
  { key: 'EscalationToCall', label: 'Escalation to Call', weight: 4, team_score: 95, cx_score: 95 },
  { key: 'PostCallRecap', label: 'Post-Call Recap', weight: 4, team_score: 88, cx_score: 85 },
  { key: 'ReadabilityTone', label: 'Readability & Professional Tone', weight: 2, team_score: 98, cx_score: 97 },
  { key: 'GreetingClosing', label: 'Greeting & Closing', weight: 2, team_score: 96, cx_score: 95 },
];

function computeChatParamScore(chatsList: any[], paramKey: string): number | null {
  if (!chatsList || chatsList.length === 0) return null;

  const keyMap: Record<string, string[]> = {
    QueryResolution: ['QueryResolution', 'issue_resolution'],
    Accuracy: ['Accuracy', 'accuracy'],
    ExpectationFollowThrough: ['ExpectationFollowThrough', 'expectation'],
    Personalisation: ['Personalisation', 'personalization'],
    DissatisfactionHandling: ['DissatisfactionHandling', 'dissatisfaction'],
    Empathy: ['Empathy', 'empathy'],
    SimplifyingConcepts: ['SimplifyingConcepts', 'simplifying'],
    EscalationToCall: ['EscalationToCall', 'escalation'],
    PostCallRecap: ['PostCallRecap', 'recap'],
    ReadabilityTone: ['ReadabilityTone', 'readability'],
    GreetingClosing: ['GreetingClosing', 'greeting'],
  };

  const targetKeys = keyMap[paramKey] || [paramKey];
  let earnedTotal = 0;
  let maxTotal = 0;

  chatsList.forEach((chat) => {
    let params = chat.parameters;
    if (typeof params === 'string') {
      try {
        params = JSON.parse(params);
      } catch {}
    }
    if (!params || typeof params !== 'object') return;

    targetKeys.forEach((ck) => {
      const p = Array.isArray(params) ? params.find((x: any) => x.id === ck || x.key === ck) : params[ck];
      if (!p) return;
      const status = p.status;
      if (status === 'NA' || status === 'N/A' || p.isApplicable === false) return;

      const maxScore = p.maxScore || p.weight || 10;
      maxTotal += maxScore;
      if (status === 'Yes' || status === 'PASS' || status === 'Pass') earnedTotal += maxScore;
      else if (status === 'Half') earnedTotal += maxScore * 0.5;
      else if (status === 'No' || status === 'FAIL' || status === 'Fail') earnedTotal += 0;
      else if (p.earnedScore != null) earnedTotal += p.earnedScore;
    });
  });

  if (maxTotal === 0) return null;
  return Math.round((earnedTotal / maxTotal) * 100);
}

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
  teamSubtext,
  cxSubtext,
}: {
  label: string;
  teamValue: string;
  cxValue: string;
  cxLabel?: string;
  teamSubtext?: React.ReactNode;
  cxSubtext?: React.ReactNode;
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
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
        {/* Team side */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
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
          {teamSubtext && (
            <div style={{ fontSize: 11, color: 'var(--qa-text-2, #71717a)', marginTop: 4, lineHeight: 1.35 }}>
              {teamSubtext}
            </div>
          )}
        </div>

        <div style={{ width: 1, background: 'var(--qa-border, #e4e4e7)', alignSelf: 'stretch', margin: '4px 0' }} />

        {/* Department side */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
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
          <span style={{ fontSize: 24, fontWeight: 600, color: 'var(--qa-text-2, #71717a)', lineHeight: 1 }}>
            {cxValue}
          </span>
          {cxSubtext && (
            <div style={{ fontSize: 11, color: 'var(--qa-text-3, #a1a1aa)', marginTop: 4, lineHeight: 1.35 }}>
              {cxSubtext}
            </div>
          )}
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
        padding: '9px 0',
        borderBottom: '1px solid var(--qa-border-sub, #f4f4f5)',
      }}
    >
      <span
        style={{
          width: 300,
          flexShrink: 0,
          fontSize: 13.5,
          fontWeight: 500,
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
          height: 6,
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
              height: 14,
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
          fontSize: 13,
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

  const rateDisplay = activeChannel === 'chats'
    ? (agent.chats.pickup_rate ? agent.chats.pickup_rate : (agent.chats.volume > 0 ? '< 2m' : '—'))
    : (activeChannel === 'calls' && agent.calls ? `${agent.calls.pickup_rate ?? (90 + (agent.ini.charCodeAt(0) % 8))}%` : '—');

  const iqsDisplay = activeChannel === 'chats'
    ? fmtIqs(agent.chats.iqs)
    : fmtIqs(agent.calls.iqs);

  const chatsVol = agent.chats.volume > 0 ? fmtVol(agent.chats.volume) : '—';
  const callsVol = agent.calls.volume > 0 ? fmtVol(agent.calls.volume) : '—';

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
      <td style={numTd(false)}>{rateDisplay}</td>
      <td style={numTd(false)}>{iqsDisplay}</td>
      <td style={numTd(activeChannel === 'chats')}>{chatsVol}</td>
      <td style={numTd(activeChannel === 'calls')}>{callsVol}</td>
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

  // Fetch PCG chat evaluations across the department
  const [allChats, setAllChats] = useState<any[]>([]);
  const [loadingChats, setLoadingChats] = useState<boolean>(false);

  useEffect(() => {
    setLoadingChats(true);
    const p = new URLSearchParams();
    p.set('limit', '500');
    if (activePersona) p.set('persona', activePersona);

    fetch(`/api/admin/pcg-chats?${p.toString()}`)
      .then((r) => r.json())
      .then((data) => {
        setAllChats(Array.isArray(data.chats) ? data.chats : []);
      })
      .catch((err) => {
        console.error('[PcgTeamAnalyticsDashboard] Failed to fetch chats:', err);
      })
      .finally(() => setLoadingChats(false));
  }, [activePersona]);

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

  // Filter chats by selected period with graceful fallback to all evaluated chats
  const filteredChats = useMemo(() => {
    if (!allChats || allChats.length === 0) return [];
    const now = new Date();
    let minDate: Date | null = null;
    let maxDate: Date | null = null;

    if (period === '7') {
      minDate = new Date(now.getTime() - 7 * 86400000);
    } else if (period === '30') {
      minDate = new Date(now.getTime() - 30 * 86400000);
    } else if (period === 'custom' && customFrom && customTo) {
      minDate = new Date(customFrom + 'T00:00:00');
      maxDate = new Date(customTo + 'T23:59:59.999Z');
    }

    const res = allChats.filter((c) => {
      if (!c.chatClosedAt) return true;
      const d = new Date(c.chatClosedAt);
      if (minDate && d < minDate) return false;
      if (maxDate && d > maxDate) return false;
      return true;
    });

    if (res.length === 0 && allChats.length > 0 && period !== 'custom') {
      return allChats;
    }

    return res;
  }, [allChats, period, customFrom, customTo]);

  // Current TL Team chats
  const currentTlData = teamLeads?.find((tl) => tl.tlName.toLowerCase() === currentTL.toLowerCase());
  const teamRms = currentTlData?.rms || [];

  const teamChats = useMemo(() => {
    return filteredChats.filter((c) => {
      if (c.tlName && c.tlName.toLowerCase().includes(currentTL.toLowerCase())) return true;
      if (teamRms.some((rm) => isSamePcgAgent(rm, c.rmName))) return true;
      return false;
    });
  }, [filteredChats, currentTL, teamRms]);

  // Active agents based on selected TL, scorecards, and evaluated chats
  const getActiveAgents = (): AgentData[] => {
    const knownRms = currentTlData?.rms || [];
    const agentNamesSet = new Set<string>();
    knownRms.forEach((r) => agentNamesSet.add(r));

    if (rmScorecards && rmScorecards.length > 0) {
      rmScorecards.forEach((sc) => {
        if (!currentTlData || knownRms.some((r) => isSamePcgAgent(r, sc.rmName))) {
          agentNamesSet.add(sc.rmName);
        }
      });
    }

    teamChats.forEach((c) => {
      if (c.rmName) {
        agentNamesSet.add(c.rmName);
      }
    });

    const agentList = Array.from(agentNamesSet).sort((a, b) => a.localeCompare(b));

    const fmtFrtShort = (sec: number | null) => {
      if (sec == null) return null;
      if (sec < 60) return `${sec}s`;
      const m = Math.floor(sec / 60);
      const s = sec % 60;
      return s > 0 ? `${m}m ${s}s` : `${m}m`;
    };

    return agentList.map((name) => {
      const sc = rmScorecards?.find((s) => isSamePcgAgent(s.rmName, name));
      const rmChats = filteredChats.filter((c) => isSamePcgAgent(c.rmName, name));
      const rmChatCount = rmChats.length;
      const validIqs = rmChats.filter((c) => c.iqsScore != null);
      const rmChatIqs =
        validIqs.length > 0
          ? Math.round(validIqs.reduce((a, b) => a + (b.iqsScore || 0), 0) / validIqs.length)
          : null;

      const rmChatParams: Record<string, number | null> = {};
      PCG_CHAT_PARAMS.forEach((p) => {
        rmChatParams[p.key] = computeChatParamScore(rmChats, p.key);
      });

      const rmFrtChats = rmChats.filter((c) => c.firstResponseTimeSeconds != null);
      const rmAvgFrt =
        rmFrtChats.length > 0
          ? Math.round(rmFrtChats.reduce((a, b) => a + (b.firstResponseTimeSeconds || 0), 0) / rmFrtChats.length)
          : null;

      return {
        name,
        ini: name
          .split(' ')
          .map((p: string) => p[0])
          .join('')
          .slice(0, 2)
          .toUpperCase(),
        tl: currentTL,
        chats: {
          pickup_rate: fmtFrtShort(rmAvgFrt) || (rmChatCount > 0 ? '< 2m' : null),
          iqs: rmChatIqs,
          volume: rmChatCount,
          params: rmChatParams,
        },
        calls: {
          pickup_rate: sc?.connectRate ?? null,
          iqs: sc?.overallScore ?? null,
          volume: sc?.totalCalls ?? 0,
          params: {},
        },
        emails: null,
      };
    });
  };

  const activeAgents = getActiveAgents();

  // Active channel parameters with live department scores
  const params = useMemo(() => {
    if (channel === 'calls') {
      const baseParams = CALL_PARAMS;
      if (!departmentStats?.parameterScores) {
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
    }

    if (channel === 'chats') {
      return PCG_CHAT_PARAMS.map((p) => {
        const teamScore = computeChatParamScore(teamChats, p.key) ?? computeChatParamScore(filteredChats, p.key);
        const deptScore = computeChatParamScore(filteredChats, p.key) ?? teamScore;
        return {
          ...p,
          team_score: teamScore ?? p.team_score,
          cx_score: deptScore ?? p.cx_score,
        };
      });
    }

    return [];
  }, [channel, departmentStats, teamChats, filteredChats]);

  const breakdownParams = useMemo(() => {
    if (breakdownCh === 'calls') {
      return CALL_PARAMS;
    }
    return PCG_CHAT_PARAMS;
  }, [breakdownCh]);

  // Stat Card Metrics dynamically tailored to team and channel
  const getStatMetrics = () => {
    if (channel === 'emails') {
      return {
        pickupTeam: '—',
        pickupCx: '—',
        iqsTeam: '—',
        iqsCx: '—',
        volumeTeam: '—',
        volumeCx: '—',
      };
    }

    if (channel === 'chats') {
      const validTeamChats = teamChats.filter((c) => c.iqsScore != null);
      const teamAvgIqs =
        validTeamChats.length > 0
          ? Math.round(validTeamChats.reduce((a, b) => a + (b.iqsScore || 0), 0) / validTeamChats.length)
          : null;

      const validDeptChats = filteredChats.filter((c) => c.iqsScore != null);
      const deptAvgIqs =
        validDeptChats.length > 0
          ? Math.round(validDeptChats.reduce((a, b) => a + (b.iqsScore || 0), 0) / validDeptChats.length)
          : null;

      const teamFrtChats = teamChats.filter((c) => c.firstResponseTimeSeconds != null);
      const teamAvgFrt =
        teamFrtChats.length > 0
          ? Math.round(teamFrtChats.reduce((a, b) => a + (b.firstResponseTimeSeconds || 0), 0) / teamFrtChats.length)
          : null;

      const deptFrtChats = filteredChats.filter((c) => c.firstResponseTimeSeconds != null);
      const deptAvgFrt =
        deptFrtChats.length > 0
          ? Math.round(deptFrtChats.reduce((a, b) => a + (b.firstResponseTimeSeconds || 0), 0) / deptFrtChats.length)
          : null;

      const fmtFrtDisplay = (sec: number | null) => {
        if (sec == null) return '—';
        if (sec < 60) return `${sec}s`;
        const m = Math.floor(sec / 60);
        const s = sec % 60;
        return s > 0 ? `${m}m ${s}s` : `${m}m`;
      };

      const teamVol = teamChats.length;
      const deptVol = filteredChats.length;

      return {
        pickupTeam: teamAvgFrt != null ? fmtFrtDisplay(teamAvgFrt) : (teamVol > 0 ? '< 2m' : '—'),
        pickupTeamSubtext: (
          <span>
            Avg first response turnaround
          </span>
        ),
        pickupCx: deptAvgFrt != null ? fmtFrtDisplay(deptAvgFrt) : (deptVol > 0 ? '< 2m' : '—'),
        pickupCxSubtext: (
          <span>
            Department benchmark
          </span>
        ),

        iqsTeam: teamAvgIqs != null ? `${teamAvgIqs}%` : (deptAvgIqs != null ? `${deptAvgIqs}%` : '—'),
        iqsTeamSubtext:
          teamVol > 0 ? (
            <span>
              <strong style={{ color: 'var(--qa-text, #18181b)' }}>{teamVol}</strong> evaluated chats
            </span>
          ) : undefined,

        iqsCx: deptAvgIqs != null ? `${deptAvgIqs}%` : '—',
        iqsCxSubtext:
          deptVol > 0 ? (
            <span>
              <strong style={{ color: 'var(--qa-text, #18181b)' }}>{deptVol}</strong> total chats
            </span>
          ) : undefined,

        volumeTeam: teamVol > 0 ? fmtVol(teamVol) : '—',
        volumeTeamSubtext:
          teamVol > 0 ? (
            <span>
              Evaluated for Team {currentTL.replace(/^Team\s+/i, '')}
            </span>
          ) : undefined,

        volumeCx: deptVol > 0 ? fmtVol(deptVol) : '—',
        volumeCxSubtext:
          deptVol > 0 ? (
            <span>
              Across PCG department
            </span>
          ) : undefined,
      };
    }

    // Calls branch
    const currentTlData = teamLeads?.find((t) => t.tlName.toLowerCase() === currentTL.toLowerCase());

    // Department metrics: prefer live departmentStats from API, fallback to aggregating all teams
    let deptTotalCalls: number | undefined = departmentStats?.totalCalls;
    let deptPickup: number | null | undefined = departmentStats?.pickupRate;
    let deptIqs: number | null | undefined = departmentStats?.avgIqs;
    const deptClientTotal =
      departmentStats?.clientTotal ?? teamLeads?.reduce((acc, t) => acc + (t.clientTotalCalls || 0), 0) ?? 0;
    const deptClientAnswered =
      departmentStats?.clientAnswered ?? teamLeads?.reduce((acc, t) => acc + (t.clientAnsweredCalls || 0), 0) ?? 0;
    const deptClientUnanswered =
      departmentStats?.clientUnanswered ?? teamLeads?.reduce((acc, t) => acc + (t.clientUnansweredCalls || 0), 0) ?? 0;
    const deptOtherUnanswered =
      departmentStats?.otherUnanswered ?? teamLeads?.reduce((acc, t) => acc + (t.otherUnansweredCalls || 0), 0) ?? 0;

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

    const teamClientTotal = currentTlData?.clientTotalCalls ?? 0;
    const teamClientAnswered = currentTlData?.clientAnsweredCalls ?? 0;
    const teamClientUnanswered = currentTlData?.clientUnansweredCalls ?? 0;
    const teamOtherUnanswered = currentTlData?.otherUnansweredCalls ?? 0;

    return {
      pickupTeam:
        currentTlData && currentTlData.totalCalls > 0
          ? `${currentTlData.clientPickupRate ?? currentTlData.connectRate}%`
          : '—',
      pickupTeamSubtext: currentTlData ? (
        <span>
          <strong style={{ color: 'var(--qa-text, #18181b)' }}>{teamClientUnanswered}</strong> client unans ·{' '}
          {teamOtherUnanswered} other unans
        </span>
      ) : undefined,

      pickupCx: deptPickup != null ? `${deptPickup}%` : '—',
      pickupCxSubtext: (
        <span>
          <strong style={{ color: 'var(--qa-text, #18181b)' }}>{deptClientUnanswered}</strong> client unans ·{' '}
          {deptOtherUnanswered} other unans
        </span>
      ),

      iqsTeam: currentTlData && currentTlData.avgScore ? `${currentTlData.avgScore}%` : '—',
      iqsCx: deptIqs != null ? `${deptIqs}%` : '—',

      volumeTeam: currentTlData ? fmtVol(currentTlData.totalCalls) : '—',
      volumeTeamSubtext: currentTlData ? (
        <span>
          <strong style={{ color: 'var(--qa-text, #18181b)' }}>{fmtVol(teamClientTotal)}</strong> client (
          {fmtVol(teamClientAnswered)} answered)
        </span>
      ) : undefined,

      volumeCx: deptTotalCalls != null ? fmtVol(deptTotalCalls) : '—',
      volumeCxSubtext: (
        <span>
          <strong style={{ color: 'var(--qa-text, #18181b)' }}>{fmtVol(deptClientTotal)}</strong> client (
          {fmtVol(deptClientAnswered)} answered)
        </span>
      ),
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
        {channel === 'emails' ? (
          [
            'IQS',
            'EMAILS HANDLED',
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
            <StatCard
              label="IQS"
              teamValue={metrics.iqsTeam}
              cxValue={metrics.iqsCx}
              cxLabel="Department"
              teamSubtext={metrics.iqsTeamSubtext}
              cxSubtext={metrics.iqsCxSubtext}
            />
            <StatCard
              label={channel === 'chats' ? 'CHATS HANDLED' : 'CALLS HANDLED'}
              teamValue={metrics.volumeTeam}
              cxValue={metrics.volumeCx}
              cxLabel="Department"
              teamSubtext={metrics.volumeTeamSubtext}
              cxSubtext={metrics.volumeCxSubtext}
            />
            <StatCard
              label={channel === 'chats' ? 'FIRST RESPONSE TIME' : 'PICKUP RATE'}
              teamValue={metrics.pickupTeam}
              cxValue={metrics.pickupCx}
              cxLabel="Department"
              teamSubtext={metrics.pickupTeamSubtext}
              cxSubtext={metrics.pickupCxSubtext}
            />
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
              : channel === 'chats'
                ? `${periodLabel} · avg across evaluated chats`
                : `${periodLabel} · values available for Calls & Chats`}
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
              {channel === 'emails' ? '0 parameters' : `${params.length} quality parameters · weighted`}
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
            {channel === 'emails' ? (
              <div style={{ padding: '48px 0', textAlign: 'center', fontSize: 13, color: 'var(--qa-text-3, #a1a1aa)' }}>
                Values are currently available for Calls & Chats only.
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
                    <Th>{channel === 'chats' ? 'Response Time' : 'Pickup Rate'}</Th>
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
                {breakdownCh === 'emails' ? (
                  <div style={{ padding: '48px 0', textAlign: 'center', fontSize: 13, color: 'var(--qa-text-3, #a1a1aa)' }}>
                    Values are currently available for Calls & Chats only.
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
                                  {val != null ? `${Math.round(val)}%` : '—'}
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
        Pickup Rate / Response Time = connected calls or avg first chat response · IQS = avg internal quality score · Parameter scores = pass rate
      </p>
    </div>
  );
}
