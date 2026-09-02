'use client';
import React, { useState, useEffect, useMemo } from 'react';
import { usePathname } from 'next/navigation';
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
  mobileNumber?:     string | null;
  agentName:         string;
  iqsScore:          number;
  calledAt?:         string | null;
  disposition?:      string | null;
  gates?:            any;
  iqsScores?:        any;
  mode?:             'submit' | 'view' | 'review' | 'resolve';
  dispute?:          any;
  allowRaiseDispute?: boolean;
  allowReevaluate?:  boolean;
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

const PARAM_ALIASES: Record<string, string[]> = {
  P1: ['P1', 'TechnicalLegal', 'Technical', 'factual', 'P1_factual'],
  P2: ['P2', 'AllQuestions', 'questions', 'P2_questions'],
  P3: ['P3', 'Expectation', 'ExpectationSetting', 'P3_expectation'],
  P5: ['P5', 'CallOpening', 'Opening', 'P5_opening'],
  P6: ['P6', 'CallClosing', 'Closing', 'P6_closing'],
  P7: ['P7', 'Process', 'PreCheck', 'P7_process'],
  P8: ['P8', 'Simplifying', 'Jargon', 'P8_simplifying'],
  P9: ['P9', 'ActiveListening', 'ActiveListeningInterruptions', 'P9_active_listening'],
  P10: ['P10', 'Fillers', 'DeadAir', 'FillersDeadAir', 'P10_fillers'],
  P11: ['P11', 'EnergyTone', 'Energy', 'EnergyWarmthPace', 'P11_energy'],
};

function normScoreVal(val: any): string {
  if (val === true || val === 2 || val === '2' || val === 'Yes' || val === 'yes' || val === 'PASS' || val === 'pass') return 'Yes';
  if (val === false || val === 0 || val === '0' || val === 'No' || val === 'no' || val === 'FAIL' || val === 'fail') return 'No';
  if (val === 1 || val === '1' || val === 0.5 || val === '0.5' || val === 'Part' || val === 'part' || val === 'Half' || val === 'half' || val === 'Partial' || val === 'partial') return 'Half';
  if (val === 'NA' || val === 'na' || val === null || val === undefined) return 'NA';
  return String(val);
}

function extractReasoning(ev: any): string {
  if (!ev) return '';
  if (typeof ev === 'string') return ev.trim();
  if (Array.isArray(ev)) {
    const parts = ev
      .map(item => {
        if (!item) return '';
        if (typeof item === 'string') return item.trim();
        const text = item.note || item.why || item.reason || item.comment || item.explanation || item.text || item.quote || '';
        return typeof text === 'string' ? text.trim() : String(text);
      })
      .filter(Boolean);
    return parts.join(' • ');
  }
  if (typeof ev === 'object') {
    const text = ev.note || ev.why || ev.reason || ev.comment || ev.explanation || ev.text || ev.quote || '';
    return typeof text === 'string' ? text.trim() : String(text);
  }
  return String(ev).trim();
}

function resolveParamData(raw: any, pKey: string): { score: string; reasoning: string } {
  if (!raw || typeof raw !== 'object') return { score: 'NA', reasoning: '' };
  const aliases = PARAM_ALIASES[pKey] || [pKey];

  const scoresObj = raw.scores || (raw.__scores ? null : raw);
  const evidenceObj = raw.evidence || raw.reasoning || raw.parameters || {};

  // 1. Check scoresObj
  if (scoresObj && typeof scoresObj === 'object') {
    for (const alias of aliases) {
      if (scoresObj[alias] !== undefined) {
        const val = scoresObj[alias];
        if (typeof val === 'object' && val !== null) {
          const s = val.score !== undefined ? normScoreVal(val.score) : 'NA';
          const r = extractReasoning(val.reasoning || val.evidence || val.note || val.why || val.comment || val);
          return { score: s, reasoning: r };
        }
        const s = normScoreVal(val);
        const ev = evidenceObj[alias] || raw[`${alias}_reasoning`] || raw[`${alias}_evidence`] || raw[`${alias}_note`];
        const r = extractReasoning(ev);
        return { score: s, reasoning: r };
      }
    }
  }

  // 2. Check top level
  for (const alias of aliases) {
    if (raw[alias] !== undefined) {
      const val = raw[alias];
      if (typeof val === 'object' && val !== null) {
        const s = val.score !== undefined ? normScoreVal(val.score) : 'NA';
        const r = extractReasoning(val.reasoning || val.evidence || val.note || val.why || val.comment);
        return { score: s, reasoning: r };
      }
      const ev = evidenceObj[alias] || raw[`${alias}_reasoning`] || raw[`${alias}_evidence`];
      return { score: normScoreVal(val), reasoning: extractReasoning(ev) };
    }
  }

  return { score: 'NA', reasoning: '' };
}

