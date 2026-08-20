'use client';
import React, { useState, useEffect, useMemo } from 'react';
import { normalizeScore } from '@/lib/quality';
import { DisputeThread } from './DisputeThread';

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
  callId:            string;
  chatId?:           string | null;
  agentName:         string;
  iqsScore:          number;
  calledAt?:         string | null;
  disposition?:      string | null;
  gates?:            any;
  iqsScores?:        any;
  mode?:             'submit' | 'view' | 'review' | 'resolve';
  dispute?:          any;
  allowRaiseDispute?: boolean;
  onDisputeRaised?:  () => void;
  onDone:            () => void;
  onClose:           () => void;
  colSpan?:          number;
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
  callId,
  chatId,
  agentName,
  iqsScore,
  calledAt,
  disposition,
  gates,
  iqsScores,
  mode = 'view',
  dispute,
  allowRaiseDispute = false,
  onDisputeRaised,
  onDone,
  onClose,
  colSpan = 7,
}: CallEvalPanelProps) {
  const [segments, setSegments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [paramState, setParamState] = useState<Record<string, { score: string; reasoning: string }>>({});
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null);
  const [note, setNote] = useState(dispute?.reviewNote || '');
  const [saving, setSaving] = useState(false);
  const [isReevaluating, setIsReevaluating] = useState(false);
  const [liveIqs, setLiveIqs] = useState<number | null>(iqsScore);
  const [currentGates, setCurrentGates] = useState<any>(gates);
  const [currentIqsScores, setCurrentIqsScores] = useState<any>(iqsScores);

  // Raising dispute inline state (for TL or agent)
  const [raisingDispute, setRaisingDispute] = useState(false);
  const [disputeSelectedParams, setDisputeSelectedParams] = useState<Record<string, boolean>>({});
  const [disputeParamNotes, setDisputeParamNotes] = useState<Record<string, string>>({});
  const [agentDisputeNote, setAgentDisputeNote] = useState('');
  const [submittingDispute, setSubmittingDispute] = useState(false);

  useEffect(() => {
    setCurrentGates(gates);
  }, [gates]);

  useEffect(() => {
    setCurrentIqsScores(iqsScores);
  }, [iqsScores]);

  // Initialize parameter state
  useEffect(() => {
    const scores = currentIqsScores?.scores || currentIqsScores || {};
    const evidence = currentIqsScores?.evidence || {};
    const state: Record<string, { score: string; reasoning: string }> = {};

    Object.keys(CALL_IQS_WEIGHTS).forEach(p => {
      const val = scores[p] !== undefined ? String(scores[p]) : 'NA';
      const ev = evidence[p] ? (Array.isArray(evidence[p]) ? evidence[p][0]?.note || '' : typeof evidence[p] === 'object' ? evidence[p].note || '' : String(evidence[p])) : '';
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

  const challengedMap = useMemo(() => {
    const map = new Map<string, string>();
    if (dispute?.challengedParams && Array.isArray(dispute.challengedParams)) {
      for (const cp of dispute.challengedParams) {
        if (cp.param) map.set(cp.param, cp.note || '');
      }
    }
    return map;
  }, [dispute]);

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
        body: JSON.stringify({
          callId,
          scores,
          reasoning,
          note,
          flagId: dispute?.flagId,
          action: mode === 'review' || mode === 'resolve' ? 'resolve' : 'override',
        })
      });
      if (res.ok) {
        onDone();
      } else {
        const d = await res.json();
        alert(d.error || 'Failed to save evaluation');
      }
    } catch {
      alert('Error saving evaluation');
    } finally {
      setSaving(false);
    }
  };

  const handleRaiseDisputeSubmit = async () => {
    const challenged = Object.entries(disputeSelectedParams)
      .filter(([, checked]) => checked)
      .map(([paramKey]) => ({
        param: paramKey,
        note: disputeParamNotes[paramKey] || '',
      }));

    if (challenged.length === 0) {
      alert('Please select at least one parameter to challenge.');
      return;
    }

    setSubmittingDispute(true);
    try {
      const res = await fetch('/api/quality/flag', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          callId,
          chatId: chatId || callId,
          agentNote: agentDisputeNote,
          challengedParams: challenged,
        }),
      });

      if (res.ok) {
        alert('Dispute raised successfully!');
        setRaisingDispute(false);
        setDisputeSelectedParams({});
        setDisputeParamNotes({});
        setAgentDisputeNote('');
        onDisputeRaised?.();
        onDone();
      } else {
        const d = await res.json();
        alert(d.error || 'Failed to raise dispute');
      }
    } catch (e: any) {
      alert(`Error raising dispute: ${e.message}`);
    } finally {
      setSubmittingDispute(false);
    }
  };

  const isReadOnly = mode === 'view';
  const isReviewMode = mode === 'review' || mode === 'resolve';

  const callDateStr = calledAt
    ? new Date(calledAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true })
    : '';

  return (
    <tr>
      <td colSpan={colSpan} style={{ padding: '16px 20px', background: '#f8fafc', borderBottom: '1px solid var(--qa-border)' }}>
        {/* Header bar */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--qa-text)' }}>
            Call Evaluation Panel — ID: {callId} ({agentName}){callDateStr ? ` · ${callDateStr}` : ''}
          </h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {allowRaiseDispute && mode === 'view' && !dispute && !raisingDispute && (
              <button
                onClick={() => setRaisingDispute(true)}
                style={{
                  padding: '6px 12px',
                  fontSize: 12,
                  fontWeight: 600,
                  borderRadius: 6,
                  border: '1px solid #eab308',
                  background: '#fefce8',
                  color: '#854d0e',
                  cursor: 'pointer',
                }}
              >
                Raise Dispute
              </button>
            )}
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

        {/* Disputed Params banner */}
        {dispute?.challengedParams && dispute.challengedParams.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
            <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#71717A' }}>
              Disputed Params:
            </span>
            {dispute.challengedParams.map((cp: any) => (
              <span
                key={cp.param}
                title={cp.note}
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  letterSpacing: '0.02em',
                  background: '#F4F4F5',
                  border: '1px solid #E4E4E7',
                  borderRadius: 4,
                  padding: '2px 8px',
                  color: '#52525B',
                  cursor: cp.note ? 'help' : 'default',
                }}
              >
                {PARAM_NAMES[cp.param] ? `${cp.param}: ${PARAM_NAMES[cp.param]}` : cp.param}
              </span>
            ))}
          </div>
        )}

        {/* Dispute Thread & Activity (When reviewing dispute or viewing existing dispute) */}
        {dispute?.flagId && (
          <div style={{ marginBottom: 16 }}>
            <DisputeThread
              flagId={dispute.flagId}
              agentNote={dispute.agentNote}
              reviewNote={dispute.reviewNote}
              agentName={dispute.agentName || agentName}
              reviewedBy={dispute.reviewedBy}
              reviewerRole={dispute.reviewerRole || dispute.raisedByRole}
              flaggedAt={dispute.flaggedAt || dispute.raisedAt}
              reviewedAt={dispute.reviewedAt}
            />
          </div>
        )}

        {/* Inline Raise Dispute Form */}
        {raisingDispute && (
          <div style={{ padding: 16, background: '#fefce8', border: '1px solid #fef08a', borderRadius: 8, marginBottom: 16 }}>
            <h4 style={{ margin: '0 0 8px 0', fontSize: 14, fontWeight: 600, color: '#854d0e' }}>
              Raise Dispute on Call {callId}
            </h4>
            <p style={{ fontSize: 12, color: '#713f12', marginBottom: 12 }}>
              Select parameters to challenge and add brief justification:
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 8, marginBottom: 12 }}>
              {Object.keys(PARAM_NAMES).map(pKey => {
                const isChecked = Boolean(disputeSelectedParams[pKey]);
                return (
                  <div key={pKey} style={{ padding: 8, background: '#fff', border: `1px solid ${isChecked ? '#eab308' : '#e5e7eb'}`, borderRadius: 6 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={e => setDisputeSelectedParams(prev => ({ ...prev, [pKey]: e.target.checked }))}
                      />
                      {PARAM_NAMES[pKey]}
                    </label>
                    {isChecked && (
                      <input
                        type="text"
                        placeholder="Reason for challenge…"
                        value={disputeParamNotes[pKey] || ''}
                        onChange={e => setDisputeParamNotes(prev => ({ ...prev, [pKey]: e.target.value }))}
                        style={{ width: '100%', marginTop: 6, padding: '4px 6px', fontSize: 11, border: '1px solid #e5e7eb', borderRadius: 4 }}
                      />
                    )}
                  </div>
                );
              })}
            </div>
            <textarea
              placeholder="Overall explanation note…"
              value={agentDisputeNote}
              onChange={e => setAgentDisputeNote(e.target.value)}
              style={{ width: '100%', height: 48, padding: 8, fontSize: 12, border: '1px solid #e5e7eb', borderRadius: 6, marginBottom: 10 }}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                disabled={submittingDispute}
                onClick={handleRaiseDisputeSubmit}
                style={{ padding: '6px 14px', fontSize: 12, fontWeight: 600, background: '#854d0e', color: '#fff', border: 0, borderRadius: 6, cursor: 'pointer' }}
              >
                {submittingDispute ? 'Submitting…' : 'Submit Dispute'}
              </button>
              <button
                onClick={() => setRaisingDispute(false)}
                style={{ padding: '6px 14px', fontSize: 12, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 6, cursor: 'pointer' }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
          {/* Left panel: Transcript bubbles and audio */}
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
                  
                  const textContent = (seg.text || seg.translation || seg.content || '').trim();
                  if (!textContent) return null;

                  const isIR = seg.speaker === 'IR_EXECUTIVE' || seg.speaker === 'IR EXECUTIVE' || (seg.speaker || '').toLowerCase().includes('agent') || (seg.role || '').toLowerCase() === 'agent';
                  return (
                    <div key={idx} style={{ display: 'flex', flexDirection: 'column', alignSelf: isIR ? 'flex-end' : 'flex-start', maxWidth: '85%' }}>
                      <span style={{ fontSize: 10, color: 'var(--qa-text-3)', marginBottom: 2, alignSelf: isIR ? 'flex-end' : 'flex-start' }}>
                        {isIR ? '🟡 IR EXECUTIVE' : '🟢 INVESTOR'} · {seg.ts || seg.timestamp || ''}
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

          {/* Right panel: Parameters & Scoring */}
          <div style={{ width: 420, minWidth: 320, background: '#fff', border: '1px solid var(--qa-border)', borderRadius: 10, padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h4 style={{ margin: 0, fontSize: 13, fontWeight: 600, textTransform: 'uppercase', color: 'var(--qa-text-2)' }}>Evaluation Parameters</h4>
              <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--qa-text)' }}>
                Live Score: <span style={{ color: '#15803d' }}>{liveIqs !== null ? `${liveIqs}%` : '—'}</span>
              </span>
            </div>

            {/* Compliance Gates Card */}
            {currentGates && (
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
            )}

            {/* Parameter List */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
              {Object.keys(CALL_IQS_WEIGHTS).map(p => {
                const item = paramState[p] || { score: 'NA', reasoning: '' };
                const isChallenged = challengedMap.has(p);
                const challengedNote = challengedMap.get(p);

                return (
                  <div
                    key={p}
                    style={{
                      padding: 10,
                      background: isChallenged ? '#fffbeb' : '#fafafa',
                      border: `1px solid ${isChallenged ? '#fde047' : '#f0f0f2'}`,
                      borderRadius: 8
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--qa-text)' }}>
                        {PARAM_NAMES[p]} <span style={{ fontSize: 10, color: 'var(--qa-text-3)' }}>({CALL_IQS_WEIGHTS[p]}%)</span>
                      </span>
                      {isReadOnly ? (
                        <ScoreBadge score={item.score} />
                      ) : (
                        <div style={{ display: 'flex', gap: 4 }}>
                          {['Yes', 'No', 'NA'].map(val => (
                            <button
                              key={val}
                              onClick={() => handleScoreChange(p, val)}
                              style={{
                                padding: '2px 8px',
                                borderRadius: 4,
                                fontSize: 11,
                                fontWeight: item.score === val ? 700 : 500,
                                border: '1px solid var(--qa-border)',
                                background: item.score === val ? 'var(--qa-gray-700)' : '#fff',
                                color: item.score === val ? '#fff' : 'var(--qa-text)',
                                cursor: 'pointer'
                              }}
                            >
                              {val}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {isChallenged && (
                      <div style={{ margin: '4px 0', padding: '4px 6px', background: '#fefce8', border: '1px solid #fef08a', borderRadius: 4, fontSize: 11, color: '#854d0e' }}>
                        <strong>Challenged by Agent:</strong> {challengedNote || 'No specific note'}
                      </div>
                    )}

                    {isReadOnly ? (
                      item.reasoning ? (
                        <div style={{ fontSize: 11, color: 'var(--qa-text-2)', marginTop: 4 }}>{item.reasoning}</div>
                      ) : null
                    ) : (
                      <textarea
                        value={item.reasoning}
                        onChange={e => handleReasoningChange(p, e.target.value)}
                        placeholder="Reasoning for this parameter score…"
                        style={{
                          width: '100%',
                          minHeight: 36,
                          fontSize: 11,
                          border: '1px solid var(--qa-border)',
                          borderRadius: 6,
                          padding: '6px 8px',
                          outline: 'none',
                          resize: 'vertical',
                          fontFamily: 'inherit',
                          marginTop: 4,
                        }}
                      />
                    )}
                  </div>
                );
              })}
            </div>

            {/* Overrides / Notes / QA Dispute Resolution Action */}
            {!isReadOnly && (
              <div style={{ borderTop: '1px solid var(--qa-border)', paddingTop: 12 }}>
                <textarea
                  placeholder={isReviewMode ? 'QA Dispute Resolution / Review Note…' : 'Internal review note explaining why score was overridden…'}
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
                    background: isReviewMode ? '#166534' : 'var(--qa-gray-700)',
                    color: '#fff',
                    border: 0,
                    borderRadius: 8,
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: saving ? 'not-allowed' : 'pointer',
                    opacity: saving ? 0.7 : 1
                  }}
                >
                  {saving ? 'Saving…' : (isReviewMode ? 'Resolve Dispute & Submit Review' : 'Submit Evaluation Override')}
                </button>
              </div>
            )}
          </div>
        </div>
      </td>
    </tr>
  );
}
