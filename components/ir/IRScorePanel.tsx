'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import type { CSSProperties } from 'react';
import {
  PARAM_ORDER, PARAM_NAMES, WEIGHTS, calculateIQS, ParamScore,
  BOT_PARAM_ORDER, BOT_PARAM_NAMES, BOT_WEIGHTS,
  V3_PARAM_ORDER, V3_PARAM_NAMES, V3_WEIGHTS,
  isV4Evaluation, getDisputeClassification, formatParamLabel,
} from '@/lib/quality';
import { resolveParamCell } from '@/lib/param-keys';
import { DisputeThread } from '@/components/quality/DisputeThread';

const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
const SANS = '-apple-system, BlinkMacSystemFont, "Inter", "Helvetica Neue", Arial, sans-serif';

interface ChallengedParam {
  param: string;
  note: string;
}

interface TranscriptMsg {
  role: 'user' | 'assistant' | 'bot' | 'system';
  content: string;
  timestamp?: string;
}

interface IRScorePanelProps {
  chatId: string;
  agentName: string;
  iqsScore: number | null;
  botIqsScore?: number | null;
  closedAt: string;
  parameters: Record<string, any> | null;
  mode: 'evaluated' | 'pending' | 'reviewed';
  challengedParams?: ChallengedParam[];
  agentNote?: string;
  reviewNote?: string;
  reviewedBy?: string;
  flaggedAt?: string;
  reviewedAt?: string;
  colSpan: number;
  flagId?: string;
  flagStatus?: string;
  onClose: () => void;
  onDisputeRaised?: () => void;
}

// Resolves each canonical parameter (v3 or v4) via the shared, backward-compatible
// key resolver — a chat scored under any historical key dialect still displays.
// (Deliberately NOT a v4→v3 KEY_MAP: folding v4 params onto v3 names is the drift
// this branch removed, and it collapses 0.5 half-scores to NA.)
type DisplayScore = 'Yes' | 'No' | 'NA' | 'Half';

function normalizeParams(raw: Record<string, any> | null, paramOrder: string[], isBot: boolean) {
  if (!raw) return {} as Record<string, { score: DisplayScore; reasoning: string }>;
  const safe = isBot
    ? (raw.__bot_parameters || (raw.__agent_parameters ? {} : raw))
    : (raw.__agent_parameters || raw);
  const out: Record<string, { score: DisplayScore; reasoning: string }> = {};
  for (const pascal of paramOrder) {
    const cell = resolveParamCell(safe, pascal);
    // v4 uses 0.5 for half credit — surface it as 'Half' rather than collapsing to NA.
    const sc: DisplayScore = cell.score === true || cell.score === 1 || cell.score === 'Yes'
      ? 'Yes'
      : cell.score === 0.5 || cell.score === 'Half'
      ? 'Half'
      : cell.score === false || cell.score === 0 || cell.score === 'No'
      ? 'No'
      : 'NA';
    out[pascal] = { score: sc, reasoning: cell.comment ?? cell.reasoning ?? '' };
  }
  return out;
}

function ScoreRing({ score }: { score: number | null }) {
  const val = score ?? 0;
  const r = 27;
  const circ = 2 * Math.PI * r; // ≈ 169.6
  const offset = circ - (val / 100) * circ;
  return (
    <svg width={64} height={64}>
      <circle cx={32} cy={32} r={r} stroke="#E4E4E7" strokeWidth={5} fill="none" />
      <circle
        cx={32} cy={32} r={r} stroke="#2D2D31" strokeWidth={5} fill="none"
        strokeLinecap="round"
        strokeDasharray={circ}
        strokeDashoffset={offset}
        transform="rotate(-90 32 32)"
      />
      <text x={32} y={33} textAnchor="middle" dominantBaseline="central" fontSize={18} fontWeight={700} fill="#111111" fontFamily={SANS}>
        {score !== null ? val : '—'}
      </text>
    </svg>
  );
}