const COMPLIANCE_GATES_LIST = [
  { key: 'G1_no_advice', label: 'G1: Advice (No Investment / Tax Advice)', shortLabel: 'G1 Advice' },
  { key: 'G2_no_fabrication', label: 'G2: Fabrication (No Fabricated Facts)', shortLabel: 'G2 Fabrication' },
  { key: 'G3_identity_first', label: 'G3: Identity (Identity Verified First)', shortLabel: 'G3 Identity' },
];

interface GateParamState {
  status: 'pass' | 'fail' | 'not_applicable';
  reasoning: string;
}

function extractGateReasoning(item: any): string {
  if (!item) return '';
  if (typeof item === 'string') return item;
  if (typeof item !== 'object') return String(item);

  const parts: string[] = [];

  if (item.reasoning && typeof item.reasoning === 'string' && item.reasoning.trim()) {
    parts.push(item.reasoning.trim());
  } else if (item.reason && typeof item.reason === 'string' && item.reason.trim()) {
    parts.push(item.reason.trim());
  } else if (item.note && typeof item.note === 'string' && item.note.trim()) {
    parts.push(item.note.trim());
  } else if (item.why && typeof item.why === 'string' && item.why.trim()) {
    parts.push(item.why.trim());
  }

  if (item.reason_code && typeof item.reason_code === 'string') {
    parts.push(`[Reason code: ${item.reason_code}]`);
  }

  // Evidence list
  if (Array.isArray(item.evidence) && item.evidence.length > 0) {
    const evText = item.evidence
      .map((ev: any) => {
        if (!ev) return '';
        if (typeof ev === 'string') return ev;
        const turnStr = ev.turn !== undefined && ev.turn !== null ? `Turn ${ev.turn}: ` : '';
        const quoteStr = ev.quote ? `"${ev.quote}"` : '';
        const whyStr = ev.why || ev.note || '';
        if (quoteStr && whyStr) return `${turnStr}${quoteStr} — Note: ${whyStr}`;
        if (quoteStr) return `${turnStr}${quoteStr}`;
        if (whyStr) return `${turnStr}Note: ${whyStr}`;
        return typeof ev === 'object' ? JSON.stringify(ev) : String(ev);
      })
      .filter(Boolean)
      .join('\n');
    if (evText && !parts.some(p => p.includes(evText))) {
      parts.push(evText);
    }
  } else if (item.evidence && typeof item.evidence === 'string' && item.evidence.trim()) {
    parts.push(item.evidence.trim());
  }

  // Borderline list
  if (Array.isArray(item.borderline) && item.borderline.length > 0) {
    const blText = item.borderline
      .map((bl: any) => {
        if (!bl) return '';
        if (typeof bl === 'string') return `Borderline: ${bl}`;
        const turnStr = bl.turn !== undefined && bl.turn !== null ? `Turn ${bl.turn}: ` : '';
        const quoteStr = bl.quote ? `"${bl.quote}"` : '';
        const whyStr = bl.why || bl.note || '';
        return `Borderline: ${turnStr}${quoteStr} ${whyStr ? `(${whyStr})` : ''}`.trim();
      })
      .filter(Boolean)
      .join('; ');
    if (blText) parts.push(blText);
  }

  return parts.filter(Boolean).join('\n');
}

