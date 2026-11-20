'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import PcgEmailEvalPanel from './PcgEmailEvalPanel';
import PcgPeriodFilter, { type PcgPeriod } from './PcgPeriodFilter';
import TicketLinkButton from '@/components/quality/TicketLinkButton';
import { intentLabel } from '@/lib/email/ui';
import { isPcgAm, isPcgTl, canonicalizePcgRmName } from '@/lib/pcg/canonical-names';
import type { PcgEmailEvaluation } from '@/app/api/admin/pcg-emails/route';

interface Props {
  activePersona: 'admin' | 'tl' | 'agent';
  selectedRm?: string;
  selectedTl?: string;
  loggedInUserName?: string;
  teamRms?: string[];
}

export default function PcgEmailQualityView({
  activePersona,
  selectedRm,
  selectedTl,
  loggedInUserName,
  teamRms,
}: Props) {
  const [emails, setEmails] = useState<PcgEmailEvaluation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Summary Metrics
  const [summary, setSummary] = useState({
    totalCount: 0,
    avgIqs: 0,
    compliancePassRate: 100,
    verdictCounts: {
      excellent: 0,
      meetsExpectations: 0,
      coaching: 0,
      remediation: 0,
    },
  });

  const [availableRms, setAvailableRms] = useState<Array<{ name: string; count: number }>>([]);
  const [availableTls, setAvailableTls] = useState<Array<{ name: string; count: number }>>([]);

  // Section tabs
  const [activeSection, setActiveSection] = useState<'evaluated' | 'disputes_pending' | 'disputes_reviewed' | 'all'>('evaluated');
  const [sectionCounts, setSectionCounts] = useState({
    pendingEvaluation: 0,
    evaluated: 0,
    disputesPending: 0,
    disputesReviewed: 0,
  });

  // Filter controls
  const [searchQuery, setSearchQuery] = useState('');
  const [minIqsFilter, setMinIqsFilter] = useState('');
  const [maxIqsFilter, setMaxIqsFilter] = useState('');
  const [selectedRmName, setSelectedRmName] = useState<string>(activePersona === 'agent' && selectedRm ? selectedRm : 'all');
  const [selectedAmName, setSelectedAmName] = useState<string>('all');
  const [selectedTlName, setSelectedTlName] = useState<string>(selectedTl || 'all');
  const [dateRange, setDateRange] = useState<PcgPeriod>('all');
  const [customStartDate, setCustomStartDate] = useState('2026-10-15');
  const [customEndDate, setCustomEndDate] = useState(() => new Date().toISOString().split('T')[0]);

  // Inline expanded evaluation
  const [expandedEmailId, setExpandedEmailId] = useState<string | null>(null);

  // Canonical AMs mapped strictly to Swetha Jayakumar
  const SWETHA_AMS = useMemo(
    () => ['Aditi Verma', 'Ankita Agarwal', 'Arshnoor Kaur', 'Bhavnit Singh', 'Vishyata Tulsani'],
    []
  );

  // Separate AM dropdown is strictly available only to Swetha (TL)
  const isSwethaTl = useMemo(() => {
    if (activePersona !== 'tl') return false;
    const tlRef = (selectedTl || selectedTlName || loggedInUserName || '').toLowerCase();
    return tlRef.includes('swetha');
  }, [activePersona, selectedTl, selectedTlName, loggedInUserName]);

  // Helper map of counts by canonical agent name
  const countByAgentName = useMemo(() => {
    const map = new Map<string, number>();
    availableRms.forEach((r) => {
      const key = canonicalizePcgRmName(r.name).toLowerCase();
      map.set(key, (map.get(key) || 0) + r.count);
    });
    return map;
  }, [availableRms]);

  // Strict RM list: ONLY RMs (never AMs), and for TL strictly mapped to that TL's teamRms
  const rmMembers = useMemo(() => {
    if (activePersona === 'tl') {
      const seen = new Set<string>();
      const list: Array<{ name: string; count: number }> = [];
      (teamRms || []).forEach((rawName) => {
        const canonical = canonicalizePcgRmName(rawName);
        if (isPcgAm(canonical)) return;
        const key = canonical.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        list.push({ name: canonical, count: countByAgentName.get(key) || 0 });
      });
      return list.sort((a, b) => a.name.localeCompare(b.name));
    }

    // Admin: all RMs (strictly excluding AMs so there's never a mix)
    const seen = new Set<string>();
    const list: Array<{ name: string; count: number }> = [];
    availableRms.forEach((r) => {
      const canonical = canonicalizePcgRmName(r.name);
      if (isPcgAm(canonical)) return;
      const key = canonical.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      list.push({ name: canonical, count: countByAgentName.get(key) || 0 });
    });
    return list.sort((a, b) => a.name.localeCompare(b.name));
  }, [activePersona, teamRms, availableRms, countByAgentName]);

  // Strict AM list: ONLY AMs mapped to Swetha (never RMs)
  const amMembers = useMemo(() => {
    if (!isSwethaTl) return [];
    const seen = new Set<string>();
    const list: Array<{ name: string; count: number }> = [];
    const candidates = [
      ...SWETHA_AMS,
      ...(teamRms || []).filter((name) => isPcgAm(name)),
    ];
    candidates.forEach((rawName) => {
      const canonical = canonicalizePcgRmName(rawName);
      if (!isPcgAm(canonical)) return;
      const key = canonical.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      list.push({ name: canonical, count: countByAgentName.get(key) || 0 });
    });
    return list.sort((a, b) => a.name.localeCompare(b.name));
  }, [isSwethaTl, SWETHA_AMS, teamRms, countByAgentName]);

  // Full Agent list for Admin persona (RMs, AMs, and TLs)
  const adminAgentList = useMemo(() => {
    if (activePersona !== 'admin') return [];
    return availableRms
      .map((r) => {
        let tag = '';
        if (isPcgTl(r.name)) tag = 'TL';
        else if (isPcgAm(r.name)) tag = 'AM';
        else tag = 'RM';
        return {
          name: r.name,
          count: r.count,
          tag,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [activePersona, availableRms]);

  // Sync RM, AM and TL filter when activePersona or props change
  useEffect(() => {
    if (activePersona === 'agent') {
      const rm = selectedRm || loggedInUserName;
      if (rm) setSelectedRmName(rm);
      setSelectedAmName('all');
      setActiveSection('evaluated');
    } else if (activePersona === 'tl') {
      if (selectedTl) setSelectedTlName(selectedTl);
      setSelectedRmName('all');
      setSelectedAmName('all');
      setActiveSection('evaluated');
    } else {
      setSelectedRmName('all');
      setSelectedAmName('all');
      setSelectedTlName('all');
      setActiveSection('evaluated');
    }
  }, [activePersona, selectedRm, selectedTl, loggedInUserName]);

  // Fetch PCG Email Evaluations
  const fetchEmails = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('persona', activePersona);
      if (activePersona === 'admin') {
        if (selectedRmName && selectedRmName !== 'all') params.set('rmName', selectedRmName);
        if (selectedTlName && selectedTlName !== 'all') params.set('tlName', selectedTlName);
      } else if (activePersona === 'tl') {
        const effectiveAgentFilter =
          isSwethaTl && selectedAmName !== 'all' ? selectedAmName : selectedRmName;
        if (effectiveAgentFilter && effectiveAgentFilter !== 'all') params.set('rmName', effectiveAgentFilter);
        if (selectedTlName && selectedTlName !== 'all') params.set('tlName', selectedTlName);
      }
      if (activeSection !== 'all') params.set('section', activeSection);
      if (searchQuery.trim()) params.set('search', searchQuery.trim());

      const res = await fetch(`/api/admin/pcg-emails?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to fetch PCG email evaluations');
      const data = await res.json();

      setEmails(data.emails || []);
      if (data.summary) setSummary(data.summary);
      if (data.sectionCounts) setSectionCounts(data.sectionCounts);
      if (data.availableRms) setAvailableRms(data.availableRms);
      if (data.availableTls) setAvailableTls(data.availableTls);
    } catch (err: any) {
      console.error('Error fetching PCG emails:', err);
      setError(err?.message || 'Failed to load PCG emails');
    } finally {
      setLoading(false);
    }
  }, [activePersona, isSwethaTl, selectedRmName, selectedAmName, selectedTlName, activeSection, searchQuery]);

  useEffect(() => {
    fetchEmails();
  }, [fetchEmails]);

  const handlePeriodChange = (range: PcgPeriod, start: string, end: string) => {
    setDateRange(range);
    setCustomStartDate(start);
    setCustomEndDate(end);
  };

  const filteredEmails = useMemo(() => {
    const minVal = minIqsFilter !== '' ? parseFloat(minIqsFilter) : null;
    const maxVal = maxIqsFilter !== '' ? parseFloat(maxIqsFilter) : null;
    return emails.filter((e) => {
      if (minVal !== null && !isNaN(minVal) && e.iqsScore < minVal) return false;
      if (maxVal !== null && !isNaN(maxVal) && e.iqsScore > maxVal) return false;
      return true;
    });
  }, [emails, minIqsFilter, maxIqsFilter]);

  const getVerdictChip = (verdict: string) => {
    if (verdict === 'excellent') {
      return (
        <span className="px-2 py-0.5 text-[11px] font-bold rounded bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
          EXCELLENT
        </span>
      );
    }
    if (verdict === 'meets_expectations') {
      return (
        <span className="px-2 py-0.5 text-[11px] font-bold rounded bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300">
          MEETS EXPECTATIONS
        </span>
      );
    }
    if (verdict === 'coaching') {
      return (
        <span className="px-2 py-0.5 text-[11px] font-bold rounded bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
          COACHING
        </span>
      );
    }
    return (
      <span className="px-2 py-0.5 text-[11px] font-bold rounded bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300">
        REMEDIATION
      </span>
    );
  };

  return (
    <div className="space-y-6">
      {/* ── TOP SECTION TABS ── */}
      {(activePersona === 'tl' || activePersona === 'admin') && (
        <div className="flex flex-wrap items-center gap-2 pb-3 border-b border-slate-200 dark:border-slate-800">
          <button
            onClick={() => { setActiveSection('evaluated'); setExpandedEmailId(null); }}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center gap-2 ${
              activeSection === 'evaluated'
                ? 'bg-zinc-900 text-white font-bold shadow-sm'
                : 'bg-white dark:bg-slate-900 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800'
            }`}
          >
            <span>Evaluated Emails</span>
            <span
              className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                activeSection === 'evaluated'
                  ? 'bg-zinc-700 text-white'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
              }`}
            >
              {sectionCounts.evaluated}
            </span>
          </button>

          <button
            onClick={() => { setActiveSection('disputes_pending'); setExpandedEmailId(null); }}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center gap-2 ${
              activeSection === 'disputes_pending'
                ? 'bg-zinc-900 text-white font-bold shadow-sm'
                : 'bg-white dark:bg-slate-900 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800'
            }`}
          >
            <span>Disputes Pending</span>
            <span
              className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                activeSection === 'disputes_pending'
                  ? 'bg-zinc-700 text-white'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
              }`}
            >
              {sectionCounts.disputesPending}
            </span>
          </button>

          <button
            onClick={() => { setActiveSection('disputes_reviewed'); setExpandedEmailId(null); }}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center gap-2 ${
              activeSection === 'disputes_reviewed'
                ? 'bg-zinc-900 text-white font-bold shadow-sm'
                : 'bg-white dark:bg-slate-900 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800'
            }`}
          >
            <span>Disputes Reviewed</span>
            <span
              className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                activeSection === 'disputes_reviewed'
                  ? 'bg-zinc-700 text-white'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
              }`}
            >
              {sectionCounts.disputesReviewed}
            </span>
          </button>
        </div>
      )}

      {activePersona === 'agent' && (
        <div className="flex flex-wrap items-center gap-2 pb-3 border-b border-slate-200 dark:border-slate-800">
          <button
            onClick={() => { setActiveSection('evaluated'); setExpandedEmailId(null); }}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center gap-2 ${
              activeSection === 'evaluated'
                ? 'bg-zinc-900 text-white font-bold shadow-sm'
                : 'bg-white dark:bg-slate-900 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800'
            }`}
          >
            <span>My Evaluated Emails</span>
            <span
              className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                activeSection === 'evaluated'
                  ? 'bg-zinc-700 text-white'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
              }`}
            >
              {sectionCounts.evaluated}
            </span>
          </button>

          <button
            onClick={() => { setActiveSection('disputes_pending'); setExpandedEmailId(null); }}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center gap-2 ${
              activeSection === 'disputes_pending'
                ? 'bg-zinc-900 text-white font-bold shadow-sm'
                : 'bg-white dark:bg-slate-900 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800'
            }`}
          >
            <span>Disputes Raised</span>
            <span
              className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                activeSection === 'disputes_pending'
                  ? 'bg-zinc-700 text-white'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
              }`}
            >
              {sectionCounts.disputesPending}
            </span>
          </button>

          <button
            onClick={() => { setActiveSection('disputes_reviewed'); setExpandedEmailId(null); }}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center gap-2 ${
              activeSection === 'disputes_reviewed'
                ? 'bg-zinc-900 text-white font-bold shadow-sm'
                : 'bg-white dark:bg-slate-900 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800'
            }`}
          >
            <span>Disputes Reviewed</span>
            <span
              className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                activeSection === 'disputes_reviewed'
                  ? 'bg-zinc-700 text-white'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
              }`}
            >
              {sectionCounts.disputesReviewed}
            </span>
          </button>
        </div>
      )}

      {/* ── SUMMARY METRIC CARDS ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Evaluated */}
        <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xs">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Total Evaluated Emails</div>
          <div className="text-2xl font-bold text-slate-900 dark:text-white mt-1">
            {summary.totalCount}
          </div>
        </div>

        {/* Average IQS */}
        <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xs">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Average Email IQS</div>
          <div className="text-2xl font-bold text-slate-900 dark:text-white mt-1">
            {summary.avgIqs}%
          </div>
        </div>

        {/* Compliance Pass Rate */}
        <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xs">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Compliance Pass Rate</div>
          <div className="text-2xl font-bold text-slate-900 dark:text-white mt-1">
            {summary.compliancePassRate}%
          </div>
        </div>

        {/* Active Disputes */}
        <div
          onClick={() => { setActiveSection('disputes_pending'); setExpandedEmailId(null); }}
          className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xs cursor-pointer hover:border-slate-300 dark:hover:border-slate-700 transition-colors"
          title="View active disputes"
        >
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Active Disputes</div>
          <div className="text-2xl font-bold text-slate-900 dark:text-white mt-1">
            {sectionCounts.disputesPending}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
            Awaiting TL review
          </div>
        </div>
      </div>

      {/* ── FILTER TOOLBAR ── */}
      <div className="p-2.5 sm:p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs flex items-center gap-2.5 flex-wrap">
        {/* Search Input (Left of Period) */}
        <div className={`relative shrink-0 ${activePersona === 'admin' ? 'w-60 sm:w-64' : 'w-52 sm:w-56'}`}>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={
              activePersona === 'admin'
                ? 'Search RM, AM, TL, ticket, client...'
                : 'Search ticket, client, subject...'
            }
            className="w-full h-9 text-xs px-2.5 py-1.5 pl-7 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
          <span className="absolute left-2.5 top-2.5 text-slate-400 pointer-events-none">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </span>
        </div>

        {/* Period Filter */}
        <PcgPeriodFilter
          range={dateRange}
          start={customStartDate}
          end={customEndDate}
          onChange={handlePeriodChange}
        />

        {/* Min IQS Input */}
        <input
          id="email-min-iqs-input"
          type="number"
          min={0}
          max={100}
          placeholder="Min IQS"
          value={minIqsFilter}
          onChange={(e) => {
            const val = e.target.value;
            if (val === '') {
              setMinIqsFilter('');
            } else {
              const n = parseFloat(val);
              if (!isNaN(n)) {
                if (n < 0) setMinIqsFilter('0');
                else if (n > 100) setMinIqsFilter('100');
                else setMinIqsFilter(val);
              }
            }
          }}
          className={`w-20 h-9 text-xs border rounded-lg px-2.5 py-1.5 outline-none shadow-2xs bg-white dark:bg-slate-950 text-zinc-900 dark:text-white placeholder:text-zinc-400 transition-colors [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${
            minIqsFilter !== ''
              ? 'border-emerald-500 ring-1 ring-emerald-500'
              : 'border-slate-300 dark:border-slate-700 focus:border-emerald-500'
          }`}
        />

        {/* Max IQS Input */}
        <input
          id="email-max-iqs-input"
          type="number"
          min={0}
          max={100}
          placeholder="Max IQS"
          value={maxIqsFilter}
          onChange={(e) => {
            const val = e.target.value;
            if (val === '') {
              setMaxIqsFilter('');
            } else {
              const n = parseFloat(val);
              if (!isNaN(n)) {
                if (n < 0) setMaxIqsFilter('0');
                else if (n > 100) setMaxIqsFilter('100');
                else setMaxIqsFilter(val);
              }
            }
          }}
          className={`w-20 h-9 text-xs border rounded-lg px-2.5 py-1.5 outline-none shadow-2xs bg-white dark:bg-slate-950 text-zinc-900 dark:text-white placeholder:text-zinc-400 transition-colors [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${
            maxIqsFilter !== ''
              ? 'border-emerald-500 ring-1 ring-emerald-500'
              : 'border-slate-300 dark:border-slate-700 focus:border-emerald-500'
          }`}
        />

        {/* Admin Team Filter */}
        {activePersona === 'admin' && (
          <select
            value={selectedTlName}
            onChange={(e) => {
              setSelectedTlName(e.target.value);
              setSelectedRmName('all');
            }}
            className="h-9 text-xs px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white font-medium cursor-pointer shadow-2xs"
          >
            <option value="all">All Teams</option>
            {availableTls.map((tl) => (
              <option key={tl.name} value={tl.name}>
                {tl.name} ({tl.count})
              </option>
            ))}
          </select>
        )}

        {/* Admin Agent Filter (RMs, AMs & TLs) */}
        {activePersona === 'admin' && (
          <select
            value={selectedRmName}
            onChange={(e) => {
              setSelectedRmName(e.target.value);
            }}
            className="h-9 text-xs px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white font-medium cursor-pointer shadow-2xs"
          >
            <option value="all">All Agents (RMs, AMs & TLs)</option>
            {adminAgentList.map((agent) => (
              <option key={agent.name} value={agent.name}>
                {agent.name} {agent.tag ? `(${agent.tag})` : ''} ({agent.count})
              </option>
            ))}
          </select>
        )}

        {/* RM Filter (TL only — strictly RMs only, never AMs) */}
        {activePersona === 'tl' && (
          <select
            value={selectedRmName}
            onChange={(e) => {
              setSelectedRmName(e.target.value);
              if (e.target.value !== 'all') setSelectedAmName('all');
            }}
            className="h-9 text-xs px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white font-medium cursor-pointer shadow-2xs"
          >
            <option value="all">All Relationship Managers</option>
            {rmMembers.map((rm) => (
              <option key={rm.name} value={rm.name}>
                {rm.name} ({rm.count})
              </option>
            ))}
          </select>
        )}

        {/* AM Filter (Strictly for Swetha TL only — strictly AMs mapped to Swetha, never RMs) */}
        {isSwethaTl && (
          <select
            value={selectedAmName}
            onChange={(e) => {
              setSelectedAmName(e.target.value);
              if (e.target.value !== 'all') setSelectedRmName('all');
            }}
            className="h-9 text-xs px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white font-medium cursor-pointer shadow-2xs"
          >
            <option value="all">All Account Managers</option>
            {amMembers.map((am) => (
              <option key={am.name} value={am.name}>
                {am.name} ({am.count})
              </option>
            ))}
          </select>
        )}
      </div>

      {/* ── EMAIL EVALUATION TABLE ── */}
      {(() => {
        const showAgentCol = activePersona === 'tl' || activePersona === 'admin';
        const tableColSpan = showAgentCol ? 8 : 7;
        return (
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className={`w-full ${showAgentCol ? 'min-w-[1040px]' : 'min-w-[960px]'} table-fixed text-left text-xs border-collapse`}>
            <colgroup>
              {showAgentCol ? (
                <>
                  <col className="w-[12%]" />
                  <col className="w-[14%]" />
                  <col className="w-[14%]" />
                  <col className="w-[12%]" />
                  <col className="w-[14%]" />
                  <col className="w-[9%]" />
                  <col className="w-[10%]" />
                  <col className="w-[15%]" />
                </>
              ) : (
                <>
                  <col className="w-[14%]" />
                  <col className="w-[16%]" />
                  <col className="w-[14%]" />
                  <col className="w-[18%]" />
                  <col className="w-[10%]" />
                  <col className="w-[11%]" />
                  <col className="w-[17%]" />
                </>
              )}
            </colgroup>
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 font-semibold uppercase tracking-wider text-[10px]">
                <th className="py-3 px-4 whitespace-nowrap">Ticket ID</th>
                {showAgentCol && <th className="py-3 px-4 whitespace-nowrap">Agent</th>}
                <th className="py-3 px-4 whitespace-nowrap">Customer</th>
                <th className="py-3 px-4 whitespace-nowrap">Sent At</th>
                <th className="py-3 px-4 whitespace-nowrap">Disposition</th>
                <th className="py-3 px-4 whitespace-nowrap text-center">IQS Score</th>
                <th className="py-3 px-4 whitespace-nowrap text-center">Compliance</th>
                <th className="py-3 px-4 whitespace-nowrap text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-700 dark:text-slate-300">
              {loading ? (
                <tr>
                  <td colSpan={tableColSpan} className="py-8 text-center text-slate-400">
                    Loading PCG email evaluations...
                  </td>
                </tr>
              ) : filteredEmails.length === 0 ? (
                <tr>
                  <td colSpan={tableColSpan} className="py-8 text-center text-slate-400">
                    No email evaluations match the selected criteria.
                  </td>
                </tr>
              ) : (
                filteredEmails.map((email) => {
                  const isExpanded = expandedEmailId === email.id;

                  return (
                    <React.Fragment key={email.id}>
                      <tr
                        onClick={() => setExpandedEmailId(isExpanded ? null : email.id)}
                        className={`hover:bg-slate-50/80 dark:hover:bg-slate-800/60 cursor-pointer transition-colors ${
                          isExpanded ? 'bg-slate-50/60 dark:bg-slate-800/40 font-medium' : ''
                        }`}
                      >
                        {/* Ticket ID */}
                        <td className="py-3 px-4 whitespace-nowrap">
                          {(() => {
                            const effectiveId = (email.chatId && String(email.chatId).trim() !== '')
                              ? String(email.chatId).trim()
                              : email.ticketId;
                            const effectiveLabel = (email.chatId && String(email.chatId).trim() !== '')
                              ? String(email.chatId).trim()
                              : (email.ticketId.length > 12 ? `${email.ticketId.slice(0, 8)}…` : email.ticketId);
                            return (
                              <TicketLinkButton
                                id={effectiveId}
                                label={effectiveLabel}
                              />
                            );
                          })()}
                        </td>

                        {/* Agent (TL & Admin dashboards) */}
                        {showAgentCol && (
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-semibold text-slate-900 dark:text-slate-100 truncate" title={email.rmName}>
                                {email.rmName}
                              </span>
                              {(email.isAm || isPcgAm(email.rmName)) && (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800 tracking-wide">
                                  AM
                                </span>
                              )}
                              {(email.isTl || isPcgTl(email.rmName)) && (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800 tracking-wide">
                                  TL
                                </span>
                              )}
                            </div>
                          </td>
                        )}

                        {/* Customer */}
                        <td className="py-3 px-4">
                          <div className="font-medium text-slate-800 dark:text-slate-200 truncate">
                            {email.customerName}
                          </div>
                        </td>

                        {/* Sent At */}
                        <td className="py-3 px-4 text-slate-500 whitespace-nowrap">
                          {new Date(email.sentAt).toLocaleDateString('en-IN', {
                            day: 'numeric',
                            month: 'short',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </td>

                        {/* Disposition */}
                        <td className="py-3 px-4">
                          <div
                            className="text-slate-700 dark:text-slate-300 truncate"
                            title={intentLabel(email.intentL1)}
                          >
                            {intentLabel(email.intentL1)}
                          </div>
                        </td>

                        {/* IQS Score */}
                        <td className="py-3 px-4 whitespace-nowrap text-center">
                          <span className="inline-flex items-center justify-center font-bold text-xs px-2.5 py-0.5 rounded-md border border-zinc-200 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 tabular-nums">
                            {email.iqsScore}%
                          </span>
                        </td>

                        {/* Compliance */}
                        <td className="py-3 px-4 whitespace-nowrap text-center">
                          <span
                            className={`inline-flex items-center justify-center px-2 py-0.5 rounded text-[10px] font-bold border ${
                              email.compliancePassed
                                ? 'bg-zinc-100 text-zinc-700 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700'
                                : 'bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800'
                            }`}
                          >
                            {email.compliancePassed ? 'PASS' : 'FAIL'}
                          </span>
                        </td>

                        {/* Action */}
                        <td className="py-3 px-4 whitespace-nowrap text-right">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setExpandedEmailId(isExpanded ? null : email.id);
                            }}
                            className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all inline-flex items-center gap-1.5 ${
                              isExpanded
                                ? 'bg-zinc-800 text-white'
                                : 'bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200'
                            }`}
                          >
                            <span>{isExpanded ? 'Hide' : 'View Evaluation'}</span>
                            <span className="text-[9px] opacity-70">{isExpanded ? '▲' : '▼'}</span>
                          </button>
                        </td>
                      </tr>

                      {/* Inline Expanded Panel */}
                      {isExpanded && (
                        <PcgEmailEvalPanel
                          email={email}
                          colSpan={tableColSpan}
                          onClose={() => setExpandedEmailId(null)}
                          onDisputeUpdate={fetchEmails}
                          userRole={activePersona}
                          allowRaiseDispute={activePersona === 'agent'}
                        />
                      )}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
        );
      })()}
    </div>
  );
}
