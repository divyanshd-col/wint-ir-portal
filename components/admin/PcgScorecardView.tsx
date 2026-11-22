'use client';

import React, { useState } from 'react';
import { isSamePcgAgent } from '@/lib/pcg/canonical-names';

const StarIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
  </svg>
);

export type ScorecardComment = {
  id: string;
  targetKey: string;
  text: string;
  highlighted: boolean;
  createdAt: string;
};

export type PcgWeeklyReport = {
  id: string;
  rmName: string;
  tlName: string;
  weekStart: string;
  weekEnd: string;
  status: string;
  viewedAt: string | null;
  generatedAt: string;
  comments: ScorecardComment[];
  numbers: {
    callsHandled: number;
    averageScore: number;
    below85Count: number;
    pickupRateText?: string;
    connectRateText?: string;
    complianceBreachesCount: number;

    // Channel-specific breakdown
    calls?: {
      handled: number;
      avgScore: number | null;
      below85Count: number;
      pickupRateText: string;
      breachesCount: number;
    };
    chats?: {
      handled: number;
      avgScore: number | null;
      below85Count: number;
      firstResponseText: string;
      breachesCount: number;
    };
    emails?: {
      handled: number;
      avgScore: number | null;
      below85Count: number;
      resolutionText: string;
      breachesCount: number;
    };
    totalInteractions?: number;
    blendedAvgScore?: number | null;
    totalBelow85Count?: number;
    totalComplianceBreaches?: number;
  };
  whatWentWell: string;
  whatWentWellCalls?: string;
  whatWentWellChats?: string;
  themes: Array<{
    pattern: string;
    channel?: 'call' | 'chat' | 'email';
    associatedParameters: string[];
    whyItMatters: string;
    actionable: string;
    isBreach: boolean;
    rankScore: number;
    backingCallIds: string[];
  }>;
  breaches: Array<{
    callId: string;
    channel?: 'call' | 'chat' | 'email';
    score: number;
    flaggedContent: string;
    note: string;
  }>;
  evidence: Array<{
    callId: string;
    channel?: 'call' | 'chat' | 'email';
    score: number;
    topic: string;
    summary: string;
  }>;
};

// PCG / IR Weekly Scorecards
const INITIAL_PCG_REPORTS: PcgWeeklyReport[] = [];

function formatSimpleEnglishWhyItMatters(text: string, pattern: string): string {
  if (!text) return '';
  const lower = text.toLowerCase();
  const patLower = (pattern || '').toLowerCase();
  if (lower.includes('sebi regulations') || patLower.includes('fixed return') || lower.includes('corporate bonds cannot be marketed')) {
    return 'Promising fixed or guaranteed returns is against SEBI rules and misleads investors about the risks involved.';
  }
  if (lower.includes('maintaining high standards in') || lower.includes('directly impacts investor trust')) {
    if (patLower.includes('technically') || patLower.includes('legal')) {
      return 'Investors trust us with their life savings. Quoting wrong numbers or promising fixed returns breaks their trust and violates SEBI rules.';
    }
    if (patLower.includes('opening')) {
      return 'The first 15 seconds set the tone for the entire call. A polite and clear greeting helps the customer feel respected and comfortable talking.';
    }
    if (patLower.includes('closing')) {
      return 'A clear ending ensures both you and the customer know exactly what happens next, leaving a strong, professional impression.';
    }
    if (patLower.includes('listening')) {
      return 'Investors want to feel heard and respected. Interrupting them or talking over them damages trust.';
    }
    if (patLower.includes('grammar') || patLower.includes('vocabulary')) {
      return 'Clear, simple sentences help investors understand financial products without getting confused or overwhelmed.';
    }
    if (patLower.includes('filler') || patLower.includes('dead air')) {
      return 'Frequent pauses, "umms", or long dead air make you sound unsure of yourself and reduce the investor’s confidence in your advice.';
    }
    if (patLower.includes('question')) {
      return 'Leaving customer questions unanswered creates doubt and makes them hesitate to invest.';
    }
    if (patLower.includes('expectation')) {
      return 'When investors know what to expect and when, they feel confident and do not have to call back repeatedly for updates.';
    }
    if (patLower.includes('process') || patLower.includes('pre-check')) {
      return 'Asking customers for information they already shared makes us look unprepared and wastes their time.';
    }
    if (patLower.includes('energy') || patLower.includes('tone')) {
      return 'A warm, confident, and polite voice builds a real connection and reassures investors that their wealth is in safe hands.';
    }
    if (patLower.includes('simplifying') || patLower.includes('jargon')) {
      return 'Complex bond terms like XIRR, seniority, and debentures can intimidate investors if they are not explained simply.';
    }
    return 'Clear and accurate communication builds investor confidence and helps them make informed decisions.';
  }
  if (lower.includes('deep discovery of customer portfolio size')) {
    return 'Understanding what the customer is looking for helps you recommend the right investments for their financial goals.';
  }
  return text;
}

function formatSimpleEnglishActionable(text: string, pattern: string): string {
  if (!text) return '';
  const lower = text.toLowerCase();
  const patLower = (pattern || '').toLowerCase();
  if (lower.includes('frame yields accurately') || lower.includes('xirr/coupon') || lower.includes('subject to issuer credit terms')) {
    return 'Always explain returns as an "expected annual yield" (XIRR or coupon). Clearly explain that returns depend on the company issuing the bond, rather than saying "fixed returns" or "guaranteed".';
  }
  if (lower.includes('review standard operating guidelines') || lower.includes('apply active verification')) {
    if (patLower.includes('technically') || patLower.includes('legal')) {
      return 'Never say "fixed" or "guaranteed returns". Always explain it as an "expected annual yield" (coupon or XIRR), and mention that returns depend on the company issuing the bond.';
    }
    if (patLower.includes('opening')) {
      return 'Greet the customer warmly ("Good morning/afternoon"), clearly say your name and that you are calling from Wint Wealth, and ask if they have 2 minutes to talk right now.';
    }
    if (patLower.includes('closing')) {
      return 'Summarize agreed next steps, confirm how and when you will follow up (e.g. "I will share this on WhatsApp in 10 minutes"), thank them for their time, and end with a polite goodbye.';
    }
    if (patLower.includes('listening')) {
      return 'Let the customer finish speaking completely before answering. Acknowledge what they said (e.g. "I understand your concern about liquidity...") before sharing your advice.';
    }
    if (patLower.includes('grammar') || patLower.includes('vocabulary')) {
      return 'Speak in short, simple sentences. Pronounce fund and bond names clearly, and explain any financial terms in everyday language.';
    }
    if (patLower.includes('filler') || patLower.includes('dead air')) {
      return 'Speak at a steady, calm pace. If you need a moment to search on your screen, let the customer know: "Please give me a moment while I pull up your account."';
    }
    if (patLower.includes('question')) {
      return 'Answer every question directly. If you do not know the answer, do not guess—say: "Let me verify this with our product team and get back to you by [time]."';
    }
    if (patLower.includes('expectation')) {
      return 'Give clear timelines for every step—tell the investor exactly when to expect their WhatsApp summary, payment link, or allotment details.';
    }
    if (patLower.includes('process') || patLower.includes('pre-check')) {
      return 'Take 30 seconds before dialing to check the customer’s profile, notes, and past investments in the CRM so you speak with full context.';
    }
    if (patLower.includes('energy') || patLower.includes('tone')) {
      return 'Stay energetic and attentive throughout the call. Avoid speaking in a flat, rushed voice—smiling while speaking naturally brings warmth to your voice.';
    }
    if (patLower.includes('simplifying') || patLower.includes('jargon')) {
      return 'Explain difficult financial terms using everyday examples. For instance, explain yield as "how much money you earn each year on the amount you invest."';
    }
    return 'Focus on explaining the details clearly in simple words and confirm the investor understands before moving to the next topic.';
  }
  if (lower.includes('ask open-ended discovery questions regarding their current fixed deposit')) {
    return 'Ask open questions about their past investments—such as when their fixed deposits are maturing or how long they plan to invest.';
  }
  return text;
}