function resolveGateData(rawGates: any, gateKey: string, altKey?: string): GateParamState {
  if (!rawGates || typeof rawGates !== 'object') {
    return { status: 'pass', reasoning: '' };
  }
  const item = rawGates[gateKey] || (altKey ? rawGates[altKey] : undefined) || rawGates[gateKey.toLowerCase()] || rawGates[gateKey.split('_')[0]];
  if (!item) return { status: 'pass', reasoning: '' };

  let status: 'pass' | 'fail' | 'not_applicable' = 'pass';
  if (typeof item === 'object') {
    if (item.status === 'pass' || item.status === 'fail' || item.status === 'not_applicable') {
      status = item.status;
    } else if (item.score === 'Yes' || item.score === true || item.score === 1) {
      status = 'pass';
    } else if (item.score === 'No' || item.score === false || item.score === 0) {
      status = 'fail';
    } else if (item.score === 'NA' || item.score === 'not_applicable') {
      status = 'not_applicable';
    }
  } else if (typeof item === 'string') {
    const s = item.toLowerCase();
    if (s === 'pass' || s === 'yes') status = 'pass';
    else if (s === 'fail' || s === 'no') status = 'fail';
    else if (s === 'na' || s === 'not_applicable') status = 'not_applicable';
  } else if (typeof item === 'boolean') {
    status = item ? 'pass' : 'fail';
  }

  const reasoning = extractGateReasoning(item);
  return { status, reasoning };
}

