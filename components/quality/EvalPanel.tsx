'use client';
import React, { useState, useEffect } from 'react';
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
  chatId:        string;
  agentName:     string;
  iqsScore:      number;
  closedAt:      string;
  disposition:   string;
  parameters:    Record<string, { score: boolean | null; reasoning: string }>;
  mode:          'submit' | 'resolve' | 'view' | 'tl-browse';
  dispute?: {
    raisedBy:       string;
    raisedByName:   string;
    agentNote:      string;
    challengedParams: { param: string; note: string }[];  // PascalCase param keys
  };
  flagId?:       string;
  mobileNumber?: string | null;
  reviewedBy?:   string | null;
  reviewedAt?:   string | null;
  reviewNote?:   string | null;
  onDone:        () => void;
  onClose:       () => void;
  colSpan:       number;
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

// ── History entry ─────────────────────────────────────────────────────────────

interface HistoryEntry {
  chatId: string;
  date: string;
  agentName: string;
  iqs: number | null;
  csat: string;
  disposition: string;
  subDisposition: string;
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function EvalPanel({
  chatId, agentName, iqsScore, closedAt, disposition,
  parameters, mode, dispute, flagId,
  mobileNumber, reviewedBy, reviewedAt, reviewNote,
  onDone, onClose, colSpan,
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

  const isReadOnly = mode === 'view' || mode === 'tl-browse';

  const [paramState, setParamState] = useState<Record<string, ParamState>>(initParams);
  const [transcript, setTranscript]  = useState<TMessage[] | null>(null);
  const [txLoading,  setTxLoading]   = useState(true);
  const [submitting, setSubmitting]  = useState(false);
  const [submitErr,  setSubmitErr]   = useState('');
  const [noteText,   setNoteText]    = useState(reviewNote ?? '');

  // History (previous conversations for this contact)
  const [history,        setHistory]        = useState<HistoryEntry[] | null>(null);
  const [historyOpen,    setHistoryOpen]    = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);

  // TL-browse: raise dispute
  const [disputeOpen,   setDisputeOpen]   = useState(false);
  const [tlNote,        setTlNote]        = useState('');
  const [tlParams,      setTlParams]      = useState<string[]>([]);
  const [tlSubmitting,  setTlSubmitting]  = useState(false);
  const [tlErr,         setTlErr]         = useState('');
  const [tlDone,        setTlDone]        = useState(false);

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
        if (!cancelled) setTranscript(Array.isArray(data) ? data : (data.timedMessages ?? data.messages ?? []));
      } catch {
        if (!cancelled) setTranscript([]);
      } finally {
        if (!cancelled) setTxLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [chatId]);

  // Fetch history lazily when user opens the panel
  function loadHistory() {
    if (history !== null || historyLoading) return;
    setHistoryLoading(true);
    fetch(`/api/quality/history?chatId=${encodeURIComponent(chatId)}`)
      .then(r => r.json())
      .then(d => setHistory(d.history ?? []))
      .catch(() => setHistory([]))
      .finally(() => setHistoryLoading(false));
  }

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
      if (noteText.trim()) body.note = noteText.trim();

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

