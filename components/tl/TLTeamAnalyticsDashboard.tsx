'use client';

import { useState, useEffect, useCallback } from 'react';
import DateRangePicker from '@/components/quality/DateRangePicker';

// ── Types ──────────────────────────────────────────────────────────────────────

type Channel = 'chats' | 'calls' | 'emails';
type Period  = '7' | '30' | 'custom';

interface ChannelStats { csat_pct: number | null; iqs: number | null; volume: number; }

interface ParamData {
  key: string; label: string; weight: number;
  team_score: number | null; cx_score: number | null;
}

interface AgentChannelData {
  csat_pct: number | null; iqs: number | null; volume: number;
  params: Record<string, number | null>;
}

interface AgentData {
  name: string; ini: string;
  chats: AgentChannelData;
  calls: AgentChannelData;
  emails: null;
}

interface ChannelSummary { team: ChannelStats; cx: ChannelStats; params: ParamData[]; }

interface AnalyticsData {
  dateFrom: string; dateTo: string; agentCount: number;
  agents: AgentData[];
  channels: { chats: ChannelSummary; calls: ChannelSummary; emails: null };
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const fmtPct  = (v: number | null) => v == null ? '—' : `${v.toFixed(1)}%`;
const fmtIqs  = (v: number | null) => v == null ? '—' : `${Math.round(v)}%`;
const fmtVol  = (v: number)        => v.toLocaleString('en-IN');

const CHANNEL_LABELS: Record<Channel, string> = { chats: 'Chats', calls: 'Calls', emails: 'Emails' };
const PERIOD_LABELS: Record<Period, string>   = {
  '7': '7 days', '30': '30 days', custom: '',
};

function fmtDateDisplay(iso: string) {
  const d = new Date(iso + 'T00:00:00Z');
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function ChannelSeg({ value, onChange, channels = ['chats', 'calls', 'emails'] }: {
  value: Channel; onChange: (c: Channel) => void; channels?: Channel[];
}) {
  return (
    <div style={{
      display: 'inline-flex', background: 'var(--qa-fill-light)',
      border: '1px solid var(--qa-border)', borderRadius: 8, padding: 2, gap: 2,
    }}>
      {channels.map(ch => (
        <button key={ch} onClick={() => onChange(ch)} style={{
          height: 28, padding: '0 14px', background: value === ch ? 'var(--qa-card)' : 'transparent',
          border: 0, borderRadius: 6, fontSize: 13, fontFamily: 'inherit',
          color: value === ch ? 'var(--qa-text)' : 'var(--qa-text-2)',
          fontWeight: value === ch ? 600 : 400, cursor: 'pointer',
          display: 'inline-flex', alignItems: 'center', gap: 7,
          boxShadow: value === ch ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
        }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: value === ch ? 'var(--qa-text)' : 'var(--qa-text-4)' }} />
          {CHANNEL_LABELS[ch]}
        </button>
      ))}
    </div>
  );
}

function StatCard({ label, teamValue, cxValue }: { label: string; teamValue: string; cxValue: string }) {
  return (
    <div style={{ background: 'var(--qa-card)', border: '1px solid var(--qa-border)', borderRadius: 8, padding: 20 }}>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--qa-text-3)', marginBottom: 12 }}>
        {label}
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--qa-text-3)' }}>Team</span>
          <span style={{ fontSize: 32, fontWeight: 700, color: 'var(--qa-text)', lineHeight: 1 }}>{teamValue}</span>
        </div>
        <div style={{ width: 1, background: 'var(--qa-border)', alignSelf: 'stretch', marginBottom: 3 }} />
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, paddingBottom: 3 }}>
          <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--qa-text-3)' }}>CX</span>
          <span style={{ fontSize: 20, fontWeight: 600, color: 'var(--qa-text-2)', lineHeight: 1 }}>{cxValue}</span>
        </div>
      </div>
    </div>
  );
}

function StatCardSkeleton() {
  return (
    <div style={{ background: 'var(--qa-card)', border: '1px solid var(--qa-border)', borderRadius: 8, padding: 20 }}>
      <div style={{ width: 80, height: 12, background: 'var(--qa-fill-med)', borderRadius: 4, marginBottom: 12 }} />
      <div style={{ width: 120, height: 36, background: 'var(--qa-fill-med)', borderRadius: 4 }} />
    </div>
  );
}

