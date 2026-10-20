'use client';

import React, { useState } from 'react';

export type Period = '7' | '30' | 'custom';

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

const DEFAULT_TEAM_LEADS = [
  {
    tlName: 'Gokul',
    teamSize: 5,
    totalCalls: 68,
    connectRate: 67,
    avgScore: 86.8,
    callsUnder85: 4,
    rms: ['Aahan Thaker', 'Dhanush', 'Yaashvi Arora', 'Samskriti Rao', 'Gaurav Nautiyal'],
  },
  {
    tlName: 'Vaishnavi',
    teamSize: 4,
    totalCalls: 50,
    connectRate: 65,
    avgScore: 85.1,
    callsUnder85: 3,
    rms: ['Aravind', 'Sujal Dadwani', 'Antara Chakrabarty', 'Swati Singh'],
  },
];

const DEFAULT_SCORECARDS = [
  { rmName: 'Yaashvi Arora', team: 'Gokul', totalCalls: 14, connectRate: 71, pitchScore: 93, upsellScore: 90, supportScore: 90, overallScore: 91.0, trend: 'improving', complianceFlags: 0, topWeakness: 'Secondary window explanation TAT' },
  { rmName: 'Aahan Thaker', team: 'Gokul', totalCalls: 20, connectRate: 70, pitchScore: 90, upsellScore: 87, supportScore: 89, overallScore: 88.5, trend: 'improving', complianceFlags: 0, topWeakness: 'Premature exit disclaimer' },
  { rmName: 'Aravind', team: 'Vaishnavi', totalCalls: 14, connectRate: 64, pitchScore: 89, upsellScore: 86, supportScore: 88, overallScore: 87.5, trend: 'stable', complianceFlags: 0, topWeakness: 'Callback slot commitments' },
  { rmName: 'Dhanush', team: 'Gokul', totalCalls: 16, connectRate: 69, pitchScore: 87, upsellScore: 85, supportScore: 87, overallScore: 86.2, trend: 'stable', complianceFlags: 1, topWeakness: 'KYC DigiLocker walkthrough' },
  { rmName: 'Sujal Dadwani', team: 'Vaishnavi', totalCalls: 12, connectRate: 67, pitchScore: 87, upsellScore: 84, supportScore: 86, overallScore: 85.5, trend: 'stable', complianceFlags: 0, topWeakness: 'Speech cadence during yield pitch' },
  { rmName: 'Samskriti Rao', team: 'Gokul', totalCalls: 12, connectRate: 67, pitchScore: 85, upsellScore: 84, supportScore: 86, overallScore: 84.8, trend: 'declining', complianceFlags: 1, topWeakness: 'Lock-in period objection handling' },
  { rmName: 'Antara Chakrabarty', team: 'Vaishnavi', totalCalls: 10, connectRate: 60, pitchScore: 85, upsellScore: 83, supportScore: 85, overallScore: 84.0, trend: 'stable', complianceFlags: 0, topWeakness: 'Senior secured asset cover clarification' },
  { rmName: 'Swati Singh', team: 'Vaishnavi', totalCalls: 8, connectRate: 63, pitchScore: 84, upsellScore: 82, supportScore: 85, overallScore: 83.5, trend: 'declining', complianceFlags: 1, topWeakness: 'Technical jargon during debt pitch' },
  { rmName: 'Gaurav Nautiyal', team: 'Gokul', totalCalls: 10, connectRate: 60, pitchScore: 84, upsellScore: 81, supportScore: 84, overallScore: 83.0, trend: 'declining', complianceFlags: 1, topWeakness: 'Support-to-upsell pivot transition' },
];

