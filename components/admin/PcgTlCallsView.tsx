'use client';

import React, { useState, useEffect, useMemo } from 'react';
import PcgPeriodFilter from './PcgPeriodFilter';
import CallEvalPanel from '@/components/quality/CallEvalPanel';

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
}

export interface PCGCall {
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
  categoryKey: string;
  secondaryCategories?: string[];
  aiCategoryReasoning?: string;
  iqsScore: number | null;
  isEvaluable?: boolean;
  exclusionReason?: string | null;
  callNature?: string | null;
  verdict?: string | null;
  gates: { status: 'PASS' | 'FAIL'; reason?: string; [key: string]: any };
  needsAttention: boolean;
  parameters: CallParameter[];
  aiCoachingTip: string | null;
  transcriptTurns: TranscriptTurn[];
  disputeStatus: 'none' | 'pending' | 'resolved' | 'overridden';
  sopTriggers?: Array<{
    category: string;
    severity: string;
    direction: string;
    signal: string;
    timestamp: string;
    turn_index?: number;
    quote: string;
  }>;
}

export interface PcgTlCallsViewProps {
  onOpenCallDrawer?: (callId: string) => void;
  globalDateRange?: '7d' | '30d' | 'custom';
  globalCustomStartDate?: string;
  globalCustomEndDate?: string;
  /** Called when the period filter on this page changes (the date range lives in the parent). */
  onPeriodChange?: (range: '7d' | '30d' | 'custom', start: string, end: string) => void;
}

// Helpers for CallEvalPanel formatting
export const formatCallIqsScores = (call: PCGCall) => {
  const scores: Record<string, string> = {
    CallOpening: 'Yes',
    CallClosing: 'Yes',
    TechnicalLegal: 'Yes',
    TechnicallyLegal: 'Yes',
    AllQuestions: 'Yes',
    Expectation: 'Yes',
    Process: 'Yes',
    Grammar: 'Yes',
    VocabularyGrammar: 'Yes',
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
    const matchingTrigger = (call.sopTriggers || []).find(
      (st) => st.turn_index === (idx + 1) || (turn.time && st.timestamp === turn.time) || (st.quote && turn.text && (turn.text.includes(st.quote) || st.quote.includes(turn.text)))
    );
    segments.push({
      speaker: turn.speaker === 'RM' ? 'IR_EXECUTIVE' : 'INVESTOR',
      text: turn.text,
      ts: turn.time || `0:${(idx * 3 + 3).toString().padStart(2, '0')}`,
      isSopTrigger: Boolean(matchingTrigger),
      sopTrigger: matchingTrigger,
    });
    if (idx < call.transcriptTurns.length - 1) {
      segments.push({
        type: 'dead_air',
        duration: '~1 seconds',
      });
    }
  });
  return segments;
};

