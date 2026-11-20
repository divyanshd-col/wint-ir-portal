'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import PcgChatEvalPanel, { type PcgChatEvaluation } from './PcgChatEvalPanel';
import PcgPeriodFilter, { type PcgPeriod } from './PcgPeriodFilter';
import { isSamePcgAgent, isPcgAm } from '@/lib/pcg/canonical-names';
import { PcgProductCategory, detectPcgChatCategories } from '@/lib/pcg/chat-category';

function getDisputeSummary(reason?: string): string {
  if (!reason) return '';
  const raw = reason.trim();
  if (raw.startsWith('{') || raw.startsWith('[')) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        return parsed.summary || parsed.agentNote || raw;
      }
    } catch { }
  }
  return raw;
}

interface Props {
  activePersona: 'admin' | 'tl' | 'agent';
  selectedRm?: string;
  selectedTl?: string;
  loggedInUserName?: string;
  teamRms?: string[];
  callerRole?: 'tl' | 'rm';
}

export default function PcgChatQualityView({
  activePersona,
  selectedRm,
  selectedTl,
  loggedInUserName,
  teamRms,
  callerRole = 'rm',
}: Props) {
  const [chats, setChats] = useState<PcgChatEvaluation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Summary Metrics
  const [summary, setSummary] = useState({
    totalCount: 0,
    avgIqs: null as number | null,
    tripwireCount: 0,
    verdictCounts: {
      excellent: 0,
      meetsExpectations: 0,
      coaching: 0,
      remediation: 0,
      notScoreable: 0,
    },
  });

  const [availableRms, setAvailableRms] = useState<Array<{ name: string; count: number }>>([]);
  const [availableTls, setAvailableTls] = useState<Array<{ name: string; count: number }>>([
    { name: 'Dheeraj Bhojwani', count: 0 },
    { name: 'Saiyam Rastogi', count: 0 },
    { name: 'Sravanthi', count: 0 },
    { name: 'Swetha', count: 0 },
    { name: 'Tanisha Mittal', count: 0 },
  ]);

  // Filters
  const [activeSection, setActiveSection] = useState<'pending_evaluation' | 'evaluated' | 'disputes_pending' | 'disputes_reviewed' | 'all'>(
    activePersona === 'agent' ? 'evaluated' : 'pending_evaluation'
  );
  const [sectionCounts, setSectionCounts] = useState({
    pendingEvaluation: 0,
    evaluated: 0,
    disputesPending: 0,
    disputesReviewed: 0,
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCohortToggle, setActiveCohortToggle] = useState<'rm' | 'am' | 'tl' | 'team' | 'dual' | null>(null);
  const [selectedRmName, setSelectedRmName] = useState<string>(activePersona === 'agent' && selectedRm ? selectedRm : 'all');
  const [selectedAmName, setSelectedAmName] = useState<string>('all');
  const [selectedTlName, setSelectedTlName] = useState<string>('all');
  const [selectedTeamName, setSelectedTeamName] = useState<string>('all');
  const [minIqsFilter, setMinIqsFilter] = useState<string>('');
  const [maxIqsFilter, setMaxIqsFilter] = useState<string>('');
  const [verdictFilter, setVerdictFilter] = useState('all');
  const [disputeFilter, setDisputeFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [dualChatsCount, setDualChatsCount] = useState(0);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  // Period filter state - default to 'all' (Oct 13 onwards) so all evaluated chats show up immediately
  const [dateRange, setDateRange] = useState<PcgPeriod>('all');
  const [customStartDate, setCustomStartDate] = useState('2026-10-13');
  const [customEndDate, setCustomEndDate] = useState(() => {
    return new Date().toISOString().split('T')[0];
  });

  const handlePeriodChange = (range: PcgPeriod, start: string, end: string) => {
    setDateRange(range);
    setCustomStartDate(start);
    setCustomEndDate(end);
    setPage(1);
  };

  const handleToggleCohort = (target: 'rm' | 'am' | 'tl' | 'team' | 'dual') => {
    const next = activeCohortToggle === target ? null : target;
    setActiveCohortToggle(next);
    if (next === 'rm') {
      setSelectedAmName('all');
      setSelectedTlName('all');
      setSelectedTeamName('all');
    } else if (next === 'am') {
      setSelectedRmName('all');
      setSelectedTlName('all');
      setSelectedTeamName('all');
    } else if (next === 'tl') {
      setSelectedRmName('all');
      setSelectedAmName('all');
      setSelectedTeamName('all');
    } else if (next === 'team') {
      setSelectedRmName('all');
      setSelectedAmName('all');
      setSelectedTlName('all');
    } else if (next === 'dual') {
      setSelectedRmName('all');
      setSelectedAmName('all');
      setSelectedTlName('all');
      setSelectedTeamName('all');
    } else {
      setSelectedRmName('all');
      setSelectedAmName('all');
      setSelectedTlName('all');
      setSelectedTeamName('all');
    }
    setPage(1);
  };

  const { startDate, endDate } = useMemo(() => {
    if (dateRange === 'all') {
      return {
        startDate: '2026-10-13T00:00:00.000Z',
        endDate: '',
      };
    }
    if (dateRange === 'custom') {
      return {
        startDate: customStartDate ? `${customStartDate}T00:00:00.000Z` : '',
        endDate: customEndDate ? `${customEndDate}T23:59:59.999Z` : '',
      };
    }
    const days = dateRange === '7d' ? 7 : 30;
    const PCG_CHAT_DATA_START = new Date('2026-10-13T00:00:00.000Z');
    const computedStart = new Date(Date.now() - days * 86400000);
    // For 30d, ensure we don't cut off chats from the Oct 13 baseline
    const start = (dateRange === '30d' && computedStart > PCG_CHAT_DATA_START) ? PCG_CHAT_DATA_START : computedStart;
    return {
      startDate: start.toISOString(),
      endDate: new Date().toISOString(),
    };
  }, [dateRange, customStartDate, customEndDate]);

  // Selected chat for inline expansion
  const [expandedChatId, setExpandedChatId] = useState<string | null>(null);

  // Sync RM and TL filter when activePersona or props change
  useEffect(() => {
    if (activePersona === 'agent') {
      const rm = selectedRm || loggedInUserName;
      if (rm) setSelectedRmName(rm);
      setActiveSection('evaluated');
    } else if (activePersona === 'tl') {
      setActiveSection('pending_evaluation');
    } else {
      setActiveSection('pending_evaluation');
    }
  }, [activePersona, selectedRm, loggedInUserName]);

  // Canonical AMs mapped to Swetha Jayakumar
  const SWETHA_AMS = useMemo(
    () => ['Aditi Verma', 'Ankita Agarwal', 'Arshnoor Kaur', 'Bhavnit Singh', 'Vishyata Tulsani'],
    []
  );

  // Scoped team members for TL persona
  const displayedRms = useMemo(() => {
    const isSwethaTeam =
      (selectedTlName && selectedTlName.toLowerCase().includes('swetha')) ||
      (selectedTl && selectedTl.toLowerCase().includes('swetha')) ||
      (activePersona === 'tl' && (!selectedTl || selectedTl.toLowerCase().includes('swetha')));

    if (activePersona === 'tl' && teamRms && teamRms.length > 0) {
      const effectiveTeamRms = isSwethaTeam
        ? Array.from(new Set([...teamRms, ...SWETHA_AMS]))
        : teamRms;

      const teamSet = new Set(effectiveTeamRms.map((r) => r.toLowerCase()));
      const matched = availableRms.filter((r) => teamSet.has(r.name.toLowerCase()));
      const matchedNames = new Set(matched.map((r) => r.name.toLowerCase()));
      const zeroCountRms = effectiveTeamRms
        .filter((name) => !matchedNames.has(name.toLowerCase()))
        .map((name) => ({ name, count: 0 }));
      return [...matched, ...zeroCountRms].sort((a, b) => a.name.localeCompare(b.name));
    }
    return availableRms;
  }, [activePersona, teamRms, availableRms, selectedTlName, selectedTl, SWETHA_AMS]);

  // Separate Relationship Managers (RMs) and Associate Managers (AMs)
  const rmMembers = useMemo(() => {
    return displayedRms.filter((m) => !isPcgAm(m.name));
  }, [displayedRms]);

  const amMembers = useMemo(() => {
    const list = displayedRms.filter((m) => isPcgAm(m.name));
    const isSwethaTeam =
      (selectedTlName && selectedTlName.toLowerCase().includes('swetha')) ||
      (selectedTl && selectedTl.toLowerCase().includes('swetha')) ||
      (activePersona === 'tl' && (!selectedTl || selectedTl.toLowerCase().includes('swetha')));

    if (isSwethaTeam || activePersona === 'admin') {
      const existingNames = new Set(list.map((m) => m.name.toLowerCase()));
      for (const name of SWETHA_AMS) {
        if (!existingNames.has(name.toLowerCase())) {
          list.push({ name, count: 0 });
        }
      }
      return list.sort((a, b) => a.name.localeCompare(b.name));
    }
    return list;
  }, [displayedRms, selectedTlName, selectedTl, activePersona, SWETHA_AMS]);

  const fetchChats = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('limit', '10');

      if (activeCohortToggle === 'rm') {
        params.set('caller_role', 'rm');
        if (selectedRmName !== 'all') params.set('rm', selectedRmName);
      } else if (activeCohortToggle === 'am') {
        params.set('caller_role', 'am');
        if (selectedAmName !== 'all') params.set('am', selectedAmName);
      } else if (activeCohortToggle === 'tl') {
        params.set('caller_role', 'tl');
        if (selectedTlName !== 'all') params.set('tl', selectedTlName);
      } else if (activeCohortToggle === 'team') {
        params.set('caller_role', 'team');
        if (selectedTeamName !== 'all') params.set('tl', selectedTeamName);
      } else if (activeCohortToggle === 'dual') {
        params.set('role', 'dual');
      } else if (activePersona === 'agent' && selectedRmName !== 'all') {
        params.set('rm', selectedRmName);
      }
      if (minIqsFilter.trim()) params.set('min_iqs', minIqsFilter.trim());
      if (maxIqsFilter.trim()) params.set('max_iqs', maxIqsFilter.trim());
      if (verdictFilter !== 'all') params.set('verdict', verdictFilter);
      if (categoryFilter !== 'all') params.set('category', categoryFilter);
      params.set('persona', activePersona);
      params.set('section', activeSection);
      if (searchQuery.trim()) params.set('search', searchQuery.trim());
      if (startDate) params.set('startDate', startDate);
      if (endDate) params.set('endDate', endDate);

      const res = await fetch(`/api/admin/pcg-chats?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}: Failed to fetch PCG chat evaluations`);

      const data = await res.json();
      setChats(data.chats || []);
      setTotal(data.total != null ? Number(data.total) : (data.chats ? data.chats.length : 0));
      setTotalPages(data.totalPages != null ? Number(data.totalPages) : 1);
      if (data.summary) setSummary(data.summary);
      if (data.sectionCounts) setSectionCounts(data.sectionCounts);
      if (data.availableRms) setAvailableRms(data.availableRms);
      if (data.availableTls) setAvailableTls(data.availableTls);
      if (data.dualChatsCount != null) setDualChatsCount(data.dualChatsCount);
    } catch (err: any) {
      console.error('[PcgChatQualityView] Fetch error:', err);
      setError(err?.message || 'Failed to load chat quality data');
    } finally {
      setLoading(false);
    }
  }, [page, activeCohortToggle, selectedRmName, selectedAmName, selectedTlName, selectedTeamName, minIqsFilter, maxIqsFilter, verdictFilter, disputeFilter, categoryFilter, activeSection, activePersona, searchQuery, startDate, endDate]);

  useEffect(() => {
    fetchChats();
  }, [fetchChats]);

  const getVerdictPill = (verdict: string, isTripwire: boolean) => {
    if (isTripwire || verdict === 'FAILED_CRITICAL') {
      return <span className="px-2 py-0.5 text-xs font-bold rounded bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300">TRIPWIRE</span>;
    }
    if (verdict === 'NOT_SCOREABLE') {
      return <span className="px-2 py-0.5 text-xs font-bold rounded bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">NOT SCOREABLE</span>;
    }
    if (verdict === 'excellent') {
      return <span className="px-2 py-0.5 text-xs font-bold rounded bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">EXCELLENT</span>;
    }
    if (verdict === 'meets_expectations') {
      return <span className="px-2 py-0.5 text-xs font-bold rounded bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300">MEETS EXPECTATIONS</span>;
    }
    if (verdict === 'coaching') {
      return <span className="px-2 py-0.5 text-xs font-bold rounded bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">COACHING</span>;
    }
    return <span className="px-2 py-0.5 text-xs font-bold rounded bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300">REMEDIATION</span>;
  };

  const getDisputeCommentNotification = (comments: any[] | undefined, rmName?: string) => {
    if (!Array.isArray(comments) || comments.length === 0) return null;

    const isFromAgent = (c: any) => {
      const r = (c.authorRole || '').toLowerCase();
      if (r === 'agent' || r === 'rm') return true;
      if (rmName && c.authorName && c.authorName.trim().toLowerCase() === rmName.trim().toLowerCase()) return true;
      return false;
    };

    if (activePersona === 'agent') {
      // For RM/Agent: only show notification if there is a new comment from TL or Admin
      const incoming = comments.filter((c) => !isFromAgent(c));
      if (incoming.length === 0) return null;
      return {
        count: incoming.length,
        label: `${incoming.length} TL comment${incoming.length === 1 ? '' : 's'}`,
      };
    }

    if (activePersona === 'tl') {
      // For Team Lead: only show notification if there is a new comment from Agent/RM
      const incoming = comments.filter((c) => isFromAgent(c));
      if (incoming.length === 0) return null;
      return {
        count: incoming.length,
        label: `${incoming.length} RM comment${incoming.length === 1 ? '' : 's'}`,
      };
    }

    // For Admin: show total comments
    return {
      count: comments.length,
      label: `${comments.length} comment${comments.length === 1 ? '' : 's'}`,
    };
  };

  return (
    <div className="space-y-6">

      {/* Top Sections for TLs and Admins */}
      {(activePersona === 'tl' || activePersona === 'admin') && (
        <div className="flex flex-wrap items-center gap-2 pb-3 border-b border-slate-200 dark:border-slate-800">
          {/* 1. Pending Evaluation (AI-evaluated chats awaiting TL evaluation/override) */}
          <button
            onClick={() => { setActiveSection('pending_evaluation'); setPage(1); setExpandedChatId(null); }}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center gap-2 ${activeSection === 'pending_evaluation'
              ? 'bg-zinc-900 text-white font-bold shadow-sm'
              : 'bg-white dark:bg-slate-900 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800'
              }`}
          >
            <span>Pending Evaluation</span>
            <span
              className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${activeSection === 'pending_evaluation'
                ? 'bg-zinc-700 text-white'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                }`}
            >
              {sectionCounts.pendingEvaluation}
            </span>
          </button>

          {/* 2. Evaluated Chats (Only chats evaluated by TLs via submit evaluation override) */}
          <button
            onClick={() => { setActiveSection('evaluated'); setPage(1); setExpandedChatId(null); }}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center gap-2 ${activeSection === 'evaluated'
              ? 'bg-zinc-900 text-white font-bold shadow-sm'
              : 'bg-white dark:bg-slate-900 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800'
              }`}
          >
            <span>Evaluated Chats</span>
            <span
              className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${activeSection === 'evaluated'
                ? 'bg-zinc-700 text-white'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                }`}
            >
              {sectionCounts.evaluated}
            </span>
          </button>

          {/* 3. Disputes Pending */}
          <button
            onClick={() => { setActiveSection('disputes_pending'); setPage(1); setExpandedChatId(null); }}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center gap-2 ${activeSection === 'disputes_pending'
              ? 'bg-zinc-900 text-white font-bold shadow-sm'
              : 'bg-white dark:bg-slate-900 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800'
              }`}
          >
            <span>Disputes Pending</span>
            {sectionCounts.disputesPending > 0 ? (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500 text-white animate-pulse">
                {sectionCounts.disputesPending}
              </span>
            ) : (
              <span
                className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${activeSection === 'disputes_pending'
                  ? 'bg-zinc-700 text-white'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                  }`}
              >
                0
              </span>
            )}
          </button>

          {/* 4. Disputes Reviewed */}
          <button
            onClick={() => { setActiveSection('disputes_reviewed'); setPage(1); setExpandedChatId(null); }}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center gap-2 ${activeSection === 'disputes_reviewed'
              ? 'bg-zinc-900 text-white font-bold shadow-sm'
              : 'bg-white dark:bg-slate-900 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800'
              }`}
          >
            <span>Disputes Reviewed</span>
            <span
              className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${activeSection === 'disputes_reviewed'
                ? 'bg-zinc-700 text-white'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                }`}
            >
              {sectionCounts.disputesReviewed}
            </span>
          </button>
        </div>
      )}

      {/* Top Sections for Agents */}
      {activePersona === 'agent' && (
        <div className="flex flex-wrap items-center gap-2 pb-3 border-b border-slate-200 dark:border-slate-800">
          {/* 1. Evaluated Chats */}
          <button
            onClick={() => { setActiveSection('evaluated'); setPage(1); setExpandedChatId(null); }}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center gap-2 ${activeSection === 'evaluated'
              ? 'bg-zinc-900 text-white font-bold shadow-sm'
              : 'bg-white dark:bg-slate-900 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800'
              }`}
          >
            <span>Evaluated Chats</span>
            <span
              className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${activeSection === 'evaluated'
                ? 'bg-zinc-700 text-white'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                }`}
            >
              {sectionCounts.evaluated}
            </span>
          </button>

          {/* 2. Disputes Raised */}
          <button
            onClick={() => { setActiveSection('disputes_pending'); setPage(1); setExpandedChatId(null); }}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center gap-2 ${activeSection === 'disputes_pending'
              ? 'bg-zinc-900 text-white font-bold shadow-sm'
              : 'bg-white dark:bg-slate-900 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800'
              }`}
          >
            <span>Disputes Raised</span>
            {sectionCounts.disputesPending > 0 ? (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500 text-white animate-pulse">
                {sectionCounts.disputesPending}
              </span>
            ) : (
              <span
                className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${activeSection === 'disputes_pending'
                  ? 'bg-zinc-700 text-white'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                  }`}
              >
                0
              </span>
            )}
          </button>

          {/* 3. Disputes Reviewed */}
          <button
            onClick={() => { setActiveSection('disputes_reviewed'); setPage(1); setExpandedChatId(null); }}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center gap-2 ${activeSection === 'disputes_reviewed'
              ? 'bg-zinc-900 text-white font-bold shadow-sm'
              : 'bg-white dark:bg-slate-900 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800'
              }`}
          >
            <span>Disputes Reviewed</span>
            <span
              className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${activeSection === 'disputes_reviewed'
                ? 'bg-zinc-700 text-white'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                }`}
            >
              {sectionCounts.disputesReviewed}
            </span>
          </button>
        </div>
      )}

      {/* KPI Summary Cards & Period Filter */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 px-0.5">
          <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
            {activeCohortToggle === 'tl'
              ? (selectedTlName !== 'all' ? `${selectedTlName} Chat Quality Overview` : 'Team Lead Chat Quality Overview')
              : activeCohortToggle === 'rm'
                ? (selectedRmName !== 'all' ? `${selectedRmName} Chat Quality Overview` : 'Relationship Manager Chat Quality Overview')
                : activeCohortToggle === 'am'
                  ? (selectedAmName !== 'all' ? `${selectedAmName} Chat Quality Overview` : 'Associate Manager Chat Quality Overview')
                  : activeCohortToggle === 'team'
                    ? (selectedTeamName !== 'all' ? `Team ${selectedTeamName} Chat Quality Overview` : 'Team Chat Quality Overview')
                    : activeCohortToggle === 'dual'
                      ? 'Dual Chats Quality Overview'
                      : activePersona === 'agent'
                        ? 'My Chat Quality Overview'
                        : activePersona === 'tl'
                          ? 'Team Chat Quality Overview'
                          : 'Department Chat Quality Overview'}
          </span>
          <PcgPeriodFilter
            range={dateRange}
            start={customStartDate}
            end={customEndDate}
            onChange={handlePeriodChange}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {/* Card 1: Average Chat IQS */}
          <div className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block">
              {activeCohortToggle === 'tl'
                ? (selectedTlName !== 'all' ? `${selectedTlName} Avg IQS` : 'Average TL Chat IQS')
                : activeCohortToggle === 'rm'
                  ? (selectedRmName !== 'all' ? `${selectedRmName} Avg IQS` : 'RM Average Chat IQS')
                  : activeCohortToggle === 'am'
                    ? (selectedAmName !== 'all' ? `${selectedAmName} Avg IQS` : 'AM Average Chat IQS')
                    : activeCohortToggle === 'team'
                      ? (selectedTeamName !== 'all' ? `Team ${selectedTeamName} Avg IQS` : 'Team Average Chat IQS')
                      : activeCohortToggle === 'dual'
                        ? 'Dual Chats Avg IQS'
                        : activePersona === 'agent'
                          ? 'My Average Chat IQS'
                          : activePersona === 'tl'
                            ? 'Team Average Chat IQS'
                            : 'Average Chat IQS'}
            </span>
            <div className="text-2xl font-black text-slate-900 dark:text-white mt-1">
              {summary.avgIqs != null ? `${summary.avgIqs}%` : '—'}
            </div>
          </div>

          {/* Card 2: Evaluated Chats Count */}
          <div className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block">
              {activeCohortToggle === 'tl'
                ? 'TL Evaluated Closed Chats'
                : activeCohortToggle === 'rm'
                  ? 'RM Evaluated Closed Chats'
                  : activeCohortToggle === 'am'
                    ? 'AM Evaluated Closed Chats'
                    : activeCohortToggle === 'team'
                      ? 'Team Evaluated Closed Chats'
                      : activeCohortToggle === 'dual'
                        ? 'Dual Evaluated Closed Chats'
                        : activePersona === 'agent'
                          ? 'My Evaluated Chats'
                          : activePersona === 'tl'
                            ? 'Team Evaluated Chats'
                            : 'Evaluated Closed Chats'}
            </span>
            <div className="text-2xl font-black text-slate-900 dark:text-white mt-1">
              {summary.totalCount}
            </div>
          </div>

          {/* Card 3: Compliance Tripwire Breaches */}
          <div className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block">
              Compliance Breaches
            </span>
            <div className="text-2xl font-black text-slate-900 dark:text-white mt-1">
              {summary.tripwireCount}
            </div>
          </div>
        </div>
      </div>

      {/* Filter & Search Bar - Single Clean Line */}
      <div className="p-2.5 sm:p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm flex items-center gap-2.5 flex-wrap">
        {/* Search Input */}
        <div className="relative w-44 xl:w-52 shrink-0">
          <input
            type="text"
            placeholder={activeCohortToggle === 'tl' ? 'Search client or TL name...' : 'Search phone, name...'}
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
            className="w-full h-9 text-xs px-2.5 py-1.5 pl-7 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
          <span className="absolute left-2.5 top-2.5 text-slate-400 pointer-events-none">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </span>
        </div>

        {/* Cohort Toggles (RMs, AMs, Dual Chats) - strictly for TL view, hidden for Admin */}
        {activePersona === 'tl' && (
          <div className="flex items-center gap-2">
            <div className="inline-flex items-center rounded-lg border border-[#E4E4E7] dark:border-slate-800 bg-zinc-100/90 dark:bg-slate-800/90 p-0.5 shrink-0 shadow-2xs">
              <button
                type="button"
                onClick={() => handleToggleCohort('rm')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all cursor-pointer ${activeCohortToggle === 'rm'
                    ? 'bg-white dark:bg-slate-900 text-zinc-900 dark:text-white shadow-2xs font-bold'
                    : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white'
                  }`}
              >
                RMs
              </button>
              <button
                type="button"
                onClick={() => handleToggleCohort('am')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all cursor-pointer ${activeCohortToggle === 'am'
                    ? 'bg-white dark:bg-slate-900 text-zinc-900 dark:text-white shadow-2xs font-bold'
                    : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white'
                  }`}
              >
                AMs
              </button>
              <button
                type="button"
                onClick={() => handleToggleCohort('dual')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all cursor-pointer ${activeCohortToggle === 'dual'
                    ? 'bg-white dark:bg-slate-900 text-zinc-900 dark:text-white shadow-2xs font-bold'
                    : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white'
                  }`}
              >
                Dual Chats
              </button>
            </div>

            {/* Conditional Dropdown for RMs */}
            {activeCohortToggle === 'rm' && (
              <select
                id="chat-rm-dropdown"
                value={selectedRmName}
                onChange={(e) => {
                  setSelectedRmName(e.target.value);
                  setPage(1);
                }}
                className="h-9 text-xs px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white font-medium shrink-0 cursor-pointer shadow-2xs"
              >
                <option value="all">All RMs</option>
                {rmMembers.map((rm) => (
                  <option key={rm.name} value={rm.name}>
                    {rm.name}
                  </option>
                ))}
              </select>
            )}

            {/* Conditional Dropdown for AMs */}
            {activeCohortToggle === 'am' && (
              <select
                id="chat-am-dropdown"
                value={selectedAmName}
                onChange={(e) => {
                  setSelectedAmName(e.target.value);
                  setPage(1);
                }}
                className="h-9 text-xs px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white font-medium shrink-0 cursor-pointer shadow-2xs"
              >
                <option value="all">All AMs</option>
                {amMembers.map((am) => (
                  <option key={am.name} value={am.name}>
                    {am.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}

        {/* Min IQS Input */}
        <input
          id="chat-min-iqs-input"
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
          className={`w-20 h-9 text-xs border rounded-lg px-2.5 py-1.5 outline-none shadow-2xs bg-white dark:bg-slate-950 text-zinc-900 dark:text-white placeholder:text-zinc-400 transition-colors [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${minIqsFilter !== ''
              ? 'border-emerald-500 ring-1 ring-emerald-500'
              : 'border-slate-300 dark:border-slate-700 focus:border-emerald-500'
            }`}
        />

        {/* Max IQS Input */}
        <input
          id="chat-max-iqs-input"
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
          className={`w-20 h-9 text-xs border rounded-lg px-2.5 py-1.5 outline-none shadow-2xs bg-white dark:bg-slate-950 text-zinc-900 dark:text-white placeholder:text-zinc-400 transition-colors [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${maxIqsFilter !== ''
              ? 'border-emerald-500 ring-1 ring-emerald-500'
              : 'border-slate-300 dark:border-slate-700 focus:border-emerald-500'
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
            className="text-[11px] font-semibold text-zinc-600 dark:text-zinc-400 hover:text-black dark:hover:text-white underline px-1 py-1 cursor-pointer"
          >
            Reset IQS
          </button>
        )}

        {/* Compliance Mistake Filter */}
        <select
          value={verdictFilter}
          onChange={(e) => { setVerdictFilter(e.target.value); setPage(1); }}
          className="h-9 text-xs px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white font-medium shrink-0 cursor-pointer"
        >
          <option value="all">Compliance: All</option>
          <option value="tripwire">Compliance Mistake: Yes</option>
          <option value="clean">Compliance Mistake: No</option>
        </select>

        {/* Category Filter */}
        <select
          value={categoryFilter}
          onChange={(e) => { setCategoryFilter(e.target.value); setPage(1); }}
          className="h-9 text-xs px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white font-medium shrink-0 cursor-pointer"
        >
          <option value="all">Category: All</option>
          <option value="AIF">Category: AIF</option>
          <option value="PMS">Category: PMS</option>
          <option value="Bonds">Category: Bonds</option>
          <option value="MLD">Category: MLD</option>
          <option value="FD">Category: FD</option>
          <option value="multiple">Category: Multiple</option>
          <option value="General">Category: General</option>
          <option value="not_scoreable">Excluded / NA Chats</option>
        </select>
      </div>

      {/* Evaluated Chats / Disputes Table */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm overflow-hidden">
        {loading ? (
          <div className="py-20 text-center text-slate-400 text-xs">
            <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            Loading {activeSection === 'pending_evaluation' ? 'pending evaluations' : activeSection === 'evaluated' ? 'evaluated chats' : activeSection === 'disputes_pending' ? 'pending disputes' : 'reviewed disputes'}...
          </div>
        ) : error ? (
          <div className="py-16 text-center text-rose-500 text-xs font-medium">
            {error}
          </div>
        ) : chats.length === 0 ? (
          <div className="py-20 text-center text-slate-400 text-xs">
            {activeCohortToggle === 'tl' ? (
              <div className="flex flex-col items-center justify-center gap-1.5">
                <div className="w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400 mb-1">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                </div>
                <span className="font-semibold text-slate-700 dark:text-slate-200 text-sm">No TL Chats Found</span>
                <span className="text-slate-400 text-xs">No chats handled by Team Leads match the selected filters.</span>
              </div>
            ) : activeSection === 'pending_evaluation' ? (
              <div className="flex flex-col items-center justify-center gap-1.5">
                <span className="text-emerald-600 text-2xl font-bold">✓</span>
                <span className="font-semibold text-slate-700 dark:text-slate-200 text-sm">No Chats Pending Evaluation</span>
                <span className="text-slate-400 text-xs">
                  All AI-evaluated chats for your team have been reviewed.
                </span>
              </div>
            ) : activeSection === 'evaluated' ? (
              <div className="flex flex-col items-center justify-center gap-1.5">
                <div className="w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400 mb-1">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
                    <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
                  </svg>
                </div>
                <span className="font-semibold text-slate-700 dark:text-slate-200 text-sm">No Evaluated Chats</span>
                <span className="text-slate-400 text-xs">
                  {activePersona === 'agent'
                    ? 'No evaluated chats found for this period.'
                    : 'Chats evaluated by Team Leads using "Submit Evaluation Override" will automatically appear here.'}
                </span>
              </div>
            ) : activeSection === 'disputes_pending' ? (
              <div className="flex flex-col items-center justify-center gap-1.5">
                <span className="text-zinc-400 text-2xl font-bold">⚖️</span>
                <span className="font-semibold text-slate-700 dark:text-slate-200 text-sm">
                  {activePersona === 'agent' ? 'No Disputes Raised' : 'No Pending Disputes'}
                </span>
                <span className="text-slate-400 text-xs">
                  {activePersona === 'agent'
                    ? 'You have not raised any disputes on your evaluated chats for this period.'
                    : 'All agent challenges for your team have been reviewed and resolved.'}
                </span>
              </div>
            ) : activeSection === 'disputes_reviewed' ? (
              <div className="flex flex-col items-center justify-center gap-1.5">
                <span className="text-emerald-600 text-2xl font-bold">✓</span>
                <span className="font-semibold text-slate-700 dark:text-slate-200 text-sm">
                  {activePersona === 'agent' ? 'No Disputes Reviewed' : 'No Reviewed Disputes'}
                </span>
                <span className="text-slate-400 text-xs">
                  {activePersona === 'agent'
                    ? 'None of your raised disputes have been reviewed yet in this period.'
                    : 'No agent disputes have been reviewed for the current period.'}
                </span>
              </div>
            ) : (
              <div>No PCG chat evaluations match the current filter criteria.</div>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50/80 dark:bg-slate-950/80 border-b border-slate-200 dark:border-slate-800 text-slate-500 font-bold uppercase tracking-wider text-[10px]">
                  <th className="py-3 px-4">Customer</th>
                  {activePersona !== 'agent' && (
                    <th className="py-3 px-4">
                      {activeCohortToggle === 'tl'
                        ? 'Team Lead'
                        : activeCohortToggle === 'am'
                          ? 'Associate Manager'
                          : activeCohortToggle === 'team'
                            ? 'Team / Member'
                            : activeCohortToggle === 'rm'
                              ? 'Relationship Manager'
                              : 'Handler / RM'}
                    </th>
                  )}
                  <th className="py-3 px-4">Category</th>

                  {activeSection === 'disputes_pending' ? (
                    <>
                      <th className="py-3 px-4">{activePersona === 'agent' ? 'My Dispute Reason' : 'Agent Dispute Reason'}</th>
                      <th className="py-3 px-4 text-center whitespace-nowrap">Messages</th>
                      <th className="py-3 px-4 whitespace-nowrap">Closed Date</th>
                      <th className="py-3 px-4 text-center whitespace-nowrap">Current IQS</th>
                      <th className="py-3 px-4 whitespace-nowrap">Status</th>
                    </>
                  ) : activeSection === 'disputes_reviewed' ? (
                    <>
                      <th className="py-3 px-4">{activePersona === 'agent' ? 'My Challenge' : 'Agent Challenge'}</th>
                      <th className="py-3 px-4">{activePersona === 'agent' ? 'TL Decision / Note' : 'TL Override Note'}</th>
                      <th className="py-3 px-4 text-center whitespace-nowrap">Messages</th>
                      <th className="py-3 px-4 text-center whitespace-nowrap">Final IQS</th>
                      <th className="py-3 px-4 whitespace-nowrap">Status</th>
                    </>
                  ) : activeSection === 'evaluated' ? (
                    <>
                      <th className="py-3 px-4 text-center">Messages</th>
                      <th className="py-3 px-4">Closed Date</th>
                      <th className="py-3 px-4 text-center">{activePersona === 'agent' ? 'Chat IQS' : 'Evaluated IQS'}</th>
                      <th className="py-3 px-4">Compliance Mistake</th>
                      {activePersona !== 'agent' && <th className="py-3 px-4">Evaluated By</th>}
                    </>
                  ) : (
                    <>
                      <th className="py-3 px-4 text-center">Messages</th>
                      <th className="py-3 px-4">Closed Date</th>
                      <th className="py-3 px-4 text-center">AI Scored IQS</th>
                      <th className="py-3 px-4">Compliance Mistake</th>
                    </>
                  )}

                  <th className="sticky right-0 z-10 bg-slate-50 dark:bg-slate-950 py-3 px-4 text-right whitespace-nowrap shadow-[-6px_0_12px_-4px_rgba(0,0,0,0.08)] dark:shadow-[-6px_0_12px_-4px_rgba(0,0,0,0.4)]">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-medium">
                {chats.map((chat) => {
                  const categories = (Array.isArray(chat.categories) && chat.categories.length > 0)
                    ? (chat.categories as PcgProductCategory[])
                    : detectPcgChatCategories(chat);
                  const isExpanded = expandedChatId === chat.id;
                  const totalCols = 10;
                  const isOverridden = chat.disputeStatus === 'overridden' || chat.disputeStatus === 'resolved' || Boolean(chat.tlOverrideNote);

                  const breachedGates = (chat.complianceFlags || []).filter((f: any) => f.status === 'FAIL');
                  const breachedBy = chat.precedingRmName && chat.complianceTripwire ? 'Both' : null;

                  return (
                    <React.Fragment key={chat.id}>
                      <tr
                        className={`hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors cursor-pointer ${isExpanded ? 'bg-slate-50/80 dark:bg-slate-800/50' : ''
                          }`}
                        onClick={() => setExpandedChatId(isExpanded ? null : chat.id)}
                      >
                        <td className="py-3 px-4">
                          <div className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                            <span>{chat.customerName || 'Client'}</span>
                            {chat.precedingRmName && activePersona === 'agent' && (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9.5px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 tracking-wide">
                                Dual Chat
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-500 font-mono">
                            +{chat.customerPhone}
                          </div>
                          {chat.precedingRmName && activePersona === 'agent' && (
                            <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 font-medium">
                              Co-handled: {chat.precedingRmName} (RM) + {chat.rmName} (AM)
                            </div>
                          )}
                        </td>

                        {activePersona !== 'agent' && (
                          <td className="py-3 px-4 text-slate-800 dark:text-slate-200">
                            {chat.precedingRmName ? (
                              <div className="flex flex-col gap-0.5">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="font-bold text-slate-900 dark:text-slate-100">{chat.rmName}</span>
                                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 tracking-wide">
                                    Dual Chat
                                  </span>
                                </div>
                                <div className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
                                  Co-handled with <span className="text-slate-700 dark:text-slate-300 font-semibold">{chat.precedingRmName}</span> (RM)
                                </div>
                              </div>
                            ) : (
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="font-semibold">{chat.rmName}</span>
                                {['tanisha mittal', 'swetha', 'swetha jayakumar', 'sravanthi', 'dheeraj bhojwani', 'saiyam rastogi'].some(t => t === (chat.rmName || '').toLowerCase().trim()) && (
                                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 tracking-wide">
                                    TL
                                  </span>
                                )}
                                {(chat.isAm || isPcgAm(chat.rmName)) && (
                                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 tracking-wide">
                                    AM
                                  </span>
                                )}
                              </div>
                            )}
                          </td>
                        )}

                        {/* Category Column */}
                        <td className="py-3 px-4 text-xs font-semibold text-slate-700 dark:text-slate-300">
                          {categories.join(', ')}
                        </td>

                        {/* Disputes Pending Columns */}
                        {activeSection === 'disputes_pending' && (
                          <>
                            <td className="py-3 px-4 min-w-[280px] max-w-lg">
                              <div
                                className="text-xs text-zinc-700 dark:text-zinc-300 bg-zinc-100 dark:bg-zinc-800/60 p-2.5 rounded-lg border border-zinc-200 dark:border-zinc-700 break-words whitespace-normal leading-relaxed"
                              >
                                <span className="font-bold text-zinc-900 dark:text-zinc-100 mr-1.5">
                                  {activePersona === 'agent' ? 'My Note:' : 'RM Note:'}
                                </span>
                                {getDisputeSummary(chat.disputeReason) || 'No reasoning provided'}
                              </div>
                              {(() => {
                                const notif = getDisputeCommentNotification(chat.disputeComments, chat.rmName);
                                if (!notif) return null;
                                return (
                                  <div className="mt-1 flex items-center gap-1">
                                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 whitespace-nowrap">
                                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                                      </svg>
                                      <span>{notif.label}</span>
                                    </span>
                                  </div>
                                );
                              })()}
                            </td>
                            <td className="py-3 px-4 text-center text-slate-700 dark:text-slate-300 font-mono whitespace-nowrap">
                              {chat.totalMessages}
                            </td>
                            <td className="py-3 px-4 text-slate-500 dark:text-slate-400 text-[11px] whitespace-nowrap">
                              {new Date(chat.chatClosedAt).toLocaleDateString()}
                            </td>
                            <td className="py-3 px-4 text-center whitespace-nowrap">
                              {chat.iqsScore != null ? (
                                <span className="inline-flex items-center justify-center font-bold text-xs px-2.5 py-0.5 rounded-md border border-zinc-200 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 tabular-nums">
                                  {chat.iqsScore}%
                                </span>
                              ) : (
                                <span className="text-slate-400 font-bold">NA</span>
                              )}
                            </td>
                            <td className="py-3 px-4 whitespace-nowrap">
                              <span className="inline-flex items-center px-2.5 py-1 rounded text-[11px] font-bold whitespace-nowrap bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 border border-zinc-300 dark:border-zinc-700">
                                {activePersona === 'agent' ? 'Awaiting TL Review' : 'Pending TL Review'}
                              </span>
                            </td>
                          </>
                        )}

                        {/* Disputes Reviewed Columns */}
                        {activeSection === 'disputes_reviewed' && (
                          <>
                            <td className="py-3 px-4">
                              <div className="text-xs text-slate-700 dark:text-slate-300 max-w-xs truncate" title={getDisputeSummary(chat.disputeReason)}>
                                {getDisputeSummary(chat.disputeReason) || '—'}
                              </div>
                              {(() => {
                                const notif = getDisputeCommentNotification(chat.disputeComments, chat.rmName);
                                if (!notif) return null;
                                return (
                                  <div className="mt-1 flex items-center gap-1">
                                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                                      </svg>
                                      <span>{notif.label}</span>
                                    </span>
                                  </div>
                                );
                              })()}
                            </td>
                            <td className="py-3 px-4">
                              <div
                                className="text-xs text-emerald-900 dark:text-emerald-200 bg-emerald-50 dark:bg-emerald-950/50 p-1.5 rounded border border-emerald-200 dark:border-emerald-900 max-w-sm truncate"
                                title={chat.tlOverrideNote}
                              >
                                <span className="font-semibold text-emerald-800 dark:text-emerald-300 mr-1">TL:</span>
                                {chat.tlOverrideNote || 'Evaluation overridden by TL'}
                              </div>
                            </td>
                            <td className="py-3 px-4 text-center text-slate-700 dark:text-slate-300 font-mono">
                              {chat.totalMessages}
                            </td>
                            <td className="py-3 px-4 text-center">
                              {chat.iqsScore != null ? (
                                <span className="inline-flex items-center justify-center font-bold text-xs px-2.5 py-0.5 rounded-md border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-200 tabular-nums">
                                  {chat.iqsScore}%
                                </span>
                              ) : (
                                <span className="text-slate-400 font-bold">NA</span>
                              )}
                            </td>
                            <td className="py-3 px-4 whitespace-nowrap">
                              <span className="inline-flex items-center px-2.5 py-1 rounded text-[10px] font-bold whitespace-nowrap bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-900">
                                {chat.disputeStatus === 'overridden' ? 'Overridden' : 'Resolved'}
                              </span>
                            </td>
                          </>
                        )}

                        {/* Evaluated Chats Columns */}
                        {activeSection === 'evaluated' && (
                          <>
                            <td className="py-3 px-4 text-center text-slate-700 dark:text-slate-300 font-mono">
                              {chat.totalMessages}
                            </td>

                            <td className="py-3 px-4 text-slate-500 dark:text-slate-400 text-[11px]">
                              {new Date(chat.chatClosedAt).toLocaleDateString()}
                            </td>

                            <td className="py-3 px-4 text-center">
                              <div className="inline-flex items-center gap-1.5">
                                {chat.iqsScore != null ? (
                                  <span className="inline-flex items-center justify-center font-bold text-xs px-2.5 py-0.5 rounded-md border border-zinc-200 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 tabular-nums">
                                    {chat.iqsScore}%
                                  </span>
                                ) : (
                                  <span className="text-slate-400 font-bold">NA</span>
                                )}
                                {activePersona !== 'agent' && (
                                  <span
                                    className="px-1.5 py-0.5 rounded text-[9.5px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800"
                                    title="Evaluation submitted by Team Lead"
                                  >
                                    Evaluated
                                  </span>
                                )}
                              </div>
                            </td>

                            <td className="py-3 px-4">
                              {chat.complianceTripwire ? (
                                <span
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold text-red-700 bg-red-50 dark:bg-red-950/60 dark:text-red-300 border border-red-200 dark:border-red-900"
                                  title={chat.complianceReason || 'Compliance violation detected'}
                                >
                                  <span>Yes</span>
                                  {breachedBy && (
                                    <span className="text-[9.5px] px-1 py-0.2 rounded bg-red-100 dark:bg-red-900/60 font-semibold">
                                      {breachedBy}
                                    </span>
                                  )}
                                </span>
                              ) : (
                                <span className="text-zinc-600 dark:text-zinc-400 font-medium" title="No compliance mistake detected">
                                  No
                                </span>
                              )}
                            </td>

                            {activePersona !== 'agent' && (
                              <td className="py-3 px-4">
                                <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                                  {chat.reviewedBy || chat.tlName || 'Team Lead'}
                                </div>
                                {chat.reviewedAt && (
                                  <div className="text-[10px] text-slate-400">
                                    {new Date(chat.reviewedAt).toLocaleDateString()}
                                  </div>
                                )}
                              </td>
                            )}
                          </>
                        )}

                        {/* Pending Evaluation & Default Columns (for AI-evaluated chats) */}
                        {activeSection !== 'disputes_pending' && activeSection !== 'disputes_reviewed' && activeSection !== 'evaluated' && (
                          <>
                            <td className="py-3 px-4 text-center text-slate-700 dark:text-slate-300 font-mono">
                              {chat.totalMessages}
                            </td>

                            <td className="py-3 px-4 text-slate-500 dark:text-slate-400 text-[11px]">
                              {new Date(chat.chatClosedAt).toLocaleDateString()}
                            </td>

                            <td className="py-3 px-4 text-center">
                              {chat.iqsScore != null ? (
                                <span className="inline-flex items-center justify-center font-bold text-xs px-2.5 py-0.5 rounded-md border border-zinc-200 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 tabular-nums">
                                  {chat.iqsScore}%
                                </span>
                              ) : (
                                <span className="text-slate-400 font-bold">NA</span>
                              )}
                            </td>

                            <td className="py-3 px-4">
                              {chat.complianceTripwire ? (
                                <span
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold text-red-700 bg-red-50 dark:bg-red-950/60 dark:text-red-300 border border-red-200 dark:border-red-900"
                                  title={chat.complianceReason || 'Compliance violation detected'}
                                >
                                  <span>Yes</span>
                                  {breachedBy && (
                                    <span className="text-[9.5px] px-1 py-0.2 rounded bg-red-100 dark:bg-red-900/60 font-semibold">
                                      {breachedBy}
                                    </span>
                                  )}
                                </span>
                              ) : (
                                <span className="text-zinc-600 dark:text-zinc-400 font-medium" title="No compliance mistake detected">
                                  No
                                </span>
                              )}
                            </td>
                          </>
                        )}

                        <td
                          className={`sticky right-0 z-10 py-3 px-4 text-right whitespace-nowrap shadow-[-6px_0_12px_-4px_rgba(0,0,0,0.08)] dark:shadow-[-6px_0_12px_-4px_rgba(0,0,0,0.4)] ${isExpanded ? 'bg-slate-50 dark:bg-slate-800' : 'bg-white dark:bg-slate-900'
                            }`}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            onClick={() => setExpandedChatId(isExpanded ? null : chat.id)}
                            className="px-3.5 py-1.5 rounded-lg font-semibold transition-all text-xs shadow-sm inline-flex items-center justify-center gap-1.5 bg-zinc-900 hover:bg-zinc-800 active:bg-zinc-950 text-white whitespace-nowrap cursor-pointer shrink-0"
                          >
                            <span>
                              {isExpanded
                                ? 'Hide'
                                : activeSection === 'disputes_pending'
                                  ? (activePersona === 'agent' ? 'View Dispute' : 'Review Dispute')
                                  : activeSection === 'disputes_reviewed'
                                    ? 'View Review'
                                    : activeSection === 'evaluated'
                                      ? (activePersona === 'tl' ? 'View / Re-evaluate' : 'View Evaluation')
                                      : activePersona === 'agent' || activePersona === 'admin'
                                        ? 'View Evaluation'
                                        : 'Review & Evaluate'}
                            </span>
                            <span className="text-[10px] opacity-70">
                              {isExpanded ? '▲' : '▼'}
                            </span>
                          </button>
                        </td>
                      </tr>

                      {isExpanded && (
                        <PcgChatEvalPanel
                          chat={chat}
                          colSpan={totalCols}
                          onClose={() => setExpandedChatId(null)}
                          onSelectChat={(newChatId) => setExpandedChatId(newChatId)}
                          onDisputeUpdate={(opts) => {
                            fetchChats();
                            if (opts?.close) {
                              setExpandedChatId(null);
                            }
                          }}
                          userRole={activePersona}
                          allowRaiseDispute={activePersona === 'agent'}
                        />
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Controls (10 entries per page, matching Calls) */}
        {totalPages > 1 && (
          <div className="p-3.5 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 flex items-center justify-between">
            <button
              disabled={page <= 1}
              onClick={() => {
                setPage((p) => Math.max(1, p - 1));
                setExpandedChatId(null);
              }}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed shadow-sm cursor-pointer transition-colors"
            >
              ← Previous
            </button>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              Page <span className="font-bold text-slate-900 dark:text-white">{page}</span> of{' '}
              <span className="font-bold text-slate-900 dark:text-white">{totalPages}</span>
              {total > 0 && <span className="ml-1 opacity-70">({total} total chats)</span>}
            </span>
            <button
              disabled={page >= totalPages}
              onClick={() => {
                setPage((p) => Math.min(totalPages, p + 1));
                setExpandedChatId(null);
              }}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed shadow-sm cursor-pointer transition-colors"
            >
              Next →
            </button>
          </div>
        )}
      </div>

    </div>
  );
}