function ParamRow({ p }: { p: ParamData }) {
  const team = p.team_score ?? 0;
  const cx   = p.cx_score ?? 0;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 16,
      padding: '8px 0', borderBottom: '1px solid var(--qa-border-sub)',
    }}>
      <span style={{ width: 230, flexShrink: 0, fontSize: 14, fontWeight: 600, color: 'var(--qa-text)' }}>
        {p.label}
      </span>
      <span style={{ width: 44, flexShrink: 0, fontSize: 12, color: 'var(--qa-text-3)', fontFamily: 'ui-monospace, monospace', textAlign: 'right' }}>
        {p.weight}%
      </span>
      <span style={{ flex: 1, height: 10, background: 'var(--qa-fill-med)', borderRadius: 999, position: 'relative' }}>
        <span style={{ display: 'block', height: '100%', width: `${team}%`, background: 'var(--qa-gray-700)', borderRadius: 999 }} />
        {p.cx_score != null && (
          <span
            style={{ position: 'absolute', top: -4, left: `${cx}%`, width: 0, height: 18, borderLeft: '2px dashed var(--qa-text-2)', transform: 'translateX(-1px)' }}
            title={`Dept avg ${cx}%`}
          />
        )}
      </span>
      <span style={{ width: 44, flexShrink: 0, textAlign: 'right', fontSize: 14, fontWeight: 600, fontFamily: 'ui-monospace, monospace', color: 'var(--qa-text)' }}>
        {p.team_score != null ? `${Math.round(p.team_score)}%` : '—'}
      </span>
    </div>
  );
}