export default function IRScorePanel({
  chatId, agentName, iqsScore, botIqsScore, closedAt, parameters, mode,
  challengedParams = [], agentNote, reviewNote, reviewedBy, flaggedAt, reviewedAt, colSpan, flagId,
  onClose, onDisputeRaised, flagStatus,
}: IRScorePanelProps) {
  const [activeTab, setActiveTab] = useState<'agent' | 'bot'>('agent');
  const isV4 = isV4Evaluation(parameters);
  const activeParamOrder = activeTab === 'bot'
    ? BOT_PARAM_ORDER
    : (isV4 ? PARAM_ORDER : V3_PARAM_ORDER);
  const activeParamNames = activeTab === 'bot'
    ? BOT_PARAM_NAMES
    : (isV4 ? PARAM_NAMES : V3_PARAM_NAMES);
  const activeWeights = activeTab === 'bot'
    ? BOT_WEIGHTS
    : (isV4 ? WEIGHTS : V3_WEIGHTS);
  const params = normalizeParams(parameters, activeParamOrder, activeTab === 'bot');
  const currentScore = activeTab === 'bot'
    ? (botIqsScore ?? parameters?.__scores?.bot_iqs ?? null)
    : (iqsScore ?? parameters?.__scores?.agent_iqs ?? null);

  const fallbackScore = (() => {
    const scMap: Record<string, ParamScore> = {};
    for (const [k, v] of Object.entries(params)) {
      scMap[k] = v.score;
    }
    return calculateIQS(scMap, activeTab === 'bot', isV4);
  })();
  const displayedScore = currentScore ?? fallbackScore;

  const [transcript, setTranscript] = useState<TranscriptMsg[]>([]);
  const [txLoading, setTxLoading] = useState(true);
  const [disputing, setDisputing] = useState(false);
  const [picks, setPicks] = useState<Set<string>>(new Set());
  const [sharedNote, setSharedNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [disputeDone, setDisputeDone] = useState(false);
  const [error, setError] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setActiveTab('agent');
  }, [chatId]);

  useEffect(() => {
    setTxLoading(true);
    fetch(`/api/quality/transcript?chatId=${encodeURIComponent(chatId)}`)
      .then(r => r.json())
      .then(d => {
        const raw: any[] = d.timedMessages ?? d.messages ?? d.transcript ?? [];
        const msgs: TranscriptMsg[] = Array.isArray(raw) ? raw.map(m => ({
          role: m.role ?? (m.sender === 'user' ? 'user' : m.sender === 'bot' ? 'bot' : m.sender === 'activity' ? 'system' : 'assistant'),
          content: m.content ?? m.text ?? '',
          timestamp: m.timestamp,
        })) : [];
        setTranscript(msgs);
      })
      .catch(() => {})
      .finally(() => setTxLoading(false));
  }, [chatId]);

  const togglePick = useCallback((param: string) => {
    const pickKey = `${activeTab}:${param}`;
    setPicks(prev => {
      const next = new Set(prev);
      if (next.has(pickKey)) next.delete(pickKey); else next.add(pickKey);
      return next;
    });
  }, [activeTab]);

  const startDisputing = useCallback(() => {
    setDisputing(true);
    setPicks(new Set());
  }, []);

  const canSubmit = picks.size > 0 && sharedNote.trim().length > 0;

  const submitDispute = async () => {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      const challenged = [...picks].map(p => ({ param: p, note: sharedNote.trim() }));
      const res = await fetch('/api/quality/flag', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId, challengedParams: challenged, agentNote: sharedNote.trim(), raisedByRole: 'ir' }),
      });
      if (!res.ok) throw new Error('Failed to submit dispute');
      setDisputeDone(true);
      setDisputing(false);
      onDisputeRaised?.();
    } catch (e: any) {
      setError(e.message || 'Failed');
    } finally {
      setSubmitting(false);
    }
  };

  const cancelDisputing = () => { setDisputing(false); setPicks(new Set()); setSharedNote(''); };

  const date = closedAt ? new Date(closedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
  const isRejected = reviewNote?.toLowerCase().includes('reject');

  const pendingStatusLabel = flagStatus === 'tl_forwarded' ? 'Under Review' : 'Raised';
  const reviewedOutcome = isRejected ? 'Rejected' : 'Accepted';

  return (
    <tr style={{ background: '#FAFAFB' }}>
      <td colSpan={colSpan} style={{ padding: '0 16px 16px' }}>
        <div style={{
          display: 'flex', height: 520,
          border: '1px solid #E4E4E7', borderRadius: 8,
          background: '#FFFFFF', overflow: 'hidden',
        }}>
          {/* ── Left panel ── */}
          <div style={{
            // Wider param column, shrinking back to 400 when space is tight so
            // the transcript pane stays readable.
            width: 496, minWidth: 400, flexShrink: 1, borderRight: '1px solid #E4E4E7',
            display: 'flex', flexDirection: 'column',
          }}>
            {/* Header */}
            <div style={{ padding: 16, borderBottom: '1px solid #E4E4E7', flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <ScoreRing score={displayedScore} />
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#111111' }}>{agentName || '—'}</div>
                  <div style={{ fontSize: 12, color: '#A1A1AA', marginTop: 6 }}>
                    <span style={{ fontFamily: MONO }}>{chatId?.slice(0, 14)}</span>
                    {' · '}{date}
                  </div>
                </div>
              </div>
            </div>

            {/* Tab header */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '12px 16px 0', borderBottom: '1px solid #E4E4E7', flexShrink: 0,
            }}>
              <div style={{ display: 'flex', gap: 16 }}>
                <button
                  type="button"
                  onClick={() => setActiveTab('agent')}
                  style={{
                    fontSize: 12, fontWeight: 600, paddingBottom: 8,
                    color: activeTab === 'agent' ? '#111111' : '#A1A1AA',
                    borderTop: 'none', borderLeft: 'none', borderRight: 'none',
                    borderBottom: activeTab === 'agent' ? '2px solid #111111' : '2px solid transparent',
                    background: 'none', cursor: 'pointer', fontFamily: SANS,
                  }}
                >
                  Agent Parameters
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('bot')}
                  style={{
                    fontSize: 12, fontWeight: 600, paddingBottom: 8,
                    color: activeTab === 'bot' ? '#111111' : '#A1A1AA',
                    borderTop: 'none', borderLeft: 'none', borderRight: 'none',
                    borderBottom: activeTab === 'bot' ? '2px solid #111111' : '2px solid transparent',
                    background: 'none', cursor: 'pointer', fontFamily: SANS,
                  }}
                >
                  Bot Parameters
                </button>
              </div>
              {disputing && (
                <span style={{ fontSize: 11, color: '#2563eb', fontWeight: 600, paddingBottom: 8 }}>
                  {picks.size} selected for dispute
                </span>
              )}
            </div>

            {disputing && (
              <div style={{
                fontSize: 12, color: '#1d4ed8', background: '#eff6ff', border: '1px solid #bfdbfe',
                borderRadius: 6, padding: '8px 12px', margin: '4px 16px 8px', flexShrink: 0,
              }}>
                Select parameter(s) to challenge on the left, then write your reason on the right.
              </div>
            )}



            {/* Params */}
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {(() => {
                return activeParamOrder.map((param, idx) => {
                  const entry = params[param];
                  const score = entry?.score || 'NA';
                  const reasoning = entry?.reasoning || '';
                  const pickKey = `${activeTab}:${param}`;
                  const dispChallenge = challengedParams.find(c => c.param === pickKey || (activeTab === 'agent' && c.param === param));
                  const isPicked = picks.has(pickKey);
                  const weight = activeWeights?.[param] != null ? `${Math.round((activeWeights[param] ?? 0) * 100)}%` : '';
                  const isLast = idx === activeParamOrder.length - 1;

                  const rowStyle: CSSProperties = {
                    padding: '14px 16px',
                    borderBottom: isLast ? 'none' : '1px solid #F0F0F2',
                    cursor: disputing ? 'pointer' : 'default',
                    background: isPicked ? '#FAFAFB' : 'transparent',
                    boxShadow: isPicked ? 'inset 3px 0 0 #2D2D31' : 'none',
                    transition: 'background 0.1s',
                  };

                  return (
                    <div
                      key={param}
                      style={rowStyle}
                      onClick={disputing ? () => togglePick(param) : undefined}
                      onMouseEnter={disputing ? e => { if (!isPicked) (e.currentTarget as HTMLElement).style.background = '#F4F4F5'; } : undefined}
                      onMouseLeave={disputing ? e => { (e.currentTarget as HTMLElement).style.background = isPicked ? '#FAFAFB' : 'transparent'; } : undefined}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        {disputing && (
                          <input
                            type="checkbox"
                            checked={isPicked}
                            onChange={() => togglePick(param)}
                            onClick={e => e.stopPropagation()}
                            style={{ cursor: 'pointer', width: 16, height: 16, accentColor: '#111111' }}
                          />
                        )}
                        <span style={{ fontSize: 13, fontWeight: 500, color: '#111111', flex: '0 1 auto' }}>
                          {activeParamNames[param] || param}
                        </span>
                      {dispChallenge && (mode === 'pending' || mode === 'reviewed') && (
                        <span style={{
                          height: 18, padding: '0 7px', borderRadius: 999,
                          background: '#2D2D31', color: '#fff',
                          fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em',
                          display: 'inline-flex', alignItems: 'center',
                        }}>
                          Disputed
                        </span>
                      )}
                      {isPicked && mode === 'evaluated' && (
                        <span style={{
                          height: 18, padding: '0 7px', borderRadius: 999,
                          background: '#2D2D31', color: '#fff',
                          fontSize: 10, fontWeight: 600, textTransform: 'uppercase',
                          display: 'inline-flex', alignItems: 'center',
                        }}>
                          Disputing
                        </span>
                      )}
                      {weight && (
                        <span style={{ fontSize: 11, color: '#A1A1AA', fontFamily: MONO, marginLeft: 'auto', flexShrink: 0 }}>
                          {weight}
                        </span>
                      )}
                      <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
                        {(['Yes', 'Half', 'No', 'NA'] as const).map(opt => {
                          const selected = score === opt;
                          let bg = '#FFFFFF';
                          let color = '#D4D4D8';
                          let border = '1px solid #F4F4F5';

                          if (selected) {
                            if (opt === 'Yes') {
                              bg = '#DCFCE7';
                              color = '#15803D';
                              border = '1px solid #86EFAC';
                            } else if (opt === 'No') {
                              bg = '#FEE2E2';
                              color = '#B91C1C';
                              border = '1px solid #FCA5A5';
                            } else {
                              bg = '#F4F4F5';
                              color = '#52525B';
                              border = '1px solid #E4E4E7';
                            }
                          }

                          return (
                            <button
                              key={opt}
                              disabled
                              style={{
                                height: 28, padding: '0 9px', borderRadius: 8,
                                border,
                                background: bg,
                                color,
                                fontSize: 12, fontFamily: SANS, cursor: 'default',
                                fontWeight: selected ? 600 : 400,
                              }}
                            >
                              {opt}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    {reasoning && (
                      <div style={{
                        marginTop: 8, fontSize: 12, color: '#3F3F46', lineHeight: 1.5,
                        background: '#F8FAFC', padding: '8px 10px', borderRadius: 6,
                        border: '1px solid #E2E8F0',
                      }}>
                        {reasoning}
                      </div>
                    )}
                    {dispChallenge && (mode === 'pending' || mode === 'reviewed') && (
                      <div style={{
                        marginTop: 10, fontSize: 12, color: '#6B6B6B',
                        background: '#FFFFFF', border: '1px solid #E4E4E7',
                        borderRadius: 6, padding: '8px 10px',
                        display: 'flex', flexDirection: 'column', gap: 4,
                      }}>
                        Your note: {dispChallenge.note}
                      </div>
                    )}
                  </div>
                );
              });
            })()}
            </div>
          </div>

          {/* ── Right panel ── */}
          <div style={{ flex: 1, minWidth: 360, display: 'flex', flexDirection: 'column' }}>
            {/* Header */}
            <div style={{
              padding: 16, borderBottom: '1px solid #E4E4E7', flexShrink: 0,
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <div style={{ flex: 1 }} />

              {/* Dispute actions */}
              {mode === 'evaluated' && !disputeDone && !disputing && (
                <button
                  style={{
                    height: 32, padding: '0 16px', borderRadius: 8,
                    background: '#FFFFFF', border: '1px solid #E4E4E7',
                    fontSize: 13, fontWeight: 500, color: '#111111', cursor: 'pointer', fontFamily: SANS,
                  }}
                  onClick={startDisputing}
                >
                  Raise Dispute
                </button>
              )}
              {mode === 'evaluated' && disputing && (
                <>
                  <button
                    style={{
                      height: 32, padding: '0 16px', borderRadius: 8,
                      background: '#FFFFFF', border: '1px solid #E4E4E7',
                      fontSize: 13, fontWeight: 500, color: '#111111', cursor: 'pointer', fontFamily: SANS,
                    }}
                    onClick={cancelDisputing}
                  >
                    Cancel
                  </button>
                  <button
                    style={{
                      height: 32, padding: '0 16px', borderRadius: 8,
                      background: '#111111', border: '1px solid #111111',
                      fontSize: 13, fontWeight: 500, color: '#fff',
                      cursor: canSubmit ? 'pointer' : 'default', fontFamily: SANS,
                      opacity: canSubmit ? 1 : 0.4,
                    }}
                    onClick={submitDispute}
                    disabled={!canSubmit || submitting}
                  >
                    {submitting ? 'Submitting…' : 'Submit Dispute'}
                  </button>
                </>
              )}
              {mode === 'evaluated' && disputeDone && (
                <span style={{ fontSize: 13, color: '#A1A1AA' }}>Dispute raised</span>
              )}
              {mode === 'pending' && (
                <span style={{ fontSize: 13, color: '#A1A1AA' }}>{pendingStatusLabel}</span>
              )}
              {mode === 'reviewed' && (
                <span style={{ fontSize: 13, color: '#A1A1AA' }}>{reviewedOutcome}{reviewedBy ? ` by ${reviewedBy}` : ''}</span>
              )}

              {error && <span style={{ fontSize: 12, color: '#DC2626' }}>{error}</span>}

              {/* Close */}
              <button
                style={{
                  width: 28, height: 28, border: '1px solid #E4E4E7', borderRadius: 8,
                  background: '#FFFFFF', color: '#6B6B6B', cursor: 'pointer',
                  fontSize: 16, lineHeight: 1,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  fontFamily: SANS,
                }}
                onClick={onClose}
              >
                ×
              </button>
            </div>

            {/* Dispute compose area */}
            {mode === 'evaluated' && disputing && (
              <div style={{
                flexShrink: 0, padding: '14px 16px',
                borderBottom: '1px solid #E4E4E7', background: '#FAFAFB',
              }}>
                <div style={{ fontSize: 13, color: '#6B6B6B', marginBottom: 8 }}>Reason for dispute</div>
                <textarea
                  ref={textareaRef}
                  style={{
                    width: '100%', height: 80, border: '1px solid #E4E4E7', borderRadius: 8,
                    padding: '8px 10px', fontFamily: SANS, fontSize: 13, lineHeight: 1.5,
                    color: '#111111', resize: 'none', outline: 'none', background: '#FFFFFF',
                    boxSizing: 'border-box',
                  }}
                  placeholder="Describe what you think is incorrect and why (required)"
                  value={sharedNote}
                  onChange={e => setSharedNote(e.target.value)}
                  onFocus={e => { e.target.style.borderColor = '#111111'; }}
                  onBlur={e => { e.target.style.borderColor = '#E4E4E7'; }}
                />
              </div>
            )}

            {/* Transcript */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', background: '#FFFFFF' }}>
              {txLoading ? (
                <div style={{ textAlign: 'center', color: '#A1A1AA', fontSize: 13, marginTop: 40 }}>Loading transcript…</div>
              ) : transcript.length === 0 ? (
                <div style={{ textAlign: 'center', color: '#A1A1AA', fontSize: 13, marginTop: 40 }}>No transcript available</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                  {transcript.map((msg, i) => {
                    const isAgent = msg.role === 'assistant' || msg.role === 'bot';
                    const isUser = msg.role === 'user';
                    const isSystem = msg.role === 'system';

                    const formatTs = (ts?: string) => {
                      if (!ts) return '';
                      const d = new Date(ts);
                      if (isNaN(d.getTime())) return String(ts);
                      return d.toLocaleString('en-IN', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                        hour12: true,
                      });
                    };

                    if (isSystem) {
                      const systemTime = msg.timestamp
                        ? '  •  ' + formatTs(msg.timestamp)
                        : '';
                      return (
                        <div key={i} style={{ marginTop: i === 0 ? 0 : 8 }}>
                          <div style={{
                            background: '#FAFAFB', border: '1px solid #F0F0F2', borderRadius: 8,
                            fontSize: 12, fontStyle: 'italic', color: '#6B6B6B',
                            textAlign: 'center', padding: '8px 14px', lineHeight: 1.5,
                          }}>
                            {msg.content}{systemTime}
                          </div>
                        </div>
                      );
                    }

                    const timeStr = msg.timestamp ? formatTs(msg.timestamp) : '';
                    const roleLabel = isUser ? 'User' : isAgent ? 'Agent' : 'Bot';

                    return (
                      <div key={i} style={{ marginTop: i === 0 ? 0 : 8, display: 'flex', flexDirection: 'column', alignItems: isUser ? 'flex-start' : 'flex-end' }}>
                        <div style={{ fontSize: 11, color: '#A1A1AA', marginBottom: 4 }}>
                          {roleLabel}{timeStr ? ` · ${timeStr}` : ''}
                        </div>
                        <div style={{
                          background: isUser ? '#FFFFFF' : isAgent ? '#2D2D31' : '#F4F4F5',
                          color: isUser ? '#111111' : isAgent ? '#fff' : '#111111',
                          border: isUser ? '1px solid #E4E4E7' : 'none',
                          padding: '10px 14px', borderRadius: 8,
                          fontSize: 13, lineHeight: 1.5, maxWidth: '76%',
                        }}>
                          {msg.content}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </td>
    </tr>
  );
}
