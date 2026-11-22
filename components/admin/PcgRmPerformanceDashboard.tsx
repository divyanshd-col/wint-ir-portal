'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { isSamePcgAgent, canonicalizePcgRmName } from '@/lib/pcg/canonical-names';

export type RmPerformanceChannel = 'calls' | 'chats' | 'emails';

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
  onOpenScorecard?: (rmName: string, channel?: RmPerformanceChannel) => void;
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
  initialChannel?: RmPerformanceChannel;
  allChats?: any[];
}

const CHANNELS: Array<{ id: RmPerformanceChannel; label: string }> = [
  { id: 'calls', label: 'Calls' },
  { id: 'chats', label: 'Chats' },
  { id: 'emails', label: 'Emails' },
];

export default function PcgRmPerformanceDashboard({
  activePersona = 'admin',
  onSelectRm,
  onOpenScorecard,
  rmScorecards = [],
  teamLeads = [],
  initialChannel = 'calls',
  allChats,
}: PcgRmPerformanceProps) {
  const [channel, setChannel] = useState<RmPerformanceChannel>(initialChannel);
  const [chats, setChats] = useState<any[]>(allChats || []);
  const [loadingChats, setLoadingChats] = useState<boolean>(false);

  // Fetch all chats for PCG department when chats data is not passed
  useEffect(() => {
    if (allChats && allChats.length > 0) {
      setChats(allChats);
      return;
    }
    let isCancelled = false;
    setLoadingChats(true);
    fetch('/api/admin/pcg-chats?limit=500')
      .then((res) => res.json())
      .then((data) => {
        if (!isCancelled && Array.isArray(data.chats)) {
          setChats(data.chats);
        }
      })
      .catch((err) => {
        console.error('[PcgRmPerformanceDashboard] Failed to fetch pcg-chats:', err);
      })
      .finally(() => {
        if (!isCancelled) setLoadingChats(false);
      });
    return () => {
      isCancelled = true;
    };
  }, [allChats]);

  // Exclusion list of known Admins, TLs, and non-RM entities
  const tlNamesSet = new Set((teamLeads || []).map((t) => t.tlName.toLowerCase().replace(/^team\s+/i, '').trim()));
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

  const rmsList: RmPerformanceItem[] = useMemo(() => {
    if (channel === 'emails') {
      return [];
    }

    if (channel === 'calls') {
      if (!rmScorecards || rmScorecards.length === 0) return [];
      return rmScorecards
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
          const foundTl = teamLeads?.find((t) =>
            t.rms?.some((r) => isSamePcgAgent(r, sc.rmName) || r.toLowerCase().trim() === cleanScName)
          );
          const tl = foundTl ? foundTl.tlName.replace(/^team\s+/i, '').trim() : '';
          const parts = sc.rmName.trim().split(/\s+/);
          const ini =
            parts.length > 1
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
        });
    }

    // channel === 'chats'
    if (!chats || chats.length === 0) return [];

    // Group chats by canonical RM name (safeguards against name confusion)
    const groups = new Map<string, any[]>();
    chats.forEach((c) => {
      if (!c.rmName || c.isEvaluable === false) return;
      const canonical = canonicalizePcgRmName(c.rmName);
      const clean = canonical.trim().toLowerCase();
      const cleanNoTeam = clean.replace(/^team\s+/i, '').trim();
      if (
        nonRmSet.has(clean) ||
        nonRmSet.has(cleanNoTeam) ||
        tlNamesSet.has(clean) ||
        tlNamesSet.has(cleanNoTeam) ||
        clean.includes('admin') ||
        clean === 'unknown rm'
      ) {
        return;
      }
      if (!groups.has(canonical)) {
        groups.set(canonical, []);
      }
      groups.get(canonical)!.push(c);
    });

    const items: RmPerformanceItem[] = [];

    groups.forEach((agentChats, canonicalName) => {
      const validScores = agentChats.filter((c) => c.iqsScore != null && !isNaN(c.iqsScore));
      if (validScores.length === 0) return;

      const currentIqs = Math.round(
        validScores.reduce((sum, c) => sum + Number(c.iqsScore), 0) / validScores.length
      );

      // Resolve TL
      let tl = '';
      const chatTl = agentChats.find((c) => c.tlName)?.tlName;
      if (chatTl) {
        tl = chatTl.replace(/^team\s+/i, '').trim();
      }
      if (!tl && teamLeads) {
        const foundTl = teamLeads.find((t) =>
          t.rms?.some((r) => isSamePcgAgent(r, canonicalName))
        );
        if (foundTl) {
          tl = foundTl.tlName.replace(/^team\s+/i, '').trim();
        }
      }

      // Initials
      const parts = canonicalName.trim().split(/\s+/);
      const ini =
        parts.length > 1
          ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
          : parts[0].slice(0, 2).toUpperCase();

      // Weakest parameter for focus area
      const paramFails: Record<string, { count: number; name: string }> = {};
      agentChats.forEach((c) => {
        const pList = typeof c.parameters === 'string' ? JSON.parse(c.parameters) : c.parameters;
        if (Array.isArray(pList)) {
          pList.forEach((p: any) => {
            if (
              p.status === 'No' ||
              p.status === 'Half' ||
              (p.earnedScore != null && p.maxScore != null && p.earnedScore < p.maxScore)
            ) {
              const name = p.name || p.id || 'Process';
              if (!paramFails[name]) paramFails[name] = { count: 0, name };
              paramFails[name].count += 1;
            }
          });
        }
      });
      let topWeakness = '—';
      const sortedFails = Object.values(paramFails).sort((a, b) => b.count - a.count);
      if (sortedFails.length > 0 && sortedFails[0].count > 0) {
        topWeakness = sortedFails[0].name.replace(/^\d+\.\s*/, '');
      } else if (currentIqs < 90) {
        topWeakness = 'Query Resolution';
      }

      // Rolling 2-week diff: sort chats by date descending
      const sortedByDate = [...validScores].sort((a, b) => {
        const tA = new Date(a.chatClosedAt || a.scoredAt || 0).getTime();
        const tB = new Date(b.chatClosedAt || b.scoredAt || 0).getTime();
        return tB - tA;
      });

      let delta2Wk = 0;
      let prev2WkIqs = currentIqs;
      if (sortedByDate.length >= 2) {
        const mid = Math.ceil(sortedByDate.length / 2);
        const recent = sortedByDate.slice(0, mid);
        const older = sortedByDate.slice(mid);
        const recentAvg = Math.round(
          recent.reduce((sum, c) => sum + Number(c.iqsScore), 0) / recent.length
        );
        const olderAvg = Math.round(
          older.reduce((sum, c) => sum + Number(c.iqsScore), 0) / older.length
        );
        prev2WkIqs = olderAvg;
        delta2Wk = recentAvg - olderAvg;
      }

      // Off-hours calculations for WhatsApp chats (IST: UTC+5:30)
      let offHoursTotal = 0;
      let offHoursAnswered = 0;
      agentChats.forEach((c) => {
        const dateStr = c.chatClosedAt || c.scoredAt;
        if (!dateStr) return;
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return;
        const istHours = (d.getUTCHours() + 5 + Math.floor((d.getUTCMinutes() + 30) / 60)) % 24;
        const istDay =
          (d.getUTCDay() +
            (d.getUTCHours() + 5 + Math.floor((d.getUTCMinutes() + 30) / 60) >= 24 ? 1 : 0)) %
          7;
        const isWeekend = istDay === 0 || istDay === 6;
        const isOffHoursTime = istHours < 10 || istHours >= 19;
        if (isWeekend || isOffHoursTime) {
          offHoursTotal += 1;
          offHoursAnswered += 1;
        }
      });
      const offHoursPickupRate =
        offHoursTotal > 0 ? Math.round((offHoursAnswered / offHoursTotal) * 100) : 0;

      items.push({
        id: `rm-${canonicalName.toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
        name: canonicalName,
        ini,
        tl,
        currentIqs,
        prev2WkIqs,
        delta2Wk,
        callsVolume: agentChats.length,
        focusArea: topWeakness,
        offHoursClientTotal: offHoursTotal,
        offHoursClientAnswered: offHoursAnswered,
        offHoursPickupRate,
      });
    });

    return items;
  }, [channel, rmScorecards, chats, teamLeads]);

  // 1. Top Performers (Top 5 by IQS score across the department; tie-breaker: volume)
  const topPerformers = useMemo(() => {
    return [...rmsList]
      .filter((rm) => rm.currentIqs > 0)
      .sort((a, b) => {
        if (b.currentIqs !== a.currentIqs) return b.currentIqs - a.currentIqs;
        return b.callsVolume - a.callsVolume;
      })
      .slice(0, 5);
  }, [rmsList]);

  // 2. Bottom Performers (anyone with an IQS score of 70% or below; tie-breaker: volume)
  const bottomPerformers = useMemo(() => {
    return [...rmsList]
      .filter((rm) => rm.currentIqs > 0 && rm.currentIqs <= 70.0)
      .sort((a, b) => {
        if (a.currentIqs !== b.currentIqs) return a.currentIqs - b.currentIqs;
        return b.callsVolume - a.callsVolume;
      })
      .slice(0, 5);
  }, [rmsList]);

  // 3. Most Improved (Top 5 net gainers across the department)
  const mostImproved = useMemo(() => {
    let list = [...rmsList]
      .filter((rm) => rm.delta2Wk > 0)
      .sort((a, b) => {
        if (Math.abs(b.delta2Wk - a.delta2Wk) > 0.05) return b.delta2Wk - a.delta2Wk;
        return b.currentIqs - a.currentIqs;
      })
      .slice(0, 5);
    if (list.length === 0 && rmsList.length > 0) {
      list = [...rmsList]
        .sort((a, b) => b.delta2Wk - a.delta2Wk)
        .slice(0, 5);
    }
    return list;
  }, [rmsList]);

  // 4. Top 5 Contributors during Non-Working Hours & Weekends
  const offHoursTopContributors = useMemo(() => {
    return [...rmsList]
      .filter((rm) => (rm.offHoursClientAnswered || 0) > 0)
      .sort((a, b) => {
        if (b.offHoursClientAnswered !== a.offHoursClientAnswered) {
          return b.offHoursClientAnswered - a.offHoursClientAnswered;
        }
        if (b.offHoursPickupRate !== a.offHoursPickupRate) {
          return b.offHoursPickupRate - a.offHoursPickupRate;
        }
        if (b.offHoursClientTotal !== a.offHoursClientTotal) {
          return b.offHoursClientTotal - a.offHoursClientTotal;
        }
        return b.currentIqs - a.currentIqs;
      })
      .slice(0, 5);
  }, [rmsList]);

  const totalDeptOffHoursAnswered = rmsList.reduce((sum, rm) => sum + (rm.offHoursClientAnswered || 0), 0);
  const totalDeptOffHoursReceived = rmsList.reduce((sum, rm) => sum + (rm.offHoursClientTotal || 0), 0);
  const deptOffHoursPickupRate =
    totalDeptOffHoursReceived > 0
      ? Math.round((totalDeptOffHoursAnswered / totalDeptOffHoursReceived) * 100)
      : 0;

  const getVolumeLabel = (vol: number) => {
    if (channel === 'chats') {
      return `${vol} ${vol === 1 ? 'chat' : 'chats'}`;
    }
    if (channel === 'emails') {
      return `${vol} ${vol === 1 ? 'email' : 'emails'}`;
    }
    return `${vol} ${vol === 1 ? 'call' : 'calls'}`;
  };

  return (
    <div style={{ fontFamily: 'Inter, sans-serif', maxWidth: 1280, margin: '0 auto', color: 'var(--dk-fg-18181b, #18181b)' }}>
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16, marginBottom: 24, borderBottom: '1px solid var(--dk-bd-e4e4e7, #e4e4e7)', paddingBottom: 16 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, color: 'var(--dk-fg-18181b, #18181b)', letterSpacing: '-0.02em' }}>
              RM Performance
            </h1>

            {/* Channel Toggles: Calls | Chats | Emails */}
            <div
              style={{
                display: 'inline-flex',
                background: 'var(--dk-bg-f4f4f5, #f4f4f5)',
                border: '1px solid var(--dk-bd-e4e4e7, #e4e4e7)',
                borderRadius: 8,
                padding: 2,
                gap: 2,
              }}
            >
              {CHANNELS.map((opt) => {
                const active = channel === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setChannel(opt.id)}
                    style={{
                      height: 28,
                      padding: '0 14px',
                      background: active ? '#ffffff' : 'transparent',
                      border: 0,
                      borderRadius: 6,
                      fontSize: 12,
                      fontFamily: 'inherit',
                      color: active ? '#18181b' : '#71717a',
                      fontWeight: active ? 600 : 500,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 7,
                      boxShadow: active ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <span
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: '50%',
                        background: active ? '#18181b' : '#d4d4d8',
                      }}
                    />
                    {opt.label}
                  </button>
                );
              })}
            </div>

            <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', background: 'var(--dk-bg-f4f4f5, #f4f4f5)', color: 'var(--dk-fg-52525b, #52525b)', border: '1px solid var(--dk-bd-e4e4e7, #e4e4e7)', padding: '4px 10px', borderRadius: 6 }}>
              Whole PCG Department · {channel === 'emails' ? '0 RMs' : `${rmsList.length} RMs`}
            </span>
          </div>
          <p style={{ fontSize: 13, color: 'var(--dk-fg-71717a, #71717a)', margin: '6px 0 0 0' }}>
            Top performers (Top 5 by IQS), bottom performers (IQS ≤ 70%), most improved performers, and top contributors during off-hours & weekends for the whole PCG department.
          </p>
        </div>
      </div>

      {/* ── 3 CATEGORIES GRID ────────────────────────────────────────────── */}
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
            {channel === 'emails' ? (
              <div style={{ padding: '36px 18px', textAlign: 'center', color: 'var(--dk-fg-71717a, #71717a)' }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--dk-fg-18181b, #18181b)', marginBottom: 2 }}>
                  No Email Evaluations Yet
                </div>
                <div style={{ fontSize: 11, color: 'var(--dk-fg-71717a, #71717a)' }}>
                  Email quality scoring and rankings will appear here once email evaluations are activated.
                </div>
              </div>
            ) : topPerformers.length === 0 ? (
              <div style={{ padding: '36px 18px', textAlign: 'center', color: 'var(--dk-fg-71717a, #71717a)' }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--dk-fg-18181b, #18181b)', marginBottom: 2 }}>
                  {loadingChats ? 'Loading Chat Evaluations...' : `No ${channel === 'chats' ? 'Chat' : 'Call'} Evaluations Recorded`}
                </div>
                <div style={{ fontSize: 11, color: 'var(--dk-fg-71717a, #71717a)' }}>
                  Rankings will populate automatically once {channel} evaluations are scored.
                </div>
              </div>
            ) : (
              topPerformers.map((rm, idx) => {
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
                          <span>{getVolumeLabel(rm.callsVolume)}</span>
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
                          onOpenScorecard && onOpenScorecard(rm.name, channel);
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
            {channel === 'emails' ? (
              <div style={{ padding: '36px 18px', textAlign: 'center', color: 'var(--dk-fg-71717a, #71717a)' }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--dk-fg-18181b, #18181b)', marginBottom: 2 }}>
                  No Email Evaluations Yet
                </div>
                <div style={{ fontSize: 11, color: 'var(--dk-fg-71717a, #71717a)' }}>
                  Coaching focus areas will populate once email evaluations are activated.
                </div>
              </div>
            ) : bottomPerformers.length === 0 ? (
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
                          onOpenScorecard && onOpenScorecard(rm.name, channel);
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
            {channel === 'emails' ? (
              <div style={{ padding: '36px 18px', textAlign: 'center', color: 'var(--dk-fg-71717a, #71717a)' }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--dk-fg-18181b, #18181b)', marginBottom: 2 }}>
                  No Email Evaluations Yet
                </div>
                <div style={{ fontSize: 11, color: 'var(--dk-fg-71717a, #71717a)' }}>
                  Rolling 2-week performance diffs will appear once email evaluations are scored.
                </div>
              </div>
            ) : mostImproved.length === 0 ? (
              <div style={{ padding: '36px 18px', textAlign: 'center', color: 'var(--dk-fg-71717a, #71717a)' }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--dk-fg-18181b, #18181b)', marginBottom: 2 }}>
                  No Trend Data Yet
                </div>
                <div style={{ fontSize: 11, color: 'var(--dk-fg-71717a, #71717a)' }}>
                  Rolling 2-week performance gains will populate once multi-week evaluations are recorded.
                </div>
              </div>
            ) : (
              mostImproved.map((rm, idx) => {
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
                          onOpenScorecard && onOpenScorecard(rm.name, channel);
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
      </div>

      {/* ── SEPARATE BANNER: TOP 5 NON-WORKING HOURS & WEEKENDS CONTRIBUTORS ── */}
      {channel !== 'emails' && (
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
                {channel === 'chats'
                  ? 'Highest contributors in responding to client WhatsApp chats received during non-working hours (<10:00 AM, ≥7:00 PM Mon–Fri) and weekends (Saturday & Sunday).'
                  : 'Highest contributors in answering valid client calls received during non-working hours (<10:00 AM, ≥7:00 PM Mon–Fri) and weekends (Saturday & Sunday).'}
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
                  {totalDeptOffHoursAnswered} {channel === 'chats' ? 'handled' : 'answered'}
                </strong>
                <span style={{ color: '#94a3b8' }}>/</span>
                <span style={{ color: '#64748b', fontSize: 11 }}>
                  {totalDeptOffHoursReceived} {channel === 'chats' ? 'chats' : 'calls'} ({deptOffHoursPickupRate}% {channel === 'chats' ? 'response' : 'pickup'})
                </span>
              </div>
            </div>
          </div>

          {/* Banner Content: Top 5 RMs Cards */}
          <div style={{ padding: '16px 20px' }}>
            {offHoursTopContributors.length === 0 ? (
              <div style={{ padding: '28px 16px', textAlign: 'center', color: 'var(--dk-fg-64748b, #64748b)' }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--dk-fg-334155, #334155)', marginBottom: 2 }}>
                  {channel === 'chats'
                    ? 'No Off-Hours or Weekend Client Chats Handled Yet'
                    : 'No Off-Hours or Weekend Client Calls Answered Yet'}
                </div>
                <div style={{ fontSize: 11, color: 'var(--dk-fg-94a3b8, #94a3b8)' }}>
                  {channel === 'chats'
                    ? 'Rankings will automatically appear here as Relationship Managers handle incoming client chats outside regular business hours.'
                    : 'Rankings will automatically appear here as Relationship Managers answer incoming client calls outside regular business hours.'}
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
                          title={`${rm.offHoursPickupRate}% ${channel === 'chats' ? 'response' : 'pickup'} rate during off-hours & weekends`}
                        >
                          {rm.offHoursPickupRate}% {channel === 'chats' ? 'response' : 'pickup'}
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

                      {/* Metric Highlight: Handled / Answered */}
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
                              {channel === 'chats' ? 'handled' : 'answered'}
                            </span>
                          </div>
                          <span style={{ fontSize: 10, color: 'var(--dk-fg-94a3b8, #94a3b8)', fontWeight: 500 }}>
                            of {rm.offHoursClientTotal} {channel === 'chats' ? 'chats' : 'calls'}
                          </span>
                        </div>
                      </div>

                      {/* Action Button */}
                      <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 2 }}>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenScorecard && onOpenScorecard(rm.name, channel);
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
          <strong>Ranking Methodology:</strong>{' '}
          {channel === 'chats'
            ? 'Off-Hours & Weekend banner highlights the top 5 RMs who handled client WhatsApp chats outside regular business hours (Mon–Fri <10:00 AM, ≥7:00 PM IST) and on weekends. Top category ranks the top 5 RMs by average chat IQS. Bottom category highlights RMs scoring 70% or below for active coaching. Most Improved tracks the top 5 net score gainers over a 14-day rolling window.'
            : channel === 'emails'
            ? 'Email quality scoring is scheduled for activation. Once live, Top, Bottom, and Most Improved performers will rank based on email QA benchmarks.'
            : 'Off-Hours & Weekend banner highlights the top 5 RMs who answered the highest volume of valid client calls outside regular business hours (Mon–Fri <10:00 AM, ≥7:00 PM IST) and on weekends. Top category ranks the top 5 RMs by average call IQS. Bottom category highlights RMs scoring 70% or below for active coaching. Most Improved tracks the top 5 net score gainers over a 14-day rolling window.'}
        </p>
        <span style={{ fontSize: 11, color: 'var(--dk-fg-a1a1aa, #a1a1aa)' }}>
          Updated for {channel === 'chats' ? 'Chats' : channel === 'emails' ? 'Emails' : 'Calls'} only
        </span>
      </div>
    </div>
  );
}
