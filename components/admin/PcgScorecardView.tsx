'use client';

import React, { useState } from 'react';

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

interface Props {
  activePersona: 'admin' | 'tl' | 'agent';
  selectedRm: string;
  onSelectRm: (rm: string) => void;
  selectedTl: string;
  onSelectTl: (tl: string) => void;
  onOpenCallView: (cid: string) => void;
  onSwitchToCallsTab?: () => void;
}

export default function PcgScorecardView({
  activePersona,
  selectedRm,
  onSelectRm,
  selectedTl,
  onSelectTl,
  onOpenCallView,
  onSwitchToCallsTab,
}: Props) {
  const [reports, setReports] = useState<PcgWeeklyReport[]>(INITIAL_PCG_REPORTS);
  const [activeReportId, setActiveReportId] = useState<string>('');

  // Filters matching CX pattern
  const [selectedAgentFilter, setSelectedAgentFilter] = useState<string>('all');
  const [selectedWeekFilter, setSelectedWeekFilter] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Synchronize selection with active report
  React.useEffect(() => {
    if (selectedRm) {
      const match = reports.find((r) => r.rmName.toLowerCase() === selectedRm.toLowerCase());
      if (match) {
        setActiveReportId(match.id);
        setSelectedAgentFilter(match.rmName);
      }
    }
  }, [activePersona, selectedRm, reports]);

  const activeReport = reports.find((r) => r.id === activeReportId) || reports[0];

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

  const uniqueAgents = Array.from(new Set(reports.map((r) => r.rmName)));

  const uniqueWeeksMap = new Map<string, string>();
  reports.forEach((r) => {
    if (r.weekStart && !uniqueWeeksMap.has(r.weekStart)) {
      uniqueWeeksMap.set(r.weekStart, `${formatDate(r.weekStart)} – ${formatDate(r.weekEnd)}`);
    }
  });
  const uniqueWeeks = Array.from(uniqueWeeksMap.entries()).sort((a, b) => b[0].localeCompare(a[0]));

  const filteredReports = reports.filter((r) => {
    const weekRange = `${formatDate(r.weekStart)} - ${formatDate(r.weekEnd)}`.toLowerCase();
    const agentMatch = activePersona === 'agent'
      ? r.rmName.toLowerCase() === selectedRm.toLowerCase()
      : selectedAgentFilter === 'all' || r.rmName === selectedAgentFilter;
    const weekFilterMatch = selectedWeekFilter === 'all' || r.weekStart === selectedWeekFilter;
    const searchMatch = !searchTerm.trim() ||
      r.rmName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      weekRange.includes(searchTerm.toLowerCase());
    return agentMatch && weekFilterMatch && searchMatch;
  });

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
              onChange={(e) => setSelectedAgentFilter(e.target.value)}
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
            <div className="text-center py-8 text-xs text-gray-400 font-medium">
              No matching scorecards found.
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
        {activeReport ? (
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

                {/* Pickup Rate */}
                <div className="bg-white p-4 rounded-xl border border-[#E4E4E7] shadow-sm flex flex-col col-span-2 justify-between">
                  <span className="text-xs font-bold text-gray-400 uppercase tracking-wider block">
                    Pickup Rate
                  </span>
                  <span
                    className="text-xs font-semibold text-gray-800 mt-3 bg-zinc-50 p-1.5 rounded-lg border border-zinc-200 text-center truncate"
                    title={numbers?.pickupRateText || numbers?.connectRateText}
                  >
                    {numbers?.pickupRateText || numbers?.connectRateText || '92% pickup rate'}
                  </span>
                </div>

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
                            {theme.pattern}
                          </h4>
                        </div>
                      </div>

                      <div className="grid md:grid-cols-2 gap-4 text-sm text-gray-700">
                        <div>
                          <span className="text-xs font-bold text-gray-400 uppercase tracking-wider block">
                            Why it Matters
                          </span>
                          <p className="mt-1 text-gray-600 font-medium leading-relaxed">
                            {theme.whyItMatters}
                          </p>
                        </div>
                        <div>
                          <span className="text-xs font-bold text-gray-400 uppercase tracking-wider block">
                            Actionable Behavior Change
                          </span>
                          <p className="mt-1 text-gray-900 font-bold leading-relaxed">
                            {theme.actionable}
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
                            className="flex items-center bg-gray-100 hover:bg-indigo-50 hover:border-indigo-300 text-gray-700 hover:text-indigo-700 text-xs font-bold px-2.5 py-1 rounded-md border border-gray-200 font-mono transition-all group"
                          >
                            <button
                              type="button"
                              onClick={() => onOpenCallView(cid)}
                              className="hover:underline flex items-center gap-1 cursor-pointer"
                              title={`Redirect to Call #${cid} Evaluation`}
                            >
                              <span>Call #{cid.replace('call-', '').replace('runo-', '')}</span>
                              <svg className="w-3 h-3 text-indigo-500 opacity-0 group-hover:opacity-100 transition-opacity" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                              </svg>
                            </button>
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
                      {activeReport.evidence.map((ev) => (
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
                            {ev.summary}
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
          <div className="text-center py-24 text-gray-400 font-medium">
            No scorecard selected. Select a report from the history on the left.
          </div>
        )}
      </main>
    </div>
  );
}
