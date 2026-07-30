'use client';
import React, { useState, useEffect } from 'react';
import {
  PARAM_ORDER, PARAM_NAMES, WEIGHTS, calculateIQS,
  BOT_PARAM_ORDER, BOT_PARAM_NAMES, BOT_WEIGHTS, ParamScore, normalizeScore,
  V3_PARAM_ORDER, V3_PARAM_NAMES, V3_WEIGHTS, isV4Evaluation, getDisputeClassification, formatParamLabel,
} from '@/lib/quality';
import { CallTranscriptCard } from '@/components/CallTranscriptCard';
import { PASCAL_TO_DB, resolveParamCell } from '@/lib/param-keys';
import { DisputeThread } from '@/components/quality/DisputeThread';

// ── Key maps ──────────────────────────────────────────────────────────────────

// DB score (true/false/null/0.5 or 1.0/0.0/0.5) → display string
function scoreToParamScore(s: any): ParamScore {
  return normalizeScore(s).label;
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface ParamState {
  score:     number | null;
  reasoning: string;
}

export interface EvalPanelProps {
  chatId:        string;
  agentName:     string;
  iqsScore:      number;
  closedAt:      string;
  disposition:   string;
  parameters:    Record<string, { score: any; reasoning: string }>;
  gates?:        any;
  mode:          'submit' | 'resolve' | 'view';
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
  reviewerRole?: string | null;
  reviewNote?:   string | null;
  allowRaiseDispute?: boolean;
  onDisputeRaised?:   () => void;
  onDone:        () => void;
  onClose:       () => void;
  colSpan:       number;
  conversationType?: 'bot' | 'agent' | 'hybrid';
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

function ScoreBadge({ score }: { score?: string | number | null | boolean }) {
  const norm = normalizeScore(score ?? null);
  return (
    <span style={{ padding: '2px 6px', borderRadius: 4, fontSize: 10, fontWeight: 700, background: norm.badgeBg, color: norm.badgeText }}>
      {norm.label}
    </span>
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

function renderContentWithLinks(text: string, isOutgoing?: boolean) {
  if (!text) return '';
  const urlRegex = /(https?:\/\/[^\s\]\)\>]+)/gi;
  const parts = text.split(urlRegex);
  if (parts.length === 1) return text;

  const linkClass = isOutgoing
    ? "underline text-white font-medium hover:opacity-90 break-all"
    : "underline text-blue-600 font-medium hover:text-blue-800 break-all";

  return parts.map((part, index) => {
    if (urlRegex.test(part)) {
      return (
        <a
          key={index}
          href={part}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: isOutgoing ? '#fff' : 'var(--qa-text-link, #2563eb)', textDecoration: 'underline' }}
          className={linkClass}
        >
          Link
        </a>
      );
    }
    return part;
  });
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function EvalPanel({
  chatId, agentName, closedAt, disposition,
  parameters, gates, mode, dispute, flagId,
  mobileNumber, reviewedBy, reviewedAt, reviewerRole, reviewNote,
  allowRaiseDispute, onDisputeRaised,
  onDone, onClose, colSpan, conversationType,
}: EvalPanelProps) {

  // Detect a bot chat by BOT-DISTINCTIVE parameters only. IssueResolution/Accuracy/
  // Personalization are shared between the v4 human and bot rubrics, so keying off
  // them forced every v4 human-only chat onto the bot tab. Look at __bot_parameters
  // when present, otherwise the top level only if there is no __agent_parameters.
  const BOT_ONLY_PARAM_KEYS = [
    'correct_escalation', 'no_repetition', 'clarity',
    'CorrectEscalation', 'NoRepetition', 'Clarity',
  ];
  const botParamsSrc: Record<string, any> = parameters?.__bot_parameters || {};
  const hasBotParams = Object.keys(botParamsSrc).some(k => BOT_ONLY_PARAM_KEYS.includes(k)) || !!parameters?.__bot_parameters || !!(parameters as any)?.__scores?.bot_iqs;
  const isBotChat = conversationType === 'bot';
  const isHybrid = conversationType === 'hybrid';
  const showTabs = isHybrid || hasBotParams || !!parameters?.__agent_parameters || (!!parameters && Object.keys(parameters).length > 0);

  const disputeTarget = getDisputeClassification(dispute?.challengedParams, conversationType);

  const [activeTab, setActiveTab] = useState<'agent' | 'bot'>(() => {
    if (dispute?.challengedParams && dispute.challengedParams.length > 0) {
      if (disputeTarget.type === 'bot') return 'bot';
      if (disputeTarget.type === 'agent') return 'agent';
    }
    return isBotChat ? 'bot' : 'agent';
  });

  const isV4 = isV4Evaluation(parameters);

  function initAgentParams(): Record<string, ParamState> {
    const safeParams = parameters?.__agent_parameters || parameters || {};
    const state: Record<string, ParamState> = {};
    const paramOrderToUse = isV4 ? PARAM_ORDER : V3_PARAM_ORDER;
    for (const pascal of paramOrderToUse) {
      const raw = isV4 ? resolveParamCell(safeParams, pascal) : ((safeParams as any)[PASCAL_TO_DB[pascal] || pascal] ?? (safeParams as any)[pascal] ?? {});
      state[pascal] = { score: normalizeScore(raw.score).value, reasoning: raw.comment ?? raw.reasoning ?? '' };
    }
    return state;
  }

  function initBotParams(): Record<string, ParamState> {
    const botRawParams = parameters?.__bot_parameters || {};
    const safeParams = Object.keys(botRawParams).length ? botRawParams : (parameters?.__agent_parameters || parameters || {});
    const state: Record<string, ParamState> = {};
    for (const pascal of BOT_PARAM_ORDER) {
      const dbKey = PASCAL_TO_DB[pascal] || pascal;
      const raw   = (safeParams as any)[dbKey] ?? (safeParams as any)[pascal] ?? {};
      state[pascal] = { score: normalizeScore(raw.score).value, reasoning: raw.comment ?? raw.reasoning ?? '' };
    }
    return state;
  }

  const [agentParamState, setAgentParamState] = useState<Record<string, ParamState>>(initAgentParams);
  const [botParamState, setBotParamState] = useState<Record<string, ParamState>>(initBotParams);

  const activeParamOrder = activeTab === 'bot' ? BOT_PARAM_ORDER : (isV4 ? PARAM_ORDER : V3_PARAM_ORDER);
  const activeParamNames = activeTab === 'bot' ? BOT_PARAM_NAMES : (isV4 ? PARAM_NAMES : V3_PARAM_NAMES);
  const activeWeights = activeTab === 'bot' ? BOT_WEIGHTS : (isV4 ? WEIGHTS : V3_WEIGHTS);
  const currentParamState = activeTab === 'bot' ? botParamState : agentParamState;

  function pctLabel(key: string): string {
    const w = activeWeights[key];
    return w != null ? `${Math.round(w * 100)}%` : '';
  }

  const isReadOnly = mode === 'view';

  const [transcript, setTranscript]  = useState<TMessage[] | null>(null);
  const [callRecordings, setCallRecordings] = useState<any[]>([]);
  const [txLoading,  setTxLoading]   = useState(true);
  const [submitting, setSubmitting]  = useState(false);
  const [submitErr,  setSubmitErr]   = useState('');
  const [noteText,   setNoteText]    = useState(reviewNote ?? '');

  const [history,        setHistory]        = useState<HistoryEntry[] | null>(null);
  const [historyOpen,    setHistoryOpen]    = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);

  const [needsKbUpdate, setNeedsKbUpdate] = useState(false);

  // Dispute creation state (for TL)
  const [disputing, setDisputing] = useState(false);
  const [disputePicks, setDisputePicks] = useState<Set<string>>(new Set());
  const [disputeReason, setDisputeReason] = useState('');
  const [disputeSubmitting, setDisputeSubmitting] = useState(false);
  const [disputeDone, setDisputeDone] = useState(false);
  const [disputeError, setDisputeError] = useState('');

  function toggleDisputePick(pascal: string) {
    setDisputePicks(prev => {
      const next = new Set(prev);
      if (next.has(pascal)) next.delete(pascal); else next.add(pascal);
      return next;
    });
  }

  async function submitTLDispute() {
    if (disputePicks.size === 0 || !disputeReason.trim() || disputeSubmitting) return;
    setDisputeSubmitting(true);
    setDisputeError('');
    try {
      const challengedParams = [...disputePicks].map(p => ({
        param: p,
        note: disputeReason.trim(),
      }));
      const res = await fetch('/api/quality/flag', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chatId,
          challengedParams,
          agentNote: disputeReason.trim(),
          raisedByRole: 'tl',
        }),
      });
      const d = await res.json();
      if (!res.ok || d.error) throw new Error(d.error ?? 'Failed to submit dispute');
      setDisputeDone(true);
      setDisputing(false);
      onDisputeRaised?.();
    } catch (err: any) {
      setDisputeError(err.message || 'Failed to submit dispute');
    } finally {
      setDisputeSubmitting(false);
    }
  }

  const disputeMap = new Map<string, { note: string }>(
    (dispute?.challengedParams ?? []).map(d => [d.param, { note: d.note }])
  );

  const liveIqs = (() => {
    const scores: Record<string, ParamScore> = {};
    for (const [key, s] of Object.entries(currentParamState)) {
      scores[key] = scoreToParamScore(s.score);
    }
    // currentParamState is keyed by the active generation's PARAM_ORDER (v4 or V3),
    // so pass isV4 to select the matching weight set. The bot tab uses BOT_WEIGHTS.
    return calculateIQS(scores, activeTab === 'bot', isV4);
  })();

  const gatesData = gates || (parameters as any)?.__gates || (parameters as any)?.gates;

  function resolveGateScore(gateItem: any, defaultVal: 'Yes' | 'No' | 'NA'): 'Yes' | 'No' | 'NA' {
    if (gateItem === undefined || gateItem === null) return defaultVal;
    if (typeof gateItem === 'object') {
      if (gateItem.status === 'pass') return 'Yes';
      if (gateItem.status === 'fail') return 'No';
      if (gateItem.status === 'not_applicable') return 'NA';
      if (gateItem.score !== undefined) return resolveGateScore(gateItem.score, defaultVal);
    }
    if (typeof gateItem === 'string') {
      const s = gateItem.toLowerCase();
      if (s === 'yes' || s === 'pass') return 'Yes';
      if (s === 'no' || s === 'fail') return 'No';
      if (s === 'na' || s === 'not_applicable') return 'NA';
    }
    if (typeof gateItem === 'boolean') {
      return gateItem ? 'Yes' : 'No';
    }
    return defaultVal;
  }

  const g1Badge = resolveGateScore(gatesData?.G1_no_advice || gatesData?.G1, 'Yes');
  const g2Badge = resolveGateScore(gatesData?.G2_no_fabrication || gatesData?.G2, 'No');
  const g3Badge = resolveGateScore(gatesData?.G3_identity_first || gatesData?.G3, 'NA');

  const overallGateResult =
    gatesData?.chat_gate_result ||
    gatesData?.call_gate_result ||
    gatesData?.gate_result ||
    (g1Badge === 'No' || g2Badge === 'Yes' ? 'FAIL' : 'PASS');

  const isModified = (() => {
    let mod = false;
    const checkAgent = conversationType !== 'bot' || parameters?.__agent_parameters || activeTab === 'agent';
    if (checkAgent) {
      const paramOrderToUse = isV4 ? PARAM_ORDER : V3_PARAM_ORDER;
      for (const pascal of paramOrderToUse) {
        const orig = initAgentParams()[pascal];
        if (orig) {
          const cur  = agentParamState[pascal];
          if (cur && (cur.score !== orig.score || (cur.reasoning ?? '').trim() !== (orig.reasoning ?? '').trim())) mod = true;
        }
      }
    }
    const checkBot = isHybrid || isBotChat || parameters?.__bot_parameters || activeTab === 'bot';
    if (checkBot) {
      for (const pascal of BOT_PARAM_ORDER) {
        const orig = initBotParams()[pascal];
        const cur  = botParamState[pascal];
        if (cur && (cur.score !== orig.score || (cur.reasoning ?? '').trim() !== (orig.reasoning ?? '').trim())) mod = true;
      }
    }
    return mod;
  })();

  const primaryLabel = mode === 'resolve' ? (isModified ? 'Override & Resolve' : 'Resolve') : (isModified ? 'Override' : 'Submit');

  // Fetch transcript on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/quality/transcript?chatId=${encodeURIComponent(chatId)}`);
        if (!res.ok) throw new Error('Failed');
        const data = await res.json();
        if (!cancelled) {
          setTranscript(Array.isArray(data) ? data : (data.timedMessages ?? data.messages ?? []));
          setCallRecordings(data.callRecordings || []);
        }
      } catch {
        if (!cancelled) {
          setTranscript([]);
          setCallRecordings([]);
        }
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
  function setScore(pascal: string, score: number | null) {
    if (activeTab === 'bot') setBotParamState(prev => ({ ...prev, [pascal]: { ...prev[pascal], score } }));
    else setAgentParamState(prev => ({ ...prev, [pascal]: { ...prev[pascal], score } }));
  }
  function setReasoning(pascal: string, reasoning: string) {
    if (activeTab === 'bot') setBotParamState(prev => ({ ...prev, [pascal]: { ...prev[pascal], reasoning } }));
    else setAgentParamState(prev => ({ ...prev, [pascal]: { ...prev[pascal], reasoning } }));
  }

  // Reset to original
  function reset() {
    setAgentParamState(initAgentParams());
    setBotParamState(initBotParams());
    setSubmitErr('');
  }

  // Submit evaluation
  async function submit() {
    let noteToUse = noteText.trim();
    if (mode === 'resolve' && !noteToUse) {
      const promptNote = prompt('Enter a resolution note explaining the decision for Agent & TL:');
      if (promptNote === null) return; // User cancelled prompt
      noteToUse = promptNote.trim();
      if (noteToUse) setNoteText(noteToUse);
    }

    setSubmitting(true);
    setSubmitErr('');
    try {
      const action = mode === 'resolve' ? 'resolve'
        : (isModified ? 'override' : 'submit');

      const body: any = { action, flagId };
      if (noteToUse) body.note = noteToUse;

      if (isModified) {
        const params: Record<string, { score: number | null; reasoning: string }> = {};
        
        const checkAgent = conversationType !== 'bot' || parameters?.__agent_parameters || activeTab === 'agent';
        if (checkAgent) {
          const paramOrderToUse = isV4 ? PARAM_ORDER : V3_PARAM_ORDER;
          for (const pascal of paramOrderToUse) {
            const dbKey = PASCAL_TO_DB[pascal] || pascal;
            if (agentParamState[pascal]) {
              params[dbKey] = { score: agentParamState[pascal].score, reasoning: agentParamState[pascal].reasoning };
            }
          }
        }
        
        const checkBot = isHybrid || isBotChat || parameters?.__bot_parameters || activeTab === 'bot';
        if (checkBot) {
          const botParams: Record<string, { score: number | null; reasoning: string }> = {};
          for (const pascal of BOT_PARAM_ORDER) {
            const dbKey = PASCAL_TO_DB[pascal] || pascal;
            botParams[dbKey] = { score: botParamState[pascal].score, reasoning: botParamState[pascal].reasoning };
          }
          if (isBotChat && !parameters?.__agent_parameters) {
            Object.assign(params, botParams);
          } else {
            params['__bot_parameters'] = botParams as any;
          }
        }
        
        if (needsKbUpdate) params['__needs_kb_update'] = { score: true, reasoning: '' } as any;
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
  function senderType(s: string): 'user' | 'bot' | 'agent' | 'system' | 'internal_note' {
    const sl = (s || '').toLowerCase();
    if (sl === 'private note' || sl === 'internal note') return 'internal_note';
    if (sl === 'system' || sl === 'activity') return 'system';
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
    display: 'flex', height: 520, width: '100%', maxWidth: '100%',
    border: '1px solid var(--qa-border)', borderRadius: 8,
    background: 'var(--qa-card)', overflow: 'hidden',
    margin: '16px auto', boxSizing: 'border-box',
  };
  const leftPanel: React.CSSProperties = {
    width: 440, minWidth: 320, maxWidth: '48%', flexShrink: 1,
    borderRight: '1px solid var(--qa-border)',
    display: 'flex', flexDirection: 'column', overflow: 'hidden',
  };
  const rightPanel: React.CSSProperties = {
    flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column',
    overflow: 'hidden',
  };

  return (
    <tr className="eval-panel-row">
      <td colSpan={colSpan} style={{ ...td, maxWidth: 0, overflow: 'hidden' }}>
        <div style={panelWrap}>

          {/* ── LEFT ── */}
          <div style={leftPanel}>
            {/* Head */}
            <div style={{ padding: 16, borderBottom: '1px solid var(--qa-border)', flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <ScoreRing score={liveIqs} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    {agentName}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--qa-text-3)', marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: '0 8px' }}>
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
                        <span style={{
                          fontSize: 10, fontWeight: 700,
                          background: disputeTarget.badgeBg, color: disputeTarget.badgeText,
                          border: `1px solid ${disputeTarget.badgeBorder}`,
                          borderRadius: 4, padding: '1px 6px', marginLeft: 4,
                          display: 'inline-block', verticalAlign: 'middle',
                        }}>
                          {disputeTarget.label}
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

            </div>



            {/* Param list */}
            {showTabs ? (
              <div style={{ display: 'flex', padding: '16px 16px 0', borderBottom: '1px solid var(--qa-border)', gap: 16 }}>
                <button
                  onClick={() => setActiveTab('agent')}
                  style={{
                    fontSize: 12, fontWeight: 600, paddingBottom: 8,
                    color: activeTab === 'agent' ? 'var(--qa-text)' : 'var(--qa-text-3)',
                    borderTop: 'none', borderLeft: 'none', borderRight: 'none',
                    borderBottom: activeTab === 'agent' ? '2px solid var(--qa-primary)' : '2px solid transparent',
                    background: 'none', cursor: 'pointer'
                  }}
                >
                  Agent Parameters
                </button>
                <button
                  onClick={() => setActiveTab('bot')}
                  style={{
                    fontSize: 12, fontWeight: 600, paddingBottom: 8,
                    color: activeTab === 'bot' ? 'var(--qa-text)' : 'var(--qa-text-3)',
                    borderTop: 'none', borderLeft: 'none', borderRight: 'none',
                    borderBottom: activeTab === 'bot' ? '2px solid var(--qa-primary)' : '2px solid transparent',
                    background: 'none', cursor: 'pointer'
                  }}
                >
                  Bot Parameters
                </button>
              </div>
            ) : (
              <div style={{
                fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em',
                color: 'var(--qa-text-3)', padding: '16px 16px 4px',
              }}>
                Parameter Scores
              </div>
            )}
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {/* Compliance Gates — scrolls away with the params to free space for them */}
              <div style={{
                margin: '12px 16px', background: '#f8fafc', border: '1px solid var(--qa-border)',
                borderRadius: 8, padding: '10px 12px',
                display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 12, fontSize: 12,
              }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--qa-text-2)', textTransform: 'uppercase' }}>
                  Compliance Gates: <span style={{ color: overallGateResult === 'FAIL' ? '#b91c1c' : '#15803d' }}>{overallGateResult}</span>
                </span>
                <span>G1 Advice: <ScoreBadge score={g1Badge} /></span>
                <span>G2 Fabrication: <ScoreBadge score={g2Badge} /></span>
                <span>G3 Identity: <ScoreBadge score={g3Badge} /></span>
              </div>
              {activeParamOrder.map(pascal => {
                const st       = currentParamState[pascal];
                const pickKey  = `${activeTab}:${pascal}`;
                const disputed = (dispute?.challengedParams ?? []).find(c =>
                  c.param === pickKey || (activeTab === 'agent' && c.param === pascal) || c.param.toLowerCase() === pickKey.toLowerCase()
                );
                const paramReadOnly = isReadOnly;
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
                      {disputing && (
                        <input
                          type="checkbox"
                          checked={disputePicks.has(pascal)}
                          onChange={() => toggleDisputePick(pascal)}
                          style={{ cursor: 'pointer', width: 15, height: 15, accentColor: 'var(--qa-gray-700)' }}
                        />
                      )}
                      <span style={{ fontSize: 13, fontWeight: 500, flex: 1, minWidth: 0 }}>
                        {activeParamNames[pascal]}
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
                      {/* Yes / Half / No / NA buttons */}
                      <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                        {([1.0, 0.5, 0.0, null] as const).map((val, i) => {
                          const label = val === 1.0 ? 'Yes' : val === 0.5 ? 'Half' : val === 0.0 ? 'No' : 'NA';
                          const isSel = st.score === val;
                          return (
                            <button key={i} onClick={() => !paramReadOnly && setScore(pascal, val)} style={{
                              height: 28, padding: '0 9px', borderRadius: 8,
                              border: '1px solid var(--qa-border)',
                              background: isSel ? 'var(--qa-gray-700)' : 'var(--qa-card)',
                              color: isSel ? '#fff' : 'var(--qa-text-2)',
                              fontSize: 12, fontFamily: 'inherit',
                              cursor: paramReadOnly ? 'default' : 'pointer',
                              opacity: paramReadOnly && !isSel ? 0.4 : 1,
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
                    {(st.reasoning || !paramReadOnly) && (
                      <textarea
                        value={st.reasoning}
                        onChange={e => !paramReadOnly && setReasoning(pascal, e.target.value)}
                        readOnly={paramReadOnly}
                        placeholder={paramReadOnly ? '' : 'Add reasoning…'}
                        rows={st.reasoning ? undefined : 1}
                        style={{
                          marginTop: 8, width: '100%', resize: paramReadOnly ? 'none' : 'vertical',
                          border: '1px solid transparent', borderRadius: 6,
                          padding: '6px 8px', fontSize: 12, color: 'var(--qa-text-2)',
                          lineHeight: 1.5, fontFamily: 'inherit',
                          background: 'transparent', outline: 'none',
                          transition: 'background 0.12s, border-color 0.12s',
                          cursor: paramReadOnly ? 'default' : 'text',
                        }}
                        onFocus={e => {
                          if (!paramReadOnly) {
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

            {/* Dispute composer for TL */}
            {disputing && (
              <div style={{ padding: '12px 16px', borderTop: '1px solid var(--qa-border)', background: 'var(--qa-gray-50)', flexShrink: 0 }}>
                <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--qa-text-3)', marginBottom: 6 }}>
                  Reason for Dispute (QA Review)
                </div>
                <textarea
                  value={disputeReason}
                  onChange={e => setDisputeReason(e.target.value)}
                  placeholder="Explain why you disagree with the score on selected parameters…"
                  rows={3}
                  style={{
                    width: '100%', resize: 'vertical',
                    border: '1px solid var(--qa-border)', borderRadius: 6,
                    padding: '6px 8px', fontSize: 12, color: 'var(--qa-text)',
                    lineHeight: 1.5, fontFamily: 'inherit',
                    background: 'var(--qa-card)', outline: 'none',
                  }}
                />
                {disputeError && (
                  <div style={{ fontSize: 12, color: '#b91c1c', marginTop: 6 }}>{disputeError}</div>
                )}
                <div style={{ display: 'flex', gap: 8, marginTop: 10, justifyContent: 'flex-end', alignItems: 'center' }}>
                  <span style={{ fontSize: 11, color: 'var(--qa-text-3)', marginRight: 'auto' }}>
                    {disputePicks.size} parameter{disputePicks.size === 1 ? '' : 's'} selected
                  </span>
                  <button
                    onClick={() => { setDisputing(false); setDisputePicks(new Set()); setDisputeReason(''); setDisputeError(''); }}
                    style={{
                      height: 30, padding: '0 12px', borderRadius: 6, border: '1px solid var(--qa-border)',
                      background: 'var(--qa-card)', color: 'var(--qa-text)', fontSize: 12, cursor: 'pointer',
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={submitTLDispute}
                    disabled={disputePicks.size === 0 || !disputeReason.trim() || disputeSubmitting}
                    style={{
                      height: 30, padding: '0 14px', borderRadius: 6, border: 'none',
                      background: 'var(--qa-gray-700)', color: '#fff', fontSize: 12, fontWeight: 500,
                      cursor: disputePicks.size === 0 || !disputeReason.trim() || disputeSubmitting ? 'not-allowed' : 'pointer',
                      opacity: disputePicks.size === 0 || !disputeReason.trim() || disputeSubmitting ? 0.6 : 1,
                    }}
                  >
                    {disputeSubmitting ? 'Sending to QA…' : 'Submit Dispute to QA'}
                  </button>
                </div>
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
              <div style={{ margin: '0 16px', padding: '8px 12px', background: 'var(--qa-fill-light)', border: '1px solid var(--qa-border)', borderRadius: 6, fontSize: 12, color: 'var(--qa-text)' }}>
                {submitErr}
              </div>
            )}
          </div>

          {/* ── RIGHT ── */}
          <div style={rightPanel}>
            {/* Right header */}
            <div style={{
              padding: '0 12px', borderBottom: '1px solid var(--qa-border)',
              display: 'flex', alignItems: 'center', gap: 6, height: 52, flexShrink: 0,
              minWidth: 0, overflow: 'hidden',
            }}>
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
              {/* Disputed params — truncates so it never pushes the action buttons off */}
              <div style={{
                flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8,
                overflow: 'hidden', whiteSpace: 'nowrap',
              }}>
                {dispute && dispute.challengedParams.length > 0 && (
                  <>
                    <span style={{
                      height: 18, padding: '0 7px', borderRadius: 999, flexShrink: 0,
                      background: 'var(--qa-gray-700)', color: '#fff',
                      fontSize: 10, fontWeight: 600, textTransform: 'uppercase',
                      letterSpacing: '0.04em', display: 'inline-flex', alignItems: 'center',
                    }}>
                      {dispute.raisedBy} disputed
                    </span>
                    <span
                      title={dispute.challengedParams.map(d => formatParamLabel(d.param) || d.param).join(' · ')}
                      style={{ fontSize: 12, fontWeight: 600, color: 'var(--qa-text)', overflow: 'hidden', textOverflow: 'ellipsis' }}
                    >
                      {dispute.challengedParams.map(d => formatParamLabel(d.param) || d.param).join(' · ')}
                    </span>

                  </>
                )}
              </div>
              {/* Raise dispute button for TL */}
              {allowRaiseDispute && mode === 'view' && (
                disputeDone ? (
                  <span style={{ fontSize: 12, color: '#16a34a', fontWeight: 600, padding: '0 8px' }}>
                    ✓ Dispute Sent to QA
                  </span>
                ) : !disputing ? (
                  <button
                    onClick={() => setDisputing(true)}
                    style={{
                      height: 32, padding: '0 12px', borderRadius: 8,
                      fontFamily: 'inherit', fontSize: 12, fontWeight: 500,
                      border: '1px solid var(--qa-border)', background: 'var(--qa-card)',
                      color: 'var(--qa-text)', cursor: 'pointer',
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>
                    </svg>
                    Raise Dispute to QA
                  </button>
                ) : null
              )}
              {/* Primary action (submit/resolve modes) */}
              {(mode === 'submit' || mode === 'resolve') && (
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  {isModified && (
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--qa-text-2)', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={needsKbUpdate}
                        onChange={e => setNeedsKbUpdate(e.target.checked)}
                        style={{ cursor: 'pointer' }}
                      />
                      Mark KB Update
                    </label>
                  )}
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
                </div>
              )}
              {/* Close */}
              <button onClick={onClose} style={{
                width: 28, height: 28, border: '1px solid var(--qa-border)', borderRadius: 8,
                background: 'var(--qa-card)', color: 'var(--qa-text-2)', cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 16, lineHeight: 1,
              }}>×</button>
            </div>

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
                        {['Date', 'Chat ID', 'Agent', 'Disposition', 'IQS', 'CSAT'].map(h => (
                          <th key={h} style={{ padding: '6px 12px', textAlign: 'left', color: 'var(--qa-text-3)', fontWeight: 500, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {history.map((h, i) => (
                        <tr key={i} style={{ borderTop: '1px solid var(--qa-border-sub)' }}>
                          <td style={{ padding: '6px 12px', color: 'var(--qa-text-2)', whiteSpace: 'nowrap' }}>{h.date}</td>
                          <td style={{ padding: '6px 12px', fontFamily: 'ui-monospace, monospace' }}>
                            {h.chatId && /^\d+$/.test(h.chatId.trim()) ? (
                              <a
                                href={`https://app.robylon.ai/unified-inbox/share/${h.chatId}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{ color: 'var(--qa-text-2)', textDecoration: 'none' }}
                                onMouseEnter={e => (e.currentTarget.style.textDecoration = 'underline')}
                                onMouseLeave={e => (e.currentTarget.style.textDecoration = 'none')}
                              >
                                {h.chatId}
                              </a>
                            ) : (
                              h.chatId
                            )}
                          </td>
                          <td style={{ padding: '6px 12px', color: 'var(--qa-text)' }}>{h.agentName}</td>
                          <td style={{ padding: '6px 12px', color: 'var(--qa-text-2)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.disposition}</td>
                          <td style={{ padding: '6px 12px' }}>
                            {h.iqs != null ? (
                              <span style={{
                                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                minWidth: 30, height: 18, borderRadius: 4, fontSize: 11,
                                fontFamily: 'ui-monospace, monospace',
                                background: 'var(--qa-fill-light)', color: 'var(--qa-text-2)',
                                border: '1px solid var(--qa-border)',
                              }}>{h.iqs}</span>
                            ) : <span style={{ color: 'var(--qa-text-3)' }}>—</span>}
                          </td>
                          <td style={{ padding: '6px 12px' }}>
                            {h.csat ? (
                              <span style={{
                                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                minWidth: 36, height: 18, borderRadius: 4, fontSize: 11, fontWeight: 600,
                                background: 'var(--qa-fill-light)', color: 'var(--qa-text-2)',
                                border: '1px solid var(--qa-border)',
                              }}>
                                {h.csat === '1' ? 'Bad' : h.csat === '3' ? 'Neutral' : 'Good'}
                              </span>
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
            <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '16px 14px', display: 'flex', flexDirection: 'column', gap: 0, minWidth: 0 }}>
              {txLoading ? (
                <div style={{ color: 'var(--qa-text-3)', fontSize: 13, textAlign: 'center', marginTop: 40 }}>
                  Loading transcript…
                </div>
              ) : (!transcript?.length && !callRecordings?.length) ? (
                <div style={{ color: 'var(--qa-text-3)', fontSize: 13, textAlign: 'center', marginTop: 40 }}>
                  No transcript available
                </div>
              ) : (
                (() => {
                  // Merge messages and calls chronologically
                  const items = [
                    ...(transcript || []).map(m => ({
                      type: 'message' as const,
                      timestamp: m.timestamp,
                      time: m.timestamp ? new Date(m.timestamp).getTime() : 0,
                      data: m,
                    })),
                    ...(callRecordings || []).map(c => ({
                      type: 'call' as const,
                      timestamp: c.calledAt,
                      time: c.calledAt ? new Date(c.calledAt).getTime() : 0,
                      data: c,
                    })),
                  ];

                  // Sort by time ascending
                  items.sort((a, b) => a.time - b.time);

                  return items.map((item, idx) => {
                    if (item.type === 'call') {
                      const rec = item.data;
                      return (
                        <div key={`call-${rec.id}`} className="my-4 shrink-0 text-left" style={{ width: '100%' }}>
                          <CallTranscriptCard
                            rec={{
                              id: rec.id,
                              label: `Call #${rec.id} (${rec.language || 'English'})`,
                              calledAt: rec.calledAt,
                              durationSeconds: rec.durationSeconds,
                              recordingUrl: rec.recordingUrl,
                              segments: rec.segments || [],
                              interruptionCount: rec.interruptionCount || 0,
                              deadAirCount: rec.deadAirCount || 0,
                            }}
                            index={idx}
                          />
                        </div>
                      );
                    }

                    const msg = item.data;
                    const type = senderType(msg.sender_type ?? msg.sender);
                    
                    // Determine gap based on previous item
                    let gap = 16;
                    if (idx > 0) {
                      const prevItem = items[idx - 1];
                      if (prevItem.type === 'message') {
                        const prevType = senderType(prevItem.data.sender_type ?? prevItem.data.sender);
                        gap = prevType === type ? 8 : 16;
                      }
                    }

                    if (type === 'system') {
                      const systemTime = msg.timestamp
                        ? '  •  ' + new Date(msg.timestamp).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
                        : '';
                      return (
                        <div key={idx} style={{ marginTop: gap + 'px', textAlign: 'center' }}>
                          <div style={{
                            background: 'var(--qa-gray-50)', border: '1px solid var(--qa-border-sub)',
                            borderRadius: 8, fontSize: 12, fontStyle: 'italic',
                            color: 'var(--qa-text-2)', padding: '8px 14px', display: 'inline-block',
                            maxWidth: '90%', lineHeight: 1.5,
                            wordBreak: 'break-word', overflowWrap: 'anywhere',
                          }}>
                            {msg.content}{systemTime}
                          </div>
                        </div>
                      );
                    }

                    if (type === 'internal_note') {
                      const noteTime = msg.timestamp
                        ? '  •  ' + new Date(msg.timestamp).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
                        : '';
                      return (
                        <div key={idx} style={{
                          marginTop: gap + 'px',
                          display: 'flex',
                          justifyContent: 'flex-end',
                          width: '100%',
                          alignSelf: 'flex-end',
                        }}>
                          <div style={{
                            background: '#fffbeb', border: '1px dashed #f59e0b',
                            borderRadius: 8, fontSize: 12,
                            color: '#78350f', padding: '10px 14px', display: 'inline-block',
                            maxWidth: '76%', lineHeight: 1.5,
                            wordBreak: 'break-word', overflowWrap: 'anywhere',
                            boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                          }}>
                            <div style={{ fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#b45309', marginBottom: 4 }}>
                              Internal Note (Robylon AI){noteTime}
                            </div>
                            <div style={{ fontStyle: 'italic' }}>
                              {msg.content}
                            </div>
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
                        maxWidth: '76%', minWidth: 0,
                        alignSelf: isRight ? 'flex-end' : 'flex-start',
                        alignItems: isRight ? 'flex-end' : 'flex-start',
                        wordBreak: 'break-word', overflowWrap: 'anywhere',
                      }}>
                        <span style={{ fontSize: 11, color: 'var(--qa-text-3)', marginBottom: 4 }}>{label}</span>
                        <div style={{
                          padding: '10px 14px', borderRadius: 8, fontSize: 13, lineHeight: 1.5,
                          wordBreak: 'break-word', overflowWrap: 'anywhere',
                          ...(type === 'agent' ? { background: 'var(--qa-gray-700)', color: '#fff' }
                            : type === 'bot'   ? { background: 'var(--qa-gray-100)', color: 'var(--qa-text)' }
                            : { background: 'var(--qa-card)', border: '1px solid var(--qa-border)', color: 'var(--qa-text)' }),
                        }}>
                          {renderContentWithLinks(msg.content, type === 'agent')}
                        </div>
                      </div>
                    );
                  });
                })()
              )}
            </div>
          </div>
        </div>
      </td>
    </tr>
  );
}
