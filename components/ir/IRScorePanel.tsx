'use client';

import { useState, useEffect, useCallback } from 'react';
import type { CSSProperties } from 'react';
import { PARAM_ORDER, PARAM_NAMES, CAT1_PARAMS } from '@/lib/quality';

interface ChallengedParam {
  param: string;
  note: string;
}

interface TranscriptMsg {
  role: 'user' | 'assistant' | 'bot';
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
  onClose: () => void;
  onDisputeRaised?: () => void;
}

// Static styles
const S: Record<string, CSSProperties> = {
  row: { background: '#FAFAFB', borderBottom: '1px solid #E4E4E7' },
  inner: { display: 'flex', gap: 0, minHeight: 420 },
  leftPanel: { width: 340, flexShrink: 0, padding: 24, borderRight: '1px solid #E4E4E7', background: '#fff', overflowY: 'auto', maxHeight: 560 },
  rightPanel: { flex: 1, display: 'flex', flexDirection: 'column', background: '#FAFAFB', overflowY: 'auto', maxHeight: 560 },
  scoreRing: { display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 },
  ringWrap: { position: 'relative', width: 60, height: 60 },
  ringScore: { position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, color: '#111' },
  divider: { borderTop: '1px solid #E4E4E7', margin: '14px 0' },
  paramRow: { marginBottom: 10 },
  paramLabel: { fontSize: 12, fontWeight: 500, color: '#374151', marginBottom: 4 },
  paramReasoning: { fontSize: 11, color: '#6B7280', marginTop: 2, lineHeight: 1.4 },
  paramBtns: { display: 'flex', gap: 4 },
  disputeTag: { display: 'inline-block', fontSize: 10, fontWeight: 600, background: '#FEF3C7', color: '#92400E', borderRadius: 4, padding: '1px 6px', marginLeft: 6 },
  noteBox: { fontSize: 11, color: '#6B7280', marginTop: 3, fontStyle: 'italic' },
  actionArea: { padding: '14px 18px', borderBottom: '1px solid #E4E4E7', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#fff' },
  closeBtn: { fontSize: 11, padding: '5px 12px', borderRadius: 6, border: '1px solid #D1D5DB', background: '#fff', cursor: 'pointer', color: '#374151', fontWeight: 500 },
  disputeBtn: { fontSize: 11, padding: '5px 14px', borderRadius: 6, border: '1px solid #2D2D31', background: '#2D2D31', color: '#fff', cursor: 'pointer', fontWeight: 500 },
  transcriptWrap: { flex: 1, padding: '14px 18px', overflowY: 'auto' },
  bubbleTime: { fontSize: 10, color: '#9CA3AF', marginBottom: 2 },
  noteTextarea: { width: '100%', marginTop: 4, padding: '6px 8px', fontSize: 11, border: '1px solid #D1D5DB', borderRadius: 4, resize: 'vertical', minHeight: 52, color: '#111', background: '#FAFAFB', outline: 'none' },
  cancelBtn: { fontSize: 12, padding: '6px 14px', borderRadius: 6, border: '1px solid #D1D5DB', background: '#fff', color: '#374151', cursor: 'pointer', fontWeight: 400 },
};

// Dynamic style functions
function btnStyle(active: boolean, color: string): CSSProperties {
  return { fontSize: 11, fontWeight: 500, padding: '2px 8px', borderRadius: 4, border: `1px solid ${active ? color : '#D1D5DB'}`, background: active ? color : '#fff', color: active ? '#fff' : '#9CA3AF', cursor: 'default' };
}
function outcomeTagStyle(accepted: boolean): CSSProperties {
  return { display: 'inline-block', fontSize: 10, fontWeight: 600, borderRadius: 4, padding: '1px 6px', marginLeft: 6, background: accepted ? '#D1FAE5' : '#FEE2E2', color: accepted ? '#065F46' : '#991B1B' };
}
function statusBadgeStyle(color: string, bg: string): CSSProperties {
  return { fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 20, background: bg, color, display: 'inline-block' };
}
function bubbleStyle(isAgent: boolean): CSSProperties {
  return { maxWidth: '80%', padding: '8px 12px', borderRadius: isAgent ? '12px 12px 4px 12px' : '12px 12px 12px 4px', background: isAgent ? '#2D2D31' : '#fff', color: isAgent ? '#fff' : '#111', fontSize: 13, lineHeight: 1.5, marginBottom: 8, alignSelf: isAgent ? 'flex-end' : 'flex-start', border: isAgent ? 'none' : '1px solid #E4E4E7', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' };
}
function submitBtnStyle(enabled: boolean): CSSProperties {
  return { fontSize: 12, padding: '6px 16px', borderRadius: 6, border: 'none', background: enabled ? '#2D2D31' : '#D1D5DB', color: enabled ? '#fff' : '#9CA3AF', cursor: enabled ? 'pointer' : 'not-allowed', fontWeight: 500 };
}

// Map DB snake_case → frontend PascalCase
const DB_KEY_TO_PASCAL: Record<string, string> = {
  technical: 'Technical', all_questions: 'AllQuestions', expectation: 'Expectation',
  contextual: 'Contextual', follow_up: 'FollowUp', sentences: 'Sentences',
  process: 'Process', opening: 'Opening', call: 'Call', grammar: 'Grammar', empathy: 'Empathy',
};

function normalizeParams(raw: Record<string, any> | null): Record<string, { score: 'Yes' | 'No' | 'NA'; reasoning: string }> {
  if (!raw) return {};
  const out: Record<string, { score: 'Yes' | 'No' | 'NA'; reasoning: string }> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (k.startsWith('__')) continue;
    const key = DB_KEY_TO_PASCAL[k] ?? k;
    const sc = typeof v === 'object' && v !== null
      ? (v.score === true ? 'Yes' : v.score === false ? 'No' : 'NA')
      : (v === true ? 'Yes' : v === false ? 'No' : 'NA');
    out[key] = { score: sc as 'Yes' | 'No' | 'NA', reasoning: (typeof v === 'object' && v?.reasoning) || '' };
  }
  return out;
}

function IQSRing({ score }: { score: number | null }) {
  const val = score ?? 0;
  const r = 24;
  const circ = 2 * Math.PI * r;
  const fill = (val / 100) * circ;
  const color = val >= 85 ? '#16A34A' : val >= 75 ? '#CA8A04' : val >= 60 ? '#EA580C' : '#DC2626';
  return (
    <div style={S.ringWrap}>
      <svg width="60" height="60" viewBox="0 0 60 60">
        <circle cx="30" cy="30" r={r} fill="none" stroke="#E4E4E7" strokeWidth="5" />
        <circle cx="30" cy="30" r={r} fill="none" stroke={color} strokeWidth="5"
          strokeDasharray={`${fill} ${circ}`} strokeDashoffset={circ / 4} strokeLinecap="round" />
      </svg>
      <div style={S.ringScore}>{score !== null ? `${val}` : '—'}</div>
    </div>
  );
}

export default function IRScorePanel({
  chatId, agentName, iqsScore, closedAt, parameters, mode,
  challengedParams = [], reviewNote, reviewedBy, colSpan,
  onClose, onDisputeRaised,
}: IRScorePanelProps) {
  const [transcriptMsgs, setTranscriptMsgs] = useState<TranscriptMsg[]>([]);
  const [transcriptLoading, setTranscriptLoading] = useState(true);
  const [disputing, setDisputing] = useState(false);
  const [pickedParams, setPickedParams] = useState<Set<string>>(new Set());
  const [paramNotes, setParamNotes] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [disputeDone, setDisputeDone] = useState(false);
  const [error, setError] = useState('');

  const params = normalizeParams(parameters);

  useEffect(() => {
    setTranscriptLoading(true);
    fetch(`/api/quality/transcript?chatId=${encodeURIComponent(chatId)}`)
      .then(r => r.json())
      .then(d => {
        const msgs: TranscriptMsg[] = Array.isArray(d.messages) ? d.messages : Array.isArray(d.transcript) ? d.transcript : [];
        setTranscriptMsgs(msgs);
      })
      .catch(() => {})
      .finally(() => setTranscriptLoading(false));
  }, [chatId]);

  const toggleParam = useCallback((param: string) => {
    setPickedParams(prev => {
      const next = new Set(prev);
      if (next.has(param)) next.delete(param); else next.add(param);
      return next;
    });
  }, []);

  const canSubmit = pickedParams.size > 0 && [...pickedParams].every(p => (paramNotes[p] || '').trim().length > 0);

  const submitDispute = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError('');
    try {
      const challenged = [...pickedParams].map(p => ({ param: p, note: (paramNotes[p] || '').trim() }));
      const res = await fetch('/api/quality/flag', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId, challengedParams: challenged, agentNote: challenged.map(c => `${c.param}: ${c.note}`).join('; '), raisedByRole: 'ir' }),
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

  const date = closedAt ? new Date(closedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
  const isRejected = reviewNote?.toLowerCase().includes('reject');

  return (
    <tr style={S.row}>
      <td colSpan={colSpan} style={{ padding: 0 }}>
        <div style={S.inner}>
          {/* Left panel */}
          <div style={S.leftPanel}>
            <div style={S.scoreRing}>
              <IQSRing score={iqsScore} />
              <div>
                {agentName && <div style={{ fontSize: 13, fontWeight: 600, color: '#111' }}>{agentName}</div>}
                <div style={{ fontSize: 11, color: '#6B7280', fontFamily: 'monospace' }}>{chatId.slice(0, 16)}…</div>
                <div style={{ fontSize: 11, color: '#6B7280' }}>{date}</div>
              </div>
            </div>
            <div style={S.divider} />
            <div style={{ fontSize: 11, fontWeight: 600, color: '#9CA3AF', letterSpacing: '0.5px', marginBottom: 10, textTransform: 'uppercase' }}>Parameters</div>

            {PARAM_ORDER.map(param => {
              const entry = params[param];
              const score = entry?.score || 'NA';
              const reasoning = entry?.reasoning || '';
              const dispChallenge = challengedParams.find(c => c.param === param);
              const isPicked = pickedParams.has(param);
              const isClickable = disputing;
              const rowStyle: CSSProperties = {
                ...S.paramRow,
                ...(isClickable ? { cursor: 'pointer', padding: '6px 8px', borderRadius: 6, background: isPicked ? '#EFF6FF' : 'transparent', border: isPicked ? '1px solid #BFDBFE' : '1px solid transparent' } : {}),
              };
              return (
                <div key={param} style={rowStyle} onClick={isClickable ? () => toggleParam(param) : undefined}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    <span style={S.paramLabel}>{PARAM_NAMES[param] || param}</span>
                    {!CAT1_PARAMS.has(param) && <span style={{ fontSize: 9, background: '#F3F4F6', color: '#6B7280', borderRadius: 3, padding: '0 4px', fontWeight: 600 }}>TL</span>}
                    {dispChallenge && <span style={S.disputeTag}>Disputed</span>}
                    {mode === 'reviewed' && dispChallenge && (
                      <span style={outcomeTagStyle(!isRejected)}>{isRejected ? 'Rejected' : 'Accepted'}</span>
                    )}
                  </div>
                  <div style={S.paramBtns}>
                    <button style={btnStyle(score === 'Yes', '#16A34A')} disabled>Yes</button>
                    <button style={btnStyle(score === 'No', '#DC2626')} disabled>No</button>
                    <button style={btnStyle(score === 'NA', '#6B7280')} disabled>N/A</button>
                  </div>
                  {reasoning && <div style={S.paramReasoning}>{reasoning}</div>}
                  {dispChallenge && <div style={S.noteBox}>Your note: {dispChallenge.note}</div>}
                  {isClickable && isPicked && (
                    <textarea
                      style={S.noteTextarea}
                      placeholder="Explain why you're disputing this parameter (required)"
                      value={paramNotes[param] || ''}
                      onChange={e => { e.stopPropagation(); setParamNotes(prev => ({ ...prev, [param]: e.target.value })); }}
                      onClick={e => e.stopPropagation()}
                    />
                  )}
                </div>
              );
            })}
          </div>

          {/* Right panel */}
          <div style={S.rightPanel}>
            <div style={S.actionArea}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                {mode === 'evaluated' && !disputeDone && !disputing && (
                  <button style={S.disputeBtn} onClick={() => setDisputing(true)}>Raise Dispute</button>
                )}
                {mode === 'evaluated' && disputing && (
                  <>
                    <button style={submitBtnStyle(canSubmit)} onClick={submitDispute} disabled={!canSubmit || submitting}>
                      {submitting ? 'Submitting…' : 'Submit Dispute'}
                    </button>
                    <button style={S.cancelBtn} onClick={() => { setDisputing(false); setPickedParams(new Set()); setParamNotes({}); }}>Cancel</button>
                  </>
                )}
                {mode === 'evaluated' && disputeDone && (
                  <span style={statusBadgeStyle('#065F46', '#D1FAE5')}>Dispute raised</span>
                )}
                {mode === 'pending' && (
                  <span style={statusBadgeStyle('#92400E', '#FEF3C7')}>Under Review</span>
                )}
                {mode === 'reviewed' && (
                  <span style={statusBadgeStyle(isRejected ? '#991B1B' : '#065F46', isRejected ? '#FEE2E2' : '#D1FAE5')}>
                    {isRejected ? 'Dispute Rejected' : 'Dispute Accepted'}
                  </span>
                )}
                {error && <span style={{ fontSize: 11, color: '#DC2626' }}>{error}</span>}
              </div>
              <button style={S.closeBtn} onClick={onClose}>Close ✕</button>
            </div>

            {mode === 'pending' && (
              <div style={{ padding: '10px 18px', background: '#FFFBEB', borderBottom: '1px solid #FDE68A', fontSize: 12, color: '#92400E' }}>
                This dispute is under TL review. You cannot edit it.
              </div>
            )}
            {mode === 'reviewed' && reviewNote && (
              <div style={{ padding: '10px 18px', background: '#F0FDF4', borderBottom: '1px solid #BBF7D0', fontSize: 12, color: '#065F46' }}>
                <strong>Review note:</strong> {reviewNote}
                {reviewedBy && <span style={{ color: '#6B7280', marginLeft: 8 }}>— {reviewedBy}</span>}
              </div>
            )}
            {disputing && (
              <div style={{ padding: '10px 18px', background: '#EFF6FF', borderBottom: '1px solid #BFDBFE', fontSize: 12, color: '#1D4ED8' }}>
                Click parameters on the left to select them for dispute. Add a note for each.
              </div>
            )}

            <div style={S.transcriptWrap}>
              {transcriptLoading ? (
                <div style={{ color: '#9CA3AF', fontSize: 13, textAlign: 'center', marginTop: 40 }}>Loading transcript…</div>
              ) : transcriptMsgs.length === 0 ? (
                <div style={{ color: '#9CA3AF', fontSize: 13, textAlign: 'center', marginTop: 40 }}>No transcript available</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {transcriptMsgs.map((msg, i) => {
                    const isAgent = msg.role === 'assistant' || msg.role === 'bot';
                    return (
                      <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: isAgent ? 'flex-end' : 'flex-start' }}>
                        {msg.timestamp && (
                          <div style={{ ...S.bubbleTime, alignSelf: isAgent ? 'flex-end' : 'flex-start' }}>
                            {new Date(msg.timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                          </div>
                        )}
                        <div style={bubbleStyle(isAgent)}>{msg.content}</div>
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
