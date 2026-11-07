'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export type IrChannel = 'calls' | 'chats' | 'emails';

export interface IrPerformanceItem {
  id: string;
  name: string;
  ini: string;
  tl?: string;
  currentIqs: number;
  current14dIqs: number;
  prev2WkIqs: number;
  delta2Wk: number;
  volume: number;
  focusArea: string;
  offHoursClientTotal: number;
  offHoursClientAnswered: number;
  offHoursPickupRate: number;
}

export interface CxIrPerformanceProps {
  onSelectAgent?: (agentName: string, channel?: IrChannel) => void;
  onOpenScorecard?: (agentName: string, channel?: IrChannel) => void;
  irScorecards?: Array<{
    agentName?: string;
    rmName?: string;
    totalCalls?: number;
    totalVolume?: number;
    periodVolume?: number;
    periodIqs?: number;
    channel?: IrChannel;
    connectRate?: number;
    overallScore: number;
    trend?: string;
    complianceFlags?: number;
    topWeakness?: string;
    current14dIqs?: number;
    prev2WkIqs?: number;
    delta2Wk?: number;
    offHoursClientTotal?: number;
    offHoursClientAnswered?: number;
    offHoursPickupRate?: number;
    clientTotalCalls?: number;
    clientAnsweredCalls?: number;
    clientPickupRate?: number;
    tl?: string;
  }>;
  teamLeads?: Array<{
    tlName: string;
    agents?: string[];
    rms?: string[];
  }>;
  initialChannel?: IrChannel;
  initialPeriod?: string;
}

