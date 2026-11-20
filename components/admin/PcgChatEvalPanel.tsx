'use client';

import React, { useState, useMemo, useEffect } from 'react';
import ScoreRing from '@/components/quality/ScoreRing';
import AutoTextarea from '@/components/quality/AutoTextarea';
import { normalizeScore } from '@/lib/quality';
import { PcgProductCategory, detectPcgChatCategories } from '@/lib/pcg/chat-category';
import { isPcgAm } from '@/lib/pcg/canonical-names';
import { resolveParameterAttribution } from '@/lib/pcg/attribution';

export interface PcgChatEvaluation {
  id: string;
  customerPhone: string;
  wabaNumber: string;
  customerName: string;
  rmName: string;
  tlName: string;
  isAm?: boolean;
  precedingRmName?: string | null;
  iqsScore: number | null;
  processScore: number | null;
  communicationScore: number | null;
  customerServiceScore: number | null;
  applicableWeight: number;
  verdict: string;
  isEvaluable?: boolean;
  exclusionReason?: string | null;
  categories?: string[];
  parameters: Record<string, {
    id: string;
    num: number;
    name: string;
    weight: number;
    group: string;
    status: 'Yes' | 'Half' | 'No' | 'NA';
    earnedScore: number;
    maxScore: number;
    quote?: string;
    reasoning: string;
    cannotTellFlag?: boolean;
    failedBy?: 'rm' | 'am' | 'both' | null;
    rmStatus?: 'Yes' | 'Half' | 'No' | 'NA';
    amStatus?: 'Yes' | 'Half' | 'No' | 'NA';
    rmReasoning?: string;
    amReasoning?: string;
    rmQuote?: string;
    amQuote?: string;
  }>;
  complianceFlags: Array<{
    id: string;
    num: number;
    name: string;
    status: 'PASS' | 'FAIL' | 'NA';
    quote?: string;
    reasoning: string;
    failedBy?: 'rm' | 'am' | 'both' | null;
    rmStatus?: 'PASS' | 'FAIL' | 'NA';
    amStatus?: 'PASS' | 'FAIL' | 'NA';
    rmReasoning?: string;
    amReasoning?: string;
    rmQuote?: string;
    amQuote?: string;
  }>;
  complianceTripwire: boolean;
  complianceReason?: string | null;
  aiCoachingTip?: string | null;
  summary?: string | null;
  conversationId?: string | null;
  linkedSessions?: Array<{
    id: string;
    conversationId?: string | null;
    sessionNumber: number;
    chatClosedAt: string;
    totalMessages: number;
    iqsScore: number | null;
    summary?: string | null;
    verdict?: string;
  }>;
  totalMessages: number;
  firstResponseTimeSeconds?: number | null;
  transcriptTurns: Array<{
    message_id?: string | null;
    speaker: 'Customer' | 'RM' | 'AM' | string;
    direction?: 'inbound' | 'outbound';
    text: string | null;
    timestamp: string;
    status?: string | null;
    type?: string;
    agent_name?: string;
    role?: 'rm' | 'am' | string;
    is_handoff?: boolean;
    handoff_note?: string;
  }>;
  chatClosedAt: string;
  scoredAt: string;
  disputeStatus: 'none' | 'pending' | 'resolved' | 'overridden';
  disputeReason?: string;
  disputeComments?: Array<{
    id: string;
    authorName: string;
    authorRole: string;
    content: string;
    createdAt: string;
  }>;
  tlOverrideNote?: string;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
}

interface Props {
  chat: PcgChatEvaluation | null;
  onClose: () => void;
  onDisputeUpdate?: (opts?: { close?: boolean }) => void;
  onSelectChat?: (chatId: string) => void;
  userRole?: string;
  allowRaiseDispute?: boolean;
  colSpan?: number;
  standalone?: boolean;
}

export const PCG_CHAT_PARAM_GROUPS = [
  {
    group: 'Group 1: Process Skills',
    weight: '50%',
    keys: ['QueryResolution', 'Accuracy', 'ExpectationFollowThrough', 'Personalisation', 'EscalationToCall', 'PostCallRecap']
  },
  {
    group: 'Group 2: Customer Service Skills',
    weight: '20%',
    keys: ['DissatisfactionHandling', 'Empathy', 'SimplifyingConcepts']
  },
  {
    group: 'Group 3: Communication Skills',
    weight: '30%',
    keys: ['ReadabilityTone', 'GreetingClosing']
  }
];

export const PCG_CHAT_PARAM_META: Record<string, {
  num: number;
  name: string;
  weight: number;
  group: 'Process Skills' | 'Customer Service Skills' | 'Communication Skills';
  scoreType: 'Yes / Half / No' | 'Yes / No';
}> = {
  QueryResolution: { num: 1, name: 'Query Resolution', weight: 20, group: 'Process Skills', scoreType: 'Yes / Half / No' },
  Accuracy: { num: 2, name: 'Accuracy (Technically / Legally Correct)', weight: 20, group: 'Process Skills', scoreType: 'Yes / Half / No' },
  ExpectationFollowThrough: { num: 3, name: 'Expectation & Follow-Through', weight: 15, group: 'Process Skills', scoreType: 'Yes / Half / No' },
  Personalisation: { num: 4, name: 'Personalisation & Relationship Context', weight: 15, group: 'Process Skills', scoreType: 'Yes / Half / No' },
  DissatisfactionHandling: { num: 5, name: 'Dissatisfaction Handling', weight: 8, group: 'Customer Service Skills', scoreType: 'Yes / Half / No' },
  Empathy: { num: 6, name: 'Empathy', weight: 5, group: 'Customer Service Skills', scoreType: 'Yes / Half / No' },
  SimplifyingConcepts: { num: 7, name: 'Simplifying Concepts', weight: 5, group: 'Customer Service Skills', scoreType: 'Yes / Half / No' },
  EscalationToCall: { num: 8, name: 'Escalation to Call', weight: 4, group: 'Process Skills', scoreType: 'Yes / No' },
  PostCallRecap: { num: 9, name: 'Post-Call Recap', weight: 4, group: 'Process Skills', scoreType: 'Yes / No' },
  ReadabilityTone: { num: 10, name: 'Readability & Professional Tone', weight: 2, group: 'Communication Skills', scoreType: 'Yes / No' },
  GreetingClosing: { num: 11, name: 'Greeting & Closing', weight: 2, group: 'Communication Skills', scoreType: 'Yes / No' },
};

function ScoreBadge({ score }: { score?: string | number | null }) {
  const norm = normalizeScore(score ?? null);
  const isHalf = norm.label === 'Half';
  return (
    <span
      style={{
        padding: '2px 7px',
        borderRadius: 4,
        fontSize: 10,
        fontWeight: 700,
        background: isHalf ? '#f4f4f5' : norm.badgeBg,
        color: isHalf ? '#52525b' : norm.badgeText,
        border: isHalf ? '1px solid #e4e4e7' : 'none',
        letterSpacing: '0.02em',
      }}
    >
      {norm.label}
    </span>
  );
}