export default function PcgTlCallsView({
  onOpenCallDrawer,
  globalDateRange = '7d',
  globalCustomStartDate,
  globalCustomEndDate,
  onPeriodChange = () => {},
}: PcgTlCallsViewProps) {
  // TL selection: 'all' or specific Team Lead
  const [selectedTl, setSelectedTl] = useState<string>('all');

  // Category filter: 'all' | '13_pitching' | 'upselling' | 'support' | 'excluded' | etc.
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

  // Date range derived from global navigation or local fallback
  const dateRange = globalDateRange || '7d';
  const customStartDate = globalCustomStartDate || '';
  const customEndDate = globalCustomEndDate || '';

  // Table filters & pagination
  const [searchQuery, setSearchQuery] = useState('');
  const [minIqsFilter, setMinIqsFilter] = useState('');
  const [maxIqsFilter, setMaxIqsFilter] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCalls, setTotalCalls] = useState(0);
  const [calls, setCalls] = useState<PCGCall[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [expandedCallId, setExpandedCallId] = useState<string | null>(null);

  // Canonical TL list
  const tlOptions = [
    { id: 'all', name: 'All Team Leads' },
    { id: 'Tanisha Mittal', name: 'Tanisha Mittal' },
    { id: 'Swetha', name: 'Swetha' },
    { id: 'Sravanthi', name: 'Sravanthi' },
    { id: 'Dheeraj Bhojwani', name: 'Dheeraj Bhojwani' },
    { id: 'Saiyam Rastogi', name: 'Saiyam Rastogi' },
  ];

  const isExcludedView = useMemo(() => {
    return ['excluded', 'hiring', 'telemarketing', 'delivery_logistics', 'wrong_number', 'internal_personal'].includes(selectedCategory);
  }, [selectedCategory]);

  const activeDateInfo = useMemo(() => {
    if (dateRange === '7d') return { short: '7D', full: 'Last 7 Days', datesOnly: 'Past 7 days' };
    if (dateRange === '30d') return { short: '30D', full: 'Last 30 Days', datesOnly: 'Past 30 days' };
    if (dateRange === 'custom') {
      return {
        short: 'Custom',
        full: `${customStartDate} to ${customEndDate}`,
        datesOnly: `${customStartDate} to ${customEndDate}`,
      };
    }
    return { short: '7D', full: 'Last 7 Days', datesOnly: 'Past 7 days' };
  }, [dateRange, customStartDate, customEndDate]);

  useEffect(() => {
    const handler = setTimeout(() => {
      fetchTlCalls();
    }, 200);
    return () => clearTimeout(handler);
  }, [selectedTl, selectedCategory, dateRange, customStartDate, customEndDate, searchQuery, minIqsFilter, maxIqsFilter, page]);

  const fetchTlCalls = async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({
        caller_role: 'tl',
        page: page.toString(),
        limit: '10',
        date_range: dateRange,
      });

      if (dateRange === 'custom' && customStartDate && customEndDate) {
        p.set('date_from', customStartDate);
        p.set('date_to', customEndDate);
      }

      if (selectedTl !== 'all') {
        p.set('tl_name', selectedTl);
      }

      if (selectedCategory && selectedCategory !== 'all') {
        p.set('category', selectedCategory);
      } else {
        p.set('category', 'all');
      }

      if (searchQuery.trim()) {
        p.set('search', searchQuery.trim());
      }
      if (!isExcludedView && minIqsFilter.trim()) {
        p.set('min_iqs', minIqsFilter.trim());
      }
      if (!isExcludedView && maxIqsFilter.trim()) {
        p.set('max_iqs', maxIqsFilter.trim());
      }

      const res = await fetch(`/api/admin/pcg-calls?${p.toString()}`);
      if (!res.ok) throw new Error('Failed to load TL calls');
      const data = await res.json();

      setCalls(data.calls || []);
      setSummary(data.summary || null);
      setTotalPages(data.totalPages || data.pagination?.totalPages || 1);
      setTotalCalls(data.total ?? data.pagination?.totalCalls ?? 0);
    } catch (err) {
      console.error('Error fetching TL calls:', err);
    } finally {
      setLoading(false);
    }
  };

  const formatDuration = (secs: number) => {
    if (!secs) return '00:00';
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const formatDateTime = (iso: string | null) => {
    if (!iso) return '—';
    try {
      const d = new Date(iso);
      return d.toLocaleString('en-IN', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      });
    } catch {
      return iso;
    }
  };

  const getScoreBadge = (score: number | null | undefined) => {
    if (score == null || score === 0) return <span className="text-zinc-400 text-xs tabular-nums">—</span>;
    return (
      <span className="inline-flex items-center justify-center font-bold text-xs px-2.5 py-0.5 rounded-md border border-zinc-200 bg-zinc-100 text-zinc-900 tabular-nums">
        {score}%
      </span>
    );
  };

  return (
    <div className="space-y-6">
      {/* ── 1. CONTEXT HEADER ──────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-white p-4 rounded-xl border border-[#E4E4E7]">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider bg-zinc-100 text-zinc-700">
              Executive Console
            </span>
            <h2 className="text-lg font-bold text-[#111111]">
              TL Call Quality &amp; Analytics
            </h2>
          </div>
          <p className="text-xs text-[#71717A] mt-1">
            Voice call audits, 11-parameter evaluations, dialogue transcripts, and triage exclusion review for Team Leads.
          </p>
        </div>

        {/* Filters on Header Right: Team Lead */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-[#71717A] font-semibold">Team Lead:</span>
            <select
              value={selectedTl}
              onChange={(e) => {
                setSelectedTl(e.target.value);
                setPage(1);
              }}
              className="text-xs font-semibold border border-[#E4E4E7] rounded-lg px-2.5 py-1.5 bg-zinc-50 outline-none cursor-pointer focus:border-zinc-900"
            >
              {tlOptions.map((tl) => (
                <option key={tl.id} value={tl.id}>
                  {tl.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* ── 2. TOP METRIC CARDS ────────────────────────────────────────────── */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 px-0.5">
          <span className="text-[11px] font-bold text-[#71717A] uppercase tracking-wider">
            {selectedTl === 'all'
              ? 'Team Leads Performance Overview'
              : `${selectedTl} Performance Overview`}
          </span>
          <PcgPeriodFilter range={dateRange} start={customStartDate} end={customEndDate} onChange={onPeriodChange} />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Card 1: Avg IQS */}
          <div className="bg-white p-4 rounded-xl border border-[#E4E4E7]">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-semibold text-[#71717A] uppercase tracking-wider">
                TL Avg IQS
              </p>
              <span className="text-[10px] font-semibold text-zinc-500 bg-zinc-100 px-1.5 py-0.5 rounded">
                {activeDateInfo.short}
              </span>
            </div>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-2xl font-bold tabular-nums text-[#111111]">
                {summary?.avgIqs != null ? `${summary.avgIqs}%` : '—'}
              </span>
            </div>
            <p className="text-[11px] text-[#71717A] mt-1">
              100% AI Automated audits · {activeDateInfo.datesOnly}
            </p>
          </div>

          {/* Card 2: Total Calls Attempted */}
          <div className="bg-white p-4 rounded-xl border border-[#E4E4E7]">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-semibold text-[#71717A] uppercase tracking-wider">
                Total Calls Attempted
              </p>
              <span className="text-[10px] font-semibold text-zinc-500 bg-zinc-100 px-1.5 py-0.5 rounded">
                {activeDateInfo.short}
              </span>
            </div>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-2xl font-bold tabular-nums text-[#111111]">
                {summary?.totalCalls ?? 0}
              </span>
              <span className="text-xs text-[#71717A]">calls</span>
            </div>
            <p className="text-[11px] text-[#71717A] mt-1">
              {summary?.answeredCalls ?? 0} connected · {activeDateInfo.datesOnly}
            </p>
          </div>

          {/* Card 3: Client Pickup Rate */}
          <div className="bg-white p-4 rounded-xl border border-[#E4E4E7]">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-semibold text-[#71717A] uppercase tracking-wider">
                Client Pickup Rate
              </p>
              <span className="text-[10px] font-semibold text-zinc-500 bg-zinc-100 px-1.5 py-0.5 rounded">
                {activeDateInfo.short}
              </span>
            </div>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-2xl font-bold tabular-nums text-[#111111]">
                {summary?.clientPickupRate ?? 0}%
              </span>
              <span className="text-xs text-[#71717A]">pickup</span>
            </div>
            <p className="text-[11px] text-[#71717A] mt-1">
              {summary?.clientUnansweredCalls ?? 0} valid client unanswered · {summary?.otherUnansweredCalls ?? 0} other category
            </p>
          </div>

          {/* Card 4: Excluded Calls */}
          <div className="bg-white p-4 rounded-xl border border-[#E4E4E7]">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-semibold text-[#71717A] uppercase tracking-wider">
                Excluded Calls
              </p>
              <span className="text-[10px] font-semibold text-zinc-500 bg-zinc-100 px-1.5 py-0.5 rounded">
                Triage
              </span>
            </div>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-2xl font-bold tabular-nums text-[#111111]">
                {summary?.categoryCounts?.excluded ?? 0}
              </span>
              <span className="text-xs text-[#71717A]">calls</span>
            </div>
            <p className="text-[11px] text-[#71717A] mt-1">
              Wrong number, spam, logistics, personal (0% IQS penalty)
            </p>
          </div>
        </div>
      </div>

      {/* ── 3. CATEGORY TABS & EXCLUDED SUB-CATEGORY FILTER BAR ─────────────── */}
      <div className="bg-white p-4 rounded-xl border border-[#E4E4E7] space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              onClick={() => {
                setSelectedCategory('all');
                setPage(1);
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                selectedCategory === 'all'
                  ? 'bg-[#111111] text-white shadow-sm'
                  : 'bg-[#F4F4F5] text-[#71717A] hover:text-[#111111]'
              }`}
            >
              All Valid Categories
            </button>
            <button
              onClick={() => {
                setSelectedCategory('13_pitching');
                setPage(1);
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                selectedCategory === '13_pitching'
                  ? 'bg-[#111111] text-white shadow-sm'
                  : 'bg-[#F4F4F5] text-[#71717A] hover:text-[#111111]'
              }`}
            >
              13% Club / Pitching {summary?.categoryCounts?.pitching ? `(${summary.categoryCounts.pitching})` : ''}
            </button>
            <button
              onClick={() => {
                setSelectedCategory('upselling');
                setPage(1);
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                selectedCategory === 'upselling'
                  ? 'bg-[#111111] text-white shadow-sm'
                  : 'bg-[#F4F4F5] text-[#71717A] hover:text-[#111111]'
              }`}
            >
              Upselling Calls {summary?.categoryCounts?.upselling ? `(${summary.categoryCounts.upselling})` : ''}
            </button>
            <button
              onClick={() => {
                setSelectedCategory('support');
                setPage(1);
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                selectedCategory === 'support'
                  ? 'bg-[#111111] text-white shadow-sm'
                  : 'bg-[#F4F4F5] text-[#71717A] hover:text-[#111111]'
              }`}
            >
              General / Support {summary?.categoryCounts?.support ? `(${summary.categoryCounts.support})` : ''}
            </button>
            <button
              onClick={() => {
                setSelectedCategory('sop_breached');
                setPage(1);
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer ${
                selectedCategory === 'sop_breached'
                  ? 'bg-red-700 text-white shadow-sm font-bold'
                  : 'bg-red-50 text-red-800 hover:bg-red-100 border border-red-200'
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${selectedCategory === 'sop_breached' ? 'bg-white' : 'bg-red-600'}`}></span>
              <span>SOP Breached</span>
              {summary?.categoryCounts?.sopBreached != null && summary.categoryCounts.sopBreached > 0 && (
                <span
                  className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                    selectedCategory === 'sop_breached' ? 'bg-red-900 text-white' : 'bg-red-200 text-red-900'
                  }`}
                >
                  {summary.categoryCounts.sopBreached}
                </span>
              )}
            </button>

            <div className="h-4 w-px bg-zinc-200 mx-1 hidden sm:block" />

            <button
              onClick={() => {
                setSelectedCategory('excluded');
                setMinIqsFilter('');
                setMaxIqsFilter('');
                setSearchQuery('');
                setPage(1);
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer ${
                isExcludedView
                  ? 'bg-amber-600 text-white shadow-sm font-bold'
                  : 'bg-amber-50 text-amber-800 hover:bg-amber-100 border border-amber-200'
              }`}
            >
              <span>Excluded Calls</span>
              {summary?.categoryCounts?.excluded != null && (
                <span
                  className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                    isExcludedView ? 'bg-amber-700 text-white' : 'bg-amber-200 text-amber-900'
                  }`}
                >
                  {summary.categoryCounts.excluded}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Excluded Sub-Category Filter Bar */}
        {isExcludedView && (
          <div className="pt-2 border-t border-zinc-100 flex flex-wrap items-center gap-1.5 animate-in fade-in duration-200">
            <span className="text-[11px] text-zinc-500 font-medium mr-1">Filter Exclusion:</span>
            <button
              onClick={() => {
                setSelectedCategory('excluded');
                setPage(1);
              }}
              className={`px-2 py-1 rounded-md text-[11px] font-semibold transition-colors cursor-pointer ${
                selectedCategory === 'excluded' ? 'bg-zinc-800 text-white' : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200'
              }`}
            >
              All Excluded ({summary?.categoryCounts?.excluded ?? 0})
            </button>
            <button
              onClick={() => {
                setSelectedCategory('hiring');
                setPage(1);
              }}
              className={`px-2 py-1 rounded-md text-[11px] font-semibold transition-colors cursor-pointer ${
                selectedCategory === 'hiring' ? 'bg-zinc-800 text-white' : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200'
              }`}
            >
              Hiring / Interviews ({summary?.categoryCounts?.hiring ?? 0})
            </button>
            <button
              onClick={() => {
                setSelectedCategory('internal_personal');
                setPage(1);
              }}
              className={`px-2 py-1 rounded-md text-[11px] font-semibold transition-colors cursor-pointer ${
                selectedCategory === 'internal_personal' ? 'bg-zinc-800 text-white' : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200'
              }`}
            >
              Internal / Colleague ({summary?.categoryCounts?.internalPersonal ?? 0})
            </button>
            <button
              onClick={() => {
                setSelectedCategory('delivery_logistics');
                setPage(1);
              }}
              className={`px-2 py-1 rounded-md text-[11px] font-semibold transition-colors cursor-pointer ${
                selectedCategory === 'delivery_logistics' ? 'bg-zinc-800 text-white' : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200'
              }`}
            >
              Courier &amp; Delivery ({summary?.categoryCounts?.delivery ?? 0})
            </button>
            <button
              onClick={() => {
                setSelectedCategory('telemarketing');
                setPage(1);
              }}
              className={`px-2 py-1 rounded-md text-[11px] font-semibold transition-colors cursor-pointer ${
                selectedCategory === 'telemarketing' ? 'bg-zinc-800 text-white' : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200'
              }`}
            >
              Telemarketing &amp; Spam ({summary?.categoryCounts?.telemarketing ?? 0})
            </button>
            <button
              onClick={() => {
                setSelectedCategory('wrong_number');
                setPage(1);
              }}
              className={`px-2 py-1 rounded-md text-[11px] font-semibold transition-colors cursor-pointer ${
                selectedCategory === 'wrong_number' ? 'bg-zinc-800 text-white' : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200'
              }`}
            >
              Wrong Number ({summary?.categoryCounts?.wrongNumber ?? 0})
            </button>
          </div>
        )}
      </div>

      {/* ── 4. CALLS AUDIT LIST TABLE ──────────────────────────────────────── */}
      <div id="pcg-calls-table" className="bg-white rounded-xl border border-[#E4E4E7] overflow-hidden">
        {/* Table Top Header & Search Bar */}
        <div className="p-4 border-b border-[#E4E4E7] flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-[#111111]">
              {isExcludedView ? 'Excluded Non-Client Calls (Zero IQS Penalty)' : 'Evaluated Call Audits'}
            </h3>
            <p className="text-xs text-[#71717A] mt-0.5">
              {isExcludedView
                ? 'Calls identified as non-client (Hiring, Courier, Spam, Wrong Number, Personal) — filtered out before 11-parameter evaluation.'
                : `Showing ${calls.length} of ${totalCalls} calls${totalPages > 1 ? ` • Page ${page} of ${totalPages}` : ''} • Auto-categorised with separate quality parameters`}
            </p>
          </div>

          <div className="flex items-center gap-2.5 flex-wrap">
            {/* Min / Max IQS filters (only on evaluated calls) */}
            {!isExcludedView && (
              <>
                <input
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
                  className={`w-20 text-xs border rounded-lg px-3 py-1.5 outline-none shadow-2xs bg-white text-zinc-900 placeholder:text-zinc-400 transition-colors [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${
                    minIqsFilter !== '' ? 'border-[#111111] ring-1 ring-[#111111]' : 'border-[#E4E4E7] focus:border-[#111111]'
                  }`}
                />

                <input
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
                  className={`w-20 text-xs border rounded-lg px-3 py-1.5 outline-none shadow-2xs bg-white text-zinc-900 placeholder:text-zinc-400 transition-colors [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${
                    maxIqsFilter !== '' ? 'border-[#111111] ring-1 ring-[#111111]' : 'border-[#E4E4E7] focus:border-[#111111]'
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
              </>
            )}

            <input
              type="text"
              placeholder="Search Client or RM Name..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setPage(1);
              }}
              className="text-xs border border-[#E4E4E7] rounded-lg px-3 py-1.5 w-52 outline-none focus:border-[#111111] shadow-2xs bg-white"
            />
          </div>
        </div>

        {/* Table Body */}
        {loading ? (
          <div className="p-12 text-center text-zinc-400 text-xs">Loading PCG calls data...</div>
        ) : calls.length === 0 ? (
          <div className="p-12 text-center text-zinc-400 text-xs">No calls match the selected filters.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-[#FAFAFB] border-b border-[#E4E4E7] text-[#6B6B6B] font-semibold uppercase tracking-wider">
                  <th className="py-3 px-4">Caller / RM</th>
                  <th className="py-3 px-4">{isExcludedView ? 'Caller / Contact' : 'Client Name'}</th>
                  <th className="py-3 px-4">Call Category</th>
                  <th className="py-3 px-4">{isExcludedView ? 'Evaluation Status' : 'IQS Score'}</th>
                  <th className="py-3 px-4">{isExcludedView ? 'Exclusion Reason / Quote' : 'Compliance Mistake'}</th>
                  <th className="py-3 px-4 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F0F0F2]">
                {calls.map((call) => {
                  const isExpanded = expandedCallId === call.id;
                  return (
                    <React.Fragment key={call.id}>
                      <tr
                        onClick={() => {
                          setExpandedCallId(isExpanded ? null : call.id);
                        }}
                        className={`hover:bg-zinc-50 transition-colors cursor-pointer ${
                          call.needsAttention ? 'bg-zinc-50' : ''
                        } ${isExpanded ? 'bg-zinc-50 font-medium' : ''}`}
                      >
                        {/* Caller / RM */}
                        <td className="py-3 px-4">
                          <div className="font-semibold text-zinc-900">{call.rmName || 'RM'}</div>
                        </td>

                        {/* Client Name / Caller */}
                        <td className="py-3 px-4">
                          <span className="font-semibold text-zinc-900">{call.clientName || 'Investor Client'}</span>
                          <div className="text-[11px] text-zinc-500 mt-0.5">
                            {formatDateTime(call.startTime)} • {formatDuration(call.durationSeconds)}
                          </div>
                        </td>

                        {/* Call Category */}
                        <td className="py-3 px-4">
                          <div className="flex flex-col gap-1 items-start">
                            <span
                              className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-semibold ${
                                call.isEvaluable === false
                                  ? 'bg-amber-50 text-amber-900 border border-amber-200'
                                  : 'bg-zinc-100 text-zinc-800 border border-zinc-200'
                              }`}
                            >
                              {call.isEvaluable === false && <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>}
                              {call.category}
                            </span>
                            {call.sopTriggers && call.sopTriggers.length > 0 && (
                              <span
                                title={`SOP Flag: ${call.sopTriggers[0].category} — "${call.sopTriggers[0].quote}"`}
                                className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-semibold bg-red-50 text-red-700 border border-red-200"
                              >
                                <span className="w-1.5 h-1.5 rounded-full bg-red-600 animate-pulse"></span>
                                <span>{call.sopTriggers[0].category}</span>
                              </span>
                            )}
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

                        {/* IQS Score / Evaluation Status */}
                        <td className="py-3 px-4">
                          {call.isEvaluable === false ? (
                            <span
                              className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-zinc-100 text-zinc-600 border border-zinc-200"
                              title="Excluded from IQS quality scorecard"
                            >
                              Excluded
                            </span>
                          ) : (
                            getScoreBadge(call.iqsScore)
                          )}
                        </td>

                        {/* Compliance Mistake / Exclusion Reason */}
                        <td className="py-3 px-4 font-semibold">
                          {call.isEvaluable === false ? (
                            <div className="text-xs font-normal text-zinc-600 max-w-xs truncate" title={call.exclusionReason || 'Non-client interaction'}>
                              {call.exclusionReason || 'Non-client interaction'}
                            </div>
                          ) : call.gates?.status === 'PASS' ? (
                            <span className="text-zinc-600 font-medium" title="No compliance mistake detected">
                              No
                            </span>
                          ) : (
                            <span
                              className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold text-red-700 bg-red-50 border border-red-200"
                              title={call.gates?.reason || 'Compliance violation detected'}
                            >
                              Yes
                            </span>
                          )}
                        </td>

                        {/* Action */}
                        <td className="py-3 px-4 text-center" onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={() => {
                              setExpandedCallId(isExpanded ? null : call.id);
                            }}
                            className="px-3 py-1 rounded-md bg-zinc-900 hover:bg-zinc-800 text-white font-semibold transition-colors text-xs shadow-sm inline-flex items-center gap-1.5 cursor-pointer"
                          >
                            <span>{isExpanded ? 'Hide' : 'View Details'}</span>
                            <span className="text-[10px] opacity-70">{isExpanded ? '▲' : '▼'}</span>
                          </button>
                        </td>
                      </tr>

                      {/* Expandable Content Row */}
                      {isExpanded && (
                        call.isEvaluable === false ? (
                          <tr className="bg-zinc-50/80 border-b border-zinc-200">
                            <td colSpan={6} className="p-4">
                              <div className="bg-white rounded-xl border border-zinc-200 p-4 shadow-2xs space-y-3 max-w-3xl mx-auto">
                                {/* Top info row: Category badge, RM, Call ID, Close */}
                                <div className="flex items-center justify-between border-b border-zinc-100 pb-2.5">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold bg-amber-50 text-amber-900 border border-amber-200">
                                      <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                                      Excluded Non-Client Call • {call.category}
                                    </span>
                                    <span className="text-xs text-zinc-500 font-mono">
                                      ID: {call.callId}
                                    </span>
                                  </div>
                                  <button
                                    onClick={() => setExpandedCallId(null)}
                                    className="text-xs text-zinc-500 hover:text-zinc-900 font-semibold px-2 py-1 rounded hover:bg-zinc-100 transition-colors cursor-pointer"
                                  >
                                    ✕ Close
                                  </button>
                                </div>

                                {/* Call Recording Audio Player */}
                                <div className="bg-zinc-50 rounded-lg p-3.5 border border-zinc-200">
                                  <div className="flex items-center justify-between mb-2">
                                    <span className="text-[11px] font-bold text-zinc-700 uppercase tracking-wider flex items-center gap-1.5">
                                      <span>🔊</span> Call Recording
                                    </span>
                                    <span className="text-xs text-zinc-500 font-mono">
                                      Duration: {formatDuration(call.durationSeconds)}
                                    </span>
                                  </div>
                                  <audio
                                    src={`/api/admin/pcg-calls/audio?id=${encodeURIComponent(call.id)}`}
                                    controls
                                    className="w-full h-10 outline-none"
                                    preload="metadata"
                                  />
                                </div>

                                {/* Reason & Exclusion Details */}
                                <div className="flex flex-col sm:flex-row gap-3 items-start justify-between text-xs pt-1">
                                  <div className="space-y-1 flex-1">
                                    <div className="font-semibold text-zinc-700">Reason for Exclusion:</div>
                                    <div className="text-zinc-600 bg-amber-50/50 p-2.5 rounded-lg border border-amber-100 text-[11px] leading-relaxed">
                                      {call.exclusionReason || 'Identified as non-investor conversation during opening triage and excluded from quality evaluation.'}
                                    </div>
                                  </div>
                                  <div className="bg-zinc-50 p-2.5 rounded-lg border border-zinc-100 text-[11px] space-y-1 shrink-0 min-w-[200px]">
                                    <div><span className="text-zinc-400">Caller:</span> <span className="font-semibold text-zinc-800">{call.rmName}</span></div>
                                    <div><span className="text-zinc-400">Number:</span> <span className="font-mono text-zinc-800">{call.phoneNumber || '—'}</span></div>
                                    <div><span className="text-zinc-400">IQS Impact:</span> <span className="font-semibold text-emerald-600">None (Excluded)</span></div>
                                  </div>
                                </div>
                              </div>
                            </td>
                          </tr>
                        ) : (
                          <CallEvalPanel
                            callId={call.callId || call.id.toString()}
                            hideShowChat={true}
                            isPcg={true}
                            sopTriggers={call.sopTriggers}
                            mobileNumber={call.phoneNumber}
                            agentName={call.rmName}
                            iqsScore={call.iqsScore ?? 0}
                            calledAt={call.startTime || '2026-10-18T14:04:00.000Z'}
                            disposition={call.category}
                            gates={call.gates}
                            iqsScores={formatCallIqsScores(call)}
                            initialSegments={formatCallSegments(call)}
                            initialRecordingUrl={`/api/admin/pcg-calls/audio?id=${encodeURIComponent(call.id)}`}
                            mode="view"
                            allowRaiseDispute={false}
                            allowReevaluate={true}
                            colSpan={6}
                            onDone={() => setExpandedCallId(null)}
                            onClose={() => setExpandedCallId(null)}
                          />
                        )
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
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-[#E4E4E7] bg-white text-zinc-700 hover:bg-zinc-50 disabled:opacity-40 disabled:cursor-not-allowed shadow-sm cursor-pointer"
            >
              ← Previous
            </button>
            <span className="text-xs text-[#71717A]">
              Page <span className="font-semibold text-zinc-900">{page}</span> of{' '}
              <span className="font-semibold text-zinc-900">{totalPages}</span> ({totalCalls} total calls)
            </span>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-[#E4E4E7] bg-white text-zinc-700 hover:bg-zinc-50 disabled:opacity-40 disabled:cursor-not-allowed shadow-sm cursor-pointer"
            >
              Next →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
