'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import DateRangePicker from '@/components/quality/DateRangePicker';
import { isSamePcgAgent, canonicalizePcgRmName } from '@/lib/pcg/canonical-names';

export type Period = '7' | '30' | 'custom';

export const TL_TEAMS: Record<string, string[]> = {};
export const ALL_PCG_AGENTS: string[] = [];

export interface PcgMemberAnalyticsProps {
  selectedRm: string;
  onSelectRm: (rm: string) => void;
  availableRms: string[];
  allTlNames?: string[];
  calls?: Array<{
    id: string;
    rmName: string;
    iqsScore: number | null;
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
    parameterScores?: Record<string, number>;
  }>;
  teamLeads?: Array<{
    tlName: string;
    teamSize?: number;
    rms: string[];
  }>;
  tlName?: string;
  dateRange?: '7d' | '30d' | 'custom';
  onDateRangeChange?: (range: '7d' | '30d' | 'custom', customStart?: string, customEnd?: string) => void;
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
  allTlNames = [],
  calls = [],
  activePersona = 'tl',
  rmScorecards = [],
  teamLeads = [],
  tlName = '',
  dateRange,
  onDateRangeChange,
}: PcgMemberAnalyticsProps) {
  const [period, setPeriod] = useState<Period>(() => {
    if (dateRange === '30d') return '30';
    if (dateRange === 'custom') return 'custom';
    return '7';
  });
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [showPicker, setShowPicker] = useState(false);
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [agentSearch, setAgentSearch] = useState('');

  // Sync internal period with external dateRange prop when it changes
  useEffect(() => {
    if (dateRange === '30d') setPeriod('30');
    else if (dateRange === 'custom') setPeriod('custom');
    else if (dateRange === '7d') setPeriod('7');
  }, [dateRange]);

  const [wowTab, setWowTab] = useState<'metrics' | 'params'>('metrics');
  const [wowChannel, setWowChannel] = useState<'chats' | 'calls'>('calls');
  const [wowCategory, setWowCategory] = useState<'all' | '13_pitching' | 'upselling' | 'support'>('all');

  const effectiveRm = useMemo(() => {
    if (
      selectedRm &&
      (availableRms.some((r) => isSamePcgAgent(r, selectedRm)) ||
        (allTlNames && allTlNames.some((tl) => isSamePcgAgent(tl, selectedRm))))
    ) {
      return selectedRm;
    }
    return availableRms[0] || selectedRm || '';
  }, [selectedRm, availableRms, allTlNames]);

  useEffect(() => {
    if (effectiveRm) {
      setAgentSearch(effectiveRm);
    }
  }, [effectiveRm]);

  const isCurrentTl = useMemo(() => {
    return (
      (allTlNames && allTlNames.some((tl) => isSamePcgAgent(tl, effectiveRm))) ||
      (teamLeads && teamLeads.some((tl) => isSamePcgAgent(tl.tlName, effectiveRm))) ||
      ['swetha', 'saiyam', 'dheeraj', 'sravanthi', 'tanisha'].some((tl) =>
        effectiveRm.toLowerCase().includes(tl)
      )
    );
  }, [allTlNames, teamLeads, effectiveRm]);

  const allSelectableMembers = useMemo(() => {
    const list: Array<{ name: string; isTl: boolean; teamName: string }> = [];
    const seen = new Set<string>();

    // 1. Team Leads (for Admin view, or if allTlNames is passed)
    if (activePersona === 'admin') {
      const knownTls = (allTlNames && allTlNames.length > 0)
        ? allTlNames
        : (teamLeads && teamLeads.length > 0 ? teamLeads.map(t => t.tlName) : ['Swetha', 'Saiyam Rastogi', 'Tanisha Mittal', 'Dheeraj Bhojwani', 'Sravanthi']);

      knownTls.forEach((tl) => {
        const lower = tl.toLowerCase().trim();
        if (!seen.has(lower)) {
          seen.add(lower);
          list.push({ name: tl, isTl: true, teamName: 'Team Lead' });
        }
      });
    }

    // 2. Relationship Managers
    availableRms.forEach((rm) => {
      const lower = rm.toLowerCase().trim();
      if (!seen.has(lower)) {
        seen.add(lower);
        const isTl = (allTlNames && allTlNames.some((tl) => isSamePcgAgent(tl, rm))) ||
          (teamLeads && teamLeads.some((tl) => isSamePcgAgent(tl.tlName, rm)));
        const foundTl = teamLeads.find((t) => (t.rms || []).some((r: string) => isSamePcgAgent(r, rm)));
        list.push({
          name: rm,
          isTl,
          teamName: isTl ? 'Team Lead' : (foundTl ? `Team ${foundTl.tlName}` : 'PCG RM'),
        });
      }
    });

    return list;
  }, [activePersona, allTlNames, teamLeads, availableRms]);



  const handlePeriod = (p: Period) => {
    if (p === 'custom') {
      setShowPicker(true);
    } else {
      setPeriod(p);
      setShowPicker(false);
      if (onDateRangeChange) {
        onDateRangeChange(p === '30' ? '30d' : '7d');
      }
    }
  };

  const handleCustomApply = (from: string, to: string) => {
    setCustomFrom(from);
    setCustomTo(to);
    setPeriod('custom');
    setShowPicker(false);
    if (onDateRangeChange) {
      onDateRangeChange('custom', from, to);
    }
  };

  // Derive call analytics for this RM
  const rmScorecard = rmScorecards.find(s => isSamePcgAgent(s.rmName, effectiveRm));
  const rmCalls = calls.filter(c => isSamePcgAgent(c.rmName, effectiveRm));
  const rmAnswered = rmCalls.filter(c => c.isAnswered && c.iqsScore != null);
  const rmAvgIqs = rmScorecard?.overallScore ?? (rmAnswered.length > 0
    ? Math.round(rmAnswered.reduce((acc, c) => acc + (c.iqsScore ?? 0), 0) / rmAnswered.length)
    : 0);
  const callsVol = rmScorecard?.totalCalls ?? rmCalls.length;
  const callsIqs = rmAvgIqs;

  // Fetch PCG chat evaluations for this RM
  const [chats, setChats] = useState<any[]>([]);
  const [loadingChats, setLoadingChats] = useState(false);

  useEffect(() => {
    if (!effectiveRm) return;
    setLoadingChats(true);
    const params = new URLSearchParams();
    params.set('rm', effectiveRm);
    params.set('limit', '500');
    if (isCurrentTl) {
      params.set('caller_role', 'tl');
    }
    if (activePersona) params.set('persona', activePersona);
    if (tlName && activePersona !== 'admin') params.set('tl', tlName);

    fetch(`/api/admin/pcg-chats?${params.toString()}`)
      .then(res => res.json())
      .then(data => {
        setChats(Array.isArray(data.chats) ? data.chats : []);
      })
      .catch(err => {
        console.error('[PcgMemberAnalyticsDashboard] Failed to fetch chats:', err);
      })
      .finally(() => {
        setLoadingChats(false);
      });
  }, [effectiveRm, activePersona, tlName, isCurrentTl]);

  const filteredChats = useMemo(() => {
    if (!chats || chats.length === 0) return [];
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

    const res = chats.filter(c => {
      if (!c.chatClosedAt) return true;
      const d = new Date(c.chatClosedAt);
      if (minDate && d < minDate) return false;
      if (maxDate && d > maxDate) return false;
      return true;
    });

    if (res.length === 0 && chats.length > 0 && period !== 'custom') {
      return chats;
    }

    return res;
  }, [chats, period, customFrom, customTo]);

  const chatCount = filteredChats.length;
  const validIqsChats = filteredChats.filter(c => c.iqsScore != null);
  const chatAvgIqs = validIqsChats.length > 0
    ? Math.round((validIqsChats.reduce((acc, c) => acc + (c.iqsScore || 0), 0) / validIqsChats.length) * 10) / 10
    : null;

  // Derive chat parameter scores mapped to the 11 PCG quality parameters
  const getChatParamScore = useCallback((callParamKey: string): number | null => {
    if (filteredChats.length === 0) return null;

    const paramMapping: Record<string, string[]> = {
      CallOpening: ['GreetingClosing'],
      CallClosing: ['GreetingClosing', 'PostCallRecap'],
      TechnicalLegal: ['Accuracy'],
      AllQuestions: ['QueryResolution'],
      Expectation: ['ExpectationFollowThrough'],
      Process: ['Personalisation', 'EscalationToCall', 'PostCallRecap'],
      Grammar: ['ReadabilityTone'],
      Fillers: [],
      EnergyTone: ['ReadabilityTone'],
      ActiveListening: ['Empathy', 'DissatisfactionHandling'],
      Simplifying: ['SimplifyingConcepts'],
    };

    const chatKeys = paramMapping[callParamKey] || [];
    if (chatKeys.length === 0) return null;

    let earnedTotal = 0;
    let maxTotal = 0;

    filteredChats.forEach(chat => {
      let params = chat.parameters;
      if (typeof params === 'string') {
        try { params = JSON.parse(params); } catch { }
      }
      if (!params || typeof params !== 'object') return;

      chatKeys.forEach(ck => {
        const p = Array.isArray(params) ? params.find((x: any) => x.id === ck) : params[ck];
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
    return Math.round((earnedTotal / maxTotal) * 1000) / 10;
  }, [filteredChats]);

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

  // Derive live parameter scores from rmScorecard (computed across all calls) or fallback to rmAnswered calls
  const callParamAverages: Record<string, number> = useMemo(() => {
    if (rmScorecard?.parameterScores && Object.keys(rmScorecard.parameterScores).length > 0) {
      return rmScorecard.parameterScores;
    }
    const averages: Record<string, number> = {};
    if (rmAnswered.length > 0) {
      const paramEarned: Record<string, number> = {};
      const paramMax: Record<string, number> = {};
      rmAnswered.forEach(c => {
        if (Array.isArray((c as any).parameters)) {
          (c as any).parameters.forEach((p: any) => {
            // Exclude NA parameters so they do not count as 0% failures
            if (p.id && p.status !== 'NA' && p.status !== 'N/A' && p.isApplicable !== false) {
              paramEarned[p.id] = (paramEarned[p.id] || 0) + (p.earnedScore ?? 0);
              paramMax[p.id] = (paramMax[p.id] || 0) + (p.maxScore ?? 0);
            }
          });
        }
      });
      Object.keys(paramMax).forEach(k => {
        if (paramMax[k] > 0) {
          averages[k] = Math.round((paramEarned[k] / paramMax[k]) * 1000) / 10;
        }
      });
    }
    return averages;
  }, [rmAnswered, rmScorecard]);

  const getAgentParamScore = (rm: string, key: string, fallbackBase: number) => {
    const scores = (rmScorecard?.parameterScores && Object.keys(rmScorecard.parameterScores).length > 0)
      ? rmScorecard.parameterScores
      : callParamAverages;

    if (scores[key] !== undefined) {
      return scores[key];
    }
    if (key === 'TechnicalLegal' && scores['TechnicallyLegal'] !== undefined) return scores['TechnicallyLegal'];
    if (key === 'TechnicallyLegal' && scores['TechnicalLegal'] !== undefined) return scores['TechnicalLegal'];
    if (key === 'Grammar' && scores['VocabularyGrammar'] !== undefined) return scores['VocabularyGrammar'];
    if (key === 'VocabularyGrammar' && scores['Grammar'] !== undefined) return scores['Grammar'];
    if (key === 'Fillers' && scores['FillersDeadAir'] !== undefined) return scores['FillersDeadAir'];
    if (key === 'FillersDeadAir' && scores['Fillers'] !== undefined) return scores['Fillers'];
    return null;
  };

  const wowWeeks = ['2026-09-21', '2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19'];
  const wowWeekLabels = ['SEP 21 – 27', 'SEP 28 – OCT 4', 'OCT 5 – 11', 'OCT 12 – 18', 'OCT 19 – 25'];

  const wowMetrics = useMemo(() => {
    if (wowChannel === 'chats') {
      const iqsVals = wowWeeks.map(ws => {
        const start = new Date(ws + 'T00:00:00Z').getTime();
        const end = start + 7 * 86400000;
        const weekChats = chats.filter(c => {
          if (!c.chatClosedAt) return false;
          const t = new Date(c.chatClosedAt).getTime();
          return t >= start && t < end && c.iqsScore != null;
        });
        if (weekChats.length === 0) return null;
        return Math.round((weekChats.reduce((acc, c) => acc + (c.iqsScore || 0), 0) / weekChats.length) * 10) / 10;
      });

      const volVals = wowWeeks.map(ws => {
        const start = new Date(ws + 'T00:00:00Z').getTime();
        const end = start + 7 * 86400000;
        const weekChats = chats.filter(c => {
          if (!c.chatClosedAt) return false;
          const t = new Date(c.chatClosedAt).getTime();
          return t >= start && t < end;
        });
        return weekChats.length > 0 ? weekChats.length : null;
      });

      const hasAnyVal = volVals.some(v => v !== null && v > 0);
      if (!hasAnyVal && chatCount > 0) {
        return [
          { name: 'IQS', vals: [null, null, null, null, chatAvgIqs] as (number | null)[], isPct: true },
          { name: 'Volume', vals: [null, null, null, null, chatCount] as (number | null)[], isPct: false },
        ];
      }

      return [
        { name: 'IQS', vals: iqsVals, isPct: true },
        { name: 'Volume', vals: volVals, isPct: false },
      ];
    }

    if (callsVol === 0 || callsIqs === 0) {
      return [
        { name: 'IQS', vals: [null, null, null, null, null] as (number | null)[], isPct: true },
        { name: 'Volume', vals: [null, null, null, null, null] as (number | null)[], isPct: false },
      ];
    }
    return [
      { name: 'IQS', vals: [null, null, null, null, callsIqs] as (number | null)[], isPct: true },
      { name: 'Volume', vals: [null, null, null, null, callsVol] as (number | null)[], isPct: false },
    ];
  }, [wowChannel, chats, chatCount, chatAvgIqs, callsVol, callsIqs, wowWeeks]);

  const wowParameters: Array<{ name: string; vals: (number | null)[] }> = useMemo(() => {
    if (wowChannel === 'chats') {
      const CHAT_PARAMS = [
        { key: 'TechnicalLegal', label: 'Technically / Legally Correct' },
        { key: 'AllQuestions', label: 'All Questions / Query Resolution' },
        { key: 'Expectation', label: 'Expectation & Follow-Through' },
        { key: 'ActiveListening', label: 'Empathy & Dissatisfaction' },
        { key: 'Simplifying', label: 'Simplifying Concepts' },
        { key: 'Grammar', label: 'Readability & Professional Tone' },
        { key: 'CallOpening', label: 'Greeting & Closing' },
      ];

      return CHAT_PARAMS.map(p => {
        const currentScore = getChatParamScore(p.key);
        return {
          name: p.label,
          vals: [null, null, null, null, currentScore] as (number | null)[],
        };
      });
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
  }, [wowChannel, wowCategory, getChatParamScore]);

  const periodLabel = period === 'custom' && customFrom && customTo
    ? `${customFrom} – ${customTo}`
    : PERIOD_LABELS[period];

  const scoredParams = useMemo(() => {
    return PCG_PARAMETERS.map(p => {
      const s = getAgentParamScore(effectiveRm, p.key, p.deptScore);
      return { ...p, score: s };
    }).filter((p): p is typeof PCG_PARAMETERS[0] & { score: number } => p.score !== null);
  }, [effectiveRm, getAgentParamScore]);

  return (
    <div style={{ padding: '0 0 64px', maxWidth: 1100, margin: '0 auto', fontFamily: 'inherit' }}>
      {/* ── Page Header: Member Analytics + Viewing Dropdown + Period Switcher ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, gap: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <h1 style={{ fontSize: 24, fontWeight: 600, margin: 0, color: 'var(--qa-text, #111111)' }}>
            {activePersona === 'agent' ? 'My Analytics' : 'Member Analytics'}
          </h1>

          {/* Member Search Bar (Replaces Dropdown Toggle) */}
          {activePersona !== 'agent' ? (
            <div style={{ position: 'relative', width: 340 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  background: 'var(--qa-card, #ffffff)',
                  border: isSearchFocused ? '1px solid #10b981' : '1px solid var(--qa-border, #E4E4E7)',
                  borderRadius: 8,
                  padding: '0 10px',
                  height: 36,
                  gap: 8,
                  boxShadow: isSearchFocused ? '0 0 0 2px rgba(16, 185, 129, 0.15)' : '0 1px 2px rgba(0,0,0,0.03)',
                  transition: 'all 0.15s ease',
                }}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ color: 'var(--qa-text-3, #A1A1AA)', flexShrink: 0 }}
                >
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <input
                  type="text"
                  value={agentSearch}
                  onFocus={() => setIsSearchFocused(true)}
                  onBlur={() => {
                    setIsSearchFocused(false);
                    const s = agentSearch.trim().toLowerCase();
                    if (s) {
                      const match = allSelectableMembers.find(
                        (m) => m.name.toLowerCase() === s || isSamePcgAgent(m.name, s) || m.name.toLowerCase().includes(s)
                      );
                      if (match) {
                        onSelectRm(match.name);
                        setAgentSearch(match.name);
                      }
                    }
                  }}
                  onChange={(e) => {
                    const val = e.target.value;
                    setAgentSearch(val);
                    const s = val.trim().toLowerCase();
                    if (s) {
                      const exact = allSelectableMembers.find(
                        (m) => m.name.toLowerCase() === s || isSamePcgAgent(m.name, s)
                      );
                      if (exact) {
                        onSelectRm(exact.name);
                      }
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      const s = agentSearch.trim().toLowerCase();
                      const match = allSelectableMembers.find(
                        (m) => m.name.toLowerCase() === s || isSamePcgAgent(m.name, s) || m.name.toLowerCase().includes(s)
                      );
                      if (match) {
                        onSelectRm(match.name);
                        setAgentSearch(match.name);
                      }
                    }
                  }}
                  placeholder={activePersona === 'admin' ? 'Search RM or TL name...' : 'Search team member...'}
                  style={{
                    border: 'none',
                    outline: 'none',
                    background: 'transparent',
                    fontSize: 13,
                    fontWeight: 500,
                    color: 'var(--qa-text, #111111)',
                    width: '100%',
                    fontFamily: 'inherit',
                  }}
                />
                {agentSearch && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setAgentSearch('');
                    }}
                    style={{
                      border: 'none',
                      background: 'transparent',
                      color: 'var(--qa-text-3, #A1A1AA)',
                      cursor: 'pointer',
                      padding: 2,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 12,
                      lineHeight: 1,
                    }}
                    title="Clear search"
                  >
                    ✕
                  </button>
                )}
                {/* Role indicator badge */}
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    padding: '2px 6px',
                    borderRadius: 4,
                    background: isCurrentTl ? '#FEF3C7' : 'var(--qa-fill-light, #F4F4F5)',
                    color: isCurrentTl ? '#92400E' : 'var(--qa-text-2, #52525B)',
                    border: isCurrentTl ? '1px solid #FDE68A' : '1px solid var(--qa-border, #E4E4E7)',
                    whiteSpace: 'nowrap',
                    flexShrink: 0,
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                  }}
                >
                  {isCurrentTl ? 'Team Lead' : 'RM'}
                </span>
              </div>
            </div>
          ) : null}
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

        {/* Chats Card (Live PCG Chats Data) */}
        <div style={{ background: 'var(--qa-card, #ffffff)', border: '1px solid var(--qa-border, #E4E4E7)', borderRadius: 8, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--qa-text-3, #A1A1AA)', marginBottom: 14, fontWeight: 600 }}>
            CHATS
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 0 }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', paddingRight: 24, lineHeight: 1.1 }}>
              <span style={{ fontSize: 24, fontWeight: 700, lineHeight: 1, color: chatAvgIqs != null ? 'var(--qa-text, #111111)' : 'var(--qa-text-4, #C7C7CC)' }}>
                {chatAvgIqs != null ? `${chatAvgIqs.toFixed(1)}%` : '—'}
              </span>
              <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--qa-text-3, #A1A1AA)', marginTop: 6 }}>IQS</span>
            </div>
            <div style={{ width: 1, height: 32, background: 'var(--qa-border, #E4E4E7)', alignSelf: 'center' }} />
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', paddingLeft: 24, lineHeight: 1.1 }}>
              <span style={{ fontSize: 24, fontWeight: 700, lineHeight: 1, color: chatCount > 0 ? 'var(--qa-text, #111111)' : 'var(--qa-text-4, #C7C7CC)' }}>
                {chatCount}
              </span>
              <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--qa-text-3, #A1A1AA)', marginTop: 6 }}>VOLUME</span>
            </div>
          </div>
          {chatCount === 0 && (
            <div style={{ fontSize: 12, color: 'var(--qa-text-3, #A1A1AA)', marginTop: 8, fontStyle: 'italic' }}>
              No evaluated chats
            </div>
          )}
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
            {periodLabel} · 11 quality parameters evaluated for {effectiveRm}
          </span>
        </div>
        <Panel>
          <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--qa-border, #E4E4E7)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--qa-text, #111111)' }}>
              11 quality parameters · evaluated across calls & chats
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
                  const chatScore = getChatParamScore(param.key);
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
                      <td
                        style={{
                          padding: '0 16px',
                          borderBottom: '1px solid var(--qa-border-sub, #F0F0F2)',
                          textAlign: 'right',
                          fontFamily: chatScore !== null ? 'monospace' : 'inherit',
                          fontSize: 13,
                          color: chatScore !== null ? 'var(--qa-text, #111111)' : 'var(--qa-text-4, #C7C7CC)',
                        }}
                      >
                        {chatScore !== null ? fmtPct(chatScore) : '—'}
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
    </div>
  );
}
