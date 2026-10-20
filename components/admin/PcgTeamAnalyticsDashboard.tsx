'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import DateRangePicker from '@/components/quality/DateRangePicker';

// ── Types ──────────────────────────────────────────────────────────────────────

export type Channel = 'chats' | 'calls' | 'emails';
export type Period  = '7' | '30' | 'custom';

export interface ChannelStats {
  csat_pct: number | null;
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
  csat_pct: number | null;
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

// ── Default Mock Dataset Matching CX and PCG ───────────────────────────────────

const HARSH_AGENTS: AgentData[] = [
  {
    name: 'Anjali',
    ini: 'A',
    tl: 'Harsh',
    chats: { csat_pct: 94.9, iqs: 97, volume: 71, params: { issue_resolution: 98, accuracy: 96, expectation: 97, dissatisfaction: 92, personalization: 96, empathy: 98, escalation: 97, readability: 96, greeting: 95, recap: 88 } },
    calls: { csat_pct: 92.0, iqs: 95, volume: 14, params: { pitch_clarity: 96, yield_framing: 100, secondary_liquidity: 88, asset_allocation: 95, payout_timeline: 96, active_listening: 96, demat_linking: 95, tds_compliance: 98, tone_pacing: 95, call_recap: 85 } },
    emails: null,
  },
  {
    name: 'Bhavika',
    ini: 'B',
    tl: 'Harsh',
    chats: { csat_pct: 100.0, iqs: 100, volume: 14, params: { issue_resolution: 100, accuracy: 100, expectation: 100, dissatisfaction: 100, personalization: 100, empathy: 100, escalation: 100, readability: 100, greeting: 100, recap: 95 } },
    calls: { csat_pct: 96.0, iqs: 98, volume: 51, params: { pitch_clarity: 98, yield_framing: 100, secondary_liquidity: 92, asset_allocation: 96, payout_timeline: 98, active_listening: 98, demat_linking: 98, tds_compliance: 100, tone_pacing: 97, call_recap: 90 } },
    emails: null,
  },
  {
    name: 'Charvi Wagh',
    ini: 'CW',
    tl: 'Harsh',
    chats: { csat_pct: 74.3, iqs: 97, volume: 79, params: { issue_resolution: 95, accuracy: 96, expectation: 96, dissatisfaction: 88, personalization: 95, empathy: 96, escalation: 96, readability: 95, greeting: 94, recap: 80 } },
    calls: { csat_pct: 82.0, iqs: 94, volume: 5, params: { pitch_clarity: 95, yield_framing: 100, secondary_liquidity: 84, asset_allocation: 92, payout_timeline: 94, active_listening: 94, demat_linking: 94, tds_compliance: 96, tone_pacing: 94, call_recap: 78 } },
    emails: null,
  },
  {
    name: 'Dhanush',
    ini: 'D',
    tl: 'Harsh',
    chats: { csat_pct: 80.3, iqs: 89, volume: 175, params: { issue_resolution: 90, accuracy: 92, expectation: 91, dissatisfaction: 85, personalization: 90, empathy: 92, escalation: 92, readability: 92, greeting: 90, recap: 75 } },
    calls: { csat_pct: 85.0, iqs: 86, volume: 80, params: { pitch_clarity: 96, yield_framing: 100, secondary_liquidity: 85, asset_allocation: 92, payout_timeline: 94, active_listening: 92, demat_linking: 94, tds_compliance: 96, tone_pacing: 92, call_recap: 80 } },
    emails: null,
  },
  {
    name: 'Pavithra Reddy',
    ini: 'PR',
    tl: 'Harsh',
    chats: { csat_pct: 80.0, iqs: 95, volume: 70, params: { issue_resolution: 94, accuracy: 96, expectation: 96, dissatisfaction: 90, personalization: 95, empathy: 97, escalation: 96, readability: 96, greeting: 94, recap: 81 } },
    calls: { csat_pct: 86.5, iqs: 93, volume: 162, params: { pitch_clarity: 97, yield_framing: 100, secondary_liquidity: 88, asset_allocation: 94, payout_timeline: 96, active_listening: 95, demat_linking: 96, tds_compliance: 98, tone_pacing: 95, call_recap: 82 } },
    emails: null,
  },
  {
    name: 'Priyank Surana',
    ini: 'PS',
    tl: 'Harsh',
    chats: { csat_pct: 94.1, iqs: 95, volume: 46, params: { issue_resolution: 95, accuracy: 96, expectation: 96, dissatisfaction: 91, personalization: 95, empathy: 97, escalation: 96, readability: 96, greeting: 94, recap: 82 } },
    calls: { csat_pct: 88.0, iqs: 92, volume: 8, params: { pitch_clarity: 96, yield_framing: 100, secondary_liquidity: 86, asset_allocation: 93, payout_timeline: 95, active_listening: 94, demat_linking: 95, tds_compliance: 97, tone_pacing: 94, call_recap: 80 } },
    emails: null,
  },
  {
    name: 'Shubhangini',
    ini: 'S',
    tl: 'Harsh',
    chats: { csat_pct: 92.6, iqs: 98, volume: 77, params: { issue_resolution: 97, accuracy: 98, expectation: 98, dissatisfaction: 94, personalization: 97, empathy: 98, escalation: 98, readability: 98, greeting: 96, recap: 86 } },
    calls: { csat_pct: 91.0, iqs: 96, volume: 54, params: { pitch_clarity: 98, yield_framing: 100, secondary_liquidity: 90, asset_allocation: 96, payout_timeline: 97, active_listening: 97, demat_linking: 97, tds_compliance: 99, tone_pacing: 96, call_recap: 86 } },
    emails: null,
  },
  {
    name: 'Vaibhavi',
    ini: 'V',
    tl: 'Harsh',
    chats: { csat_pct: null, iqs: null, volume: 0, params: {} },
    calls: { csat_pct: 84.0, iqs: 88, volume: 13, params: { pitch_clarity: 95, yield_framing: 100, secondary_liquidity: 83, asset_allocation: 90, payout_timeline: 93, active_listening: 91, demat_linking: 93, tds_compliance: 95, tone_pacing: 92, call_recap: 76 } },
    emails: null,
  },
];

const GOKUL_AGENTS: AgentData[] = [
  {
    name: 'Yaashvi Arora',
    ini: 'YA',
    tl: 'Gokul',
    chats: { csat_pct: 95.0, iqs: 96, volume: 45, params: { issue_resolution: 96, accuracy: 97, expectation: 97, dissatisfaction: 93, personalization: 96, empathy: 97, escalation: 97, readability: 97, greeting: 96, recap: 85 } },
    calls: { csat_pct: 94.0, iqs: 91, volume: 68, params: { pitch_clarity: 99, yield_framing: 100, secondary_liquidity: 91, asset_allocation: 96, payout_timeline: 98, active_listening: 96, demat_linking: 97, tds_compliance: 99, tone_pacing: 96, call_recap: 88 } },
    emails: null,
  },
  {
    name: 'Aahan Thaker',
    ini: 'AT',
    tl: 'Gokul',
    chats: { csat_pct: 92.5, iqs: 94, volume: 60, params: { issue_resolution: 94, accuracy: 95, expectation: 95, dissatisfaction: 89, personalization: 94, empathy: 95, escalation: 95, readability: 95, greeting: 94, recap: 80 } },
    calls: { csat_pct: 91.5, iqs: 88, volume: 74, params: { pitch_clarity: 98, yield_framing: 100, secondary_liquidity: 87, asset_allocation: 94, payout_timeline: 97, active_listening: 95, demat_linking: 96, tds_compliance: 98, tone_pacing: 94, call_recap: 83 } },
    emails: null,
  },
  {
    name: 'Dhanush',
    ini: 'D',
    tl: 'Gokul',
    chats: { csat_pct: 88.0, iqs: 90, volume: 50, params: { issue_resolution: 91, accuracy: 92, expectation: 91, dissatisfaction: 86, personalization: 91, empathy: 92, escalation: 92, readability: 92, greeting: 91, recap: 76 } },
    calls: { csat_pct: 87.0, iqs: 86, volume: 58, params: { pitch_clarity: 97, yield_framing: 100, secondary_liquidity: 85, asset_allocation: 92, payout_timeline: 95, active_listening: 93, demat_linking: 94, tds_compliance: 97, tone_pacing: 92, call_recap: 81 } },
    emails: null,
  },
  {
    name: 'Samskriti Rao',
    ini: 'SR',
    tl: 'Gokul',
    chats: { csat_pct: 86.5, iqs: 88, volume: 40, params: { issue_resolution: 89, accuracy: 90, expectation: 90, dissatisfaction: 84, personalization: 89, empathy: 90, escalation: 90, readability: 90, greeting: 90, recap: 74 } },
    calls: { csat_pct: 85.0, iqs: 85, volume: 52, params: { pitch_clarity: 96, yield_framing: 100, secondary_liquidity: 84, asset_allocation: 91, payout_timeline: 94, active_listening: 92, demat_linking: 93, tds_compliance: 96, tone_pacing: 92, call_recap: 79 } },
    emails: null,
  },
  {
    name: 'Gaurav Nautiyal',
    ini: 'GN',
    tl: 'Gokul',
    chats: { csat_pct: 84.0, iqs: 86, volume: 35, params: { issue_resolution: 87, accuracy: 88, expectation: 88, dissatisfaction: 82, personalization: 87, empathy: 88, escalation: 88, readability: 88, greeting: 88, recap: 72 } },
    calls: { csat_pct: 83.5, iqs: 83, volume: 44, params: { pitch_clarity: 95, yield_framing: 100, secondary_liquidity: 83, asset_allocation: 90, payout_timeline: 93, active_listening: 91, demat_linking: 92, tds_compliance: 95, tone_pacing: 91, call_recap: 77 } },
    emails: null,
  },
];

const VAISHNAVI_AGENTS: AgentData[] = [
  {
    name: 'Aravind',
    ini: 'AR',
    tl: 'Vaishnavi',
    chats: { csat_pct: 91.0, iqs: 93, volume: 52, params: { issue_resolution: 93, accuracy: 94, expectation: 94, dissatisfaction: 88, personalization: 93, empathy: 94, escalation: 94, readability: 94, greeting: 93, recap: 79 } },
    calls: { csat_pct: 90.0, iqs: 88, volume: 62, params: { pitch_clarity: 98, yield_framing: 100, secondary_liquidity: 87, asset_allocation: 94, payout_timeline: 96, active_listening: 94, demat_linking: 95, tds_compliance: 98, tone_pacing: 94, call_recap: 82 } },
    emails: null,
  },
  {
    name: 'Sujal Dadwani',
    ini: 'SD',
    tl: 'Vaishnavi',
    chats: { csat_pct: 87.5, iqs: 90, volume: 48, params: { issue_resolution: 90, accuracy: 92, expectation: 91, dissatisfaction: 85, personalization: 90, empathy: 91, escalation: 91, readability: 92, greeting: 90, recap: 76 } },
    calls: { csat_pct: 86.5, iqs: 86, volume: 56, params: { pitch_clarity: 97, yield_framing: 100, secondary_liquidity: 85, asset_allocation: 92, payout_timeline: 95, active_listening: 93, demat_linking: 94, tds_compliance: 97, tone_pacing: 93, call_recap: 80 } },
    emails: null,
  },
  {
    name: 'Antara Chakrabarty',
    ini: 'AC',
    tl: 'Vaishnavi',
    chats: { csat_pct: 85.0, iqs: 88, volume: 44, params: { issue_resolution: 88, accuracy: 90, expectation: 89, dissatisfaction: 83, personalization: 88, empathy: 90, escalation: 89, readability: 90, greeting: 89, recap: 74 } },
    calls: { csat_pct: 84.5, iqs: 84, volume: 50, params: { pitch_clarity: 96, yield_framing: 100, secondary_liquidity: 84, asset_allocation: 91, payout_timeline: 94, active_listening: 92, demat_linking: 93, tds_compliance: 96, tone_pacing: 92, call_recap: 78 } },
    emails: null,
  },
  {
    name: 'Swati Singh',
    ini: 'SS',
    tl: 'Vaishnavi',
    chats: { csat_pct: 84.5, iqs: 87, volume: 46, params: { issue_resolution: 87, accuracy: 89, expectation: 88, dissatisfaction: 82, personalization: 87, empathy: 89, escalation: 88, readability: 89, greeting: 88, recap: 73 } },
    calls: { csat_pct: 84.0, iqs: 84, volume: 56, params: { pitch_clarity: 95, yield_framing: 100, secondary_liquidity: 83, asset_allocation: 90, payout_timeline: 93, active_listening: 91, demat_linking: 92, tds_compliance: 95, tone_pacing: 91, call_recap: 77 } },
    emails: null,
  },
];

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
  { key: 'pitch_clarity', label: 'Pitch Clarity & Senior Secured Debt Backing', weight: 25, team_score: 97, cx_score: 95 },
  { key: 'yield_framing', label: 'Indicative Yield Framing & Disclaimers', weight: 20, team_score: 100, cx_score: 98 },
  { key: 'secondary_liquidity', label: 'Secondary Liquidity Window Framing', weight: 20, team_score: 87, cx_score: 88 },
  { key: 'asset_allocation', label: 'Asset Allocation Need Discovery', weight: 10, team_score: 94, cx_score: 90 },
  { key: 'payout_timeline', label: 'Monthly Interest Payout Timeline Clarity', weight: 10, team_score: 96, cx_score: 92 },
  { key: 'active_listening', label: 'Active Listening & Objection Handling', weight: 5, team_score: 95, cx_score: 90 },
  { key: 'demat_linking', label: 'Demat Linking & Account Verification', weight: 5, team_score: 96, cx_score: 94 },
  { key: 'tds_compliance', label: 'TDS & Form 15G Compliance', weight: 3, team_score: 98, cx_score: 96 },
  { key: 'tone_pacing', label: 'Greeting, Pacing & Handover', weight: 2, team_score: 94, cx_score: 93 },
  { key: 'call_recap', label: 'Post-Call Recap & Follow-Through', weight: 5, team_score: 81, cx_score: 78 },
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
  cxLabel = 'CX',
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
            title={`Dept avg ${cx}%`}
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
      <td style={numTd(false)}>{chData ? fmtPct(chData.csat_pct) : '—'}</td>
      <td style={numTd(false)}>{chData ? fmtIqs(chData.iqs) : '—'}</td>
      <td style={numTd(activeChannel === 'chats')}>{fmtVol(agent.chats.volume)}</td>
      <td style={numTd(activeChannel === 'calls')}>{fmtVol(agent.calls.volume)}</td>
      <td style={numTd(activeChannel === 'emails')}>—</td>
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
}: PcgTeamAnalyticsProps) {
  const [channel, setChannel] = useState<Channel>('chats');
  const [period, setPeriod] = useState<Period>('30');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [showPicker, setShowPicker] = useState(false);
  const [activeTab, setActiveTab] = useState<'summary' | 'breakdown'>('summary');
  const [breakdownCh, setBreakdownCh] = useState<Channel>('chats');

  // Viewing TL state: default to 'Harsh' (or passed selectedTl)
  const [currentTL, setCurrentTL] = useState<string>(selectedTl || 'Harsh');
  const [showTLDrop, setShowTLDrop] = useState<boolean>(false);
  const tlDropRef = useRef<HTMLDivElement>(null);

  const availableTLs = ['Harsh', 'Gokul', 'Vaishnavi'];

  useEffect(() => {
    if (selectedTl && availableTLs.includes(selectedTl)) {
      setCurrentTL(selectedTl);
    }
  }, [selectedTl]);

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
    setCurrentTL(tl);
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

  // Active agents based on selected TL
  const getActiveAgents = (): AgentData[] => {
    if (currentTL === 'Gokul') return GOKUL_AGENTS;
    if (currentTL === 'Vaishnavi') return VAISHNAVI_AGENTS;
    return HARSH_AGENTS;
  };

  const activeAgents = getActiveAgents();

  // Active channel parameters
  const params = channel === 'calls' ? CALL_PARAMS : CHAT_PARAMS;
  const breakdownParams = breakdownCh === 'calls' ? CALL_PARAMS : CHAT_PARAMS;

  // Stat Card Metrics dynamically tailored to team and channel
  const getStatMetrics = () => {
    if (currentTL === 'Gokul') {
      return {
        csatTeam: '89.2%',
        csatCx: '87.4%',
        iqsTeam: '86.8%',
        iqsCx: '85.0%',
        volumeTeam: channel === 'calls' ? '296' : '230',
        volumeCx: channel === 'calls' ? '520' : '420',
      };
    } else if (currentTL === 'Vaishnavi') {
      return {
        csatTeam: '87.0%',
        csatCx: '87.4%',
        iqsTeam: '85.1%',
        iqsCx: '85.0%',
        volumeTeam: channel === 'calls' ? '224' : '190',
        volumeCx: channel === 'calls' ? '520' : '420',
      };
    } else {
      // Harsh
      if (channel === 'chats') {
        return {
          csatTeam: '84.9%',
          csatCx: '81.1%',
          iqsTeam: '94%',
          iqsCx: '93%',
          volumeTeam: '532',
          volumeCx: '10,540',
        };
      } else {
        return {
          csatTeam: '89.2%',
          csatCx: '85.4%',
          iqsTeam: '94%',
          iqsCx: '91%',
          volumeTeam: '387',
          volumeCx: '8,420',
        };
      }
    }
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
          [0, 1, 2].map((i) => (
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
                {['CSAT %', 'IQS', 'Emails Handled'][i]}
              </div>
              <span style={{ fontSize: 20, color: 'var(--qa-text-4, #d4d4d8)' }}>—</span>
            </div>
          ))
        ) : (
          <>
            <StatCard label="CSAT %" teamValue={metrics.csatTeam} cxValue={metrics.csatCx} cxLabel="CX" />
            <StatCard label="IQS" teamValue={metrics.iqsTeam} cxValue={metrics.iqsCx} cxLabel="CX" />
            <StatCard
              label={`${CHANNEL_LABELS[channel].toUpperCase()} HANDLED`}
              teamValue={metrics.volumeTeam}
              cxValue={metrics.volumeCx}
              cxLabel="CX"
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
            {periodLabel} · avg across all evaluated {CHANNEL_LABELS[channel].toLowerCase()}
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
              Dept average
            </span>
          </div>

          <div style={{ padding: '12px 20px' }}>
            {channel === 'emails' ? (
              <EmptyChannelState channel="emails" />
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
                    <Th>CSAT %</Th>
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
                  <EmptyChannelState channel="emails" />
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
        CSAT % = good ratings / all rated · IQS = avg internal quality score · Parameter scores = pass rate
      </p>
    </div>
  );
}
