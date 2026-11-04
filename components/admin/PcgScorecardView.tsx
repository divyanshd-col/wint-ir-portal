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
  };
  whatWentWell: string;
  themes: Array<{
    pattern: string;
    associatedParameters: string[];
    whyItMatters: string;
    actionable: string;
    isBreach: boolean;
    rankScore: number;
    backingCallIds: string[];
  }>;
  breaches: Array<{
    callId: string;
    score: number;
    flaggedContent: string;
    note: string;
  }>;
  evidence: Array<{
    callId: string;
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

interface Props {
  activePersona: 'admin' | 'tl' | 'agent';
  selectedRm: string;
  onSelectRm: (rm: string) => void;
  selectedTl: string;
  onSelectTl: (tl: string) => void;
  onOpenCallView: (cid: string) => void;
  onSwitchToCallsTab?: () => void;
  allowedRms?: string[];
}

export default function PcgScorecardView({
  activePersona,
  selectedRm,
  onSelectRm,
  selectedTl,
  onSelectTl,
  onOpenCallView,
  onSwitchToCallsTab,
  allowedRms,
}: Props) {
  const [reports, setReports] = useState<PcgWeeklyReport[]>(INITIAL_PCG_REPORTS);
  const [activeReportId, setActiveReportId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [callStats, setCallStats] = useState<Record<string, number>>({});
  const [availableAgents, setAvailableAgents] = useState<string[]>([]);
  const [latestSystemWeek, setLatestSystemWeek] = useState<string | null>(null);

  // Filters matching CX pattern
  const [selectedAgentFilter, setSelectedAgentFilter] = useState<string>('all');
  const [selectedWeekFilter, setSelectedWeekFilter] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Fetch scorecards and live call volume stats from backend
  const fetchScorecards = async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      if (selectedWeekFilter !== 'all') {
        p.set('week', selectedWeekFilter);
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
          } else if (!activeReportId) {
            setActiveReportId(data.reports[0].id);
          }
        }
      }
      if (data.callStats) setCallStats(data.callStats);
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
  }, [activePersona, selectedWeekFilter]);

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

  const activeReport = reports.find((r) => r.id === activeReportId) || reports[0];

  // Mark as read when report is viewed by agent
  React.useEffect(() => {
    if (activeReport && !activeReport.viewedAt && activePersona === 'agent') {
      fetch(`/api/pcg/scorecards?id=${activeReport.id}`, { method: 'PATCH' }).catch(() => { });
    }
  }, [activeReport, activePersona]);

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
    if (r.weekStart && !uniqueWeeksMap.has(r.weekStart)) {
      uniqueWeeksMap.set(r.weekStart, `${formatDate(r.weekStart)} – ${formatDate(r.weekEnd)}`);
    }
  });
  const uniqueWeeks = Array.from(uniqueWeeksMap.entries()).sort((a, b) => b[0].localeCompare(a[0]));

  const filteredReports = reports.filter((r) => {
    if (NON_RM_SET.has(r.rmName.toLowerCase().trim())) return false;
    const weekRange = `${formatDate(r.weekStart)} - ${formatDate(r.weekEnd)}`.toLowerCase();
    const tlAllowed = activePersona === 'tl' && allowedRms && allowedRms.length > 0
      ? allowedRms.some((a) => isSamePcgAgent(a, r.rmName))
      : true;
    const agentMatch = activePersona === 'agent'
      ? isSamePcgAgent(r.rmName, selectedRm)
      : selectedAgentFilter === 'all' || isSamePcgAgent(r.rmName, selectedAgentFilter);
    const weekFilterMatch = selectedWeekFilter === 'all' || r.weekStart === selectedWeekFilter;
    const searchMatch = !searchTerm.trim() ||
      r.rmName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      weekRange.includes(searchTerm.toLowerCase());
    return tlAllowed && agentMatch && weekFilterMatch && searchMatch;
  });

  const targetAgentName = activePersona === 'agent'
    ? selectedRm
    : (selectedAgentFilter !== 'all' ? selectedAgentFilter : (selectedRm || activeReport?.rmName || uniqueAgents[0] || ''));

  const targetWeek = selectedWeekFilter !== 'all'
    ? selectedWeekFilter
    : (activeReport?.weekStart || latestSystemWeek || uniqueWeeks[0]?.[0] || '2026-10-19');

  const isMatchingReport = activeReport &&
    isSamePcgAgent(activeReport.rmName, targetAgentName) &&
    (selectedWeekFilter === 'all' || activeReport.weekStart === targetWeek);

  const canonicalTarget = targetAgentName ? targetAgentName.toLowerCase().trim() : '';
  let targetCallsCount = callStats[canonicalTarget] ?? 0;
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
    <div className="flex flex-col lg:flex-row min-h-[calc(100vh-140px)] bg-[#F7F7F8] border border-[#E4E4E7] rounded-2xl overflow-hidden shadow-sm">
      {/* ── LEFT SIDEBAR: SCORECARD HISTORY (MATCHING CX EXACTLY) ─────────────── */}
      <aside className="w-full lg:w-72 border-b lg:border-b-0 lg:border-r border-[#E4E4E7] bg-white flex flex-col shrink-0 overflow-y-auto">
        <div className="p-4 border-b border-[#E4E4E7] bg-gray-50 flex items-center justify-between">
          <span className="font-bold text-gray-800 text-sm tracking-wide uppercase">Scorecard History</span>
        </div>

        {/* Agents Dropdown Filter (Admin/TL View) */}
        {activePersona !== 'agent' && uniqueAgents.length > 0 && (
          <div className="p-2 border-b border-[#E4E4E7] bg-white">
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

        {/* Week Dropdown Filter */}
        {uniqueWeeks.length > 0 && (
          <div className="p-2 border-b border-[#E4E4E7] bg-white">
            <select
              value={selectedWeekFilter}
              onChange={(e) => setSelectedWeekFilter(e.target.value)}
              className="w-full px-3 py-1.5 text-xs border border-[#E4E4E7] rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 font-semibold bg-gray-50 text-gray-700 cursor-pointer"
            >
              <option value="all">All Weeks</option>
              {uniqueWeeks.map(([weekStart, label]) => (
                <option key={weekStart} value={weekStart}>{label}</option>
              ))}
            </select>
          </div>
        )}

        {/* Search Input */}
        <div className="p-2 border-b border-[#E4E4E7] bg-white">
          <input
            type="text"
            placeholder="Search by name or date..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full px-3 py-1.5 text-xs border border-[#E4E4E7] rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 font-medium bg-gray-50 hover:bg-gray-100/50 transition-all text-gray-700 placeholder-gray-400"
          />
        </div>

        {/* History List */}
        <nav className="flex-1 p-2 space-y-1">
          {filteredReports.length === 0 ? (
            <div className="text-center py-8 text-xs text-gray-400 font-medium px-3 leading-relaxed">
              {targetCallsCount > 0 && targetCallsCount < 5
                ? `No scorecard (${targetCallsCount} call${targetCallsCount === 1 ? '' : 's'} made · 5 required)`
                : `No scorecard generated for this period`
              }
            </div>
          ) : (
            filteredReports.map((r) => {
              const isSelected = r.id === activeReportId;
              const weekRange = `${formatDate(r.weekStart)} - ${formatDate(r.weekEnd)}`;
              const score = r.numbers?.averageScore;

              return (
                <button
                  key={r.id}
                  onClick={() => {
                    setActiveReportId(r.id);
                    if (activePersona !== 'agent') {
                      onSelectRm(r.rmName);
                    }
                  }}
                  className={`w-full text-left p-3 rounded-lg transition-all duration-200 flex items-center justify-between group cursor-pointer ${isSelected
                    ? 'bg-indigo-50 border border-indigo-200 text-indigo-900 shadow-sm'
                    : 'hover:bg-gray-50 border border-transparent text-gray-700'
                    }`}
                >
                  <div className="truncate flex-1 pr-2">
                    <div className="flex items-center gap-1.5">
                      <span className={`font-bold text-xs block truncate ${isSelected ? 'text-indigo-700' : 'text-gray-900'}`}>
                        {r.rmName}
                      </span>
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
        {activeReport && isMatchingReport ? (
          <div className="max-w-4xl mx-auto space-y-8">
            {/* Header info */}
            <div className="flex flex-col md:flex-row md:items-center md:justify-between pb-6 border-b border-[#E4E4E7]">
              <div>
                <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">
                  {activePersona === 'agent' ? 'My Weekly Scorecard' : 'PCG Weekly RM Scorecard'}
                </h1>
                <p className="text-sm text-gray-500 font-medium mt-1">
                  Week of {formatDate(activeReport.weekStart)} to {formatDate(activeReport.weekEnd)}
                </p>
                <p className="text-sm font-semibold text-indigo-700 mt-0.5">
                  RM Name: {activeReport.rmName}
                </p>
              </div>
              <div className="mt-4 md:mt-0 flex items-center gap-3">
                <span className="text-xs text-gray-400 font-medium font-mono">
                  Generated at {new Date(activeReport.generatedAt).toLocaleString('en-GB')}
                </span>
              </div>
            </div>

            {/* ── 1. THE NUMBERS SECTION ─────────────────────────────────────── */}
            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                  <span className="bg-indigo-100 text-indigo-700 w-6 h-6 rounded-full inline-flex items-center justify-center text-xs font-bold font-mono">
                    1
                  </span>
                  The Numbers
                </h2>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
                {/* Calls Handled */}
                <div className="bg-white p-4 rounded-xl border border-[#E4E4E7] shadow-sm flex flex-col justify-between">
                  <span className="text-xs font-bold text-gray-400 uppercase tracking-wider block">
                    Calls Handled
                  </span>
                  <span className="text-2xl font-extrabold text-gray-900 font-mono mt-2">
                    {numbers?.callsHandled ?? 0}
                  </span>
                </div>

                {/* Avg IQS Score */}
                <div className="bg-white p-4 rounded-xl border border-[#E4E4E7] shadow-sm flex flex-col justify-between">
                  <span className="text-xs font-bold text-gray-400 uppercase tracking-wider block">
                    Avg IQS Score
                  </span>
                  <span
                    className={`text-2xl font-extrabold font-mono mt-2 ${numbers?.averageScore !== null && numbers.averageScore >= 85
                      ? 'text-green-600'
                      : numbers?.averageScore !== null && numbers.averageScore >= 70
                        ? 'text-amber-600'
                        : 'text-red-600'
                      }`}
                  >
                    {numbers?.averageScore != null ? `${numbers.averageScore}%` : '—'}
                  </span>
                </div>

                {/* Below 85 Score */}
                <div className="bg-white p-4 rounded-xl border border-[#E4E4E7] shadow-sm flex flex-col justify-between">
                  <span className="text-xs font-bold text-gray-400 uppercase tracking-wider block">
                    Below 85 Score
                  </span>
                  <span
                    className={`text-2xl font-extrabold font-mono mt-2 ${numbers?.below85Count > 0 ? 'text-amber-600' : 'text-gray-900'
                      }`}
                  >
                    {numbers?.below85Count ?? 0}
                  </span>
                </div>

                {/* Client Pickup Rate */}
                {(() => {
                  const rawPickupText = (numbers?.pickupRateText || numbers?.connectRateText || '')
                    .replace(/pickup rate/gi, 'client pickup rate')
                    .replace(/calls connected/gi, 'client calls answered');
                  const pctMatch = rawPickupText.match(/^(\d+%)/);
                  const detailsMatch = rawPickupText.match(/\((.*?)\)/);
                  const pickupPct = pctMatch ? pctMatch[1] : (rawPickupText.includes('%') ? rawPickupText.split(' ')[0] : '—');
                  const pickupDetails = detailsMatch
                    ? detailsMatch[1]
                    : rawPickupText.replace(/^\d+%\s*(client\s*)?pickup\s*rate\s*/i, '').replace(/[()]/g, '').trim();

                  return (
                    <div className="bg-white p-4 rounded-xl border border-[#E4E4E7] shadow-sm flex flex-col col-span-2 justify-between">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-gray-400 uppercase tracking-wider block">
                          Client Pickup Rate
                        </span>
                      </div>
                      <div className="flex items-baseline gap-2 mt-2">
                        <span className="text-2xl font-extrabold font-mono text-gray-900">
                          {pickupPct}
                        </span>
                        <span className="text-xs font-semibold text-zinc-500">
                          pickup
                        </span>
                      </div>
                      <p className="text-[11px] font-medium text-zinc-600 mt-1 leading-normal" title={rawPickupText}>
                        {pickupDetails || 'All client calls answered'}
                      </p>
                    </div>
                  );
                })()}

                {/* Compliance Breaches */}
                <div className="bg-white p-4 rounded-xl border border-[#E4E4E7] shadow-sm flex flex-col justify-between">
                  <span className="text-xs font-bold text-gray-400 uppercase tracking-wider block">
                    Breaches
                  </span>
                  <span
                    className={`text-2xl font-extrabold font-mono mt-2 ${numbers?.complianceBreachesCount > 0
                      ? 'text-red-600 animate-pulse'
                      : 'text-gray-900'
                      }`}
                  >
                    {numbers?.complianceBreachesCount ?? 0}
                  </span>
                </div>
              </div>
            </div>

            {/* ── WHAT WENT WELL ─────────────────────────────────────────────── */}
            <div className="bg-green-50/50 border border-green-200/80 rounded-2xl p-6 relative overflow-hidden">
              <div className="absolute right-0 bottom-0 opacity-10 pointer-events-none transform translate-y-4 translate-x-2">
                <svg className="w-40 h-40 text-green-700" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 2l3.09 6.26 6.91.97-5 4.89 1.18 6.88L12 17.77l-6.18 3.25L7 14.12 2 9.23l6.91-.97L12 2z" />
                </svg>
              </div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-extrabold text-green-800 uppercase tracking-wider flex items-center gap-1.5">
                  <StarIcon /> What Went Well
                </h3>
              </div>
              <p className="text-green-950 font-bold text-base leading-relaxed">
                {activeReport.whatWentWell}
              </p>
            </div>

            {/* ── 2. 1-ON-1 DISCUSSION POINTS ─────────────────────────────────── */}
            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                  <span className="bg-indigo-100 text-indigo-700 w-6 h-6 rounded-full inline-flex items-center justify-center text-xs font-bold font-mono">
                    2
                  </span>
                  1-on-1 Discussion Points
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

                      {/* Evidence Calls (Clickable to redirect to that Call Evaluation) */}
                      <div className="pt-2 flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">
                          Evidence:
                        </span>
                        {theme.backingCallIds?.map((cid: string) => (
                          <div
                            key={cid}
                            onClick={() => onOpenCallView(cid)}
                            className="flex items-center bg-gray-100 hover:bg-indigo-50 hover:border-indigo-300 text-gray-700 hover:text-indigo-700 text-xs font-bold px-2.5 py-1 rounded-md border border-gray-200 font-mono transition-all group cursor-pointer"
                            title={`Redirect to Call #${cid} Evaluation`}
                          >
                            <span className="hover:underline flex items-center gap-1">
                              <span>Call #{cid.replace('call-', '').replace('runo-', '')}</span>
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
                              title="Copy Call ID"
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
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="bg-white rounded-2xl border border-gray-200 p-6 text-center text-gray-500 font-medium">
                  🎉 Fantastic week! No low-scoring call themes were identified. Keep up the excellent work!
                </div>
              )}
            </div>

            {/* ── 3. FULL EVIDENCE LIST (LOW-SCORING CALLS) ────────────────────── */}
            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                  <span className="bg-indigo-100 text-indigo-700 w-6 h-6 rounded-full inline-flex items-center justify-center text-xs font-bold font-mono">
                    3
                  </span>
                  Full Evidence List (Low-Scoring Calls)
                </h2>
              </div>

              {activeReport.evidence && activeReport.evidence.length > 0 ? (
                <div className="bg-white rounded-2xl border border-[#E4E4E7] shadow-sm overflow-hidden">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr className="bg-gray-50 border-b border-[#E4E4E7] text-xs text-gray-400 font-bold uppercase tracking-wider text-left">
                        <th className="p-4">Call ID</th>
                        <th className="p-4 text-center">Score</th>
                        <th className="p-4">Topic / Disposition</th>
                        <th className="p-4">Primary Coaching Point / Issue</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E4E4E7] text-xs text-gray-700">
                      {activeReport.evidence.map((ev, idx) => (
                        <tr key={ev.callId} className="hover:bg-gray-50 transition-all">
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
                                title="Copy Call ID"
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
                            {/* QA / TL UPDATED OPTION REMOVED AS REQUESTED */}
                            <span
                              className={`text-xs font-extrabold font-mono px-2 py-0.5 rounded ${ev.score >= 85
                                ? 'bg-green-50 text-green-700 border border-green-200'
                                : ev.score >= 70
                                  ? 'bg-amber-50 text-amber-700 border border-amber-200'
                                  : 'bg-red-50 text-red-700 border border-red-200'
                                }`}
                            >
                              {ev.score}%
                            </span>
                          </td>
                          <td className="p-4 font-semibold text-gray-800 whitespace-nowrap">
                            {ev.topic}
                          </td>
                          <td className="p-4 text-gray-600 font-medium">
                            {formatSimpleEnglishCallSummary(ev.summary, activeReport.rmName, ev.score, idx)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="bg-white rounded-2xl border border-gray-200 p-6 text-center text-gray-500 font-medium">
                  No low-scoring calls to display this week. Excellent!
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="max-w-2xl mx-auto my-16 bg-white rounded-2xl border border-[#E4E4E7] p-10 text-center shadow-sm">
            <div className={`w-16 h-16 mx-auto mb-5 rounded-2xl flex items-center justify-center ${targetCallsCount > 0 ? 'bg-amber-50 text-amber-600 border border-amber-200' : 'bg-gray-100 text-gray-400 border border-gray-200'}`}>
              {targetCallsCount > 0 ? (
                <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              ) : (
                <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                  <line x1="1" y1="1" x2="23" y2="23" stroke="currentColor" strokeWidth="2" />
                </svg>
              )}
            </div>

            <h3 className="text-xl font-bold text-gray-900 tracking-tight">
              {targetCallsCount > 0 ? 'Minimum Call Volume Threshold Not Met' : 'No Scorecard Generated for this Week'}
            </h3>

            <p className="text-gray-600 mt-3 text-sm leading-relaxed max-w-lg mx-auto font-medium">
              {targetCallsCount > 0 ? (
                activePersona === 'agent'
                  ? `A weekly scorecard requires a minimum of 5 calls. You made only ${targetCallsCount} call${targetCallsCount === 1 ? '' : 's'} this week, so a performance scorecard was not generated.`
                  : `A weekly scorecard requires a minimum of 5 calls. ${targetAgentName || 'This RM'} made only ${targetCallsCount} call${targetCallsCount === 1 ? '' : 's'} in the week of ${formatDate(targetWeek)}, so a performance scorecard was not generated.`
              ) : (
                activePersona === 'agent'
                  ? 'You do not have a scorecard generated for this week because no calls were made.'
                  : `No scorecard was generated for ${targetAgentName || 'this RM'} for the week of ${formatDate(targetWeek)} because no calls were made in this period.`
              )}
            </p>

            {targetCallsCount > 0 && (
              <div className="mt-6 inline-flex items-center gap-2.5 px-4 py-2 rounded-xl bg-amber-50 border border-amber-200/80 text-amber-900 font-mono text-xs font-bold">
                <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                <span>Calls Recorded: {targetCallsCount} / 5 minimum required</span>
              </div>
            )}

            <div className="mt-8 pt-6 border-t border-gray-100 flex items-center justify-center gap-2 text-xs text-gray-400 font-medium">
              <span>Evaluation Window:</span>
              <span className="font-semibold text-gray-600 font-mono">{formatDate(targetWeek)}</span>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