export default function CxIrPerformanceDashboard({
  onSelectAgent,
  onOpenScorecard,
  irScorecards: propScorecards,
  teamLeads: propTeamLeads,
  initialChannel = 'calls',
  initialPeriod = '7d',
}: CxIrPerformanceProps) {
  const router = useRouter();

  const [selectedChannel, setSelectedChannel] = useState<IrChannel>(initialChannel);
  const [period, setPeriod] = useState<string>(initialPeriod);
  const [customFrom, setCustomFrom] = useState<string>(() => {
    const d = new Date(Date.now() - 7 * 86400000);
    return d.toISOString().split('T')[0];
  });
  const [customTo, setCustomTo] = useState<string>(() => {
    return new Date().toISOString().split('T')[0];
  });

  const [loading, setLoading] = useState(!propScorecards);
  const [error, setError] = useState<string | null>(null);
  const [loadedScorecards, setLoadedScorecards] = useState<any[]>(propScorecards || []);
  const [loadedTeamLeads, setLoadedTeamLeads] = useState<any[]>(propTeamLeads || []);
  const [channelsData, setChannelsData] = useState<{
    calls: any[];
    chats: any[];
    emails: any[];
  }>({
    calls: [],
    chats: [],
    emails: [],
  });

  const fetchPerformanceData = useCallback((p: string, from?: string, to?: string) => {
    setLoading(true);
    setError(null);
    const qs = new URLSearchParams({ period: p });
    if (p === 'custom' && from && to) {
      qs.set('from', from);
      qs.set('to', to);
    }
    fetch(`/api/cx/admin/ir-performance?${qs.toString()}`)
      .then((r) => {
        if (!r.ok) throw new Error('Failed to load IR performance data');
        return r.json();
      })
      .then((data) => {
        if (data.channels) {
          setChannelsData({
            calls: data.channels.calls?.irScorecards || [],
            chats: data.channels.chats?.irScorecards || [],
            emails: data.channels.emails?.irScorecards || [],
          });
        } else {
          setChannelsData({
            calls: data.irScorecards || [],
            chats: [],
            emails: [],
          });
        }
        setLoadedScorecards(data.irScorecards || []);
        setLoadedTeamLeads(data.teamLeads || []);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!propScorecards) {
      fetchPerformanceData(period, period === 'custom' ? customFrom : undefined, period === 'custom' ? customTo : undefined);
    }
  }, [propScorecards, period, fetchPerformanceData, customFrom, customTo]);

  const handlePeriodChange = (newPeriod: string) => {
    setPeriod(newPeriod);
    if (newPeriod !== 'custom') {
      fetchPerformanceData(newPeriod);
    }
  };

  const handleApplyCustomDates = () => {
    if (customFrom && customTo) {
      fetchPerformanceData('custom', customFrom, customTo);
    }
  };

  const activeScorecards = propScorecards && propScorecards.length > 0
    ? propScorecards
    : (channelsData[selectedChannel] && channelsData[selectedChannel].length > 0)
    ? channelsData[selectedChannel]
    : loadedScorecards;

  const activeTeamLeads = propTeamLeads || loadedTeamLeads;

  const handleSelectAgent = (name: string) => {
    if (onSelectAgent) {
      onSelectAgent(name, selectedChannel);
    } else {
      router.push(`/tl/member-analytics?agent=${encodeURIComponent(name)}&channel=${selectedChannel}`);
    }
  };

  const handleOpenScorecard = (name: string) => {
    if (onOpenScorecard) {
      onOpenScorecard(name, selectedChannel);
    } else {
      router.push(`/tl/reports?agent=${encodeURIComponent(name)}&channel=${selectedChannel}`);
    }
  };

  const agentsList: IrPerformanceItem[] = (activeScorecards && activeScorecards.length > 0)
    ? activeScorecards.map((sc) => {
        const name = sc.agentName || sc.rmName || 'Agent';
        const foundTl = activeTeamLeads?.find((t) =>
          (t.agents || t.rms)?.some((r: string) => r.toLowerCase().trim() === name.toLowerCase().trim())
        );
        const tl = sc.tl || (foundTl ? foundTl.tlName.replace(/^team\s+/i, '').trim() : '');
        const parts = name.trim().split(/\s+/);
        const ini = parts.length > 1
          ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
          : parts[0].slice(0, 2).toUpperCase();

        const vol = Number(sc.periodVolume ?? sc.totalVolume ?? sc.totalCalls ?? 0);
        const currentIqs = Math.round(sc.periodIqs ?? sc.overallScore ?? sc.currentIqs ?? 0);
        const current14d = Math.round(sc.current14dIqs ?? sc.overallScore ?? 0);
        const prior14d = Math.round(sc.prev2WkIqs ?? current14d);

        return {
          id: `ir-${name.toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
          name,
          ini,
          tl,
          currentIqs,
          current14dIqs: current14d,
          prev2WkIqs: prior14d,
          delta2Wk: sc.delta2Wk ?? 0,
          volume: vol,
          focusArea: sc.topWeakness || '—',
          offHoursClientTotal: sc.offHoursClientTotal || 0,
          offHoursClientAnswered: sc.offHoursClientAnswered || 0,
          offHoursPickupRate: sc.offHoursPickupRate || 0,
        };
      })
    : [];

  // 1. Top Performers (Top 5 by IQS score within the selected period; tie-breaker: volume in period)
  const topPerformers = [...agentsList]
    .filter((a) => a.currentIqs > 0 && a.volume > 0)
    .sort((a, b) => {
      if (b.currentIqs !== a.currentIqs) return b.currentIqs - a.currentIqs;
      return b.volume - a.volume;
    })
    .slice(0, 5);

  // 2. Bottom Performers (anyone with an IQS score of 70% or below in the period; tie-breaker: lowest score first, then volume)
  const bottomPerformers = [...agentsList]
    .filter((a) => a.currentIqs > 0 && a.volume > 0 && a.currentIqs <= 70.0)
    .sort((a, b) => {
      if (a.currentIqs !== b.currentIqs) return a.currentIqs - b.currentIqs;
      return b.volume - a.volume;
    })
    .slice(0, 5);

  // 3. Most Improved (Always on a 14-day rolling window basis: delta2Wk = curr_14d - prior_14d)
  let mostImproved = [...agentsList]
    .filter((a) => a.delta2Wk > 0)
    .sort((a, b) => {
      if (Math.abs(b.delta2Wk - a.delta2Wk) > 0.05) return b.delta2Wk - a.delta2Wk;
      return b.current14dIqs - a.current14dIqs;
    })
    .slice(0, 5);

  if (mostImproved.length === 0) {
    mostImproved = [...agentsList]
      .sort((a, b) => b.delta2Wk - a.delta2Wk)
      .slice(0, 5);
  }

  const channelLabel = selectedChannel === 'calls'
    ? 'Calls'
    : selectedChannel === 'chats'
    ? 'Chats'
    : 'Emails';

  const volumeUnit = selectedChannel === 'calls'
    ? 'calls'
    : selectedChannel === 'chats'
    ? 'chats'
    : 'emails';

  const channelBadgeStyles = selectedChannel === 'calls'
    ? { background: '#ecfdf5', color: '#065f46', border: '1px solid #a7f3d0' }
    : selectedChannel === 'chats'
    ? { background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe' }
    : { background: '#f5f3ff', color: '#6d28d9', border: '1px solid #ddd6fe' };

  const periodDisplayLabel = (() => {
    if (period === '7d') return 'Last 7 Days';
    if (period === '14d') return 'Last 14 Days';
    if (period === '30d') return 'Last 30 Days';
    if (period === '90d') return 'Last 90 Days';
    if (period === 'all') return 'All Time';
    if (period === 'custom' && customFrom && customTo) return `${customFrom} to ${customTo}`;
    return 'Last 7 Days';
  })();

  if (loading) {
    return (
      <div style={{ fontFamily: 'Inter, sans-serif', maxWidth: 1280, margin: '0 auto', padding: '16px 0', color: '#18181b' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 24, paddingBottom: 16, borderBottom: '1px solid #e4e4e7' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ height: 26, width: 160, background: '#e4e4e7', borderRadius: 6 }} className="animate-pulse" />
            <div style={{ height: 20, width: 90, background: '#e4e4e7', borderRadius: 6 }} className="animate-pulse" />
            <div style={{ height: 20, width: 180, background: '#e4e4e7', borderRadius: 6 }} className="animate-pulse" />
          </div>
          <div style={{ height: 34, width: 340, background: '#e4e4e7', borderRadius: 8 }} className="animate-pulse" />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20 }}>
          {[1, 2, 3].map((i) => (
            <div key={i} style={{ background: '#ffffff', border: '1px solid #e4e4e7', borderRadius: 12, height: 320, padding: 18 }} className="animate-pulse">
              <div style={{ height: 16, width: 120, background: '#f4f4f5', borderRadius: 4, marginBottom: 16 }} />
              <div className="space-y-3">
                {[1, 2, 3, 4, 5].map((j) => (
                  <div key={j} style={{ height: 38, background: '#fafafa', borderRadius: 8, marginBottom: 8 }} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: 24 }}>
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: 16, color: '#991b1b', fontSize: 13 }}>
          <strong>Error loading IR Performance:</strong> {error}
        </div>
      </div>
    );
  }

  return (
    <div style={{ fontFamily: 'Inter, sans-serif', maxWidth: 1280, margin: '0 auto', color: '#18181b' }}>
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16, marginBottom: 24, borderBottom: '1px solid #e4e4e7', paddingBottom: 16 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, color: '#18181b', letterSpacing: '-0.02em' }}>
              IR Performance
            </h1>
            <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', padding: '2px 8px', borderRadius: 6, ...channelBadgeStyles }}>
              {channelLabel} Channel
            </span>
            <span style={{ fontSize: 11, fontWeight: 600, background: '#f4f4f5', color: '#3f3f46', border: '1px solid #e4e4e7', padding: '2px 8px', borderRadius: 6 }}>
              Top & Bottom: {periodDisplayLabel}
            </span>
            <span style={{ fontSize: 11, fontWeight: 600, background: '#ecfdf5', color: '#065f46', border: '1px solid #a7f3d0', padding: '2px 8px', borderRadius: 6 }}>
              Most Improved: 14D Rolling Window
            </span>
          </div>
          <p style={{ fontSize: 13, color: '#71717a', margin: '6px 0 0 0' }}>
            Top & bottom performers ranked for <strong>{periodDisplayLabel}</strong> · Most improved tracks continuous 14-day rolling gains.
          </p>
        </div>

        {/* ── Controls: Date Range Filter + Channel Selector ─────────────── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          {/* DATE RANGE FILTER */}
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#71717a' }}>Period:</span>
            <select
              value={period}
              onChange={(e) => handlePeriodChange(e.target.value)}
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: '#18181b',
                background: '#ffffff',
                border: '1px solid #e4e4e7',
                borderRadius: 8,
                padding: '6px 12px',
                cursor: 'pointer',
                outline: 'none',
                boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
              }}
            >
              <option value="7d">Last 7 Days</option>
              <option value="14d">Last 14 Days</option>
              <option value="30d">Last 30 Days</option>
              <option value="90d">Last 90 Days</option>
              <option value="all">All Time</option>
              <option value="custom">Custom Range...</option>
            </select>
          </div>

          {/* CUSTOM DATE INPUTS */}
          {period === 'custom' && (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#fafafa', padding: '4px 8px', borderRadius: 8, border: '1px solid #e4e4e7' }}>
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                style={{
                  fontSize: 12,
                  padding: '4px 6px',
                  border: '1px solid #d4d4d8',
                  borderRadius: 6,
                  outline: 'none',
                  background: '#ffffff',
                  color: '#18181b',
                }}
              />
              <span style={{ fontSize: 12, color: '#71717a' }}>to</span>
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                style={{
                  fontSize: 12,
                  padding: '4px 6px',
                  border: '1px solid #d4d4d8',
                  borderRadius: 6,
                  outline: 'none',
                  background: '#ffffff',
                  color: '#18181b',
                }}
              />
              <button
                type="button"
                onClick={handleApplyCustomDates}
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  padding: '5px 10px',
                  background: '#18181b',
                  color: '#ffffff',
                  borderRadius: 6,
                  border: 'none',
                  cursor: 'pointer',
                  transition: 'background 0.15s ease',
                }}
              >
                Apply
              </button>
            </div>
          )}

          {/* CHANNEL TABS SELECTOR (Calls, Chats, Emails) */}
          <div style={{ display: 'inline-flex', alignItems: 'center', background: '#f4f4f5', padding: 3, borderRadius: 8, border: '1px solid #e4e4e7', gap: 2 }}>
            {/* CALLS TAB */}
            <button
              type="button"
              onClick={() => setSelectedChannel('calls')}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 13px',
                fontSize: 12,
                fontWeight: selectedChannel === 'calls' ? 600 : 500,
                borderRadius: 6,
                border: 'none',
                cursor: 'pointer',
                background: selectedChannel === 'calls' ? '#ffffff' : 'transparent',
                color: selectedChannel === 'calls' ? '#18181b' : '#71717a',
                boxShadow: selectedChannel === 'calls' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                transition: 'all 0.15s ease',
              }}
            >
              <svg style={{ width: 13, height: 13 }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
              </svg>
              <span>Calls</span>
              {channelsData.calls.length > 0 && (
                <span style={{
                  fontSize: 10,
                  fontWeight: 600,
                  background: selectedChannel === 'calls' ? '#ecfdf5' : '#e4e4e7',
                  color: selectedChannel === 'calls' ? '#065f46' : '#71717a',
                  padding: '1px 5px',
                  borderRadius: 10,
                }}>
                  {channelsData.calls.length}
                </span>
              )}
            </button>

            {/* CHATS TAB */}
            <button
              type="button"
              onClick={() => setSelectedChannel('chats')}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 13px',
                fontSize: 12,
                fontWeight: selectedChannel === 'chats' ? 600 : 500,
                borderRadius: 6,
                border: 'none',
                cursor: 'pointer',
                background: selectedChannel === 'chats' ? '#ffffff' : 'transparent',
                color: selectedChannel === 'chats' ? '#18181b' : '#71717a',
                boxShadow: selectedChannel === 'chats' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                transition: 'all 0.15s ease',
              }}
            >
              <svg style={{ width: 13, height: 13 }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
              <span>Chats</span>
              {channelsData.chats.length > 0 && (
                <span style={{
                  fontSize: 10,
                  fontWeight: 600,
                  background: selectedChannel === 'chats' ? '#eff6ff' : '#e4e4e7',
                  color: selectedChannel === 'chats' ? '#1d4ed8' : '#71717a',
                  padding: '1px 5px',
                  borderRadius: 10,
                }}>
                  {channelsData.chats.length}
                </span>
              )}
            </button>

            {/* EMAILS TAB */}
            <button
              type="button"
              onClick={() => setSelectedChannel('emails')}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 13px',
                fontSize: 12,
                fontWeight: selectedChannel === 'emails' ? 600 : 500,
                borderRadius: 6,
                border: 'none',
                cursor: 'pointer',
                background: selectedChannel === 'emails' ? '#ffffff' : 'transparent',
                color: selectedChannel === 'emails' ? '#18181b' : '#71717a',
                boxShadow: selectedChannel === 'emails' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                transition: 'all 0.15s ease',
              }}
            >
              <svg style={{ width: 13, height: 13 }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              <span>Emails</span>
              {channelsData.emails.length > 0 && (
                <span style={{
                  fontSize: 10,
                  fontWeight: 600,
                  background: selectedChannel === 'emails' ? '#f5f3ff' : '#e4e4e7',
                  color: selectedChannel === 'emails' ? '#6d28d9' : '#71717a',
                  padding: '1px 5px',
                  borderRadius: 10,
                }}>
                  {channelsData.emails.length}
                </span>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* ── 3 CATEGORIES GRID ────────────────────────────────────────────── */}
      {agentsList.length === 0 ? (
        <div style={{ background: '#ffffff', border: '1px solid #e4e4e7', borderRadius: 12, padding: 48, textAlign: 'center' }}>
          <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: '#71717a' }}>No {channelLabel.toLowerCase()} evaluations found for {periodDisplayLabel}.</p>
          <p style={{ margin: '6px 0 0 0', fontSize: 12, color: '#a1a1aa' }}>Try selecting a wider date range like Last 30 Days or All Time.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20 }}>
          {/* =================================================================== */}
          {/* 1. TOP PERFORMERS (FILTERED BY SELECTED PERIOD)                     */}
          {/* =================================================================== */}
          <div style={{ background: '#ffffff', border: '1px solid #e4e4e7', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid #e4e4e7', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#fafafa' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#059669' }}></span>
                <h2 style={{ fontSize: 14, fontWeight: 700, margin: 0, color: '#18181b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Top Performers
                </h2>
              </div>
              <span style={{ fontSize: 11, fontWeight: 600, background: '#ecfdf5', color: '#065f46', border: '1px solid #a7f3d0', padding: '2px 7px', borderRadius: 6 }}>
                Top 5 · {periodDisplayLabel}
              </span>
            </div>

            <div>
              {topPerformers.length === 0 ? (
                <div style={{ padding: '36px 18px', textAlign: 'center', color: '#71717a' }}>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>No evaluations in {periodDisplayLabel}</p>
                </div>
              ) : (
                topPerformers.map((agent, idx) => {
                  const rankIcons = ['🥇', '🥈', '🥉', '#4', '#5'];
                  return (
                    <div
                      key={agent.id}
                      onClick={() => handleSelectAgent(agent.name)}
                      style={{
                        padding: '14px 18px',
                        borderBottom: idx < topPerformers.length - 1 ? '1px solid #f4f4f5' : 'none',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 12,
                        cursor: 'pointer',
                        transition: 'background 0.15s ease',
                      }}
                      className="hover:bg-zinc-50"
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
                        <span style={{ fontSize: idx < 3 ? 15 : 12, fontWeight: 700, color: '#71717a', width: 22, textAlign: 'center', flexShrink: 0 }}>
                          {rankIcons[idx]}
                        </span>
                        <div style={{ width: 34, height: 34, borderRadius: '50%', background: '#e4e4e7', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#3f3f46', flexShrink: 0 }}>
                          {agent.ini}
                        </div>
                        <div style={{ minWidth: 0, flex: 1, overflow: 'hidden' }}>
                          <div
                            style={{
                              fontSize: 13,
                              fontWeight: 600,
                              color: '#18181b',
                              lineHeight: '18px',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            }}
                            title={agent.name}
                          >
                            {agent.name}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#71717a', marginTop: 2, flexWrap: 'wrap' }}>
                            {agent.tl ? (
                              <span style={{ fontSize: 10, fontWeight: 600, color: '#52525b', background: '#f4f4f5', padding: '1px 5px', borderRadius: 4, flexShrink: 0 }}>
                                {agent.tl.startsWith('Team ') ? agent.tl : `Team ${agent.tl}`}
                              </span>
                            ) : null}
                            <span>{agent.volume} {volumeUnit}</span>
                          </div>
                        </div>
                      </div>

                      <div style={{ textAlign: 'right', flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
                        <div style={{ fontSize: 16, fontWeight: 700, fontFamily: 'monospace', color: '#059669' }}>
                          {agent.currentIqs}%
                        </div>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenScorecard(agent.name);
                          }}
                          style={{
                            fontSize: 10,
                            fontWeight: 600,
                            color: '#2563eb',
                            background: '#eff6ff',
                            border: '1px solid #bfdbfe',
                            borderRadius: 5,
                            padding: '2px 7px',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 2,
                            cursor: 'pointer',
                            transition: 'all 0.15s ease',
                            whiteSpace: 'nowrap',
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = '#dbeafe';
                            e.currentTarget.style.color = '#1d4ed8';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = '#eff6ff';
                            e.currentTarget.style.color = '#2563eb';
                          }}
                        >
                          Show Scorecard →
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* =================================================================== */}
          {/* 2. BOTTOM PERFORMERS (FILTERED BY SELECTED PERIOD)                  */}
          {/* =================================================================== */}
          <div style={{ background: '#ffffff', border: '1px solid #e4e4e7', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid #e4e4e7', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#fafafa' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#dc2626' }}></span>
                <h2 style={{ fontSize: 14, fontWeight: 700, margin: 0, color: '#18181b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Bottom Performers
                </h2>
              </div>
              <span style={{ fontSize: 11, fontWeight: 600, background: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca', padding: '2px 7px', borderRadius: 6 }}>
                IQS ≤ 70% · {periodDisplayLabel}
              </span>
            </div>

            <div>
              {bottomPerformers.length === 0 ? (
                <div style={{ padding: '36px 18px', textAlign: 'center', color: '#71717a' }}>
                  <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#ecfdf5', color: '#059669', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 700, marginBottom: 8 }}>
                    ✓
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#18181b', marginBottom: 2 }}>
                    No IR Executives Scoring ≤ 70%
                  </div>
                  <div style={{ fontSize: 11, color: '#71717a' }}>
                    All active team members met or exceeded the 70% benchmark in {periodDisplayLabel}.
                  </div>
                </div>
              ) : (
                bottomPerformers.map((agent, idx) => {
                  return (
                    <div
                      key={agent.id}
                      onClick={() => handleSelectAgent(agent.name)}
                      style={{
                        padding: '14px 18px',
                        borderBottom: idx < bottomPerformers.length - 1 ? '1px solid #f4f4f5' : 'none',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 12,
                        cursor: 'pointer',
                        transition: 'background 0.15s ease',
                      }}
                      className="hover:bg-zinc-50"
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: '#71717a', width: 22, textAlign: 'center', flexShrink: 0 }}>
                          #{idx + 1}
                        </span>
                        <div style={{ width: 34, height: 34, borderRadius: '50%', background: '#fee2e2', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#991b1b', flexShrink: 0 }}>
                          {agent.ini}
                        </div>
                        <div style={{ minWidth: 0, flex: 1, overflow: 'hidden' }}>
                          <div
                            style={{
                              fontSize: 13,
                              fontWeight: 600,
                              color: '#18181b',
                              lineHeight: '18px',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            }}
                            title={agent.name}
                          >
                            {agent.name}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#71717a', marginTop: 2, flexWrap: 'wrap' }}>
                            {agent.tl ? (
                              <span style={{ fontSize: 10, fontWeight: 600, color: '#52525b', background: '#f4f4f5', padding: '1px 5px', borderRadius: 4, flexShrink: 0 }}>
                                {agent.tl.startsWith('Team ') ? agent.tl : `Team ${agent.tl}`}
                              </span>
                            ) : null}
                            <span style={{ color: '#dc2626', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={`Focus: ${agent.focusArea}`}>
                              Focus: {agent.focusArea}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div style={{ textAlign: 'right', flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
                        <div style={{ fontSize: 16, fontWeight: 700, fontFamily: 'monospace', color: '#dc2626' }}>
                          {agent.currentIqs}%
                        </div>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenScorecard(agent.name);
                          }}
                          style={{
                            fontSize: 10,
                            fontWeight: 600,
                            color: '#2563eb',
                            background: '#eff6ff',
                            border: '1px solid #bfdbfe',
                            borderRadius: 5,
                            padding: '2px 7px',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 2,
                            cursor: 'pointer',
                            transition: 'all 0.15s ease',
                            whiteSpace: 'nowrap',
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = '#dbeafe';
                            e.currentTarget.style.color = '#1d4ed8';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = '#eff6ff';
                            e.currentTarget.style.color = '#2563eb';
                          }}
                        >
                          Show Scorecard →
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* =================================================================== */}
          {/* 3. MOST IMPROVED (CONTINUOUS 14-DAY ROLLING WINDOW BASIS)            */}
          {/* =================================================================== */}
          <div style={{ background: '#ffffff', border: '1px solid #e4e4e7', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid #e4e4e7', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#fafafa' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#059669' }}></span>
                <h2 style={{ fontSize: 14, fontWeight: 700, margin: 0, color: '#18181b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Most Improved
                </h2>
              </div>
              <span style={{ fontSize: 11, fontWeight: 600, background: '#ecfdf5', color: '#065f46', border: '1px solid #a7f3d0', padding: '2px 7px', borderRadius: 6 }}>
                2-Wk Rolling Diff
              </span>
            </div>

            <div>
              {mostImproved.map((agent, idx) => {
                const isPositive = agent.delta2Wk >= 0;
                return (
                  <div
                    key={agent.id}
                    onClick={() => handleSelectAgent(agent.name)}
                    style={{
                      padding: '14px 18px',
                      borderBottom: idx < mostImproved.length - 1 ? '1px solid #f4f4f5' : 'none',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 12,
                      cursor: 'pointer',
                      transition: 'background 0.15s ease',
                    }}
                    className="hover:bg-zinc-50"
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: '#71717a', width: 22, textAlign: 'center', flexShrink: 0 }}>
                        #{idx + 1}
                      </span>
                      <div style={{ width: 34, height: 34, borderRadius: '50%', background: '#d1fae5', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#065f46', flexShrink: 0 }}>
                        {agent.ini}
                      </div>
                      <div style={{ minWidth: 0, flex: 1, overflow: 'hidden' }}>
                        <div
                          style={{
                            fontSize: 13,
                            fontWeight: 600,
                            color: '#18181b',
                            lineHeight: '18px',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                          title={agent.name}
                        >
                          {agent.name}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#71717a', marginTop: 2, flexWrap: 'wrap' }}>
                          {agent.tl ? (
                            <span style={{ fontSize: 10, fontWeight: 600, color: '#52525b', background: '#f4f4f5', padding: '1px 5px', borderRadius: 4, flexShrink: 0 }}>
                              {agent.tl.startsWith('Team ') ? agent.tl : `Team ${agent.tl}`}
                            </span>
                          ) : null}
                          <span>
                            {agent.prev2WkIqs}% → <strong style={{ color: '#18181b' }}>{agent.current14dIqs}%</strong>
                          </span>
                        </div>
                      </div>
                    </div>

                    <div style={{ textAlign: 'right', flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
                      <div style={{ fontSize: 15, fontWeight: 700, fontFamily: 'monospace', color: '#059669', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 2 }}>
                        <span>{isPositive ? '↑' : '↓'}</span>
                        <span>{isPositive ? `+${agent.delta2Wk.toFixed(1)}%` : `${agent.delta2Wk.toFixed(1)}%`}</span>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenScorecard(agent.name);
                        }}
                        style={{
                          fontSize: 10,
                          fontWeight: 600,
                          color: '#2563eb',
                          background: '#eff6ff',
                          border: '1px solid #bfdbfe',
                          borderRadius: 5,
                          padding: '2px 7px',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 2,
                          cursor: 'pointer',
                          transition: 'all 0.15s ease',
                          whiteSpace: 'nowrap',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = '#dbeafe';
                          e.currentTarget.style.color = '#1d4ed8';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = '#eff6ff';
                          e.currentTarget.style.color = '#2563eb';
                        }}
                      >
                        Show Scorecard →
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── Footer Explanatory Note ────────────────────────────────────── */}
      <div style={{ marginTop: 28, padding: '14px 18px', background: '#ffffff', border: '1px solid #e4e4e7', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <p style={{ margin: 0, fontSize: 12, color: '#71717a' }}>
          <strong>Ranking Methodology:</strong> Top and bottom performers are ranked according to average IQS within <strong>{periodDisplayLabel}</strong> on the {channelLabel} channel. Most Improved continuously tracks the top 5 net score gainers over a 14-day rolling window regardless of the selected period filter.
        </p>
        <span style={{ fontSize: 11, color: '#a1a1aa' }}>
          Channel: {channelLabel} · Period: {periodDisplayLabel}
        </span>
      </div>
    </div>
  );
}
