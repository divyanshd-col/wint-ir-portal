'use client';
import React, { useState, useEffect } from 'react';
import { normalizeScore } from '@/lib/quality';
// Parameter weights for call IQS (v3.1 Spec)
const CALL_IQS_WEIGHTS: Record<string, number> = {
  P1: 20, // Factual correctness
  P2: 15, // All questions addressed
  P3: 15, // Expectation setting & follow-up specificity
  P5: 5,  // Call opening
  P6: 5,  // Call closing
  P7: 5,  // Pre-check, no repeat asks
  P8: 8,  // Simplifying & jargon
  P9: 9,  // Active listening & interruptions
  P10: 6, // Fillers & dead air
  P11: 12 // Energy, warmth, pace (audio)
};

export interface CallEvalPanelProps {
  callId:        string;
  chatId:        string | null;
  agentName:     string;
  iqsScore:      number;
  calledAt:      string;
  disposition:   string;
  gates:         any;
  iqsScores:     any;
  mode:          'submit' | 'view';
  onDone:        () => void;
  onClose:       () => void;
  colSpan:       number;
}

const PARAM_NAMES: Record<string, string> = {
  P1: 'Technically / Legally Correct (P1)',
  P2: 'All Questions Addressed (P2)',
  P3: 'Expectation Setting & Follow-up Specificity (P3)',
  P5: 'Call Opening (P5)',
  P6: 'Call Closing (P6)',
  P7: 'Pre-check, No Repeat Asks (P7)',
  P8: 'Simplifying & Jargon Handling (P8)',
  P9: 'Active Listening & Interruptions (P9)',
  P10: 'Fillers & Dead Air (P10)',
  P11: 'Energy, Warmth, & Pace (P11)'
};

function ScoreBadge({ score }: { score?: string | number | null | boolean }) {
  const norm = normalizeScore(score ?? null);
  return <span style={{ padding: '2px 6px', borderRadius: 4, fontSize: 10, fontWeight: 700, background: norm.badgeBg, color: norm.badgeText }}>{norm.label}</span>;
}