function EmptyChannelState({ channel }: { channel: Channel }) {
  return (
    <div style={{ padding: '48px 20px', textAlign: 'center', color: 'var(--qa-text-3)', fontSize: 13 }}>
      {channel === 'emails' ? 'Email data is coming soon.' : 'No data available for this channel in the selected period.'}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function TLTeamAnalyticsDashboard() {
  const [channel, setChannel]               = useState<Channel>('chats');
  const [period,  setPeriod]                = useState<Period>('30');
  const [customFrom, setCustomFrom]         = useState('');
  const [customTo,   setCustomTo]           = useState('');
  const [showPicker, setShowPicker]         = useState(false);
  const [activeTab, setActiveTab]           = useState<'summary' | 'breakdown'>('summary');
  const [breakdownCh, setBreakdownCh]       = useState<Channel>('chats');

  const [data,    setData]    = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  const periodLabel = period === 'custom' && customFrom && customTo
    ? `${fmtDateDisplay(customFrom)} – ${fmtDateDisplay(customTo)}`
    : PERIOD_LABELS[period];

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      let url = `/api/cx/tl/team-analytics?period=${period}`;
      if (period === 'custom' && customFrom && customTo) url += `&from=${customFrom}&to=${customTo}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(await res.text());
      setData(await res.json());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, [period, customFrom, customTo]);

  useEffect(() => { fetchData(); }, [fetchData]);

  function applyCustom(from: string, to: string) {
    setCustomFrom(from);
    setCustomTo(to);
    setPeriod('custom');
    setShowPicker(false);
  }

  // Current channel summary (for stat cards + params)
  const chSummary = data?.channels[channel];
  // Current channel data for agents
  const agentChData = (agent: AgentData): AgentChannelData | null =>
    channel === 'emails' ? null : agent[channel];

  const breakdownChData = (agent: AgentData): AgentChannelData | null =>
    breakdownCh === 'emails' ? null : agent[breakdownCh];

  const params = chSummary?.params ?? [];
  const breakdownParams = (breakdownCh !== 'emails' && data?.channels[breakdownCh]?.params) || [];

  return (
    <div>
      {/* ── Page header ───────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, gap: 24, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <h1 style={{ fontSize: 24, fontWeight: 600, margin: 0, whiteSpace: 'nowrap' }}>Team Analytics</h1>
          <ChannelSeg value={channel} onChange={ch => { setChannel(ch); }} />
        </div>

        {/* Time range */}
        <div style={{ position: 'relative' }}>
          <div style={{
            display: 'inline-flex', border: '1px solid var(--qa-border)',
            borderRadius: 8, overflow: 'hidden', background: 'var(--qa-card)',
          }}>
            {(['7', '30', 'custom'] as const).map(p => (
              <button key={p} onClick={() => {
                if (p === 'custom') { setShowPicker(true); return; }
                setPeriod(p);
                setCustomFrom('');
                setCustomTo('');
                setShowPicker(false);
              }} style={{
                height: 32, padding: '0 14px', background: period === p ? 'var(--qa-text)' : 'transparent',
                border: 0, borderRight: '1px solid var(--qa-border)', fontSize: 13,
                color: period === p ? '#fff' : 'var(--qa-text-2)', cursor: 'pointer', fontFamily: 'inherit',
              }}>
                {p === '7' ? '7 days' : p === '30' ? '30 days' : period === 'custom' && customFrom ? `${fmtDateDisplay(customFrom)} – ${fmtDateDisplay(customTo)}` : 'Custom range'}
              </button>
            ))}
          </div>

          {showPicker && (
            <DateRangePicker
              onApply={applyCustom}
              onCancel={() => {
                setShowPicker(false);
                if (period === 'custom' && !customFrom) setPeriod('30');
              }}
            />
          )}
        </div>
      </div>

      {error && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '12px 16px', color: '#b91c1c', fontSize: 13, marginBottom: 24 }}>
          {error}
        </div>
      )}

      {/* ── Stat cards ────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 32 }}>
        {loading ? (
          [0, 1, 2].map(i => <StatCardSkeleton key={i} />)
        ) : channel === 'emails' ? (
          [0, 1, 2].map(i => (
            <div key={i} style={{ background: 'var(--qa-card)', border: '1px solid var(--qa-border)', borderRadius: 8, padding: 20 }}>
              <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--qa-text-4)', marginBottom: 12 }}>
                {['CSAT %', 'IQS', 'Emails Handled'][i]}
              </div>
              <span style={{ fontSize: 20, color: 'var(--qa-text-4)' }}>—</span>
            </div>
          ))
        ) : (
          <>
            <StatCard
              label="CSAT %"
              teamValue={fmtPct(chSummary?.team.csat_pct ?? null)}
              cxValue={fmtPct(chSummary?.cx.csat_pct ?? null)}
            />
            <StatCard
              label="IQS"
              teamValue={fmtIqs(chSummary?.team.iqs ?? null)}
              cxValue={fmtIqs(chSummary?.cx.iqs ?? null)}
            />
            <StatCard
              label={`${CHANNEL_LABELS[channel]} Handled`}
              teamValue={fmtVol(chSummary?.team.volume ?? 0)}
              cxValue={fmtVol(chSummary?.cx.volume ?? 0)}
            />
          </>
        )}
      </div>

      {/* ── IQS by Parameter ──────────────────────────────────────────── */}
      <section style={{ marginBottom: 32 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>IQS by Parameter — Your Team</h2>
          <span style={{ fontSize: 11, color: 'var(--qa-text-3)', fontStyle: 'italic' }}>
            {periodLabel} · avg across all evaluated {CHANNEL_LABELS[channel].toLowerCase()}
          </span>
        </div>

        <div style={{ background: 'var(--qa-card)', border: '1px solid var(--qa-border)', borderRadius: 8, overflow: 'hidden' }}>
          <div style={{
            padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            borderBottom: '1px solid var(--qa-border)',
          }}>
            <span style={{ fontSize: 14, fontWeight: 500 }}>
              {loading ? '…' : `${params.length} quality parameters · weighted`}
            </span>
          </div>

          {/* Legend */}
          <div style={{
            display: 'flex', gap: 24, padding: '10px 20px',
            borderBottom: '1px solid var(--qa-border-sub)', fontSize: 12, color: 'var(--qa-text-2)',
          }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 18, height: 8, background: 'var(--qa-gray-700)', borderRadius: 999 }} />
              Your team
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 0, height: 14, borderLeft: '2px dashed var(--qa-text-2)' }} />
              Dept average
            </span>
          </div>

          <div style={{ padding: '12px 20px' }}>
            {loading ? (
              [0,1,2,3,4].map(i => (
                <div key={i} style={{ height: 36, display: 'flex', alignItems: 'center', gap: 16, padding: '8px 0', borderBottom: '1px solid var(--qa-border-sub)' }}>
                  <div style={{ width: 230, height: 14, background: 'var(--qa-fill-med)', borderRadius: 4 }} />
                  <div style={{ flex: 1, height: 10, background: 'var(--qa-fill-med)', borderRadius: 999 }} />
                </div>
              ))
            ) : channel === 'emails' ? (
              <EmptyChannelState channel="emails" />
            ) : params.length === 0 ? (
              <EmptyChannelState channel={channel} />
            ) : (
              params.map(p => (
                <ParamRow key={p.key} p={p} />
              ))
            )}
          </div>
        </div>
      </section>

      {/* ── Team Member Performance ───────────────────────────────────── */}
      <section style={{ marginBottom: 32 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>Team Member Performance</h2>
          <span style={{ fontSize: 11, color: 'var(--qa-text-3)', fontStyle: 'italic' }}>
            {loading ? '…' : `${data?.agentCount ?? 0} active members`} · click a tab to switch view
          </span>
        </div>

        <div style={{ background: 'var(--qa-card)', border: '1px solid var(--qa-border)', borderRadius: 8, overflow: 'hidden' }}>
          {/* Panel header with tabs */}
          <div style={{
            padding: '0 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            borderBottom: '1px solid var(--qa-border)',
          }}>
            <div style={{ display: 'flex', gap: 4 }}>
              {(['summary', 'breakdown'] as const).map(tab => (
                <button key={tab} onClick={() => setActiveTab(tab)} style={{
                  height: 40, padding: '0 16px', background: 'transparent', border: 0,
                  borderBottom: activeTab === tab ? '2px solid var(--qa-text)' : '2px solid transparent',
                  marginBottom: -1, fontSize: 13, fontFamily: 'inherit', cursor: 'pointer',
                  color: activeTab === tab ? 'var(--qa-text)' : 'var(--qa-text-2)',
                  fontWeight: activeTab === tab ? 600 : 400,
                }}>
                  {tab === 'summary' ? 'Summary' : 'Parameter Breakdown'}
                </button>
              ))}
            </div>
          </div>

          {/* Summary tab */}
          {activeTab === 'summary' && (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <Th left>Agent</Th>
                    <Th>CSAT %</Th>
                    <Th>IQS</Th>
                    <Th active={channel === 'chats'}>Chats</Th>
                    <Th active={channel === 'calls'}>Calls</Th>
                    <Th active={channel === 'emails'}>Emails</Th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    [0,1,2,3].map(i => (
                      <tr key={i}>
                        <td style={td} colSpan={6}>
                          <div style={{ height: 14, background: 'var(--qa-fill-light)', borderRadius: 4, width: '60%', animation: 'pulse 1.5s ease-in-out infinite' }} />
                        </td>
                      </tr>
                    ))
                  ) : !data?.agents.length ? (
                    <tr><td colSpan={6} style={{ ...td, textAlign: 'center', color: 'var(--qa-text-3)', padding: '32px 16px' }}>No agent data for this period</td></tr>
                  ) : (
                    data.agents.map(agent => {
                      const ch = agentChData(agent);
                      return (
                        <SummaryRow key={agent.name} agent={agent} chData={ch} activeChannel={channel} />
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* Parameter Breakdown tab */}
          {activeTab === 'breakdown' && (
            <>
              {/* Independent channel switcher */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 20px', borderBottom: '1px solid var(--qa-border-sub)' }}>
                <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--qa-text-3)' }}>Channel</span>
                <ChannelSeg value={breakdownCh} onChange={setBreakdownCh} />
              </div>
              <div style={{ fontSize: 11, color: 'var(--qa-text-3)', padding: '8px 20px', borderBottom: '1px solid var(--qa-border-sub)' }}>
                Scroll right to see all parameters →
              </div>
              <div style={{ overflowX: 'auto' }}>
                {loading ? (
                  <div style={{ padding: '32px 20px', color: 'var(--qa-text-3)', fontSize: 13 }}>Loading…</div>
                ) : breakdownCh === 'emails' ? (
                  <EmptyChannelState channel="emails" />
                ) : !data?.agents.length ? (
                  <EmptyChannelState channel={breakdownCh} />
                ) : (
                  <table style={{ borderCollapse: 'collapse', width: 'max-content', minWidth: '100%' }}>
                    <thead>
                      <tr>
                        <th style={stickyTh}>Agent</th>
                        {breakdownParams.map(p => (
                          <th key={p.key} title={p.label} style={paramTh}>{p.label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.agents.map(agent => {
                        const chData = breakdownChData(agent);
                        return (
                          <tr key={agent.name} style={{ borderBottom: '1px solid var(--qa-border-sub)' }}>
                            <td style={stickyTd}>{agent.name}</td>
                            {breakdownParams.map(p => {
                              const val = chData?.params[p.key] ?? null;
                              return (
                                <td key={p.key} style={{ ...paramTd, color: val == null ? 'var(--qa-text-4)' : 'var(--qa-text)' }}>
                                  {val != null ? `${Math.round(val)}` : '—'}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          )}
        </div>
      </section>

      <p style={{ fontSize: 11, color: 'var(--qa-text-3)', fontStyle: 'italic', margin: '0 0 16px' }}>
        CSAT % = good ratings / all rated · IQS = avg internal quality score · Parameter scores = pass rate
      </p>
    </div>
  );
}

// ── Table cell style helpers ───────────────────────────────────────────────────

const td: React.CSSProperties = {
  height: 48, padding: '0 16px', borderBottom: '1px solid var(--qa-border-sub)',
  fontSize: 14, color: 'var(--qa-text)', verticalAlign: 'middle',
};

const stickyTh: React.CSSProperties = {
  position: 'sticky', left: 0, zIndex: 2,
  width: 180, minWidth: 180, textAlign: 'left', padding: '10px 16px',
  background: 'var(--qa-gray-50)', borderRight: '1px solid var(--qa-border)',
  borderBottom: '1px solid var(--qa-border)', fontSize: 11, textTransform: 'uppercase',
  letterSpacing: '0.04em', color: 'var(--qa-text-2)', fontWeight: 500,
  boxShadow: '6px 0 8px -6px rgba(0,0,0,0.12)',
};

const stickyTd: React.CSSProperties = {
  position: 'sticky', left: 0, zIndex: 2,
  width: 180, minWidth: 180, textAlign: 'left', padding: '0 16px',
  background: 'var(--qa-card)', borderRight: '1px solid var(--qa-border)',
  borderBottom: '1px solid var(--qa-border-sub)', height: 44,
  fontSize: 13, color: 'var(--qa-text)', fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
  boxShadow: '6px 0 8px -6px rgba(0,0,0,0.12)',
};

const paramTh: React.CSSProperties = {
  background: 'var(--qa-gray-50)', borderBottom: '1px solid var(--qa-border)',
  fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--qa-text-2)',
  fontWeight: 500, textAlign: 'center', padding: '10px 8px',
  lineHeight: 1.25, verticalAlign: 'bottom', width: 100, minWidth: 100, whiteSpace: 'normal',
};

const paramTd: React.CSSProperties = {
  height: 44, borderBottom: '1px solid var(--qa-border-sub)',
  fontSize: 13, textAlign: 'center', fontFamily: 'ui-monospace, monospace',
  width: 100, minWidth: 100,
};

// ── Th helper ─────────────────────────────────────────────────────────────────

function Th({ children, left, active }: { children: React.ReactNode; left?: boolean; active?: boolean }) {
  return (
    <th style={{
      height: 40, background: active ? 'var(--qa-gray-100)' : 'var(--qa-gray-50)',
      borderBottom: '1px solid var(--qa-border)',
      fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em',
      color: active ? 'var(--qa-text)' : 'var(--qa-text-2)', fontWeight: active ? 700 : 500,
      textAlign: left ? 'left' : 'right', padding: '0 16px', whiteSpace: 'nowrap',
    }}>
      {children}
    </th>
  );
}

// ── SummaryRow ────────────────────────────────────────────────────────────────

function SummaryRow({ agent, chData, activeChannel }: {
  agent: AgentData; chData: AgentChannelData | null; activeChannel: Channel;
}) {
  const numTd = (active: boolean): React.CSSProperties => ({
    ...td, textAlign: 'right', fontFamily: 'ui-monospace, monospace', fontSize: 13,
    background: active ? 'var(--qa-gray-100)' : 'transparent',
    fontWeight: active ? 600 : 400, color: 'var(--qa-text)',
  });
  return (
    <tr style={{ borderBottom: '1px solid var(--qa-border-sub)' }}>
      <td style={td}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{
            width: 28, height: 28, borderRadius: '50%', background: 'var(--qa-fill-med)',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 11, fontWeight: 600, color: 'var(--qa-text-2)',
          }}>
            {agent.ini}
          </span>
          <span style={{ fontSize: 14 }}>{agent.name}</span>
        </span>
      </td>
      <td style={numTd(false)}>{chData ? fmtPct(chData.csat_pct) : '—'}</td>
      <td style={numTd(false)}>{chData ? fmtIqs(chData.iqs) : '—'}</td>
      <td style={numTd(activeChannel === 'chats')}>{fmtVol(agent.chats.volume)}</td>
      <td style={numTd(activeChannel === 'calls')}>{fmtVol(agent.calls.volume)}</td>
      <td style={numTd(activeChannel === 'emails')}>—</td>
    </tr>
  );
}