const PARAMETERS_BENCHMARK = [
  { id: 'P1', name: 'Pitch Clarity & Senior Secured Debt Backing', category: '13% Pitching', passRate: 97.4, benchmark: 95.0, weight: 15 },
  { id: 'P2', name: 'Indicative Yield Framing & No Return Guarantees', category: '13% Pitching', passRate: 100.0, benchmark: 98.0, weight: 10 },
  { id: 'P3', name: 'Secondary Liquidity Window Framing', category: '13% Pitching', passRate: 86.5, benchmark: 88.0, weight: 10 },
  { id: 'P4', name: 'Asset Allocation Need Discovery', category: 'Portfolio Upselling', passRate: 94.2, benchmark: 90.0, weight: 10 },
  { id: 'P5', name: 'Reinvestment & Compounding Pitch', category: 'Portfolio Upselling', passRate: 92.0, benchmark: 88.0, weight: 10 },
  { id: 'P6', name: 'Monthly Interest Payout Timeline Clarity', category: 'Support & Ops', passRate: 96.5, benchmark: 92.0, weight: 10 },
  { id: 'P7', name: 'Form 15G / Tax Deduction Guidance', category: 'Support & Ops', passRate: 88.0, benchmark: 85.0, weight: 5 },
  { id: 'P8', name: 'Account & Demat Verification Assistance', category: 'Support & Ops', passRate: 98.0, benchmark: 95.0, weight: 5 },
  { id: 'P9', name: 'Active Listening & Objection Handling', category: 'Soft Skills', passRate: 94.5, benchmark: 90.0, weight: 10 },
  { id: 'P10', name: 'Call Closure & Specific Next Step Confirmation', category: 'Soft Skills', passRate: 91.0, benchmark: 90.0, weight: 5 },
  { id: 'P11', name: 'Telephony Opening & Polite Identity Verification', category: 'Telephony', passRate: 99.0, benchmark: 98.0, weight: 5 },
  { id: 'P12', name: 'Zero Return Promises & Regulatory Compliance', category: 'Compliance', passRate: 100.0, benchmark: 100.0, weight: 5 },
];