export default function CallEvalPanel({
  callId,
  chatId,
  mobileNumber,
  agentName,
  iqsScore,
  calledAt,
  disposition,
  gates,
  iqsScores,
  mode = 'submit',
  dispute,
  allowRaiseDispute = false,
  allowReevaluate = false,
  onDisputeRaised,
  onDone = () => {},
  onClose,
  colSpan = 6,
}: CallEvalPanelProps) {
  const [segments, setSegments] = useState<any[]>([]);
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isReevaluating, setIsReevaluating] = useState(false);
  const [note, setNote] = useState(dispute?.reviewNote || '');
  const [currentGates, setCurrentGates] = useState<any>(gates || null);
  const [currentIqsScores, setCurrentIqsScores] = useState<any>(iqsScores || null);
  const [currentIqs, setCurrentIqs] = useState<number | null>(iqsScore != null && !isNaN(iqsScore) ? iqsScore : null);
  const [paramState, setParamState] = useState<Record<string, { score: string; reasoning: string }>>({});

  // Compliance Gates state
  const [gateState, setGateState] = useState<Record<string, GateParamState>>(() => {
    const initial: Record<string, GateParamState> = {};
    COMPLIANCE_GATES_LIST.forEach(g => {
      initial[g.key] = resolveGateData(gates || dispute?.gates || dispute?.parameters?.gates, g.key);
    });
    return initial;
  });

  // Raising dispute inline state (for TL or agent)
  const [raisingDispute, setRaisingDispute] = useState(false);
  const [disputeSelectedParams, setDisputeSelectedParams] = useState<Record<string, boolean>>({});
  const [disputeParamNotes, setDisputeParamNotes] = useState<Record<string, string>>({});
  const [agentDisputeNote, setAgentDisputeNote] = useState('');
  const [submittingDispute, setSubmittingDispute] = useState(false);

  useEffect(() => {
    if (gates) setCurrentGates(gates);
    else if (dispute?.gates) setCurrentGates(dispute.gates);
    else if (dispute?.parameters?.gates) setCurrentGates(dispute.parameters.gates);
  }, [gates, dispute]);

  useEffect(() => {
    const raw = currentGates || gates || dispute?.gates || dispute?.parameters?.gates;
    if (raw) {
      const next: Record<string, GateParamState> = {};
      COMPLIANCE_GATES_LIST.forEach(g => {
        next[g.key] = resolveGateData(raw, g.key);
      });
      setGateState(next);
    }
  }, [currentGates, gates, dispute]);

  const overallGateResult = useMemo(() => {
    const hasFail = Object.values(gateState).some(g => g.status === 'fail');
    return hasFail ? 'FAIL' : 'PASS';
  }, [gateState]);

  const handleGateStatusChange = (gateKey: string, status: 'pass' | 'fail' | 'not_applicable') => {
    setGateState(prev => ({
      ...prev,
      [gateKey]: { ...(prev[gateKey] || { reasoning: '' }), status }
    }));
  };

  const handleGateReasoningChange = (gateKey: string, reasoning: string) => {
    setGateState(prev => ({
      ...prev,
      [gateKey]: { ...(prev[gateKey] || { status: 'pass' }), reasoning }
    }));
  };

  useEffect(() => {
    if (iqsScores) setCurrentIqsScores(iqsScores);
    else if (dispute?.parameters) setCurrentIqsScores(dispute.parameters);
  }, [iqsScores, dispute]);

  useEffect(() => {
    if (iqsScore != null && !isNaN(iqsScore)) {
      setCurrentIqs(iqsScore);
    }
  }, [iqsScore]);

  // Initialize parameter state
  useEffect(() => {
    let raw = currentIqsScores || dispute?.parameters || iqsScores;
    if (typeof raw === 'string') {
      try { raw = JSON.parse(raw); } catch {}
    }
    const state: Record<string, { score: string; reasoning: string }> = {};

    Object.keys(CALL_IQS_WEIGHTS).forEach(p => {
      state[p] = resolveParamData(raw, p);
    });

    setParamState(state);
  }, [currentIqsScores, dispute, iqsScores]);

  const [hasReevaluated, setHasReevaluated] = useState(false);
  const [fetchedChatId, setFetchedChatId] = useState<string | null>(null);
  const [fetchedChatStatus, setFetchedChatStatus] = useState<string | null>(null);
  const [fetchedMobileNumber, setFetchedMobileNumber] = useState<string | null>(null);

  // Load call transcript segments and fallback evaluation details
  useEffect(() => {
    fetch(`/api/call-quality/transcript?callId=${encodeURIComponent(callId)}`)
      .then(r => r.json())
      .then(d => {
        if (d.segments) setSegments(d.segments);
        if (d.recordingUrl) setRecordingUrl(d.recordingUrl);
        if (d.chatId) setFetchedChatId(d.chatId);
        if (d.chatStatus) setFetchedChatStatus(d.chatStatus);
        if (d.mobileNumber) setFetchedMobileNumber(d.mobileNumber);
        if (d.hasReevaluated || (d.reevalCount && d.reevalCount > 0)) {
          setHasReevaluated(true);
        }
        if (d.gates && (!currentGates || Object.keys(currentGates).length === 0)) {
          setCurrentGates(d.gates);
        }
        if (d.iqsScores && (!currentIqsScores || Object.keys(currentIqsScores).length === 0)) {
          setCurrentIqsScores(d.iqsScores);
        }
        if (d.iqsPercent != null && (currentIqs === null || isNaN(currentIqs))) {
          setCurrentIqs(parseFloat(d.iqsPercent));
        }
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

  const [isTranscriptModified, setIsTranscriptModified] = useState(false);
  const [isSavingTranscript, setIsSavingTranscript] = useState(false);

  const handleSwapAllSpeakers = () => {
    setSegments(prev => {
      return prev.map(seg => {
        if (seg.type === 'interruption') {
          const isInterruptedIR = seg.interrupted_speaker === 'IR_EXECUTIVE' || seg.interrupted_speaker === 'IR EXECUTIVE' || (seg.interrupted_speaker || '').toLowerCase().includes('agent');
          return {
            ...seg,
            interrupted_speaker: isInterruptedIR ? 'INVESTOR' : 'IR_EXECUTIVE',
            interrupted_by: isInterruptedIR ? 'IR_EXECUTIVE' : 'INVESTOR'
          };
        }
        const isIR = seg.speaker === 'IR_EXECUTIVE' || seg.speaker === 'IR EXECUTIVE' || (seg.speaker || '').toLowerCase().includes('agent') || (seg.role || '').toLowerCase() === 'agent';
        return {
          ...seg,
          speaker: isIR ? 'INVESTOR' : 'IR_EXECUTIVE',
          role: isIR ? 'customer' : 'agent'
        };
      });
    });
    setIsTranscriptModified(true);
  };

  const handleToggleSpeaker = (idx: number) => {
    setSegments(prev => {
      const copy = [...prev];
      const seg = copy[idx];
      if (!seg) return prev;
      const isIR = seg.speaker === 'IR_EXECUTIVE' || seg.speaker === 'IR EXECUTIVE' || (seg.speaker || '').toLowerCase().includes('agent') || (seg.role || '').toLowerCase() === 'agent';
      copy[idx] = {
        ...seg,
        speaker: isIR ? 'INVESTOR' : 'IR_EXECUTIVE',
        role: isIR ? 'customer' : 'agent'
      };
      return copy;
    });
    setIsTranscriptModified(true);
  };

  const handleSaveTranscriptAndReevaluate = async () => {
    if (isSavingTranscript || isReevaluating || saving) return;
    setIsSavingTranscript(true);
    try {
      // 1. Save updated segments to call_recordings
      const saveRes = await fetch('/api/call-quality/update-transcript', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ call_id: callId, segments })
      });
      const saveData = await saveRes.json();
      if (!saveRes.ok || !saveData.ok) {
        alert(saveData.error || 'Failed to save corrected transcript');
        setIsSavingTranscript(false);
        return;
      }
      setIsTranscriptModified(false);

      // 2. Re-evaluate quality scores using corrected transcript
      setIsReevaluating(true);
      const evalRes = await fetch('/api/call-quality/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callId, forceTranscript: false })
      });
      const data = await evalRes.json();
      if (evalRes.ok && data.ok) {
        setHasReevaluated(true);
        setIsTranscriptModified(false);
        if (data.gates) setCurrentGates(data.gates);
        if (data.iqsScores) {
          setCurrentIqsScores(data.iqsScores);
          const raw = data.iqsScores;
          const state: Record<string, { score: string; reasoning: string }> = {};
          Object.keys(CALL_IQS_WEIGHTS).forEach(p => {
            state[p] = resolveParamData(raw, p);
          });
          setParamState(state);
        }
        if (data.iqs !== undefined && data.iqs !== null) {
          const parsed = typeof data.iqs === 'number' ? data.iqs : parseFloat(data.iqs);
          if (!isNaN(parsed)) setCurrentIqs(parsed);
        }

        alert('Transcript saved and call quality re-evaluated successfully!');
      } else {
        alert(`Re-evaluation failed: ${data.error || 'Unknown error'}`);
      }
    } catch (err: any) {
      alert(`Error saving and re-evaluating: ${err.message}`);
    } finally {
      setIsSavingTranscript(false);
      setIsReevaluating(false);
    }
  };

  const handleReevaluate = async () => {
    if (isReevaluating || saving || isSavingTranscript) return;
    const ok = confirm(`Re-evaluate call ID ${callId}?\n\nThis will re-run the evaluation scoring and parameter calculation for this call.`);
    if (!ok) return;

    setIsReevaluating(true);
    try {
      const res = await fetch('/api/call-quality/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callId, forceTranscript: false })
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
        if (data.iqsScores) {
          setCurrentIqsScores(data.iqsScores);
          const raw = data.iqsScores;
          const state: Record<string, { score: string; reasoning: string }> = {};
          Object.keys(CALL_IQS_WEIGHTS).forEach(p => {
            state[p] = resolveParamData(raw, p);
          });
          setParamState(state);
        }
        if (data.iqs !== undefined && data.iqs !== null) {
          const parsed = typeof data.iqs === 'number' ? data.iqs : parseFloat(data.iqs);
          if (!isNaN(parsed)) setCurrentIqs(parsed);
        }

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

    const gatesPayload: Record<string, any> = {
      ...(currentGates || {}),
      G1_no_advice: {
        ...(currentGates?.G1_no_advice || {}),
        status: gateState['G1_no_advice']?.status || 'pass',
        reasoning: gateState['G1_no_advice']?.reasoning || '',
        evidence: gateState['G1_no_advice']?.reasoning
          ? [{ note: gateState['G1_no_advice'].reasoning }]
          : (currentGates?.G1_no_advice?.evidence || []),
      },
      G2_no_fabrication: {
        ...(currentGates?.G2_no_fabrication || {}),
        status: gateState['G2_no_fabrication']?.status || 'pass',
        reasoning: gateState['G2_no_fabrication']?.reasoning || '',
        evidence: gateState['G2_no_fabrication']?.reasoning
          ? [{ note: gateState['G2_no_fabrication'].reasoning }]
          : (currentGates?.G2_no_fabrication?.evidence || []),
      },
      G3_identity_first: {
        ...(currentGates?.G3_identity_first || {}),
        status: gateState['G3_identity_first']?.status || 'pass',
        reasoning: gateState['G3_identity_first']?.reasoning || '',
        evidence: gateState['G3_identity_first']?.reasoning
          ? [{ note: gateState['G3_identity_first'].reasoning }]
          : (currentGates?.G3_identity_first?.evidence || []),
      },
      call_gate_result: overallGateResult,
    };

    try {
      const res = await fetch('/api/call-quality/override-evaluation', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          callId,
          scores,
          reasoning,
          gates: gatesPayload,
          callGateResult: overallGateResult,
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
  const effectiveChatId = chatId || fetchedChatId;
  const effectiveChatStatus = fetchedChatStatus || (mode === 'submit' ? 'pending' : mode === 'view' ? 'reviewed' : 'pending');
  const qaChatTab = effectiveChatStatus === 'reviewed' ? 'reviewed' : 'pending';

  const pathname = usePathname() || '';
  const chatSectionUrl = effectiveChatId
    ? pathname.startsWith('/agent')
      ? `/agent/quality-chats?chatId=${encodeURIComponent(effectiveChatId)}`
      : pathname.startsWith('/tl')
      ? `/tl/quality-chats?chatId=${encodeURIComponent(effectiveChatId)}`
      : `/quality/chat-evaluation?chatId=${encodeURIComponent(effectiveChatId)}&tab=${qaChatTab}`
    : '#';

  const callDateStr = calledAt
    ? new Date(calledAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true })
    : '';

  const effectiveMobile = mobileNumber || fetchedMobileNumber;

  return (
    <tr>
      <td colSpan={colSpan} style={{ padding: '16px 20px', background: '#f8fafc', borderBottom: '1px solid var(--qa-border)' }}>
        {/* Header bar */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--qa-text)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span>Call Evaluation Panel — ID: {callId} ({agentName})</span>
            {callDateStr && <span>· {callDateStr}</span>}
            {effectiveMobile && (
              <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 13, fontWeight: 500, color: 'var(--qa-text-2)', background: 'var(--qa-fill-light, #f1f5f9)', padding: '2px 8px', borderRadius: 6, border: '1px solid var(--qa-border, #e2e8f0)' }}>
                📱 {effectiveMobile}
              </span>
            )}
          </h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {effectiveChatId && (
              <a
                href={`https://app.robylon.ai/unified-inbox/share/${effectiveChatId}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 12px',
                  fontSize: 12,
                  fontWeight: 600,
                  borderRadius: 6,
                  border: '1px solid var(--qa-border, #E4E4E7)',
                  background: '#fff',
                  color: 'var(--qa-text, #111111)',
                  textDecoration: 'none',
                  cursor: 'pointer',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
                }}
                title={`Open chat ${effectiveChatId} in Robylon`}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                </svg>
                Show Chat
                <span style={{ fontSize: 11, opacity: 0.6 }}>↗</span>
              </a>
            )}
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
            {allowReevaluate && !hasReevaluated && isTranscriptModified && (
              <button
                onClick={handleSaveTranscriptAndReevaluate}
                disabled={isSavingTranscript || isReevaluating || saving}
                title="Save modified speaker diarization and re-evaluate this call"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 12px',
                  fontSize: 12,
                  fontWeight: 600,
                  borderRadius: 6,
                  border: '1px solid #ca8a04',
                  background: '#ca8a04',
                  color: '#ffffff',
                  cursor: (isSavingTranscript || isReevaluating || saving) ? 'not-allowed' : 'pointer',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                  transition: 'all 0.15s ease'
                }}
              >
                <span style={{
                  display: 'inline-block',
                  transform: (isSavingTranscript || isReevaluating) ? 'rotate(180deg)' : 'none',
                  transition: 'transform 0.5s ease-in-out'
                }}>
                  🔄
                </span>
                {isSavingTranscript ? 'Saving transcript…' : isReevaluating ? 'Re-evaluating Call…' : 'Save & Re-evaluate Call'}
              </button>
            )}
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
              reviewNote={dispute.reviewNote || note}
              agentName={dispute.agentName || agentName}
              reviewedBy={dispute.reviewedBy || dispute.resolvedBy || dispute.qaName}
              reviewerRole="quality"
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <h4 style={{ margin: 0, fontSize: 13, fontWeight: 600, textTransform: 'uppercase', color: 'var(--qa-text-2)' }}>Transcript</h4>
                {effectiveChatId && (
                  <span
                    style={{
                      fontSize: 11,
                      fontFamily: 'ui-monospace, monospace',
                      color: '#475569',
                      background: '#f1f5f9',
                      padding: '2px 8px',
                      borderRadius: 4,
                      border: '1px solid #e2e8f0',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      fontWeight: 500,
                    }}
                  >
                    <span>💬</span> Chat #{effectiveChatId}
                  </span>
                )}
              </div>
              
              {allowReevaluate && (
                hasReevaluated ? (
                  <span style={{ fontSize: 11, fontWeight: 500, color: '#64748b', background: '#f1f5f9', padding: '3px 8px', borderRadius: 4 }}>
                    ✓ Re-evaluation used
                  </span>
                ) : (
                  <button
                    onClick={handleSwapAllSpeakers}
                    disabled={loading || segments.length === 0 || isSavingTranscript || isReevaluating}
                    title="Swap IR Executive and Investor speakers across the entire transcript"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '4px 10px',
                      borderRadius: 6,
                      border: '1px solid #cbd5e1',
                      background: '#f8fafc',
                      color: '#334155',
                      fontSize: 12,
                      fontWeight: 500,
                      cursor: (loading || segments.length === 0 || isSavingTranscript || isReevaluating) ? 'not-allowed' : 'pointer',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    ⇄ Swap All Speakers (IR ⇋ Investor)
                  </button>
                )
              )}
            </div>

            {allowReevaluate && !hasReevaluated && isTranscriptModified && (
              <div style={{
                padding: '10px 14px',
                background: '#fefce8',
                border: '1px solid #fef08a',
                borderRadius: 8,
                marginBottom: 12,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 10,
                flexWrap: 'wrap'
              }}>
                <span style={{ fontSize: 12, color: '#854d0e', fontWeight: 500 }}>
                  ⚠️ Diarization / speakers modified. Click below to save and re-run quality scoring.
                </span>
                <button
                  onClick={handleSaveTranscriptAndReevaluate}
                  disabled={isSavingTranscript || isReevaluating}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 6,
                    border: 'none',
                    background: '#ca8a04',
                    color: '#fff',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: (isSavingTranscript || isReevaluating) ? 'not-allowed' : 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6
                  }}
                >
                  {isSavingTranscript ? 'Saving transcript…' : isReevaluating ? 'Re-evaluating…' : 'Save & Re-evaluate Call'}
                </button>
              </div>
            )}

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
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2, alignSelf: isIR ? 'flex-end' : 'flex-start' }}>
                        <span style={{ fontSize: 10, color: 'var(--qa-text-3)' }}>
                          {isIR ? '🟡 IR EXECUTIVE' : '🟢 INVESTOR'} · {seg.ts || seg.timestamp || ''}
                        </span>
                        {allowReevaluate && !hasReevaluated && (
                          <button
                            onClick={() => handleToggleSpeaker(idx)}
                            title={`Switch speaker to ${isIR ? 'INVESTOR' : 'IR EXECUTIVE'}`}
                            style={{
                              border: '1px solid #e2e8f0',
                              background: '#f8fafc',
                              color: '#64748b',
                              borderRadius: 4,
                              padding: '1px 5px',
                              fontSize: 10,
                              cursor: 'pointer',
                              lineHeight: 1
                            }}
                          >
                            ⇄ Switch
                          </button>
                        )}
                      </div>
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
          <div style={{
            flex: '0 0 440px',
            width: 440,
            minWidth: 320,
            background: '#fff',
            border: '1px solid var(--qa-border)',
            borderRadius: 10,
            padding: 16,
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
            maxHeight: '600px',
            overflowY: 'auto'
          }}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              position: 'sticky',
              top: -16,
              background: '#fff',
              zIndex: 2,
              paddingTop: 4,
              paddingBottom: 8,
              borderBottom: '1px solid var(--qa-border-sub, #f1f5f9)',
              marginBottom: -4
            }}>
              <h4 style={{ margin: 0, fontSize: 13, fontWeight: 600, textTransform: 'uppercase', color: 'var(--qa-text-2)' }}>Evaluation Parameters</h4>
              <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--qa-text)' }}>
                IQS Score: <span style={{ color: '#15803d' }}>{currentIqs != null && !isNaN(currentIqs) ? `${currentIqs}%` : (iqsScore != null && !isNaN(iqsScore) ? `${iqsScore}%` : '—')}</span>
              </span>
            </div>

            {/* Compliance Gates Card */}
            <div style={{
              background: '#f8fafc',
              border: `1px solid ${overallGateResult === 'FAIL' ? '#fecaca' : 'var(--qa-border)'}`,
              borderRadius: 8,
              padding: 12,
              marginBottom: 12
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <h5 style={{ margin: 0, fontSize: 12, fontWeight: 700, color: 'var(--qa-text-2)', textTransform: 'uppercase' }}>
                  Compliance Gates: <span style={{
                    color: overallGateResult === 'FAIL' ? '#b91c1c' : '#15803d',
                    background: overallGateResult === 'FAIL' ? '#fee2e2' : '#dcfce7',
                    padding: '2px 8px',
                    borderRadius: 4,
                    marginLeft: 4
                  }}>{overallGateResult}</span>
                </h5>
                {!isReadOnly && (
                  <span style={{ fontSize: 10, color: 'var(--qa-text-3)', fontWeight: 500 }}>
                    Fail on any gate marks call as Critical Fail
                  </span>
                )}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }}>
                {COMPLIANCE_GATES_LIST.map(g => {
                  const gItem = gateState[g.key] || { status: 'pass', reasoning: '' };
                  const scoreLabel = gItem.status === 'pass' ? 'Yes' : gItem.status === 'fail' ? 'No' : 'NA';

                  return (
                    <div key={g.key} style={{
                      padding: '8px 10px',
                      background: gItem.status === 'fail' ? '#fff1f2' : '#fff',
                      border: `1px solid ${gItem.status === 'fail' ? '#fecdd3' : 'var(--qa-border-sub, #f1f5f9)'}`,
                      borderRadius: 6
                    }}>
                      <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center'
                      }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: gItem.status === 'fail' ? '#991b1b' : 'var(--qa-text)' }}>
                          {g.label}
                        </span>
                          <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                            {([
                              { label: 'Yes', val: 'pass' as const },
                              { label: 'No', val: 'fail' as const },
                              { label: 'NA', val: 'not_applicable' as const },
                            ]).map(opt => {
                              const isSel = gItem.status === opt.val;
                              const bg = isSel
                                ? opt.val === 'pass'
                                  ? '#15803d'
                                  : opt.val === 'fail'
                                  ? '#b91c1c'
                                  : 'var(--qa-gray-700, #334155)'
                                : 'var(--qa-card, #fff)';
                              const borderColor = isSel
                                ? opt.val === 'pass'
                                  ? '#15803d'
                                  : opt.val === 'fail'
                                  ? '#b91c1c'
                                  : 'var(--qa-gray-700, #334155)'
                                : 'var(--qa-border, #e2e8f0)';
                              const color = isSel ? '#fff' : 'var(--qa-text-2, #64748b)';

                              return (
                                <button
                                  key={opt.val}
                                  onClick={() => !isReadOnly && handleGateStatusChange(g.key, opt.val)}
                                  disabled={isReadOnly}
                                  style={{
                                    height: 24,
                                    padding: '0 8px',
                                    borderRadius: 6,
                                    fontSize: 11,
                                    fontWeight: isSel ? 700 : 500,
                                    border: `1px solid ${borderColor}`,
                                    background: bg,
                                    color: color,
                                    cursor: isReadOnly ? 'default' : 'pointer',
                                    fontFamily: 'inherit',
                                    transition: 'all 0.15s ease'
                                  }}
                                >
                                  {opt.label}
                                </button>
                              );
                            })}
                          </div>
                      </div>

                      {/* Reason for compliance gate (shown only in case of breach) */}
                      {gItem.status === 'fail' && (
                        isReadOnly ? (
                          gItem.reasoning ? (
                            <div style={{
                              marginTop: 6,
                              padding: '5px 8px',
                              background: '#fee2e2',
                              borderLeft: '3px solid #ef4444',
                              borderRadius: 4,
                              fontSize: 11,
                              color: '#991b1b',
                              lineHeight: 1.4,
                              whiteSpace: 'pre-wrap'
                            }}>
                              <span style={{ fontWeight: 700 }}>Reason: </span>{gItem.reasoning}
                            </div>
                          ) : null
                        ) : (
                          <div style={{ marginTop: 6 }}>
                            <div style={{ fontSize: 10, fontWeight: 700, color: '#b91c1c', marginBottom: 2, textTransform: 'uppercase' }}>
                              Reason for Breach:
                            </div>
                            <textarea
                              value={gItem.reasoning}
                              onChange={e => handleGateReasoningChange(g.key, e.target.value)}
                              placeholder="Specify reason / citation for this compliance breach…"
                              rows={2}
                              style={{
                                width: '100%',
                                boxSizing: 'border-box',
                                resize: 'vertical',
                                border: '1px solid #fca5a5',
                                borderRadius: 4,
                                padding: '4px 8px',
                                fontSize: 11,
                                color: '#991b1b',
                                background: '#fff1f2',
                                lineHeight: 1.4
                              }}
                            />
                          </div>
                        )
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

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
                          {['Yes', 'Half', 'No', 'NA'].map(val => (
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
                              {val === 'Half' ? 'Partial' : val}
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
