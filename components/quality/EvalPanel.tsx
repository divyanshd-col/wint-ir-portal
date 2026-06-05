'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { PARAM_ORDER, PARAM_NAMES, WEIGHTS, calculateIQS } from '@/lib/quality';
import type { ParamScore } from '@/lib/quality';

// ── Key maps ──────────────────────────────────────────────────────────────────

const DB_TO_PASCAL: Record<string, string> = {
  technical:    'Technical',
  all_questions:'AllQuestions',
  expectation:  'Expectation',
  contextual:   'Contextual',
  follow_up:    'FollowUp',
  sentences:    'Sentences',
  process:      'Process',
  opening:      'Opening',
  call:         'Call',
  grammar:      'Grammar',
  empathy:      'Empathy',
};
const PASCAL_TO_DB: Record<string, string> = Object.fromEntries(
  Object.entries(DB_TO_PASCAL).map(([d, p]) => [p, d])
);

// Param weight as display string
function pctLabel(key: string): string {
  const w = WEIGHTS[key];
  return w != null ? `${Math.round(w * 100)}%` : '';
}

// DB score (true/false/null) → display string
function scoreToParamScore(s: boolean | null): ParamScore {
  if (s === true)  return 'Yes';
  if (s === false) return 'No';
  return 'NA';
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface ParamState {
  score:     boolean | null;
  reasoning: string;
}

export interface EvalPanelProps {
  chatId:       string;
  agentName:    string;
  iqsScore:     number;
  closedAt:     string;
  disposition:  string;
  parameters:   Record<string, { score: boolean | null; reasoning: string }>;
  mode:         'submit' | 'resolve';
  dispute?: {
    raisedBy:       string;
    raisedByName:   string;
    agentNote:      string;
    challengedParams: { param: string; note: string }[];  // PascalCase param keys
  };
  flagId?:      string;
  onDone:       () => void;
  onClose:      () => void;
  colSpan:      number;
}

// ── Message transcript types ──────────────────────────────────────────────────

interface TMessage {
  sender:       string;
  sender_name?: string;
  content:      string;
  timestamp?:   string;
  sender_type?: string;
}

// ── SVG Score Ring ────────────────────────────────────────────────────────────

function ScoreRing({ score }: { score: number }) {
  const RING_C   = 169.6;
  const offset   = ((100 - Math.max(0, Math.min(100, score))) / 100 * RING_C).toFixed(1);
  return (
    <svg width="64" height="64" viewBox="0 0 64 64" style={{ flexShrink: 0 }}>
      <circle cx="32" cy="32" r="27" fill="none" stroke="var(--qa-fill-med)" strokeWidth="5" />
      <circle cx="32" cy="32" r="27" fill="none" stroke="var(--qa-gray-700)" strokeWidth="5"
        strokeLinecap="round" strokeDasharray="169.6" strokeDashoffset={offset}
        transform="rotate(-90 32 32)" style={{ transition: 'stroke-dashoffset 0.3s' }} />
      <text x="32" y="33" textAnchor="middle" dominantBaseline="central"
        fontSize="18" fontWeight="700" fill="var(--qa-text)" fontFamily="inherit">
        {score}
      </text>
    </svg>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function EvalPanel({
  chatId, agentName, iqsScore, closedAt, disposition,
  parameters, mode, dispute, flagId, onDone, onClose, colSpan,
}: EvalPanelProps) {

  // Initialise param state from DB parameters (snake_case keys)
  function initParams(): Record<string, ParamState> {
    const state: Record<string, ParamState> = {};
    for (const pascal of PARAM_ORDER) {
      const dbKey = PASCAL_TO_DB[pascal];
      const raw   = parameters[dbKey] ?? parameters[pascal] ?? {};
      state[pascal] = { score: raw.score ?? null, reasoning: raw.reasoning ?? '' };
    }
    return state;
  }

  const [paramState, setParamState] = useState<Record<string, ParamState>>(initParams);
  const [transcript, setTranscript]  = useState<TMessage[] | null>(null);
  const [txLoading,  setTxLoading]   = useState(true);
  const [submitting, setSubmitting]  = useState(false);
  const [submitErr,  setSubmitErr]   = useState('');

  // Build challenged params map (keyed by PascalCase)
  const disputeMap = new Map<string, { note: string }>(
    (dispute?.challengedParams ?? []).map(d => [d.param, { note: d.note }])
  );

  // Live IQS: recompute when params change
  const liveIqs = (() => {
    const scores: Record<string, ParamScore> = {};
    for (const [key, s] of Object.entries(paramState)) {
      scores[key] = scoreToParamScore(s.score);
    }
    return calculateIQS(scores);
  })();

  const failCount = Object.values(paramState).filter(s => s.score === false).length;

  // Check if anything changed from original
  const isModified = (() => {
    for (const pascal of PARAM_ORDER) {
      const orig = initParams()[pascal];
      const cur  = paramState[pascal];
      if (cur.score !== orig.score) return true;
      if ((cur.reasoning ?? '').trim() !== (orig.reasoning ?? '').trim()) return true;
    }
    return false;
  })();

  const primaryLabel = mode === 'resolve' ? (isModified ? 'Override & Resolve' : 'Resolve')
    : (isModified ? 'Override' : 'Submit');

  // Fetch transcript on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/quality/transcript?chatId=${encodeURIComponent(chatId)}`);
        if (!res.ok) throw new Error('Failed');
        const data = await res.json();
        if (!cancelled) setTranscript(Array.isArray(data) ? data : (data.messages ?? []));
      } catch {
        if (!cancelled) setTranscript([]);
      } finally {
        if (!cancelled) setTxLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [chatId]);

  // Update a single param
  function setScore(pascal: string, score: boolean | null) {
    setParamState(prev => ({ ...prev, [pascal]: { ...prev[pascal], score } }));
  }
  function setReasoning(pascal: string, reasoning: string) {
    setParamState(prev => ({ ...prev, [pascal]: { ...prev[pascal], reasoning } }));
  }

  // Reset to original
  function reset() {
    setParamState(initParams());
    setSubmitErr('');
  }

  // Submit evaluation
  async function submit() {
    setSubmitting(true);
    setSubmitErr('');
    try {
      const action = mode === 'resolve' ? 'resolve'
        : (isModified ? 'override' : 'submit');

      const body: any = { action, flagId };

      if (isModified) {
        const params: Record<string, { score: boolean | null; reasoning: string }> = {};
        for (const pascal of PARAM_ORDER) {
          const dbKey = PASCAL_TO_DB[pascal];
          params[dbKey] = { score: paramState[pascal].score, reasoning: paramState[pascal].reasoning };
        }
        body.parameters = params;
      }

      const res = await fetch(`/api/cx/qa/review/${encodeURIComponent(chatId)}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed');
      onDone();
    } catch (e: any) {
      setSubmitErr(e.message ?? 'Submit failed');
    } finally {
      setSubmitting(false);
    }
  }

  // ── Date formatting ───────────────────────────────────────────────────────
  function fmtDate(iso: string) {
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  // ── Transcript helpers ────────────────────────────────────────────────────
  const BOT_NAMES  = new Set(['bot', 'myra', 'wint bot', 'wintbot', 'robylon', 'robylon ai']);
  const USER_NAMES = new Set(['user', 'customer', 'visitor']);
  function senderType(s: string): 'user' | 'bot' | 'agent' | 'system' {
    const sl = s.toLowerCase();
    if (sl === 'system') return 'system';
    if (USER_NAMES.has(sl))  return 'user';
    if (BOT_NAMES.has(sl))   return 'bot';
    return 'agent';
  }

  // ── Styles ────────────────────────────────────────────────────────────────
  const td: React.CSSProperties = {
    padding: 0, borderBottom: '1px solid var(--qa-border)',
    background: 'var(--qa-gray-50)',
  };
  const panelWrap: React.CSSProperties = {
    display: 'flex', height: 520,
    border: '1px solid var(--qa-border)', borderRadius: 8,
    background: 'var(--qa-card)', overflow: 'hidden',
    margin: 16,
  };
  const leftPanel: React.CSSProperties = {
    width: 400, flexShrink: 0,
    borderRight: '1px solid var(--qa-border)',
    display: 'flex', flexDirection: 'column',
  };
  const rightPanel: React.CSSProperties = {
    flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column',
  };

  return (
    <tr className="eval-panel-row">
      <td colSpan={colSpan} style={td}>
        <div style={panelWrap}>

          {/* ── LEFT ── */}
          <div style={leftPanel}>
            {/* Head */}
            <div style={{ padding: 16, borderBottom: '1px solid var(--qa-border)', flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <ScoreRing score={liveIqs} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 16, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    {agentName}
                    <span style={{
                      height: 20, padding: '0 8px', border: '1px solid var(--qa-border)',
                      borderRadius: 999, fontSize: 12, color: 'var(--qa-text-2)',
                      display: 'inline-flex', alignItems: 'center', fontWeight: 400,
                    }}>
                      {failCount} fail{failCount !== 1 ? 's' : ''}
                    </span>
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--qa-text-3)', marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: '0 8px' }}>
                    <span style={{ fontFamily: 'ui-monospace, monospace', color: 'var(--qa-text-2)' }}>{chatId}</span>
                    <span>·</span>
                    <span>{fmtDate(closedAt)}</span>
                    <span>·</span>
                    <span>{disposition}</span>
                    {dispute && (
                      <>
                        <span>·</span>
                        <span style={{ fontWeight: 500, color: 'var(--qa-text)' }}>
                          Disputed by {dispute.raisedBy} ({dispute.raisedByName})
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Dispute banner */}
              {dispute && dispute.challengedParams.length > 0 && (
                <div style={{
                  marginTop: 12, padding: '8px 12px',
                  border: '1px solid var(--qa-border)', borderRadius: 6,
                  background: 'var(--qa-gray-50)', fontSize: 12,
                  color: 'var(--qa-text-2)', lineHeight: 1.6,
                  display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8,
                }}>
                  <span style={{
                    height: 18, padding: '0 7px', borderRadius: 999,
                    background: 'var(--qa-gray-700)', color: '#fff',
                    fontSize: 10, fontWeight: 600, textTransform: 'uppercase',
                    letterSpacing: '0.04em', display: 'inline-flex', alignItems: 'center',
                  }}>
                    {dispute.raisedBy} disputed
                  </span>
                  {dispute.challengedParams.map(d => (
                    <strong key={d.param} style={{ color: 'var(--qa-text)' }}>
                      {PARAM_NAMES[d.param] ?? d.param}
                    </strong>
                  ))}
                </div>
              )}
            </div>

            {/* Param list */}
            <div style={{
              fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em',
              color: 'var(--qa-text-3)', padding: '16px 16px 4px',
            }}>
              Parameter Scores
            </div>
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {PARAM_ORDER.map(pascal => {
                const st       = paramState[pascal];
                const disputed = disputeMap.get(pascal);
                return (
                  <div key={pascal} style={{
                    padding: '14px 16px',
                    borderBottom: '1px solid var(--qa-border-sub)',
                    ...(disputed ? {
                      background: 'var(--qa-gray-50)',
                      boxShadow: 'inset 3px 0 0 var(--qa-gray-700)',
                    } : {}),
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 13, fontWeight: 500, flex: 1, minWidth: 0 }}>
                        {PARAM_NAMES[pascal]}
                        {disputed && (
                          <span style={{
                            marginLeft: 8, height: 18, padding: '0 7px', borderRadius: 999,
                            background: 'var(--qa-gray-700)', color: '#fff',
                            fontSize: 10, fontWeight: 600, textTransform: 'uppercase',
                            letterSpacing: '0.04em', display: 'inline-flex', alignItems: 'center',
                            verticalAlign: 'middle',
                          }}>
                            {dispute?.raisedBy} disputes
                          </span>
                        )}
                      </span>
                      {/* Yes / No / NA buttons */}
                      <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                        {([true, false, null] as const).map((val, i) => {
                          const label = val === true ? 'Yes' : val === false ? 'No' : 'NA';
                          const isSel = st.score === val;
                          return (
                            <button key={i} onClick={() => setScore(pascal, val)} style={{
                              height: 28, padding: '0 9px', borderRadius: 8,
                              border: '1px solid var(--qa-border)',
                              background: isSel ? 'var(--qa-gray-700)' : 'var(--qa-card)',
                              color: isSel ? '#fff' : 'var(--qa-text-2)',
                              fontSize: 12, fontFamily: 'inherit', cursor: 'pointer',
                            }}>
                              {label}
                            </button>
                          );
                        })}
                      </div>
                      <span style={{ fontSize: 11, color: 'var(--qa-text-3)', fontFamily: 'ui-monospace, monospace', flexShrink: 0 }}>
                        {pctLabel(pascal)}
                      </span>
                    </div>

                    {/* Reasoning */}
                    <textarea
                      value={st.reasoning}
                      onChange={e => setReasoning(pascal, e.target.value)}
                      placeholder="Add reasoning…"
                      rows={st.reasoning ? undefined : 1}
                      style={{
                        marginTop: 8, width: '100%', resize: 'vertical',
                        border: '1px solid transparent', borderRadius: 6,
                        padding: '6px 8px', fontSize: 12, color: 'var(--qa-text-2)',
                        lineHeight: 1.5, fontFamily: 'inherit',
                        background: 'transparent', outline: 'none',
                        transition: 'background 0.12s, border-color 0.12s',
                      }}
                      onFocus={e => {
                        e.target.style.background = 'var(--qa-card)';
                        e.target.style.borderColor = 'var(--qa-text)';
                      }}
                      onBlur={e => {
                        e.target.style.background = 'transparent';
                        e.target.style.borderColor = 'transparent';
                      }}
                    />

                    {/* Dispute claim */}
                    {disputed && (
                      <div style={{
                        marginTop: 8, fontSize: 12, color: 'var(--qa-text-2)',
                        background: 'var(--qa-card)', border: '1px solid var(--qa-border)',
                        borderRadius: 6, padding: '8px 10px', lineHeight: 1.5,
                      }}>
                        <div style={{
                          height: 18, padding: '0 7px', borderRadius: 999,
                          background: 'var(--qa-gray-700)', color: '#fff',
                          fontSize: 10, fontWeight: 600, textTransform: 'uppercase',
                          letterSpacing: '0.04em', display: 'inline-flex', alignItems: 'center',
                          marginBottom: 4,
                        }}>
                          {dispute?.raisedBy} note
                        </div>
                        <div>{disputed.note}</div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Footer */}
            {submitErr && (
              <div style={{ margin: '0 16px', padding: '8px 12px', background: '#fee2e2', borderRadius: 6, fontSize: 12, color: '#b91c1c' }}>
                {submitErr}
              </div>
            )}
          </div>

          {/* ── RIGHT ── */}
          <div style={rightPanel}>
            {/* Right header */}
            <div style={{
              padding: '0 16px', borderBottom: '1px solid var(--qa-border)',
              display: 'flex', alignItems: 'center', gap: 8, height: 52, flexShrink: 0,
            }}>
              <span style={{ fontSize: 13, color: 'var(--qa-text-3)' }}>
                {transcript == null ? '…' : `${transcript.length} messages`}
              </span>
              {/* Reset button */}
              <button onClick={reset} title="Reset to original" style={{
                width: 28, height: 28, border: '1px solid var(--qa-border)', borderRadius: 8,
                background: 'var(--qa-card)', color: 'var(--qa-text-2)', cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5"/>
                </svg>
              </button>
              <div style={{ flex: 1 }} />
              {/* Primary action */}
              <button
                onClick={submit}
                disabled={submitting}
                style={{
                  height: 36, padding: '0 16px', borderRadius: 8,
                  fontFamily: 'inherit', fontSize: 13, fontWeight: 500,
                  cursor: submitting ? 'not-allowed' : 'pointer',
                  display: 'inline-flex', alignItems: 'center',
                  border: '1px solid var(--qa-gray-700)',
                  background: submitting ? 'var(--qa-fill-med)' : 'var(--qa-gray-700)',
                  color: '#fff',
                  opacity: submitting ? 0.7 : 1,
                }}
              >
                {submitting ? 'Saving…' : primaryLabel}
              </button>
              {/* Close */}
              <button onClick={onClose} style={{
                width: 28, height: 28, border: '1px solid var(--qa-border)', borderRadius: 8,
                background: 'var(--qa-card)', color: 'var(--qa-text-2)', cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 16, lineHeight: 1,
              }}>×</button>
            </div>

            {/* Transcript */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 0 }}>
              {txLoading ? (
                <div style={{ color: 'var(--qa-text-3)', fontSize: 13, textAlign: 'center', marginTop: 40 }}>
                  Loading transcript…
                </div>
              ) : !transcript?.length ? (
                <div style={{ color: 'var(--qa-text-3)', fontSize: 13, textAlign: 'center', marginTop: 40 }}>
                  No transcript available
                </div>
              ) : (
                transcript.map((msg, idx) => {
                  const type = senderType(msg.sender_type ?? msg.sender);
                  const prev = idx > 0 ? senderType(transcript[idx - 1].sender_type ?? transcript[idx - 1].sender) : null;
                  const gap  = prev === null ? 0 : prev === type ? 8 : 16;

                  if (type === 'system') {
                    return (
                      <div key={idx} style={{ marginTop: gap + 'px', textAlign: 'center' }}>
                        <div style={{
                          background: 'var(--qa-gray-50)', border: '1px solid var(--qa-border-sub)',
                          borderRadius: 8, fontSize: 12, fontStyle: 'italic',
                          color: 'var(--qa-text-2)', padding: '8px 14px', display: 'inline-block',
                          maxWidth: '90%', lineHeight: 1.5,
                        }}>
                          {msg.content}
                        </div>
                      </div>
                    );
                  }

                  const isRight = type === 'agent' || type === 'bot';
                  const label   = (msg.sender_name ?? msg.sender) + (msg.timestamp
                    ? ' · ' + new Date(msg.timestamp).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
                    : '');
                  return (
                    <div key={idx} style={{
                      marginTop: gap + 'px',
                      display: 'flex', flexDirection: 'column',
                      maxWidth: '76%',
                      alignSelf: isRight ? 'flex-end' : 'flex-start',
                      alignItems: isRight ? 'flex-end' : 'flex-start',
                    }}>
                      <span style={{ fontSize: 11, color: 'var(--qa-text-3)', marginBottom: 4 }}>{label}</span>
                      <div style={{
                        padding: '10px 14px', borderRadius: 8, fontSize: 13, lineHeight: 1.5,
                        ...(type === 'agent' ? { background: 'var(--qa-gray-700)', color: '#fff' }
                          : type === 'bot'   ? { background: 'var(--qa-gray-100)', color: 'var(--qa-text)' }
                          : { background: 'var(--qa-card)', border: '1px solid var(--qa-border)', color: 'var(--qa-text)' }),
                      }}>
                        {msg.content}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </td>
    </tr>
  );
}