export default function CallEvalPanel({
  callId, agentName, iqsScore, calledAt, disposition,
  gates, iqsScores, mode, onDone, onClose, colSpan
}: CallEvalPanelProps) {
  const [segments, setSegments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [paramState, setParamState] = useState<Record<string, { score: string; reasoning: string }>>({});
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [isReevaluating, setIsReevaluating] = useState(false);
  const [liveIqs, setLiveIqs] = useState<number | null>(iqsScore);
  const [currentGates, setCurrentGates] = useState<any>(gates);
  const [currentIqsScores, setCurrentIqsScores] = useState<any>(iqsScores);

  useEffect(() => {
    setCurrentGates(gates);
  }, [gates]);

  useEffect(() => {
    setCurrentIqsScores(iqsScores);
  }, [iqsScores]);

  // Initialize parameter state
  useEffect(() => {
    const scores = currentIqsScores?.scores || {};
    const evidence = currentIqsScores?.evidence || {};
    const state: Record<string, { score: string; reasoning: string }> = {};

    Object.keys(CALL_IQS_WEIGHTS).forEach(p => {
      const val = scores[p] !== undefined ? String(scores[p]) : 'NA';
      const ev = evidence[p] ? (Array.isArray(evidence[p]) ? evidence[p][0]?.note || '' : String(evidence[p])) : '';
      state[p] = { score: val, reasoning: ev };
    });

    setParamState(state);
  }, [currentIqsScores]);

  // Recalculate live IQS score
  useEffect(() => {
    let earned = 0;
    let applicable = 0;
    Object.entries(paramState).forEach(([p, val]) => {
      const weight = CALL_IQS_WEIGHTS[p] || 0;
      if (val.score === 'NA') return;
      applicable += weight;
      const num = val.score === 'Yes' ? 2 : val.score === 'No' ? 0 : parseFloat(val.score);
      earned += weight * (num / 2);
    });
    setLiveIqs(applicable === 0 ? null : Math.round((earned / applicable) * 100));
  }, [paramState]);

  // Load call transcript segments
  useEffect(() => {
    fetch(`/api/call-quality/transcript?callId=${encodeURIComponent(callId)}`)
      .then(r => r.json())
      .then(d => {
        if (d.segments) setSegments(d.segments);
        if (d.recordingUrl) setRecordingUrl(d.recordingUrl);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [callId]);

  const handleScoreChange = (param: string, val: string) => {
    setParamState(prev => ({
      ...prev,
      [param]: { ...prev[param], score: val }
    }));
  };

  const handleReasoningChange = (param: string, text: string) => {
    setParamState(prev => ({
      ...prev,
      [param]: { ...prev[param], reasoning: text }
    }));
  };

  const handleReevaluate = async () => {
    if (isReevaluating || saving) return;
    const ok = confirm(`Re-evaluate call ID ${callId}?\n\nThis will re-run diarization, transcription, and scoring for this call.`);
    if (!ok) return;

    setIsReevaluating(true);
    try {
      const res = await fetch('/api/call-quality/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callId, forceTranscript: true })
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        // Re-fetch transcript segments & recording URL
        setLoading(true);
        try {
          const trRes = await fetch(`/api/call-quality/transcript?callId=${encodeURIComponent(callId)}`);
          const trData = await trRes.json();
          if (trData.segments) setSegments(trData.segments);
          if (trData.recordingUrl) setRecordingUrl(trData.recordingUrl);
        } catch (e) {
          console.error('Failed to reload transcript:', e);
        } finally {
          setLoading(false);
        }

        if (data.gates) setCurrentGates(data.gates);
        if (data.iqsScores) setCurrentIqsScores(data.iqsScores);
        if (data.iqs !== undefined && data.iqs !== null) setLiveIqs(data.iqs);

        alert('Call re-evaluation completed successfully!');
      } else {
        alert(`Re-evaluation failed: ${data.error || 'Unknown error'}`);
      }
    } catch (err: any) {
      alert(`Error re-evaluating call: ${err.message}`);
    } finally {
      setIsReevaluating(false);
    }
  };

  const handleSubmitOverride = async () => {
    setSaving(true);
    const scores: Record<string, string> = {};
    const reasoning: Record<string, string> = {};
    
    Object.entries(paramState).forEach(([p, val]) => {
      scores[p] = val.score;
      reasoning[p] = val.reasoning;
    });

    try {
      const res = await fetch('/api/call-quality/override-evaluation', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callId, scores, reasoning, note })
      });
      if (res.ok) {
        onDone();
      } else {
        alert('Failed to save override');
      }
    } catch {
      alert('Error saving override');
    } finally {
      setSaving(false);
    }
  };

  const isReadOnly = mode === 'view';

  const callDateStr = calledAt
    ? new Date(calledAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true })
    : '';

  return (
    <tr>
      <td colSpan={colSpan} style={{ padding: '16px 20px', background: '#f8fafc', borderBottom: '1px solid var(--qa-border)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--qa-text)' }}>
            Call Evaluation Panel — ID: {callId} ({agentName}){callDateStr ? ` · ${callDateStr}` : ''}
          </h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              onClick={handleReevaluate}
              disabled={isReevaluating || saving}
              title="Re-evaluate this call (diarization, transcription, and scoring)"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 12px',
                fontSize: 12,
                fontWeight: 600,
                borderRadius: 6,
                border: '1px solid var(--qa-border, #cbd5e1)',
                background: isReevaluating ? '#f1f5f9' : '#ffffff',
                color: isReevaluating ? '#64748b' : 'var(--qa-text, #0f172a)',
                cursor: isReevaluating ? 'not-allowed' : 'pointer',
                boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                transition: 'all 0.15s ease'
              }}
            >
              <span style={{
                display: 'inline-block',
                transform: isReevaluating ? 'rotate(180deg)' : 'none',
                transition: 'transform 0.5s ease-in-out'
              }}>
                🔄
              </span>
              {isReevaluating ? 'Re-evaluating Call…' : 'Re-evaluate Call'}
            </button>
            <button onClick={onClose} style={{ background: 'none', border: 0, fontSize: 18, color: 'var(--qa-text-3)', cursor: 'pointer', padding: '2px 6px' }}>✕</button>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
          {/* Left panel: Transcript bubbles */}
          <div style={{ flex: 1, minWidth: 320, background: '#fff', border: '1px solid var(--qa-border)', borderRadius: 10, padding: 16, maxHeight: '600px', overflowY: 'auto' }}>
            <h4 style={{ margin: '0 0 12px 0', fontSize: 13, fontWeight: 600, textTransform: 'uppercase', color: 'var(--qa-text-2)' }}>Transcript</h4>
            {recordingUrl && (
              <div style={{
                padding: '10px 14px',
                background: '#f8fafc',
                border: '1px solid var(--qa-border)',
                borderRadius: 8,
                marginBottom: 12,
                display: 'flex',
                flexDirection: 'column',
                gap: 4
              }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--qa-text-3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Audio Recording</span>
                <audio
                  src={`/api/quality/audio-proxy?url=${encodeURIComponent(recordingUrl)}`}
                  controls
                  style={{ width: '100%', height: 32 }}
                />
              </div>
            )}
            {loading ? (
              <p style={{ color: 'var(--qa-text-3)', fontSize: 13 }}>Loading transcript…</p>
            ) : segments.length === 0 ? (
              <p style={{ color: 'var(--qa-text-3)', fontSize: 13, fontStyle: 'italic' }}>No segments recorded</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {segments.map((seg, idx) => {
                  if (seg.type === 'interruption') {
                    return (
                      <div key={idx} style={{ padding: '6px 12px', background: '#fef2f2', color: '#991b1b', borderRadius: 8, fontSize: 12, border: '1px solid #fee2e2' }}>
                        ⚡ <b>{seg.interrupted_speaker || 'IR EXECUTIVE'}</b> interrupted by <b>{seg.interrupted_by || 'INVESTOR'}</b>
                      </div>
                    );
                  }
                  if (seg.type === 'dead_air') {
                    return (
                      <div key={idx} style={{ padding: '6px 12px', background: '#f8fafc', color: '#475569', borderRadius: 8, fontSize: 12, border: '1px solid #f1f5f9' }}>
                        ⏸ Dead air: {seg.duration || '2+ seconds'}
                      </div>
                    );
                  }
                  
                  const textContent = (seg.text || seg.translation || '').trim();
                  if (!textContent) return null;

                  const isIR = seg.speaker === 'IR_EXECUTIVE' || seg.speaker === 'IR EXECUTIVE';
                  return (
                    <div key={idx} style={{ display: 'flex', flexDirection: 'column', alignSelf: isIR ? 'flex-end' : 'flex-start', maxWidth: '85%' }}>
                      <span style={{ fontSize: 10, color: 'var(--qa-text-3)', marginBottom: 2, alignSelf: isIR ? 'flex-end' : 'flex-start' }}>
                        {isIR ? '🟡 IR EXECUTIVE' : '🟢 INVESTOR'} · {seg.ts || ''}
                      </span>
                      <div style={{
                        padding: '10px 14px',
                        borderRadius: 12,
                        background: isIR ? 'var(--qa-gray-700)' : '#f1f5f9',
                        color: isIR ? '#fff' : 'var(--qa-text)',
                        fontSize: 13,
                        lineHeight: '18px'
                      }}>
                        {textContent}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Right panel: Evaluation list */}
          <div style={{ width: 420, background: '#fff', border: '1px solid var(--qa-border)', borderRadius: 10, padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h4 style={{ margin: 0, fontSize: 13, fontWeight: 600, textTransform: 'uppercase', color: 'var(--qa-text-2)' }}>Evaluation Parameters</h4>
              <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--qa-text)' }}>
                Live Score: <span style={{ color: '#15803d' }}>{liveIqs ?? '—'}%</span>
              </span>
            </div>

            {/* Compliance Gates Card */}
            <div style={{ background: '#f8fafc', border: '1px solid var(--qa-border)', borderRadius: 8, padding: 12 }}>
              <h5 style={{ margin: '0 0 8px 0', fontSize: 12, fontWeight: 700, color: 'var(--qa-text-2)', textTransform: 'uppercase' }}>
                Compliance Gates: <span style={{ color: currentGates?.call_gate_result === 'FAIL' ? '#b91c1c' : '#15803d' }}>{currentGates?.call_gate_result || 'PASS'}</span>
              </h5>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12 }}>
                <div>G1 Advice: <ScoreBadge score={currentGates?.G1_no_advice?.status === 'pass' ? 'Yes' : currentGates?.G1_no_advice?.status === 'fail' ? 'No' : 'NA'} /></div>
                <div>G2 Fabrication: <ScoreBadge score={currentGates?.G2_no_fabrication?.status === 'pass' ? 'Yes' : currentGates?.G2_no_fabrication?.status === 'fail' ? 'No' : 'NA'} /></div>
                <div>G3 Identity: <ScoreBadge score={currentGates?.G3_identity_first?.status === 'pass' ? 'Yes' : currentGates?.G3_identity_first?.status === 'fail' ? 'No' : 'NA'} /></div>
              </div>
            </div>

            {/* Parameters Accordion/List */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxHeight: '360px', overflowY: 'auto', paddingRight: 4 }}>
              {Object.keys(CALL_IQS_WEIGHTS).map(p => {
                const state = paramState[p] || { score: 'NA', reasoning: '' };
                const weight = CALL_IQS_WEIGHTS[p];

                return (
                  <div key={p} style={{ borderBottom: '1px solid #f1f5f9', paddingBottom: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--qa-text)', flex: 1, marginRight: 8 }}>
                        {PARAM_NAMES[p]} <span style={{ color: 'var(--qa-text-3)', fontWeight: 400 }}>({weight}%)</span>
                      </span>
                      {isReadOnly ? (
                        <ScoreBadge score={state.score} />
                      ) : (
                        <div style={{ display: 'flex', gap: 2 }}>
                          {['2', '1', '0', 'NA'].map(v => (
                            <button
                              key={v}
                              onClick={() => handleScoreChange(p, v)}
                              style={{
                                border: '1px solid var(--qa-border)',
                                borderRadius: 4,
                                padding: '2px 6px',
                                fontSize: 10,
                                fontWeight: 700,
                                cursor: 'pointer',
                                background: state.score === v ? '#1e293b' : '#fff',
                                color: state.score === v ? '#fff' : 'var(--qa-text-2)'
                              }}
                            >
                              {v === '2' ? 'Yes' : v === '0' ? 'No' : v === '1' ? 'Part' : 'NA'}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    {isReadOnly ? (
                      <p style={{ margin: 0, fontSize: 11, color: 'var(--qa-text-2)', lineHeight: '16px' }}>{state.reasoning}</p>
                    ) : (
                      <textarea
                        value={state.reasoning}
                        onChange={e => handleReasoningChange(p, e.target.value)}
                        placeholder="Reasoning for this parameter score override…"
                        style={{
                          width: '100%',
                          minHeight: 36,
                          fontSize: 11,
                          border: '1px solid var(--qa-border)',
                          borderRadius: 6,
                          padding: '6px 8px',
                          outline: 'none',
                          resize: 'vertical',
                          fontFamily: 'inherit'
                        }}
                      />
                    )}
                  </div>
                );
              })}
            </div>

            {/* Overrides / Notes action */}
            {!isReadOnly && (
              <div style={{ borderTop: '1px solid var(--qa-border)', paddingTop: 12 }}>
                <textarea
                  placeholder="Internal review note explaining why score was overridden…"
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  style={{
                    width: '100%',
                    height: 52,
                    fontSize: 12,
                    border: '1px solid var(--qa-border)',
                    borderRadius: 8,
                    padding: '8px',
                    marginBottom: 10,
                    outline: 'none',
                    resize: 'none',
                    fontFamily: 'inherit'
                  }}
                />
                <button
                  disabled={saving}
                  onClick={handleSubmitOverride}
                  style={{
                    width: '100%',
                    height: 36,
                    background: 'var(--qa-gray-700)',
                    color: '#fff',
                    border: 0,
                    borderRadius: 8,
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: saving ? 'not-allowed' : 'pointer',
                    opacity: saving ? 0.7 : 1
                  }}
                >
                  {saving ? 'Saving…' : 'Submit Evaluation Override'}
                </button>
              </div>
            )}
          </div>
        </div>
      </td>
    </tr>
  );
}
