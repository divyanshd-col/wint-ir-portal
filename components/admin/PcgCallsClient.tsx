'use client';

import React, { useEffect, useState, useRef } from 'react';
import { useSession, signOut } from 'next-auth/react';
import { IQSRing, IQSPill } from '@/components/quality/IQSRing';
import { iqsTheme } from '@/lib/quality';
import PcgScorecardView from './PcgScorecardView';
import WorkspaceSwitcher from '@/components/WorkspaceSwitcher';

// Type definitions
interface CallParameter {
  id: string;
  name: string;
  maxScore: number;
  earnedScore: number;
  status: 'Yes' | 'Half' | 'No';
  quote: string;
}

interface TranscriptTurn {
  speaker: 'RM' | 'Customer';
  text: string;
  time: string;
}

interface PCGCall {
  id: string;
  callId: string;
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
  iqsScore: number;
  gates: { status: 'PASS' | 'FAIL'; reason?: string };
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

export type PcgTab = 'calls' | 'scorecard' | 'disputes';

export const getRunoCallUrl = (callId: string | null | undefined) => {
  if (!callId) return 'https://app-call.runo.in';
  return `https://app-call.runo.in/#call/${encodeURIComponent(callId)}`;
};

export const formatCallId = (callId: string | null | undefined, fallbackId: string) => {
  if (!callId) return fallbackId;
  return callId.startsWith('runo-') ? callId.replace('runo-', '') : callId.slice(-6);
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
    userRole === 'agent' && loggedInUserName ? loggedInUserName : 'Aahan Thaker'
  );

  useEffect(() => {
    if (userRole === 'agent') {
      setActivePersona('agent');
      if (loggedInUserName) setSelectedRm(loggedInUserName);
    } else if (userRole === 'tl') {
      setActivePersona('tl');
    } else {
      setActivePersona('admin');
    }
  }, [userRole, loggedInUserName]);

