'use client';

import React from 'react';

export interface RmPerformanceItem {
  id: string;
  name: string;
  ini: string;
  tl?: string;
  currentIqs: number;
  prev2WkIqs: number;
  delta2Wk: number;
  callsVolume: number;
  focusArea: string;
  improvementDriver?: string;
  offHoursClientTotal: number;
  offHoursClientAnswered: number;
  offHoursPickupRate: number;
}

interface PcgRmPerformanceProps {
  activePersona?: 'admin' | 'tl' | 'agent';
  onSelectRm?: (rmName: string) => void;
  onOpenScorecard?: (rmName: string) => void;
  rmScorecards?: Array<{
    rmName: string;
    totalCalls: number;
    connectRate: number;
    overallScore: number;
    trend: string;
    complianceFlags: number;
    topWeakness: string;
    prev2WkIqs?: number;
    delta2Wk?: number;
    offHoursClientTotal?: number;
    offHoursClientAnswered?: number;
    offHoursPickupRate?: number;
    clientTotalCalls?: number;
    clientAnsweredCalls?: number;
    clientPickupRate?: number;
  }>;
  teamLeads?: Array<{
    tlName: string;
    rms: string[];
  }>;
}

export default function PcgRmPerformanceDashboard({
  activePersona = 'admin',
  onSelectRm,
  onOpenScorecard,
  rmScorecards = [],
  teamLeads = [],
}: PcgRmPerformanceProps) {
  // Exclusion list of known Admins, TLs, and non-RM entities
  const tlNamesSet = new Set((teamLeads || []).map(t => t.tlName.toLowerCase().replace(/^team\s+/i, '').trim()));
  const nonRmSet = new Set([
    'aahan thaker',
    'aahan',
    'dheeraj bhojwani',
    'saiyam rastogi',
    'tanisha mittal',
    'swetha',
    'swetha jayakumar',
    'gokul_admin',
    'gokul',
    'unknown rm',
    'unknown',
  ]);

  const rmsList: RmPerformanceItem[] = (rmScorecards && rmScorecards.length > 0)
    ? rmScorecards
        .filter((sc) => {
          const clean = sc.rmName.trim().toLowerCase();
          const cleanNoTeam = clean.replace(/^team\s+/i, '').trim();
          if (
            nonRmSet.has(clean) ||
            nonRmSet.has(cleanNoTeam) ||
            tlNamesSet.has(clean) ||
            tlNamesSet.has(cleanNoTeam) ||
            clean.includes('admin') ||
            clean === 'unknown rm'
          ) {
            return false;
          }
          return true;
        })
        .map((sc) => {
          const cleanScName = sc.rmName.trim().toLowerCase();
          const foundTl = teamLeads?.find(t =>
            t.rms?.some(r => r.toLowerCase().trim() === cleanScName)
          );
          const tl = foundTl ? foundTl.tlName.replace(/^team\s+/i, '').trim() : '';
          const parts = sc.rmName.trim().split(/\s+/);
          const ini = parts.length > 1
            ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
            : parts[0].slice(0, 2).toUpperCase();
          return {
            id: `rm-${sc.rmName.toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
            name: sc.rmName,
            ini,
            tl,
            currentIqs: sc.overallScore || 0,
            prev2WkIqs: sc.prev2WkIqs ?? sc.overallScore ?? 0,
            delta2Wk: sc.delta2Wk ?? 0,
            callsVolume: sc.totalCalls,
            focusArea: sc.topWeakness || '—',
            improvementDriver: undefined,
            offHoursClientTotal: sc.offHoursClientTotal || 0,
            offHoursClientAnswered: sc.offHoursClientAnswered || 0,
            offHoursPickupRate: sc.offHoursPickupRate || 0,
          };
        })
    : [];

  // 1. Top Performers (Top 5 by IQS score across the whole PCG department; tie-breaker: calls volume)
  const topPerformers = [...rmsList]
    .filter((rm) => rm.currentIqs > 0)
    .sort((a, b) => {
      if (b.currentIqs !== a.currentIqs) return b.currentIqs - a.currentIqs;
      return b.callsVolume - a.callsVolume;
    })
    .slice(0, 5);

  // 2. Bottom Performers (anyone with an IQS score of 70% or below across the whole PCG department; tie-breaker: calls volume)
  const bottomPerformers = [...rmsList]
    .filter((rm) => rm.currentIqs > 0 && rm.currentIqs <= 70.0)
    .sort((a, b) => {
      if (a.currentIqs !== b.currentIqs) return a.currentIqs - b.currentIqs;
      return b.callsVolume - a.callsVolume;
    })
    .slice(0, 5);

  // 3. Most Improved (Top 5 net gainers across the whole PCG department)
  let mostImproved = [...rmsList]
    .filter((rm) => rm.delta2Wk > 0)
    .sort((a, b) => {
      if (Math.abs(b.delta2Wk - a.delta2Wk) > 0.05) return b.delta2Wk - a.delta2Wk;
      return b.currentIqs - a.currentIqs;
    })
    .slice(0, 5);
  if (mostImproved.length === 0) {
    mostImproved = [...rmsList]
      .sort((a, b) => b.delta2Wk - a.delta2Wk)
      .slice(0, 5);
  }

  // 4. Top 5 Contributors in Answering Valid Client Calls during Non-Working Hours & Weekends
  const offHoursTopContributors = [...rmsList]
    .filter((rm) => (rm.offHoursClientAnswered || 0) > 0)
    .sort((a, b) => {
      // Primary: Highest number of valid client calls answered during off-hours/weekends
      if (b.offHoursClientAnswered !== a.offHoursClientAnswered) {
        return b.offHoursClientAnswered - a.offHoursClientAnswered;
      }
      // Tie-breaker 1: Higher off-hours pickup rate %
      if (b.offHoursPickupRate !== a.offHoursPickupRate) {
        return b.offHoursPickupRate - a.offHoursPickupRate;
      }
      // Tie-breaker 2: Total off-hours client calls volume
      if (b.offHoursClientTotal !== a.offHoursClientTotal) {
        return b.offHoursClientTotal - a.offHoursClientTotal;
      }
      // Tie-breaker 3: Overall IQS
      return b.currentIqs - a.currentIqs;
    })
    .slice(0, 5);

  const totalDeptOffHoursAnswered = rmsList.reduce((sum, rm) => sum + (rm.offHoursClientAnswered || 0), 0);
  const totalDeptOffHoursReceived = rmsList.reduce((sum, rm) => sum + (rm.offHoursClientTotal || 0), 0);
  const deptOffHoursPickupRate = totalDeptOffHoursReceived > 0
    ? Math.round((totalDeptOffHoursAnswered / totalDeptOffHoursReceived) * 100)
    : 0;

  return (
    <div style={{ fontFamily: 'Inter, sans-serif', maxWidth: 1280, margin: '0 auto', color: 'var(--dk-fg-18181b, #18181b)' }}>
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16, marginBottom: 24, borderBottom: '1px solid var(--dk-bd-e4e4e7, #e4e4e7)', paddingBottom: 16 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, color: 'var(--dk-fg-18181b, #18181b)', letterSpacing: '-0.02em' }}>
              RM Performance
            </h1>
            <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', background: 'var(--dk-bg-ecfdf5, #ecfdf5)', color: 'var(--dk-fg-065f46, #065f46)', border: '1px solid var(--dk-bd-a7f3d0, #a7f3d0)', padding: '2px 8px', borderRadius: 6 }}>
              Calls Channel
            </span>
            <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', background: 'var(--dk-bg-f4f4f5, #f4f4f5)', color: 'var(--dk-fg-52525b, #52525b)', border: '1px solid var(--dk-bd-e4e4e7, #e4e4e7)', padding: '2px 8px', borderRadius: 6 }}>
              Whole PCG Department · {rmsList.length} RMs
            </span>
          </div>
          <p style={{ fontSize: 13, color: 'var(--dk-fg-71717a, #71717a)', margin: '4px 0 0 0' }}>
            Top performers (Top 5 by IQS), bottom performers (IQS ≤ 70%), most improved performers, and top contributors during off-hours & weekends for the whole PCG department.
          </p>
        </div>
      </div>

      {/* ── 3 CATEGORIES GRID ────────────────────────────────────────────── */}
      {rmsList.length === 0 ? (
        <div style={{ background: '#ffffff', border: '1px solid var(--dk-bd-e4e4e7, #e4e4e7)', borderRadius: 12, padding: 48, textAlign: 'center' }}>
          <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--dk-fg-71717a, #71717a)' }}>No RM evaluations recorded yet for the PCG department.</p>
          <p style={{ margin: '6px 0 0 0', fontSize: 12, color: 'var(--dk-fg-a1a1aa, #a1a1aa)' }}>Rankings and trends will populate automatically once weekly call quality evaluations are scored.</p>
        </div>
      ) : (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20 }}>
        {/* =================================================================== */}
        {/* 1. TOP PERFORMERS                                                   */}
        {/* =================================================================== */}
        <div style={{ background: '#ffffff', border: '1px solid var(--dk-bd-e4e4e7, #e4e4e7)', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--dk-bd-e4e4e7, #e4e4e7)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--dk-bg-fafafa, #fafafa)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#059669' }}></span>
              <h2 style={{ fontSize: 14, fontWeight: 700, margin: 0, color: 'var(--dk-fg-18181b, #18181b)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Top Performers
              </h2>
            </div>
            <span style={{ fontSize: 11, fontWeight: 600, background: 'var(--dk-bg-ecfdf5, #ecfdf5)', color: 'var(--dk-fg-065f46, #065f46)', border: '1px solid var(--dk-bd-a7f3d0, #a7f3d0)', padding: '2px 7px', borderRadius: 6 }}>
              Top 5 by IQS
            </span>
          </div>

          <div>
            {topPerformers.map((rm, idx) => {
              const rankIcons = ['🥇', '🥈', '🥉', '#4', '#5'];
              return (
                <div
                  key={rm.id}
                  onClick={() => onSelectRm && onSelectRm(rm.name)}
                  style={{
                    padding: '14px 18px',
                    borderBottom: idx < topPerformers.length - 1 ? '1px solid var(--dk-bd-f4f4f5, #f4f4f5)' : 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                    cursor: onSelectRm ? 'pointer' : 'default',
                    transition: 'background 0.15s ease',
                  }}
                  className="hover:bg-zinc-50"
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
                    <span style={{ fontSize: idx < 3 ? 15 : 12, fontWeight: 700, color: 'var(--dk-fg-71717a, #71717a)', width: 22, textAlign: 'center', flexShrink: 0 }}>
                      {rankIcons[idx]}
                    </span>
                    <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'var(--dk-bg-e4e4e7, #e4e4e7)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: 'var(--dk-fg-3f3f46, #3f3f46)', flexShrink: 0 }}>
                      {rm.ini}
                    </div>
                    <div style={{ minWidth: 0, flex: 1, overflow: 'hidden' }}>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 600,
                          color: 'var(--dk-fg-18181b, #18181b)',
                          lineHeight: '18px',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                        title={rm.name}
                      >
                        {rm.name}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--dk-fg-71717a, #71717a)', marginTop: 2, flexWrap: 'wrap' }}>
                        {rm.tl ? (
                          <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--dk-fg-52525b, #52525b)', background: 'var(--dk-bg-f4f4f5, #f4f4f5)', padding: '1px 5px', borderRadius: 4, flexShrink: 0 }}>
                            {rm.tl.startsWith('Team ') ? rm.tl : `Team ${rm.tl}`}
                          </span>
                        ) : null}
                        <span>{rm.callsVolume} calls</span>
                      </div>
                    </div>
                  </div>

                  <div style={{ textAlign: 'right', flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
                    <div style={{ fontSize: 16, fontWeight: 700, fontFamily: 'monospace', color: 'var(--dk-fg-059669, #059669)' }}>
                      {rm.currentIqs}%
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenScorecard && onOpenScorecard(rm.name);
                      }}
                      style={{
                        fontSize: 10,
                        fontWeight: 600,
                        color: 'var(--dk-fg-2563eb, #2563eb)',
                        background: 'var(--dk-bg-eff6ff, #eff6ff)',
                        border: '1px solid var(--dk-bd-bfdbfe, #bfdbfe)',
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
                        e.currentTarget.style.background = 'var(--dk-bg-dbeafe, #dbeafe)';
                        e.currentTarget.style.color = 'var(--dk-fg-1d4ed8, #1d4ed8)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'var(--dk-bg-eff6ff, #eff6ff)';
                        e.currentTarget.style.color = 'var(--dk-fg-2563eb, #2563eb)';
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

        {/* =================================================================== */}
        {/* 2. BOTTOM PERFORMERS                                                */}
        {/* =================================================================== */}
        <div style={{ background: '#ffffff', border: '1px solid var(--dk-bd-e4e4e7, #e4e4e7)', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--dk-bd-e4e4e7, #e4e4e7)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--dk-bg-fafafa, #fafafa)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#dc2626' }}></span>
              <h2 style={{ fontSize: 14, fontWeight: 700, margin: 0, color: 'var(--dk-fg-18181b, #18181b)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Bottom Performers
              </h2>
            </div>
            <span style={{ fontSize: 11, fontWeight: 600, background: 'var(--dk-bg-fef2f2, #fef2f2)', color: 'var(--dk-fg-991b1b, #991b1b)', border: '1px solid var(--dk-bd-fecaca, #fecaca)', padding: '2px 7px', borderRadius: 6 }}>
              IQS ≤ 70%
            </span>
          </div>

          <div>
            {bottomPerformers.length === 0 ? (
              <div style={{ padding: '36px 18px', textAlign: 'center', color: 'var(--dk-fg-71717a, #71717a)' }}>
                <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--dk-bg-ecfdf5, #ecfdf5)', color: 'var(--dk-fg-059669, #059669)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 700, marginBottom: 8 }}>
                  ✓
                </div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--dk-fg-18181b, #18181b)', marginBottom: 2 }}>
                  No RMs Scoring ≤ 70%
                </div>
                <div style={{ fontSize: 11, color: 'var(--dk-fg-71717a, #71717a)' }}>
                  All active team members meet or exceed the 70% quality benchmark.
                </div>
              </div>
            ) : (
              bottomPerformers.map((rm, idx) => {
                return (
                  <div
                    key={rm.id}
                    onClick={() => onSelectRm && onSelectRm(rm.name)}
                    style={{
                      padding: '14px 18px',
                      borderBottom: idx < bottomPerformers.length - 1 ? '1px solid var(--dk-bd-f4f4f5, #f4f4f5)' : 'none',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 12,
                      cursor: onSelectRm ? 'pointer' : 'default',
                      transition: 'background 0.15s ease',
                    }}
                    className="hover:bg-zinc-50"
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--dk-fg-71717a, #71717a)', width: 22, textAlign: 'center', flexShrink: 0 }}>
                        #{idx + 1}
                      </span>
                      <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'var(--dk-bg-fee2e2, #fee2e2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: 'var(--dk-fg-991b1b, #991b1b)', flexShrink: 0 }}>
                        {rm.ini}
                      </div>
                      <div style={{ minWidth: 0, flex: 1, overflow: 'hidden' }}>
                        <div
                          style={{
                            fontSize: 13,
                            fontWeight: 600,
                            color: 'var(--dk-fg-18181b, #18181b)',
                            lineHeight: '18px',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                          title={rm.name}
                        >
                          {rm.name}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--dk-fg-71717a, #71717a)', marginTop: 2, flexWrap: 'wrap' }}>
                          {rm.tl ? (
                            <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--dk-fg-52525b, #52525b)', background: 'var(--dk-bg-f4f4f5, #f4f4f5)', padding: '1px 5px', borderRadius: 4, flexShrink: 0 }}>
                              {rm.tl.startsWith('Team ') ? rm.tl : `Team ${rm.tl}`}
                            </span>
                          ) : null}
                          <span style={{ color: '#dc2626', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={`Focus: ${rm.focusArea}`}>
                            Focus: {rm.focusArea}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div style={{ textAlign: 'right', flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
                      <div style={{ fontSize: 16, fontWeight: 700, fontFamily: 'monospace', color: 'var(--dk-fg-dc2626, #dc2626)' }}>
                        {rm.currentIqs}%
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenScorecard && onOpenScorecard(rm.name);
                        }}
                        style={{
                          fontSize: 10,
                          fontWeight: 600,
                          color: 'var(--dk-fg-2563eb, #2563eb)',
                          background: 'var(--dk-bg-eff6ff, #eff6ff)',
                          border: '1px solid var(--dk-bd-bfdbfe, #bfdbfe)',
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
                          e.currentTarget.style.background = 'var(--dk-bg-dbeafe, #dbeafe)';
                          e.currentTarget.style.color = 'var(--dk-fg-1d4ed8, #1d4ed8)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = 'var(--dk-bg-eff6ff, #eff6ff)';
                          e.currentTarget.style.color = 'var(--dk-fg-2563eb, #2563eb)';
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
        {/* 3. MOST IMPROVED (2 WEEKS ROLLING NUMBER DIFFERENCE)                */}
        {/* =================================================================== */}
        <div style={{ background: '#ffffff', border: '1px solid var(--dk-bd-e4e4e7, #e4e4e7)', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--dk-bd-e4e4e7, #e4e4e7)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--dk-bg-fafafa, #fafafa)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#059669' }}></span>
              <h2 style={{ fontSize: 14, fontWeight: 700, margin: 0, color: 'var(--dk-fg-18181b, #18181b)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Most Improved
              </h2>
            </div>
            <span style={{ fontSize: 11, fontWeight: 600, background: 'var(--dk-bg-ecfdf5, #ecfdf5)', color: 'var(--dk-fg-065f46, #065f46)', border: '1px solid var(--dk-bd-a7f3d0, #a7f3d0)', padding: '2px 7px', borderRadius: 6 }}>
              2-Wk Rolling Diff
            </span>
          </div>

          <div>
            {mostImproved.map((rm, idx) => {
              const isPositive = rm.delta2Wk >= 0;
              return (
                <div
                  key={rm.id}
                  onClick={() => onSelectRm && onSelectRm(rm.name)}
                  style={{
                    padding: '14px 18px',
                    borderBottom: idx < mostImproved.length - 1 ? '1px solid var(--dk-bd-f4f4f5, #f4f4f5)' : 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                    cursor: onSelectRm ? 'pointer' : 'default',
                    transition: 'background 0.15s ease',
                  }}
                  className="hover:bg-zinc-50"
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--dk-fg-71717a, #71717a)', width: 22, textAlign: 'center', flexShrink: 0 }}>
                      #{idx + 1}
                    </span>
                    <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'var(--dk-bg-d1fae5, #d1fae5)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: 'var(--dk-fg-065f46, #065f46)', flexShrink: 0 }}>
                      {rm.ini}
                    </div>
                    <div style={{ minWidth: 0, flex: 1, overflow: 'hidden' }}>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 600,
                          color: 'var(--dk-fg-18181b, #18181b)',
                          lineHeight: '18px',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                        title={rm.name}
                      >
                        {rm.name}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--dk-fg-71717a, #71717a)', marginTop: 2, flexWrap: 'wrap' }}>
                        {rm.tl ? (
                          <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--dk-fg-52525b, #52525b)', background: 'var(--dk-bg-f4f4f5, #f4f4f5)', padding: '1px 5px', borderRadius: 4, flexShrink: 0 }}>
                            {rm.tl.startsWith('Team ') ? rm.tl : `Team ${rm.tl}`}
                          </span>
                        ) : null}
                        <span>
                          {rm.prev2WkIqs}% → <strong style={{ color: '#18181b' }}>{rm.currentIqs}%</strong>
                        </span>
                      </div>
                    </div>
                  </div>

                  <div style={{ textAlign: 'right', flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
                    <div style={{ fontSize: 15, fontWeight: 700, fontFamily: 'monospace', color: 'var(--dk-fg-059669, #059669)', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 2 }}>
                      <span>{isPositive ? '↑' : '↓'}</span>
                      <span>{isPositive ? `+${rm.delta2Wk.toFixed(1)}%` : `${rm.delta2Wk.toFixed(1)}%`}</span>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenScorecard && onOpenScorecard(rm.name);
                      }}
                      style={{
                        fontSize: 10,
                        fontWeight: 600,
                        color: 'var(--dk-fg-2563eb, #2563eb)',
                        background: 'var(--dk-bg-eff6ff, #eff6ff)',
                        border: '1px solid var(--dk-bd-bfdbfe, #bfdbfe)',
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
                        e.currentTarget.style.background = 'var(--dk-bg-dbeafe, #dbeafe)';
                        e.currentTarget.style.color = 'var(--dk-fg-1d4ed8, #1d4ed8)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'var(--dk-bg-eff6ff, #eff6ff)';
                        e.currentTarget.style.color = 'var(--dk-fg-2563eb, #2563eb)';
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

      {/* ── SEPARATE BANNER: TOP 5 NON-WORKING HOURS & WEEKENDS CONTRIBUTORS ── */}
      {rmsList.length > 0 && (
        <div
          style={{
            marginTop: 24,
            marginBottom: 24,
            background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)',
            border: '1px solid var(--dk-bd-cbd5e1, #cbd5e1)',
            borderRadius: 14,
            boxShadow: '0 1px 3px rgba(0,0,0,0.03), 0 10px 15px -3px rgba(15, 23, 42, 0.04)',
            overflow: 'hidden',
          }}
        >
          {/* Banner Header */}
          <div
            style={{
              padding: '16px 20px',
              background: 'linear-gradient(90deg, #f1f5f9 0%, #ffffff 100%)',
              borderBottom: '1px solid var(--dk-bd-e2e8f0, #e2e8f0)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 12,
            }}
          >
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <h2
                  style={{
                    fontSize: 15,
                    fontWeight: 700,
                    margin: 0,
                    color: 'var(--dk-fg-0f172a, #0f172a)',
                    letterSpacing: '-0.01em',
                  }}
                >
                  Top 5 Contributors: Non-Working Hours & Weekends
                </h2>
              </div>
              <p style={{ margin: '3px 0 0 0', fontSize: 12, color: 'var(--dk-fg-64748b, #64748b)' }}>
                Highest contributors in answering valid client calls received during non-working hours (&lt;10:00 AM, &ge;7:00 PM Mon–Fri) and weekends (Saturday &amp; Sunday).
              </p>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: 'var(--dk-fg-334155, #334155)',
                  background: 'var(--dk-bg-ffffff, #ffffff)',
                  border: '1px solid var(--dk-bd-cbd5e1, #cbd5e1)',
                  padding: '5px 12px',
                  borderRadius: 8,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <span style={{ color: '#64748b' }}>Department Off-Hours:</span>
                <strong style={{ color: '#0f172a', fontFamily: 'monospace' }}>
                  {totalDeptOffHoursAnswered} answered
                </strong>
                <span style={{ color: '#94a3b8' }}>/</span>
                <span style={{ color: '#64748b', fontSize: 11 }}>
                  {totalDeptOffHoursReceived} calls ({deptOffHoursPickupRate}% pickup)
                </span>
              </div>
            </div>
          </div>

          {/* Banner Content: Top 5 RMs Cards */}
          <div style={{ padding: '16px 20px' }}>
            {offHoursTopContributors.length === 0 ? (
              <div style={{ padding: '28px 16px', textAlign: 'center', color: 'var(--dk-fg-64748b, #64748b)' }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--dk-fg-334155, #334155)', marginBottom: 2 }}>
                  No Off-Hours or Weekend Client Calls Answered Yet
                </div>
                <div style={{ fontSize: 11, color: 'var(--dk-fg-94a3b8, #94a3b8)' }}>
                  Rankings will automatically appear here as Relationship Managers answer incoming client calls outside regular business hours.
                </div>
              </div>
            ) : (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
                  gap: 14,
                }}
              >
                {offHoursTopContributors.map((rm, idx) => {
                  const rankBadges = [
                    { label: '🥇 1st', bg: 'var(--dk-bg-fef3c7, #fef3c7)', text: 'var(--dk-fg-92400e, #92400e)', border: 'var(--dk-bd-fde68a, #fde68a)', cardBg: 'var(--dk-bg-fffdf5, #fffdf5)', cardBorder: 'var(--dk-bd-fde68a, #fde68a)', avatarBg: 'var(--dk-bg-fef3c7, #fef3c7)', avatarText: 'var(--dk-fg-92400e, #92400e)', avatarBorder: '#fde68a' },
                    { label: '🥈 2nd', bg: 'var(--dk-bg-f1f5f9, #f1f5f9)', text: 'var(--dk-fg-334155, #334155)', border: 'var(--dk-bd-cbd5e1, #cbd5e1)', cardBg: 'var(--dk-bg-ffffff, #ffffff)', cardBorder: 'var(--dk-bd-e2e8f0, #e2e8f0)', avatarBg: 'var(--dk-bg-f1f5f9, #f1f5f9)', avatarText: 'var(--dk-fg-334155, #334155)', avatarBorder: '#cbd5e1' },
                    { label: '🥉 3rd', bg: 'var(--dk-bg-ffedd5, #ffedd5)', text: 'var(--dk-fg-9a3412, #9a3412)', border: 'var(--dk-bd-fed7aa, #fed7aa)', cardBg: 'var(--dk-bg-ffffff, #ffffff)', cardBorder: 'var(--dk-bd-e2e8f0, #e2e8f0)', avatarBg: 'var(--dk-bg-ffedd5, #ffedd5)', avatarText: 'var(--dk-fg-9a3412, #9a3412)', avatarBorder: '#fed7aa' },
                    { label: '#4', bg: 'var(--dk-bg-f8fafc, #f8fafc)', text: 'var(--dk-fg-475569, #475569)', border: 'var(--dk-bd-e2e8f0, #e2e8f0)', cardBg: 'var(--dk-bg-ffffff, #ffffff)', cardBorder: 'var(--dk-bd-e2e8f0, #e2e8f0)', avatarBg: 'var(--dk-bg-e0e7ff, #e0e7ff)', avatarText: 'var(--dk-fg-4338ca, #4338ca)', avatarBorder: '#c7d2fe' },
                    { label: '#5', bg: 'var(--dk-bg-f8fafc, #f8fafc)', text: 'var(--dk-fg-475569, #475569)', border: 'var(--dk-bd-e2e8f0, #e2e8f0)', cardBg: 'var(--dk-bg-ffffff, #ffffff)', cardBorder: 'var(--dk-bd-e2e8f0, #e2e8f0)', avatarBg: 'var(--dk-bg-e0e7ff, #e0e7ff)', avatarText: 'var(--dk-fg-4338ca, #4338ca)', avatarBorder: '#c7d2fe' },
                  ];
                  const badge = rankBadges[idx] || rankBadges[3];

                  return (
                    <div
                      key={rm.id}
                      onClick={() => onSelectRm && onSelectRm(rm.name)}
                      style={{
                        background: badge.cardBg,
                        border: `1px solid ${badge.cardBorder}`,
                        borderRadius: 10,
                        padding: '14px',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between',
                        gap: 12,
                        cursor: onSelectRm ? 'pointer' : 'default',
                        transition: 'all 0.15s ease',
                        boxShadow: idx === 0 ? '0 1px 3px rgba(245, 158, 11, 0.1)' : '0 1px 2px rgba(0,0,0,0.02)',
                      }}
                      className="hover:border-indigo-300 hover:shadow-md"
                    >
                      {/* Top Row: Rank & Pickup Rate Badge */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 700,
                            background: badge.bg,
                            color: badge.text,
                            border: `1px solid ${badge.border}`,
                            padding: '2px 7px',
                            borderRadius: 6,
                            letterSpacing: '0.02em',
                          }}
                        >
                          {badge.label}
                        </span>
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            background: 'var(--dk-bg-ecfdf5, #ecfdf5)',
                            color: 'var(--dk-fg-065f46, #065f46)',
                            border: '1px solid var(--dk-bd-a7f3d0, #a7f3d0)',
                            padding: '2px 6px',
                            borderRadius: 6,
                            fontFamily: 'monospace',
                          }}
                          title={`${rm.offHoursPickupRate}% pickup rate during off-hours & weekends`}
                        >
                          {rm.offHoursPickupRate}% pickup
                        </span>
                      </div>

                      {/* Middle Row: RM Info */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                        <div
                          style={{
                            width: 36,
                            height: 36,
                            borderRadius: '50%',
                            background: badge.avatarBg,
                            color: badge.avatarText,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 12,
                            fontWeight: 700,
                            flexShrink: 0,
                            border: `1px solid ${badge.avatarBorder}`,
                          }}
                        >
                          {rm.ini}
                        </div>
                        <div style={{ minWidth: 0, flex: 1, overflow: 'hidden' }}>
                          <div
                            style={{
                              fontSize: 13,
                              fontWeight: 700,
                              color: 'var(--dk-fg-0f172a, #0f172a)',
                              lineHeight: '18px',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            }}
                            title={rm.name}
                          >
                            {rm.name}
                          </div>
                          {rm.tl ? (
                            <div style={{ marginTop: 2 }}>
                              <span
                                style={{
                                  fontSize: 10,
                                  fontWeight: 600,
                                  color: 'var(--dk-fg-475569, #475569)',
                                  background: 'var(--dk-bg-f1f5f9, #f1f5f9)',
                                  padding: '1px 5px',
                                  borderRadius: 4,
                                  display: 'inline-block',
                                  maxWidth: '100%',
                                  whiteSpace: 'nowrap',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                }}
                              >
                                {rm.tl.startsWith('Team ') ? rm.tl : `Team ${rm.tl}`}
                              </span>
                            </div>
                          ) : null}
                        </div>
                      </div>

                      {/* Metric Highlight: Calls Answered */}
                      <div
                        style={{
                          background: 'var(--dk-bg-f8fafc, #f8fafc)',
                          border: '1px solid var(--dk-bd-e2e8f0, #e2e8f0)',
                          borderRadius: 8,
                          padding: '8px 10px',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                          <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                            <span
                              style={{
                                fontSize: 18,
                                fontWeight: 800,
                                fontFamily: 'monospace',
                                color: 'var(--dk-fg-0f172a, #0f172a)',
                              }}
                            >
                              {rm.offHoursClientAnswered}
                            </span>
                            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--dk-fg-64748b, #64748b)' }}>
                              answered
                            </span>
                          </div>
                          <span style={{ fontSize: 10, color: 'var(--dk-fg-94a3b8, #94a3b8)', fontWeight: 500 }}>
                            of {rm.offHoursClientTotal} calls
                          </span>
                        </div>
                      </div>

                      {/* Action Button */}
                      <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 2 }}>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenScorecard && onOpenScorecard(rm.name);
                          }}
                          style={{
                            fontSize: 10,
                            fontWeight: 600,
                            color: 'var(--dk-fg-4338ca, #4338ca)',
                            background: 'var(--dk-bg-eef2ff, #eef2ff)',
                            border: '1px solid var(--dk-bd-c7d2fe, #c7d2fe)',
                            borderRadius: 5,
                            padding: '2px 8px',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 2,
                            cursor: 'pointer',
                            transition: 'all 0.15s ease',
                            whiteSpace: 'nowrap',
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = 'var(--dk-bg-e0e7ff, #e0e7ff)';
                            e.currentTarget.style.color = 'var(--dk-fg-3730a3, #3730a3)';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = 'var(--dk-bg-eef2ff, #eef2ff)';
                            e.currentTarget.style.color = 'var(--dk-fg-4338ca, #4338ca)';
                          }}
                        >
                          Show Scorecard →
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Footer Explanatory Note ────────────────────────────────────── */}
      <div style={{ marginTop: 28, padding: '14px 18px', background: 'var(--dk-bg-ffffff, #ffffff)', border: '1px solid var(--dk-bd-e4e4e7, #e4e4e7)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <p style={{ margin: 0, fontSize: 12, color: 'var(--dk-fg-71717a, #71717a)' }}>
          <strong>Ranking Methodology:</strong> Off-Hours &amp; Weekend banner highlights the top 5 RMs who answered the highest volume of valid client calls outside regular business hours (Mon–Fri &lt;10:00 AM, &ge;7:00 PM IST) and on weekends. Top category ranks the top 5 RMs by average call IQS. Bottom category highlights RMs scoring 70% or below for active coaching. Most Improved tracks the top 5 net score gainers over a 14-day rolling window.
        </p>
        <span style={{ fontSize: 11, color: 'var(--dk-fg-a1a1aa, #a1a1aa)' }}>
          Updated for Calls only
        </span>
      </div>
    </div>
  );
}
