'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import type { CSSProperties } from 'react';
import { PARAM_ORDER, PARAM_NAMES, WEIGHTS, V3_PARAM_ORDER, V3_PARAM_NAMES, V3_WEIGHTS, isV4Evaluation } from '@/lib/quality';
import { resolveParamCell } from '@/lib/param-keys';

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
  closedAt: string;
  parameters: Record<string, any> | null;
  mode: 'evaluated' | 'pending' | 'reviewed';
  challengedParams?: ChallengedParam[];
  reviewNote?: string;
  reviewedBy?: string;
  colSpan: number;
  flagId?: string;
  flagStatus?: string;
  onClose: () => void;
  onDisputeRaised?: () => void;
}

// Resolves each canonical parameter (v3 or v4) via the shared, backward-compatible
// key resolver — a chat scored under any historical key dialect still displays.
function normalizeParams(raw: Record<string, any> | null, paramOrder: string[]) {
  if (!raw) return {} as Record<string, { score: 'Yes' | 'No' | 'NA'; reasoning: string }>;
  const safe = raw.__agent_parameters || raw;
  const out: Record<string, { score: 'Yes' | 'No' | 'NA'; reasoning: string }> = {};
  for (const pascal of paramOrder) {
    const cell = resolveParamCell(safe, pascal);
    const sc = cell.score === true || cell.score === 1 ? 'Yes' : cell.score === false || cell.score === 0 ? 'No' : 'NA';
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
  chatId, agentName, iqsScore, closedAt, parameters, mode,
  challengedParams = [], reviewNote, colSpan,
  onClose, onDisputeRaised, flagStatus,
}: IRScorePanelProps) {
  const isV4 = isV4Evaluation(parameters);
  const activeParamOrder = isV4 ? PARAM_ORDER : V3_PARAM_ORDER;
  const activeParamNames = isV4 ? PARAM_NAMES : V3_PARAM_NAMES;
  const activeWeights    = isV4 ? WEIGHTS : V3_WEIGHTS;
  const params = normalizeParams(parameters, activeParamOrder);
  const failCount = Object.values(params).filter(p => p.score === 'No').length;

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
    setPicks(prev => {
      const next = new Set(prev);
      if (next.has(param)) next.delete(param); else next.add(param);
      return next;
    });
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
            width: 400, flexShrink: 0, borderRight: '1px solid #E4E4E7',
            display: 'flex', flexDirection: 'column',
          }}>
            {/* Header */}
            <div style={{ padding: 16, borderBottom: '1px solid #E4E4E7', flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <ScoreRing score={iqsScore} />
                <div>
                  <div style={{ fontSize: 16, fontWeight: 600, color: '#111111' }}>{agentName || '—'}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                    <span style={{
                      height: 20, padding: '0 8px', border: '1px solid #E4E4E7',
                      borderRadius: 999, fontSize: 12, color: '#6B6B6B',
                      display: 'inline-flex', alignItems: 'center',
                    }}>
                      {failCount} fail{failCount !== 1 ? 's' : ''}
                    </span>
                  </div>
                  <div style={{ fontSize: 13, color: '#A1A1AA', marginTop: 6 }}>
                    <span style={{ fontFamily: MONO }}>{chatId?.slice(0, 14)}</span>
                    {' · '}{date}
                  </div>
                </div>
              </div>
            </div>

            {/* Section label */}
            <div style={{
              fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em',
              color: '#A1A1AA', padding: '16px 16px 4px', flexShrink: 0,
            }}>
              Parameter Scores
            </div>

            {/* Params */}
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {(() => {
                return activeParamOrder.map((param, idx) => {
                  const entry = params[param];
                  const score = entry?.score || 'NA';
                  const reasoning = entry?.reasoning || '';
                  const dispChallenge = challengedParams.find(c => c.param === param);
                  const isPicked = picks.has(param);
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
                        {(['Yes', 'No', 'NA'] as const).map(opt => {
                          const selected = score === opt;
                          return (
                            <button
                              key={opt}
                              disabled
                              style={{
                                height: 28, padding: '0 9px', borderRadius: 8,
                                border: `1px solid ${selected ? '#E4E4E7' : '#E4E4E7'}`,
                                background: selected ? '#E4E4E7' : '#FFFFFF',
                                color: selected ? '#6B6B6B' : '#C7C7CC',
                                fontSize: 12, fontFamily: SANS, cursor: 'default',
                              }}
                            >
                              {opt}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    {reasoning && (
                      <div style={{ marginTop: 10, fontSize: 12, color: '#6B6B6B', lineHeight: 1.5 }}>
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
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            {/* Header */}
            <div style={{
              padding: 16, borderBottom: '1px solid #E4E4E7', flexShrink: 0,
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <span style={{ fontSize: 13, color: '#A1A1AA', whiteSpace: 'nowrap' }}>
                {transcript.length > 0 ? `${transcript.length} messages` : txLoading ? 'Loading…' : 'No transcript'}
              </span>
              <div style={{ flex: 1 }} />

              {/* Dispute actions */}
              {mode === 'evaluated' && !disputeDone && !disputing && (
                <button
                  style={{
                    height: 32, padding: '0 16px', borderRadius: 8,
                    background: '#FFFFFF', border: '1px solid #E4E4E7',
                    fontSize: 13, fontWeight: 500, color: '#111111', cursor: 'pointer', fontFamily: SANS,
                  }}
                  onClick={() => setDisputing(true)}
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
                <span style={{ fontSize: 13, color: '#A1A1AA' }}>{reviewedOutcome}</span>
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

                    if (isSystem) {
                      const systemTime = msg.timestamp
                        ? '  •  ' + new Date(msg.timestamp).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
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

                    return (
                      <div key={i} style={{ marginTop: i === 0 ? 0 : 8, display: 'flex', flexDirection: 'column', alignItems: isUser ? 'flex-start' : 'flex-end' }}>
                        {!isUser && (
                          <div style={{ fontSize: 11, color: '#A1A1AA', marginBottom: 4 }}>
                            {isAgent ? 'Agent' : 'Bot'}
                          </div>
                        )}
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
