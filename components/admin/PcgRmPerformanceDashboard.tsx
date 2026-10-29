'use client';

import React, { useState } from 'react';

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
  const rmsList: RmPerformanceItem[] = (rmScorecards && rmScorecards.length > 0)
    ? rmScorecards.map((sc) => {
        const foundTl = teamLeads?.find(t => t.rms?.some(r => r.toLowerCase() === sc.rmName.toLowerCase()));
        const tl = foundTl ? foundTl.tlName : '';
        const parts = sc.rmName.split(' ');
        const ini = parts.map((p: string) => p[0]).join('').slice(0, 2).toUpperCase();
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
        };
      })
    : [];

  // 1. Top Performers (Top 5 by IQS score across the whole PCG department)
  const topPerformers = [...rmsList]
    .filter((rm) => rm.currentIqs > 0)
    .sort((a, b) => b.currentIqs - a.currentIqs)
    .slice(0, 5);

  // 2. Bottom Performers (anyone with an IQS score of 70% or below across the whole PCG department)
  const bottomPerformers = [...rmsList]
    .filter((rm) => rm.currentIqs > 0 && rm.currentIqs <= 70.0)
    .sort((a, b) => a.currentIqs - b.currentIqs)
    .slice(0, 5);

  // 3. Most Improved (Top 5 net gainers across the whole PCG department)
  let mostImproved = [...rmsList]
    .filter((rm) => rm.delta2Wk > 0)
    .sort((a, b) => b.delta2Wk - a.delta2Wk)
    .slice(0, 5);
  if (mostImproved.length === 0) {
    mostImproved = [...rmsList]
      .sort((a, b) => b.delta2Wk - a.delta2Wk)
      .slice(0, 5);
  }

  return (
    <div style={{ fontFamily: 'Inter, sans-serif', maxWidth: 1280, margin: '0 auto', color: '#18181b' }}>
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16, marginBottom: 24, borderBottom: '1px solid #e4e4e7', paddingBottom: 16 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, color: '#18181b', letterSpacing: '-0.02em' }}>
              RM Performance
            </h1>
            <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', background: '#ecfdf5', color: '#065f46', border: '1px solid #a7f3d0', padding: '2px 8px', borderRadius: 6 }}>
              Calls Channel
            </span>
            <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', background: '#f4f4f5', color: '#52525b', border: '1px solid #e4e4e7', padding: '2px 8px', borderRadius: 6 }}>
              Whole PCG Department · {rmsList.length} RMs
            </span>
          </div>
          <p style={{ fontSize: 13, color: '#71717a', margin: '4px 0 0 0' }}>
            Top performers (Top 5), Bottom performers (IQS ≤ 70%), and Most improved performers for the whole PCG department.
          </p>
        </div>
      </div>

      {/* ── 3 CATEGORIES GRID ────────────────────────────────────────────── */}
      {rmsList.length === 0 ? (
        <div style={{ background: '#ffffff', border: '1px solid #e4e4e7', borderRadius: 12, padding: 48, textAlign: 'center' }}>
          <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: '#71717a' }}>No RM evaluations recorded yet for the PCG department.</p>
          <p style={{ margin: '6px 0 0 0', fontSize: 12, color: '#a1a1aa' }}>Rankings and trends will populate automatically once weekly call quality evaluations are scored.</p>
        </div>
      ) : (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))', gap: 20 }}>
        {/* =================================================================== */}
        {/* 1. TOP PERFORMERS                                                   */}
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
                    borderBottom: idx < topPerformers.length - 1 ? '1px solid #f4f4f5' : 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                    cursor: onSelectRm ? 'pointer' : 'default',
                    transition: 'background 0.15s ease',
                  }}
                  className="hover:bg-zinc-50"
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                    <span style={{ fontSize: idx < 3 ? 15 : 12, fontWeight: 700, color: '#71717a', width: 22, textAlign: 'center', flexShrink: 0 }}>
                      {rankIcons[idx]}
                    </span>
                    <div style={{ width: 34, height: 34, borderRadius: '50%', background: '#e4e4e7', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#3f3f46', flexShrink: 0 }}>
                      {rm.ini}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: '#18181b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {rm.name}
                        </span>
                        {rm.tl ? (
                          <span style={{ fontSize: 10, fontWeight: 600, color: '#71717a', background: '#f4f4f5', padding: '1px 5px', borderRadius: 4, flexShrink: 0 }}>
                            {rm.tl.startsWith('Team ') ? rm.tl : `Team ${rm.tl}`}
                          </span>
                        ) : null}
                      </div>
                      <div style={{ fontSize: 11, color: '#71717a', marginTop: 2 }}>
                        {rm.callsVolume} calls
                      </div>
                    </div>
                  </div>

                  <div style={{ textAlign: 'right', flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                    <div style={{ fontSize: 16, fontWeight: 700, fontFamily: 'monospace', color: '#059669' }}>
                      {rm.currentIqs}%
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenScorecard && onOpenScorecard(rm.name);
                      }}
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        color: '#2563eb',
                        background: '#eff6ff',
                        border: '1px solid #bfdbfe',
                        borderRadius: 6,
                        padding: '2px 8px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 3,
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

        {/* =================================================================== */}
        {/* 2. BOTTOM PERFORMERS                                                */}
        {/* =================================================================== */}
        <div style={{ background: '#ffffff', border: '1px solid #e4e4e7', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid #e4e4e7', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#fafafa' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#059669' }}></span>
              <h2 style={{ fontSize: 14, fontWeight: 700, margin: 0, color: '#18181b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Bottom Performers
              </h2>
            </div>
            <span style={{ fontSize: 11, fontWeight: 600, background: '#ecfdf5', color: '#065f46', border: '1px solid #a7f3d0', padding: '2px 7px', borderRadius: 6 }}>
              IQS ≤ 70%
            </span>
          </div>

          <div>
            {bottomPerformers.length === 0 ? (
              <div style={{ padding: '36px 18px', textAlign: 'center', color: '#71717a' }}>
                <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#ecfdf5', color: '#059669', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 700, marginBottom: 8 }}>
                  ✓
                </div>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#18181b', marginBottom: 2 }}>
                  No RMs Scoring ≤ 70%
                </div>
                <div style={{ fontSize: 11, color: '#71717a' }}>
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
                      borderBottom: idx < bottomPerformers.length - 1 ? '1px solid #f4f4f5' : 'none',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 12,
                      cursor: onSelectRm ? 'pointer' : 'default',
                      transition: 'background 0.15s ease',
                    }}
                    className="hover:bg-zinc-50"
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: '#71717a', width: 22, textAlign: 'center', flexShrink: 0 }}>
                        #{idx + 1}
                      </span>
                      <div style={{ width: 34, height: 34, borderRadius: '50%', background: '#e4e4e7', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#3f3f46', flexShrink: 0 }}>
                        {rm.ini}
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontSize: 13, fontWeight: 600, color: '#18181b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {rm.name}
                          </span>
                          {rm.tl ? (
                            <span style={{ fontSize: 10, fontWeight: 600, color: '#71717a', background: '#f4f4f5', padding: '1px 5px', borderRadius: 4, flexShrink: 0 }}>
                              {rm.tl.startsWith('Team ') ? rm.tl : `Team ${rm.tl}`}
                            </span>
                          ) : null}
                        </div>
                        <div style={{ fontSize: 11, color: '#71717a', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          Focus: {rm.focusArea}
                        </div>
                      </div>
                    </div>

                    <div style={{ textAlign: 'right', flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                      <div style={{ fontSize: 16, fontWeight: 700, fontFamily: 'monospace', color: '#dc2626' }}>
                        {rm.currentIqs}%
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenScorecard && onOpenScorecard(rm.name);
                        }}
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          color: '#2563eb',
                          background: '#eff6ff',
                          border: '1px solid #bfdbfe',
                          borderRadius: 6,
                          padding: '2px 8px',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 3,
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
        {/* 3. MOST IMPROVED (2 WEEKS ROLLING NUMBER DIFFERENCE)                */}
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
            {mostImproved.map((rm, idx) => {
              const isPositive = rm.delta2Wk >= 0;
              return (
                <div
                  key={rm.id}
                  onClick={() => onSelectRm && onSelectRm(rm.name)}
                  style={{
                    padding: '14px 18px',
                    borderBottom: idx < mostImproved.length - 1 ? '1px solid #f4f4f5' : 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                    cursor: onSelectRm ? 'pointer' : 'default',
                    transition: 'background 0.15s ease',
                  }}
                  className="hover:bg-zinc-50"
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#71717a', width: 22, textAlign: 'center', flexShrink: 0 }}>
                      #{idx + 1}
                    </span>
                    <div style={{ width: 34, height: 34, borderRadius: '50%', background: '#e4e4e7', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#3f3f46', flexShrink: 0 }}>
                      {rm.ini}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: '#18181b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {rm.name}
                        </span>
                        {rm.tl ? (
                          <span style={{ fontSize: 10, fontWeight: 600, color: '#71717a', background: '#f4f4f5', padding: '1px 5px', borderRadius: 4, flexShrink: 0 }}>
                            {rm.tl.startsWith('Team ') ? rm.tl : `Team ${rm.tl}`}
                          </span>
                        ) : null}
                      </div>
                      <div style={{ fontSize: 11, color: '#71717a', marginTop: 2 }}>
                        {rm.prev2WkIqs}% → <strong style={{ color: '#18181b' }}>{rm.currentIqs}%</strong>
                      </div>
                    </div>
                  </div>

                  <div style={{ textAlign: 'right', flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                    <div style={{ fontSize: 15, fontWeight: 700, fontFamily: 'monospace', color: '#059669', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 2 }}>
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
                        fontSize: 11,
                        fontWeight: 600,
                        color: '#2563eb',
                        background: '#eff6ff',
                        border: '1px solid #bfdbfe',
                        borderRadius: 6,
                        padding: '2px 8px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 3,
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
          <strong>Ranking Methodology:</strong> Top category ranks the top 5 RMs by average call IQS. Bottom category highlights RMs scoring 70% or below for active coaching. Most Improved tracks the top 5 net score gainers over a 14-day rolling window.
        </p>
        <span style={{ fontSize: 11, color: '#a1a1aa' }}>
          Updated for Calls only
        </span>
      </div>
    </div>
  );
}