  // TL: raise dispute
  async function submitTLDispute() {
    if (!tlNote.trim()) { setTlErr('Please add a note explaining the dispute.'); return; }
    setTlSubmitting(true);
    setTlErr('');
    try {
      const res = await fetch('/api/quality/flag', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chatId,
          agentNote: tlNote.trim(),
          challengedParams: tlParams.map(p => ({ param: p, note: '' })),
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed');
      setTlDone(true);
    } catch (e: any) {
      setTlErr(e.message ?? 'Failed to raise dispute');
    } finally {
      setTlSubmitting(false);
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
                    {mobileNumber && (
                      <>
                        <span>·</span>
                        <span style={{ fontFamily: 'ui-monospace, monospace', color: 'var(--qa-text-2)' }}>{mobileNumber}</span>
                      </>
                    )}
                    {dispute && (
                      <>
                        <span>·</span>
                        <span style={{ fontWeight: 500, color: 'var(--qa-text)' }}>
                          Disputed by {dispute.raisedBy} ({dispute.raisedByName})
                        </span>
                      </>
                    )}
                    {mode === 'view' && reviewedBy && (
                      <>
                        <span>·</span>
                        <span>Reviewed by <strong style={{ color: 'var(--qa-text)' }}>{reviewedBy}</strong></span>
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
                            <button key={i} onClick={() => !isReadOnly && setScore(pascal, val)} style={{
                              height: 28, padding: '0 9px', borderRadius: 8,
                              border: '1px solid var(--qa-border)',
                              background: isSel ? 'var(--qa-gray-700)' : 'var(--qa-card)',
                              color: isSel ? '#fff' : 'var(--qa-text-2)',
                              fontSize: 12, fontFamily: 'inherit',
                              cursor: isReadOnly ? 'default' : 'pointer',
                              opacity: isReadOnly && !isSel ? 0.4 : 1,
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
                    {(st.reasoning || !isReadOnly) && (
                      <textarea
                        value={st.reasoning}
                        onChange={e => !isReadOnly && setReasoning(pascal, e.target.value)}
                        readOnly={isReadOnly}
                        placeholder={isReadOnly ? '' : 'Add reasoning…'}
                        rows={st.reasoning ? undefined : 1}
                        style={{
                          marginTop: 8, width: '100%', resize: isReadOnly ? 'none' : 'vertical',
                          border: '1px solid transparent', borderRadius: 6,
                          padding: '6px 8px', fontSize: 12, color: 'var(--qa-text-2)',
                          lineHeight: 1.5, fontFamily: 'inherit',
                          background: 'transparent', outline: 'none',
                          transition: 'background 0.12s, border-color 0.12s',
                          cursor: isReadOnly ? 'default' : 'text',
                        }}
                        onFocus={e => {
                          if (!isReadOnly) {
                            e.target.style.background = 'var(--qa-card)';
                            e.target.style.borderColor = 'var(--qa-text)';
                          }
                        }}
                        onBlur={e => {
                          e.target.style.background = 'transparent';
                          e.target.style.borderColor = 'transparent';
                        }}
                      />
                    )}

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

            {/* Review note */}
            {!isReadOnly && (
              <div style={{ padding: '12px 16px', borderTop: '1px solid var(--qa-border-sub)', flexShrink: 0 }}>
                <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--qa-text-3)', marginBottom: 6 }}>
                  Review Note
                </div>
                <textarea
                  value={noteText}
                  onChange={e => setNoteText(e.target.value)}
                  placeholder="Add your evaluation comment…"
                  rows={2}
                  style={{
                    width: '100%', resize: 'vertical',
                    border: '1px solid var(--qa-border)', borderRadius: 6,
                    padding: '6px 8px', fontSize: 12, color: 'var(--qa-text)',
                    lineHeight: 1.5, fontFamily: 'inherit',
                    background: 'var(--qa-card)', outline: 'none',
                  }}
                />
              </div>
            )}
            {isReadOnly && reviewNote && (
              <div style={{ padding: '12px 16px', borderTop: '1px solid var(--qa-border-sub)', flexShrink: 0 }}>
                <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--qa-text-3)', marginBottom: 4 }}>
                  Review Note
                </div>
                <div style={{ fontSize: 12, color: 'var(--qa-text-2)', lineHeight: 1.5 }}>{reviewNote}</div>
              </div>
            )}

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
              {/* History toggle */}
              <button
                onClick={() => {
                  const next = !historyOpen;
                  setHistoryOpen(next);
                  if (next) loadHistory();
                }}
                title="Previous conversations"
                style={{
                  height: 28, padding: '0 10px', border: '1px solid var(--qa-border)', borderRadius: 8,
                  background: historyOpen ? 'var(--qa-gray-700)' : 'var(--qa-card)',
                  color: historyOpen ? '#fff' : 'var(--qa-text-2)',
                  cursor: 'pointer', fontSize: 12, fontFamily: 'inherit',
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 3h18v4H3z"/><path d="M3 9h18v4H3z"/><path d="M3 15h10v4H3z"/>
                </svg>
                History
              </button>
              {/* Reset button (only for editing modes) */}
              {!isReadOnly && (
                <button onClick={reset} title="Reset to original" style={{
                  width: 28, height: 28, border: '1px solid var(--qa-border)', borderRadius: 8,
                  background: 'var(--qa-card)', color: 'var(--qa-text-2)', cursor: 'pointer',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5"/>
                  </svg>
                </button>
              )}
              <div style={{ flex: 1 }} />
              {/* TL: raise dispute button */}
              {mode === 'tl-browse' && !tlDone && (
                <button
                  onClick={() => setDisputeOpen(v => !v)}
                  style={{
                    height: 36, padding: '0 16px', borderRadius: 8,
                    fontFamily: 'inherit', fontSize: 13, fontWeight: 500,
                    cursor: 'pointer',
                    display: 'inline-flex', alignItems: 'center',
                    border: '1px solid var(--qa-gray-700)',
                    background: disputeOpen ? 'var(--qa-gray-700)' : 'var(--qa-card)',
                    color: disputeOpen ? '#fff' : 'var(--qa-text)',
                  }}
                >
                  {disputeOpen ? 'Cancel' : 'Raise Dispute'}
                </button>
              )}
              {mode === 'tl-browse' && tlDone && (
                <span style={{ fontSize: 13, color: '#15803d', fontWeight: 500 }}>Dispute raised ✓</span>
              )}
              {/* Primary action (submit/resolve modes) */}
              {(mode === 'submit' || mode === 'resolve') && (
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
              )}
              {/* Close */}
              <button onClick={onClose} style={{
                width: 28, height: 28, border: '1px solid var(--qa-border)', borderRadius: 8,
                background: 'var(--qa-card)', color: 'var(--qa-text-2)', cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 16, lineHeight: 1,
              }}>×</button>
            </div>

            {/* TL dispute form */}
            {mode === 'tl-browse' && disputeOpen && !tlDone && (
              <div style={{ padding: 16, borderBottom: '1px solid var(--qa-border)', flexShrink: 0, background: 'var(--qa-gray-50)' }}>
                <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--qa-text-3)', marginBottom: 8 }}>
                  Parameters to Challenge (optional)
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                  {PARAM_ORDER.map(p => (
                    <label key={p} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={tlParams.includes(p)}
                        onChange={e => setTlParams(prev => e.target.checked ? [...prev, p] : prev.filter(x => x !== p))}
                      />
                      {PARAM_NAMES[p]}
                    </label>
                  ))}
                </div>
                <textarea
                  value={tlNote}
                  onChange={e => setTlNote(e.target.value)}
                  placeholder="Explain why this score should be reviewed…"
                  rows={2}
                  style={{
                    width: '100%', resize: 'vertical',
                    border: '1px solid var(--qa-border)', borderRadius: 6,
                    padding: '6px 8px', fontSize: 12, color: 'var(--qa-text)',
                    lineHeight: 1.5, fontFamily: 'inherit', background: 'var(--qa-card)', outline: 'none',
                    marginBottom: 8,
                  }}
                />
                {tlErr && <div style={{ fontSize: 12, color: '#b91c1c', marginBottom: 6 }}>{tlErr}</div>}
                <button
                  onClick={submitTLDispute}
                  disabled={tlSubmitting}
                  style={{
                    height: 32, padding: '0 14px', borderRadius: 6,
                    fontFamily: 'inherit', fontSize: 12, fontWeight: 500,
                    cursor: tlSubmitting ? 'not-allowed' : 'pointer',
                    border: '1px solid var(--qa-gray-700)',
                    background: 'var(--qa-gray-700)', color: '#fff',
                    opacity: tlSubmitting ? 0.7 : 1,
                  }}
                >
                  {tlSubmitting ? 'Submitting…' : 'Submit Dispute'}
                </button>
              </div>
            )}

            {/* History panel */}
            {historyOpen && (
              <div style={{ borderBottom: '1px solid var(--qa-border)', flexShrink: 0, maxHeight: 180, overflowY: 'auto' }}>
                {historyLoading ? (
                  <div style={{ padding: '12px 16px', fontSize: 13, color: 'var(--qa-text-3)' }}>Loading history…</div>
                ) : !history?.length ? (
                  <div style={{ padding: '12px 16px', fontSize: 13, color: 'var(--qa-text-3)' }}>No previous conversations found</div>
                ) : (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr style={{ background: 'var(--qa-gray-50)' }}>
                        {['Date', 'Agent', 'Disposition', 'IQS', 'CSAT'].map(h => (
                          <th key={h} style={{ padding: '6px 12px', textAlign: 'left', color: 'var(--qa-text-3)', fontWeight: 500, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {history.map((h, i) => (
                        <tr key={i} style={{ borderTop: '1px solid var(--qa-border-sub)' }}>
                          <td style={{ padding: '6px 12px', color: 'var(--qa-text-2)', whiteSpace: 'nowrap' }}>{h.date}</td>
                          <td style={{ padding: '6px 12px', color: 'var(--qa-text)' }}>{h.agentName}</td>
                          <td style={{ padding: '6px 12px', color: 'var(--qa-text-2)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.disposition}</td>
                          <td style={{ padding: '6px 12px' }}>
                            {h.iqs != null ? (
                              <span style={{
                                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                minWidth: 30, height: 18, borderRadius: 4, fontSize: 11,
                                fontFamily: 'ui-monospace, monospace',
                                background: h.iqs < 60 ? '#fee2e2' : '#fef9c3',
                                color: h.iqs < 60 ? '#b91c1c' : '#713f12',
                              }}>{h.iqs}</span>
                            ) : <span style={{ color: 'var(--qa-text-3)' }}>—</span>}
                          </td>
                          <td style={{ padding: '6px 12px' }}>
                            {h.csat ? (
                              <span style={{
                                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                minWidth: 24, height: 18, borderRadius: 4, fontSize: 11, fontWeight: 600,
                                background: h.csat === '1' ? '#fee2e2' : h.csat === '3' ? '#fef9c3' : '#dcfce7',
                                color: h.csat === '1' ? '#b91c1c' : h.csat === '3' ? '#713f12' : '#15803d',
                              }}>{h.csat}</span>
                            ) : <span style={{ color: 'var(--qa-text-3)' }}>—</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}

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