export default function PcgChatEvalPanel({
  chat: initialChat,
  onClose,
  onDisputeUpdate,
  onSelectChat,
  userRole,
  allowRaiseDispute,
  colSpan = 8,
  standalone = false,
}: Props) {
  const [chat, setChat] = useState<PcgChatEvaluation | null>(initialChat);
  const [isLoadingSession, setIsLoadingSession] = useState(false);

  useEffect(() => {
    setChat(initialChat);
  }, [initialChat]);

  const handleSwitchSession = async (session: { id: string }) => {
    if (!chat || session.id === chat.id) return;
    if (onSelectChat) {
      onSelectChat(session.id);
    }
    setIsLoadingSession(true);
    try {
      const res = await fetch(`/api/admin/pcg-chats?id=${session.id}`);
      if (res.ok) {
        const data = await res.json();
        if (data?.chat) {
          setChat(data.chat);
        }
      }
    } catch (e) {
      console.error('Failed to switch chat session:', e);
    } finally {
      setIsLoadingSession(false);
    }
  };

  // Only Team Leads can submit evaluation override; Admins and Agents view evaluations in read-only mode
  const canSubmitOverride = userRole === 'tl';
  const [isEditing, setIsEditing] = useState(false);
  const isReadOnly = !canSubmitOverride || !isEditing;
  const canRaiseDispute = allowRaiseDispute ?? (userRole === 'agent');

  // Co-handled Chat State & Role Visibility
  const [agentViewTab, setAgentViewTab] = useState<'overall' | 'rm' | 'am'>('overall');
  const [expandedReasons, setExpandedReasons] = useState<Record<string, boolean>>({});

  const toggleReason = (paramId: string) => {
    setExpandedReasons(prev => ({ ...prev, [paramId]: !prev[paramId] }));
  };

  const isCoHandled = Boolean(chat?.precedingRmName && (chat?.isAm || isPcgAm(chat?.rmName) || isPcgAm(chat?.precedingRmName)));
  const rmAgentName = (chat?.isAm || isPcgAm(chat?.rmName)) ? (chat?.precedingRmName || 'RM') : (chat?.rmName || 'RM');
  const amAgentName = (chat?.isAm || isPcgAm(chat?.rmName)) ? (chat?.rmName || 'AM') : (chat?.precedingRmName || 'AM');

  const effectiveRole = (userRole || '').toLowerCase();
  const isRmUser = effectiveRole === 'rm' || (effectiveRole === 'agent' && !isPcgAm(chat?.rmName));
  const isAmUser = effectiveRole === 'am' || (effectiveRole === 'agent' && isPcgAm(chat?.rmName));
  const isAdminOrTl = !isRmUser && !isAmUser;

  const showRmTab = isAdminOrTl || isRmUser;
  const showAmTab = isAdminOrTl || isAmUser;

  const rmMistakes = useMemo(() => {
    if (!isCoHandled || !chat?.parameters) return [];
    return Object.values(chat.parameters).filter(p => {
      const normStatus = (p.status || '').trim().toLowerCase();
      const isParamFailed = normStatus === 'no' || normStatus === 'half' || normStatus === 'partial';
      if (!isParamFailed) return false;

      const attr = resolveParameterAttribution(p, chat.transcriptTurns, rmAgentName, amAgentName);
      return attr === 'rm' || attr === 'both';
    });
  }, [isCoHandled, chat?.parameters, chat?.transcriptTurns, rmAgentName, amAgentName]);

  const amMistakes = useMemo(() => {
    if (!isCoHandled || !chat?.parameters) return [];
    return Object.values(chat.parameters).filter(p => {
      const normStatus = (p.status || '').trim().toLowerCase();
      const isParamFailed = normStatus === 'no' || normStatus === 'half' || normStatus === 'partial';
      if (!isParamFailed) return false;

      const attr = resolveParameterAttribution(p, chat.transcriptTurns, rmAgentName, amAgentName);
      return attr === 'am' || attr === 'both';
    });
  }, [isCoHandled, chat?.parameters, chat?.transcriptTurns, rmAgentName, amAgentName]);

  const totalChatMistakes = useMemo(() => {
    if (!chat?.parameters) return 0;
    return Object.values(chat.parameters).filter(p => {
      const s = (p.status || '').trim().toLowerCase();
      return s === 'no' || s === 'half' || s === 'partial';
    }).length;
  }, [chat?.parameters]);

  // Rich dispute state matching CallEvalPanel
  const [raisingDispute, setRaisingDispute] = useState(false);
  const [disputeSelectedParams, setDisputeSelectedParams] = useState<Record<string, boolean>>({});
  const [disputeParamNotes, setDisputeParamNotes] = useState<Record<string, string>>({});
  const [agentDisputeNote, setAgentDisputeNote] = useState('');
  const [isSubmittingDispute, setIsSubmittingDispute] = useState(false);

  // Dispute Comments & Activity state for TLs / Reviewers
  const [comments, setComments] = useState<Array<{
    id: string;
    authorName: string;
    authorRole: string;
    content: string;
    createdAt: string;
  }>>(Array.isArray(chat?.disputeComments) ? chat.disputeComments : []);
  const [tlCommentText, setTlCommentText] = useState('');
  const [isPostingComment, setIsPostingComment] = useState(false);

  // Local state for interactive parameter and gate overrides
  const [params, setParams] = useState<Record<string, any>>(chat?.parameters || {});
  const [complianceFlags, setComplianceFlags] = useState<Array<any>>(chat?.complianceFlags || []);

  const rmComplianceBreaches = useMemo(() => {
    if (!isCoHandled) return [];
    // In dual chats, compliance gate errors are attributed to BOTH RM and AM
    return complianceFlags.filter((f) => f.status === 'FAIL');
  }, [isCoHandled, complianceFlags]);

  const amComplianceBreaches = useMemo(() => {
    if (!isCoHandled) return [];
    // In dual chats, compliance gate errors are attributed to BOTH RM and AM
    return complianceFlags.filter((f) => f.status === 'FAIL');
  }, [isCoHandled, complianceFlags]);
  const [overrideNote, setOverrideNote] = useState<string>(chat?.tlOverrideNote || '');
  const [isSubmittingOverride, setIsSubmittingOverride] = useState(false);
  const [overrideSuccess, setOverrideSuccess] = useState(false);

  useEffect(() => {
    if (chat) {
      setParams(chat.parameters || {});
      setComplianceFlags(chat.complianceFlags || []);
      setOverrideNote(chat.tlOverrideNote || '');
      setOverrideSuccess(false);
      setRaisingDispute(false);
      setDisputeSelectedParams({});
      setDisputeParamNotes({});
      setAgentDisputeNote('');
      setComments(Array.isArray(chat.disputeComments) ? chat.disputeComments : []);
      setTlCommentText('');
    }
  }, [chat]);

  // Parse structured dispute data if available
  const parsedDispute = useMemo(() => {
    if (!chat?.disputeReason) return null;
    const raw = chat.disputeReason.trim();
    if (raw.startsWith('{') || raw.startsWith('[')) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          return {
            challengedParams: Array.isArray(parsed.challengedParams) ? parsed.challengedParams : [],
            agentNote: parsed.agentNote || '',
            summary: parsed.summary || raw,
            submittedAt: parsed.submittedAt || null,
          };
        }
      } catch { }
    }
    return {
      challengedParams: [],
      agentNote: raw,
      summary: raw,
      submittedAt: null,
    };
  }, [chat?.disputeReason]);

  const detectedCategories = useMemo(() => {
    if (Array.isArray(chat?.categories) && chat.categories.length > 0) {
      return chat.categories as PcgProductCategory[];
    }
    return detectPcgChatCategories(chat);
  }, [chat]);

  // Real-time recalculation of scores
  const {
    currentIqs,
    currentProcess,
    currentComm,
    currentCs,
    currentTripwire,
    currentVerdict,
    currentApplicableWeight,
  } = useMemo(() => {
    let totalEarned = 0;
    let totalApplicable = 0;
    let processEarned = 0;
    let processApplicable = 0;
    let commEarned = 0;
    let commApplicable = 0;
    let csEarned = 0;
    let csApplicable = 0;

    for (const [id, meta] of Object.entries(PCG_CHAT_PARAM_META)) {
      const p = params[id];
      const status = p?.status || 'NA';
      let earned = 0;
      if (status === 'Yes') earned = meta.weight;
      else if (status === 'Half') earned = meta.weight * 0.5;
      else earned = 0;

      if (status !== 'NA') {
        totalEarned += earned;
        totalApplicable += meta.weight;

        if (meta.group === 'Process Skills') {
          processEarned += earned;
          processApplicable += meta.weight;
        } else if (meta.group === 'Communication Skills') {
          commEarned += earned;
          commApplicable += meta.weight;
        } else if (meta.group === 'Customer Service Skills') {
          csEarned += earned;
          csApplicable += meta.weight;
        }
      }
    }

    const tripwire = complianceFlags.some((f) => f.status === 'FAIL');

    const iqs = totalApplicable > 0 ? Math.round((totalEarned / totalApplicable) * 100) : null;
    const process = processApplicable > 0 ? Math.round((processEarned / processApplicable) * 100) : null;
    const comm = commApplicable > 0 ? Math.round((commEarned / commApplicable) * 100) : null;
    const cs = csApplicable > 0 ? Math.round((csEarned / csApplicable) * 100) : null;

    let verdict: string = 'NOT_SCOREABLE';
    if (totalApplicable === 0) verdict = 'NOT_SCOREABLE';
    else if (tripwire) verdict = 'FAILED_CRITICAL';
    else if (iqs !== null) {
      if (iqs >= 85) verdict = 'excellent';
      else if (iqs >= 70) verdict = 'meets_expectations';
      else if (iqs >= 50) verdict = 'coaching';
      else verdict = 'remediation';
    }

    return {
      currentIqs: iqs,
      currentProcess: process,
      currentComm: comm,
      currentCs: cs,
      currentTripwire: tripwire,
      currentVerdict: verdict,
      currentApplicableWeight: totalApplicable,
    };
  }, [params, complianceFlags]);

  if (!chat) return null;

  const turns = Array.isArray(chat.transcriptTurns) ? chat.transcriptTurns : [];

  // Find the single index where the first handover from RM to AM occurs
  const firstHandoffIndex = useMemo(() => {
    // 1. If any turn has explicit is_handoff === true, take the first one
    const explicitIdx = turns.findIndex((t) => t.is_handoff);
    if (explicitIdx !== -1) return explicitIdx;

    // 2. Check if this conversation had a preceding RM or prior RM turns
    const hasPriorRm = Boolean(chat.precedingRmName) || turns.some((t) => {
      const isCust = t.speaker === 'Customer' || t.direction === 'inbound';
      return !isCust && (t.speaker === 'RM' || t.role === 'rm' || (t.agent_name && !isPcgAm(t.agent_name)));
    });

    if (!hasPriorRm) return -1;

    // 3. Find the first outbound AM turn
    return turns.findIndex((t, i) => {
      const isCust = t.speaker === 'Customer' || t.direction === 'inbound';
      if (isCust) return false;
      return t.speaker === 'AM' || t.role === 'am' || (t.agent_name && isPcgAm(t.agent_name)) || (chat.isAm && i > 0);
    });
  }, [turns, chat.precedingRmName, chat.isAm]);

  const handleDisputeSubmit = async () => {
    const challenged = Object.keys(disputeSelectedParams)
      .filter((k) => disputeSelectedParams[k])
      .map((k) => ({
        paramKey: k,
        paramName: PCG_CHAT_PARAM_META[k]?.name || k,
        paramNum: PCG_CHAT_PARAM_META[k]?.num || 0,
        note: disputeParamNotes[k]?.trim() || '',
      }));

    if (challenged.length === 0 && !agentDisputeNote.trim()) {
      alert('Please select at least one parameter to challenge or provide an explanation note.');
      return;
    }

    setIsSubmittingDispute(true);
    try {
      const paramsPrefix = challenged.length > 0
        ? `Parameters challenged: ${challenged.map((p) => `${p.paramNum}. ${p.paramName}${p.note ? ` (${p.note})` : ''}`).join(', ')}. `
        : '';
      const summaryText = (paramsPrefix + agentDisputeNote.trim()).trim();

      const res = await fetch('/api/admin/pcg-chats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'submit_dispute',
          chatId: chat.id,
          challengedParams: challenged,
          agentNote: agentDisputeNote.trim(),
          disputeReason: summaryText,
        }),
      });
      if (res.ok) {
        setRaisingDispute(false);
        setDisputeSelectedParams({});
        setDisputeParamNotes({});
        setAgentDisputeNote('');
        if (onDisputeUpdate) onDisputeUpdate({ close: true });
      } else {
        const d = await res.json().catch(() => ({}));
        alert(d.error || 'Failed to submit dispute');
      }
    } catch (e: any) {
      console.error('Failed to submit dispute:', e);
      alert(`Error submitting dispute: ${e?.message || e}`);
    } finally {
      setIsSubmittingDispute(false);
    }
  };

  const handlePostComment = async () => {
    if (!tlCommentText.trim() || isPostingComment) return;
    setIsPostingComment(true);
    try {
      const authorName = userRole === 'agent'
        ? (chat.rmName || 'RM')
        : userRole === 'tl'
          ? (chat.tlName || 'Team Lead')
          : 'Admin';

      const res = await fetch('/api/admin/pcg-chats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'add_dispute_comment',
          chatId: chat.id,
          content: tlCommentText.trim(),
          authorName,
          authorRole: userRole,
        }),
      });
      const data = await res.json();
      if (res.ok && data.comment) {
        setComments((prev) => [...prev, data.comment]);
        setTlCommentText('');
        if (onDisputeUpdate) onDisputeUpdate({ close: false });
      } else {
        alert(data.error || 'Failed to post comment');
      }
    } catch (e: any) {
      console.error('Failed to post dispute comment:', e);
      alert(`Error posting comment: ${e?.message || e}`);
    } finally {
      setIsPostingComment(false);
    }
  };

  const handleParamScoreChange = (paramId: string, newStatus: 'Yes' | 'Half' | 'No' | 'NA') => {
    setParams((prev) => {
      const existing = prev[paramId] || {};
      const meta = PCG_CHAT_PARAM_META[paramId];
      const weight = meta?.weight ?? existing.weight ?? 0;
      let earned = 0;
      if (newStatus === 'Yes') earned = weight;
      else if (newStatus === 'Half') earned = weight * 0.5;

      return {
        ...prev,
        [paramId]: {
          ...existing,
          id: paramId,
          num: meta?.num ?? existing.num,
          name: meta?.name ?? existing.name,
          weight,
          group: meta?.group ?? existing.group,
          status: newStatus,
          earnedScore: earned,
          maxScore: weight,
        },
      };
    });
  };

  const handleGateChange = (gateId: string, newStatus: 'PASS' | 'FAIL' | 'NA') => {
    setComplianceFlags((prev) =>
      prev.map((g) => {
        if (g.id !== gateId) return g;
        const updated = { ...g, status: newStatus };
        if (newStatus === 'FAIL' && isCoHandled && !updated.failedBy) {
          updated.failedBy = 'both';
        }
        return updated;
      })
    );
  };

  const handleParamReasoningChange = (paramId: string, newReasoning: string) => {
    setParams((prev) => {
      const existing = prev[paramId] || {};
      return {
        ...prev,
        [paramId]: {
          ...existing,
          reasoning: newReasoning,
        },
      };
    });
  };

  const handleSubmitOverride = async () => {
    setIsSubmittingOverride(true);
    setOverrideSuccess(false);

    try {
      const updatedParameters: Record<string, any> = {};
      for (const [id, meta] of Object.entries(PCG_CHAT_PARAM_META)) {
        const cur = params[id] || {};
        const status = cur.status || 'NA';
        let earned = 0;
        if (status === 'Yes') earned = meta.weight;
        else if (status === 'Half') earned = meta.weight * 0.5;
        else earned = 0;

        updatedParameters[id] = {
          ...cur,
          id,
          num: meta.num,
          name: meta.name,
          weight: meta.weight,
          group: meta.group,
          status,
          earnedScore: earned,
          maxScore: meta.weight,
        };
      }

      const res = await fetch('/api/admin/pcg-chats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'override_evaluation',
          chatId: chat.id,
          parameters: updatedParameters,
          complianceFlags,
          complianceTripwire: currentTripwire,
          iqsScore: currentIqs,
          processScore: currentProcess,
          communicationScore: currentComm,
          customerServiceScore: currentCs,
          applicableWeight: currentApplicableWeight,
          verdict: currentVerdict,
          tlOverrideNote: overrideNote,
          disputeResolution: chat.disputeStatus === 'pending' ? 'resolved' : 'none',
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to submit override');
      }

      setOverrideSuccess(true);
      setIsEditing(false);
      if (onDisputeUpdate) {
        onDisputeUpdate({ close: true });
      }
    } catch (err: any) {
      console.error('[PcgChatEvalPanel] Failed to save evaluation override:', err);
      alert(err.message || 'Failed to save evaluation override');
    } finally {
      setIsSubmittingOverride(false);
    }
  };

  const formattedDate = chat.chatClosedAt
    ? new Date(chat.chatClosedAt).toLocaleString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    })
    : '';

  const chatDateLabel = useMemo(() => {
    const raw = chat.chatClosedAt || chat.transcriptTurns?.[0]?.timestamp;
    if (!raw) return '';
    const d = new Date(raw);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  }, [chat.chatClosedAt, chat.transcriptTurns]);

  const panelWrap: React.CSSProperties = {
    width: '100%',
    maxWidth: '100%',
    border: '1px solid var(--qa-border)',
    borderRadius: 8,
    background: 'var(--qa-card)',
    margin: '16px auto',
    boxSizing: 'border-box',
  };

  const hasDisputeBanner = Boolean(chat.disputeStatus && chat.disputeStatus !== 'none');
  const hasBanners = Boolean(hasDisputeBanner || raisingDispute);

  const panelContent = (
    <div style={{ padding: '0 16px' }}>
      {/* ── TOP BANNER: Linked Sessions / Customer Journey ── */}
      {chat.linkedSessions && chat.linkedSessions.length > 0 && (
        <div style={{ paddingTop: 16 }}>
          <div
            style={{
              padding: '14px 18px',
              background: '#ffffff',
              border: '1px solid var(--qa-border)',
              borderRadius: 8,
              boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--qa-text-2)' }}>
                  Customer Chat Journey
                </span>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    padding: '2px 8px',
                    borderRadius: 12,
                    background: 'var(--qa-fill-light)',
                    color: 'var(--qa-text-2)',
                    border: '1px solid var(--qa-border)',
                  }}
                >
                  {chat.linkedSessions.length} {chat.linkedSessions.length === 1 ? 'Session' : 'Sessions'}
                </span>
              </div>
              {isLoadingSession && (
                <span style={{ fontSize: 11, color: 'var(--qa-text-3)', fontStyle: 'italic' }}>
                  Loading session…
                </span>
              )}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {chat.linkedSessions.map((s) => {
                const isActive = s.id === chat.id;
                const closedDateStr = s.chatClosedAt
                  ? new Date(s.chatClosedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
                  : '';

                return (
                  <div
                    key={s.id}
                    onClick={() => handleSwitchSession(s)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '8px 12px',
                      borderRadius: 6,
                      background: isActive ? '#f0fdf4' : 'var(--qa-gray-50)',
                      border: `1px solid ${isActive ? '#86efac' : 'var(--qa-border)'}`,
                      cursor: isActive ? 'default' : 'pointer',
                      transition: 'background 0.15s, border-color 0.15s',
                    }}
                    title={isActive ? 'Currently viewing this session' : 'Click to inspect this chat session'}
                  >
                    {/* Badge */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                      <span
                        style={{
                          fontSize: 11.5,
                          fontWeight: 700,
                          padding: '3px 9px',
                          borderRadius: 5,
                          background: isActive ? '#15803d' : 'var(--qa-card)',
                          color: isActive ? '#ffffff' : 'var(--qa-text)',
                          border: `1px solid ${isActive ? '#15803d' : 'var(--qa-border)'}`,
                          letterSpacing: '0.02em',
                        }}
                      >
                        Chat #{s.sessionNumber}
                      </span>

                      {isActive && (
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            textTransform: 'uppercase',
                            padding: '2px 6px',
                            borderRadius: 4,
                            background: '#dcfce7',
                            color: '#166534',
                            border: '1px solid #bbf7d0',
                          }}
                        >
                          Viewing
                        </span>
                      )}
                    </div>

                    {/* Details & Summary */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--qa-text-3)', marginBottom: 2 }}>
                        {closedDateStr && <span>{closedDateStr}</span>}
                        <span>·</span>
                        <span>{s.totalMessages} msgs</span>
                        {s.iqsScore !== null && (
                          <>
                            <span>·</span>
                            <span style={{ fontWeight: 600, color: s.iqsScore >= 85 ? '#15803d' : s.iqsScore >= 70 ? '#b45309' : '#dc2626' }}>
                              IQS {s.iqsScore}%
                            </span>
                          </>
                        )}
                      </div>
                      <div style={{ fontSize: 12, color: isActive ? '#14532d' : 'var(--qa-text)', lineHeight: 1.45 }}>
                        {s.summary || <span style={{ fontStyle: 'italic', color: 'var(--qa-text-3)' }}>No summary recorded for this session.</span>}
                      </div>
                    </div>

                    {/* CTA if not active */}
                    {!isActive && (
                      <button
                        type="button"
                        style={{
                          flexShrink: 0,
                          padding: '4px 10px',
                          fontSize: 11,
                          fontWeight: 600,
                          borderRadius: 5,
                          background: 'var(--qa-card)',
                          border: '1px solid var(--qa-border)',
                          color: 'var(--qa-text)',
                          cursor: 'pointer',
                        }}
                      >
                        View Chat →
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {hasBanners && (
        <div style={{ padding: '16px 0 0 0' }}>
          {/* Disputed Params banner */}
          {parsedDispute?.challengedParams && parsedDispute.challengedParams.length > 0 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
              <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--qa-text-2)' }}>
                Disputed Params:
              </span>
              {parsedDispute.challengedParams.map((cp: any, idx: number) => {
                const meta = PCG_CHAT_PARAM_META[cp.paramKey] || PCG_CHAT_PARAM_META[cp.param];
                const displayName = meta ? `${meta.num}. ${meta.name}` : (cp.paramName || cp.paramKey || cp.param);
                return (
                  <span
                    key={idx}
                    title={cp.note ? `Reason: ${cp.note}` : undefined}
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      letterSpacing: '0.02em',
                      background: 'var(--qa-fill-light)',
                      border: '1px solid var(--qa-border)',
                      borderRadius: 4,
                      padding: '2px 8px',
                      color: 'var(--qa-text-2)',
                      cursor: cp.note ? 'help' : 'default',
                    }}
                  >
                    {displayName}{cp.note ? `: ${cp.note}` : ''}
                  </span>
                );
              })}
            </div>
          )}

          {/* Dispute Card & Status */}
          {hasDisputeBanner && (
            <div
              style={{
                padding: '16px 18px',
                background: '#ffffff',
                border: '1px solid var(--qa-border)',
                borderRadius: 8,
                marginBottom: 16,
                boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--qa-text)' }}>
                  Dispute raised by RM {chat.rmName}
                </span>
                {chat.disputeStatus === 'pending' && (
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: '#52525b',
                      background: '#f4f4f5',
                      padding: '2px 8px',
                      borderRadius: 4,
                      border: '1px solid #e4e4e7',
                    }}
                  >
                    Assigned to TL {chat.tlName}
                  </span>
                )}
                {chat.disputeStatus === 'resolved' && (
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: '#047857',
                      background: '#d1fae5',
                      padding: '2px 8px',
                      borderRadius: 4,
                      border: '1px solid #a7f3d0',
                    }}
                  >
                    Resolved by TL {chat.reviewedBy || chat.tlName}
                  </span>
                )}
              </div>

              {parsedDispute?.agentNote && (
                <div style={{ fontSize: 12, color: 'var(--qa-text)', lineHeight: 1.5, marginTop: 4, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  <strong>RM Explanation Note: </strong>{parsedDispute.agentNote}
                </div>
              )}

              {(!parsedDispute?.agentNote && parsedDispute?.summary) && (
                <div style={{ fontSize: 12, color: 'var(--qa-text)', lineHeight: 1.5, marginTop: 4, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  <strong>RM Dispute Details: </strong>{parsedDispute.summary}
                </div>
              )}

              {chat.tlOverrideNote && (
                <div style={{ fontSize: 12, color: '#166534', lineHeight: 1.5, borderTop: '1px solid var(--qa-border)', paddingTop: 8, marginTop: 8 }}>
                  <strong>Team Lead previously reviewed and saved an evaluation override for this chat</strong>
                  {chat.reviewedAt && (
                    <span style={{ fontWeight: 600, color: '#15803d', marginLeft: 6 }}>
                      on {new Date(chat.reviewedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </span>
                  )}
                  {chat.reviewedBy && (
                    <span style={{ fontSize: 11, color: '#15803d', marginLeft: 6 }}>
                      ({chat.reviewedBy})
                    </span>
                  )}
                  {/* If the TL wrote a custom note beyond the automated "Evaluation overridden by..." text */}
                  {chat.tlOverrideNote && !chat.tlOverrideNote.toLowerCase().startsWith('evaluation overridden by') && (
                    <div style={{ marginTop: 4, color: '#14532d' }}>
                      <strong>TL Note: </strong>{chat.tlOverrideNote}
                    </div>
                  )}
                </div>
              )}

              {/* ── Dispute Comments & Discussion Thread ── */}
              <div
                style={{
                  marginTop: 14,
                  paddingTop: 12,
                  borderTop: '1px solid var(--qa-border)',
                }}
              >
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    color: 'var(--qa-text-2)',
                    marginBottom: 10,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    Dispute Comments & Discussion
                  </span>
                  <span style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--qa-text-3)' }}>
                    {comments.length} comment{comments.length === 1 ? '' : 's'}
                  </span>
                </div>

                {/* List of comments */}
                {comments.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
                    {comments.map((c) => {
                      const isTl = c.authorRole === 'tl' || c.authorRole === 'team lead';
                      const isAgent = c.authorRole === 'agent' || c.authorRole === 'rm';
                      const timeStr = c.createdAt
                        ? new Date(c.createdAt).toLocaleString('en-IN', {
                          day: 'numeric',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        })
                        : '';

                      return (
                        <div
                          key={c.id}
                          style={{
                            background: isAgent ? '#f0fdf4' : '#f8fafc',
                            border: `1px solid ${isAgent ? '#dcfce7' : 'var(--qa-border)'}`,
                            borderRadius: 6,
                            padding: '8px 12px',
                            boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--qa-text)' }}>
                              {c.authorName}
                            </span>
                            <span
                              style={{
                                fontSize: 9.5,
                                fontWeight: 700,
                                textTransform: 'uppercase',
                                padding: '1px 5px',
                                borderRadius: 3,
                                background: isTl ? '#eff6ff' : isAgent ? '#ecfdf5' : '#f4f4f5',
                                color: isTl ? '#1d4ed8' : isAgent ? '#047857' : '#52525b',
                                border: `1px solid ${isTl ? '#bfdbfe' : isAgent ? '#a7f3d0' : '#e4e4e7'}`,
                              }}
                            >
                              {isTl ? 'Team Lead' : isAgent ? 'RM' : 'Admin'}
                            </span>
                            {timeStr && (
                              <span style={{ fontSize: 10.5, color: 'var(--qa-text-3)', marginLeft: 'auto' }}>
                                {timeStr}
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--qa-text)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                            {c.content}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Empty State when no comments */}
                {comments.length === 0 && (
                  <div style={{ fontSize: 11.5, color: 'var(--qa-text-3)', fontStyle: 'italic', marginBottom: 10 }}>
                    No comments posted yet. Add a comment below to communicate about this dispute.
                  </div>
                )}

                {/* Comment Input for all roles (Agent, TL, Admin) */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <AutoTextarea
                    placeholder={
                      userRole === 'agent'
                        ? 'Add a follow-up comment or clarification for your Team Lead… (Cmd+Enter to post)'
                        : userRole === 'tl'
                          ? 'Add a Team Lead comment or dispute justification note… (Cmd+Enter to post)'
                          : 'Add a comment or dispute note… (Cmd+Enter to post)'
                    }
                    value={tlCommentText}
                    onChange={(e) => setTlCommentText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                        e.preventDefault();
                        handlePostComment();
                      }
                    }}
                    style={{
                      width: '100%',
                      minHeight: 52,
                      padding: '8px 10px',
                      fontSize: 12,
                      border: '1px solid var(--qa-border)',
                      borderRadius: 6,
                      background: '#ffffff',
                      color: 'var(--qa-text)',
                      fontFamily: 'inherit',
                      boxSizing: 'border-box',
                    }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 10.5, color: 'var(--qa-text-3)' }}>
                      Visible to RM ({chat.rmName}) and Team Lead ({chat.tlName})
                    </span>
                    <button
                      type="button"
                      disabled={isPostingComment || !tlCommentText.trim()}
                      onClick={handlePostComment}
                      style={{
                        padding: '5px 14px',
                        fontSize: 11.5,
                        fontWeight: 600,
                        background: 'var(--qa-text)',
                        color: 'var(--ink-fg)',
                        border: 0,
                        borderRadius: 5,
                        cursor: isPostingComment || !tlCommentText.trim() ? 'not-allowed' : 'pointer',
                        opacity: isPostingComment || !tlCommentText.trim() ? 0.5 : 1,
                      }}
                    >
                      {isPostingComment ? 'Posting…' : 'Post Comment'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Inline Raise Dispute Form matching CallEvalPanel */}
          {raisingDispute && (
            <div
              style={{
                padding: 16,
                background: 'var(--sunk)',
                border: '1px solid var(--line-strong)',
                borderRadius: 8,
                marginBottom: 16,
              }}
            >
              <h4 style={{ margin: '0 0 8px 0', fontSize: 14, fontWeight: 600, color: 'var(--qa-text)' }}>
                Raise Dispute on Chat #{chat.id} to Team Lead ({chat.tlName})
              </h4>
              <p style={{ fontSize: 12, color: 'var(--qa-text-2)', marginBottom: 12 }}>
                Select parameters to challenge and add brief justification:
              </p>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                  gap: 8,
                  marginBottom: 12,
                }}
              >
                {Object.entries(PCG_CHAT_PARAM_META).map(([pKey, meta]) => {
                  const isChecked = Boolean(disputeSelectedParams[pKey]);
                  const curParam = params[pKey] || chat.parameters?.[pKey];
                  const curScore = curParam?.status;

                  return (
                    <div
                      key={pKey}
                      style={{
                        padding: 8,
                        background: 'var(--qa-card)',
                        border: `1px solid ${isChecked ? 'var(--marker)' : 'var(--qa-border)'}`,
                        borderRadius: 6,
                        boxShadow: isChecked ? '0 0 0 1px var(--marker)' : 'none',
                        transition: 'border-color 0.15s, box-shadow 0.15s',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                        <label
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                            fontSize: 12,
                            fontWeight: 600,
                            cursor: 'pointer',
                            flex: 1,
                            minWidth: 0,
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={(e) =>
                              setDisputeSelectedParams((prev) => ({
                                ...prev,
                                [pKey]: e.target.checked,
                              }))
                            }
                            style={{ cursor: 'pointer' }}
                          />
                          <span
                            style={{
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              color: 'var(--qa-text)',
                            }}
                            title={`${meta.num}. ${meta.name}`}
                          >
                            {meta.num}. {meta.name}
                          </span>
                        </label>
                        <span style={{ fontSize: 10.5, color: 'var(--qa-text-3)', fontWeight: 500, flexShrink: 0 }}>
                          ({meta.weight}%)
                        </span>
                        {curScore && (
                          <span style={{ flexShrink: 0 }}>
                            <ScoreBadge score={curScore} />
                          </span>
                        )}
                      </div>

                      {isChecked && (
                        <input
                          type="text"
                          placeholder="Reason for challenge…"
                          value={disputeParamNotes[pKey] || ''}
                          onChange={(e) =>
                            setDisputeParamNotes((prev) => ({
                              ...prev,
                              [pKey]: e.target.value,
                            }))
                          }
                          style={{
                            width: '100%',
                            marginTop: 6,
                            padding: '5px 8px',
                            fontSize: 11.5,
                            border: '1px solid var(--qa-border)',
                            borderRadius: 4,
                            background: 'var(--qa-card)',
                            color: 'var(--qa-text)',
                            boxSizing: 'border-box',
                            fontFamily: 'inherit',
                            outline: 'none',
                          }}
                        />
                      )}
                    </div>
                  );
                })}
              </div>

              <AutoTextarea
                placeholder="Overall explanation note…"
                value={agentDisputeNote}
                onChange={(e) => setAgentDisputeNote(e.target.value)}
                style={{
                  width: '100%',
                  minHeight: 48,
                  padding: '8px 10px',
                  fontSize: 12,
                  border: '1px solid var(--qa-border)',
                  borderRadius: 6,
                  marginBottom: 10,
                  background: 'var(--qa-card)',
                  color: 'var(--qa-text)',
                  fontFamily: 'inherit',
                  boxSizing: 'border-box',
                }}
              />

              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  disabled={isSubmittingDispute}
                  onClick={handleDisputeSubmit}
                  style={{
                    padding: '6px 14px',
                    fontSize: 12,
                    fontWeight: 600,
                    background: 'var(--qa-text)',
                    color: 'var(--ink-fg)',
                    border: 0,
                    borderRadius: 6,
                    cursor: isSubmittingDispute ? 'not-allowed' : 'pointer',
                    opacity: isSubmittingDispute ? 0.6 : 1,
                  }}
                >
                  {isSubmittingDispute ? 'Submitting…' : 'Submit Dispute'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setRaisingDispute(false);
                    setDisputeSelectedParams({});
                    setDisputeParamNotes({});
                    setAgentDisputeNote('');
                  }}
                  style={{
                    padding: '6px 14px',
                    fontSize: 12,
                    background: 'var(--qa-card)',
                    border: '1px solid var(--qa-border)',
                    borderRadius: 6,
                    cursor: 'pointer',
                    color: 'var(--qa-text)',
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="eval-wrap" style={panelWrap}>

        {/* ── LEFT PANE: WhatsApp Transcript ── */}
        <div className="eval-pane">
          <div
            style={{
              height: 52,
              padding: '0 14px',
              borderBottom: '1px solid var(--qa-border)',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              flexShrink: 0,
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--qa-text)' }}>
              Transcript
            </span>
            <span
              style={{
                fontSize: 11,
                color: 'var(--qa-text-3)',
                background: 'var(--qa-fill-light)',
                padding: '2px 8px',
                borderRadius: 4,
                fontWeight: 500,
              }}
            >
              {turns.length} messages
            </span>

            {detectedCategories.length > 0 && (
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: 'var(--qa-text-2)',
                }}
              >
                · {detectedCategories.join(', ')}
              </span>
            )}

            {chatDateLabel && (
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: 'var(--qa-text-2)',
                }}
              >
                · {chatDateLabel}
              </span>
            )}

            <div style={{ flex: 1 }} />

            {/* Dispute Button / Status in Transcript Header */}
            {canRaiseDispute && chat.disputeStatus === 'none' && !raisingDispute && (
              <button
                type="button"
                onClick={() => setRaisingDispute(true)}
                style={{
                  padding: '5px 12px',
                  fontSize: 12,
                  fontWeight: 600,
                  borderRadius: 6,
                  border: '1px solid var(--line-strong)',
                  background: 'var(--qa-card)',
                  color: 'var(--qa-text)',
                  cursor: 'pointer',
                }}
              >
                Raise Dispute
              </button>
            )}
            {chat.disputeStatus === 'pending' && (
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: '#52525b',
                  background: '#f4f4f5',
                  padding: '3px 8px',
                  borderRadius: 4,
                  border: '1px solid #e4e4e7',
                }}
              >
                Dispute Pending TL Review
              </span>
            )}
            {chat.disputeStatus === 'resolved' && (
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: '#047857',
                  background: '#d1fae5',
                  padding: '3px 8px',
                  borderRadius: 4,
                  border: '1px solid #a7f3d0',
                }}
              >
                Dispute Resolved
              </span>
            )}
          </div>

          {/* Scrollable Dialogue Turns */}
          <div className="eval-scroll-t" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 16 }}>
            {turns.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 0', fontSize: 12, color: 'var(--qa-text-3)' }}>
                No messages captured in this conversation thread.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {turns.map((turn, idx) => {
                  const isCustomer = turn.speaker === 'Customer' || turn.direction === 'inbound';
                  const isOutbound = !isCustomer;

                  // Determine sender role (RM vs AM) and specific agent name
                  let isAmTurn = false;
                  let senderRole: 'RM' | 'AM' = 'RM';
                  let senderName = chat.rmName;

                  if (isOutbound) {
                    if (turn.speaker === 'AM' || turn.role === 'am' || (turn.agent_name && isPcgAm(turn.agent_name))) {
                      isAmTurn = true;
                      senderRole = 'AM';
                      senderName = turn.agent_name || chat.rmName;
                    } else if (turn.agent_name) {
                      isAmTurn = isPcgAm(turn.agent_name);
                      senderRole = isAmTurn ? 'AM' : 'RM';
                      senderName = turn.agent_name;
                    } else if (chat.isAm || isPcgAm(chat.rmName)) {
                      isAmTurn = true;
                      senderRole = 'AM';
                      senderName = chat.rmName;
                    } else {
                      isAmTurn = false;
                      senderRole = 'RM';
                      senderName = chat.rmName;
                    }
                  }

                  const turnDate = turn.timestamp ? new Date(turn.timestamp) : null;
                  const isValidDate = Boolean(turnDate && !isNaN(turnDate.getTime()));
                  const timeStr = isValidDate
                    ? turnDate!.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                    : '';
                  const fullTimestamp = isValidDate
                    ? turnDate!.toLocaleString('en-IN', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                      hour12: true,
                    })
                    : '';

                  // Show date separator if this is the first turn or if the day changed from previous turn
                  const prevTurn = idx > 0 ? turns[idx - 1] : null;
                  const prevDate = prevTurn?.timestamp ? new Date(prevTurn.timestamp) : null;
                  const prevDateValid = Boolean(prevDate && !isNaN(prevDate.getTime()));

                  const currentDateKey = isValidDate
                    ? turnDate!.toDateString()
                    : idx === 0 && chatDateLabel
                      ? chatDateLabel
                      : null;
                  const prevDateKey = prevDateValid ? prevDate!.toDateString() : null;
                  const showDateDivider = Boolean(currentDateKey && currentDateKey !== prevDateKey);
                  const dateDividerLabel = isValidDate
                    ? turnDate!.toLocaleDateString('en-IN', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    })
                    : chatDateLabel;

                  // Detect mid-chat handoff point (shown only once at the first handover from RM)
                  const isHandoffPoint = idx === firstHandoffIndex;

                  return (
                    <React.Fragment key={turn.message_id || idx}>
                      {showDateDivider && (
                        <div style={{ display: 'flex', justifyContent: 'center', margin: '4px 0 2px' }}>
                          <span
                            style={{
                              fontSize: 10.5,
                              fontWeight: 600,
                              color: 'var(--qa-text-3)',
                              background: 'var(--qa-fill-light)',
                              padding: '2px 10px',
                              borderRadius: 10,
                              border: '1px solid var(--qa-border)',
                              boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
                            }}
                          >
                            {dateDividerLabel}
                          </span>
                        </div>
                      )}

                      {/* Handoff Divider Banner */}
                      {isHandoffPoint && (
                        <div style={{ display: 'flex', justifyContent: 'center', margin: '8px 0 6px' }}>
                          <div
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 8,
                              padding: '5px 12px',
                              borderRadius: 8,
                              background: '#f4f4f5',
                              border: '1px solid #e4e4e7',
                              color: '#3f3f46',
                              fontSize: 11,
                              fontWeight: 600,
                            }}
                          >
                            <span style={{ fontSize: 13, color: '#71717a' }}>⇄</span>
                            <span>
                              {turn.handoff_note || `Conversation handed off to AM (${senderName})`}
                            </span>
                            <span
                              style={{
                                fontSize: 9.5,
                                fontWeight: 700,
                                padding: '1px 6px',
                                borderRadius: 10,
                                background: '#71717a',
                                color: '#ffffff',
                                letterSpacing: '0.03em',
                              }}
                            >
                              AM HANDOFF
                            </span>
                          </div>
                        </div>
                      )}

                      <div
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: isOutbound ? 'flex-end' : 'flex-start',
                        }}
                      >
                        <div
                          style={{
                            maxWidth: '82%',
                            borderRadius: 12,
                            padding: '8px 12px',
                            fontSize: 12,
                            lineHeight: 1.45,
                            background: isOutbound ? '#059669' : 'var(--qa-card)',
                            color: isOutbound ? '#ffffff' : 'var(--qa-text)',
                            border: isOutbound ? 'none' : '1px solid var(--qa-border)',
                            boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
                            borderTopRightRadius: isOutbound ? 2 : 12,
                            borderTopLeftRadius: !isOutbound ? 2 : 12,
                          }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              gap: 12,
                              marginBottom: 3,
                              fontSize: 10.5,
                              fontWeight: 600,
                              opacity: isOutbound ? 0.92 : 0.6,
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              {isOutbound && (
                                <span
                                  style={{
                                    fontSize: 9,
                                    fontWeight: 700,
                                    padding: '1px 5px',
                                    borderRadius: 3,
                                    background: 'rgba(255, 255, 255, 0.22)',
                                    border: '1px solid rgba(255, 255, 255, 0.4)',
                                    letterSpacing: '0.04em',
                                  }}
                                >
                                  {senderRole}
                                </span>
                              )}
                              <span>{isOutbound ? senderName : (chat.customerName || 'Customer')}</span>
                            </div>
                            <span title={fullTimestamp || timeStr}>{timeStr}</span>
                          </div>
                          <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                            {turn.text || <span style={{ fontStyle: 'italic', opacity: 0.7 }}>(Media / Attachment)</span>}
                          </div>
                          {isOutbound && turn.status && (
                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 2, fontSize: 9.5, opacity: 0.75, marginTop: 2 }}>
                              <span>{turn.status}</span>
                              <span>✓✓</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </React.Fragment>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* ── RIGHT PANE: Scorecard & Compliance ── */}
        <div className="eval-pane">

          {/* Header: ScoreRing + RM Name + Metadata + Close Button */}
          <div style={{ padding: 14, borderBottom: '1px solid var(--qa-border)', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <ScoreRing score={currentIqs} />
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  {isCoHandled ? (
                    <>
                      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--qa-text)' }}>
                        {rmAgentName} <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--qa-text-3)' }}>(RM)</span> · {amAgentName} <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--qa-text-3)' }}>(AM)</span>
                      </div>
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          padding: '1.5px 7px',
                          borderRadius: 4,
                          background: '#f4f4f5',
                          color: '#3f3f46',
                          border: '1px solid #e4e4e7',
                          letterSpacing: '0.03em',
                        }}
                      >
                        Dual Chat
                      </span>
                    </>
                  ) : (
                    <>
                      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--qa-text)' }}>
                        {chat.rmName}
                      </div>
                      {(chat.isAm || isPcgAm(chat.rmName)) && (
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            padding: '1px 6px',
                            borderRadius: 4,
                            background: '#f4f4f5',
                            color: '#3f3f46',
                            border: '1px solid #e4e4e7',
                            letterSpacing: '0.02em',
                          }}
                        >
                          AM
                        </span>
                      )}
                    </>
                  )}
                </div>
              </div>

              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
                {canSubmitOverride && (
                  <button
                    type="button"
                    onClick={() => setIsEditing(!isEditing)}
                    style={{
                      padding: '4px 10px',
                      borderRadius: 6,
                      fontSize: 11.5,
                      fontWeight: 600,
                      background: isEditing ? '#f4f4f5' : 'var(--ink, #18181b)',
                      color: isEditing ? '#18181b' : '#ffffff',
                      border: '1px solid var(--qa-border, #e4e4e7)',
                      cursor: 'pointer',
                    }}
                  >
                    {isEditing ? 'Cancel Edit' : 'Edit Evaluation'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close evaluation"
                  title="Close"
                  style={{
                    flexShrink: 0,
                    width: 28,
                    height: 28,
                    border: 0,
                    background: 'none',
                    color: 'var(--qa-text-3)',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 18,
                    lineHeight: 1,
                    borderRadius: 6,
                  }}
                >
                  ✕
                </button>
              </div>
            </div>
          </div>

          {/* Scrollable Scorecard Content */}
          <div className="eval-scroll-s" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 16 }}>

            {/* Co-Handled Top Summary: Mistake Count & IQS Banner (Clean Grey/White) */}
            {isCoHandled && (
              <div style={{ marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
                {/* 1. Mistake Count & IQS Banner in Grey/White */}
                <div
                  style={{
                    background: 'var(--qa-fill-light, #f8fafc)',
                    border: '1px solid var(--qa-border, #e4e4e7)',
                    borderRadius: 8,
                    padding: '12px 14px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: 10,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--qa-text-2, #71717a)' }}>
                      Co-Handled Chat Quality
                    </span>
                    <span style={{ fontSize: 10, fontWeight: 600, padding: '1.5px 6px', borderRadius: 4, background: '#f4f4f5', color: '#3f3f46', border: '1px solid #e4e4e7' }}>
                      RM + AM
                    </span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 11, color: 'var(--qa-text-3, #71717a)' }}>Overall Chat IQS:</span>
                      <span style={{ fontSize: 13, fontWeight: 800, color: currentIqs != null && currentIqs >= 85 ? '#16a34a' : currentIqs != null && currentIqs >= 70 ? '#d97706' : '#dc2626' }}>
                        {currentIqs != null ? `${currentIqs}%` : 'N/A'}
                      </span>
                    </div>

                    <div style={{ width: 1, height: 14, background: 'var(--qa-border, #e4e4e7)' }} />

                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 11, color: 'var(--qa-text-3, #71717a)' }}>Mistake Count:</span>
                      <span
                        style={{
                          fontSize: 12,
                          fontWeight: 700,
                          padding: '2px 8px',
                          borderRadius: 4,
                          background: totalChatMistakes > 0 ? '#f4f4f5' : '#f0fdf4',
                          color: totalChatMistakes > 0 ? '#18181b' : '#15803d',
                          border: `1px solid ${totalChatMistakes > 0 ? '#e4e4e7' : '#bbf7d0'}`,
                        }}
                      >
                        {totalChatMistakes} {totalChatMistakes === 1 ? 'Mistake' : 'Mistakes'}
                        {(rmMistakes.length > 0 || amMistakes.length > 0) && (
                          <span style={{ fontSize: 11, fontWeight: 500, color: '#71717a', marginLeft: 4 }}>
                            (RM: {rmMistakes.length} · AM: {amMistakes.length})
                          </span>
                        )}
                      </span>
                    </div>
                  </div>
                </div>

                {/* 2. 3 Category Toggles: Overall, RM, AM */}
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => setAgentViewTab('overall')}
                    style={{
                      flex: 1,
                      padding: '8px 12px',
                      borderRadius: 6,
                      fontSize: 12,
                      fontWeight: agentViewTab === 'overall' ? 700 : 500,
                      background: agentViewTab === 'overall' ? 'var(--ink, #18181b)' : 'var(--qa-card, #ffffff)',
                      color: agentViewTab === 'overall' ? 'var(--ink-fg, #ffffff)' : 'var(--qa-text, #18181b)',
                      border: '1px solid',
                      borderColor: agentViewTab === 'overall' ? 'var(--ink, #18181b)' : 'var(--qa-border, #e4e4e7)',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    Overall Quality
                  </button>

                  {showRmTab && (
                    <button
                      type="button"
                      onClick={() => setAgentViewTab('rm')}
                      style={{
                        flex: 1,
                        padding: '8px 12px',
                        borderRadius: 6,
                        fontSize: 12,
                        fontWeight: agentViewTab === 'rm' ? 700 : 500,
                        background: agentViewTab === 'rm' ? 'var(--ink, #18181b)' : 'var(--qa-card, #ffffff)',
                        color: agentViewTab === 'rm' ? 'var(--ink-fg, #ffffff)' : 'var(--qa-text, #18181b)',
                        border: '1px solid',
                        borderColor: agentViewTab === 'rm' ? 'var(--ink, #18181b)' : 'var(--qa-border, #e4e4e7)',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 6,
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <span>RM ({rmAgentName})</span>
                      {rmMistakes.length > 0 && (
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            padding: '1px 6px',
                            borderRadius: 4,
                            background: agentViewTab === 'rm' ? 'rgba(255,255,255,0.2)' : '#fee2e2',
                            color: agentViewTab === 'rm' ? '#ffffff' : '#b91c1c',
                          }}
                        >
                          {rmMistakes.length}
                        </span>
                      )}
                    </button>
                  )}

                  {showAmTab && (
                    <button
                      type="button"
                      onClick={() => setAgentViewTab('am')}
                      style={{
                        flex: 1,
                        padding: '8px 12px',
                        borderRadius: 6,
                        fontSize: 12,
                        fontWeight: agentViewTab === 'am' ? 700 : 500,
                        background: agentViewTab === 'am' ? 'var(--ink, #18181b)' : 'var(--qa-card, #ffffff)',
                        color: agentViewTab === 'am' ? 'var(--ink-fg, #ffffff)' : 'var(--qa-text, #18181b)',
                        border: '1px solid',
                        borderColor: agentViewTab === 'am' ? 'var(--ink, #18181b)' : 'var(--qa-border, #e4e4e7)',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 6,
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <span>AM ({amAgentName})</span>
                      {amMistakes.length > 0 && (
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            padding: '1px 6px',
                            borderRadius: 4,
                            background: agentViewTab === 'am' ? 'rgba(255,255,255,0.2)' : '#fee2e2',
                            color: agentViewTab === 'am' ? '#ffffff' : '#b91c1c',
                          }}
                        >
                          {amMistakes.length}
                        </span>
                      )}
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Dedicated Session Summary Card */}
            {chat.summary && (
              <div
                style={{
                  padding: '12px 14px',
                  background: 'var(--qa-fill-light)',
                  border: '1px solid var(--qa-border)',
                  borderRadius: 8,
                  marginBottom: 16,
                }}
              >
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--qa-text-2)', marginBottom: 4 }}>
                  Session Summary
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--qa-text)', lineHeight: 1.55 }}>
                  {chat.summary}
                </div>
              </div>
            )}

            {/* 1. Compliance Gates Card Banner matching CallEvalPanel */}
            <div className={`eval-gates${currentTripwire ? ' failed' : ''}`} style={{ margin: '0 0 20px 0' }}>
              <div className="eval-ghead">
                <div>
                  <span className="eval-gtitle">Compliance Gates</span>
                  {currentTripwire && isCoHandled && (
                    <div style={{ fontSize: 11, color: 'var(--fail)', fontWeight: 600, marginTop: 2 }}>
                      Breach attributed to: Both RM ({rmAgentName}) & AM ({amAgentName})
                    </div>
                  )}
                </div>
                <span className={`eval-chip ${currentTripwire ? 'fail' : 'pass'}`}>
                  {currentTripwire ? 'GATE BREACHED' : 'GATES PASS'}
                </span>
              </div>

              {complianceFlags.map((g) => {
                const isFail = g.status === 'FAIL';
                const isPass = g.status === 'PASS';
                const isNA = !isFail && !isPass;

                return (
                  <div key={g.id} className="eval-gate">
                    <div style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <b>{g.num}. {g.name}</b>
                      {isFail && isCoHandled && (
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            padding: '1px 6px',
                            borderRadius: 4,
                            background: '#ffe4e6',
                            color: '#e11d48',
                            border: '1px solid #fecdd3',
                          }}
                        >
                          {g.failedBy === 'rm'
                            ? `Breach by RM: ${rmAgentName}`
                            : g.failedBy === 'am'
                            ? `Breach by AM: ${amAgentName}`
                            : 'Breach Attributed to Both: RM & AM'}
                        </span>
                      )}
                    </div>
                    <div className="eval-seg gate" role="group" aria-label={`${g.name} result`}>
                      <button
                        type="button"
                        data-v="pass"
                        aria-pressed={isPass}
                        disabled={isReadOnly}
                        onClick={() => !isReadOnly && handleGateChange(g.id, 'PASS')}
                      >
                        Pass
                      </button>
                      <button
                        type="button"
                        data-v="fail"
                        aria-pressed={isFail}
                        disabled={isReadOnly}
                        onClick={() => !isReadOnly && handleGateChange(g.id, 'FAIL')}
                      >
                        Breach
                      </button>
                      <button
                        type="button"
                        data-v="not_applicable"
                        aria-pressed={isNA}
                        disabled={isReadOnly}
                        onClick={() => !isReadOnly && handleGateChange(g.id, 'NA')}
                      >
                        NA
                      </button>
                    </div>

                    {/* Detail only shown on breach */}
                    {isFail && (
                      isReadOnly ? (
                        <div className="eval-gate-extra eval-reason" style={{ marginTop: 8, padding: '10px 14px', lineHeight: 1.6 }}>
                          {isCoHandled && (
                            <div style={{ marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--fail)' }}>
                                Attributed Agent:
                              </span>
                              <span
                                style={{
                                  fontSize: 10.5,
                                  fontWeight: 700,
                                  padding: '1px 7px',
                                  borderRadius: 4,
                                  background: '#ffe4e6',
                                  color: '#e11d48',
                                  border: '1px solid #fecdd3',
                                }}
                              >
                                {g.failedBy === 'rm'
                                  ? `RM (${rmAgentName})`
                                  : g.failedBy === 'am'
                                  ? `AM (${amAgentName})`
                                  : g.failedBy === 'both'
                                  ? `Both RM (${rmAgentName}) & AM (${amAgentName})`
                                  : 'Pending Attribution'}
                              </span>
                            </div>
                          )}
                          <strong>Reason: </strong>{g.reasoning}
                          {g.quote && (
                            <div style={{ marginTop: 6, fontStyle: 'italic', fontSize: 11.5, color: 'var(--fail)' }}>
                              "{g.quote}"
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="eval-gate-extra" style={{ gridColumn: '1 / -1', marginTop: 10 }}>
                          {isCoHandled && (
                            <div style={{ marginBottom: 10 }}>
                              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--qa-text-2)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                Attributed Breach To:
                              </div>
                              <div style={{ display: 'flex', gap: 6 }}>
                                {(['rm', 'am', 'both'] as const).map((agentKey) => {
                                  const isSelected = g.failedBy === agentKey;
                                  return (
                                    <button
                                      key={agentKey}
                                      type="button"
                                      onClick={() => {
                                        setComplianceFlags((prev) =>
                                          prev.map((item) => (item.id === g.id ? { ...item, failedBy: agentKey } : item))
                                        );
                                      }}
                                      style={{
                                        padding: '4px 10px',
                                        borderRadius: 4,
                                        fontSize: 11,
                                        fontWeight: isSelected ? 700 : 500,
                                        background: isSelected ? 'var(--fail)' : 'var(--qa-card)',
                                        color: isSelected ? '#ffffff' : 'var(--qa-text-2)',
                                        border: '1px solid',
                                        borderColor: isSelected ? 'var(--fail)' : 'var(--qa-border)',
                                        cursor: 'pointer',
                                      }}
                                    >
                                      {agentKey === 'rm' ? `RM (${rmAgentName})` : agentKey === 'am' ? `AM (${amAgentName})` : 'Both RM & AM'}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                          <div
                            className="eval-reason-label"
                            style={{
                              fontSize: 11,
                              fontWeight: 700,
                              color: 'var(--fail)',
                              marginBottom: 6,
                              letterSpacing: '0.04em',
                              textTransform: 'uppercase',
                            }}
                          >
                            Reason for Breach:
                          </div>
                          <AutoTextarea
                            className="eval-reason-input"
                            value={g.reasoning || ''}
                            onChange={(e) => {
                              const val = e.target.value;
                              setComplianceFlags((prev) =>
                                prev.map((item) => (item.id === g.id ? { ...item, reasoning: val } : item))
                              );
                            }}
                            placeholder="Specify reason / citation for this compliance breach…"
                            rows={2}
                            style={{
                              width: '100%',
                              fontSize: 12,
                              lineHeight: 1.6,
                              border: '1px solid var(--fail)',
                              borderRadius: 6,
                              padding: '10px 12px',
                              outline: 'none',
                              fontFamily: 'inherit',
                              boxSizing: 'border-box',
                              background: 'var(--qa-card)',
                              color: 'var(--qa-text)',
                            }}
                          />
                        </div>
                      )
                    )}
                  </div>
                );
              })}
            </div>

            {/* RM Compliance Breaches (if any) */}
            {isCoHandled && agentViewTab === 'rm' && rmComplianceBreaches.length > 0 && (
              <div style={{ padding: '12px 14px', background: '#fef2f2', border: '1.5px solid #f87171', borderRadius: 8, marginBottom: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#b91c1c' }}>
                  Compliance Breach Attributed to RM ({rmAgentName})
                </div>
                {rmComplianceBreaches.map(b => (
                  <div key={b.id} style={{ fontSize: 12, color: '#991b1b', lineHeight: 1.5 }}>
                    <strong>{b.num}. {b.name}: </strong>{b.rmReasoning || b.reasoning}
                    {(b.rmQuote || b.quote) && (
                      <div style={{ fontStyle: 'italic', fontSize: 11, marginTop: 4, color: '#7f1d1d' }}>
                        "{b.rmQuote || b.quote}"
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* AM Compliance Breaches (if any) */}
            {isCoHandled && agentViewTab === 'am' && amComplianceBreaches.length > 0 && (
              <div style={{ padding: '12px 14px', background: '#fef2f2', border: '1.5px solid #f87171', borderRadius: 8, marginBottom: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#b91c1c' }}>
                  Compliance Breach Attributed to AM ({amAgentName})
                </div>
                {amComplianceBreaches.map(b => (
                  <div key={b.id} style={{ fontSize: 12, color: '#991b1b', lineHeight: 1.5 }}>
                    <strong>{b.num}. {b.name}: </strong>{b.amReasoning || b.reasoning}
                    {(b.amQuote || b.quote) && (
                      <div style={{ fontStyle: 'italic', fontSize: 11, marginTop: 4, color: '#7f1d1d' }}>
                        "{b.amQuote || b.quote}"
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* 2. 11 Parameters Grouped by Skill in Standard Template Format */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 16 }}>
              {PCG_CHAT_PARAM_GROUPS.map((grp) => {
                const items = grp.keys
                  .map((k) => {
                    const p = params[k] || chat.parameters?.[k];
                    if (!p) return null;
                    return {
                      ...p,
                      id: p.id || k,
                    };
                  })
                  .filter(Boolean) as Array<any>;

                if (items.length === 0) return null;

                return (
                  <div key={grp.group} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        paddingBottom: 4,
                        borderBottom: '1px solid var(--qa-border)',
                      }}
                    >
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em',
                          color: 'var(--qa-text-2)',
                        }}
                      >
                        {grp.group}
                      </span>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          color: 'var(--qa-text)',
                          background: 'var(--qa-fill-light)',
                          padding: '1px 6px',
                          borderRadius: 4,
                          border: '1px solid var(--qa-border)',
                        }}
                      >
                        {grp.weight}
                      </span>
                    </div>

                    {items.map((p) => {
                      const meta = PCG_CHAT_PARAM_META[p.id];
                      const options: Array<'Yes' | 'Half' | 'No' | 'NA'> =
                        meta?.scoreType === 'Yes / Half / No'
                          ? ['Yes', 'Half', 'No', 'NA']
                          : ['Yes', 'No', 'NA'];

                      let rawStatus = p.status;
                      let rawReasoning = p.reasoning;
                      let rawQuote = p.quote;

                      const paramAttr = isCoHandled
                        ? resolveParameterAttribution(p, chat?.transcriptTurns, rmAgentName, amAgentName)
                        : 'rm';

                      if (isCoHandled && agentViewTab === 'rm') {
                        if (p.id === 'QueryResolution' || paramAttr === 'both') {
                          rawStatus = p.rmStatus || p.status;
                          rawReasoning = p.rmReasoning || p.reasoning;
                          rawQuote = p.rmQuote || p.quote;
                        } else if (paramAttr === 'am') {
                          rawStatus = p.rmStatus || 'NA';
                          rawReasoning = p.rmReasoning || '';
                          rawQuote = p.rmQuote || '';
                        } else {
                          rawStatus = p.rmStatus || p.status;
                          rawReasoning = p.rmReasoning || p.reasoning;
                          rawQuote = p.rmQuote || p.quote;
                        }
                      } else if (isCoHandled && agentViewTab === 'am') {
                        if (p.id === 'QueryResolution' || paramAttr === 'both') {
                          rawStatus = p.amStatus || p.status;
                          rawReasoning = p.amReasoning || p.reasoning;
                          rawQuote = p.amQuote || p.quote;
                        } else if (paramAttr === 'rm') {
                          rawStatus = p.amStatus || 'NA';
                          rawReasoning = p.amReasoning || '';
                          rawQuote = p.amQuote || '';
                        } else {
                          rawStatus = p.amStatus || p.status;
                          rawReasoning = p.amReasoning || p.reasoning;
                          rawQuote = p.amQuote || p.quote;
                        }
                      }

                      const norm = normalizeScore(rawStatus ?? null);
                      const activeStatus = norm.label;
                      const isYesOrNa = activeStatus === 'Yes' || activeStatus === 'NA';
                      const isNoOrHalf = activeStatus === 'No' || activeStatus === 'Half';
                      const isExpanded = Boolean(expandedReasons[p.id]);

                      return (
                        <div
                          key={p.id}
                          style={{
                            padding: '12px 14px',
                            background:
                              activeStatus === 'No'
                                ? '#fef2f2'
                                : 'var(--qa-gray-50)',
                            border: `1px solid ${
                              activeStatus === 'No'
                                ? '#fecaca'
                                : 'var(--qa-border-sub)'
                            }`,
                            borderRadius: 8,
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 8,
                          }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                              <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--qa-text)' }}>
                                {p.num}. {p.name}{' '}
                                <span style={{ fontSize: 10.5, color: 'var(--qa-text-3)' }}>
                                  ({p.weight}%)
                                </span>
                              </span>

                              {/* Highlight who made what mistake in Co-Handled view */}
                              {isCoHandled && isNoOrHalf && (
                                <span
                                  style={{
                                    fontSize: 9.5,
                                    fontWeight: 700,
                                    padding: '1px 6px',
                                    borderRadius: 4,
                                    background: (p.id === 'QueryResolution' || paramAttr === 'both') ? '#fef3c7' : '#ffe4e6',
                                    color: (p.id === 'QueryResolution' || paramAttr === 'both') ? '#b45309' : '#e11d48',
                                    border: `1px solid ${(p.id === 'QueryResolution' || paramAttr === 'both') ? '#fde68a' : '#fecdd3'}`,
                                  }}
                                >
                                  {agentViewTab === 'rm'
                                    ? (p.id === 'QueryResolution' || paramAttr === 'both' ? 'Shared Resolution Gap (RM & AM)' : `Attributed to RM (${rmAgentName})`)
                                    : agentViewTab === 'am'
                                      ? (p.id === 'QueryResolution' || paramAttr === 'both' ? 'Shared Resolution Gap (RM & AM)' : `Attributed to AM (${amAgentName})`)
                                      : (p.id === 'QueryResolution' || paramAttr === 'both')
                                        ? 'Shared Resolution Gap (RM & AM)'
                                        : paramAttr === 'rm'
                                          ? `Mistake by RM (${rmAgentName})`
                                          : `Mistake by AM (${amAgentName})`}
                                </span>
                              )}
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              {/* Reason toggle: ONLY for Yes and NA parameters when reasoning or quote is present */}
                              {isReadOnly && isYesOrNa && (rawReasoning || rawQuote) && (
                                <button
                                  type="button"
                                  onClick={() => toggleReason(p.id)}
                                  title={isExpanded ? 'Hide reason' : 'Show reason'}
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 3,
                                    padding: '2px 6px',
                                    borderRadius: 4,
                                    fontSize: 10.5,
                                    fontWeight: 500,
                                    color: 'var(--qa-text-3)',
                                    background: 'var(--qa-card)',
                                    border: '1px solid var(--qa-border)',
                                    cursor: 'pointer',
                                  }}
                                >
                                  <span>{isExpanded ? 'Hide' : 'Reason'}</span>
                                  <span style={{ fontSize: 9 }}>{isExpanded ? '▲' : '▼'}</span>
                                </button>
                              )}

                              {isReadOnly ? (
                                <ScoreBadge score={activeStatus} />
                              ) : (
                                <div style={{ display: 'flex', gap: 4 }}>
                                  {options.map((val) => (
                                    <button
                                      key={val}
                                      type="button"
                                      onClick={() => handleParamScoreChange(p.id, val)}
                                      style={{
                                        padding: '3px 10px',
                                        borderRadius: 5,
                                        fontSize: 11.5,
                                        fontWeight: p.status === val ? 700 : 500,
                                        border: '1px solid var(--qa-border)',
                                        background: p.status === val ? 'var(--ink)' : 'var(--qa-card)',
                                        color: p.status === val ? 'var(--ink-fg)' : 'var(--qa-text)',
                                        cursor: 'pointer',
                                      }}
                                    >
                                      {val === 'Half' ? 'Partial' : val}
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Reasoning & Quote Display Rule:
                              Half & No parameters: Shown automatically.
                              Yes & NA parameters: Shown ONLY when expanded via toggle. */}
                          {isReadOnly ? (
                            <>
                              {(isNoOrHalf || isExpanded) && (
                                <>
                                  {rawReasoning && (
                                    <div style={{ fontSize: 12, color: 'var(--qa-text-2)', lineHeight: 1.6 }}>
                                      {rawReasoning}
                                    </div>
                                  )}
                                  {rawQuote && (
                                    <div
                                      style={{
                                        fontSize: 11.5,
                                        fontStyle: 'italic',
                                        color: 'var(--qa-text-3)',
                                        marginTop: 4,
                                        borderLeft: '2px solid var(--qa-border)',
                                        paddingLeft: 8,
                                        lineHeight: 1.5,
                                      }}
                                    >
                                      "{rawQuote}"
                                    </div>
                                  )}
                                </>
                              )}
                            </>
                          ) : (
                            <AutoTextarea
                              value={p.reasoning || ''}
                              onChange={(e) => handleParamReasoningChange(p.id, e.target.value)}
                              placeholder={`Reasoning or transcript quote for ${p.name}…`}
                              rows={2}
                              style={{
                                width: '100%',
                                fontSize: 12,
                                lineHeight: 1.6,
                                border: '1px solid var(--qa-border)',
                                borderRadius: 6,
                                padding: '10px 12px',
                                outline: 'none',
                                fontFamily: 'inherit',
                                boxSizing: 'border-box',
                                background: 'var(--qa-card)',
                                color: 'var(--qa-text)',
                              }}
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>

          </div>

          {/* Sticky commit footer: submit evaluation override */}
          {!isReadOnly && (
            <div
              style={{
                position: 'sticky',
                bottom: 0,
                zIndex: 2,
                flexShrink: 0,
                padding: '16px 20px',
                borderTop: '1px solid var(--qa-border)',
                background: 'var(--qa-card)',
              }}
            >
              <button
                type="button"
                disabled={isSubmittingOverride}
                onClick={handleSubmitOverride}
                style={{
                  width: '100%',
                  height: 46,
                  padding: '0 24px',
                  borderRadius: 10,
                  background: '#18181b',
                  color: '#ffffff',
                  fontSize: 14,
                  fontWeight: 600,
                  border: 'none',
                  cursor: isSubmittingOverride ? 'not-allowed' : 'pointer',
                  opacity: isSubmittingOverride ? 0.6 : 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  letterSpacing: '0.01em',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
                  transition: 'background 0.15s, opacity 0.15s',
                }}
              >
                {isSubmittingOverride ? 'Saving Override…' : 'Submit Evaluation Override'}
              </button>
            </div>
          )}
        </div>

      </div>
    </div>
  );

  if (standalone) {
    return (
      <div className="eval-panel-cell" style={{ padding: 0, background: 'var(--qa-gray-50)', borderRadius: 8 }}>
        {panelContent}
      </div>
    );
  }

  return (
    <tr className="eval-panel-row">
      <td
        colSpan={colSpan}
        className="eval-panel-cell"
        style={{
          padding: 0,
          background: 'var(--qa-gray-50)',
          borderBottom: '1px solid var(--qa-border)',
        }}
      >
        {panelContent}
      </td>
    </tr>
  );
}
