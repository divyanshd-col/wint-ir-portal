'use client';

import React, { useState } from 'react';

export interface RmPerformanceItem {
  id: string;
  name: string;
  ini: string;
  tl: 'Gokul' | 'Vaishnavi';
  currentIqs: number;
  prev2WkIqs: number;
  delta2Wk: number;
  callsVolume: number;
  csatPct: number;
  focusArea: string;
  improvementDriver?: string;
}

const ALL_RMS_PERFORMANCE: RmPerformanceItem[] = [
  {
    id: 'rm-yaashvi',
    name: 'Yaashvi Arora',
    ini: 'YA',
    tl: 'Gokul',
    currentIqs: 94.2,
    prev2WkIqs: 91.8,
    delta2Wk: 2.4,
    callsVolume: 68,
    csatPct: 94.0,
    focusArea: 'Pitch Clarity & Senior Secured Debt Backing',
    improvementDriver: '+4% in Senior Secured Backing pitch',
  },
  {
    id: 'rm-aditya',
    name: 'Aditya R',
    ini: 'AR',
    tl: 'Gokul',
    currentIqs: 93.5,
    prev2WkIqs: 89.0,
    delta2Wk: 4.5,
    callsVolume: 72,
    csatPct: 93.0,
    focusArea: 'Active Listening & Objection Handling',
    improvementDriver: '+8% in Handling secondary liquidity objections',
  },
  {
    id: 'rm-aahan',
    name: 'Aahan Thaker',
    ini: 'AT',
    tl: 'Gokul',
    currentIqs: 91.5,
    prev2WkIqs: 87.5,
    delta2Wk: 4.0,
    callsVolume: 74,
    csatPct: 91.5,
    focusArea: 'Indicative Yield Framing & Disclaimers',
    improvementDriver: '+7% in Indicative Yield disclaimers',
  },
  {
    id: 'rm-aravind',
    name: 'Aravind',
    ini: 'AR',
    tl: 'Vaishnavi',
    currentIqs: 89.8,
    prev2WkIqs: 86.6,
    delta2Wk: 3.2,
    callsVolume: 62,
    csatPct: 90.0,
    focusArea: 'Demat Linking & Account Verification',
    improvementDriver: '+6% in Demat verification walkthrough',
  },
  {
    id: 'rm-dhanush',
    name: 'Dhanush',
    ini: 'D',
    tl: 'Gokul',
    currentIqs: 88.2,
    prev2WkIqs: 83.1,
    delta2Wk: 5.1,
    callsVolume: 58,
    csatPct: 87.0,
    focusArea: 'Asset Allocation Need Discovery',
    improvementDriver: '+9% in Asset allocation discovery questions',
  },
  {
    id: 'rm-sujal',
    name: 'Sujal Dadwani',
    ini: 'SD',
    tl: 'Vaishnavi',
    currentIqs: 87.0,
    prev2WkIqs: 80.2,
    delta2Wk: 6.8,
    callsVolume: 56,
    csatPct: 86.5,
    focusArea: 'Monthly Interest Payout Timeline Clarity',
    improvementDriver: '+12% in Interest payout timeline disclosures',
  },
  {
    id: 'rm-samskriti',
    name: 'Samskriti Rao',
    ini: 'SR',
    tl: 'Gokul',
    currentIqs: 85.4,
    prev2WkIqs: 79.6,
    delta2Wk: 5.8,
    callsVolume: 52,
    csatPct: 85.0,
    focusArea: 'Secondary Liquidity Window Framing',
    improvementDriver: '+11% in Secondary window liquidity framing',
  },
  {
    id: 'rm-antara',
    name: 'Antara Chakrabarty',
    ini: 'AC',
    tl: 'Vaishnavi',
    currentIqs: 84.2,
    prev2WkIqs: 82.4,
    delta2Wk: 1.8,
    callsVolume: 50,
    csatPct: 84.5,
    focusArea: 'Post-Call Recap & Follow-Through',
    improvementDriver: '+3% in Follow-up WhatsApp recap scheduling',
  },
  {
    id: 'rm-swati',
    name: 'Swati Singh',
    ini: 'SS',
    tl: 'Vaishnavi',
    currentIqs: 69.5,
    prev2WkIqs: 72.0,
    delta2Wk: -2.5,
    callsVolume: 56,
    csatPct: 84.0,
    focusArea: 'Active Listening & Objection Handling',
    improvementDriver: 'Needs coaching on demat linking objection handling',
  },
  {
    id: 'rm-gaurav',
    name: 'Gaurav Nautiyal',
    ini: 'GN',
    tl: 'Gokul',
    currentIqs: 68.0,
    prev2WkIqs: 71.5,
    delta2Wk: -3.5,
    callsVolume: 44,
    csatPct: 83.5,
    focusArea: 'Post-Call Recap & Follow-Through',
    improvementDriver: 'Needs coaching on explicit post-call WhatsApp summary',
  },
];

interface PcgRmPerformanceProps {
  activePersona?: 'admin' | 'tl' | 'agent';
  onSelectRm?: (rmName: string) => void;
  onOpenScorecard?: (rmName: string) => void;
}