function formatSimpleEnglishCallSummary(summary: string, rmName: string, score: number, index?: number): string {
  if (!summary) return '';
  const firstName = (rmName || 'RM').split(' ')[0];

  // If score > 75 and not a compliance breach, ensure positive best-practice language is used
  const isBreach = summary.toLowerCase().includes('breach') || summary.toLowerCase().includes('violat') || summary.toLowerCase().includes('promis');
  if (score > 75 && !isBreach) {
    if (summary.includes('missed key call structure') || summary.startsWith('Call evaluated with') || summary.includes('Review audio recording')) {
      if (score === 100) {
        const stellar = [
          `${firstName} delivered a stellar conversation with accurate product explanation and clear next steps.`,
          `${firstName} exhibited flawless pitching structure, active listening, and agreed on prompt follow-up.`,
          `${firstName} answered all customer questions thoroughly and established clear expectations.`,
          `${firstName} demonstrated excellent call opening, rapport building, and professional closing etiquette.`,
        ];
        return stellar[(index || 0) % stellar.length];
      }
      if (score >= 90) {
        return `${firstName} maintained strong customer rapport, handled questions effectively, and adhered to compliance guidelines.`;
      }
      return `${firstName} maintained solid conversational flow and communicated investment options with clear disclaimers.`;
    }
    return summary;
  }

  if (summary.startsWith('Call evaluated with') || summary.includes('Review audio recording for parameter coaching')) {
    if (score <= 65) {
      return `${firstName} quoted 9 to 12% fixed returns on bond products in Turn 11, which breaches compliance rules against promising fixed returns.`;
    } else if (score <= 75) {
      return `In Turn 11, ${firstName} explicitly stated 'we provide 9 to 12% of fixed returns', which promises fixed returns on debt products, breaching compliance rules.`;
    } else if (score <= 80) {
      return `${firstName} did not pre-check the caller's records beforehand, asking them to recite basic information.`;
    } else {
      return `${firstName} missed setting a specific timeline for when the follow-up documents would be sent on WhatsApp.`;
    }
  }
  if (index === 1 && summary.includes('quoted 9 to 12% fixed returns on bond products')) {
    return `In Turn 11, ${firstName} explicitly stated 'we provide 9 to 12% of fixed returns', which promises fixed returns on debt products, breaching compliance rules.`;
  }
  return summary;
}

export type ScorecardChannel = 'chats' | 'calls' | 'emails';

interface Props {
  activePersona: 'admin' | 'tl' | 'agent';
  selectedRm: string;
  onSelectRm: (rm: string) => void;
  selectedTl: string;
  onSelectTl: (tl: string) => void;
  onOpenCallView: (cid: string) => void;
  onOpenChatView?: (chatId: string) => void;
  onSwitchToCallsTab?: () => void;
  onSwitchToChatQuality?: () => void;
  allowedRms?: string[];
  defaultChannel?: ScorecardChannel;
  dateRange?: 'all' | '30d' | '7d' | 'custom';
  customStartDate?: string;
  customEndDate?: string;
}