export default function PcgTeamAnalyticsDashboard({
  activePersona = 'admin',
  selectedTl,
  onSelectTl,
  onSelectRm,
  onSwitchToMemberAnalytics,
  teamLeads = DEFAULT_TEAM_LEADS,
  rmScorecards = DEFAULT_SCORECARDS,
}: PcgTeamAnalyticsProps) {
  const [period, setPeriod] = useState<Period>('7');
  const [tlFilter, setTlFilter] = useState<'all' | 'Gokul' | 'Vaishnavi'>(
    selectedTl === 'Vaishnavi' ? 'Vaishnavi' : selectedTl === 'Gokul' ? 'Gokul' : 'all'
  );
  const [channelFilter, setChannelFilter] = useState<'calls' | 'chats' | 'emails'>('calls');

  const handleTlChange = (val: 'all' | 'Gokul' | 'Vaishnavi') => {
    setTlFilter(val);
    if (onSelectTl && val !== 'all') {
      onSelectTl(val);
    }
  };

  // Filtered RMs
  const filteredScorecards = rmScorecards.filter((rm: any) => {
    const rmTeam = rm.team || (DEFAULT_TEAM_LEADS[0].rms.includes(rm.rmName) ? 'Gokul' : 'Vaishnavi');
    if (tlFilter !== 'all') {
      return rmTeam === tlFilter;
    }
    return true;
  });

  // Calculate aggregated stats based on tlFilter
  const activeTeams = teamLeads.length > 0 ? teamLeads : DEFAULT_TEAM_LEADS;
  const currentTeams = tlFilter === 'all'
    ? activeTeams
    : activeTeams.filter(t => t.tlName === tlFilter);

  const totalCalls = currentTeams.reduce((sum, t) => sum + t.totalCalls, 0);
  const avgIqs = currentTeams.length > 0
    ? (currentTeams.reduce((sum, t) => sum + t.avgScore, 0) / currentTeams.length).toFixed(1)
    : '86.0';
  const connectRate = currentTeams.length > 0
    ? Math.round(currentTeams.reduce((sum, t) => sum + t.connectRate, 0) / currentTeams.length)
    : 66;
  const callsUnder85 = currentTeams.reduce((sum, t) => sum + t.callsUnder85, 0);

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-16 font-sans">
      {/* ── Page Header: Team Analytics + Viewing Team Selector + Time Range ── */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-2 border-b border-[#E4E4E7]">
        <div className="flex items-center gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-[#111111] tracking-tight">Team Analytics</h1>
            <p className="text-xs text-[#71717A] mt-0.5">Aggregated team performance, benchmark comparisons, and coachable gaps across PCG</p>
          </div>

          {/* Viewing Team Selector for Admin */}
          <div className="flex items-center gap-2 pl-4 border-l border-[#E4E4E7]">
            <span className="text-xs font-semibold text-[#71717A]">Viewing Team:</span>
            <select
              value={tlFilter}
              onChange={(e) => handleTlChange(e.target.value as any)}
              className="text-xs font-semibold border border-[#E4E4E7] rounded-lg px-3 py-1.5 bg-white text-zinc-900 outline-none shadow-sm cursor-pointer hover:border-zinc-400 transition-colors"
            >
              <option value="all">All Teams (2 Teams, 9 RMs)</option>
              <option value="Gokul">Team Gokul (5 RMs)</option>
              <option value="Vaishnavi">Team Vaishnavi (4 RMs)</option>
            </select>
          </div>

          {/* Channel Segment */}
          <div className="inline-flex rounded-lg border border-[#E4E4E7] p-0.5 bg-[#F4F4F5] text-xs">
            {(['calls', 'chats', 'emails'] as const).map((ch) => (
              <button
                key={ch}
                type="button"
                onClick={() => setChannelFilter(ch)}
                className={`px-3 py-1 rounded-md capitalize font-semibold transition-all ${
                  channelFilter === ch
                    ? 'bg-white text-[#111111] shadow-sm'
                    : 'text-[#71717A] hover:text-[#111111]'
                }`}
              >
                {ch}
              </button>
            ))}
          </div>
        </div>

        {/* Time Range Switcher */}
        <div className="inline-flex rounded-lg border border-[#E4E4E7] p-0.5 bg-[#F4F4F5] text-xs">
          {(['7', '30', 'custom'] as Period[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPeriod(p)}
              className={`px-3 py-1 rounded-md font-semibold transition-all ${
                period === p
                  ? 'bg-[#111111] text-white shadow-sm'
                  : 'text-[#71717A] hover:text-[#111111]'
              }`}
            >
              {p === '7' ? '7 days' : p === '30' ? '30 days' : 'Custom range'}
            </button>
          ))}
        </div>
      </div>

      {/* ── Top Metric Cards (Calls Focus) ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* Metric 1: Overall Average IQS */}
        <div className="bg-white p-5 rounded-xl border border-[#E4E4E7] shadow-sm">
          <div className="text-[11px] font-bold text-[#71717A] uppercase tracking-wider">Average IQS Score</div>
          <div className="text-2xl font-black text-[#111111] mt-1.5 flex items-baseline gap-2">
            <span>{avgIqs}%</span>
            <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
              Benchmark 85.0%
            </span>
          </div>
          <div className="text-xs text-[#71717A] mt-1.5 flex items-center gap-1 font-medium">
            <span className="text-emerald-600 font-bold">↑ +1.8%</span> vs previous period
          </div>
        </div>

        {/* Metric 2: Audited Call Volume */}
        <div className="bg-white p-5 rounded-xl border border-[#E4E4E7] shadow-sm">
          <div className="text-[11px] font-bold text-[#71717A] uppercase tracking-wider">Audited Calls Volume</div>
          <div className="text-2xl font-black text-[#111111] mt-1.5">{totalCalls}</div>
          <div className="text-xs text-[#71717A] mt-1.5">
            {tlFilter === 'all' ? 'Across 2 Teams (9 Active RMs)' : `${currentTeams[0]?.teamSize || 5} Active RMs`}
          </div>
        </div>

        {/* Metric 3: Connect Rate */}
        <div className="bg-white p-5 rounded-xl border border-[#E4E4E7] shadow-sm">
          <div className="text-[11px] font-bold text-[#71717A] uppercase tracking-wider">Connect Rate</div>
          <div className="text-2xl font-black text-[#111111] mt-1.5 flex items-baseline gap-2">
            <span>{connectRate}%</span>
            <span className="text-[10px] font-bold text-zinc-600 bg-zinc-100 px-1.5 py-0.5 rounded">
              Target &gt;65%
            </span>
          </div>
          <div className="text-xs text-[#71717A] mt-1.5 font-medium">
            {Math.round((totalCalls * connectRate) / 100)} Connected Calls
          </div>
        </div>

        {/* Metric 4: Calls Needing Coaching */}
        <div className="bg-white p-5 rounded-xl border border-[#E4E4E7] shadow-sm">
          <div className="text-[11px] font-bold text-[#71717A] uppercase tracking-wider">Coachable Calls (&lt;85%)</div>
          <div className="text-2xl font-black text-amber-600 mt-1.5">{callsUnder85}</div>
          <div className="text-xs text-[#71717A] mt-1.5">
            Requires TL 1-on-1 coaching review
          </div>
        </div>
      </div>

      {/* ── Team Comparison Section (When Viewing All Teams) ── */}
      {tlFilter === 'all' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Team Gokul Card */}
          <div className="bg-white rounded-xl border border-[#E4E4E7] p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-[#E4E4E7]">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-bold text-[#111111]">Team Gokul</h3>
                  <span className="text-[10px] font-bold uppercase tracking-wider bg-zinc-100 text-zinc-700 px-2 py-0.5 rounded">
                    TL: Gokul
                  </span>
                </div>
                <p className="text-xs text-[#71717A] mt-0.5">5 Relationship Managers · Senior Secured & 13% Club</p>
              </div>
              <button
                type="button"
                onClick={() => handleTlChange('Gokul')}
                className="text-xs font-semibold text-zinc-700 hover:text-black border border-[#E4E4E7] px-2.5 py-1.5 rounded-lg hover:bg-zinc-50 transition-colors"
              >
                Focus Team →
              </button>
            </div>

            <div className="grid grid-cols-3 gap-3 text-center bg-zinc-50 p-3 rounded-lg border border-[#E4E4E7]">
              <div>
                <div className="text-[10px] font-semibold text-[#71717A] uppercase">Avg IQS</div>
                <div className="text-lg font-bold text-emerald-700 mt-0.5">86.8%</div>
              </div>
              <div>
                <div className="text-[10px] font-semibold text-[#71717A] uppercase">Connect %</div>
                <div className="text-lg font-bold text-[#111111] mt-0.5">67%</div>
              </div>
              <div>
                <div className="text-[10px] font-semibold text-[#71717A] uppercase">Total Calls</div>
                <div className="text-lg font-bold text-[#111111] mt-0.5">68</div>
              </div>
            </div>

            <div className="text-xs text-zinc-600 flex items-center justify-between pt-1">
              <span>Top Performer: <strong className="text-zinc-900">Yaashvi Arora (91.0%)</strong></span>
              <span className="text-amber-700">Coachable: <strong>Gaurav Nautiyal (83.0%)</strong></span>
            </div>
          </div>

          {/* Team Vaishnavi Card */}
          <div className="bg-white rounded-xl border border-[#E4E4E7] p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-[#E4E4E7]">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-bold text-[#111111]">Team Vaishnavi</h3>
                  <span className="text-[10px] font-bold uppercase tracking-wider bg-zinc-100 text-zinc-700 px-2 py-0.5 rounded">
                    TL: Vaishnavi
                  </span>
                </div>
                <p className="text-xs text-[#71717A] mt-0.5">4 Relationship Managers · Portfolio Upselling & Support</p>
              </div>
              <button
                type="button"
                onClick={() => handleTlChange('Vaishnavi')}
                className="text-xs font-semibold text-zinc-700 hover:text-black border border-[#E4E4E7] px-2.5 py-1.5 rounded-lg hover:bg-zinc-50 transition-colors"
              >
                Focus Team →
              </button>
            </div>

            <div className="grid grid-cols-3 gap-3 text-center bg-zinc-50 p-3 rounded-lg border border-[#E4E4E7]">
              <div>
                <div className="text-[10px] font-semibold text-[#71717A] uppercase">Avg IQS</div>
                <div className="text-lg font-bold text-emerald-700 mt-0.5">85.1%</div>
              </div>
              <div>
                <div className="text-[10px] font-semibold text-[#71717A] uppercase">Connect %</div>
                <div className="text-lg font-bold text-[#111111] mt-0.5">65%</div>
              </div>
              <div>
                <div className="text-[10px] font-semibold text-[#71717A] uppercase">Total Calls</div>
                <div className="text-lg font-bold text-[#111111] mt-0.5">50</div>
              </div>
            </div>

            <div className="text-xs text-zinc-600 flex items-center justify-between pt-1">
              <span>Top Performer: <strong className="text-zinc-900">Aravind (87.5%)</strong></span>
              <span className="text-amber-700">Coachable: <strong>Swati Singh (83.5%)</strong></span>
            </div>
          </div>
        </div>
      )}

      {/* ── Section 3: Parameter Performance & Gap Analysis ── */}
      <div className="bg-white rounded-xl border border-[#E4E4E7] overflow-hidden shadow-sm">
        <div className="p-4 border-b border-[#E4E4E7] flex items-center justify-between bg-[#FAFAFB]">
          <div>
            <h3 className="text-sm font-bold text-[#111111]">Parameter Pass Rates & Compliance Gaps</h3>
            <p className="text-xs text-[#71717A] mt-0.5">Evaluated across all pitch, upselling, and support conversations</p>
          </div>
          <span className="text-xs text-zinc-500 font-medium">12 Core Quality Gates</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-[#FAFAFB] border-b border-[#E4E4E7] text-[#6B6B6B] font-semibold uppercase tracking-wider">
                <th className="py-3 px-4">Parameter Name</th>
                <th className="py-3 px-4">Category</th>
                <th className="py-3 px-4">Pass Rate</th>
                <th className="py-3 px-4">Org Benchmark</th>
                <th className="py-3 px-4">Gap</th>
                <th className="py-3 px-4 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E4E4E7]">
              {PARAMETERS_BENCHMARK.map((param) => {
                const gap = parseFloat((param.passRate - param.benchmark).toFixed(1));
                const isPassing = gap >= 0;
                return (
                  <tr key={param.id} className="hover:bg-zinc-50 transition-colors">
                    <td className="py-3 px-4 font-medium text-zinc-900">
                      <div className="font-semibold">{param.name}</div>
                    </td>
                    <td className="py-3 px-4 text-[#71717A]">{param.category}</td>
                    <td className="py-3 px-4 font-bold text-zinc-900">{param.passRate}%</td>
                    <td className="py-3 px-4 text-zinc-600 font-medium">{param.benchmark}%</td>
                    <td className="py-3 px-4 font-semibold font-mono">
                      <span className={gap > 0 ? 'text-emerald-600' : gap < 0 ? 'text-red-600' : 'text-zinc-600'}>
                        {gap > 0 ? `+${gap}%` : `${gap}%`}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                          isPassing
                            ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                            : 'bg-amber-50 text-amber-800 border border-amber-200'
                        }`}
                      >
                        {isPassing ? 'Passing' : 'Coachable'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Section 4: Team Roster & RM Breakdown Table ── */}
      <div className="bg-white rounded-xl border border-[#E4E4E7] overflow-hidden shadow-sm">
        <div className="p-4 border-b border-[#E4E4E7] flex flex-wrap items-center justify-between gap-4 bg-[#FAFAFB]">
          <div>
            <h3 className="text-sm font-bold text-[#111111]">
              {tlFilter === 'all' ? 'All Team Members Leaderboard' : `Team ${tlFilter} Members`}
            </h3>
            <p className="text-xs text-[#71717A] mt-0.5">Click "Deep Dive" on any RM to inspect individual call transcripts and coaching briefs in Member Analytics</p>
          </div>
          <span className="text-xs font-semibold px-2.5 py-1 bg-zinc-100 rounded-lg text-zinc-700">
            {filteredScorecards.length} Active RMs
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-[#FAFAFB] border-b border-[#E4E4E7] text-[#6B6B6B] font-semibold uppercase tracking-wider">
                <th className="py-3 px-4">Rank</th>
                <th className="py-3 px-4">RM Name</th>
                <th className="py-3 px-4">Team</th>
                <th className="py-3 px-4">Total Calls</th>
                <th className="py-3 px-4">Connect %</th>
                <th className="py-3 px-4">Pitching IQS</th>
                <th className="py-3 px-4">Upsell IQS</th>
                <th className="py-3 px-4">Overall IQS</th>
                <th className="py-3 px-4">Trend</th>
                <th className="py-3 px-4 text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E4E4E7]">
              {filteredScorecards.map((rm: any, idx) => {
                const team = rm.team || (DEFAULT_TEAM_LEADS[0].rms.includes(rm.rmName) ? 'Gokul' : 'Vaishnavi');
                return (
                  <tr key={rm.rmName} className="hover:bg-zinc-50 transition-colors">
                    <td className="py-3 px-4 font-bold text-zinc-500">#{idx + 1}</td>
                    <td className="py-3 px-4 font-semibold text-zinc-900">{rm.rmName}</td>
                    <td className="py-3 px-4">
                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-zinc-100 text-zinc-700">
                        {team}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-zinc-700 font-medium">{rm.totalCalls}</td>
                    <td className="py-3 px-4 text-zinc-700 font-medium">{rm.connectRate}%</td>
                    <td className="py-3 px-4 font-medium text-zinc-900">{rm.pitchScore}%</td>
                    <td className="py-3 px-4 font-medium text-zinc-900">{rm.upsellScore}%</td>
                    <td className="py-3 px-4 font-bold text-emerald-700 text-sm">{rm.overallScore}%</td>
                    <td className="py-3 px-4">
                      <span
                        className={`inline-flex items-center gap-1 font-semibold ${
                          rm.trend === 'improving'
                            ? 'text-emerald-700'
                            : rm.trend === 'declining'
                            ? 'text-red-700'
                            : 'text-zinc-600'
                        }`}
                      >
                        {rm.trend === 'improving' ? '↑' : rm.trend === 'declining' ? '↓' : '→'} {rm.trend}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-center">
                      <button
                        type="button"
                        onClick={() => {
                          if (onSelectRm) onSelectRm(rm.rmName);
                          if (onSwitchToMemberAnalytics) onSwitchToMemberAnalytics();
                        }}
                        className="px-2.5 py-1 text-xs font-semibold text-zinc-900 bg-white border border-[#E4E4E7] rounded-lg hover:bg-zinc-100 transition-colors"
                      >
                        Deep Dive →
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