export default function PcgRmPerformanceDashboard({
  activePersona = 'admin',
  onSelectRm,
  onOpenScorecard,
}: PcgRmPerformanceProps) {
  const [selectedTeam, setSelectedTeam] = useState<'all' | 'Gokul' | 'Vaishnavi'>('all');

  const filteredRms = ALL_RMS_PERFORMANCE.filter(
    (rm) => selectedTeam === 'all' || rm.tl === selectedTeam
  );

  // 1. Top Performers (Top 5 by IQS score)
  const topPerformers = [...filteredRms]
    .sort((a, b) => b.currentIqs - a.currentIqs)
    .slice(0, 5);

  // 2. Bottom Performers (anyone with an IQS score of 70% or below, sorted ascending by score)
  const bottomPerformers = [...filteredRms]
    .filter((rm) => rm.currentIqs <= 70.0)
    .sort((a, b) => a.currentIqs - b.currentIqs)
    .slice(0, 5);

  // 3. Most Improved (Top 5 by 2-week rolling difference)
  const mostImproved = [...filteredRms]
    .sort((a, b) => b.delta2Wk - a.delta2Wk)
    .slice(0, 5);

  const highestPerformer = topPerformers[0];
  const biggestImprover = mostImproved[0];
  const underTargetCount = filteredRms.filter((r) => r.currentIqs < 85.0).length;
  const avgIqs = (
    filteredRms.reduce((acc, r) => acc + r.currentIqs, 0) / (filteredRms.length || 1)
  ).toFixed(1);

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
          </div>
          <p style={{ fontSize: 13, color: '#71717a', margin: '4px 0 0 0' }}>
            Top performers (Top 5), Bottom performers (IQS ≤ 70%), and Most improved (Top 5 by two-week rolling difference).
          </p>
        </div>

        {/* Team Filter + Time Range */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#71717a' }}>
            <span style={{ fontWeight: 500 }}>Team:</span>
            <select
              value={selectedTeam}
              onChange={(e) => setSelectedTeam(e.target.value as any)}
              style={{
                height: 34,
                padding: '0 12px',
                background: '#ffffff',
                border: '1px solid #e4e4e7',
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                color: '#18181b',
                outline: 'none',
                cursor: 'pointer',
                boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
              }}
            >
              <option value="all">All Teams ({ALL_RMS_PERFORMANCE.length} RMs)</option>
              <option value="Gokul">Team Gokul</option>
              <option value="Vaishnavi">Team Vaishnavi</option>
            </select>
          </div>
        </div>
      </div>

      {/* ── 3 CATEGORIES GRID ────────────────────────────────────────────── */}
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
                        <span style={{ fontSize: 10, fontWeight: 600, color: '#71717a', background: '#f4f4f5', padding: '1px 5px', borderRadius: 4, flexShrink: 0 }}>
                          Team {rm.tl}
                        </span>
                      </div>
                      <div style={{ fontSize: 11, color: '#71717a', marginTop: 2 }}>
                        {rm.callsVolume} calls · {rm.csatPct}% CSAT
                      </div>
                    </div>
                  </div>

                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: 16, fontWeight: 700, fontFamily: 'monospace', color: '#059669' }}>
                      {rm.currentIqs}%
                    </div>
                    <span style={{ fontSize: 10, fontWeight: 600, color: '#047857' }}>
                      IQS Score
                    </span>
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
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#d97706' }}></span>
              <h2 style={{ fontSize: 14, fontWeight: 700, margin: 0, color: '#18181b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Bottom Performers
              </h2>
            </div>
            <span style={{ fontSize: 11, fontWeight: 600, background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a', padding: '2px 7px', borderRadius: 6 }}>
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
                      <div style={{ width: 34, height: 34, borderRadius: '50%', background: '#fee2e2', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#991b1b', flexShrink: 0 }}>
                        {rm.ini}
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontSize: 13, fontWeight: 600, color: '#18181b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {rm.name}
                          </span>
                          <span style={{ fontSize: 10, fontWeight: 600, color: '#71717a', background: '#f4f4f5', padding: '1px 5px', borderRadius: 4, flexShrink: 0 }}>
                            Team {rm.tl}
                          </span>
                        </div>
                        <div style={{ fontSize: 11, color: '#b91c1c', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          Focus: {rm.focusArea}
                        </div>
                      </div>
                    </div>

                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={{ fontSize: 16, fontWeight: 700, fontFamily: 'monospace', color: '#b91c1c' }}>
                        {rm.currentIqs}%
                      </div>
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
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#2563eb' }}></span>
              <h2 style={{ fontSize: 14, fontWeight: 700, margin: 0, color: '#18181b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Most Improved
              </h2>
            </div>
            <span style={{ fontSize: 11, fontWeight: 600, background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe', padding: '2px 7px', borderRadius: 6 }}>
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
                    <div style={{ width: 34, height: 34, borderRadius: '50%', background: '#dbeafe', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#1e40af', flexShrink: 0 }}>
                      {rm.ini}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: '#18181b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {rm.name}
                        </span>
                        <span style={{ fontSize: 10, fontWeight: 600, color: '#71717a', background: '#f4f4f5', padding: '1px 5px', borderRadius: 4, flexShrink: 0 }}>
                          Team {rm.tl}
                        </span>
                      </div>
                      <div style={{ fontSize: 11, color: '#71717a', marginTop: 2 }}>
                        {rm.prev2WkIqs}% → <strong style={{ color: '#18181b' }}>{rm.currentIqs}%</strong>
                      </div>
                    </div>
                  </div>

                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 700, fontFamily: 'monospace', color: isPositive ? '#16a34a' : '#dc2626', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 2 }}>
                      <span>{isPositive ? '↑' : '↓'}</span>
                      <span>{isPositive ? `+${rm.delta2Wk.toFixed(1)}%` : `${rm.delta2Wk.toFixed(1)}%`}</span>
                    </div>
                    <span style={{ fontSize: 10, fontWeight: 600, color: '#71717a' }}>
                      2-Wk Rolling Diff
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

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
