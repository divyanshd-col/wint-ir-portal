'use client';

import React, { useEffect, useState, useRef, useMemo } from 'react';
import Link from 'next/link';
import { useSession, signOut } from 'next-auth/react';
import { IQSRing, IQSPill } from '@/components/quality/IQSRing';
import { iqsTheme } from '@/lib/quality';
import PcgScorecardView from './PcgScorecardView';
import PcgMemberAnalyticsDashboard from './PcgMemberAnalyticsDashboard';
import PcgTeamAnalyticsDashboard from './PcgTeamAnalyticsDashboard';
import PcgRmPerformanceDashboard from './PcgRmPerformanceDashboard';
import WorkspaceSwitcher from '@/components/WorkspaceSwitcher';
import CallEvalPanel from '@/components/quality/CallEvalPanel';
import { ThemeToggle, AccountMenu } from '@/components/shell/TopBar';
import { isSamePcgAgent } from '@/lib/pcg/canonical-names';

// Type definitions
interface CallParameter {
  id: string;
  name: string;
  maxScore: number;
  earnedScore: number;
  status: 'Yes' | 'Half' | 'No' | 'NA';
  quote: string;
  explanation?: string;
  reasoning?: string;
  num?: number;
}

interface TranscriptTurn {
  speaker: 'RM' | 'Customer';
  text: string;
  time: string;
  segment?: string;
  isPivotTurn?: boolean;
}

interface PCGCall {
  id: string;
  callId: string;
  chatId?: string | null;
  clientName?: string;
  rmName: string;
  tlName: string;
  phoneNumber: string;
  callType: string;
  tag: string | null;
  durationSeconds: number;
  startTime: string | null;
  isAnswered: boolean;
  hasRecording: boolean;
  category: string;
  categoryKey: '13_pitching' | 'upselling' | 'support';
  secondaryCategories?: string[];
  allCategories?: string[];
  aiCategoryReasoning?: string | null;
  iqsScore: number;
  gates: { status: 'PASS' | 'FAIL'; reason?: string; [key: string]: any };
  needsAttention: boolean;
  unansweredBy: 'Customer' | 'RM' | null;
  unansweredReason: string | null;
  parameters: CallParameter[];
  aiCoachingTip: string | null;
  transcriptTurns: TranscriptTurn[];
  disputeStatus: 'none' | 'pending' | 'resolved' | 'overridden';
  disputeReason?: string;
  tlOverrideNote?: string;
}

interface RmScorecard {
  rmName: string;
  totalCalls: number;
  connectRate: number;
  pitchScore: number;
  upsellScore: number;
  supportScore: number;
  overallScore: number;
  trend: 'improving' | 'declining' | 'stable';
  complianceFlags: number;
  topWeakness: string;
  prev2WkIqs?: number;
  delta2Wk?: number;
  parameterScores?: Record<string, number>;
}

interface TeamLeadSummary {
  tlName: string;
  teamSize: number;
  totalCalls: number;
  connectRate: number;
  avgScore: number;
  callsUnder85: number;
  rms: string[];
}

export type PcgTab = 'calls' | 'team_analytics' | 'rm_performance' | 'member_analytics' | 'scorecard' | 'disputes';

export const getRunoCallUrl = (callId: string | null | undefined) => {
  if (!callId) return 'https://app-call.runo.in';
  return `https://app-call.runo.in/#call/${encodeURIComponent(callId)}`;
};

export const formatCallId = (callId: string | null | undefined, fallbackId: string) => {
  if (!callId) return fallbackId;
  return callId.startsWith('runo-') ? callId.replace('runo-', '') : callId.slice(-6);
};

export const formatCallIqsScores = (call: PCGCall) => {
  const scores: Record<string, string> = {
    CallOpening: 'Yes',
    CallClosing: 'Yes',
    TechnicalLegal: 'Yes',
    AllQuestions: 'Yes',
    Expectation: 'Yes',
    Process: 'Yes',
    Grammar: 'Yes',
    Fillers: 'Yes',
    EnergyTone: 'Yes',
    ActiveListening: 'Yes',
    Simplifying: 'Yes',
  };
  const evidence: Record<string, string> = {};

  if (Array.isArray(call.parameters) && call.parameters.length > 0) {
    call.parameters.forEach((p, idx) => {
      const pKey = p.id || `P${idx + 1}`;
      const status = p.status || 'Yes';
      const quote = (p as any).explanation || (p as any).reasoning || p.quote || '';

      scores[pKey] = status;
      if (quote) evidence[pKey] = quote;

      // Map canonical parameter aliases so CallEvalPanel displays the real evaluation quote
      if (pKey === 'TechnicallyLegal' || pKey === 'TechnicalLegal' || p.num === 3 || p.name?.includes('Technically')) {
        scores['TechnicalLegal'] = status;
        scores['TechnicallyLegal'] = status;
        scores['P3'] = status;
        if (quote) {
          evidence['TechnicalLegal'] = quote;
          evidence['TechnicallyLegal'] = quote;
          evidence['P3'] = quote;
        }
      } else if (pKey === 'CallOpening' || p.num === 1) {
        scores['CallOpening'] = status;
        scores['P1'] = status;
        if (quote) evidence['CallOpening'] = quote;
      } else if (pKey === 'CallClosing' || p.num === 2) {
        scores['CallClosing'] = status;
        scores['P2'] = status;
        if (quote) evidence['CallClosing'] = quote;
      } else if (pKey === 'AllQuestions' || p.num === 4) {
        scores['AllQuestions'] = status;
        scores['P4'] = status;
        if (quote) evidence['AllQuestions'] = quote;
      } else if (pKey === 'Expectation' || p.num === 5) {
        scores['Expectation'] = status;
        scores['P5'] = status;
        if (quote) evidence['Expectation'] = quote;
      } else if (pKey === 'Process' || p.num === 6) {
        scores['Process'] = status;
        scores['P6'] = status;
        if (quote) evidence['Process'] = quote;
      } else if (pKey === 'VocabularyGrammar' || pKey === 'Grammar' || p.num === 7) {
        scores['Grammar'] = status;
        scores['VocabularyGrammar'] = status;
        scores['P7'] = status;
        if (quote) evidence['Grammar'] = quote;
      } else if (pKey === 'FillersDeadAir' || pKey === 'Fillers' || p.num === 8) {
        scores['Fillers'] = status;
        scores['FillersDeadAir'] = status;
        scores['P8'] = status;
        if (quote) evidence['Fillers'] = quote;
      } else if (pKey === 'EnergyTone' || p.num === 9) {
        scores['EnergyTone'] = status;
        scores['P9'] = status;
        if (quote) evidence['EnergyTone'] = quote;
      } else if (pKey === 'ActiveListening' || p.num === 10) {
        scores['ActiveListening'] = status;
        scores['P10'] = status;
        if (quote) evidence['ActiveListening'] = quote;
      } else if (pKey === 'Simplifying' || p.num === 11) {
        scores['Simplifying'] = status;
        scores['P11'] = status;
        if (quote) evidence['Simplifying'] = quote;
      }
    });
  }

  return { scores, evidence };
};

export const formatCallSegments = (call: PCGCall) => {
  if (!call.transcriptTurns || call.transcriptTurns.length === 0) return [];
  const segments: any[] = [];
  call.transcriptTurns.forEach((turn, idx) => {
    segments.push({
      speaker: turn.speaker === 'RM' ? 'IR_EXECUTIVE' : 'INVESTOR',
      text: turn.text,
      ts: turn.time || `0:${(idx * 3 + 3).toString().padStart(2, '0')}`,
    });
    if (idx < call.transcriptTurns.length - 1) {
      segments.push({
        type: 'dead_air',
        duration: '~1 seconds'
      });
    }
  });
  return segments;
};