  // Sync tab with URL search params
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search);
      const tabParam = urlParams.get('tab');
      if (tabParam === 'scorecard' || tabParam === 'disputes' || tabParam === 'calls') {
        setActiveTab(tabParam as PcgTab);
      }
    }
  }, []);

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
  const [rmScorecards, setRmScorecards] = useState<RmScorecard[]>([]);
  const [teamLeads, setTeamLeads] = useState<TeamLeadSummary[]>([]);
  const [rms, setRms] = useState<{ name: string; count: number }[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // Common filters
  const [selectedCategory, setSelectedCategory] = useState<'all' | '13_pitching' | 'upselling' | 'support' | 'coaching_available' | 'tl_analytics' | 'rm_performance' | 'ai_coaching_insights'>('all');
  const [adminGridRmFilter, setAdminGridRmFilter] = useState<string>('all');
  const [adminBannerTlSelect, setAdminBannerTlSelect] = useState<'all' | 'Gokul' | 'Vaishnavi'>('all');
  const [dateRange, setDateRange] = useState<'7d' | '30d' | 'custom'>('7d');
  const [customStartDate, setCustomStartDate] = useState('2026-10-01');
  const [customEndDate, setCustomEndDate] = useState('2026-10-12');
  const [selectedTl, setSelectedTl] = useState<string>('Gokul');
  const [adminTlFilter, setAdminTlFilter] = useState<'all' | 'Gokul' | 'Vaishnavi'>('all');
  const [adminRmFilter, setAdminRmFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'answered' | 'unanswered' | 'needs_attention'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  // Active call view state
  const [activeCallAudit, setActiveCallAudit] = useState<PCGCall | null>(null);

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

  // Profile Menu Dropdown State
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!profileMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!profileMenuRef.current?.contains(e.target as Node)) {
        setProfileMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setProfileMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [profileMenuOpen]);

  useEffect(() => {
    fetchData();
  }, [selectedCategory, dateRange, customStartDate, customEndDate, statusFilter, page, selectedTl, selectedRm, adminTlFilter, adminRmFilter]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({
        page: page.toString(),
        limit: '25',
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
      } else if (activePersona === 'tl' && selectedTl) {
        p.set('tl_name', selectedTl);
      } else if (activePersona === 'admin') {
        if (adminTlFilter !== 'all') p.set('tl_name', adminTlFilter);
        if (adminRmFilter !== 'all') p.set('rm_name', adminRmFilter);
      }
      if (searchQuery.trim()) {
        p.set('search', searchQuery.trim());
      }

      const res = await fetch(`/api/admin/pcg-calls?${p.toString()}`);
      if (!res.ok) throw new Error('Failed to load PCG calls');
      const data = await res.json();
      setCalls(data.calls || []);
      setRmScorecards(data.rmScorecards || []);
      setTeamLeads(data.teamLeads || []);
      setRms(data.rms || []);
      setSummary(data.summary || null);
      setTotalPages(data.totalPages || 1);
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
    setSelectedCategory('coaching_available');
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
  const handleSubmitDispute = () => {
    if (!activeCallAudit) return;
    setSubmittingDispute(true);
    const challengedParams = Object.keys(disputeSelectedParams).filter(k => disputeSelectedParams[k]);
    const challengedPrefix = challengedParams.length > 0 
      ? `Parameters challenged: ${challengedParams.join(', ')}. ` 
      : '';
    const reason = (challengedPrefix + (agentDisputeNote || 'Agent requested evaluation review on score.')).trim();

    const updatedCall: PCGCall = {
      ...activeCallAudit,
      disputeStatus: 'pending',
      disputeReason: reason,
    };

    setCalls(prev => prev.map(c => c.id === activeCallAudit.id ? updatedCall : c));
    setActiveCallAudit(updatedCall);
    setSubmittingDispute(false);
    setIsRaisingDispute(false);
    setDisputeFeedback('Dispute submitted to Team Leader for review.');
    setTimeout(() => setDisputeFeedback(null), 5000);
  };

  // Action: TL Overrides Score Inline (matching Calls)
  const handleSubmitOverride = () => {
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

    const updatedCall: PCGCall = {
      ...activeCallAudit,
      parameters: updatedParams,
      iqsScore: revisedScore,
      needsAttention: revisedScore < 85,
      disputeStatus: activeCallAudit.disputeStatus === 'pending' ? 'resolved' : 'overridden',
      tlOverrideNote: overrideNoteInput || 'TL manual parameter score override.',
    };

    setCalls(prev => prev.map(c => c.id === activeCallAudit.id ? updatedCall : c));
    setActiveCallAudit(updatedCall);
    setSavingOverride(false);
    setOverrideFeedback('Evaluation override submitted successfully.');
    setOverrideNoteInput('');
    setTimeout(() => setOverrideFeedback(null), 5000);
  };

  // Action: TL Resolves Dispute Inline
  const handleResolveDispute = (approve: boolean) => {
    if (!activeCallAudit) return;
    const newScore = approve ? Math.min(100, activeCallAudit.iqsScore + 8) : activeCallAudit.iqsScore;
    const updatedCall: PCGCall = {
      ...activeCallAudit,
      disputeStatus: 'resolved',
      iqsScore: newScore,
      needsAttention: newScore < 85,
      tlOverrideNote: approve ? 'Dispute approved by TL (+8 pts revised).' : 'Dispute reviewed and retained by TL.',
    };

    setCalls(prev => prev.map(c => c.id === activeCallAudit.id ? updatedCall : c));
    setActiveCallAudit(updatedCall);
    setOverrideFeedback(approve ? 'Dispute approved and score updated.' : 'Dispute resolved (original score maintained).');
    setTimeout(() => setOverrideFeedback(null), 5000);
  };

  // Open Call View by ID (used by RM Scorecard evidence links)
  const handleOpenCallById = (cid: string) => {
    const cleanId = cid.replace('#', '').trim();
    const found = calls.find(
      (c) => c.id === cleanId || c.callId === cleanId || c.id.includes(cleanId) || c.callId.includes(cleanId)
    );
    if (found) {
      handleOpenCallView(found);
    } else {
      const syntheticCall: PCGCall = {
        id: cleanId,
        callId: cleanId,
        rmName: selectedRm,
        tlName: selectedTl,
        phoneNumber: '+91 98765 43210',
        callType: 'Outbound',
        tag: '13% Pitch',
        durationSeconds: 245,
        startTime: '2026-10-10 14:30',
        isAnswered: true,
        hasRecording: true,
        category: '13% Club / Pitching',
        categoryKey: '13_pitching',
        iqsScore: 68,
        gates: { status: 'FAIL', reason: 'Mandatory risk disclosures omitted' },
        needsAttention: true,
        unansweredBy: null,
        unansweredReason: null,
        disputeStatus: 'none',
        aiCoachingTip: 'Ensure SEBI capital risk disclosure is provided immediately after stating 13% indicative yields.',
        transcriptTurns: [
          { speaker: 'RM', time: '00:05', text: `Good afternoon, this is ${selectedRm} from Wint Wealth PCG team. Am I speaking with Mr. Sharma?` },
          { speaker: 'Customer', time: '00:10', text: 'Yes, speaking. What is this regarding?' },
          { speaker: 'RM', time: '00:15', text: 'I am calling regarding our new 13% Club senior secured debenture tranche opening today.' },
          { speaker: 'Customer', time: '00:22', text: 'Is this return guaranteed? I had bad experience with peer-to-peer debt.' },
          { speaker: 'RM', time: '00:28', text: 'You are guaranteed 13% with zero chance of capital loss because the issuer has asset backing.' },
          { speaker: 'Customer', time: '00:35', text: 'Okay, send me the details on WhatsApp.' },
          { speaker: 'RM', time: '00:40', text: 'Sure, thank you.' },
        ],
        parameters: [
          { id: 'P1', name: 'Greeting & Consent', maxScore: 10, earnedScore: 10, status: 'Yes', quote: 'Professional greeting confirmed.' },
          { id: 'P2', name: 'Investor Profiling', maxScore: 20, earnedScore: 5, status: 'No', quote: 'No debt allocation horizon profiling asked.' },
          { id: 'P3', name: '13% Yield & Tranche Pitch', maxScore: 25, earnedScore: 20, status: 'Yes', quote: 'Explained coupon structure.' },
          { id: 'P4', name: 'SEBI Risk & Disclaimers', maxScore: 20, earnedScore: 0, status: 'No', quote: 'Stated guaranteed with zero chance of capital loss.' },
          { id: 'P5', name: 'Objection Handling', maxScore: 15, earnedScore: 8, status: 'Half', quote: 'Addressed p2p concern partially.' },
          { id: 'P6', name: 'Post-Call Recap & CRM', maxScore: 10, earnedScore: 5, status: 'Half', quote: 'Abrupt closing.' },
        ],
      };
      handleOpenCallView(syntheticCall);
    }
  };

  // Helper formatting
  const formatDuration = (secs: number) => {
    if (!secs) return '00:00';
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const getScoreBadge = (score: number) => {
    if (!score) return <span className="text-gray-400 font-mono text-xs">—</span>;
    let bg = 'bg-red-50 text-red-700 border-red-200';
    if (score >= 85) bg = 'bg-emerald-50 text-emerald-800 border-emerald-200';
    else if (score >= 70) bg = 'bg-amber-50 text-amber-800 border-amber-200';

    return (
      <span className={`inline-flex items-center justify-center font-mono font-bold text-xs px-2.5 py-0.5 rounded-md border ${bg}`}>
        {score}%
      </span>
    );
  };

  const disputeRaisedCalls = calls.filter((c) => c.disputeStatus === 'pending');
  const disputeReviewedCalls = calls.filter((c) => c.disputeStatus === 'resolved' || c.disputeStatus === 'overridden');

  // RM Scorecard lookups & real computed metrics for RM view
  const currentRmScorecard = rmScorecards.find((r) => r.rmName.toLowerCase() === selectedRm.toLowerCase());
  const myScorecard = currentRmScorecard || rmScorecards[0];
  const rmAnsweredCalls = calls.filter((c) => c.isAnswered);
  const rmQualityScore = rmAnsweredCalls.length > 0
    ? (rmAnsweredCalls.reduce((acc, c) => acc + c.iqsScore, 0) / rmAnsweredCalls.length).toFixed(1)
    : (currentRmScorecard ? `${currentRmScorecard.overallScore}.0` : '87.0');

  const rmTotalCallsCount = summary?.totalCalls ?? calls.length;
  const rmAnsweredCallsCount = summary?.answeredCalls ?? rmAnsweredCalls.length;
  const rmUnansweredCallsCount = summary?.unansweredCalls ?? Math.max(0, rmTotalCallsCount - rmAnsweredCallsCount);
  const rmConnectRate = rmTotalCallsCount > 0
    ? Math.round((rmAnsweredCallsCount / rmTotalCallsCount) * 100)
    : 60;

  const rmRankIndex = rmScorecards.findIndex(
    (s) => s.rmName.toLowerCase() === selectedRm.toLowerCase()
  );
  const rmRankDisplay = rmRankIndex >= 0 ? `#${rmRankIndex + 1}` : '#2';

  const teamRms = selectedTl === 'Vaishnavi' ? ['Vikram', 'Sneha', 'Karan', 'Meera'] : ['Aahan Thaker', 'Dhanush', 'Priya', 'Rahul', 'Ananya'];
  const teamRmScorecards = rmScorecards.filter((r) => teamRms.includes(r.rmName)).length > 0
    ? rmScorecards.filter((r) => teamRms.includes(r.rmName))
    : rmScorecards;

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
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all flex items-center gap-2 ${
              disputeTab === 'raised'
                ? 'bg-white text-[#111111] shadow-sm font-bold'
                : 'text-[#71717A] hover:text-[#111111]'
            }`}
          >
            <span>Dispute Raised</span>
            <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
              disputeRaisedCalls.length > 0 ? 'bg-amber-100 text-amber-800 border border-amber-200' : 'bg-zinc-200 text-zinc-600'
            }`}>
              {disputeRaisedCalls.length}
            </span>
          </button>

          <button
            onClick={() => setDisputeTab('reviewed')}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all flex items-center gap-2 ${
              disputeTab === 'reviewed'
                ? 'bg-white text-[#111111] shadow-sm font-bold'
                : 'text-[#71717A] hover:text-[#111111]'
            }`}
          >
            <span>✓</span>
            <span>Dispute Reviewed</span>
            <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
              disputeReviewedCalls.length > 0 ? 'bg-emerald-100 text-emerald-800 border border-emerald-200' : 'bg-zinc-200 text-zinc-600'
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
                  <th className="py-3 px-4">Call ID</th>
                  {activePersona !== 'agent' && <th className="py-3 px-4">RM Name</th>}
                  <th className="py-3 px-4">Category</th>
                  <th className="py-3 px-4">Customer Phone</th>
                  <th className="py-3 px-4">Current IQS</th>
                  <th className="py-3 px-4">Dispute Justification</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F0F0F2]">
                {disputeRaisedCalls.map((call) => (
                  <tr key={call.id} className="hover:bg-amber-50/20 transition-colors">
                    <td className="py-3 px-4">
                      <a
                        href={getRunoCallUrl(call.callId || call.id)}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={`Open in Runo CRM`}
                        className="inline-flex items-center gap-1 font-mono font-bold text-emerald-700 hover:text-emerald-900 hover:underline group cursor-pointer"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <span>#{formatCallId(call.callId, call.id)}</span>
                        <svg className="w-3 h-3 text-zinc-400 group-hover:text-emerald-700 transition-colors shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                      </a>
                    </td>
                    {activePersona !== 'agent' && (
                      <td className="py-3 px-4 font-semibold text-zinc-800">{call.rmName}</td>
                    )}
                    <td className="py-3 px-4">
                      <span className="inline-flex px-2 py-0.5 rounded text-[11px] font-semibold bg-zinc-100 text-zinc-700 border border-zinc-200">
                        {call.category}
                      </span>
                    </td>
                    <td className="py-3 px-4 font-mono text-zinc-600">{call.phoneNumber}</td>
                    <td className="py-3 px-4">{getScoreBadge(call.iqsScore)}</td>
                    <td className="py-3 px-4 text-amber-900 font-medium max-w-xs truncate">
                      "{call.disputeReason || 'Agent challenged parameter score.'}"
                    </td>
                    <td className="py-3 px-4">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
                         Pending TL Review
                      </span>
                    </td>
                    <td className="py-3 px-4 text-center">
                      <button
                        onClick={() => handleOpenCallView(call)}
                        className="px-3.5 py-1 rounded-md bg-zinc-900 hover:bg-zinc-800 text-white font-semibold transition-colors text-xs shadow-sm"
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))}
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
                  <th className="py-3 px-4">Call ID</th>
                  {activePersona !== 'agent' && <th className="py-3 px-4">RM Name</th>}
                  <th className="py-3 px-4">Category</th>
                  <th className="py-3 px-4">Customer Phone</th>
                  <th className="py-3 px-4">Revised IQS</th>
                  <th className="py-3 px-4">TL Resolution Note</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F0F0F2]">
                {disputeReviewedCalls.map((call) => (
                  <tr key={call.id} className="hover:bg-emerald-50/20 transition-colors">
                    <td className="py-3 px-4">
                      <a
                        href={getRunoCallUrl(call.callId || call.id)}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={`Open in Runo CRM`}
                        className="inline-flex items-center gap-1 font-mono font-bold text-emerald-700 hover:text-emerald-900 hover:underline group cursor-pointer"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <span>#{formatCallId(call.callId, call.id)}</span>
                        <svg className="w-3 h-3 text-zinc-400 group-hover:text-emerald-700 transition-colors shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                      </a>
                    </td>
                    {activePersona !== 'agent' && (
                      <td className="py-3 px-4 font-semibold text-zinc-800">{call.rmName}</td>
                    )}
                    <td className="py-3 px-4">
                      <span className="inline-flex px-2 py-0.5 rounded text-[11px] font-semibold bg-zinc-100 text-zinc-700 border border-zinc-200">
                        {call.category}
                      </span>
                    </td>
                    <td className="py-3 px-4 font-mono text-zinc-600">{call.phoneNumber}</td>
                    <td className="py-3 px-4">{getScoreBadge(call.iqsScore)}</td>
                    <td className="py-3 px-4 text-zinc-700 font-medium max-w-xs truncate">
                      "{call.tlOverrideNote || 'Dispute reviewed and resolved by Team Leader.'}"
                    </td>
                    <td className="py-3 px-4">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
                        <span>✓</span> Reviewed &amp; Resolved
                      </span>
                    </td>
                    <td className="py-3 px-4 text-center">
                      <button
                        onClick={() => handleOpenCallView(call)}
                        className="px-3.5 py-1 rounded-md bg-zinc-900 hover:bg-zinc-800 text-white font-semibold transition-colors text-xs shadow-sm"
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );

  return (
    <div className="min-h-screen bg-[#FAFAFB] text-[#111111] pb-24 font-sans">
      {/* ── TOP PERSONA SWITCHER HEADER ────────────────────────────────────── */}
      <div className="bg-white border-b border-[#E4E4E7] px-6 py-3.5 sticky top-0 z-30 flex flex-wrap items-center justify-between gap-4 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[#111111] flex items-center justify-center text-white font-bold text-sm">
            W
          </div>
          <div>
            <h1 className="text-base font-bold text-[#111111] leading-none">PCG Call Quality Analytics</h1>
            <p className="text-xs text-[#71717A] mt-0.5">PCG Team Voice Call Performance &amp; Quality Analytics</p>
          </div>
        </div>


        {/* Option Bar Switcher: Calls & Analytics | Scorecard | Disputes */}
        <div className="inline-flex items-center p-1 bg-[#F4F4F5] rounded-xl border border-[#E4E4E7]">
          <button
            onClick={() => handleTabChange('calls')}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all flex items-center gap-1.5 ${
              activeTab === 'calls'
                ? 'bg-white text-[#111111] shadow-sm font-bold'
                : 'text-[#71717A] hover:text-[#111111]'
            }`}
          >
            <span>Calls &amp; Analytics</span>
          </button>
          <button
            onClick={() => handleTabChange('scorecard')}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all flex items-center gap-1.5 ${
              activeTab === 'scorecard'
                ? 'bg-white text-[#111111] shadow-sm font-bold'
                : 'text-[#71717A] hover:text-[#111111]'
            }`}
          >
            <span>Scorecard</span>
          </button>
          <button
            onClick={() => handleTabChange('disputes')}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all flex items-center gap-1.5 ${
              activeTab === 'disputes'
                ? 'bg-white text-[#111111] shadow-sm font-bold'
                : 'text-[#71717A] hover:text-[#111111]'
            }`}
          >
            <span>Disputes</span>
            {disputeRaisedCalls.length > 0 && (
              <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                activeTab === 'disputes' ? 'bg-amber-100 text-amber-800 border border-amber-200' : 'bg-zinc-200 text-zinc-600'
              }`}>
                {disputeRaisedCalls.length}
              </span>
            )}
          </button>
        </div>

        {/* Global Date Selector */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-[#71717A] font-semibold">Date Range:</span>
          <select
            value={dateRange}
            onChange={(e) => setDateRange(e.target.value as any)}
            className="text-xs font-semibold border border-[#E4E4E7] rounded-lg px-3 py-1.5 bg-white text-[#111111] outline-none shadow-sm cursor-pointer"
          >
            <option value="7d">Last 7 Days</option>
            <option value="30d">Last 30 Days</option>
            <option value="custom">Custom Range (Calendar)</option>
          </select>

          {dateRange === 'custom' && (
            <div className="flex items-center gap-1.5 bg-white border border-[#E4E4E7] px-2 py-1 rounded-lg shadow-sm">
              <input
                type="date"
                value={customStartDate}
                onChange={(e) => setCustomStartDate(e.target.value)}
                className="text-xs font-mono bg-zinc-50 border border-[#E4E4E7] rounded px-2 py-1 text-[#111111] outline-none cursor-pointer"
              />
              <span className="text-xs text-[#71717A] font-medium">to</span>
              <input
                type="date"
                value={customEndDate}
                onChange={(e) => setCustomEndDate(e.target.value)}
                className="text-xs font-mono bg-zinc-50 border border-[#E4E4E7] rounded px-2 py-1 text-[#111111] outline-none cursor-pointer"
              />
            </div>
          )}

          {/* Workspace Switcher for Super Admins */}
          {(isSuperAdmin || platformDomain === 'both') && (
            <div className="ml-1">
              <WorkspaceSwitcher compact={true} />
            </div>
          )}

          {/* User Profile Menu with Dropdown Sign Out */}
          <div className="relative pl-3 ml-1 border-l border-[#E4E4E7]" ref={profileMenuRef}>
            <button
              type="button"
              onClick={() => setProfileMenuOpen((prev) => !prev)}
              aria-expanded={profileMenuOpen}
              aria-haspopup="menu"
              className="flex items-center gap-2 p-1.5 rounded-lg hover:bg-zinc-100 transition-colors cursor-pointer select-none"
            >
              <div className="w-7 h-7 rounded-full bg-[#111111] text-white flex items-center justify-center text-xs font-bold shadow-xs">
                {loggedInUserName ? loggedInUserName.slice(0, 2).toUpperCase() : 'AT'}
              </div>
              <div className="hidden sm:block text-left">
                <div className="text-xs font-bold text-[#111111] leading-tight flex items-center gap-1">
                  <span>{loggedInUserName || 'Aahan Thaker'}</span>
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className={`text-zinc-500 transition-transform ${profileMenuOpen ? 'rotate-180' : ''}`}
                  >
                    <path d="M4 6l4 4 4-4" />
                  </svg>
                </div>
                <div className="text-[10px] text-[#71717A] capitalize font-medium">{userRole === 'agent' ? 'RM' : userRole}</div>
              </div>
            </button>

            {/* Dropdown Menu */}
            {profileMenuOpen && (
              <div
                className="absolute right-0 top-full mt-2 w-56 bg-white rounded-xl shadow-lg border border-[#E4E4E7] py-1.5 z-50 text-left font-sans animate-in fade-in zoom-in-95 duration-100"
                role="menu"
              >
                <div className="px-3.5 py-2 border-b border-[#F4F4F5]">
                  <div className="text-xs font-bold text-[#111111]">{loggedInUserName || 'Aahan Thaker'}</div>
                  {session?.user?.email && (
                    <div className="text-[11px] text-[#71717A] truncate mt-0.5">{session.user.email}</div>
                  )}
                  <div className="mt-1.5">
                    <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-zinc-100 text-zinc-700">
                      {userRole === 'agent' ? 'RM / Agent' : userRole === 'tl' ? 'Team Lead' : 'Administrator'}
                    </span>
                  </div>
                </div>

                <div className="p-1">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setProfileMenuOpen(false);
                      signOut({ callbackUrl: '/login' });
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 16 16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M10 8H2M6 5l-3 3 3 3M7 2h5a1 1 0 011 1v10a1 1 0 01-1 1H7" />
                    </svg>
                    <span>Sign out</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {activeTab === 'scorecard' ? (
        <div className="max-w-7xl mx-auto px-6 pt-6">
          <PcgScorecardView
            activePersona={activePersona}
            selectedRm={selectedRm}
            onSelectRm={(rm) => setSelectedRm(rm)}
            selectedTl={selectedTl}
            onSelectTl={(tl) => setSelectedTl(tl)}
            onOpenCallView={(cid) => handleOpenCallById(cid)}
            onSwitchToCallsTab={() => handleTabChange('calls')}
          />
        </div>
      ) : activeTab === 'disputes' ? (
        <div className="max-w-7xl mx-auto px-6 pt-6 space-y-6">
          {/* Persona Header for Disputes - Only for TL and Admin */}
          {activePersona !== 'agent' && (
            <div className="flex flex-wrap items-center justify-between gap-4 bg-white p-4 rounded-xl border border-[#E4E4E7]">
              <div>
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider bg-zinc-100 text-zinc-700">
                    {activePersona === 'tl' ? 'Team Leadership Hub' : 'Executive Console'}
                  </span>
                  <h2 className="text-lg font-bold text-[#111111]">
                    {activePersona === 'tl'
                      ? `Team Quality Disputes — Team ${selectedTl}`
                      : 'Organization Disputes Console'}
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
        <div className="max-w-7xl mx-auto px-6 pt-6 space-y-6">
        {/* ── 1. PERSONA CONTEXT HEADER (Only for TL and Admin) ──────────────── */}
        {activePersona !== 'agent' && (
          <div className="flex flex-wrap items-center justify-between gap-4 bg-white p-4 rounded-xl border border-[#E4E4E7]">
            <div>
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider bg-zinc-100 text-zinc-700">
                  {activePersona === 'tl' ? 'Team Leadership Hub' : 'Executive Console'}
                </span>
                <h2 className="text-lg font-bold text-[#111111]">
                  {activePersona === 'tl'
                    ? `Team Leader Console — Team ${selectedTl}`
                    : 'Organization PCG Analytics & Administration'}
                </h2>
              </div>
              <p className="text-xs text-[#71717A] mt-1">
                {activePersona === 'tl'
                  ? 'Team oversight, low-score alerts (<85%), dropped call diagnostics, and RM scorecards.'
                  : 'Complete cross-team visibility across all RMs, Team Leads, and categories.'}
              </p>
            </div>

            {/* Switchers within persona - Only for TL and Admin, RM strictly sees own scores */}
            {activePersona === 'tl' && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-[#71717A]">Team Lead:</span>
                <select
                  value={selectedTl}
                  onChange={(e) => { setSelectedTl(e.target.value); setPage(1); }}
                  className="text-xs font-semibold border border-[#E4E4E7] rounded-lg px-3 py-1.5 bg-zinc-50"
                >
                  <option value="Gokul">Team Gokul (4 RMs)</option>
                  <option value="Vaishnavi">Team Vaishnavi (4 RMs)</option>
                </select>
              </div>
            )}

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
                    <option value="all">All Teams (Gokul &amp; Vaishnavi)</option>
                    <option value="Gokul">Team Gokul (5 RMs)</option>
                    <option value="Vaishnavi">Team Vaishnavi (4 RMs)</option>
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
                        if (adminTlFilter === 'Gokul') return ['Aahan Thaker', 'Dhanush', 'Yaashvi Arora', 'Samskriti Rao', 'Gaurav Nautiyal'].includes(r.name);
                        if (adminTlFilter === 'Vaishnavi') return ['Aravind', 'Sujal Dadwani', 'Antara Chakrabarty', 'Swati Singh'].includes(r.name);
                        return true;
                      })
                      .map((r) => (
                        <option key={r.name} value={r.name}>{r.name}</option>
                      ))}
                  </select>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── 2. TOP METRIC CARDS ────────────────────────────────────────────── */}
        <div className={`grid gap-4 ${activePersona === 'agent' ? 'grid-cols-1 sm:grid-cols-3' : 'grid-cols-2 md:grid-cols-4'}`}>
          <div className="bg-white p-4 rounded-xl border border-[#E4E4E7]">
            <p className="text-[11px] font-semibold text-[#71717A] uppercase tracking-wider">
              {activePersona === 'agent' ? 'My Quality Score' : activePersona === 'tl' ? 'Team Avg IQS' : 'Org Avg IQS'}
            </p>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-2xl font-extrabold font-mono text-[#111111]">
                {activePersona === 'agent' ? `${rmQualityScore}%` : activePersona === 'tl' ? '83.4%' : '84.2%'}
              </span>
              <span className="text-xs font-semibold text-emerald-600">▲ +2.4%</span>
            </div>
            <p className="text-[11px] text-[#71717A] mt-1">100% AI Automated audits</p>
          </div>

          <div className="bg-white p-4 rounded-xl border border-[#E4E4E7]">
            <p className="text-[11px] font-semibold text-[#71717A] uppercase tracking-wider">
              {activePersona === 'agent' ? 'My Total Calls' : 'Total Calls Attempted'}
            </p>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-2xl font-extrabold font-mono text-[#111111]">
                {activePersona === 'agent' ? rmTotalCallsCount : (summary?.totalCalls || 142)}
              </span>
              <span className="text-xs text-[#71717A]">calls</span>
            </div>
            <p className="text-[11px] text-[#71717A] mt-1">
              {activePersona === 'agent' ? rmAnsweredCallsCount : (summary?.answeredCalls || 97)} connected
            </p>
          </div>

          <div className="bg-white p-4 rounded-xl border border-[#E4E4E7]">
            <p className="text-[11px] font-semibold text-[#71717A] uppercase tracking-wider">Connect Rate</p>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-2xl font-extrabold font-mono text-[#111111]">
                {activePersona === 'agent' ? rmConnectRate : (summary?.totalCalls ? Math.round((summary.answeredCalls / summary.totalCalls) * 100) : 68)}%
              </span>
              <span className="text-xs text-[#71717A]">pickup</span>
            </div>
            <p className="text-[11px] text-[#71717A] mt-1">
              {activePersona === 'agent' ? rmUnansweredCallsCount : (summary?.unansweredCalls || 45)} unanswered
            </p>
          </div>

          {activePersona !== 'agent' && (
            <div className="bg-white p-4 rounded-xl border border-[#E4E4E7]">
              <p className="text-[11px] font-semibold text-[#71717A] uppercase tracking-wider">
                Needs Attention (&lt;85%)
              </p>
              <div className="flex items-baseline gap-2 mt-1">
                <span className="text-2xl font-extrabold font-mono text-[#111111]">
                  {summary?.needsAttentionCount || 28}
                </span>
                <span className="text-xs font-semibold text-amber-600">
                  calls flagged
                </span>
              </div>
              <p className="text-[11px] text-[#71717A] mt-1">
                Immediate coaching queue
              </p>
            </div>
          )}
        </div>

        {/* ── 3. UNANSWERED CALLS DIAGNOSTIC (Customer vs RM) ───────────────── */}
        {(activePersona === 'tl' || activePersona === 'admin') && (
          <div className="bg-white p-4 rounded-xl border border-[#E4E4E7] space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                
                <h3 className="text-sm font-bold text-[#111111]">Unanswered Calls Diagnostic (Who didn't connect?)</h3>
              </div>
              <span className="text-xs text-[#71717A]">
                Total Unanswered: <span className="font-mono font-bold text-[#111111]">{summary?.unansweredCalls || 446}</span>
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
              <div className="p-3 bg-zinc-50 rounded-lg border border-zinc-200">
                <div className="flex items-center justify-between font-semibold text-[#111111]">
                  <span>Customer Didn't Answer (81%)</span>
                  <span className="font-mono font-bold">{summary?.unansweredBreakdown?.customerRangOut + summary?.unansweredBreakdown?.customerBusy || 362} calls</span>
                </div>
                <div className="mt-2 text-[#71717A] space-y-1">
                  <div className="flex justify-between"><span>• Rang out (no answer):</span><span className="font-mono font-medium text-zinc-900">{summary?.unansweredBreakdown?.customerRangOut || 290}</span></div>
                  <div className="flex justify-between"><span>• User Busy / Declined:</span><span className="font-mono font-medium text-zinc-900">{summary?.unansweredBreakdown?.customerBusy || 72}</span></div>
                </div>
              </div>

              <div className="p-3 bg-amber-50/60 rounded-lg border border-amber-200">
                <div className="flex items-center justify-between font-semibold text-amber-900">
                  <span className="flex items-center gap-1.5">
                    RM Didn't Connect (19%) — Coaching Area
                  </span>
                  <span className="font-mono font-bold">{summary?.unansweredBreakdown?.rmDroppedEarly + summary?.unansweredBreakdown?.rmMissed || 84} calls</span>
                </div>
                <div className="mt-2 text-amber-800 space-y-1">
                  <div className="flex justify-between"><span>• RM cancelled early (&lt;5s):</span><span className="font-mono font-bold text-amber-900">{summary?.unansweredBreakdown?.rmDroppedEarly || 68}</span></div>
                  <div className="flex justify-between"><span>• RM missed incoming dialer leg:</span><span className="font-mono font-bold text-amber-900">{summary?.unansweredBreakdown?.rmMissed || 16}</span></div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── 4. CATEGORY FILTER PILLS ────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-3 rounded-xl border border-[#E4E4E7]">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-[#71717A] font-semibold mr-1">Call Category:</span>
            <button
              onClick={() => setSelectedCategory('all')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                selectedCategory === 'all'
                  ? 'bg-[#111111] text-white shadow-sm'
                  : 'bg-[#F4F4F5] text-[#71717A] hover:text-[#111111]'
              }`}
            >
              All Categories ({calls.length})
            </button>
            <button
              onClick={() => setSelectedCategory('13_pitching')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                selectedCategory === '13_pitching'
                  ? 'bg-[#111111] text-white shadow-sm'
                  : 'bg-[#F4F4F5] text-[#71717A] hover:text-[#111111]'
              }`}
            >
              13% Club / Pitching
            </button>
            <button
              onClick={() => setSelectedCategory('upselling')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                selectedCategory === 'upselling'
                  ? 'bg-[#111111] text-white shadow-sm'
                  : 'bg-[#F4F4F5] text-[#71717A] hover:text-[#111111]'
              }`}
            >
              Upselling Calls
            </button>
            <button
              onClick={() => setSelectedCategory('support')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                selectedCategory === 'support'
                  ? 'bg-[#111111] text-white shadow-sm'
                  : 'bg-[#F4F4F5] text-[#71717A] hover:text-[#111111]'
              }`}
            >
              General / Support
            </button>
            <button
              onClick={() => setSelectedCategory(selectedCategory === 'coaching_available' ? 'all' : 'coaching_available')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                selectedCategory === 'coaching_available'
                  ? 'bg-amber-600 text-white shadow-sm ring-2 ring-amber-300'
                  : 'bg-amber-50 text-amber-900 border border-amber-200 hover:bg-amber-100'
              }`}
            >
              Coaching Insights Available
            </button>

            {/* Admin Dedicated View Pills */}
            {activePersona === 'admin' && (
              <>
                <button
                  onClick={() => setSelectedCategory(selectedCategory === 'tl_analytics' ? 'all' : 'tl_analytics')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                    selectedCategory === 'tl_analytics'
                      ? 'bg-indigo-600 text-white shadow-sm ring-2 ring-indigo-300'
                      : 'bg-indigo-50 text-indigo-900 border border-indigo-200 hover:bg-indigo-100'
                  }`}
                >
                  Overall TL Analytics
                </button>
                <button
                  onClick={() => setSelectedCategory(selectedCategory === 'rm_performance' ? 'all' : 'rm_performance')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                    selectedCategory === 'rm_performance'
                      ? 'bg-indigo-600 text-white shadow-sm ring-2 ring-indigo-300'
                      : 'bg-indigo-50 text-indigo-900 border border-indigo-200 hover:bg-indigo-100'
                  }`}
                >
                  Team-Wide RM Performance
                </button>
                <button
                  onClick={() => setSelectedCategory(selectedCategory === 'ai_coaching_insights' ? 'all' : 'ai_coaching_insights')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                    selectedCategory === 'ai_coaching_insights'
                      ? 'bg-purple-600 text-white shadow-sm ring-2 ring-purple-300'
                      : 'bg-purple-50 text-purple-900 border border-purple-200 hover:bg-purple-100'
                  }`}
                >
                  Team Coaching Insights
                </button>
              </>
            )}
          </div>

          {/* Low Score Filter Pill for TL */}
          {activePersona === 'tl' && (
            <button
              onClick={() => setStatusFilter(statusFilter === 'needs_attention' ? 'all' : 'needs_attention')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${
                statusFilter === 'needs_attention'
                  ? 'bg-red-600 text-white border-red-600 shadow-sm'
                  : 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100'
              }`}
            >
              Attention Queue (&lt;85% IQS)
            </button>
          )}
        </div>

        {/* ── 5. PROPER RM SCORECARD SECTION (FOR TL) ────────────────── */}

        {/* 5B. TL VIEW: RM-STYLE AGENT SCORECARDS GRID & AGENT-WISE ANALYTICS */}
        {activePersona === 'tl' && (
          <div className="space-y-4">
            <div>
              <div className="flex items-center justify-between mb-2">
                <div>
                  <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider">
                    Needs Attention · Lowest IQS First — Team {selectedTl}
                  </p>
                  <span className="text-xs text-gray-400 font-medium">
                    {teamRmScorecards.length} Team RMs
                  </span>
                </div>
                <button
                  onClick={() => setActiveTab('scorecard')}
                  className="text-xs font-bold text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 px-3 py-1 rounded-md border border-indigo-200 transition-all flex items-center gap-1 shadow-sm"
                >
                  <span>Open Full Team Weekly Scorecards</span>
                  <span>→</span>
                </button>
              </div>

              {/* Grid of RM AgentCards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {teamRmScorecards.map((rm) => {
                  const isAtRisk = rm.overallScore < 85;
                  const theme = iqsTheme(rm.overallScore);
                  return (
                    <div
                      key={rm.rmName}
                      className={`bg-white rounded-2xl shadow-sm overflow-hidden border transition-all ${
                        isAtRisk ? 'border-red-200 ring-1 ring-red-100' : 'border-gray-100 hover:border-gray-200'
                      }`}
                    >
                      {/* Card Header */}
                      <div className={`px-4 pt-4 pb-3 ${isAtRisk ? 'bg-red-50/30' : ''}`}>
                        <div className="flex items-start gap-3">
                          <div className="shrink-0">
                            <IQSRing iqs={rm.overallScore} size={54} />
                          </div>
                          <div className="flex-1 min-w-0 pt-0.5">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <p className="font-bold text-gray-900 text-sm truncate">{rm.rmName}</p>
                              {isAtRisk && (
                                <span className="text-[10px] font-bold bg-red-100 text-red-700 px-1.5 py-0.2 rounded-full shrink-0">
                                  At Risk
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] text-gray-500 mt-0.5">
                              {rm.totalCalls} calls • {rm.connectRate}% connect
                            </p>
                            <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                              <span className="text-[10px] bg-emerald-50 text-emerald-700 font-semibold px-2 py-0.5 rounded-full">
                                {Math.round(rm.totalCalls * 0.45)} excellent
                              </span>
                              {rm.complianceFlags > 0 ? (
                                <span className="text-[10px] bg-red-50 text-red-600 font-semibold px-2 py-0.5 rounded-full">
                                  {rm.complianceFlags} flags
                                </span>
                              ) : (
                                <span className="text-[10px] bg-gray-100 text-gray-600 font-semibold px-2 py-0.5 rounded-full">
                                  clean
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Coaching Focus Area (Matching Quality Console AgentCard) */}
                      <div className="border-t border-gray-100 bg-gray-50/50 px-4 py-3 space-y-1.5">
                        <div className="flex items-center justify-between">
                          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                            Coaching Focus
                          </p>
                          <span className={`text-[10px] font-bold ${
                            rm.trend === 'improving' ? 'text-emerald-600' : 'text-red-500'
                          }`}>
                            {rm.trend === 'improving' ? '▲ Improving' : '▼ Coaching'}
                          </span>
                        </div>
                        <p className="text-[11.5px] font-medium text-gray-800 truncate" title={rm.topWeakness}>
                          {rm.topWeakness}
                        </p>
                        <div className="flex items-center justify-between pt-1 border-t border-gray-200/60 text-[11px]">
                          <span className="text-gray-500">13% Pitching:</span>
                          <span className="font-bold text-gray-900">{rm.pitchScore}%</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Agent-Wise Analytics Table (Matching Quality Console Table) */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                <div>
                  <p className="text-sm font-bold text-gray-900">Agent Wise Analytics</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    IQS, Connect Rate, and category breakdown per agent · Team {selectedTl}
                  </p>
                </div>
                <span className="text-xs font-medium text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-md border border-emerald-200">
                  ✓ Real-time Aggregation
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-gray-50/60 border-b border-gray-100 text-[#6B6B6B] font-semibold">
                      <th className="py-3 px-4 text-left">RM Name</th>
                      <th className="py-3 px-4 text-right">Calls Handled</th>
                      <th className="py-3 px-4 text-right">Connect Rate</th>
                      <th className="py-3 px-4 text-right">Avg IQS</th>
                      <th className="py-3 px-4 text-right">13% Pitching</th>
                      <th className="py-3 px-4 text-right">Upselling</th>
                      <th className="py-3 px-4 text-right">General Support</th>
                      <th className="py-3 px-4 text-center">Trend</th>
                      <th className="py-3 px-4 text-center">Compliance</th>
                      <th className="py-3 px-4 text-left">Top Coaching Focus</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {teamRmScorecards.map((rm) => (
                      <tr key={rm.rmName} className="hover:bg-gray-50/50 transition-colors">
                        <td className="py-3 px-4 font-bold text-gray-900 flex items-center gap-2">
                          <span className="w-6 h-6 rounded-full bg-zinc-200 text-zinc-800 flex items-center justify-center font-mono text-[11px]">
                            {rm.rmName.charAt(0)}
                          </span>
                          <span>{rm.rmName}</span>
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-medium">{rm.totalCalls}</td>
                        <td className="py-3 px-4 text-right font-mono">{rm.connectRate}%</td>
                        <td className="py-3 px-4 text-right">
                          <IQSPill iqs={rm.overallScore} size="sm" />
                        </td>
                        <td className="py-3 px-4 text-right font-mono">{rm.pitchScore}%</td>
                        <td className="py-3 px-4 text-right font-mono">{rm.upsellScore}%</td>
                        <td className="py-3 px-4 text-right font-mono">{rm.supportScore}%</td>
                        <td className="py-3 px-4 text-center">
                          {rm.trend === 'improving' ? (
                            <span className="text-emerald-600 font-bold">▲ Improving</span>
                          ) : (
                            <span className="text-red-600 font-bold">▼ Coaching</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-center font-mono">
                          {rm.complianceFlags > 0 ? (
                            <span className="text-red-600 font-bold">{rm.complianceFlags} Flags</span>
                          ) : (
                            <span className="text-emerald-600 font-semibold">0 Flags</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-gray-600 italic max-w-xs truncate">{rm.topWeakness}</td>
                      </tr>
                    ))}
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
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200">
                        Active Category View
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Comparative voice call quality, connect rates, and volume across Team Leaders
                    </p>
                  </div>

                  {/* Dropdown to Choose TL */}
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-gray-500">Select Team Lead:</span>
                    <select
                      value={adminBannerTlSelect}
                      onChange={(e) => setAdminBannerTlSelect(e.target.value as 'all' | 'Gokul' | 'Vaishnavi')}
                      className="text-xs font-bold bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-gray-800 outline-none focus:border-indigo-500 shadow-sm"
                    >
                      <option value="all">All Team Leads (Gokul &amp; Vaishnavi)</option>
                      <option value="Gokul">Team Gokul (4 Relationship Managers)</option>
                      <option value="Vaishnavi">Team Vaishnavi (4 Relationship Managers)</option>
                    </select>
                  </div>
                </div>

                {/* Team Lead Comparison Cards Filtered by Dropdown */}
                <div className={`grid gap-4 ${adminBannerTlSelect === 'all' ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1 max-w-xl'}`}>
                  {(teamLeads.length > 0 ? teamLeads : [
                    { tlName: 'Gokul', teamSize: 4, totalCalls: 1240, connectRate: 64, avgScore: 83.4, callsUnder85: 28, rms: ['Dhanush', 'Yaashvi Arora', 'Samskriti Rao', 'Gaurav Nautiyal'] },
                    { tlName: 'Vaishnavi', teamSize: 4, totalCalls: 980, connectRate: 67, avgScore: 85.1, callsUnder85: 14, rms: ['Aravind', 'Sujal Dadwani', 'Antara Chakrabarty', 'Swati Singh'] },
                  ])
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
                          <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                            tl.avgScore >= 85 ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
                          }`}>
                            Team IQS: {tl.avgScore}%
                          </span>
                        </div>

                        <div className="grid grid-cols-3 gap-2 text-center pt-1 border-t border-zinc-200">
                          <div className="bg-white p-2 rounded-lg border border-zinc-100">
                            <span className="text-[10px] uppercase font-bold text-zinc-400 block">Total Calls</span>
                            <span className="text-sm font-extrabold font-mono text-zinc-900">{tl.totalCalls}</span>
                          </div>
                          <div className="bg-white p-2 rounded-lg border border-zinc-100">
                            <span className="text-[10px] uppercase font-bold text-zinc-400 block">Connect Rate</span>
                            <span className="text-sm font-extrabold font-mono text-zinc-900">{tl.connectRate}%</span>
                          </div>
                          <div className="bg-white p-2 rounded-lg border border-zinc-100">
                            <span className="text-[10px] uppercase font-bold text-zinc-400 block">&lt;85% Attention</span>
                            <span className={`text-sm font-extrabold font-mono ${tl.callsUnder85 > 20 ? 'text-amber-600' : 'text-zinc-900'}`}>
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
                              className="px-2 py-0.5 rounded text-[11px] font-semibold bg-white border border-zinc-200 text-zinc-700 hover:border-indigo-300 hover:text-indigo-600 transition-colors"
                            >
                              {rm}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
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
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200">
                        Active Category View
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Complete scorecards across all {rmScorecards.length} RMs in Team Gokul and Team Vaishnavi
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    {/* Dropdown to select RMs */}
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-gray-500">Filter RM:</span>
                      <select
                        value={adminGridRmFilter}
                        onChange={(e) => setAdminGridRmFilter(e.target.value)}
                        className="text-xs font-bold bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-gray-800 outline-none focus:border-indigo-500 shadow-sm"
                      >
                        <option value="all">All 8 Active RMs</option>
                        {rmScorecards.map((rm) => (
                          <option key={rm.rmName} value={rm.rmName}>{rm.rmName}</option>
                        ))}
                      </select>
                    </div>

                    {/* Open RM Scorecards Button (Moved from TL analytics) */}
                    <button
                      onClick={() => setActiveTab('scorecard')}
                      className="text-xs font-bold text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 px-3.5 py-1.5 rounded-lg border border-indigo-200 transition-all flex items-center gap-1.5 shadow-sm"
                    >
                      <span>Open RM Scorecards</span>
                      <span>→</span>
                    </button>
                  </div>
                </div>

                {/* Filtered Grid of RMs */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {rmScorecards
                    .filter((rm) => adminGridRmFilter === 'all' || rm.rmName.toLowerCase() === adminGridRmFilter.toLowerCase())
                    .map((rm) => {
                      const tlAssignment = ['Aravind', 'Sujal Dadwani', 'Antara Chakrabarty', 'Swati Singh'].includes(rm.rmName) ? 'Vaishnavi' : 'Gokul';
                      return (
                        <div
                          key={rm.rmName}
                          onClick={() => { setSelectedRm(rm.rmName); setActiveTab('scorecard'); }}
                          className="bg-white rounded-2xl border border-gray-100 hover:border-indigo-300 hover:shadow-md transition-all p-4 flex items-start gap-3 cursor-pointer group"
                        >
                          <IQSRing iqs={rm.overallScore} size={50} />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-1">
                              <p className="font-bold text-sm text-gray-900 group-hover:text-indigo-600 transition-colors truncate">
                                {rm.rmName}
                              </p>
                              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-600 shrink-0">
                                Team {tlAssignment}
                              </span>
                            </div>
                            <p className="text-xs text-gray-500 mt-0.5">{rm.totalCalls} calls • {rm.connectRate}% connect</p>
                            <p className="text-[11px] text-amber-800 font-medium truncate mt-1">
                              Focus: {rm.topWeakness}
                            </p>
                          </div>
                        </div>
                      );
                    })}
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
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-50 text-purple-700 border border-purple-200">
                        100% Team Coverage
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mt-1 max-w-2xl leading-relaxed">
                      Executive intelligence on AI coaching interventions delivered across all relationship managers, coaching topic concentration, trajectory improvement, and focus queues.
                    </p>
                  </div>
                </div>

                {/* High-Level Diagnostic KPI Cards */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="p-4 rounded-xl border border-purple-100 bg-purple-50/30 space-y-1.5">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-purple-700 block">
                      Team Members Coached
                    </span>
                    <div className="text-2xl font-black font-mono text-gray-900">9 / 9 RMs</div>
                    <div className="pt-1">
                      <span className="inline-block text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-100 text-emerald-800">
                        ✓ Full Team Coverage
                      </span>
                    </div>
                  </div>

                  <div className="p-4 rounded-xl border border-zinc-200 bg-zinc-50/50 space-y-1.5">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-500 block">
                      Total AI Coaching Insights
                    </span>
                    <div className="text-2xl font-black font-mono text-gray-900">54 Insights</div>
                    <div className="pt-1">
                      <span className="inline-block text-[10px] font-bold px-2 py-0.5 rounded bg-zinc-200 text-zinc-800">
                        Auto-Generated in Realtime
                      </span>
                    </div>
                  </div>

                  <div className="p-4 rounded-xl border border-emerald-100 bg-emerald-50/30 space-y-1.5">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-700 block">
                      Score Improvement
                    </span>
                    <div className="text-2xl font-black font-mono text-emerald-700">+6.8% IQS</div>
                    <div className="pt-1">
                      <span className="inline-block text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-100 text-emerald-800">
                        ▲ Upward Rebound
                      </span>
                    </div>
                  </div>

                  <div className="p-4 rounded-xl border border-blue-100 bg-blue-50/30 space-y-1.5">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-blue-700 block">
                      Safe Pitch Compliance
                    </span>
                    <div className="text-2xl font-black font-mono text-blue-700">94.2%</div>
                    <div className="pt-1">
                      <span className="inline-block text-[10px] font-bold px-2 py-0.5 rounded bg-blue-100 text-blue-800">
                        SEBI Risk Guarded
                      </span>
                    </div>
                  </div>
                </div>

                {/* Main Topics AI has given coaching on */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between border-b border-gray-100 pb-2">
                    <h4 className="text-xs font-bold text-gray-900 uppercase tracking-wider flex items-center gap-1.5">
                      Coaching by Quality Parameters
                    </h4>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Parameter 1 */}
                    <div className="p-4 rounded-xl border border-[#E4E4E7] bg-white hover:border-purple-300 transition-all shadow-xs flex items-center justify-between gap-3">
                      <h5 className="text-sm font-bold text-gray-900">
                        Compliance &amp; No Return Guarantees
                      </h5>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => handleOpenCoachingChat({ rmName: 'Swati Singh', categoryKey: '13_pitching' })}
                          className="px-3 py-1.5 text-xs font-bold bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 rounded-lg shadow-xs transition-all cursor-pointer whitespace-nowrap"
                        >
                          View Chats →
                        </button>
                        <button
                          onClick={() => { setSelectedRm('Swati Singh'); handleTabChange('scorecard'); }}
                          className="px-3 py-1.5 text-xs font-bold bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-lg shadow-xs transition-all cursor-pointer whitespace-nowrap"
                        >
                          View RM Performance →
                        </button>
                      </div>
                    </div>

                    {/* Parameter 2 */}
                    <div className="p-4 rounded-xl border border-[#E4E4E7] bg-white hover:border-purple-300 transition-all shadow-xs flex items-center justify-between gap-3">
                      <h5 className="text-sm font-bold text-gray-900">
                        Investor Suitability Profiling &amp; Need Discovery
                      </h5>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => handleOpenCoachingChat({ rmName: 'Antara Chakrabarty', categoryKey: '13_pitching' })}
                          className="px-3 py-1.5 text-xs font-bold bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 rounded-lg shadow-xs transition-all cursor-pointer whitespace-nowrap"
                        >
                          View Chats →
                        </button>
                        <button
                          onClick={() => { setSelectedRm('Antara Chakrabarty'); handleTabChange('scorecard'); }}
                          className="px-3 py-1.5 text-xs font-bold bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-lg shadow-xs transition-all cursor-pointer whitespace-nowrap"
                        >
                          View RM Performance →
                        </button>
                      </div>
                    </div>

                    {/* Parameter 3 */}
                    <div className="p-4 rounded-xl border border-[#E4E4E7] bg-white hover:border-purple-300 transition-all shadow-xs flex items-center justify-between gap-3">
                      <h5 className="text-sm font-bold text-gray-900">
                        Liquidity vs Yield Comparison
                      </h5>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => handleOpenCoachingChat({ rmName: 'Yaashvi Arora', categoryKey: 'upselling' })}
                          className="px-3 py-1.5 text-xs font-bold bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 rounded-lg shadow-xs transition-all cursor-pointer whitespace-nowrap"
                        >
                          View Chats →
                        </button>
                        <button
                          onClick={() => { setSelectedRm('Yaashvi Arora'); handleTabChange('scorecard'); }}
                          className="px-3 py-1.5 text-xs font-bold bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-lg shadow-xs transition-all cursor-pointer whitespace-nowrap"
                        >
                          View RM Performance →
                        </button>
                      </div>
                    </div>

                    {/* Parameter 4 */}
                    <div className="p-4 rounded-xl border border-[#E4E4E7] bg-white hover:border-purple-300 transition-all shadow-xs flex items-center justify-between gap-3">
                      <h5 className="text-sm font-bold text-gray-900">
                        Active Listening &amp; Objection Handling
                      </h5>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => handleOpenCoachingChat({ rmName: 'Sujal Dadwani', categoryKey: 'support' })}
                          className="px-3 py-1.5 text-xs font-bold bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 rounded-lg shadow-xs transition-all cursor-pointer whitespace-nowrap"
                        >
                          View Chats →
                        </button>
                        <button
                          onClick={() => { setSelectedRm('Sujal Dadwani'); handleTabChange('scorecard'); }}
                          className="px-3 py-1.5 text-xs font-bold bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-lg shadow-xs transition-all cursor-pointer whitespace-nowrap"
                        >
                          View RM Performance →
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Who Has Improved vs Who Needs Improvement Breakdown */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pt-2">
                  {/* Left Column: Who has improved */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between border-b border-emerald-100 pb-2">
                      <h4 className="text-xs font-bold text-emerald-950 uppercase tracking-wider">
                        Who Has Improved (Positive Trajectory)
                      </h4>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                        4 RMs Demonstrating Lift
                      </span>
                    </div>

                    <div className="space-y-2.5">
                      {[
                        { name: 'Dhanush', team: 'Gokul', prev: '84%', now: '92%', delta: '+8%', skill: 'Mastered SEBI risk disclaimers & suitability criteria' },
                        { name: 'Samskriti Rao', team: 'Gokul', prev: '81%', now: '87%', delta: '+6%', skill: 'Strong call opening hook, clear 13% yield positioning' },
                        { name: 'Aravind', team: 'Vaishnavi', prev: '83%', now: '89%', delta: '+6%', skill: 'Exceptional active listening and zero compliance flags' },
                        { name: 'Gaurav Nautiyal', team: 'Gokul', prev: '80%', now: '85%', delta: '+5%', skill: 'Overcame bank FD comparisons with structured walk-through' },
                      ].map((rm) => (
                        <div key={rm.name} className="p-3 rounded-xl border border-emerald-100 bg-emerald-50/20 flex items-center justify-between gap-3">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-xs text-gray-900">{rm.name}</span>
                              <span className="text-[10px] text-gray-500 font-medium">Team {rm.team}</span>
                              <span className="text-[10px] font-extrabold text-emerald-700 bg-emerald-100 px-1.5 py-0.2 rounded">
                                {rm.delta} Lift
                              </span>
                            </div>
                            <p className="text-[11px] text-gray-600 mt-0.5">{rm.skill}</p>
                          </div>
                          <div className="text-right shrink-0">
                            <span className="text-xs font-mono font-bold text-emerald-700 block">{rm.now} IQS</span>
                            <button
                              onClick={() => { setSelectedRm(rm.name); handleTabChange('scorecard'); }}
                              className="text-[11px] text-indigo-600 hover:text-indigo-800 font-bold underline mt-0.5 cursor-pointer"
                            >
                              Open Scorecard
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Right Column: Who needs improvement */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between border-b border-amber-100 pb-2">
                      <h4 className="text-xs font-bold text-amber-950 uppercase tracking-wider">
                        Who Needs Improvement (Coaching Focus Queue)
                      </h4>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">
                        4 RMs in Coaching Queue
                      </span>
                    </div>

                    <div className="space-y-2.5">
                      {[
                        { name: 'Yaashvi Arora', team: 'Gokul', current: '82%', priority: 'High', focus: 'Objection handling on lock-in periods & secondary exit mechanisms' },
                        { name: 'Swati Singh', team: 'Vaishnavi', current: '81%', priority: 'High', focus: 'Completing mandatory SEBI disclaimers before closing deals' },
                        { name: 'Sujal Dadwani', team: 'Vaishnavi', current: '83%', priority: 'Medium', focus: 'Active listening & pacing; avoid rushing the 13% yield pitch' },
                        { name: 'Antara Chakrabarty', team: 'Vaishnavi', current: '84%', priority: 'Medium', focus: 'Investor suitability profiling before introducing 13% yield' },
                      ].map((rm) => (
                        <div key={rm.name} className="p-3 rounded-xl border border-amber-200 bg-amber-50/20 flex items-center justify-between gap-3">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-xs text-gray-900">{rm.name}</span>
                              <span className="text-[10px] text-gray-500 font-medium">Team {rm.team}</span>
                              <span className={`text-[10px] font-bold px-1.5 py-0.2 rounded ${
                                rm.priority === 'High' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-800'
                              }`}>
                                {rm.priority} Priority
                              </span>
                            </div>
                            <p className="text-[11px] text-amber-900 font-medium mt-0.5">{rm.focus}</p>
                          </div>
                          <div className="text-right shrink-0">
                            <span className="text-xs font-mono font-bold text-amber-800 block">{rm.current} IQS</span>
                            <button
                              onClick={() => handleOpenCoachingChat({ rmName: rm.name })}
                              className="text-[11px] text-indigo-600 hover:text-indigo-800 font-bold underline mt-0.5 cursor-pointer"
                            >
                              Inspect Chats
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}



        {/* ── 6. CALLS AUDIT LIST ────────────────────────────────────────────── */}
        {selectedCategory !== 'ai_coaching_insights' && (
        <div id="pcg-calls-table" className="bg-white rounded-xl border border-[#E4E4E7] overflow-hidden">
          {/* Coaching Insights Active Banner */}
          {selectedCategory === 'coaching_available' && (
            <div className="p-3 bg-amber-50 border-b border-amber-200 flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs text-amber-900 font-semibold">
                
                <span>
                  Showing {calls.length} calls with active AI Coaching Insights. Click <strong>"View"</strong> on any call to inspect the full chat transcript turns and coaching guidance.
                </span>
              </div>
              <button
                onClick={() => setSelectedCategory('all')}
                className="text-xs text-amber-800 hover:text-amber-950 font-bold underline"
              >
                Clear Filter
              </button>
            </div>
          )}
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
                Showing {calls.length} calls • Auto-categorised with separate quality parameters
              </p>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="text"
                placeholder="Search Call ID or Phone..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="text-xs border border-[#E4E4E7] rounded-lg px-3 py-1.5 w-56 outline-none focus:border-[#111111]"
              />
            </div>
          </div>

          {loading ? (
            <div className="p-12 text-center text-zinc-400 text-xs">Loading PCG calls data...</div>
          ) : calls.length === 0 ? (
            <div className="p-12 text-center text-zinc-400 text-xs">No calls match the selected filters.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-[#FAFAFB] border-b border-[#E4E4E7] text-[#6B6B6B] font-semibold uppercase tracking-wider">
                    <th className="py-3 px-4">Call ID</th>
                    {activePersona !== 'agent' && <th className="py-3 px-4">RM Name</th>}
                    <th className="py-3 px-4">Customer Phone</th>
                    <th className="py-3 px-4">Call Category</th>
                    <th className="py-3 px-4">Duration</th>
                    <th className="py-3 px-4">IQS Score</th>
                    <th className="py-3 px-4">Gates</th>
                    <th className="py-3 px-4">Status / Disconnect</th>
                    <th className="py-3 px-4 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F0F0F2]">
                  {calls.map((call) => (
                    <tr
                      key={call.id}
                      className={`hover:bg-zinc-50 transition-colors ${
                        call.needsAttention ? 'bg-amber-50/20' : ''
                      }`}
                    >
                      <td className="py-3 px-4">
                        <a
                          href={getRunoCallUrl(call.callId || call.id)}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Open in Runo CRM"
                          className="inline-flex items-center gap-1 font-mono font-bold text-zinc-900 hover:text-emerald-700 hover:underline group cursor-pointer"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <span>#{formatCallId(call.callId, call.id)}</span>
                          <svg className="w-3 h-3 text-zinc-400 group-hover:text-emerald-700 transition-colors shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                          </svg>
                        </a>
                      </td>

                      {activePersona !== 'agent' && (
                        <td className="py-3 px-4 font-semibold text-zinc-800">
                          {call.rmName}
                        </td>
                      )}

                      <td className="py-3 px-4 font-mono text-zinc-600">
                        {call.phoneNumber}
                      </td>

                      <td className="py-3 px-4">
                        <span className={`inline-flex px-2 py-0.5 rounded text-[11px] font-semibold ${
                          call.categoryKey === '13_pitching'
                            ? 'bg-blue-50 text-blue-700 border border-blue-200'
                            : call.categoryKey === 'upselling'
                            ? 'bg-purple-50 text-purple-700 border border-purple-200'
                            : 'bg-zinc-100 text-zinc-700 border border-zinc-200'
                        }`}>
                          {call.category}
                        </span>
                      </td>

                      <td className="py-3 px-4 font-mono">
                        {call.isAnswered ? formatDuration(call.durationSeconds) : '00:00'}
                      </td>

                      <td className="py-3 px-4">
                        {call.isAnswered ? getScoreBadge(call.iqsScore) : <span className="text-zinc-400 font-mono">—</span>}
                      </td>

                      <td className="py-3 px-4 font-semibold">
                        {call.gates.status === 'PASS' ? (
                          <span className="text-emerald-600 font-bold">PASS</span>
                        ) : (
                          <span className="text-red-600 font-bold">FAIL</span>
                        )}
                      </td>

                      {/* Status / Unanswered Diagnosis */}
                      <td className="py-3 px-4">
                        {call.isAnswered ? (
                          <span className="text-emerald-700 font-medium">Connected</span>
                        ) : (
                          <span className={`inline-flex items-center gap-1 font-semibold ${
                            call.unansweredBy === 'RM' ? 'text-amber-700' : 'text-zinc-600'
                          }`}>
                            {call.unansweredReason}
                          </span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="py-3 px-4 text-center">
                        <button
                          onClick={() => handleOpenCallView(call)}
                          className="px-3.5 py-1 rounded-md bg-zinc-900 hover:bg-zinc-800 text-white font-semibold transition-colors text-xs shadow-sm"
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  ))}
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

      {/* ── SLIDE-OVER CALL VIEW & EVALUATION DRAWER ───────────────────────── */}
      {activeCallAudit && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-5xl xl:max-w-6xl bg-white h-full shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-right duration-200">
            {/* Drawer Header */}
            <div className="p-4 border-b border-[#E4E4E7] flex items-center justify-between bg-zinc-50">
              <div className="flex flex-wrap items-center gap-3">
                <a
                  href={getRunoCallUrl(activeCallAudit.callId || activeCallAudit.id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Open in Runo CRM"
                  className="inline-flex items-center gap-1.5 font-mono font-bold text-base text-[#111111] hover:text-emerald-700 hover:underline group cursor-pointer"
                >
                  <span>Call #{formatCallId(activeCallAudit.callId, activeCallAudit.id)}</span>
                  <svg className="w-3.5 h-3.5 text-zinc-400 group-hover:text-emerald-700 transition-colors shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </a>
                <span className={`px-2 py-0.5 rounded text-[11px] font-semibold ${
                  activeCallAudit.categoryKey === '13_pitching'
                    ? 'bg-blue-50 text-blue-700 border border-blue-200'
                    : activeCallAudit.categoryKey === 'upselling'
                    ? 'bg-purple-50 text-purple-700 border border-purple-200'
                    : 'bg-zinc-100 text-zinc-700 border border-zinc-200'
                }`}>
                  {activeCallAudit.category}
                </span>
                <span className="text-xs text-[#71717A]">
                  RM: <span className="font-semibold text-zinc-900">{activeCallAudit.rmName}</span> ({activeCallAudit.tlName})
                </span>
                <span className="text-xs font-mono text-zinc-500">• {activeCallAudit.phoneNumber}</span>
                <span className="text-xs font-mono text-zinc-500">• {activeCallAudit.isAnswered ? formatDuration(activeCallAudit.durationSeconds) : 'Unanswered (00:00)'}</span>
              </div>

              <div className="flex items-center gap-3">
                {activeCallAudit.isAnswered ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-[#71717A]">IQS:</span>
                    {getScoreBadge(activeCallAudit.iqsScore)}
                    <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                      activeCallAudit.gates.status === 'PASS' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
                    }`}>
                      {activeCallAudit.gates.status}
                    </span>
                  </div>
                ) : (
                  <span className="px-2 py-0.5 rounded text-xs font-semibold bg-zinc-200 text-zinc-700">
                    Not Connected
                  </span>
                )}
                <button
                  onClick={() => setActiveCallAudit(null)}
                  className="w-8 h-8 rounded-lg border border-[#E4E4E7] flex items-center justify-center text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 text-sm font-bold ml-2"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Drawer Body: 2-Column Split Layout */}
            <div className="flex-1 flex flex-col lg:flex-row overflow-hidden divide-y lg:divide-y-0 lg:divide-x divide-[#E4E4E7]">
              
              {/* ── LEFT COLUMN: Audio Player + Call Transcript Dialogue Turns ──── */}
              <div className="flex-1 flex flex-col overflow-y-auto p-5 space-y-4 bg-white">
                {/* Audio Player for Answered Calls */}
                {activeCallAudit.isAnswered ? (
                  <div className="p-3.5 bg-zinc-900 text-white rounded-xl flex items-center justify-between gap-4 shadow-sm">
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => {
                          if (audioRef.current) {
                            if (isPlaying) audioRef.current.pause();
                            else audioRef.current.play();
                            setIsPlaying(!isPlaying);
                          }
                        }}
                        className="w-9 h-9 rounded-full bg-white text-zinc-900 flex items-center justify-center font-bold text-xs shadow hover:scale-105 transition-transform"
                      >
                        {isPlaying ? (
                          <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
                            <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                          </svg>
                        ) : (
                          <svg className="w-3.5 h-3.5 fill-current ml-0.5" viewBox="0 0 24 24">
                            <path d="M8 5v14l11-7z" />
                          </svg>
                        )}
                      </button>
                      <div>
                        <p className="text-xs font-semibold">Exotel / Runo Voice Audio Recording</p>
                        <p className="text-[11px] text-zinc-400">Streamed from AWS S3 • Synced to dialogue turns</p>
                      </div>
                    </div>
                    <audio
                      ref={audioRef}
                      controls
                      className="h-8 max-w-[260px]"
                      src={`/api/admin/pcg-calls/audio?id=${encodeURIComponent(activeCallAudit.id)}`}
                      onEnded={() => setIsPlaying(false)}
                    />
                  </div>
                ) : (
                  /* Diagnostic Card for Unanswered Calls */
                  <div className="p-4 bg-amber-50/60 rounded-xl border border-amber-200 space-y-2">
                    <div className="flex items-center gap-2 text-amber-900 font-bold text-xs uppercase tracking-wider">
                      Dialer Disconnect Diagnostic
                    </div>
                    <p className="text-xs font-semibold text-amber-950">
                      Party Disconnected: {activeCallAudit.unansweredBy === 'RM' ? 'RM Disconnected Early (<5s)' : 'Customer Rang Out / No Pickup'}
                    </p>
                    <p className="text-xs text-amber-900">
                      Reason: <span className="font-mono font-bold">{activeCallAudit.unansweredReason}</span>
                    </p>
                    <p className="text-[11px] text-amber-800">
                      Dialer placed outbound call to {activeCallAudit.phoneNumber}. Customer handset did not bridge voice connection, hence no conversation audio or IQS scorecard was generated.
                    </p>
                  </div>
                )}

                {/* Transcript / Dialogue Turns */}
                <div className="space-y-3 flex-1 flex flex-col">
                  <div className="flex items-center justify-between border-b border-[#E4E4E7] pb-2">
                    <h4 className="text-xs font-bold text-[#111111] uppercase tracking-wider flex items-center gap-2">
                      {activeCallAudit.isAnswered ? 'Call Transcript & Dialogue Turns' : 'Dialer Event Sequence'}
                    </h4>
                    <span className="text-[11px] text-[#71717A]">
                      {activeCallAudit.isAnswered ? `${activeCallAudit.transcriptTurns.length} dialogue turns` : '3 telephony events'}
                    </span>
                  </div>

                  {activeCallAudit.isAnswered ? (
                    <div className="space-y-2.5 flex-1 overflow-y-auto pr-1">
                      {activeCallAudit.transcriptTurns.map((turn, idx) => (
                        <div
                          key={idx}
                          className={`p-3 rounded-xl text-xs transition-all ${
                            turn.speaker === 'RM'
                              ? 'bg-blue-50/70 border border-blue-200/80 ml-6'
                              : 'bg-zinc-100/80 border border-zinc-200/70 mr-6'
                          }`}
                        >
                          <div className="flex items-center justify-between font-bold text-[11px] text-zinc-700 mb-1">
                            <span className={turn.speaker === 'RM' ? 'text-blue-800' : 'text-zinc-800'}>
                              {turn.speaker === 'RM' ? `RM (${activeCallAudit.rmName})` : 'Investor / Customer'}
                            </span>
                            <span className="font-mono text-[10px] text-zinc-400">{turn.time}</span>
                          </div>
                          <p className="text-zinc-900 leading-relaxed">{turn.text}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="space-y-2 text-xs">
                      <div className="p-2.5 rounded-lg bg-zinc-50 border border-zinc-200 flex items-center justify-between font-mono">
                        <span>[00:00] Runo / Exotel outbound dial initiated to {activeCallAudit.phoneNumber}</span>
                        <span className="text-zinc-400">Initiated</span>
                      </div>
                      <div className="p-2.5 rounded-lg bg-zinc-50 border border-zinc-200 flex items-center justify-between font-mono">
                        <span>[00:04] Customer handset ringing</span>
                        <span className="text-zinc-400">Ringing</span>
                      </div>
                      <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-200 flex items-center justify-between font-mono text-amber-900 font-semibold">
                        <span>[00:26] Call disconnected: {activeCallAudit.unansweredReason}</span>
                        <span className="text-amber-700">Timeout / Hangup</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* ── RIGHT COLUMN: Parameters Panel + Dispute / Override ─────────── */}
              <div className="w-full lg:w-[460px] flex flex-col overflow-y-auto p-5 space-y-4 bg-[#FAFAFB]">
                {/* Parameters Header */}
                <div className="flex items-center justify-between border-b border-[#E4E4E7] pb-2">
                  <h4 className="text-xs font-bold text-[#111111] uppercase tracking-wider flex items-center gap-1.5">
                    {activeCallAudit.category} Parameters
                  </h4>
                  {activeCallAudit.isAnswered && (
                    <span className="text-xs font-mono font-bold">{getScoreBadge(activeCallAudit.iqsScore)}</span>
                  )}
                </div>

                {/* Parameters List */}
                {activeCallAudit.isAnswered ? (
                  <div className="space-y-2.5">
                    {activeCallAudit.parameters.map((param) => (
                      <div
                        key={param.id}
                        className="p-3 rounded-xl border border-zinc-200 bg-white text-xs shadow-sm hover:border-zinc-300 transition-colors"
                      >
                        <div className="flex items-center justify-between font-semibold text-zinc-900">
                          <span className="font-bold">{param.name}</span>
                          <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                            param.status === 'Yes'
                              ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                              : param.status === 'Half'
                              ? 'bg-amber-100 text-amber-800 border border-amber-200'
                              : 'bg-red-100 text-red-800 border border-red-200'
                          }`}>
                            {param.status} ({param.earnedScore}/{param.maxScore} pts)
                          </span>
                        </div>
                        {param.quote && (
                          <div className="mt-1.5 p-2 bg-zinc-50 rounded border border-zinc-100 text-[11px] text-zinc-600 italic">
                            "{param.quote}"
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-4 bg-zinc-100 rounded-xl text-center text-xs text-zinc-500">
                    Call was unanswered. Quality parameters evaluation skipped.
                  </div>
                )}

                {/* AI Sales Coaching Tip (shown for calls needing attention) */}
                {activeCallAudit.aiCoachingTip ? (
                  <div className="p-3.5 bg-amber-50/90 rounded-xl border border-amber-200 shadow-sm space-y-1.5">
                    <div className="flex items-center gap-2 text-amber-900 font-bold text-xs uppercase tracking-wider">
                       AI Sales Coaching Tip
                    </div>
                    <p className="text-xs text-amber-950 leading-relaxed font-medium">
                      {activeCallAudit.aiCoachingTip}
                    </p>
                  </div>
                ) : activeCallAudit.isAnswered ? (
                  <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-200 flex items-center justify-between text-xs text-emerald-800">
                    <span>✓ Clean Call: No coaching intervention needed.</span>
                    <span className="font-mono font-bold">{activeCallAudit.iqsScore}% IQS</span>
                  </div>
                ) : null}

                {/* ── ACTION SECTION DIRECTLY BELOW PARAMETERS PANEL ───────────── */}
                <div className="pt-3 border-t border-[#E4E4E7] space-y-3">
                  
                  {/* Feedback Messages */}
                  {disputeFeedback && (
                    <div className="p-2.5 rounded-lg bg-blue-50 border border-blue-200 text-xs font-semibold text-blue-800 flex items-center gap-1.5">
                      <span>✓</span> {disputeFeedback}
                    </div>
                  )}

                  {overrideFeedback && (
                    <div className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-xs font-semibold text-emerald-800 flex items-center gap-1.5">
                      <span>✓</span> {overrideFeedback}
                    </div>
                  )}

                  {/* ─────────────────────────────────────────────────────────────
                      1. AGENT VIEW: RAISE DISPUTE OPTION BELOW PARAMETERS
                     ───────────────────────────────────────────────────────────── */}
                  {(activePersona === 'agent' || activePersona === 'admin') && activeCallAudit.isAnswered && (
                    <div className="space-y-3">
                      {activeCallAudit.disputeStatus === 'pending' ? (
                        <div className="p-3.5 bg-amber-50 rounded-xl border border-amber-300 text-xs space-y-1">
                          <div className="flex items-center gap-1.5 font-bold text-amber-900">
                             Dispute Pending Team Lead Review
                          </div>
                          <p className="text-amber-800">
                            <span className="font-semibold">Reason:</span> "{activeCallAudit.disputeReason}"
                          </p>
                          <p className="text-[11px] text-amber-700">
                            Your Team Leader will review the transcript and update your scorecard.
                          </p>
                        </div>
                      ) : activeCallAudit.disputeStatus === 'resolved' ? (
                        <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-200 text-xs text-emerald-800">
                          <span className="font-bold">✓ Dispute Resolved by TL:</span> {activeCallAudit.tlOverrideNote || 'Score adjusted.'}
                        </div>
                      ) : !isRaisingDispute ? (
                        <div className="p-3 bg-white rounded-xl border border-zinc-200 space-y-2">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="text-xs font-bold text-zinc-900">Disagree with grading?</p>
                              <p className="text-[11px] text-zinc-500">Raise dispute for TL parameter re-evaluation</p>
                            </div>
                            <button
                              onClick={() => setIsRaisingDispute(true)}
                              className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition-colors shadow-sm"
                            >
                              Raise Dispute
                            </button>
                          </div>
                        </div>
                      ) : (
                        /* Inline Dispute Form */
                        <div className="p-3.5 bg-amber-50/70 rounded-xl border border-amber-300 text-xs space-y-3 shadow-sm">
                          <div className="flex items-center justify-between font-bold text-amber-950">
                            <span>Raise Dispute on Parameters</span>
                            <button
                              onClick={() => setIsRaisingDispute(false)}
                              className="text-zinc-500 hover:text-zinc-800 text-xs font-bold"
                            >
                              ✕
                            </button>
                          </div>

                          <p className="text-[11px] text-amber-800">
                            Select the parameter(s) you believe should be re-evaluated:
                          </p>

                          <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                            {activeCallAudit.parameters.map((p) => (
                              <label
                                key={p.id}
                                className="flex items-center gap-2 p-1.5 bg-white rounded border border-amber-200 cursor-pointer text-xs"
                              >
                                <input
                                  type="checkbox"
                                  checked={!!disputeSelectedParams[p.id]}
                                  onChange={(e) =>
                                    setDisputeSelectedParams((prev) => ({
                                      ...prev,
                                      [p.id]: e.target.checked,
                                    }))
                                  }
                                  className="rounded text-blue-600"
                                />
                                <span className="font-semibold text-zinc-800 flex-1 truncate">{p.name}</span>
                                <span className="text-[10px] text-zinc-500 font-mono">({p.status})</span>
                              </label>
                            ))}
                          </div>

                          <textarea
                            rows={2}
                            value={agentDisputeNote}
                            onChange={(e) => setAgentDisputeNote(e.target.value)}
                            placeholder="Explain why you feel the parameter score should be reviewed…"
                            className="w-full text-xs border border-zinc-300 rounded-lg p-2 bg-white outline-none focus:border-blue-600"
                          />

                          <div className="flex justify-end gap-2">
                            <button
                              onClick={() => setIsRaisingDispute(false)}
                              className="px-3 py-1 rounded-lg border border-zinc-300 bg-white text-zinc-700 text-xs font-semibold"
                            >
                              Cancel
                            </button>
                            <button
                              disabled={submittingDispute}
                              onClick={handleSubmitDispute}
                              className="px-3.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold disabled:opacity-50"
                            >
                              {submittingDispute ? 'Submitting…' : 'Submit Dispute'}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* ─────────────────────────────────────────────────────────────
                      2. TL VIEW: OVERRIDE OPTION BELOW PARAMETERS PANEL (LIKE RM CALLS)
                     ───────────────────────────────────────────────────────────── */}
                  {(activePersona === 'tl' || activePersona === 'admin') && activeCallAudit.isAnswered && (
                    <div className="p-3.5 bg-white rounded-xl border border-zinc-200 space-y-3 shadow-sm">
                      {/* If call has dispute pending from agent, show quick resolve buttons */}
                      {activeCallAudit.disputeStatus === 'pending' && (
                        <div className="p-2.5 bg-amber-50 rounded-lg border border-amber-300 space-y-2">
                          <p className="text-xs font-bold text-amber-900 flex items-center gap-1.5">
                            Agent Dispute Pending:
                          </p>
                          <p className="text-xs text-amber-950 italic">
                            "{activeCallAudit.disputeReason}"
                          </p>
                          <div className="flex gap-2 pt-1">
                            <button
                              onClick={() => handleResolveDispute(true)}
                              className="px-2.5 py-1 rounded bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold"
                            >
                              ✓ Approve (+8 pts)
                            </button>
                            <button
                              onClick={() => handleResolveDispute(false)}
                              className="px-2.5 py-1 rounded border border-zinc-300 bg-white text-zinc-700 text-xs font-semibold hover:bg-zinc-50"
                            >
                              ✕ Reject Dispute
                            </button>
                          </div>
                        </div>
                      )}

                      <div className="flex items-center justify-between border-b border-zinc-100 pb-2">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-bold text-zinc-900">Score &amp; Parameter Override</span>
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-700 uppercase">
                            TL Control
                          </span>
                        </div>
                        {activeCallAudit.tlOverrideNote && (
                          <span className="text-[10px] text-emerald-700 font-semibold">Override Active</span>
                        )}
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div>
                          <label className="text-[11px] font-semibold text-zinc-600 block mb-1">Parameter</label>
                          <select
                            value={overrideParamId}
                            onChange={(e) => setOverrideParamId(e.target.value)}
                            className="w-full text-xs border border-zinc-300 rounded-lg p-1.5 bg-white outline-none"
                          >
                            {activeCallAudit.parameters.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.id}: {p.name}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label className="text-[11px] font-semibold text-zinc-600 block mb-1">New Score</label>
                          <select
                            value={overrideNewScore}
                            onChange={(e) => setOverrideNewScore(e.target.value as any)}
                            className="w-full text-xs border border-zinc-300 rounded-lg p-1.5 bg-white outline-none"
                          >
                            <option value="Yes">Pass / Yes (Full Pts)</option>
                            <option value="Half">Partial / Half (50%)</option>
                            <option value="No">Fail / No (0 Pts)</option>
                          </select>
                        </div>
                      </div>

                      <textarea
                        rows={2}
                        value={overrideNoteInput}
                        onChange={(e) => setOverrideNoteInput(e.target.value)}
                        placeholder="Internal review note explaining why score was overridden…"
                        className="w-full text-xs border border-zinc-300 rounded-lg p-2 outline-none focus:border-zinc-800"
                      />

                      <button
                        disabled={savingOverride}
                        onClick={handleSubmitOverride}
                        className="w-full py-2 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-white text-xs font-bold transition-colors disabled:opacity-50"
                      >
                        {savingOverride
                          ? 'Saving…'
                          : activeCallAudit.disputeStatus === 'pending'
                          ? 'Resolve Dispute & Submit Review'
                          : 'Submit Evaluation Override'}
                      </button>
                    </div>
                  )}

                  <div className="pt-2">
                    <button
                      onClick={() => setActiveCallAudit(null)}
                      className="w-full py-2 rounded-lg border border-zinc-200 text-zinc-700 hover:bg-zinc-100 text-xs font-semibold transition-colors"
                    >
                      Close Call View
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