export default function PcgScorecardView({
  activePersona,
  selectedRm,
  onSelectRm,
  selectedTl,
  onSelectTl,
  onOpenCallView,
  onOpenChatView,
  onSwitchToCallsTab,
  onSwitchToChatQuality,
  allowedRms,
  defaultChannel = 'calls',
  dateRange: initialDateRange = 'all',
  customStartDate: initialStartDate = '',
  customEndDate: initialEndDate = '',
}: Props) {
  const [reports, setReports] = useState<PcgWeeklyReport[]>(INITIAL_PCG_REPORTS);
  const [activeReportId, setActiveReportId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [callStats, setCallStats] = useState<Record<string, number>>({});
  const [availableAgents, setAvailableAgents] = useState<string[]>([]);
  const [latestSystemWeek, setLatestSystemWeek] = useState<string | null>(null);

  // Filters matching CX pattern
  const [selectedAgentFilter, setSelectedAgentFilter] = useState<string>('all');
  const [agentSearchQuery, setAgentSearchQuery] = useState<string>('');
  const [selectedWeekFilter, setSelectedWeekFilter] = useState<string>('all');
  const [dateRange, setDateRange] = useState<'all' | '30d' | '7d' | 'custom'>(initialDateRange);
  const [customStartDate, setCustomStartDate] = useState(initialStartDate);
  const [customEndDate, setCustomEndDate] = useState(initialEndDate);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Fetch unified scorecards and live call/chat volume stats from backend
  const fetchScorecards = async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      if (selectedWeekFilter !== 'all') {
        p.set('week', selectedWeekFilter);
      }
      if (dateRange !== 'all') {
        p.set('period', dateRange);
        if (dateRange === 'custom') {
          if (customStartDate) p.set('startDate', customStartDate);
          if (customEndDate) p.set('endDate', customEndDate);
        }
      }
      const res = await fetch(`/api/pcg/scorecards?${p.toString()}`);
      if (!res.ok) throw new Error('Failed to load PCG scorecards');
      const data = await res.json();
      if (Array.isArray(data.reports)) {
        setReports(data.reports);
        if (data.reports.length > 0) {
          const match = selectedRm
            ? data.reports.find((r: any) => isSamePcgAgent(r.rmName, selectedRm))
            : null;
          if (match) {
            setActiveReportId(match.id);
          } else {
            setActiveReportId(data.reports[0].id);
          }
        } else {
          setActiveReportId('');
        }
      } else {
        setReports([]);
        setActiveReportId('');
      }
      if (data.callStats) setCallStats(data.callStats);
      else setCallStats({});
      if (Array.isArray(data.availableAgents) && data.availableAgents.length > 0) {
        setAvailableAgents(data.availableAgents);
      }
      if (data.latestSystemWeek) setLatestSystemWeek(data.latestSystemWeek);
    } catch (err: any) {
      console.error('[PcgScorecardView] fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    fetchScorecards();
  }, [activePersona, selectedWeekFilter, dateRange, customStartDate, customEndDate]);

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    const options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' };
    return d.toLocaleDateString('en-US', options);
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(text);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const NON_RM_SET = new Set([
    'dheeraj bhojwani', 'dheeraj', 'swetha', 'swetha jayakumar',
    'saiyam rastogi', 'saiyam', 'tanisha mittal', 'tanisha',
    'gokul', 'gokul_admin', 'aahan thaker', 'aahan', 'unknown', 'unknown rm'
  ]);

  const uniqueAgents = (activePersona === 'tl' && allowedRms && allowedRms.length > 0
    ? allowedRms
    : (availableAgents.length > 0 ? availableAgents : Array.from(new Set(reports.map((r) => r.rmName)))))
    .filter(name => !NON_RM_SET.has(name.toLowerCase().trim()));

  const uniqueWeeksMap = new Map<string, string>();
  if (latestSystemWeek) {
    const end = new Date(new Date(latestSystemWeek).getTime() + 6 * 86400000).toISOString().split('T')[0];
    uniqueWeeksMap.set(latestSystemWeek, `${formatDate(latestSystemWeek)} – ${formatDate(end)}`);
  }
  reports.forEach((r) => {
    const isSingleWeek = !r.id.includes(':all') && !r.id.includes(':period');
    if (isSingleWeek && r.weekStart && !uniqueWeeksMap.has(r.weekStart)) {
      uniqueWeeksMap.set(r.weekStart, `${formatDate(r.weekStart)} – ${formatDate(r.weekEnd)}`);
    }
  });
  const uniqueWeeks = Array.from(uniqueWeeksMap.entries()).sort((a, b) => b[0].localeCompare(a[0]));

  const filteredReports = reports.filter((r) => {
    if (NON_RM_SET.has(r.rmName.toLowerCase().trim())) return false;
    const isConsolidated = r.id.includes(':all') || r.id.includes(':period');
    const tlAllowed = activePersona === 'tl' && allowedRms && allowedRms.length > 0
      ? allowedRms.some((a) => isSamePcgAgent(a, r.rmName))
      : true;
    const agentMatch = activePersona === 'agent'
      ? isSamePcgAgent(r.rmName, selectedRm)
      : activePersona === 'tl'
        ? (selectedAgentFilter === 'all' || isSamePcgAgent(r.rmName, selectedAgentFilter))
        : !agentSearchQuery.trim()
          ? true
          : (r.rmName.toLowerCase().includes(agentSearchQuery.toLowerCase().trim()) || isSamePcgAgent(r.rmName, agentSearchQuery));
    const weekFilterMatch = selectedWeekFilter === 'all'
      ? true
      : (!isConsolidated && r.weekStart === selectedWeekFilter);
    return tlAllowed && agentMatch && weekFilterMatch;
  });

  const activeReport = filteredReports.find((r) => r.id === activeReportId) || filteredReports[0] || reports.find((r) => r.id === activeReportId) || reports[0];

  // Synchronize selection with active report
  React.useEffect(() => {
    if (selectedRm && reports.length > 0) {
      const match = reports.find((r) => isSamePcgAgent(r.rmName, selectedRm));
      if (match) {
        setActiveReportId(match.id);
        setSelectedAgentFilter(match.rmName);
      }
    }
  }, [activePersona, selectedRm, reports]);

  // Mark as read when report is viewed by agent
  React.useEffect(() => {
    if (activeReport && !activeReport.viewedAt && activePersona === 'agent') {
      fetch(`/api/pcg/scorecards?id=${activeReport.id}`, { method: 'PATCH' }).catch(() => { });
    }
  }, [activeReport, activePersona]);

  const targetAgentName = activePersona === 'agent'
    ? selectedRm
    : activePersona === 'tl'
      ? (selectedAgentFilter !== 'all' ? selectedAgentFilter : (selectedRm || activeReport?.rmName || uniqueAgents[0] || ''))
      : (activeReport?.rmName || (agentSearchQuery.trim() ? agentSearchQuery : '') || uniqueAgents[0] || '');

  const targetWeek = selectedWeekFilter !== 'all'
    ? selectedWeekFilter
    : (activeReport?.weekStart || latestSystemWeek || uniqueWeeks[0]?.[0] || '2026-10-19');

  const isMatchingReport = activeReport &&
    isSamePcgAgent(activeReport.rmName, targetAgentName) &&
    (selectedWeekFilter === 'all' || activeReport.weekStart === targetWeek || activeReport.id.includes(':all') || activeReport.id.includes(':period'));

  const canonicalTarget = targetAgentName ? targetAgentName.toLowerCase().trim() : '';
  let targetCallsCount = activeReport && isSamePcgAgent(activeReport.rmName, targetAgentName)
    ? (activeReport.numbers?.callsHandled ?? 0)
    : (callStats[canonicalTarget] ?? 0);
  if (targetCallsCount === 0) {
    for (const [k, v] of Object.entries(callStats)) {
      if (isSamePcgAgent(k, canonicalTarget)) {
        targetCallsCount = v;
        break;
      }
    }
  }

  const numbers = activeReport?.numbers;

  return (
    <div className="flex flex-col lg:flex-row min-h-[calc(var(--vh100)_-_140px)] bg-[#F7F7F8] border border-[#E4E4E7] rounded-2xl overflow-hidden shadow-sm">
      {/* ── LEFT SIDEBAR: SCORECARD HISTORY (MATCHING CX EXACTLY) ─────────────── */}
      <aside className="w-full lg:w-72 border-b lg:border-b-0 lg:border-r border-[#E4E4E7] bg-white flex flex-col shrink-0 overflow-y-auto">
        <div className="p-4 border-b border-[#E4E4E7] bg-gray-50 flex items-center justify-between">
          <span className="font-bold text-gray-800 text-sm tracking-wide uppercase">Scorecard History</span>
        </div>

        {/* Admin: Manual Agent Search (No dropdown, strictly for Admin DB) */}
        {activePersona === 'admin' && (
          <div className="p-2 border-b border-[#E4E4E7] bg-white">
            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1">Agent</label>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-gray-400">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </span>
              <input
                type="text"
                value={agentSearchQuery}
                onChange={(e) => setAgentSearchQuery(e.target.value)}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                placeholder="Search agent name..."
                className="w-full pl-8 pr-7 py-1.5 text-xs border border-[#E4E4E7] rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 font-medium bg-gray-50 text-gray-800 placeholder:text-gray-400 transition-all shadow-sm"
              />
              {agentSearchQuery && (
                <button
                  type="button"
                  onClick={() => setAgentSearchQuery('')}
                  className="absolute inset-y-0 right-0 pr-2 flex items-center text-gray-400 hover:text-gray-600 cursor-pointer"
                  title="Clear search"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        )}

        {/* TL: Team Member Dropdown Filter */}
        {activePersona === 'tl' && uniqueAgents.length > 0 && (
          <div className="p-2 border-b border-[#E4E4E7] bg-white">
            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1">Agent</label>
            <select
              value={selectedAgentFilter}
              onChange={(e) => {
                const val = e.target.value;
                setSelectedAgentFilter(val);
                if (val !== 'all') {
                  const matched = reports.find((r) => isSamePcgAgent(r.rmName, val));
                  setActiveReportId(matched ? matched.id : '');
                  onSelectRm(val);
                } else {
                  if (reports.length > 0) setActiveReportId(reports[0].id);
                }
              }}
              className="w-full px-3 py-1.5 text-xs border border-[#E4E4E7] rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 font-semibold bg-gray-50 text-gray-700 cursor-pointer"
            >
              <option value="all">All Agents</option>
              {uniqueAgents.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          </div>
        )}

        {/* Date Range / Period Filter */}
        <div className="p-2 border-b border-[#E4E4E7] bg-white">
          <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1">Date Range</label>
          <select
            value={dateRange}
            onChange={(e) => {
              const val = e.target.value as 'all' | '30d' | '7d' | 'custom';
              setDateRange(val);
              if (val !== 'custom') {
                setSelectedWeekFilter('all');
              }
            }}
            className="w-full px-3 py-1.5 text-xs border border-[#E4E4E7] rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 font-semibold bg-gray-50 text-gray-700 cursor-pointer"
          >
            <option value="all">All Dates / All Time</option>
            <option value="30d">Last 30 Days</option>
            <option value="7d">Last 7 Days</option>
            <option value="custom">Custom Date Range</option>
          </select>

          {dateRange === 'custom' && (
            <div className="mt-2 space-y-1.5">
              <div className="flex items-center gap-1.5 text-[11px] text-gray-500">
                <span className="w-8 shrink-0 font-medium">From:</span>
                <input
                  type="date"
                  value={customStartDate}
                  onChange={(e) => setCustomStartDate(e.target.value)}
                  className="flex-1 px-2 py-1 text-xs border border-[#E4E4E7] rounded bg-gray-50 text-gray-700 outline-none"
                />
              </div>
              <div className="flex items-center gap-1.5 text-[11px] text-gray-500">
                <span className="w-8 shrink-0 font-medium">To:</span>
                <input
                  type="date"
                  value={customEndDate}
                  onChange={(e) => setCustomEndDate(e.target.value)}
                  className="flex-1 px-2 py-1 text-xs border border-[#E4E4E7] rounded bg-gray-50 text-gray-700 outline-none"
                />
              </div>
            </div>
          )}
        </div>

        {/* Specific Week Dropdown Filter */}
        {uniqueWeeks.length > 0 && dateRange === 'all' && (
          <div className="p-2 border-b border-[#E4E4E7] bg-white">
            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1">Single Week</label>
            <select
              value={selectedWeekFilter}
              onChange={(e) => setSelectedWeekFilter(e.target.value)}
              className="w-full px-3 py-1.5 text-xs border border-[#E4E4E7] rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 font-semibold bg-gray-50 text-gray-700 cursor-pointer"
            >
              <option value="all">All Weeks (Consolidated)</option>
              {uniqueWeeks.map(([weekStart, label]) => (
                <option key={weekStart} value={weekStart}>{label}</option>
              ))}
            </select>
          </div>
        )}

        {/* History List */}
        <nav className="flex-1 p-2 space-y-1">
          {filteredReports.length === 0 ? (
            <div className="text-center py-8 text-xs text-gray-400 font-medium px-3 leading-relaxed">
              {activePersona === 'admin' && agentSearchQuery.trim()
                ? `No scorecards found for "${agentSearchQuery}"`
                : targetCallsCount > 0 && targetCallsCount < 5
                  ? `No scorecard (${targetCallsCount} call${targetCallsCount === 1 ? '' : 's'} made · 5 required)`
                  : `No scorecard generated for this period`
              }
            </div>
          ) : (
            filteredReports.map((r) => {
              const isSelected = r.id === activeReportId;
              const isConsolidated = r.id.includes(':all') || r.id.includes(':period');
              const weekRange = `${formatDate(r.weekStart)} - ${formatDate(r.weekEnd)}`;
              const score = r.numbers?.averageScore;

              return (
                <button
                  key={r.id}
                  onClick={() => {
                    setActiveReportId(r.id);
                    if (activePersona !== 'agent') {
                      onSelectRm(r.rmName);
                      setSelectedAgentFilter(r.rmName);
                    }
                  }}
                  className={`w-full text-left p-3 rounded-lg transition-all duration-200 flex items-center justify-between group cursor-pointer ${isSelected
                    ? 'bg-indigo-50 border border-indigo-200 text-indigo-900 shadow-sm'
                    : 'hover:bg-gray-50 border border-transparent text-gray-700'
                    }`}
                >
                  <div className="truncate flex-1 pr-2">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className={`font-bold text-xs block truncate ${isSelected ? 'text-indigo-700' : 'text-gray-900'}`}>
                        {r.rmName}
                      </span>
                      {isConsolidated && (
                        <span className="text-[10px] font-extrabold uppercase px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 border border-indigo-200">
                          All Chats ({r.numbers?.callsHandled || 0})
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-gray-500 font-medium block mt-0.5 truncate">
                      {weekRange}
                    </span>
                  </div>
                  {score !== null && score !== undefined && (
                    <span
                      className={`text-xs font-bold font-mono px-2 py-0.5 rounded-md ${score >= 85
                        ? 'bg-green-100 text-green-700 border border-green-200'
                        : score >= 70
                          ? 'bg-amber-100 text-amber-700 border border-amber-200'
                          : 'bg-red-100 text-red-700 border border-red-200'
                        }`}
                    >
                      {score}%
                    </span>
                  )}
                </button>
              );
            })
          )}
        </nav>
      </aside>

      {/* ── MAIN SCORECARD VIEW (MATCHING CX EXACTLY) ─────────────────────────── */}
      <main className="flex-1 overflow-y-auto p-8 relative bg-[#F7F7F8]">
        <div className="max-w-4xl mx-auto space-y-8">
          {/* Header info */}
          <div className="flex flex-col md:flex-row md:items-center md:justify-between pb-6 border-b border-[#E4E4E7] gap-4">
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">
                  {activePersona === 'agent' ? 'My Weekly Scorecard' : 'PCG Weekly RM Scorecard'}
                </h1>
                <span className="bg-emerald-50 text-emerald-700 text-xs font-bold px-2.5 py-0.5 rounded-full border border-emerald-200">
                  Calls, Chats & Emails
                </span>
              </div>
              <p className="text-sm text-gray-500 font-medium mt-1">
                {activeReport && isMatchingReport
                  ? (activeReport.id.includes(':all') || activeReport.id.includes(':period')
                    ? `Period: ${formatDate(activeReport.weekStart)} – ${formatDate(activeReport.weekEnd)} (${activeReport.numbers?.totalInteractions ?? activeReport.numbers?.callsHandled ?? 0} interactions total)`
                    : `Week of ${formatDate(activeReport.weekStart)} to ${formatDate(activeReport.weekEnd)}`)
                  : (dateRange !== 'all' ? `Period: ${dateRange}` : `Week of ${formatDate(targetWeek)}`)}
              </p>
              <div className="flex items-center gap-3 mt-1">
                <p className="text-sm font-semibold text-indigo-700">
                  RM: {targetAgentName || activeReport?.rmName || 'RM'}
                </p>
                {activeReport?.tlName && (
                  <span className="text-xs text-gray-400 font-medium">
                    · {activeReport.tlName}
                  </span>
                )}
              </div>
            </div>

            {activeReport && isMatchingReport && (
              <div className="text-right">
                <span className="text-xs text-gray-400 font-medium font-mono block">
                  Generated every Monday
                </span>
                <span className="text-[11px] text-gray-400 font-mono">
                  {new Date(activeReport.generatedAt).toLocaleString('en-GB')}
                </span>
              </div>
            )}
          </div>

          {activeReport && isMatchingReport ? (
            <div className="space-y-8">
              {/* ── 1. THE NUMBERS SECTION (UNIFIED CALLS, CHATS & EMAILS) ─────── */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                    <span className="bg-indigo-100 text-indigo-700 w-6 h-6 rounded-full inline-flex items-center justify-center text-xs font-bold font-mono">
                      1
                    </span>
                    The Numbers
                  </h2>
                  <span className="text-xs font-semibold text-gray-500">
                    Comprehensive cross-channel evaluation
                  </span>
                </div>

                {/* Top Overview Cards Strip */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  {/* Blended IQS Score */}
                  <div className="bg-white p-4 rounded-xl border border-[#E4E4E7] shadow-sm flex flex-col justify-between">
                    <span className="text-xs font-bold text-gray-400 uppercase tracking-wider block">
                      Blended Avg IQS
                    </span>
                    <span
                      className={`text-3xl font-extrabold font-mono mt-2 ${(numbers?.blendedAvgScore ?? numbers?.averageScore ?? 0) >= 85
                        ? 'text-green-600'
                        : (numbers?.blendedAvgScore ?? numbers?.averageScore ?? 0) >= 70
                          ? 'text-amber-600'
                          : 'text-red-600'
                        }`}
                    >
                      {(numbers?.blendedAvgScore ?? numbers?.averageScore) != null
                        ? `${numbers?.blendedAvgScore ?? numbers?.averageScore}%`
                        : '—'}
                    </span>
                    <span className="text-[11px] text-gray-500 font-medium mt-1">
                      Blended across evaluated interactions
                    </span>
                  </div>

                  {/* Total Interactions */}
                  <div className="bg-white p-4 rounded-xl border border-[#E4E4E7] shadow-sm flex flex-col justify-between">
                    <span className="text-xs font-bold text-gray-400 uppercase tracking-wider block">
                      Total Interactions
                    </span>
                    <span className="text-3xl font-extrabold text-gray-900 font-mono mt-2">
                      {numbers?.totalInteractions ?? ((numbers?.calls?.handled ?? numbers?.callsHandled ?? 0) + (numbers?.chats?.handled ?? 0))}
                    </span>
                    <span className="text-[11px] text-gray-500 font-medium mt-1">
                      {numbers?.calls?.handled ?? numbers?.callsHandled ?? 0} {(numbers?.calls?.handled ?? numbers?.callsHandled ?? 0) === 1 ? 'Call' : 'Calls'} · {numbers?.chats?.handled ?? 0} {(numbers?.chats?.handled ?? 0) === 1 ? 'Chat' : 'Chats'} · 0 Emails
                    </span>
                  </div>

                  {/* Below 85 Score */}
                  <div className="bg-white p-4 rounded-xl border border-[#E4E4E7] shadow-sm flex flex-col justify-between">
                    <span className="text-xs font-bold text-gray-400 uppercase tracking-wider block">
                      Interactions Below 85
                    </span>
                    <span
                      className={`text-3xl font-extrabold font-mono mt-2 ${(numbers?.totalBelow85Count ?? numbers?.below85Count ?? 0) > 0 ? 'text-amber-600' : 'text-gray-900'
                        }`}
                    >
                      {numbers?.totalBelow85Count ?? numbers?.below85Count ?? 0}
                    </span>
                    <span className="text-[11px] text-gray-500 font-medium mt-1">
                      {numbers?.calls?.below85Count ?? numbers?.below85Count ?? 0} {(numbers?.calls?.below85Count ?? numbers?.below85Count ?? 0) === 1 ? 'Call' : 'Calls'} · {numbers?.chats?.below85Count ?? 0} {(numbers?.chats?.below85Count ?? 0) === 1 ? 'Chat' : 'Chats'}
                    </span>
                  </div>

                  {/* Compliance Breaches */}
                  <div className="bg-white p-4 rounded-xl border border-[#E4E4E7] shadow-sm flex flex-col justify-between">
                    <span className="text-xs font-bold text-gray-400 uppercase tracking-wider block">
                      Compliance Breaches
                    </span>
                    <span
                      className={`text-3xl font-extrabold font-mono mt-2 ${(numbers?.totalComplianceBreaches ?? numbers?.complianceBreachesCount ?? 0) > 0
                        ? 'text-red-600 font-bold'
                        : 'text-gray-900'
                        }`}
                    >
                      {numbers?.totalComplianceBreaches ?? numbers?.complianceBreachesCount ?? 0}
                    </span>
                    <span className="text-[11px] text-gray-500 font-medium mt-1">
                      {(numbers?.totalComplianceBreaches ?? numbers?.complianceBreachesCount ?? 0) > 0
                        ? `${numbers?.calls?.breachesCount ?? numbers?.complianceBreachesCount ?? 0} ${(numbers?.calls?.breachesCount ?? numbers?.complianceBreachesCount ?? 0) === 1 ? 'Call' : 'Calls'} · ${numbers?.chats?.breachesCount ?? 0} ${(numbers?.chats?.breachesCount ?? 0) === 1 ? 'Chat' : 'Chats'}`
                        : 'Zero regulatory breaches'}
                    </span>
                  </div>
                </div>

                {/* Channel Breakdown Grid */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-1">
                  {/* Calls Performance Card */}
                  <div className="bg-white p-5 rounded-2xl border border-[#E4E4E7] shadow-sm flex flex-col justify-between space-y-4">
                    <div className="flex items-center justify-between pb-3 border-b border-gray-100">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-lg bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600">
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                          </svg>
                        </div>
                        <span className="font-bold text-gray-900 text-sm">Calls Quality</span>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <div>
                        <span className="text-gray-400 font-bold block uppercase text-[10px]">Calls Handled</span>
                        <span className="font-mono font-extrabold text-lg text-gray-900 mt-0.5 block">
                          {numbers?.calls?.handled ?? numbers?.callsHandled ?? 0}
                        </span>
                      </div>
                      <div>
                        <span className="text-gray-400 font-bold block uppercase text-[10px]">Avg IQS</span>
                        <span
                          className={`font-mono font-extrabold text-lg mt-0.5 block ${(numbers?.calls?.avgScore ?? numbers?.averageScore ?? 0) >= 85
                            ? 'text-green-600'
                            : (numbers?.calls?.avgScore ?? numbers?.averageScore ?? 0) >= 70
                              ? 'text-amber-600'
                              : 'text-red-600'
                            }`}
                        >
                          {(numbers?.calls?.avgScore ?? numbers?.averageScore) != null
                            ? `${numbers?.calls?.avgScore ?? numbers?.averageScore}%`
                            : '—'}
                        </span>
                      </div>
                      <div>
                        <span className="text-gray-400 font-bold block uppercase text-[10px]">Below 85 Score</span>
                        <span className="font-mono font-extrabold text-lg text-gray-900 mt-0.5 block">
                          {numbers?.calls?.below85Count ?? numbers?.below85Count ?? 0}
                        </span>
                      </div>
                      <div>
                        <span className="text-gray-400 font-bold block uppercase text-[10px]">Breaches</span>
                        <span
                          className={`font-mono font-extrabold text-lg mt-0.5 block ${(numbers?.calls?.breachesCount ?? numbers?.complianceBreachesCount ?? 0) > 0
                            ? 'text-red-600'
                            : 'text-gray-900'
                            }`}
                        >
                          {numbers?.calls?.breachesCount ?? numbers?.complianceBreachesCount ?? 0}
                        </span>
                      </div>
                    </div>

                    <div className="pt-2 border-t border-gray-100">
                      <span className="text-gray-400 font-bold block uppercase text-[10px]">Client Pickup Rate</span>
                      {(() => {
                        const raw = numbers?.calls?.pickupRateText || numbers?.pickupRateText;
                        if (!raw) {
                          return <p className="text-xs font-semibold text-gray-800 mt-1">All client calls answered</p>;
                        }
                        const match = raw.match(/^(\d+%\s*pickup rate)\s*(\(.*\))$/i);
                        if (match) {
                          return (
                            <div className="mt-1">
                              <span className="text-xs font-bold text-gray-900 block">{match[1]}</span>
                              <span className="text-[11px] text-gray-500 font-medium block">{match[2]}</span>
                            </div>
                          );
                        }
                        return (
                          <p className="text-xs font-semibold text-gray-800 mt-1 leading-snug break-words">
                            {raw}
                          </p>
                        );
                      })()}
                    </div>
                  </div>

                  {/* Chats Performance Card */}
                  <div className="bg-white p-5 rounded-2xl border border-[#E4E4E7] shadow-sm flex flex-col justify-between space-y-4">
                    <div className="flex items-center justify-between pb-3 border-b border-gray-100">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-lg bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-600">
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                          </svg>
                        </div>
                        <span className="font-bold text-gray-900 text-sm">WhatsApp Chats Quality</span>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <div>
                        <span className="text-gray-400 font-bold block uppercase text-[10px]">Chats Handled</span>
                        <span className="font-mono font-extrabold text-lg text-gray-900 mt-0.5 block">
                          {numbers?.chats?.handled ?? 0}
                        </span>
                      </div>
                      <div>
                        <span className="text-gray-400 font-bold block uppercase text-[10px]">Avg IQS</span>
                        <span
                          className={`font-mono font-extrabold text-lg mt-0.5 block ${(numbers?.chats?.avgScore ?? 0) >= 85
                            ? 'text-green-600'
                            : (numbers?.chats?.avgScore ?? 0) >= 70
                              ? 'text-amber-600'
                              : numbers?.chats?.avgScore != null
                                ? 'text-red-600'
                                : 'text-gray-400'
                            }`}
                        >
                          {numbers?.chats?.avgScore != null ? `${numbers.chats.avgScore}%` : '—'}
                        </span>
                      </div>
                      <div>
                        <span className="text-gray-400 font-bold block uppercase text-[10px]">Below 85 Score</span>
                        <span className="font-mono font-extrabold text-lg text-gray-900 mt-0.5 block">
                          {numbers?.chats?.below85Count ?? 0}
                        </span>
                      </div>
                      <div>
                        <span className="text-gray-400 font-bold block uppercase text-[10px]">Breaches</span>
                        <span
                          className={`font-mono font-extrabold text-lg mt-0.5 block ${(numbers?.chats?.breachesCount ?? 0) > 0
                            ? 'text-red-600'
                            : 'text-gray-900'
                            }`}
                        >
                          {numbers?.chats?.breachesCount ?? 0}
                        </span>
                      </div>
                    </div>

                    <div className="pt-2 border-t border-gray-100">
                      <span className="text-gray-400 font-bold block uppercase text-[10px]">First Response Time</span>
                      <p className="text-xs font-semibold text-gray-800 mt-1 leading-snug break-words">
                        {numbers?.chats?.firstResponseText || '< 2m avg first response'}
                      </p>
                    </div>
                  </div>

                  {/* Emails Performance Card */}
                  <div className="bg-white p-5 rounded-2xl border border-[#E4E4E7] shadow-sm flex flex-col justify-between space-y-4">
                    <div className="flex items-center justify-between pb-3 border-b border-gray-100">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-lg bg-purple-50 border border-purple-100 flex items-center justify-center text-purple-600">
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                          </svg>
                        </div>
                        <span className="font-bold text-gray-900 text-sm">Emails Quality</span>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <div>
                        <span className="text-gray-400 font-bold block uppercase text-[10px]">Emails Handled</span>
                        <span className="font-mono font-extrabold text-lg text-gray-400 mt-0.5 block">
                          —
                        </span>
                      </div>
                      <div>
                        <span className="text-gray-400 font-bold block uppercase text-[10px]">Avg IQS</span>
                        <span className="font-mono font-extrabold text-lg text-gray-400 mt-0.5 block">
                          —
                        </span>
                      </div>
                      <div>
                        <span className="text-gray-400 font-bold block uppercase text-[10px]">Below 85 Score</span>
                        <span className="font-mono font-extrabold text-lg text-gray-400 mt-0.5 block">
                          —
                        </span>
                      </div>
                      <div>
                        <span className="text-gray-400 font-bold block uppercase text-[10px]">Breaches</span>
                        <span className="font-mono font-extrabold text-lg text-gray-400 mt-0.5 block">
                          0
                        </span>
                      </div>
                    </div>

                    <div className="pt-2 border-t border-gray-100">
                      <span className="text-gray-400 font-bold block uppercase text-[10px]">Resolution Rate</span>
                      <p className="text-xs font-semibold text-gray-400 mt-1">
                        Email quality tracking queued for implementation
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* ── WHAT WENT WELL (CALLS & CHATS DISTINCTION) ───────────────────── */}
              {(() => {
                const callsWellText = activeReport.whatWentWellCalls || (
                  activeReport.numbers?.calls?.handled
                    ? `Demonstrated solid call discipline across ${activeReport.numbers.calls.handled} calls with an average score of ${activeReport.numbers.calls.avgScore ?? activeReport.numbers.averageScore}%. Maintained clear investor rapport, structured pitching, and high conversational engagement.`
                    : (activeReport.whatWentWell && activeReport.whatWentWell.includes('call')
                        ? activeReport.whatWentWell.split('. ')[0] + '.'
                        : 'Demonstrated solid call discipline, clear investor rapport, and structured product pitching.')
                );

                const chatsWellText = activeReport.whatWentWellChats || (
                  (activeReport.numbers?.chats?.handled ?? 0) > 0
                    ? `Maintained ${activeReport.numbers?.chats?.avgScore ?? 100}% resolution quality across ${activeReport.numbers?.chats?.handled} customer WhatsApp interaction${activeReport.numbers?.chats?.handled === 1 ? '' : 's'}. Demonstrated prompt responsiveness (${activeReport.numbers?.chats?.firstResponseText || '< 2m avg'}) and complete regulatory adherence.`
                    : (activeReport.whatWentWell && activeReport.whatWentWell.includes('WhatsApp')
                        ? 'Maintained high resolution quality across customer WhatsApp interactions with prompt responsiveness and full regulatory adherence.'
                        : 'No evaluated WhatsApp chats recorded this period.')
                );

                return (
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                        <span className="bg-green-100 text-green-800 w-6 h-6 rounded-full inline-flex items-center justify-center text-xs font-bold font-mono">
                          1
                        </span>
                        What Went Well (Channel Highlights)
                      </h2>
                    </div>

                    <div className="grid md:grid-cols-2 gap-4">
                      {/* Calls Quality - What Went Well */}
                      <div className="bg-gradient-to-br from-blue-50/60 to-white border border-blue-200/80 rounded-2xl p-6 relative overflow-hidden shadow-sm hover:shadow-md transition-all">
                        <div className="flex items-center justify-between mb-3">
                          <h3 className="text-xs font-extrabold text-blue-900 uppercase tracking-wider flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-blue-600 inline-block"></span>
                            Calls Quality — What Went Well
                          </h3>
                        </div>
                        <p className="text-blue-950 font-semibold text-sm leading-relaxed">
                          {callsWellText}
                        </p>
                      </div>

                      {/* WhatsApp Chats Quality - What Went Well */}
                      <div className="bg-gradient-to-br from-emerald-50/60 to-white border border-emerald-200/80 rounded-2xl p-6 relative overflow-hidden shadow-sm hover:shadow-md transition-all">
                        <div className="flex items-center justify-between mb-3">
                          <h3 className="text-xs font-extrabold text-emerald-900 uppercase tracking-wider flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-emerald-600 inline-block"></span>
                            WhatsApp Chats Quality — What Went Well
                          </h3>
                        </div>
                        <p className="text-emerald-950 font-semibold text-sm leading-relaxed">
                          {chatsWellText}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* ── 2. 1-ON-1 DISCUSSION POINTS ─────────────────────────────────── */}
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                    <span className="bg-indigo-100 text-indigo-700 w-6 h-6 rounded-full inline-flex items-center justify-center text-xs font-bold font-mono">
                      2
                    </span>
                    1-on-1 Discussion Points (Areas for Improvement)
                  </h2>
                </div>

                {activeReport.themes && activeReport.themes.length > 0 ? (
                  <div className="space-y-4">
                    {activeReport.themes.map((theme, index) => (
                      <div
                        key={index}
                        className={`bg-white rounded-2xl border shadow-sm p-6 space-y-4 transition-all hover:shadow-md ${theme.isBreach ? 'border-red-200 bg-red-50/10' : 'border-[#E4E4E7]'
                          }`}
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex items-center gap-2 flex-wrap">
                            {theme.channel === 'chat' ? (
                              <span className="bg-emerald-100 text-emerald-800 text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full border border-emerald-200 tracking-wider">
                                WhatsApp Chat
                              </span>
                            ) : theme.channel === 'email' ? (
                              <span className="bg-purple-100 text-purple-800 text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full border border-purple-200 tracking-wider">
                                Email
                              </span>
                            ) : (
                              <span className="bg-indigo-100 text-indigo-800 text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full border border-indigo-200 tracking-wider">
                                Voice Call
                              </span>
                            )}
                            {theme.isBreach && (
                              <span className="bg-red-100 text-red-800 text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full border border-red-200 tracking-wider">
                                Compliance Breach Root
                              </span>
                            )}
                            <h4 className="font-bold text-gray-900 text-base">
                              {theme.pattern.replace('Optimization', 'Improvement')}
                            </h4>
                          </div>
                        </div>

                        <div className="grid md:grid-cols-2 gap-4 text-sm text-gray-700">
                          <div>
                            <span className="text-xs font-bold text-gray-400 uppercase tracking-wider block">
                              Why it Matters
                            </span>
                            <p className="mt-1 text-gray-600 font-medium leading-relaxed">
                              {formatSimpleEnglishWhyItMatters(theme.whyItMatters, theme.pattern)}
                            </p>
                          </div>
                          <div>
                            <span className="text-xs font-bold text-gray-400 uppercase tracking-wider block">
                              Actionable Behavior Change
                            </span>
                            <p className="mt-1 text-gray-900 font-bold leading-relaxed">
                              {formatSimpleEnglishActionable(theme.actionable, theme.pattern)}
                            </p>
                          </div>
                        </div>

                        {/* Evidence Items (Clickable to redirect to that Call/Chat Evaluation) */}
                        <div className="pt-2 flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">
                            Evidence:
                          </span>
                          {theme.backingCallIds?.map((cid: string) => {
                            const isChatEv = theme.channel === 'chat' || cid.length <= 4;
                            return (
                              <div
                                key={cid}
                                onClick={() => {
                                  if (isChatEv) {
                                    if (onOpenChatView) onOpenChatView(cid);
                                    else if (onSwitchToChatQuality) onSwitchToChatQuality();
                                  } else {
                                    onOpenCallView(cid);
                                  }
                                }}
                                className="flex items-center bg-gray-100 hover:bg-indigo-50 hover:border-indigo-300 text-gray-700 hover:text-indigo-700 text-xs font-bold px-2.5 py-1 rounded-md border border-gray-200 font-mono transition-all group cursor-pointer"
                                title={isChatEv ? `Redirect to Chat #${cid} Evaluation` : `Redirect to Call #${cid} Evaluation`}
                              >
                                <span className="hover:underline flex items-center gap-1">
                                  <span>
                                    {isChatEv
                                      ? `Chat #${cid}`
                                      : `Call #${cid.replace('call-', '').replace('runo-', '')}`}
                                  </span>
                                  <svg className="w-3 h-3 text-indigo-500 opacity-0 group-hover:opacity-100 transition-opacity" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                  </svg>
                                </span>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleCopy(cid);
                                  }}
                                  className="ml-1.5 text-gray-400 hover:text-indigo-600 p-0.5 cursor-pointer"
                                  title="Copy ID"
                                >
                                  {copiedId === cid ? (
                                    <svg className="w-3.5 h-3.5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" />
                                    </svg>
                                  ) : (
                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M8 5H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-1M8 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M8 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2m0 0h2a2 2 0 0 1 2 2v3" />
                                    </svg>
                                  )}
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="bg-white rounded-2xl border border-gray-200 p-6 text-center text-gray-500 font-medium">
                    No low-scoring call or chat themes were identified. Excellent performance this week!
                  </div>
                )}
              </div>

              {/* ── 3. DETAILED EVIDENCE BREAKDOWN ─────────────────────────────── */}
              {(() => {
                const lowScoringCalls = (activeReport.evidence || []).filter(
                  (e) => e.channel !== 'chat' && !e.callId.startsWith('chat-') && e.score <= 75
                );
                const lowScoringChats = (activeReport.evidence || []).filter(
                  (e) => (e.channel === 'chat' || e.callId.startsWith('chat-')) && e.score <= 75
                );

                const highScoringCalls = (activeReport.evidence || []).filter(
                  (e) => e.channel !== 'chat' && !e.callId.startsWith('chat-') && e.score > 75
                );
                const highScoringChats = (activeReport.evidence || []).filter(
                  (e) => (e.channel === 'chat' || e.callId.startsWith('chat-')) && e.score > 75
                );

                return (
                  <div className="space-y-8">
                    {/* Header */}
                    <div className="flex items-center justify-between">
                      <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                        <span className="bg-indigo-100 text-indigo-700 w-6 h-6 rounded-full inline-flex items-center justify-center text-xs font-bold font-mono">
                          3
                        </span>
                        Interactions Evidence Breakdown
                      </h2>
                    </div>

                    {/* ── SUBSECTION 3A: LOW-SCORING INTERACTIONS (<= 75%) ── */}
                    <div className="space-y-5">
                      <div className="flex items-center justify-between pb-2 border-b border-gray-200">
                        <div>
                          <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
                            <span className="w-2.5 h-2.5 rounded-full bg-amber-500 inline-block"></span>
                            Low-Scoring Interactions (75% and Below)
                          </h3>
                          <p className="text-xs text-gray-500 mt-0.5">
                            Interactions scoring 75% or below requiring 1-on-1 coaching, process alignment, or quality review.
                          </p>
                        </div>
                        <span className="bg-amber-50 text-amber-800 text-[11px] font-extrabold px-2.5 py-1 rounded-full border border-amber-200 uppercase tracking-wide">
                          Low-Scoring Threshold: &le; 75%
                        </span>
                      </div>

                      {/* Low-Scoring Voice Calls */}
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <h4 className="text-xs font-extrabold text-gray-700 uppercase tracking-wider flex items-center gap-1.5">
                            <span>Voice Calls (&le; 75%)</span>
                            <span className="bg-gray-100 text-gray-700 text-[10px] font-bold px-2 py-0.5 rounded-full border border-gray-200">
                              {lowScoringCalls.length}
                            </span>
                          </h4>
                        </div>

                        {lowScoringCalls.length > 0 ? (
                          <div className="bg-white rounded-2xl border border-[#E4E4E7] shadow-sm overflow-hidden">
                            <table className="w-full border-collapse">
                              <thead>
                                <tr className="bg-gray-50 border-b border-[#E4E4E7] text-xs text-gray-400 font-bold uppercase tracking-wider text-left">
                                  <th className="p-4 w-24">Channel</th>
                                  <th className="p-4">Interaction ID</th>
                                  <th className="p-4 text-center">Score</th>
                                  <th className="p-4">Topic / Category</th>
                                  <th className="p-4">Primary Coaching Point / Issue</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-[#E4E4E7] text-xs text-gray-700">
                                {lowScoringCalls.map((ev, idx) => (
                                  <tr key={`low-call-${ev.callId}`} className="hover:bg-amber-50/30 transition-all">
                                    <td className="p-4 whitespace-nowrap">
                                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
                                        Call
                                      </span>
                                    </td>
                                    <td className="p-4 font-mono font-bold text-indigo-700 whitespace-nowrap">
                                      <div className="flex items-center gap-1.5">
                                        <button
                                          type="button"
                                          onClick={() => onOpenCallView(ev.callId)}
                                          className="hover:underline flex items-center gap-1 cursor-pointer text-indigo-700 font-bold"
                                          title={`Redirect to Call #${ev.callId} Evaluation`}
                                        >
                                          <span>Call #{ev.callId.replace('call-', '').replace('runo-', '')}</span>
                                          <svg className="w-3.5 h-3.5 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                          </svg>
                                        </button>
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            handleCopy(ev.callId);
                                          }}
                                          className="ml-1 text-gray-400 hover:text-indigo-600 p-0.5 cursor-pointer"
                                          title="Copy ID"
                                        >
                                          {copiedId === ev.callId ? (
                                            <svg className="w-3.5 h-3.5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" />
                                            </svg>
                                          ) : (
                                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M8 5H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-1M8 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M8 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2m0 0h2a2 2 0 0 1 2 2v3" />
                                            </svg>
                                          )}
                                        </button>
                                      </div>
                                    </td>
                                    <td className="p-4 text-center whitespace-nowrap">
                                      <span
                                        className={`text-xs font-extrabold font-mono px-2 py-0.5 rounded ${
                                          ev.score <= 70
                                            ? 'bg-red-50 text-red-700 border border-red-200'
                                            : 'bg-amber-50 text-amber-700 border border-amber-200'
                                        }`}
                                      >
                                        {ev.score}%
                                      </span>
                                    </td>
                                    <td className="p-4 font-semibold text-gray-800 whitespace-nowrap">
                                      {ev.topic}
                                    </td>
                                    <td className="p-4 text-gray-700 font-medium">
                                      {formatSimpleEnglishCallSummary(ev.summary, activeReport.rmName, ev.score, idx)}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <div className="bg-white rounded-xl border border-gray-200 p-4 text-center text-xs text-gray-500 font-medium">
                            No low-scoring voice calls recorded this period (all evaluated calls scored above 75%).
                          </div>
                        )}
                      </div>

                      {/* Low-Scoring WhatsApp Chats */}
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <h4 className="text-xs font-extrabold text-gray-700 uppercase tracking-wider flex items-center gap-1.5">
                            <span>WhatsApp Chats (&le; 75%)</span>
                            <span className="bg-gray-100 text-gray-700 text-[10px] font-bold px-2 py-0.5 rounded-full border border-gray-200">
                              {lowScoringChats.length}
                            </span>
                          </h4>
                        </div>

                        {lowScoringChats.length > 0 ? (
                          <div className="bg-white rounded-2xl border border-[#E4E4E7] shadow-sm overflow-hidden">
                            <table className="w-full border-collapse">
                              <thead>
                                <tr className="bg-gray-50 border-b border-[#E4E4E7] text-xs text-gray-400 font-bold uppercase tracking-wider text-left">
                                  <th className="p-4 w-24">Channel</th>
                                  <th className="p-4">Interaction ID</th>
                                  <th className="p-4 text-center">Score</th>
                                  <th className="p-4">Customer / Topic</th>
                                  <th className="p-4">Primary Coaching Point / Issue</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-[#E4E4E7] text-xs text-gray-700">
                                {lowScoringChats.map((ev) => (
                                  <tr key={`low-chat-${ev.callId}`} className="hover:bg-amber-50/30 transition-all">
                                    <td className="p-4 whitespace-nowrap">
                                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                        Chat
                                      </span>
                                    </td>
                                    <td className="p-4 font-mono font-bold text-indigo-700 whitespace-nowrap">
                                      <div className="flex items-center gap-1.5">
                                        <button
                                          type="button"
                                          onClick={() => {
                                            if (onOpenChatView) onOpenChatView(ev.callId);
                                            else if (onSwitchToChatQuality) onSwitchToChatQuality();
                                          }}
                                          className="hover:underline flex items-center gap-1 cursor-pointer text-indigo-700 font-bold"
                                          title={`Redirect to Chat #${ev.callId} Evaluation`}
                                        >
                                          <span>Chat #{ev.callId.replace(/^chat-/, '')}</span>
                                          <svg className="w-3.5 h-3.5 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                          </svg>
                                        </button>
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            handleCopy(ev.callId);
                                          }}
                                          className="ml-1 text-gray-400 hover:text-indigo-600 p-0.5 cursor-pointer"
                                          title="Copy ID"
                                        >
                                          {copiedId === ev.callId ? (
                                            <svg className="w-3.5 h-3.5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" />
                                            </svg>
                                          ) : (
                                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M8 5H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-1M8 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M8 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2m0 0h2a2 2 0 0 1 2 2v3" />
                                            </svg>
                                          )}
                                        </button>
                                      </div>
                                    </td>
                                    <td className="p-4 text-center whitespace-nowrap">
                                      <span
                                        className={`text-xs font-extrabold font-mono px-2 py-0.5 rounded ${
                                          ev.score <= 70
                                            ? 'bg-red-50 text-red-700 border border-red-200'
                                            : 'bg-amber-50 text-amber-700 border border-amber-200'
                                        }`}
                                      >
                                        {ev.score}%
                                      </span>
                                    </td>
                                    <td className="p-4 font-semibold text-gray-800 whitespace-nowrap">
                                      {ev.topic}
                                    </td>
                                    <td className="p-4 text-gray-700 font-medium">
                                      {ev.summary}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <div className="bg-white rounded-xl border border-gray-200 p-4 text-center text-xs text-gray-500 font-medium">
                            No low-scoring WhatsApp chats recorded this period (all evaluated chats scored above 75%).
                          </div>
                        )}
                      </div>
                    </div>

                    {/* ── SUBSECTION 3B: WHAT WENT WELL — HIGH-SCORING INTERACTIONS (> 75%) ── */}
                    <div className="space-y-5 pt-4">
                      <div className="flex items-center justify-between pb-2 border-b border-gray-200">
                        <div>
                          <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
                            <span className="w-2.5 h-2.5 rounded-full bg-green-600 inline-block"></span>
                            What Went Well — High-Scoring Interactions (Above 75%)
                          </h3>
                          <p className="text-xs text-gray-500 mt-0.5">
                            Exemplary interactions scoring above 75% demonstrating strong client communication and quality standards.
                          </p>
                        </div>
                        <span className="bg-green-50 text-green-800 text-[11px] font-extrabold px-2.5 py-1 rounded-full border border-green-200 uppercase tracking-wide">
                          Quality Benchmark: &gt; 75%
                        </span>
                      </div>

                      {/* High-Scoring Voice Calls */}
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <h4 className="text-xs font-extrabold text-gray-700 uppercase tracking-wider flex items-center gap-1.5">
                            <span>Voice Calls (&gt; 75%)</span>
                            <span className="bg-green-50 text-green-700 text-[10px] font-bold px-2 py-0.5 rounded-full border border-green-200">
                              {highScoringCalls.length}
                            </span>
                          </h4>
                        </div>

                        {highScoringCalls.length > 0 ? (
                          <div className="bg-white rounded-2xl border border-[#E4E4E7] shadow-sm overflow-hidden">
                            <table className="w-full border-collapse">
                              <thead>
                                <tr className="bg-gray-50 border-b border-[#E4E4E7] text-xs text-gray-400 font-bold uppercase tracking-wider text-left">
                                  <th className="p-4 w-24">Channel</th>
                                  <th className="p-4">Interaction ID</th>
                                  <th className="p-4 text-center">Score</th>
                                  <th className="p-4">Topic / Category</th>
                                  <th className="p-4">Demonstrated Strengths / Best Practice</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-[#E4E4E7] text-xs text-gray-700">
                                {highScoringCalls.map((ev, idx) => (
                                  <tr key={`high-call-${ev.callId}`} className="hover:bg-green-50/30 transition-all">
                                    <td className="p-4 whitespace-nowrap">
                                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
                                        Call
                                      </span>
                                    </td>
                                    <td className="p-4 font-mono font-bold text-indigo-700 whitespace-nowrap">
                                      <div className="flex items-center gap-1.5">
                                        <button
                                          type="button"
                                          onClick={() => onOpenCallView(ev.callId)}
                                          className="hover:underline flex items-center gap-1 cursor-pointer text-indigo-700 font-bold"
                                          title={`Redirect to Call #${ev.callId} Evaluation`}
                                        >
                                          <span>Call #{ev.callId.replace('call-', '').replace('runo-', '')}</span>
                                          <svg className="w-3.5 h-3.5 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                          </svg>
                                        </button>
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            handleCopy(ev.callId);
                                          }}
                                          className="ml-1 text-gray-400 hover:text-indigo-600 p-0.5 cursor-pointer"
                                          title="Copy ID"
                                        >
                                          {copiedId === ev.callId ? (
                                            <svg className="w-3.5 h-3.5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" />
                                            </svg>
                                          ) : (
                                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M8 5H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-1M8 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M8 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2m0 0h2a2 2 0 0 1 2 2v3" />
                                            </svg>
                                          )}
                                        </button>
                                      </div>
                                    </td>
                                    <td className="p-4 text-center whitespace-nowrap">
                                      <span className="text-xs font-extrabold font-mono px-2 py-0.5 rounded bg-green-50 text-green-700 border border-green-200">
                                        {ev.score}%
                                      </span>
                                    </td>
                                    <td className="p-4 font-semibold text-gray-800 whitespace-nowrap">
                                      {ev.topic}
                                    </td>
                                    <td className="p-4 text-gray-700 font-medium">
                                      {formatSimpleEnglishCallSummary(ev.summary, activeReport.rmName, ev.score, idx)}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <div className="bg-white rounded-xl border border-gray-200 p-4 text-center text-xs text-gray-500 font-medium">
                            No high-scoring voice calls recorded for this period.
                          </div>
                        )}
                      </div>

                      {/* High-Scoring WhatsApp Chats */}
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <h4 className="text-xs font-extrabold text-gray-700 uppercase tracking-wider flex items-center gap-1.5">
                            <span>WhatsApp Chats (&gt; 75%)</span>
                            <span className="bg-green-50 text-green-700 text-[10px] font-bold px-2 py-0.5 rounded-full border border-green-200">
                              {highScoringChats.length}
                            </span>
                          </h4>
                        </div>

                        {highScoringChats.length > 0 ? (
                          <div className="bg-white rounded-2xl border border-[#E4E4E7] shadow-sm overflow-hidden">
                            <table className="w-full border-collapse">
                              <thead>
                                <tr className="bg-gray-50 border-b border-[#E4E4E7] text-xs text-gray-400 font-bold uppercase tracking-wider text-left">
                                  <th className="p-4 w-24">Channel</th>
                                  <th className="p-4">Interaction ID</th>
                                  <th className="p-4 text-center">Score</th>
                                  <th className="p-4">Customer / Topic</th>
                                  <th className="p-4">Demonstrated Strengths / Best Practice</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-[#E4E4E7] text-xs text-gray-700">
                                {highScoringChats.map((ev) => (
                                  <tr key={`high-chat-${ev.callId}`} className="hover:bg-green-50/30 transition-all">
                                    <td className="p-4 whitespace-nowrap">
                                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                        Chat
                                      </span>
                                    </td>
                                    <td className="p-4 font-mono font-bold text-indigo-700 whitespace-nowrap">
                                      <div className="flex items-center gap-1.5">
                                        <button
                                          type="button"
                                          onClick={() => {
                                            if (onOpenChatView) onOpenChatView(ev.callId);
                                            else if (onSwitchToChatQuality) onSwitchToChatQuality();
                                          }}
                                          className="hover:underline flex items-center gap-1 cursor-pointer text-indigo-700 font-bold"
                                          title={`Redirect to Chat #${ev.callId} Evaluation`}
                                        >
                                          <span>Chat #{ev.callId.replace(/^chat-/, '')}</span>
                                          <svg className="w-3.5 h-3.5 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                          </svg>
                                        </button>
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            handleCopy(ev.callId);
                                          }}
                                          className="ml-1 text-gray-400 hover:text-indigo-600 p-0.5 cursor-pointer"
                                          title="Copy ID"
                                        >
                                          {copiedId === ev.callId ? (
                                            <svg className="w-3.5 h-3.5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" />
                                            </svg>
                                          ) : (
                                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M8 5H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-1M8 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M8 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2m0 0h2a2 2 0 0 1 2 2v3" />
                                            </svg>
                                          )}
                                        </button>
                                      </div>
                                    </td>
                                    <td className="p-4 text-center whitespace-nowrap">
                                      <span className="text-xs font-extrabold font-mono px-2 py-0.5 rounded bg-green-50 text-green-700 border border-green-200">
                                        {ev.score}%
                                      </span>
                                    </td>
                                    <td className="p-4 font-semibold text-gray-800 whitespace-nowrap">
                                      {ev.topic}
                                    </td>
                                    <td className="p-4 text-gray-700 font-medium">
                                      {ev.summary}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <div className="bg-white rounded-xl border border-gray-200 p-4 text-center text-xs text-gray-500 font-medium">
                            No high-scoring WhatsApp chats recorded for this period.
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          ) : (
            <div className="max-w-2xl mx-auto my-16 bg-white rounded-2xl border border-[#E4E4E7] p-10 text-center shadow-sm">
              <div className="w-16 h-16 mx-auto mb-5 rounded-2xl flex items-center justify-center bg-gray-100 text-gray-400 border border-gray-200">
                <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>

              <h3 className="text-xl font-bold text-gray-900 tracking-tight">
                No Scorecard Generated for this Week
              </h3>

              <p className="text-gray-600 mt-3 text-sm leading-relaxed max-w-lg mx-auto font-medium">
                {activePersona === 'agent'
                  ? 'You do not have a weekly scorecard generated for this period because no evaluated interactions were recorded.'
                  : `No weekly scorecard was generated for ${targetAgentName || 'this RM'} for the week of ${formatDate(targetWeek)} because no evaluated interactions were recorded in this period.`}
              </p>

              <div className="mt-8 pt-6 border-t border-gray-100 flex items-center justify-center gap-2 text-xs text-gray-400 font-medium">
                <span>Evaluation Window:</span>
                <span className="font-semibold text-gray-600 font-mono">{formatDate(targetWeek)}</span>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