export default function PcgCallsClient() {
  const { data: session } = useSession();
  const userRole = (session?.user as any)?.role || 'admin';
  const isSuperAdmin = Boolean((session?.user as any)?.isSuperAdmin);
  const platformDomain = (session?.user as any)?.platformDomain || 'pcg';
  const loggedInUserName = (session?.user as any)?.name || '';

  // Persona switcher: 'agent' | 'tl' | 'admin'
  const defaultPersona: 'agent' | 'tl' | 'admin' =
    userRole === 'agent' ? 'agent' : userRole === 'tl' ? 'tl' : 'admin';
  const [activePersona, setActivePersona] = useState<'agent' | 'tl' | 'admin'>(defaultPersona);

  // SubTab: 'calls' (calls list & analytics) | 'scorecard' (weekly RM scorecard) | 'disputes' (quality disputes)
  const [activeTab, setActiveTab] = useState<PcgTab>('calls');

  // Selected RM should lock to logged-in user when user is an agent
  const [selectedRm, setSelectedRm] = useState<string>(
    userRole === 'agent' && loggedInUserName ? loggedInUserName : ''
  );

  // Selected TL should lock to logged-in user when user is a TL
  const [selectedTl, setSelectedTl] = useState<string>(
    userRole === 'tl' && loggedInUserName ? loggedInUserName : ''
  );

  useEffect(() => {
    if (userRole === 'agent') {
      setActivePersona('agent');
      if (loggedInUserName) setSelectedRm(loggedInUserName);
    } else if (userRole === 'tl') {
      setActivePersona('tl');
      if (loggedInUserName) setSelectedTl(loggedInUserName);
    } else {
      setActivePersona('admin');
    }
  }, [userRole, loggedInUserName]);

  // When activePersona is admin, remove Call Quality view; for agent and tl, remove admin-only views
  useEffect(() => {
    if (activePersona === 'admin' && (activeTab === 'calls' || activeTab === 'disputes')) {
      handleTabChange('team_analytics');
    } else if ((activePersona === 'agent' || activePersona === 'tl') && (activeTab === 'team_analytics' || activeTab === 'rm_performance')) {
      handleTabChange('calls');
    }
  }, [activePersona, activeTab]);

  // Sync tab with URL search params
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search);
      const tabParam = urlParams.get('tab');
      if (tabParam === 'scorecard' || tabParam === 'disputes' || tabParam === 'calls' || tabParam === 'member_analytics' || tabParam === 'team_analytics' || tabParam === 'rm_performance') {
        if (activePersona === 'admin' && (tabParam === 'calls' || tabParam === 'disputes')) {
          setActiveTab('team_analytics');
        } else if ((activePersona === 'agent' || activePersona === 'tl') && (tabParam === 'team_analytics' || tabParam === 'rm_performance')) {
          setActiveTab('calls');
        } else {
          setActiveTab(tabParam as PcgTab);
        }
      }
    }
  }, [activePersona]);

  const handleTabChange = (newTab: PcgTab) => {
    setActiveTab(newTab);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.set('tab', newTab);
      window.history.pushState({}, '', url.toString());
    }
  };

  // Server state
  const [calls, setCalls] = useState<PCGCall[]>([]);
  const [disputes, setDisputes] = useState<PCGCall[]>([]);
  const [rmScorecards, setRmScorecards] = useState<RmScorecard[]>([]);
  const [teamLeads, setTeamLeads] = useState<TeamLeadSummary[]>([]);
  const [rms, setRms] = useState<{ name: string; count: number }[]>([]);
  const [departmentStats, setDepartmentStats] = useState<any>(null);
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const activeTlName = activePersona === 'tl'
    ? (loggedInUserName || selectedTl)
    : selectedTl;

  const currentTlTeam = useMemo(() => {
    if (!activeTlName) return teamLeads[0] || null;
    return teamLeads.find((t) => t.tlName.toLowerCase() === activeTlName.toLowerCase()) || null;
  }, [teamLeads, activeTlName]);

  const teamRms: string[] = useMemo(() => {
    return currentTlTeam?.rms || [];
  }, [currentTlTeam]);

  // Common filters
  const [selectedCategory, setSelectedCategory] = useState<'all' | '13_pitching' | 'upselling' | 'support' | 'tl_analytics' | 'rm_performance' | 'ai_coaching_insights'>('all');
  const [adminGridRmFilter, setAdminGridRmFilter] = useState<string>('all');
  const [adminBannerTlSelect, setAdminBannerTlSelect] = useState<string>('all');
  const [dateRange, setDateRange] = useState<'7d' | '30d' | 'custom'>('7d');
  const [customStartDate, setCustomStartDate] = useState(() => {
    const d = new Date(Date.now() - 7 * 86400000);
    return d.toISOString().split('T')[0];
  });
  const [customEndDate, setCustomEndDate] = useState(() => {
    return new Date().toISOString().split('T')[0];
  });
  const [adminTlFilter, setAdminTlFilter] = useState<string>('all');
  const [adminRmFilter, setAdminRmFilter] = useState<string>('all');
  const [minIqsFilter, setMinIqsFilter] = useState<string>('');
  const [maxIqsFilter, setMaxIqsFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'answered' | 'unanswered' | 'needs_attention'>('answered');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCallsCount, setTotalCallsCount] = useState(0);

  // Active call view state
  const [activeCallAudit, setActiveCallAudit] = useState<PCGCall | null>(null);
  const [expandedCallId, setExpandedCallId] = useState<string | null>(null);
  const [expandedDisputeId, setExpandedDisputeId] = useState<string | null>(null);

  // Dispute Section Tab: 'raised' | 'reviewed'
  const [disputeTab, setDisputeTab] = useState<'raised' | 'reviewed'>('raised');

  // Inline Agent Dispute state (in drawer below parameters)
  const [isRaisingDispute, setIsRaisingDispute] = useState(false);
  const [disputeSelectedParams, setDisputeSelectedParams] = useState<Record<string, boolean>>({});
  const [disputeParamNotes, setDisputeParamNotes] = useState<Record<string, string>>({});
  const [agentDisputeNote, setAgentDisputeNote] = useState('');
  const [submittingDispute, setSubmittingDispute] = useState(false);
  const [disputeFeedback, setDisputeFeedback] = useState<string | null>(null);

  // Inline TL Override state (in drawer below parameters, matching Calls)
  const [overrideParamId, setOverrideParamId] = useState<string>('P1');
  const [overrideNewScore, setOverrideNewScore] = useState<'Yes' | 'Half' | 'No'>('Yes');
  const [overrideNoteInput, setOverrideNoteInput] = useState('');
  const [savingOverride, setSavingOverride] = useState(false);
  const [overrideFeedback, setOverrideFeedback] = useState<string | null>(null);

  // Audio Playback
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);


  useEffect(() => {
    const handler = setTimeout(() => {
      fetchData();
    }, 250);
    return () => clearTimeout(handler);
  }, [selectedCategory, dateRange, customStartDate, customEndDate, statusFilter, page, selectedTl, selectedRm, adminTlFilter, adminRmFilter, searchQuery, minIqsFilter, maxIqsFilter, activePersona]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({
        page: page.toString(),
        limit: '10',
        category: (selectedCategory === 'tl_analytics' || selectedCategory === 'rm_performance' || selectedCategory === 'ai_coaching_insights') ? 'all' : selectedCategory,
        status: statusFilter,
        date_range: dateRange,
      });
      if (dateRange === 'custom') {
        p.set('date_from', customStartDate);
        p.set('date_to', customEndDate);
      }
      if (activePersona === 'agent' && selectedRm) {
        p.set('rm_name', selectedRm);
      } else if (activePersona === 'tl') {
        const tlQueryName = loggedInUserName || selectedTl;
        if (tlQueryName) p.set('tl_name', tlQueryName);
        if (adminRmFilter !== 'all') p.set('rm_name', adminRmFilter);
      } else if (activePersona === 'admin') {
        if (adminTlFilter !== 'all') p.set('tl_name', adminTlFilter);
        if (adminRmFilter !== 'all') p.set('rm_name', adminRmFilter);
      }
      if (searchQuery.trim()) {
        p.set('search', searchQuery.trim());
      }
      if (minIqsFilter.trim() !== '' && minIqsFilter !== 'all') {
        p.set('min_iqs', minIqsFilter.trim());
      }
      if (maxIqsFilter.trim() !== '' && maxIqsFilter !== 'all') {
        p.set('max_iqs', maxIqsFilter.trim());
      }

      const res = await fetch(`/api/admin/pcg-calls?${p.toString()}`);
      if (!res.ok) throw new Error('Failed to load PCG calls');
      const data = await res.json();
      setCalls(data.calls || []);
      setDisputes(data.disputes || []);
      setRmScorecards(data.rmScorecards || []);
      const leads = data.teamLeads || [];
      setTeamLeads(leads);
      setDepartmentStats(data.departmentStats || null);
      setRms(data.rms || []);
      setSummary(data.summary || null);
      setTotalPages(data.totalPages || 1);
      setTotalCallsCount(data.total || 0);

      // For admin persona, ensure selectedTl locks to defaultTl or first available team lead with zero lag
      if (activePersona === 'admin' && leads.length > 0) {
        setSelectedTl((prev) => {
          if (prev && leads.some((t: any) => t.tlName.toLowerCase() === prev.toLowerCase())) {
            return prev;
          }
          return data.defaultTl || leads[0].tlName;
        });
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  // Open Call View for Any Call
  const handleOpenCallView = (call: PCGCall) => {
    setActiveCallAudit(call);
    setIsRaisingDispute(false);
    setDisputeSelectedParams({});
    setDisputeParamNotes({});
    setAgentDisputeNote('');
    setDisputeFeedback(null);
    setOverrideParamId(call.parameters?.[0]?.id || 'P1');
    setOverrideNewScore('Yes');
    setOverrideNoteInput('');
    setOverrideFeedback(null);
    setIsPlaying(false);
  };

  // Open coaching chat view for a given topic or RM
  const handleOpenCoachingChat = (opts: { rmName?: string; categoryKey?: '13_pitching' | 'upselling' | 'support' }) => {
    setSelectedCategory('all');
    if (opts.rmName) {
      setAdminRmFilter(opts.rmName);
    }
    const match = calls.find(c => {
      const matchRm = !opts.rmName || c.rmName === opts.rmName;
      const matchCat = !opts.categoryKey || c.categoryKey === opts.categoryKey;
      return matchRm && matchCat && (c.aiCoachingTip !== null || c.needsAttention);
    }) || calls.find(c => {
      const matchRm = !opts.rmName || c.rmName === opts.rmName;
      const matchCat = !opts.categoryKey || c.categoryKey === opts.categoryKey;
      return matchRm && matchCat;
    }) || calls[0];

    if (match) {
      handleOpenCallView(match);
    }
  };

  // Action: Agent Raises Dispute Inline
  const handleSubmitDispute = async () => {
    if (!activeCallAudit) return;
    setSubmittingDispute(true);
    const challengedParams = Object.keys(disputeSelectedParams).filter(k => disputeSelectedParams[k]);
    const challengedPrefix = challengedParams.length > 0
      ? `Parameters challenged: ${challengedParams.join(', ')}. `
      : '';
    const reason = (challengedPrefix + (agentDisputeNote || 'Agent requested evaluation review on score.')).trim();

    try {
      await fetch('/api/admin/pcg-calls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'raise_dispute',
          callId: activeCallAudit.id,
          reason,
          challengedParams,
          agentName: activeCallAudit.rmName || selectedRm,
        }),
      });
    } catch (e) {
      console.error('Failed to submit dispute API:', e);
    }

    const updatedCall: PCGCall = {
      ...activeCallAudit,
      disputeStatus: 'pending',
      disputeReason: reason,
    };

    setCalls(prev => prev.map(c => c.id === activeCallAudit.id ? updatedCall : c));
    setDisputes(prev => [updatedCall, ...prev.filter(c => c.id !== updatedCall.id)]);
    setActiveCallAudit(updatedCall);
    setSubmittingDispute(false);
    setIsRaisingDispute(false);
    setDisputeFeedback('Dispute submitted to Team Leader for review.');
    fetchData();
    setTimeout(() => setDisputeFeedback(null), 5000);
  };

  // Action: TL Overrides Score Inline (matching Calls)
  const handleSubmitOverride = async () => {
    if (!activeCallAudit) return;
    setSavingOverride(true);

    const updatedParams = activeCallAudit.parameters.map(p => {
      if (p.id === overrideParamId) {
        const earned = overrideNewScore === 'Yes' ? p.maxScore : overrideNewScore === 'Half' ? Math.round(p.maxScore / 2) : 0;
        return {
          ...p,
          status: overrideNewScore,
          earnedScore: earned,
        };
      }
      return p;
    });

    const totalEarned = updatedParams.reduce((acc, p) => acc + p.earnedScore, 0);
    const totalMax = updatedParams.reduce((acc, p) => acc + p.maxScore, 0) || 100;
    const revisedScore = Math.min(100, Math.round((totalEarned / totalMax) * 100));
    const note = overrideNoteInput || 'TL manual parameter score override.';

    try {
      await fetch('/api/admin/pcg-calls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'override_parameters',
          callId: activeCallAudit.id,
          parameters: updatedParams,
          newScore: revisedScore,
          tlOverrideNote: note,
        }),
      });
    } catch (e) {
      console.error('Failed to submit override API:', e);
    }

    const updatedCall: PCGCall = {
      ...activeCallAudit,
      parameters: updatedParams,
      iqsScore: revisedScore,
      needsAttention: revisedScore < 85,
      disputeStatus: activeCallAudit.disputeStatus === 'pending' ? 'resolved' : 'overridden',
      tlOverrideNote: note,
    };

    setCalls(prev => prev.map(c => c.id === activeCallAudit.id ? updatedCall : c));
    setDisputes(prev => [updatedCall, ...prev.filter(c => c.id !== updatedCall.id)]);
    setActiveCallAudit(updatedCall);
    setSavingOverride(false);
    setOverrideFeedback('Evaluation override submitted successfully.');
    setOverrideNoteInput('');
    fetchData();
    setTimeout(() => setOverrideFeedback(null), 5000);
  };

  // Action: TL Resolves Dispute Inline
  const handleResolveDispute = async (approve: boolean) => {
    if (!activeCallAudit) return;
    const newScore = approve ? Math.min(100, activeCallAudit.iqsScore + 8) : activeCallAudit.iqsScore;
    const note = approve ? 'Dispute approved by TL (+8 pts revised).' : 'Dispute reviewed and retained by TL.';

    try {
      await fetch('/api/admin/pcg-calls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'resolve_dispute',
          callId: activeCallAudit.id,
          status: 'resolved',
          newScore,
          tlOverrideNote: note,
        }),
      });
    } catch (e) {
      console.error('Failed to resolve dispute API:', e);
    }

    const updatedCall: PCGCall = {
      ...activeCallAudit,
      disputeStatus: 'resolved',
      iqsScore: newScore,
      needsAttention: newScore < 85,
      tlOverrideNote: note,
    };

    setCalls(prev => prev.map(c => c.id === activeCallAudit.id ? updatedCall : c));
    setDisputes(prev => [updatedCall, ...prev.filter(c => c.id !== updatedCall.id)]);
    setActiveCallAudit(updatedCall);
    setOverrideFeedback(approve ? 'Dispute approved and score updated.' : 'Dispute resolved (original score maintained).');
    fetchData();
    setTimeout(() => setOverrideFeedback(null), 5000);
  };

  // Action: Handle evaluation override from CallEvalPanel
  const handleOverrideFromPanel = async (
    callId: string,
    overrideData: {
      scores: Record<string, string>;
      reasoning: Record<string, string>;
      note: string;
      iqsScore: number | null;
    }
  ) => {
    const newIqs = overrideData.iqsScore != null ? overrideData.iqsScore : 88;
    const note = overrideData.note || 'TL score override from CallEvalPanel.';

    try {
      await fetch('/api/admin/pcg-calls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'resolve_dispute',
          callId,
          status: 'resolved',
          newScore: newIqs,
          tlOverrideNote: note,
        }),
      });
    } catch (e) {
      console.error('Failed to save panel override API:', e);
    }

    const updatedCalls: PCGCall[] = calls.map(c => {
      if (c.id === callId || c.callId === callId) {
        const updatedParams: CallParameter[] = c.parameters.map(p => {
          const newStatus = overrideData.scores[p.id];
          if (newStatus) {
            const earned = newStatus === 'Yes' ? p.maxScore : newStatus === 'Half' ? Math.round(p.maxScore / 2) : 0;
            const validStatus: 'Yes' | 'Half' | 'No' = newStatus === 'Half' ? 'Half' : newStatus === 'No' ? 'No' : 'Yes';
            return {
              ...p,
              status: validStatus,
              earnedScore: earned,
              quote: overrideData.reasoning[p.id] || p.explanation || p.quote,
              explanation: overrideData.reasoning[p.id] || p.explanation || p.quote,
              reasoning: overrideData.reasoning[p.id] || p.reasoning || p.quote,
            };
          }
          return p;
        });

        const updatedCall: PCGCall = {
          ...c,
          iqsScore: newIqs,
          needsAttention: newIqs < 85,
          parameters: updatedParams,
          tlOverrideNote: note,
          disputeStatus: c.disputeStatus === 'pending' ? 'resolved' : 'overridden',
        };
        return updatedCall;
      }
      return c;
    });

    setCalls(updatedCalls);
    if (activeCallAudit && (activeCallAudit.id === callId || activeCallAudit.callId === callId)) {
      const updated = updatedCalls.find(c => c.id === callId || c.callId === callId);
      if (updated) setActiveCallAudit(updated);
    }
    fetchData();
  };

  // Open Call View by ID (used by RM Scorecard evidence links)
  const handleOpenCallById = (cid: string) => {
    const cleanId = cid.replace('#', '').trim();
    const found = calls.find(
      (c) => c.id === cleanId || c.callId === cleanId || c.id.includes(cleanId) || c.callId.includes(cleanId)
    );
    const targetCall: PCGCall = found || {
      id: cleanId,
      callId: cleanId,
      clientName: 'Rajesh Sharma',
      rmName: selectedRm || 'Aditya R',
      tlName: (!selectedTl || selectedTl === 'all') ? (teamLeads[0]?.tlName || 'Swetha') : selectedTl,
      phoneNumber: '+91 98765 43210',
      callType: 'Outbound',
      tag: '13% Pitch',
      durationSeconds: 245,
      startTime: '2026-10-18 14:30',
      isAnswered: true,
      hasRecording: true,
      category: '13% Club / Pitching',
      categoryKey: '13_pitching',
      iqsScore: 78,
      gates: { status: 'PASS' },
      needsAttention: true,
      unansweredBy: null,
      unansweredReason: null,
      disputeStatus: 'none',
      aiCoachingTip: 'Ensure date fields and allotment timelines are verified against CRM before quoting to investor.',
      transcriptTurns: [
        { speaker: 'RM', time: '00:05', text: `Good afternoon, this is ${selectedRm || 'Aditya'} from Wint Wealth PCG team. Am I speaking with Mr. Sharma?` },
        { speaker: 'Customer', time: '00:10', text: 'Yes, speaking. What is this regarding?' },
        { speaker: 'RM', time: '00:15', text: 'I am calling regarding your recent coupon payout on 13% Club debentures.' },
        { speaker: 'Customer', time: '00:22', text: 'Yes, when will the interest credit reflect in my bank account?' },
        { speaker: 'RM', time: '00:28', text: 'It will reflect by Friday, and you can also download your tax deduction certificate on the portal.' },
        { speaker: 'Customer', time: '00:35', text: 'Okay, please email me the consolidated statement.' },
        { speaker: 'RM', time: '00:40', text: 'Sure, I will email that right away. Thank you!' },
      ],
      parameters: [
        { id: 'P1', name: 'Greeting & Consent', maxScore: 10, earnedScore: 10, status: 'Yes', quote: 'Professional greeting confirmed.' },
        { id: 'P2', name: 'Information Accuracy', maxScore: 25, earnedScore: 18, status: 'Half', quote: 'Inaccurate date disclosure on allotment cycle.' },
        { id: 'P3', name: 'Issue Resolution', maxScore: 25, earnedScore: 18, status: 'Half', quote: 'Missed secondary customer request on tax certificate.' },
        { id: 'P4', name: 'Professionalism & Tone', maxScore: 20, earnedScore: 20, status: 'Yes', quote: 'Warm, readable tone maintained.' },
        { id: 'P5', name: 'Compliance & Verification', maxScore: 10, earnedScore: 10, status: 'Yes', quote: 'Mandatory verification passed.' },
        { id: 'P6', name: 'Call Closing & Follow-up', maxScore: 10, earnedScore: 7, status: 'Half', quote: 'Did not confirm preferred follow-up callback slot.' },
      ],
    };

    handleTabChange('calls');
    setExpandedCallId(targetCall.id);
    handleOpenCallView(targetCall);
  };

  // Helper formatting
  const formatDuration = (secs: number) => {
    if (!secs) return '00:00';
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const getScoreBadge = (score: number | null | undefined) => {
    if (score == null || score === 0) return <span className="text-zinc-400 text-xs tabular-nums">—</span>;
    return (
      <span className="inline-flex items-center justify-center font-bold text-xs px-2.5 py-0.5 rounded-md border border-zinc-200 bg-zinc-100 text-zinc-900 tabular-nums">
        {score}%
      </span>
    );
  };

  const allDisputedCalls = useMemo(() => {
    const map = new Map<string, PCGCall>();
    (disputes || []).forEach(c => map.set(c.id, c));
    (calls || []).forEach(c => {
      if (c.disputeStatus && c.disputeStatus !== 'none') {
        map.set(c.id, c);
      }
    });
    return Array.from(map.values());
  }, [disputes, calls]);

  const disputeRaisedCalls = allDisputedCalls.filter((c) => c.disputeStatus === 'pending');
  const disputeReviewedCalls = allDisputedCalls.filter((c) => c.disputeStatus === 'resolved' || c.disputeStatus === 'overridden');

  // Filtered evaluated calls list based on Min and Max IQS filter
  const displayedEvaluatedCalls = calls.filter((call) => {
    if (!call.isAnswered) return false;
    if (activePersona === 'agent' && selectedRm) {
      if (!isSamePcgAgent(call.rmName, selectedRm)) return false;
    }
    if (activePersona === 'tl' && teamRms.length > 0) {
      if (!teamRms.some((rm) => isSamePcgAgent(rm, call.rmName))) return false;
    }
    if (minIqsFilter.trim() !== '' && minIqsFilter !== 'all') {
      const minVal = parseFloat(minIqsFilter);
      if (!isNaN(minVal) && (call.iqsScore == null || call.iqsScore < minVal)) return false;
    }
    if (maxIqsFilter.trim() !== '' && maxIqsFilter !== 'all') {
      const maxVal = parseFloat(maxIqsFilter);
      if (!isNaN(maxVal) && (call.iqsScore == null || call.iqsScore > maxVal)) return false;
    }
    return true;
  });

  // RM Scorecard lookups & real computed metrics for RM view
  // Metrics represent the selected date range & scope — NEVER the paginated table slice!
  const currentRmScorecard = rmScorecards.find((r) => isSamePcgAgent(r.rmName, selectedRm));
  const rmQualityScore = summary?.avgIqs != null
    ? `${summary.avgIqs}`
    : (currentRmScorecard && currentRmScorecard.overallScore > 0 ? `${currentRmScorecard.overallScore}.0` : null);

  const rmTotalCallsCount = summary?.totalCalls ?? (currentRmScorecard?.totalCalls ?? 0);
  const rmAnsweredCallsCount = summary?.answeredCalls ?? (currentRmScorecard ? Math.round((currentRmScorecard.connectRate / 100) * currentRmScorecard.totalCalls) : 0);
  const rmUnansweredCallsCount = summary?.unansweredCalls ?? Math.max(0, rmTotalCallsCount - rmAnsweredCallsCount);
  const rmUnansweredByAgentCount = summary?.unansweredByRm ?? 0;
  const rmActionablePickupCalls = rmAnsweredCallsCount + rmUnansweredByAgentCount;
  const rmPickupRate = rmActionablePickupCalls > 0
    ? Math.round((rmAnsweredCallsCount / rmActionablePickupCalls) * 100)
    : (rmTotalCallsCount > 0 ? Math.round((rmAnsweredCallsCount / rmTotalCallsCount) * 100) : (currentRmScorecard?.connectRate ?? 0));
  const rmConnectRate = rmTotalCallsCount > 0
    ? Math.round((rmAnsweredCallsCount / rmTotalCallsCount) * 100)
    : (currentRmScorecard?.connectRate ?? 0);

  const rmRankIndex = rmScorecards.findIndex(
    (s) => isSamePcgAgent(s.rmName, selectedRm)
  );
  const rmRankDisplay = rmRankIndex >= 0 ? `#${rmRankIndex + 1}` : '—';

  const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const getDateRangeLabel = () => {
    const fmt = (d: Date) => {
      const day = d.getDate();
      const month = MONTH_NAMES[d.getMonth()] || 'Oct';
      const year = d.getFullYear();
      return { day, month, year, str: `${day} ${month} ${year}` };
    };

    const fmtRange = (start: Date, end: Date) => {
      const s = fmt(start);
      const e = fmt(end);
      if (s.year === e.year && s.month === e.month) {
        return `${s.day} – ${e.day} ${e.month} ${e.year}`;
      }
      if (s.year === e.year) {
        return `${s.day} ${s.month} – ${e.day} ${e.month} ${e.year}`;
      }
      return `${s.str} – ${e.str}`;
    };

    if (dateRange === '7d') {
      const end = new Date();
      const start = new Date(Date.now() - 7 * 86400000);
      const rangeStr = fmtRange(start, end);
      return {
        full: `${rangeStr} (Last 7 Days)`,
        short: 'Last 7 Days',
        datesOnly: rangeStr,
      };
    }
    if (dateRange === '30d') {
      const end = new Date();
      const start = new Date(Date.now() - 30 * 86400000);
      const rangeStr = fmtRange(start, end);
      return {
        full: `${rangeStr} (Last 30 Days)`,
        short: 'Last 30 Days',
        datesOnly: rangeStr,
      };
    }
    if (dateRange === 'custom') {
      if (customStartDate && customEndDate) {
        const [sy, sm, sd] = customStartDate.split('-').map(Number);
        const [ey, em, ed] = customEndDate.split('-').map(Number);
        const start = new Date(sy, (sm || 1) - 1, sd || 1);
        const end = new Date(ey, (em || 1) - 1, ed || 1);
        const rangeStr = fmtRange(start, end);
        return {
          full: `${rangeStr} (Custom Range)`,
          short: rangeStr,
          datesOnly: rangeStr,
        };
      }
      return {
        full: 'Custom Range',
        short: 'Custom',
        datesOnly: 'Custom Range',
      };
    }
    return {
      full: 'Last 7 Days',
      short: 'Last 7 Days',
      datesOnly: 'Last 7 Days',
    };
  };

  const activeDateInfo = getDateRangeLabel();

  const dynamicTlAvgIqs = (() => {
    const answeredCalls = calls.filter((c) => c.isAnswered && c.iqsScore > 0);
    if (answeredCalls.length > 0) {
      return (answeredCalls.reduce((acc, c) => acc + c.iqsScore, 0) / answeredCalls.length).toFixed(1);
    }
    return '—';
  })();

  const allKnownRms: string[] = useMemo(() => {
    const set = new Set<string>();
    teamLeads.forEach((t) => t.rms.forEach((r: string) => set.add(r)));
    rms.forEach((r) => set.add(r.name));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [teamLeads, rms]);

  // When activePersona is 'tl' and teamRms is loaded, ensure selectedRm is set to a team member
  useEffect(() => {
    if (activePersona === 'tl' && teamRms.length > 0) {
      const isSelectedInTeam = teamRms.some(
        (name: string) => isSamePcgAgent(name, selectedRm)
      );
      if (!isSelectedInTeam) {
        setSelectedRm(teamRms[0]);
      }
    }
  }, [activePersona, teamRms, selectedRm]);

  const teamRmScorecards: RmScorecard[] = useMemo(() => {
    return rmScorecards.filter((r) =>
      teamRms.some((name: string) => isSamePcgAgent(name, r.rmName))
    );
  }, [rmScorecards, teamRms]);

  const availableRmsForTable: { name: string; count: number }[] = useMemo(() => {
    if (activePersona === 'tl') {
      const teamSet = new Set(teamRms.map((r: string) => r.toLowerCase()));
      const matchedRms = rms.filter((r) => teamSet.has(r.name.toLowerCase()));
      const existingNames = new Set(matchedRms.map((r) => r.name.toLowerCase()));
      const zeroCountRms = teamRms
        .filter((name: string) => !existingNames.has(name.toLowerCase()))
        .map((name: string) => ({ name, count: 0 }));
      const combined = [...matchedRms, ...zeroCountRms];
      return combined.sort((a, b) => a.name.localeCompare(b.name));
    }
    if (activePersona === 'admin' && adminTlFilter !== 'all') {
      const selectedAdminTeam = teamLeads.find(
        (t) => t.tlName.toLowerCase() === adminTlFilter.toLowerCase()
      );
      if (selectedAdminTeam) {
        const set = new Set(selectedAdminTeam.rms.map((r: string) => r.toLowerCase()));
        return (rms.length > 0 ? rms : allKnownRms.map((name: string) => ({ name, count: 0 }))).filter((r: { name: string; count: number }) =>
          set.has(r.name.toLowerCase())
        );
      }
    }
    return rms.length > 0 ? rms : allKnownRms.map((name: string) => ({ name, count: 0 }));
  }, [activePersona, teamRms, rms, allKnownRms, adminTlFilter, teamLeads]);

  const renderDisputesTable = () => (
    <div className="bg-white rounded-xl border border-[#E4E4E7] overflow-hidden shadow-sm">
      <div className="p-4 border-b border-[#E4E4E7] flex flex-wrap items-center justify-between gap-4 bg-[#FAFAFB]/60">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold text-[#111111]">
              {activePersona === 'agent' ? 'My Quality Disputes' : 'Team Quality Disputes'}
            </h3>
          </div>
          <p className="text-xs text-[#71717A] mt-0.5">
            {activePersona === 'agent'
              ? 'Track call evaluations you challenged and review decisions made by your Team Leader.'
              : 'Review agent disputes challenging AI scores, audit evidence, and record override decisions.'}
          </p>
        </div>

        {/* Status Tabs */}
        <div className="inline-flex items-center p-1 bg-[#F4F4F5] rounded-xl border border-[#E4E4E7]">
          <button
            onClick={() => setDisputeTab('raised')}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all flex items-center gap-2 ${disputeTab === 'raised'
              ? 'bg-white text-[#111111] shadow-sm font-bold'
              : 'text-[#71717A] hover:text-[#111111]'
              }`}
          >
            <span>Dispute Raised</span>
            <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${disputeRaisedCalls.length > 0 ? 'bg-zinc-200 text-zinc-900 border border-zinc-300' : 'bg-zinc-200 text-zinc-600'
              }`}>
              {disputeRaisedCalls.length}
            </span>
          </button>

          <button
            onClick={() => setDisputeTab('reviewed')}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all flex items-center gap-2 ${disputeTab === 'reviewed'
              ? 'bg-white text-[#111111] shadow-sm font-bold'
              : 'text-[#71717A] hover:text-[#111111]'
              }`}
          >
            <span>✓</span>
            <span>Dispute Reviewed</span>
            <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${disputeReviewedCalls.length > 0 ? 'bg-zinc-200 text-zinc-900 border border-zinc-300' : 'bg-zinc-200 text-zinc-600'
              }`}>
              {disputeReviewedCalls.length}
            </span>
          </button>
        </div>
      </div>

      {/* TAB 1: DISPUTE RAISED TABLE */}
      {disputeTab === 'raised' && (
        <div className="overflow-x-auto">
          {disputeRaisedCalls.length === 0 ? (
            <div className="p-10 text-center text-zinc-400 text-xs">
              No disputes currently raised or pending review.
            </div>
          ) : (
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-[#FAFAFB] border-b border-[#E4E4E7] text-[#6B6B6B] font-semibold uppercase tracking-wider">
                  {activePersona !== 'agent' && <th className="py-3 px-4">Call ID</th>}
                  {activePersona !== 'agent' && <th className="py-3 px-4">RM Name</th>}
                  <th className="py-3 px-4">Category</th>
                  <th className="py-3 px-4">{activePersona === 'agent' ? 'Client Name' : 'Customer Phone'}</th>
                  <th className="py-3 px-4">Current IQS</th>
                  <th className="py-3 px-4">Dispute Justification</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F0F0F2]">
                {disputeRaisedCalls.map((call) => {
                  const isExpanded = expandedDisputeId === call.id;
                  return (
                    <React.Fragment key={call.id}>
                      <tr
                        className={`hover:bg-zinc-50 transition-colors ${activePersona === 'tl' ? 'cursor-pointer' : ''}`}
                        onClick={() => {
                          if (activePersona === 'tl') {
                            setExpandedDisputeId(isExpanded ? null : call.id);
                          }
                        }}
                      >
                        {activePersona !== 'agent' && (
                          <td className="py-3 px-4">
                            <a
                              href={getRunoCallUrl(call.callId || call.id)}
                              target="_blank"
                              rel="noopener noreferrer"
                              title={`Open in Runo CRM`}
                              className="inline-flex items-center gap-1 font-bold tabular-nums text-zinc-900 hover:text-black hover:underline group cursor-pointer"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <span>#{formatCallId(call.callId, call.id)}</span>
                              <svg className="w-3 h-3 text-zinc-400 group-hover:text-black transition-colors shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                              </svg>
                            </a>
                          </td>
                        )}
                        {activePersona !== 'agent' && (
                          <td className="py-3 px-4 font-semibold text-zinc-800">{call.rmName}</td>
                        )}
                        <td className="py-3 px-4">
                          <span className="inline-flex px-2 py-0.5 rounded text-[11px] font-semibold bg-zinc-100 text-zinc-700 border border-zinc-200">
                            {call.category}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          {activePersona === 'agent' ? (
                            <span className="font-semibold text-zinc-900">{call.clientName || 'Investor Client'}</span>
                          ) : (
                            <span className="tabular-nums text-zinc-600 font-normal">{call.phoneNumber}</span>
                          )}
                        </td>
                        <td className="py-3 px-4">{getScoreBadge(call.iqsScore)}</td>
                        <td className="py-3 px-4 text-zinc-800 font-medium max-w-xs truncate">
                          "{call.disputeReason || 'Agent challenged parameter score.'}"
                        </td>
                        <td className="py-3 px-4">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-zinc-100 text-zinc-800 border border-zinc-300">
                            Pending TL Review
                          </span>
                        </td>
                        <td className="py-3 px-4 text-center" onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={() => {
                              setExpandedDisputeId(isExpanded ? null : call.id);
                            }}
                            className="px-3.5 py-1 rounded-md bg-zinc-900 hover:bg-zinc-800 text-white font-semibold transition-colors text-xs shadow-sm inline-flex items-center gap-1"
                          >
                            <span>{isExpanded ? 'Hide' : activePersona === 'tl' ? 'Review' : 'View'}</span>
                            <span className="text-[10px]">{isExpanded ? '▲' : '▼'}</span>
                          </button>
                        </td>
                      </tr>

                      {isExpanded && (
                        <CallEvalPanel
                          callId={call.callId || call.id.toString()}
                          hideShowChat={true}
                          isPcg={true}
                          mobileNumber={call.phoneNumber}
                          agentName={call.rmName}
                          iqsScore={call.iqsScore}
                          calledAt={call.startTime || '2026-10-18T14:04:00.000Z'}
                          disposition={call.category}
                          gates={call.gates}
                          iqsScores={formatCallIqsScores(call)}
                          initialSegments={formatCallSegments(call)}
                          initialRecordingUrl={`/api/admin/pcg-calls/audio?id=${encodeURIComponent(call.id)}`}
                          mode={activePersona === 'tl' ? 'submit' : 'view'}
                          allowReevaluate={activePersona === 'tl'}
                          dispute={{
                            flagId: call.id,
                            agentName: call.rmName,
                            agentNote: call.disputeReason,
                            raisedBy: 'agent',
                            raisedByName: call.rmName,
                            raisedAt: call.startTime,
                            challengedParams: (call.parameters || []).filter(p => p.status !== 'Yes').map(p => ({
                              param: p.id,
                              note: p.quote || 'Challenged parameter score.'
                            }))
                          }}
                          colSpan={activePersona === 'agent' ? 6 : 8}
                          onDone={() => setExpandedDisputeId(null)}
                          onClose={() => setExpandedDisputeId(null)}
                          onOverrideSubmit={async (overrideData) => {
                            handleOverrideFromPanel(call.callId || call.id.toString(), overrideData);
                          }}
                        />
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* TAB 2: DISPUTE REVIEWED TABLE */}
      {disputeTab === 'reviewed' && (
        <div className="overflow-x-auto">
          {disputeReviewedCalls.length === 0 ? (
            <div className="p-10 text-center text-zinc-400 text-xs">
              No reviewed disputes recorded yet.
            </div>
          ) : (
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-[#FAFAFB] border-b border-[#E4E4E7] text-[#6B6B6B] font-semibold uppercase tracking-wider">
                  {activePersona !== 'agent' && <th className="py-3 px-4">Call ID</th>}
                  {activePersona !== 'agent' && <th className="py-3 px-4">RM Name</th>}
                  <th className="py-3 px-4">Category</th>
                  <th className="py-3 px-4">{activePersona === 'agent' ? 'Client Name' : 'Customer Phone'}</th>
                  <th className="py-3 px-4">Revised IQS</th>
                  <th className="py-3 px-4">TL Resolution Note</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F0F0F2]">
                {disputeReviewedCalls.map((call) => {
                  const isExpanded = expandedDisputeId === call.id;
                  return (
                    <React.Fragment key={call.id}>
                      <tr
                        className={`hover:bg-zinc-50 transition-colors ${activePersona === 'tl' ? 'cursor-pointer' : ''}`}
                        onClick={() => {
                          if (activePersona === 'tl') {
                            setExpandedDisputeId(isExpanded ? null : call.id);
                          }
                        }}
                      >
                        {activePersona !== 'agent' && (
                          <td className="py-3 px-4">
                            <a
                              href={getRunoCallUrl(call.callId || call.id)}
                              target="_blank"
                              rel="noopener noreferrer"
                              title={`Open in Runo CRM`}
                              className="inline-flex items-center gap-1 font-bold tabular-nums text-zinc-900 hover:text-black hover:underline group cursor-pointer"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <span>#{formatCallId(call.callId, call.id)}</span>
                              <svg className="w-3 h-3 text-zinc-400 group-hover:text-black transition-colors shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                              </svg>
                            </a>
                          </td>
                        )}
                        {activePersona !== 'agent' && (
                          <td className="py-3 px-4 font-semibold text-zinc-800">{call.rmName}</td>
                        )}
                        <td className="py-3 px-4">
                          <span className="inline-flex px-2 py-0.5 rounded text-[11px] font-semibold bg-zinc-100 text-zinc-700 border border-zinc-200">
                            {call.category}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          {activePersona === 'agent' ? (
                            <span className="font-semibold text-zinc-900">{call.clientName || 'Investor Client'}</span>
                          ) : (
                            <span className="tabular-nums text-zinc-600 font-normal">{call.phoneNumber}</span>
                          )}
                        </td>
                        <td className="py-3 px-4">{getScoreBadge(call.iqsScore)}</td>
                        <td className="py-3 px-4 text-zinc-700 font-medium max-w-xs truncate">
                          "{call.tlOverrideNote || 'Dispute reviewed and resolved by Team Leader.'}"
                        </td>
                        <td className="py-3 px-4">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-zinc-100 text-zinc-800 border border-zinc-300">
                            <span>✓</span> Reviewed &amp; Resolved
                          </span>
                        </td>
                        <td className="py-3 px-4 text-center" onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={() => {
                              setExpandedDisputeId(isExpanded ? null : call.id);
                            }}
                            className="px-3.5 py-1 rounded-md bg-zinc-900 hover:bg-zinc-800 text-white font-semibold transition-colors text-xs shadow-sm inline-flex items-center gap-1"
                          >
                            <span>{isExpanded ? 'Hide' : 'View Details'}</span>
                            <span className="text-[10px]">{isExpanded ? '▲' : '▼'}</span>
                          </button>
                        </td>
                      </tr>

                      {isExpanded && (
                        <CallEvalPanel
                          callId={call.callId || call.id.toString()}
                          hideShowChat={true}
                          isPcg={true}
                          mobileNumber={call.phoneNumber}
                          agentName={call.rmName}
                          iqsScore={call.iqsScore}
                          calledAt={call.startTime || '2026-10-18T14:04:00.000Z'}
                          disposition={call.category}
                          gates={call.gates}
                          iqsScores={formatCallIqsScores(call)}
                          initialSegments={formatCallSegments(call)}
                          initialRecordingUrl={`/api/admin/pcg-calls/audio?id=${encodeURIComponent(call.id)}`}
                          mode="view"
                          allowReevaluate={activePersona === 'tl'}
                          colSpan={activePersona !== 'agent' ? 8 : 6}
                          onDone={() => setExpandedDisputeId(null)}
                          onClose={() => setExpandedDisputeId(null)}
                        />
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );


  return (
    <div className="min-h-screen bg-[#f5f3ee] text-[#111111] flex flex-col font-sans">
      {/* ── TOP HEADER (GLOBAL) ─────────────────────────────────────────── */}
      <header className="bg-white border-b border-[#e6e2d8] px-6 py-3.5 sticky top-0 z-30 flex flex-wrap items-center justify-between gap-4 shadow-2xs">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[#111111] flex items-center justify-center text-white font-bold text-sm">
            W
          </div>
          <div>
            <h1 className="text-base font-bold text-[#111111] leading-none">PCG Call Quality</h1>
            <p className="text-xs text-[#71717A] mt-0.5">PCG Team Voice Call Performance &amp; Quality Analytics</p>
          </div>
        </div>

        {/* Global Date Selector, Workspace Switcher, User Profile */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Global Date Selector */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-[#71717A] font-semibold">Date Range:</span>
            <select
              value={dateRange}
              onChange={(e) => {
                setDateRange(e.target.value as any);
                setPage(1);
              }}
              className="text-xs font-semibold border border-[#E4E4E7] rounded-lg px-3 py-1.5 bg-white text-[#111111] outline-none shadow-sm cursor-pointer"
            >
              <option value="7d">Last 7 Days</option>
              <option value="30d">Last 30 Days</option>
              <option value="custom">Custom Range</option>
            </select>

            {dateRange === 'custom' && (
              <div className="flex items-center gap-1.5 bg-white border border-[#E4E4E7] px-2 py-1 rounded-lg shadow-sm">
                <input
                  type="date"
                  value={customStartDate}
                  onChange={(e) => {
                    setCustomStartDate(e.target.value);
                    setPage(1);
                  }}
                  className="text-xs tabular-nums font-medium bg-zinc-50 border border-[#E4E4E7] rounded px-2 py-1 text-[#111111] outline-none cursor-pointer"
                />
                <span className="text-xs text-[#71717A] font-medium">to</span>
                <input
                  type="date"
                  value={customEndDate}
                  onChange={(e) => {
                    setCustomEndDate(e.target.value);
                    setPage(1);
                  }}
                  className="text-xs tabular-nums font-medium bg-zinc-50 border border-[#E4E4E7] rounded px-2 py-1 text-[#111111] outline-none cursor-pointer"
                />
              </div>
            )}
          </div>

          {/* Workspace Switcher for Super Admins */}
          {(isSuperAdmin || platformDomain === 'both') && (
            <div className="mr-1">
              <WorkspaceSwitcher compact={true} />
            </div>
          )}

          <div className="flex items-center gap-1.5 ml-2">
            <ThemeToggle />
            <AccountMenu
              name={loggedInUserName}
              email={session?.user?.email ?? ''}
              role={userRole}
              roleLabel={userRole === 'agent' ? 'RM' : userRole === 'tl' ? 'Team Lead' : 'Admin'}
            />
          </div>
        </div>
      </header>

      {/* ── BODY: SIDEBAR + MAIN CONTENT (EXACT CX TL REPLICATION) ───────── */}
      <div className="flex flex-1 min-h-[calc(100vh-65px)] bg-[#f5f3ee]">
        {/* Left Sidebar Panel (Replicated from CX TL with Call Quality & RM Scorecard) */}
        <aside
          className="w-[220px] shrink-0 bg-[#f5f3ee] border-r border-[#e6e2d8] py-4 select-none"
        >
          {/* Section Title */}
          <div
            className="text-[11px] uppercase tracking-[0.08em] text-[#71717a] px-4 pt-3 pb-2 font-semibold"
          >
            {activePersona === 'admin' ? 'ADMIN' : activePersona === 'tl' ? 'TEAM LEAD' : 'AGENT'}
          </div>

          {/* 1. Team Analytics Navigation Link (For Admin) */}
          {activePersona === 'admin' && (
            <button
              type="button"
              onClick={() => handleTabChange('team_analytics')}
              className={`w-[calc(100%-24px)] mx-3 mb-0.5 h-10 px-3 rounded-[10px] flex items-center gap-2.5 text-[14px] text-left cursor-pointer transition-all duration-150 border-0 outline-none font-sans select-none ${activeTab === 'team_analytics'
                ? 'bg-white text-[#18181b] font-medium shadow-[0_1px_3px_rgba(0,0,0,0.08),0_1px_2px_rgba(0,0,0,0.04)]'
                : 'bg-transparent text-[#3f3f46] font-normal hover:bg-[rgba(0,0,0,0.04)]'
                }`}
            >
              <span
                className={`inline-flex items-center justify-center shrink-0 ${activeTab === 'team_analytics' ? 'text-[#18181b]' : 'text-[#71717a]'
                  }`}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="20" x2="18" y2="10" />
                  <line x1="12" y1="20" x2="12" y2="4" />
                  <line x1="6" y1="20" x2="6" y2="14" />
                </svg>
              </span>
              <span className="flex-1">Team Analytics</span>
            </button>
          )}

          {/* 2. Member Analytics / My Analytics Navigation Link */}
          <button
            type="button"
            onClick={() => handleTabChange('member_analytics')}
            className={`w-[calc(100%-24px)] mx-3 mb-0.5 h-10 px-3 rounded-[10px] flex items-center gap-2.5 text-[14px] text-left cursor-pointer transition-all duration-150 border-0 outline-none font-sans select-none ${activeTab === 'member_analytics'
              ? 'bg-white text-[#18181b] font-medium shadow-[0_1px_3px_rgba(0,0,0,0.08),0_1px_2px_rgba(0,0,0,0.04)]'
              : 'bg-transparent text-[#3f3f46] font-normal hover:bg-[rgba(0,0,0,0.04)]'
              }`}
          >
            <span
              className={`inline-flex items-center justify-center shrink-0 ${activeTab === 'member_analytics' ? 'text-[#18181b]' : 'text-[#71717a]'
                }`}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
            </span>
            <span className="flex-1">{activePersona === 'agent' ? 'My Analytics' : 'Member Analytics'}</span>
          </button>

          {/* 3. Call Quality Navigation Link (Hidden for Admin) */}
          {activePersona !== 'admin' && (
            <button
              type="button"
              onClick={() => handleTabChange('calls')}
              className={`w-[calc(100%-24px)] mx-3 mb-0.5 h-10 px-3 rounded-[10px] flex items-center gap-2.5 text-[14px] text-left cursor-pointer transition-all duration-150 border-0 outline-none font-sans select-none ${activeTab === 'calls' || activeTab === 'disputes'
                ? 'bg-white text-[#18181b] font-medium shadow-[0_1px_3px_rgba(0,0,0,0.08),0_1px_2px_rgba(0,0,0,0.04)]'
                : 'bg-transparent text-[#3f3f46] font-normal hover:bg-[rgba(0,0,0,0.04)]'
                }`}
            >
              <span
                className={`inline-flex items-center justify-center shrink-0 ${activeTab === 'calls' || activeTab === 'disputes' ? 'text-[#18181b]' : 'text-[#71717a]'
                  }`}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12a19.79 19.79 0 0 1-3-8.63 2 2 0 0 1 2-2.18h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
                </svg>
              </span>
              <span className="flex-1">Call Quality</span>
            </button>
          )}

          {/* 4. RM Scorecard Navigation Link */}
          <button
            type="button"
            onClick={() => handleTabChange('scorecard')}
            className={`w-[calc(100%-24px)] mx-3 mb-0.5 h-10 px-3 rounded-[10px] flex items-center gap-2.5 text-[14px] text-left cursor-pointer transition-all duration-150 border-0 outline-none font-sans select-none ${activeTab === 'scorecard'
              ? 'bg-white text-[#18181b] font-medium shadow-[0_1px_3px_rgba(0,0,0,0.08),0_1px_2px_rgba(0,0,0,0.04)]'
              : 'bg-transparent text-[#3f3f46] font-normal hover:bg-[rgba(0,0,0,0.04)]'
              }`}
          >
            <span
              className={`inline-flex items-center justify-center shrink-0 ${activeTab === 'scorecard' ? 'text-[#18181b]' : 'text-[#71717a]'
                }`}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
                <polyline points="10 9 9 9 8 9" />
              </svg>
            </span>
            <span className="flex-1">{activePersona === 'agent' ? 'My Scorecard' : 'RM Scorecard'}</span>
          </button>

          {/* 5. RM Performance Navigation Link */}
          {activePersona === 'admin' && (
            <button
              type="button"
              onClick={() => handleTabChange('rm_performance')}
              className={`w-[calc(100%-24px)] mx-3 mb-0.5 h-10 px-3 rounded-[10px] flex items-center gap-2.5 text-[14px] text-left cursor-pointer transition-all duration-150 border-0 outline-none font-sans select-none ${activeTab === 'rm_performance'
                ? 'bg-white text-[#18181b] font-medium shadow-[0_1px_3px_rgba(0,0,0,0.08),0_1px_2px_rgba(0,0,0,0.04)]'
                : 'bg-transparent text-[#3f3f46] font-normal hover:bg-[rgba(0,0,0,0.04)]'
                }`}
            >
              <span
                className={`inline-flex items-center justify-center shrink-0 ${activeTab === 'rm_performance' ? 'text-[#18181b]' : 'text-[#71717a]'
                  }`}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
                  <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
                  <path d="M4 22h16" />
                  <path d="M10 14.66V17c0 .55-.45 1-1 1H7" />
                  <path d="M14 14.66V17c0 .55.45 1 1 1h2" />
                  <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
                </svg>
              </span>
              <span className="flex-1">RM Performance</span>
            </button>
          )}

          {/* 6. Settings Link (Admin Only) */}
          {activePersona === 'admin' && (
            <div className="mt-4 pt-3 border-t border-[#e6e2d8]">
              <Link
                href="/settings?section=pcg-users"
                className="w-[calc(100%-24px)] mx-3 h-10 px-3 rounded-[10px] flex items-center gap-2.5 text-[14px] text-left cursor-pointer transition-all duration-150 border-0 outline-none font-sans select-none bg-transparent text-[#3f3f46] font-normal hover:bg-[rgba(0,0,0,0.04)]"
              >
                <span className="inline-flex items-center justify-center shrink-0 text-[#71717a]">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                  </svg>
                </span>
                <span className="flex-1">Settings</span>
              </Link>
            </div>
          )}
        </aside>

        {/* Main Content Area */}
        <main className="flex-1 p-6 md:p-8 overflow-y-auto min-w-0 max-w-7xl">
          {activeTab === 'scorecard' ? (
            <div>
              <PcgScorecardView
                activePersona={activePersona}
                selectedRm={selectedRm}
                onSelectRm={(rm) => setSelectedRm(rm)}
                selectedTl={activeTlName}
                onSelectTl={(tl) => setSelectedTl(tl)}
                onOpenCallView={(cid) => handleOpenCallById(cid)}
                onSwitchToCallsTab={() => handleTabChange('calls')}
                allowedRms={activePersona === 'tl' ? teamRms : undefined}
              />
            </div>
          ) : activeTab === 'team_analytics' ? (
            <div>
              <PcgTeamAnalyticsDashboard
                activePersona={activePersona}
                selectedTl={activeTlName}
                onSelectTl={(tl) => setSelectedTl(tl as any)}
                onSelectRm={(rm) => setSelectedRm(rm)}
                onSwitchToMemberAnalytics={() => handleTabChange('member_analytics')}
                teamLeads={teamLeads}
                rmScorecards={rmScorecards}
                departmentStats={departmentStats}
              />
            </div>
          ) : activeTab === 'rm_performance' ? (
            <div>
              <PcgRmPerformanceDashboard
                activePersona={activePersona}
                onSelectRm={(rm) => {
                  setSelectedRm(rm);
                  handleTabChange('member_analytics');
                }}
                onOpenScorecard={(rm) => {
                  setSelectedRm(rm);
                  handleTabChange('scorecard');
                }}
                rmScorecards={rmScorecards}
                teamLeads={teamLeads}
              />
            </div>
          ) : activeTab === 'member_analytics' ? (
            <div>
              <PcgMemberAnalyticsDashboard
                selectedRm={selectedRm}
                onSelectRm={(rm) => setSelectedRm(rm)}
                availableRms={activePersona === 'admin' ? allKnownRms : activePersona === 'tl' ? teamRms : [selectedRm]}
                calls={calls}
                activePersona={activePersona}
                rmScorecards={rmScorecards}
                teamLeads={teamLeads}
                tlName={activeTlName}
                dateRange={dateRange}
                onDateRangeChange={(range, from, to) => {
                  setDateRange(range);
                  if (from && to) {
                    setCustomStartDate(from);
                    setCustomEndDate(to);
                  }
                }}
              />
            </div>
          ) : (
            <div className="space-y-6">
              {/* Call Quality View Header / Switcher: Evaluated Calls / Disputes */}
              <div className="flex items-center justify-between pb-3 border-b border-[#E4E4E7]">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleTabChange('calls')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${activeTab === 'calls'
                      ? 'bg-zinc-900 text-white font-bold'
                      : 'bg-white text-zinc-700 hover:bg-zinc-100 border border-[#E4E4E7]'
                      }`}
                  >
                    Evaluated Calls
                  </button>
                  <button
                    onClick={() => handleTabChange('disputes')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 cursor-pointer ${activeTab === 'disputes'
                      ? 'bg-zinc-900 text-white font-bold'
                      : 'bg-white text-zinc-700 hover:bg-zinc-100 border border-[#E4E4E7]'
                      }`}
                  >
                    <span>Disputes</span>
                    {disputeRaisedCalls.length > 0 && (
                      <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${activeTab === 'disputes' ? 'bg-zinc-700 text-white' : 'bg-zinc-200 text-zinc-800'
                        }`}>
                        {disputeRaisedCalls.length}
                      </span>
                    )}
                  </button>
                </div>
              </div>

              {activeTab === 'disputes' ? (
                <div className="space-y-6">
                  {/* Persona Header for Disputes - Only for Admin */}
                  {activePersona === 'admin' && (
                    <div className="flex flex-wrap items-center justify-between gap-4 bg-white p-4 rounded-xl border border-[#E4E4E7]">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider bg-zinc-100 text-zinc-700">
                            Executive Console
                          </span>
                          <h2 className="text-lg font-bold text-[#111111]">
                            Organization Disputes Console
                          </h2>
                        </div>
                        <p className="text-xs text-[#71717A] mt-1">
                          Review agent disputes challenging AI scores, audit audio evidence and transcript turns, and submit binding override decisions.
                        </p>
                      </div>
                    </div>
                  )}
                  {renderDisputesTable()}
                </div>
              ) : (
                <div className="space-y-6">
                  {/* ── 1. PERSONA CONTEXT HEADER (Only for Admin) ──────────────── */}
                  {activePersona === 'admin' && (
                    <div className="flex flex-wrap items-center justify-between gap-4 bg-white p-4 rounded-xl border border-[#E4E4E7]">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider bg-zinc-100 text-zinc-700">
                            Executive Console
                          </span>
                          <h2 className="text-lg font-bold text-[#111111]">
                            Organization PCG Analytics &amp; Administration
                          </h2>
                        </div>
                        <p className="text-xs text-[#71717A] mt-1">
                          Complete cross-team visibility across all RMs, Team Leads, and categories.
                        </p>
                      </div>

                      {activePersona === 'admin' && (
                        <div className="flex items-center gap-3 flex-wrap">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs text-[#71717A]">Team:</span>
                            <select
                              value={adminTlFilter}
                              onChange={(e) => {
                                setAdminTlFilter(e.target.value as any);
                                setAdminRmFilter('all');
                                setPage(1);
                              }}
                              className="text-xs font-semibold border border-[#E4E4E7] rounded-lg px-2.5 py-1.5 bg-zinc-50"
                            >
                              <option value="all">All Teams</option>
                              {teamLeads.map((tl) => (
                                <option key={tl.tlName} value={tl.tlName}>
                                  Team {tl.tlName} ({tl.rms.length} RMs)
                                </option>
                              ))}
                            </select>
                          </div>

                          <div className="flex items-center gap-1.5">
                            <span className="text-xs text-[#71717A]">RM:</span>
                            <select
                              value={adminRmFilter}
                              onChange={(e) => { setAdminRmFilter(e.target.value); setPage(1); }}
                              className="text-xs font-semibold border border-[#E4E4E7] rounded-lg px-2.5 py-1.5 bg-zinc-50"
                            >
                              <option value="all">All RMs ({rms.length})</option>
                              {rms
                                .filter((r) => {
                                  if (adminTlFilter !== 'all') {
                                    const selectedAdminTeam = teamLeads.find(t => t.tlName.toLowerCase() === adminTlFilter.toLowerCase());
                                    return selectedAdminTeam ? selectedAdminTeam.rms.some(n => n.toLowerCase() === r.name.toLowerCase()) : true;
                                  }
                                  return true;
                                })
                                .map((r) => (
                                  <option key={r.name} value={r.name}>{r.name} ({r.count})</option>
                                ))}
                            </select>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* ── 2. TOP METRIC CARDS ────────────────────────────────────────────── */}
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 px-0.5">
                      <span className="text-[11px] font-bold text-[#71717A] uppercase tracking-wider">
                        {activePersona === 'agent'
                          ? 'My Call Quality Overview'
                          : activePersona === 'tl'
                            ? `Team ${activeTlName || 'Lead'} Performance Overview`
                            : 'Organization Performance Overview'}
                      </span>
                      <div className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-700 bg-white border border-[#E4E4E7] px-2.5 py-1 rounded-lg shadow-2xs">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-500">
                          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                          <line x1="16" y1="2" x2="16" y2="6" />
                          <line x1="8" y1="2" x2="8" y2="6" />
                          <line x1="3" y1="10" x2="21" y2="10" />
                        </svg>
                        <span className="text-zinc-500 font-normal">Period:</span>
                        <span className="font-semibold text-zinc-900">{activeDateInfo.full}</span>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div className="bg-white p-4 rounded-xl border border-[#E4E4E7]">
                        <div className="flex items-center justify-between">
                          <p className="text-[11px] font-semibold text-[#71717A] uppercase tracking-wider">
                            {activePersona === 'agent' ? 'My Quality Score' : activePersona === 'tl' ? 'Team Avg IQS' : 'Org Avg IQS'}
                          </p>
                          <span className="text-[10px] font-semibold text-zinc-500 bg-zinc-100 px-1.5 py-0.5 rounded">
                            {activeDateInfo.short}
                          </span>
                        </div>
                        <div className="flex items-baseline gap-2 mt-1">
                          <span className="text-2xl font-bold tabular-nums text-[#111111]">
                            {activePersona === 'agent'
                              ? (rmQualityScore ? `${rmQualityScore}%` : '—')
                              : (summary?.avgIqs != null ? `${summary.avgIqs}%` : '—')}
                          </span>
                        </div>
                        <p className="text-[11px] text-[#71717A] mt-1">
                          {activePersona === 'admin'
                            ? `100% AI Automated audits · ${activeDateInfo.datesOnly}`
                            : activeDateInfo.datesOnly}
                        </p>
                      </div>

                      <div className="bg-white p-4 rounded-xl border border-[#E4E4E7]">
                        <div className="flex items-center justify-between">
                          <p className="text-[11px] font-semibold text-[#71717A] uppercase tracking-wider">
                            {activePersona === 'agent' ? 'My Total Calls' : 'Total Calls Attempted'}
                          </p>
                          <span className="text-[10px] font-semibold text-zinc-500 bg-zinc-100 px-1.5 py-0.5 rounded">
                            {activeDateInfo.short}
                          </span>
                        </div>
                        <div className="flex items-baseline gap-2 mt-1">
                          <span className="text-2xl font-bold tabular-nums text-[#111111]">
                            {activePersona === 'agent' ? rmTotalCallsCount : (summary?.totalCalls ?? 0)}
                          </span>
                          <span className="text-xs text-[#71717A]">calls</span>
                        </div>
                        <p className="text-[11px] text-[#71717A] mt-1">
                          {activePersona === 'agent' ? rmAnsweredCallsCount : (summary?.answeredCalls ?? 0)} connected · {activeDateInfo.datesOnly}
                        </p>
                      </div>

                      <div className="bg-white p-4 rounded-xl border border-[#E4E4E7]">
                        <div className="flex items-center justify-between">
                          <p className="text-[11px] font-semibold text-[#71717A] uppercase tracking-wider">
                            Pickup Rate
                          </p>
                          <span className="text-[10px] font-semibold text-zinc-500 bg-zinc-100 px-1.5 py-0.5 rounded">
                            {activeDateInfo.short}
                          </span>
                        </div>
                        <div className="flex items-baseline gap-2 mt-1">
                          <span className="text-2xl font-bold tabular-nums text-[#111111]">
                            {activePersona === 'agent'
                              ? rmPickupRate
                              : (summary?.totalCalls ? Math.round(((summary?.answeredCalls || 0) / summary.totalCalls) * 100) : 0)}%
                          </span>
                          <span className="text-xs text-[#71717A]">pickup</span>
                        </div>
                        <p className="text-[11px] text-[#71717A] mt-1">
                          {activePersona === 'agent'
                            ? `${rmUnansweredByAgentCount} unanswered · ${activeDateInfo.datesOnly}`
                            : `${summary?.unansweredCalls ?? 0} unanswered · ${activeDateInfo.datesOnly}`}
                        </p>
                      </div>
                    </div>
                  </div>




                  {/* ── 5. PROPER RM SCORECARD SECTION (FOR TL) ────────────────── */}

                  {/* 5B. TL VIEW: RM-STYLE AGENT SCORECARDS GRID & AGENT-WISE ANALYTICS */}
                  {activePersona === 'tl' && (
                    <div className="space-y-4">


                      {/* Agent-Wise Analytics Table (Matching Quality Console Table) */}
                      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                          <div>
                            <p className="text-sm font-bold text-gray-900">Agent Wise Analytics</p>
                            <p className="text-xs text-gray-500 mt-0.5">
                              IQS, Pickup Rate, and performance per agent · Team {selectedTl} · {activeDateInfo.full}
                            </p>
                          </div>
                        </div>

                        <div className="overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="bg-gray-50/60 border-b border-gray-100 text-[#6B6B6B] font-semibold">
                                <th className="py-3 px-4 text-left">RM Name</th>
                                <th className="py-3 px-4 text-right">Calls Handled</th>
                                <th className="py-3 px-4 text-right">Pickup Rate</th>
                                <th className="py-3 px-4 text-right">Avg IQS</th>
                                <th className="py-3 px-4 text-center">Compliance</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                              {teamRmScorecards.length === 0 ? (
                                <tr>
                                  <td colSpan={5} className="py-8 text-center text-xs text-gray-500">
                                    No RM call data recorded for Team {activeTlName || selectedTl} in this period.
                                  </td>
                                </tr>
                              ) : (
                                teamRmScorecards.map((rm: RmScorecard) => (
                                  <tr key={rm.rmName} className="hover:bg-gray-50/50 transition-colors">
                                    <td className="py-3 px-4 font-bold text-gray-900 flex items-center gap-2">
                                      <span className="w-6 h-6 rounded-full bg-zinc-200 text-zinc-800 flex items-center justify-center font-bold text-[11px]">
                                        {rm.rmName.charAt(0)}
                                      </span>
                                      <span>{rm.rmName}</span>
                                    </td>
                                    <td className="py-3 px-4 text-right tabular-nums font-medium text-gray-800">{rm.totalCalls}</td>
                                    <td className="py-3 px-4 text-right tabular-nums font-medium text-gray-800">{rm.connectRate}%</td>
                                    <td className="py-3 px-4 text-right">
                                      {getScoreBadge(rm.overallScore)}
                                    </td>
                                    <td className="py-3 px-4 text-center tabular-nums">
                                      {rm.complianceFlags > 0 ? (
                                        <span className="text-zinc-900 font-bold">{rm.complianceFlags} Flags</span>
                                      ) : (
                                        <span className="text-zinc-500 font-normal">0 Flags</span>
                                      )}
                                    </td>
                                  </tr>
                                ))
                              )}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* 5C. ADMIN VIEW: ON-DEMAND OVERALL TEAM ANALYTICS, RM PERFORMANCE & AI COACHING */}
                  {activePersona === 'admin' && (
                    <div className="space-y-5">
                      {/* 1. Overall Team Leadership Comparison Banner (Only opened when selected from Category Tab) */}
                      {selectedCategory === 'tl_analytics' && (
                        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden p-5 space-y-4 animate-in fade-in duration-200">
                          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 pb-3">
                            <div>
                              <div className="flex items-center gap-2">

                                <h3 className="text-sm font-bold text-gray-900">Overall Team Leadership Analytics</h3>
                                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-zinc-100 text-zinc-800 border border-zinc-300">
                                  Active Category View
                                </span>
                              </div>
                              <p className="text-xs text-gray-500 mt-0.5">
                                Comparative voice call quality, pickup rates, and volume across Team Leaders
                              </p>
                            </div>

                            {/* Dropdown to Choose TL */}
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-semibold text-gray-500">Select Team Lead:</span>
                              <select
                                value={adminBannerTlSelect}
                                onChange={(e) => setAdminBannerTlSelect(e.target.value)}
                                className="text-xs font-bold bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-gray-800 outline-none focus:border-zinc-900 shadow-sm"
                              >
                                <option value="all">All Team Leads</option>
                                {teamLeads.map((tl) => (
                                  <option key={tl.tlName} value={tl.tlName}>
                                    Team {tl.tlName} ({tl.rms.length} Relationship Managers)
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>

                          {/* Team Lead Comparison Cards Filtered by Dropdown */}
                          <div className={`grid gap-4 ${adminBannerTlSelect === 'all' ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1 max-w-xl'}`}>
                            {teamLeads.length === 0 ? (
                              <div className="col-span-full py-6 text-center text-xs text-gray-500 bg-white rounded-xl border border-dashed border-zinc-200">
                                No team analytics data recorded for this period.
                              </div>
                            ) : (
                              teamLeads
                                .filter((tl) => adminBannerTlSelect === 'all' || tl.tlName.toLowerCase() === adminBannerTlSelect.toLowerCase())
                                .map((tl) => (
                                  <div key={tl.tlName} className="p-4 rounded-xl border border-zinc-200 bg-zinc-50/50 space-y-3">
                                    <div className="flex items-center justify-between">
                                      <div className="flex items-center gap-2">
                                        <span className="w-8 h-8 rounded-lg bg-zinc-900 text-white flex items-center justify-center font-bold text-xs">
                                          {tl.tlName[0]}
                                        </span>
                                        <div>
                                          <h4 className="text-sm font-bold text-zinc-900">Team {tl.tlName}</h4>
                                          <p className="text-[11px] text-zinc-500">{tl.teamSize} Relationship Managers</p>
                                        </div>
                                      </div>
                                      <span className="text-xs font-bold px-2 py-0.5 rounded bg-zinc-100 text-zinc-900 border border-zinc-200">
                                        Team IQS: {tl.avgScore ? `${tl.avgScore}%` : '—'}
                                      </span>
                                    </div>

                                    <div className="grid grid-cols-3 gap-2 text-center pt-1 border-t border-zinc-200">
                                      <div className="bg-white p-2 rounded-lg border border-zinc-100">
                                        <span className="text-[10px] uppercase font-bold text-zinc-400 block">Total Calls</span>
                                        <span className="text-sm font-bold tabular-nums text-zinc-900">{tl.totalCalls}</span>
                                      </div>
                                      <div className="bg-white p-2 rounded-lg border border-zinc-100">
                                        <span className="text-[10px] uppercase font-bold text-zinc-400 block">Pickup Rate</span>
                                        <span className="text-sm font-bold tabular-nums text-zinc-900">{tl.connectRate}%</span>
                                      </div>
                                      <div className="bg-white p-2 rounded-lg border border-zinc-100">
                                        <span className="text-[10px] uppercase font-bold text-zinc-400 block">&lt;85% Attention</span>
                                        <span className="text-sm font-bold tabular-nums text-zinc-900">
                                          {tl.callsUnder85}
                                        </span>
                                      </div>
                                    </div>

                                    <div className="flex items-center gap-1.5 flex-wrap pt-1">
                                      <span className="text-[10px] text-zinc-400 font-semibold uppercase">Team RMs:</span>
                                      {tl.rms.map((rm) => (
                                        <button
                                          key={rm}
                                          onClick={() => { setSelectedRm(rm); setActivePersona('agent'); }}
                                          className="px-2 py-0.5 rounded text-[11px] font-semibold bg-white border border-zinc-200 text-zinc-700 hover:border-zinc-400 hover:text-zinc-900 transition-colors"
                                        >
                                          {rm}
                                        </button>
                                      ))}
                                    </div>
                                  </div>
                                ))
                            )}
                          </div>
                        </div>
                      )}

                      {/* 2. Team-Wide RM Performance Grid Banner (Only opened when selected from Category Tab) */}
                      {selectedCategory === 'rm_performance' && (
                        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden space-y-4 p-5 animate-in fade-in duration-200">
                          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 pb-3">
                            <div>
                              <div className="flex items-center gap-2">

                                <h3 className="text-sm font-bold text-gray-900">Team-Wide RM Performance Grid</h3>
                                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-zinc-100 text-zinc-800 border border-zinc-300">
                                  Active Category View
                                </span>
                              </div>
                              <p className="text-xs text-gray-500 mt-0.5">
                                Complete scorecards across all {rmScorecards.length} Relationship Managers
                              </p>
                            </div>

                            <div className="flex flex-wrap items-center gap-3">
                              {/* Dropdown to select RMs */}
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-semibold text-gray-500">Filter RM:</span>
                                <select
                                  value={adminGridRmFilter}
                                  onChange={(e) => setAdminGridRmFilter(e.target.value)}
                                  className="text-xs font-bold bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-gray-800 outline-none focus:border-zinc-900 shadow-sm"
                                >
                                  <option value="all">All {rmScorecards.length} Active RMs</option>
                                  {rmScorecards.map((rm) => (
                                    <option key={rm.rmName} value={rm.rmName}>{rm.rmName}</option>
                                  ))}
                                </select>
                              </div>

                              {/* Open RM Scorecards Button (Moved from TL analytics) */}
                              <button
                                onClick={() => setActiveTab('scorecard')}
                                className="text-xs font-bold text-zinc-900 hover:text-black bg-zinc-100 hover:bg-zinc-200 px-3.5 py-1.5 rounded-lg border border-zinc-300 transition-all flex items-center gap-1.5 shadow-sm"
                              >
                                <span>Open RM Scorecards</span>
                                <span>→</span>
                              </button>
                            </div>
                          </div>

                          {/* Filtered Grid of RMs */}
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                            {rmScorecards.length === 0 ? (
                              <div className="col-span-full py-8 text-center text-xs text-gray-500 bg-white rounded-xl border border-dashed border-zinc-200">
                                No RM call scorecards recorded for this period.
                              </div>
                            ) : (
                              rmScorecards
                                .filter((rm) => adminGridRmFilter === 'all' || rm.rmName.toLowerCase() === adminGridRmFilter.toLowerCase())
                                .map((rm) => {
                                  const assignedTlObj = teamLeads.find((tl) =>
                                    tl.rms.some((n) => n.toLowerCase() === rm.rmName.toLowerCase())
                                  );
                                  const tlAssignment = assignedTlObj?.tlName || 'PCG';
                                  return (
                                    <div
                                      key={rm.rmName}
                                      onClick={() => { setSelectedRm(rm.rmName); setActiveTab('scorecard'); }}
                                      className="bg-white rounded-2xl border border-zinc-200 hover:border-zinc-400 hover:shadow-md transition-all p-4 flex items-start gap-3 cursor-pointer group"
                                    >
                                      <div className="w-12 h-12 rounded-full border border-zinc-300 bg-zinc-50 flex items-center justify-center font-bold text-xs text-zinc-900 shrink-0 tabular-nums">
                                        {rm.overallScore ? `${rm.overallScore}%` : '—'}
                                      </div>
                                      <div className="min-w-0 flex-1">
                                        <div className="flex items-center justify-between gap-1">
                                          <p className="font-bold text-sm text-zinc-900 group-hover:text-zinc-700 transition-colors truncate">
                                            {rm.rmName}
                                          </p>
                                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-600 shrink-0">
                                            Team {tlAssignment}
                                          </span>
                                        </div>
                                        <p className="text-xs text-zinc-500 mt-0.5 tabular-nums">{rm.totalCalls} calls • {rm.connectRate}% connect</p>
                                        <p className="text-[11px] text-zinc-700 font-medium truncate mt-1">
                                          Focus: {rm.topWeakness}
                                        </p>
                                      </div>
                                    </div>
                                  );
                                })
                            )}
                          </div>
                        </div>
                      )}

                      {/* 3. Team Coaching Insights (Dedicated Admin Section) */}
                      {selectedCategory === 'ai_coaching_insights' && (
                        <div className="bg-white rounded-2xl border border-[#E4E4E7] shadow-sm overflow-hidden p-6 space-y-6 animate-in fade-in duration-200">
                          {/* Header */}
                          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#F0F0F2] pb-4">
                            <div>
                              <div className="flex items-center gap-2.5">
                                <h3 className="text-base font-bold text-gray-900">
                                  Team Coaching Insights
                                </h3>
                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-800 border border-zinc-300">
                                  100% Team Coverage
                                </span>
                              </div>
                              <p className="text-xs text-gray-500 mt-1 max-w-2xl leading-relaxed">
                                Executive intelligence on AI coaching interventions delivered across all relationship managers, coaching topic concentration, trajectory improvement, and focus queues.
                              </p>
                            </div>
                          </div>

                          {calls.filter(c => c.aiCoachingTip).length === 0 ? (
                            <div className="p-8 text-center bg-zinc-50/50 rounded-xl border border-dashed border-zinc-200 space-y-2">
                              <p className="text-sm font-semibold text-zinc-800">No AI coaching tips recorded yet for this period.</p>
                              <p className="text-xs text-zinc-500 max-w-md mx-auto">
                                Automated coaching recommendations, parameter weakness trends, and improvement trajectories will appear dynamically as call evaluations are scored.
                              </p>
                            </div>
                          ) : (
                            <div className="space-y-6">
                              {/* Diagnostic KPI Cards */}
                              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                                <div className="p-4 rounded-xl border border-zinc-200 bg-zinc-50/50 space-y-1.5">
                                  <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-600 block">
                                    Team Members Coached
                                  </span>
                                  <div className="text-2xl font-bold tabular-nums text-gray-900">
                                    {new Set(calls.filter(c => c.aiCoachingTip).map(c => c.rmName)).size} RMs
                                  </div>
                                </div>

                                <div className="p-4 rounded-xl border border-zinc-200 bg-zinc-50/50 space-y-1.5">
                                  <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-500 block">
                                    Total AI Coaching Insights
                                  </span>
                                  <div className="text-2xl font-bold tabular-nums text-gray-900">
                                    {calls.filter(c => c.aiCoachingTip).length} Insights
                                  </div>
                                </div>

                                <div className="p-4 rounded-xl border border-zinc-200 bg-zinc-50/50 space-y-1.5">
                                  <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-600 block">
                                    Calls Under 85%
                                  </span>
                                  <div className="text-2xl font-bold tabular-nums text-zinc-900">
                                    {calls.filter(c => c.iqsScore != null && c.iqsScore < 85).length} Calls
                                  </div>
                                </div>

                                <div className="p-4 rounded-xl border border-zinc-200 bg-zinc-50/50 space-y-1.5">
                                  <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-600 block">
                                    Compliance Flags
                                  </span>
                                  <div className="text-2xl font-bold tabular-nums text-zinc-900">
                                    {calls.filter(c => c.gates?.status === 'FAIL').length} Flags
                                  </div>
                                </div>
                              </div>

                              {/* Recent Coaching Recommendations */}
                              <div className="space-y-3">
                                <h4 className="text-xs font-bold text-gray-900 uppercase tracking-wider">
                                  Recent Coaching Recommendations
                                </h4>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                  {calls.filter(c => c.aiCoachingTip).slice(0, 6).map((call) => (
                                    <div key={call.id} className="p-4 rounded-xl border border-[#E4E4E7] bg-white space-y-2">
                                      <div className="flex items-center justify-between">
                                        <span className="font-bold text-xs text-gray-900">{call.rmName}</span>
                                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-zinc-100 text-zinc-700">
                                          {call.category}
                                        </span>
                                      </div>
                                      <p className="text-xs text-zinc-600 italic">"{call.aiCoachingTip}"</p>
                                      <div className="flex items-center justify-between pt-1 text-[11px] text-zinc-500">
                                        <span>Score: {call.iqsScore ? `${call.iqsScore}%` : '—'}</span>
                                        <button
                                          onClick={() => {
                                            setSelectedRm(call.rmName);
                                            setActiveTab('scorecard');
                                          }}
                                          className="font-bold text-zinc-900 hover:underline cursor-pointer"
                                        >
                                          View RM Scorecard →
                                        </button>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}



                  {/* ── 4. CATEGORY FILTER PILLS ────────────────────────────────────────── */}
                  <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-3 rounded-xl border border-[#E4E4E7]">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs text-[#71717A] font-semibold mr-1">Call Category:</span>
                      <button
                        onClick={() => {
                          setSelectedCategory('all');
                          setPage(1);
                        }}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${selectedCategory === 'all'
                          ? 'bg-[#111111] text-white shadow-sm'
                          : 'bg-[#F4F4F5] text-[#71717A] hover:text-[#111111]'
                          }`}
                      >
                        All Categories ({summary?.answeredCalls ?? summary?.totalCalls ?? totalCallsCount})
                      </button>
                      <button
                        onClick={() => {
                          setSelectedCategory('13_pitching');
                          setPage(1);
                        }}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${selectedCategory === '13_pitching'
                          ? 'bg-[#111111] text-white shadow-sm'
                          : 'bg-[#F4F4F5] text-[#71717A] hover:text-[#111111]'
                          }`}
                      >
                        13% Club / Pitching
                      </button>
                      <button
                        onClick={() => {
                          setSelectedCategory('upselling');
                          setPage(1);
                        }}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${selectedCategory === 'upselling'
                          ? 'bg-[#111111] text-white shadow-sm'
                          : 'bg-[#F4F4F5] text-[#71717A] hover:text-[#111111]'
                          }`}
                      >
                        Upselling Calls
                      </button>
                      <button
                        onClick={() => {
                          setSelectedCategory('support');
                          setPage(1);
                        }}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${selectedCategory === 'support'
                          ? 'bg-[#111111] text-white shadow-sm'
                          : 'bg-[#F4F4F5] text-[#71717A] hover:text-[#111111]'
                          }`}
                      >
                        General / Support
                      </button>

                      {/* Admin Dedicated View Pills */}
                      {activePersona === 'admin' && (
                        <>
                          <button
                            onClick={() => setSelectedCategory(selectedCategory === 'tl_analytics' ? 'all' : 'tl_analytics')}
                            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${selectedCategory === 'tl_analytics'
                              ? 'bg-[#111111] text-white shadow-sm'
                              : 'bg-zinc-100 text-zinc-800 border border-zinc-200 hover:bg-zinc-200'
                              }`}
                          >
                            Overall TL Analytics
                          </button>
                          <button
                            onClick={() => setSelectedCategory(selectedCategory === 'rm_performance' ? 'all' : 'rm_performance')}
                            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${selectedCategory === 'rm_performance'
                              ? 'bg-[#111111] text-white shadow-sm'
                              : 'bg-zinc-100 text-zinc-800 border border-zinc-200 hover:bg-zinc-200'
                              }`}
                          >
                            Team-Wide RM Performance
                          </button>
                          <button
                            onClick={() => setSelectedCategory(selectedCategory === 'ai_coaching_insights' ? 'all' : 'ai_coaching_insights')}
                            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${selectedCategory === 'ai_coaching_insights'
                              ? 'bg-[#111111] text-white shadow-sm'
                              : 'bg-zinc-100 text-zinc-800 border border-zinc-200 hover:bg-zinc-200'
                              }`}
                          >
                            Team Coaching Insights
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {/* ── 6. CALLS AUDIT LIST ────────────────────────────────────────────── */}
                  {selectedCategory !== 'ai_coaching_insights' && (
                    <div id="pcg-calls-table" className="bg-white rounded-xl border border-[#E4E4E7] overflow-hidden">

                      <div className="p-4 border-b border-[#E4E4E7] flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <h3 className="text-sm font-bold text-[#111111]">
                            {activePersona === 'agent'
                              ? 'My Evaluated Calls'
                              : statusFilter === 'needs_attention'
                                ? 'Attention Queue (<85% IQS Calls)'
                                : 'Evaluated Call Audits'}
                          </h3>
                          <p className="text-xs text-[#71717A] mt-0.5">
                            Showing {displayedEvaluatedCalls.length} calls • Auto-categorised with separate quality parameters
                          </p>
                        </div>

                        <div className="flex items-center gap-2.5 flex-wrap">
                          {activePersona !== 'agent' && (
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs text-[#71717A] font-medium">{activePersona === 'tl' ? 'Team Member:' : 'Agent:'}</span>
                              <select
                                id="table-agent-filter"
                                value={adminRmFilter}
                                onChange={(e) => {
                                  setAdminRmFilter(e.target.value);
                                  setPage(1);
                                }}
                                className="text-xs font-semibold border border-[#E4E4E7] rounded-lg px-2.5 py-1.5 bg-zinc-50 text-gray-800 outline-none shadow-2xs focus:border-[#111111] cursor-pointer"
                              >
                                <option value="all">
                                  {activePersona === 'tl'
                                    ? `All Team Members (${availableRmsForTable.length})`
                                    : `All Agents (${availableRmsForTable.length})`}
                                </option>
                                {availableRmsForTable.map((r: { name: string; count: number }) => (
                                  <option key={r.name} value={r.name}>
                                    {r.name}
                                  </option>
                                ))}
                              </select>
                            </div>
                          )}

                          {/* Min IQS Input */}
                          <input
                            id="table-min-iqs-input"
                            type="number"
                            min={0}
                            max={100}
                            placeholder="Min IQS"
                            value={minIqsFilter}
                            onChange={(e) => {
                              const val = e.target.value;
                              if (val === '') {
                                setMinIqsFilter('');
                                setPage(1);
                              } else {
                                const n = parseFloat(val);
                                if (!isNaN(n)) {
                                  if (n < 0) setMinIqsFilter('0');
                                  else if (n > 100) setMinIqsFilter('100');
                                  else setMinIqsFilter(val);
                                  setPage(1);
                                }
                              }
                            }}
                            className={`w-24 text-xs border rounded-lg px-3 py-1.5 outline-none shadow-2xs bg-white text-zinc-900 placeholder:text-zinc-400 transition-colors [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${minIqsFilter !== ''
                              ? 'border-[#111111] ring-1 ring-[#111111]'
                              : 'border-[#E4E4E7] focus:border-[#111111]'
                              }`}
                          />

                          {/* Max IQS Input */}
                          <input
                            id="table-max-iqs-input"
                            type="number"
                            min={0}
                            max={100}
                            placeholder="Max IQS"
                            value={maxIqsFilter}
                            onChange={(e) => {
                              const val = e.target.value;
                              if (val === '') {
                                setMaxIqsFilter('');
                                setPage(1);
                              } else {
                                const n = parseFloat(val);
                                if (!isNaN(n)) {
                                  if (n < 0) setMaxIqsFilter('0');
                                  else if (n > 100) setMaxIqsFilter('100');
                                  else setMaxIqsFilter(val);
                                  setPage(1);
                                }
                              }
                            }}
                            className={`w-24 text-xs border rounded-lg px-3 py-1.5 outline-none shadow-2xs bg-white text-zinc-900 placeholder:text-zinc-400 transition-colors [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${maxIqsFilter !== ''
                              ? 'border-[#111111] ring-1 ring-[#111111]'
                              : 'border-[#E4E4E7] focus:border-[#111111]'
                              }`}
                          />

                          {(minIqsFilter !== '' || maxIqsFilter !== '') && (
                            <button
                              type="button"
                              onClick={() => {
                                setMinIqsFilter('');
                                setMaxIqsFilter('');
                                setPage(1);
                              }}
                              title="Reset IQS filters"
                              className="text-[11px] font-semibold text-zinc-600 hover:text-black underline px-1 py-1 cursor-pointer"
                            >
                              Reset IQS
                            </button>
                          )}

                          <input
                            type="text"
                            placeholder={activePersona === 'agent' ? "Search Client Name..." : "Search Client or RM Name..."}
                            value={searchQuery}
                            onChange={(e) => {
                              setSearchQuery(e.target.value);
                              setPage(1);
                            }}
                            className="text-xs border border-[#E4E4E7] rounded-lg px-3 py-1.5 w-52 outline-none focus:border-[#111111] shadow-2xs bg-white"
                          />
                        </div>
                      </div>

                      {loading ? (
                        <div className="p-12 text-center text-zinc-400 text-xs">Loading PCG calls data...</div>
                      ) : displayedEvaluatedCalls.length === 0 ? (
                        <div className="p-12 text-center text-zinc-400 text-xs">No calls match the selected filters.</div>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-left border-collapse text-xs">
                            <thead>
                              <tr className="bg-[#FAFAFB] border-b border-[#E4E4E7] text-[#6B6B6B] font-semibold uppercase tracking-wider">
                                {activePersona !== 'agent' && <th className="py-3 px-4">RM Name</th>}
                                <th className="py-3 px-4">Client Name</th>
                                <th className="py-3 px-4">Call Category</th>
                                <th className="py-3 px-4">IQS Score</th>
                                <th className="py-3 px-4">Compliance Mistake</th>
                                <th className="py-3 px-4 text-center">Action</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-[#F0F0F2]">
                              {displayedEvaluatedCalls.map((call) => {
                                const isExpanded = expandedCallId === call.id;
                                return (
                                  <React.Fragment key={call.id}>
                                    <tr
                                      onClick={() => {
                                        setExpandedCallId(isExpanded ? null : call.id);
                                      }}
                                      className={`hover:bg-zinc-50 transition-colors cursor-pointer ${call.needsAttention ? 'bg-zinc-50' : ''
                                        } ${isExpanded ? 'bg-zinc-50 font-medium' : ''}`}
                                    >
                                      {activePersona !== 'agent' && (
                                        <td className="py-3 px-4 font-semibold text-zinc-800">
                                          {call.rmName}
                                        </td>
                                      )}

                                      <td className="py-3 px-4">
                                        <span className="font-semibold text-zinc-900">{call.clientName || 'Investor Client'}</span>
                                      </td>

                                      <td className="py-3 px-4">
                                        <div className="flex flex-col gap-1 items-start">
                                          <span className="inline-flex px-2 py-0.5 rounded text-[11px] font-semibold bg-zinc-100 text-zinc-800 border border-zinc-200">
                                            {call.category}
                                          </span>
                                          {call.secondaryCategories && call.secondaryCategories.length > 0 && (
                                            <span
                                              title={call.aiCategoryReasoning || `Also discussed: ${call.secondaryCategories.join(', ')}`}
                                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-zinc-100 text-zinc-700 border border-zinc-200 shadow-2xs"
                                            >
                                              <span className="font-bold text-zinc-500">+</span>
                                              <span>{call.secondaryCategories.join(', ')}</span>
                                            </span>
                                          )}
                                        </div>
                                      </td>

                                      <td className="py-3 px-4">
                                        {getScoreBadge(call.iqsScore)}
                                      </td>

                                      <td className="py-3 px-4 font-semibold">
                                        {call.gates.status === 'PASS' ? (
                                          <span className="text-zinc-600 font-medium" title="No compliance mistake detected">No</span>
                                        ) : (
                                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold text-red-700 bg-red-50 border border-red-200" title={call.gates.reason || 'Compliance violation detected'}>Yes</span>
                                        )}
                                      </td>

                                      {/* Actions */}
                                      <td className="py-3 px-4 text-center" onClick={(e) => e.stopPropagation()}>
                                        <button
                                          onClick={() => {
                                            setExpandedCallId(isExpanded ? null : call.id);
                                          }}
                                          className="px-3 py-1 rounded-md bg-zinc-900 hover:bg-zinc-800 text-white font-semibold transition-colors text-xs shadow-sm inline-flex items-center gap-1.5"
                                        >
                                          <span>{isExpanded ? 'Hide' : activePersona === 'tl' ? 'Review' : 'View Details'}</span>
                                          <span className="text-[10px] opacity-70">
                                            {isExpanded ? '▲' : '▼'}
                                          </span>
                                        </button>
                                      </td>
                                    </tr>

                                    {isExpanded && (
                                      <CallEvalPanel
                                        callId={call.callId || call.id.toString()}
                                        hideShowChat={true}
                                        isPcg={true}
                                        mobileNumber={call.phoneNumber}
                                        agentName={call.rmName}
                                        iqsScore={call.iqsScore}
                                        calledAt={call.startTime || '2026-10-18T14:04:00.000Z'}
                                        disposition={call.category}
                                        gates={call.gates}
                                        iqsScores={formatCallIqsScores(call)}
                                        initialSegments={formatCallSegments(call)}
                                        initialRecordingUrl={`/api/admin/pcg-calls/audio?id=${encodeURIComponent(call.id)}`}
                                        mode={activePersona === 'tl' ? 'submit' : 'view'}
                                        allowRaiseDispute={activePersona === 'agent'}
                                        allowReevaluate={activePersona === 'tl'}
                                        colSpan={activePersona !== 'agent' ? 6 : 5}
                                        onDone={() => setExpandedCallId(null)}
                                        onClose={() => setExpandedCallId(null)}
                                        onDisputeRaised={() => fetchData()}
                                        onOverrideSubmit={async (overrideData) => {
                                          handleOverrideFromPanel(call.callId || call.id.toString(), overrideData);
                                          setExpandedCallId(null);
                                        }}
                                        onReevaluate={(cid, revisedIqs) => {
                                          setCalls((prev) =>
                                            prev.map((c) =>
                                              c.id === call.id || c.callId === call.id
                                                ? { ...c, iqsScore: revisedIqs, needsAttention: revisedIqs < 85 }
                                                : c
                                            )
                                          );
                                        }}
                                      />
                                    )}
                                  </React.Fragment>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}

                      {/* Pagination Controls */}
                      {totalPages > 1 && (
                        <div className="p-3.5 border-t border-[#E4E4E7] bg-[#FAFAFB] flex items-center justify-between">
                          <button
                            disabled={page <= 1}
                            onClick={() => setPage((p) => Math.max(1, p - 1))}
                            className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-[#E4E4E7] bg-white text-zinc-700 hover:bg-zinc-50 disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
                          >
                            ← Previous
                          </button>
                          <span className="text-xs text-[#71717A]">
                            Page <span className="font-semibold text-zinc-900">{page}</span> of{' '}
                            <span className="font-semibold text-zinc-900">{totalPages}</span>
                          </span>
                          <button
                            disabled={page >= totalPages}
                            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                            className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-[#E4E4E7] bg-white text-zinc-700 hover:bg-zinc-50 disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
                          >
                            Next →
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </main>
      </div>

      {/* ── SLIDE-OVER CALL VIEW & EVALUATION DRAWER ───────────────────────── */}
      {activeCallAudit && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-5xl xl:max-w-6xl bg-[#f8fafc] h-full shadow-2xl flex flex-col overflow-y-auto p-4 animate-in slide-in-from-right duration-200">
            {activeCallAudit.isAnswered ? (
              <CallEvalPanel
                standalone={true}
                callId={activeCallAudit.callId || activeCallAudit.id.toString()}
                hideShowChat={true}
                isPcg={true}
                mobileNumber={activeCallAudit.phoneNumber}
                agentName={activeCallAudit.rmName}
                iqsScore={activeCallAudit.iqsScore}
                calledAt={activeCallAudit.startTime || '2026-10-18T14:04:00.000Z'}
                disposition={activeCallAudit.category}
                gates={activeCallAudit.gates}
                iqsScores={formatCallIqsScores(activeCallAudit)}
                initialSegments={formatCallSegments(activeCallAudit)}
                initialRecordingUrl={`/api/admin/pcg-calls/audio?id=${encodeURIComponent(activeCallAudit.id)}`}
                mode={activePersona === 'tl' ? 'submit' : 'view'}
                allowRaiseDispute={activePersona === 'agent'}
                allowReevaluate={activePersona === 'tl'}
                onDone={() => setActiveCallAudit(null)}
                onClose={() => setActiveCallAudit(null)}
                onDisputeRaised={() => fetchData()}
                onOverrideSubmit={async (overrideData) => {
                  handleOverrideFromPanel(activeCallAudit.callId || activeCallAudit.id.toString(), overrideData);
                }}
                onReevaluate={(cid, revisedIqs) => {
                  setCalls((prev) =>
                    prev.map((c) =>
                      c.id === activeCallAudit.id || c.callId === activeCallAudit.id
                        ? { ...c, iqsScore: revisedIqs, needsAttention: revisedIqs < 85 }
                        : c
                    )
                  );
                  setActiveCallAudit((prev) =>
                    prev ? { ...prev, iqsScore: revisedIqs, needsAttention: revisedIqs < 85 } : null
                  );
                }}
              />
            ) : (
              <div className="p-6 bg-white rounded-xl border border-zinc-200 space-y-4">
                <div className="flex items-center justify-between border-b border-zinc-200 pb-3">
                  <h3 className="font-bold text-base text-zinc-900">
                    Call Evaluation Panel — ID: {formatCallId(activeCallAudit.callId, activeCallAudit.id)} ({activeCallAudit.rmName})
                  </h3>
                  <button
                    onClick={() => setActiveCallAudit(null)}
                    className="w-7 h-7 rounded border border-zinc-200 flex items-center justify-center text-zinc-500 hover:text-zinc-900 text-sm font-bold"
                  >
                    ✕
                  </button>
                </div>
                <div className="p-4 bg-zinc-50 rounded-xl border border-zinc-200 space-y-2">
                  <div className="flex items-center gap-2 text-zinc-900 font-bold text-xs uppercase tracking-wider">
                    Dialer Disconnect Diagnostic
                  </div>
                  <p className="text-xs font-semibold text-zinc-900">
                    Party Disconnected: {activeCallAudit.unansweredBy === 'RM' ? 'RM Disconnected Early (<5s)' : 'Customer Rang Out / No Pickup'}
                  </p>
                  <p className="text-xs text-zinc-700">
                    Reason: <span className="font-mono font-bold text-zinc-900">{activeCallAudit.unansweredReason}</span>
                  </p>
                  <p className="text-[11px] text-zinc-600">
                    Dialer placed outbound call to {activeCallAudit.phoneNumber}. Customer handset did not bridge voice connection, hence no conversation audio or IQS scorecard was generated.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
