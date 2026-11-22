'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { IQSRing } from '@/components/quality/IQSRing';
import AutoTextarea from '@/components/quality/AutoTextarea';
import { isPcgAm } from '@/lib/pcg/canonical-names';
import type { PcgEmailEvaluation } from '@/app/api/admin/pcg-emails/route';

interface Props {
  email: PcgEmailEvaluation;
  colSpan?: number;
  onClose?: () => void;
  onDisputeUpdate?: () => void;
  userRole?: 'admin' | 'tl' | 'agent';
  allowRaiseDispute?: boolean;
  canOverride?: boolean;
}

interface EmailBlock {
  type: 'salutation' | 'numbered' | 'bullet' | 'paragraph' | 'signature';
  number?: string;
  title?: string;
  text?: string;
  contentLines?: string[];
  lines?: string[];
}

function parseEmailContent(text: string): EmailBlock[] {
  if (!text) return [];
  const lines = text.split('\n');
  const blocks: EmailBlock[] = [];
  let currentBlock: EmailBlock | null = null;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const line = rawLine.trim();

    if (!line) {
      if (currentBlock) {
        blocks.push(currentBlock);
        currentBlock = null;
      }
      continue;
    }

    // Check salutation at beginning of text
    if (!currentBlock && blocks.length === 0 && /^(?:Dear|Hi|Hello|Good\s+(?:morning|afternoon|evening))\b/i.test(line)) {
      blocks.push({ type: 'salutation', text: line });
      continue;
    }

    // Check signoff / signature start
    if (/^(?:Warm\s+regards|Best\s+regards|Warm\s+wishes|Kind\s+regards|Regards|Thanks\s+&?\s+regards|Thanks|Thank\s+you|Sincerely|Cheers|Yours\s+truly)[,\.]?$/i.test(line)) {
      if (currentBlock) blocks.push(currentBlock);
      const sigLines = [line];
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].trim()) sigLines.push(lines[j].trim());
      }
      blocks.push({ type: 'signature', lines: sigLines });
      currentBlock = null;
      break;
    }

    // Check numbered item: e.g. '1. ', '1) ', '1 - '
    const numMatch = line.match(/^(\d+)[\.\)\-]\s*(.*)$/);
    if (numMatch) {
      if (currentBlock) blocks.push(currentBlock);
      const num = numMatch[1];
      const rest = numMatch[2].trim();
      
      const colonIndex = rest.indexOf(':');
      let title = '';
      let content = rest;
      if (colonIndex !== -1 && colonIndex < 80) {
        title = rest.slice(0, colonIndex + 1).trim();
        content = rest.slice(colonIndex + 1).trim();
      }

      currentBlock = {
        type: 'numbered',
        number: num,
        title,
        contentLines: content ? [content] : []
      };
      continue;
    }

    // Check bullet item: e.g. '• ', '- ', '* ', '– '
    const bulletMatch = line.match(/^[\•\-\*\–\—]\s+(.*)$/);
    if (bulletMatch) {
      if (currentBlock) blocks.push(currentBlock);
      const rest = bulletMatch[1].trim();
      const colonIndex = rest.indexOf(':');
      let title = '';
      let content = rest;
      if (colonIndex !== -1 && colonIndex < 80) {
        title = rest.slice(0, colonIndex + 1).trim();
        content = rest.slice(colonIndex + 1).trim();
      }
      currentBlock = {
        type: 'bullet',
        title,
        contentLines: content ? [content] : []
      };
      continue;
    }

    // Continuation of numbered or bullet block if indented or within same list item
    if (currentBlock && (currentBlock.type === 'numbered' || currentBlock.type === 'bullet')) {
      currentBlock.contentLines!.push(line);
      continue;
    }

    // Normal paragraph
    if (!currentBlock) {
      currentBlock = { type: 'paragraph', contentLines: [line] };
    } else if (currentBlock.type === 'paragraph') {
      currentBlock.contentLines!.push(line);
    }
  }

  if (currentBlock) {
    blocks.push(currentBlock);
  }

  return blocks;
}

export function FormattedEmailContent({
  content,
  role = 'rm',
}: {
  content: string;
  role?: 'customer' | 'rm' | 'am' | 'tl';
}) {
  const blocks = useMemo(() => parseEmailContent(content || ''), [content]);

  if (!content || !content.trim()) {
    return <div className="text-xs text-slate-400 italic">No content available.</div>;
  }

  // If text is plain unformatted single line or block with no numbers/bullets/salutations
  if (blocks.length === 1 && blocks[0].type === 'paragraph') {
    return (
      <div className="text-xs leading-relaxed text-slate-800 dark:text-slate-200 whitespace-pre-wrap font-sans">
        {content}
      </div>
    );
  }

  const isCustomer = role === 'customer';

  return (
    <div className="space-y-3 font-sans text-xs">
      {blocks.map((b, idx) => {
        if (b.type === 'salutation') {
          return (
            <div key={idx} className="font-semibold text-slate-900 dark:text-slate-100 text-[12.5px]">
              {b.text}
            </div>
          );
        }

        if (b.type === 'numbered') {
          return (
            <div
              key={idx}
              className={`flex items-start gap-3 p-3 rounded-lg border transition-all ${
                isCustomer
                  ? 'bg-slate-50/90 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700'
                  : 'bg-emerald-50/40 dark:bg-emerald-950/20 border-emerald-200/70 dark:border-emerald-800/60 shadow-2xs'
              }`}
            >
              <span
                className={`shrink-0 w-6 h-6 rounded-full font-bold text-xs flex items-center justify-center border shadow-2xs ${
                  isCustomer
                    ? 'bg-blue-100 text-blue-800 dark:bg-blue-950/80 dark:text-blue-300 border-blue-300 dark:border-blue-800'
                    : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700'
                }`}
              >
                {b.number}
              </span>
              <div className="flex-1 min-w-0 space-y-1">
                {b.title && (
                  <div className="font-semibold text-slate-900 dark:text-slate-100 text-xs">
                    {b.title}
                  </div>
                )}
                <div className="text-slate-700 dark:text-slate-300 leading-relaxed text-xs">
                  {b.contentLines?.join(' ')}
                </div>
              </div>
            </div>
          );
        }

        if (b.type === 'bullet') {
          return (
            <div key={idx} className="flex items-start gap-2.5 py-1 px-1">
              <span
                className={`w-1.5 h-1.5 rounded-full mt-2 shrink-0 ${
                  isCustomer
                    ? 'bg-blue-600 dark:bg-blue-400'
                    : 'bg-emerald-600 dark:bg-emerald-400'
                }`}
              />
              <div className="flex-1 min-w-0 text-slate-700 dark:text-slate-300 leading-relaxed text-xs">
                {b.title && (
                  <span className="font-semibold text-slate-900 dark:text-slate-100 mr-1.5">
                    {b.title}
                  </span>
                )}
                <span>{b.contentLines?.join(' ')}</span>
              </div>
            </div>
          );
        }

        if (b.type === 'paragraph') {
          return (
            <p key={idx} className="leading-relaxed text-slate-700 dark:text-slate-300 text-xs">
              {b.contentLines?.join(' ')}
            </p>
          );
        }

        if (b.type === 'signature') {
          return (
            <div
              key={idx}
              className="mt-4 pt-3.5 border-t border-slate-200/90 dark:border-slate-800 text-[11.5px] text-slate-600 dark:text-slate-400 space-y-0.5"
            >
              {b.lines?.map((line, lIdx) => (
                <div
                  key={lIdx}
                  className={
                    lIdx === 0
                      ? 'font-medium text-slate-700 dark:text-slate-300 mb-1'
                      : lIdx === 1
                      ? 'font-semibold text-slate-800 dark:text-slate-200'
                      : ''
                  }
                >
                  {line}
                </div>
              ))}
            </div>
          );
        }

        return null;
      })}
    </div>
  );
}

export default function PcgEmailEvalPanel({
  email,
  colSpan = 6,
  onClose,
  onDisputeUpdate,
  userRole = 'admin',
  allowRaiseDispute = false,
  canOverride,
}: Props) {
  // Currently viewed reply (defaults to the evaluated reply)
  const [selectedReplyId, setSelectedReplyId] = useState<string>(email.messageId);
  const [showJourney, setShowJourney] = useState(false);
  const [raisingDispute, setRaisingDispute] = useState(false);
  const [disputeSelectedParams, setDisputeSelectedParams] = useState<Record<string, boolean>>({});
  const [disputeParamNotes, setDisputeParamNotes] = useState<Record<string, string>>({});
  const [disputeNotes, setDisputeNotes] = useState('');
  const [disputeSubmitting, setDisputeSubmitting] = useState(false);

  // Inline Edit Evaluation state: authorized reviewer can edit
  const canEditEvaluation = canOverride !== undefined ? canOverride : userRole === 'tl';
  const [isEditing, setIsEditing] = useState(false);
  const [draftParams, setDraftParams] = useState<PcgEmailEvaluation['parameters']>(() => ({ ...email.parameters }));
  const [draftGates, setDraftGates] = useState<PcgEmailEvaluation['complianceFlags']>(() => [...email.complianceFlags]);
  const [overrideNotes, setOverrideNotes] = useState(email.tlOverrideNote || '');
  const [overrideSubmitting, setOverrideSubmitting] = useState(false);

  useEffect(() => {
    setDraftParams({ ...email.parameters });
    setDraftGates([...email.complianceFlags]);
    setOverrideNotes(email.tlOverrideNote || '');
  }, [email]);

  // Expanded parameter breakdown: by default stay closed; only 'no' and 'half' are expanded by default
  const [expandedParams, setExpandedParams] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    const params = email?.parameters || {};
    for (const [key, val] of Object.entries(params)) {
      const score = (val?.score || '').toString().toLowerCase();
      if (score === 'no' || score === 'half' || score === 'partial') {
        initial[key] = true;
      }
    }
    return initial;
  });

  useEffect(() => {
    const initial: Record<string, boolean> = {};
    const params = email?.parameters || {};
    for (const [key, val] of Object.entries(params)) {
      const score = (val?.score || '').toString().toLowerCase();
      if (score === 'no' || score === 'half' || score === 'partial') {
        initial[key] = true;
      }
    }
    setExpandedParams(initial);
  }, [email?.ticketId, email?.messageId]);

  const toggleParam = (key: string) => {
    setExpandedParams((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  // Currently inspected reply object
  const activeReply = email.threadReplies.find((r) => r.id === selectedReplyId) || email.threadReplies[email.threadReplies.length - 1];
  const isViewingEvaluatedReply = activeReply.id === email.messageId;

  const activeParams = isEditing ? draftParams : email.parameters;
  const activeGates = isEditing ? draftGates : email.complianceFlags;
  const paramEntries = Object.entries(activeParams);

  // Live recalculated IQS score from parameters
  const displayedIqsScore = useMemo(() => {
    if (!isEditing) return email.iqsScore;
    let earned = 0;
    let applicable = 0;
    Object.values(draftParams).forEach((p) => {
      if (p.score === 'na') return;
      const w = Number(p.maxScore ?? p.weight ?? 0);
      applicable += w;
      if (p.score === 'yes') earned += w;
      else if (p.score === 'half') earned += w * 0.5;
    });
    return applicable > 0 ? Math.round((earned / applicable) * 100) : email.iqsScore;
  }, [isEditing, draftParams, email.iqsScore]);

  const currentTripwire = useMemo(() => {
    return activeGates.some((g) => g.status === 'FAIL');
  }, [activeGates]);
  const isReadOnly = !canEditEvaluation || !isEditing;

  const handleParamScoreChange = (key: string, nextScore: 'yes' | 'half' | 'no' | 'na') => {
    if (nextScore === 'no' || nextScore === 'half') {
      setExpandedParams((prev) => ({ ...prev, [key]: true }));
    }
    setDraftParams((prev) => {
      const cur = prev[key];
      if (!cur) return prev;
      const max = Number(cur.maxScore ?? cur.weight ?? 0);
      const earned =
        nextScore === 'yes' ? max : nextScore === 'half' ? Math.round(max * 0.5 * 10) / 10 : 0;
      return {
        ...prev,
        [key]: {
          ...cur,
          score: nextScore,
          earnedScore: earned,
        },
      };
    });
  };

  const handleGateToggle = (gateKey: string, nextStatus: 'PASS' | 'FAIL' | 'NA') => {
    setDraftGates((prev) =>
      prev.map((g) => (g.gate === gateKey ? { ...g, status: nextStatus } : g))
    );
  };

  const handleGateReasonChange = (gateKey: string, nextReason: string) => {
    setDraftGates((prev) =>
      prev.map((g) => (g.gate === gateKey ? { ...g, reason: nextReason } : g))
    );
  };

  const handleCancelEdit = () => {
    setDraftParams({ ...email.parameters });
    setDraftGates([...email.complianceFlags]);
    setOverrideNotes(email.tlOverrideNote || '');
    setIsEditing(false);
  };

  const renderParamScoreBadge = (score: 'yes' | 'half' | 'no' | 'na') => {
    if (score === 'yes') {
      return (
        <span className="px-[7px] py-[2px] rounded text-[10px] font-bold tracking-[0.02em] bg-[#dcfce7] text-[#166534]">
          Yes
        </span>
      );
    }
    if (score === 'half') {
      return (
        <span className="px-[7px] py-[2px] rounded text-[10px] font-bold tracking-[0.02em] bg-[#f4f4f5] text-[#52525b] border border-[#e4e4e7]">
          Half
        </span>
      );
    }
    if (score === 'no') {
      return (
        <span className="px-[7px] py-[2px] rounded text-[10px] font-bold tracking-[0.02em] bg-[#fee2e2] text-[#b91c1c]">
          No
        </span>
      );
    }
    return (
      <span className="px-[7px] py-[2px] rounded text-[10px] font-bold tracking-[0.02em] bg-[#f4f4f5] text-[#71717a] border border-[#e4e4e7]">
        NA
      </span>
    );
  };

  const handleRaiseDispute = async () => {
    const challenged = paramEntries
      .map(([key, param], idx) => ({
        paramKey: key,
        paramName: param.name,
        paramNum: idx + 1,
        note: disputeParamNotes[key]?.trim() || '',
      }))
      .filter((item) => disputeSelectedParams[item.paramKey]);

    if (challenged.length === 0 && !disputeNotes.trim()) {
      alert('Please select at least one parameter to challenge or provide an explanation note.');
      return;
    }

    setDisputeSubmitting(true);
    try {
      const paramsPrefix =
        challenged.length > 0
          ? `Parameters challenged: ${challenged
              .map((p) => `${p.paramNum}. ${p.paramName}${p.note ? ` (${p.note})` : ''}`)
              .join(', ')}. `
          : '';
      const summaryText = (paramsPrefix + disputeNotes.trim()).trim();

      const res = await fetch('/api/admin/pcg-emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'raise_dispute',
          emailId: email.id,
          disputeReason: summaryText,
          authorName: email.rmName,
        }),
      });
      if (res.ok) {
        setRaisingDispute(false);
        setDisputeSelectedParams({});
        setDisputeParamNotes({});
        setDisputeNotes('');
        onDisputeUpdate?.();
      }
    } catch (err) {
      console.error('Failed to submit dispute:', err);
    } finally {
      setDisputeSubmitting(false);
    }
  };

  const handleSaveEvaluation = async () => {
    setOverrideSubmitting(true);
    try {
      const res = await fetch('/api/admin/pcg-emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'override',
          emailId: email.id,
          tlOverrideNote: overrideNotes.trim(),
          newIqsScore: displayedIqsScore,
          parameters: draftParams,
          complianceFlags: draftGates,
          authorName: email.tlName || 'Team Lead',
        }),
      });
      if (res.ok) {
        setIsEditing(false);
        onDisputeUpdate?.();
      }
    } catch (err) {
      console.error('Failed to save evaluation edits:', err);
    } finally {
      setOverrideSubmitting(false);
    }
  };

  const getVerdictBadge = (verdict: string) => {
    if (verdict === 'excellent') {
      return (
        <span className="px-2.5 py-1 text-[11px] font-bold rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
          EXCELLENT
        </span>
      );
    }
    if (verdict === 'meets_expectations') {
      return (
        <span className="px-2.5 py-1 text-[11px] font-bold rounded-full bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300 border border-blue-300 dark:border-blue-800">
          MEETS EXPECTATIONS
        </span>
      );
    }
    if (verdict === 'coaching') {
      return (
        <span className="px-2.5 py-1 text-[11px] font-bold rounded-full bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-300 dark:border-amber-800">
          COACHING
        </span>
      );
    }
    return (
      <span className="px-2.5 py-1 text-[11px] font-bold rounded-full bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300 border border-rose-300 dark:border-rose-800">
        REMEDIATION
      </span>
    );
  };

  const panelContent = (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm overflow-hidden my-3">
      {/* ── TOP HISTORY PANEL: CUSTOMER EMAIL JOURNEY (LATEST 3 REPLIES) ── */}
      <div className={`px-4 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 ${showJourney ? 'pt-4 pb-3' : 'py-3'}`}>
        <div
          onClick={() => setShowJourney((prev) => !prev)}
          className={`flex items-center justify-between cursor-pointer select-none ${showJourney ? 'mb-2.5' : ''}`}
        >
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-slate-500 dark:text-slate-400">
              Customer Email Journey
            </span>
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
              {email.totalRepliesInThread > email.latestThreeReplies.length
                ? `Latest ${email.latestThreeReplies.length} of ${email.totalRepliesInThread} Replies`
                : `${email.latestThreeReplies.length} ${email.latestThreeReplies.length === 1 ? 'Reply' : 'Replies'}`}
            </span>
          </div>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setShowJourney((prev) => !prev);
            }}
            className="px-2.5 py-1 text-[11px] font-semibold rounded-[5px] bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 inline-flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <span>{showJourney ? 'Hide' : 'View'}</span>
            <span className="text-[9px] opacity-70">{showJourney ? '▲' : '▼'}</span>
          </button>
        </div>

        {/* Stacked Journey Rows matching PCG Customer Chat Journey */}
        {showJourney && (
        <div className="flex flex-col gap-2">
          {email.latestThreeReplies.map((reply) => {
            const isActive = selectedReplyId === reply.id;
            const isEvaluated = Boolean(reply.isEvaluatedReply);
            const sentDateStr = new Date(reply.sentAt).toLocaleDateString('en-IN', {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
            });
            const sentTimeStr = new Date(reply.sentAt).toLocaleTimeString('en-IN', {
              hour: '2-digit',
              minute: '2-digit',
            });

            return (
              <div
                key={reply.id}
                onClick={() => setSelectedReplyId(reply.id)}
                title={isActive ? 'Currently viewing this reply' : 'Click to inspect this email reply'}
                className={`flex items-center gap-3 px-3 py-2 rounded-md border transition-colors ${
                  isActive
                    ? 'bg-[#f0fdf4] dark:bg-emerald-950/30 border-[#86efac] dark:border-emerald-800 cursor-default'
                    : 'bg-[#f9fafb] dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 hover:bg-slate-100/70 dark:hover:bg-slate-800 cursor-pointer'
                }`}
              >
                {/* Left Badge Group */}
                <div className="flex items-center gap-1.5 shrink-0">
                  <span
                    className={`text-[11.5px] font-bold px-2.5 py-[3px] rounded-[5px] border tracking-[0.02em] ${
                      isActive
                        ? 'bg-[#15803d] text-white border-[#15803d]'
                        : 'bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 border-slate-200 dark:border-slate-700'
                    }`}
                  >
                    Reply #{reply.replyNumber}
                  </span>

                  {isActive && (
                    <span className="text-[10px] font-bold uppercase px-1.5 py-[2px] rounded bg-[#dcfce7] dark:bg-emerald-900/60 text-[#166534] dark:text-emerald-300 border border-[#bbf7d0] dark:border-emerald-800">
                      Viewing
                    </span>
                  )}
                </div>

                {/* Middle Details & Summary */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center flex-wrap gap-2 text-[11px] text-slate-500 dark:text-slate-400 mb-0.5">
                    <span>{sentDateStr}, {sentTimeStr}</span>
                    <span>·</span>
                    <span className="font-medium text-slate-600 dark:text-slate-300 inline-flex items-center gap-1.5">
                      <span>{reply.authorName}</span>
                      <span
                        className={`text-[9.5px] font-bold px-1.5 py-[1px] rounded tracking-wide uppercase ${
                          reply.authorRole === 'customer'
                            ? 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
                            : reply.authorRole === 'am' || isPcgAm(reply.authorName)
                              ? 'bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300 border border-purple-200 dark:border-purple-800'
                              : reply.authorRole === 'tl'
                                ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-200 dark:border-amber-800'
                                : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                        }`}
                      >
                        {reply.authorRole === 'customer'
                          ? 'Customer'
                          : reply.authorRole === 'am' || isPcgAm(reply.authorName)
                            ? 'AM'
                            : reply.authorRole === 'tl'
                              ? 'TL'
                              : 'RM'}
                      </span>
                    </span>
                    {isEvaluated ? (
                      <>
                        <span>·</span>
                        <span
                          className={`font-semibold ${
                            email.iqsScore >= 85
                              ? 'text-[#15803d] dark:text-emerald-400'
                              : email.iqsScore >= 70
                              ? 'text-[#b45309] dark:text-amber-400'
                              : 'text-[#dc2626] dark:text-rose-400'
                          }`}
                        >
                          IQS {email.iqsScore}%
                        </span>
                      </>
                    ) : (
                      <>
                        <span>·</span>
                        <span>{reply.direction === 'inbound' ? 'Customer' : 'Context only'}</span>
                      </>
                    )}
                  </div>
                  <div
                    className={`text-xs leading-[1.45] ${
                      isActive
                        ? 'text-[#14532d] dark:text-emerald-100'
                        : 'text-slate-800 dark:text-slate-200'
                    }`}
                  >
                    {reply.snippet}
                  </div>
                </div>

                {/* Right CTA if not active */}
                {!isActive && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedReplyId(reply.id);
                    }}
                    className="shrink-0 px-2.5 py-1 text-[11px] font-semibold rounded-[5px] bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer"
                  >
                    View Reply →
                  </button>
                )}
              </div>
            );
          })}
        </div>
        )}
      </div>

      {/* ── INLINE RAISE DISPUTE FORM (matching PCG Chat Quality) ── */}
      {raisingDispute && (
        <div className="p-4 bg-[#f8f9fa] dark:bg-slate-800/70 border-b border-slate-200 dark:border-slate-700">
          <div className="p-4 bg-[#f4f5f6] dark:bg-slate-900/70 border border-slate-300 dark:border-slate-700 rounded-lg">
            <h4 className="m-0 mb-2 text-[14px] font-semibold text-slate-900 dark:text-white">
              Raise Dispute on Ticket #{email.chatId || (email.ticketId.length > 12 ? `${email.ticketId.slice(0, 8)}…` : email.ticketId)} to Team Lead (Team {email.tlName})
            </h4>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
              Select parameters to challenge and add brief justification:
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 mb-3">
              {paramEntries.map(([pKey, param], idx) => {
                const isChecked = Boolean(disputeSelectedParams[pKey]);
                return (
                  <div
                    key={pKey}
                    className={`p-2 bg-white dark:bg-slate-800 rounded-md border transition-all ${
                      isChecked
                        ? 'border-zinc-900 dark:border-emerald-400 ring-1 ring-zinc-900 dark:ring-emerald-400'
                        : 'border-slate-200 dark:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1.5">
                      <label className="flex items-center gap-1.5 text-xs font-semibold cursor-pointer flex-1 min-w-0">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) =>
                            setDisputeSelectedParams((prev) => ({
                              ...prev,
                              [pKey]: e.target.checked,
                            }))
                          }
                          className="cursor-pointer shrink-0 accent-zinc-900"
                        />
                        <span
                          className="truncate text-slate-900 dark:text-slate-100"
                          title={`${idx + 1}. ${param.name}`}
                        >
                          {idx + 1}. {param.name}
                        </span>
                      </label>
                      <span className="text-[10.5px] text-slate-400 font-medium shrink-0">
                        ({param.weight}%)
                      </span>
                      <span className="shrink-0">
                        {renderParamScoreBadge(param.score)}
                      </span>
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
                        className="w-full mt-1.5 px-2 py-1 text-[11.5px] border border-slate-200 dark:border-slate-700 rounded bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:border-slate-400"
                      />
                    )}
                  </div>
                );
              })}
            </div>

            <textarea
              placeholder="Overall explanation note…"
              value={disputeNotes}
              onChange={(e) => setDisputeNotes(e.target.value)}
              rows={2}
              className="w-full min-h-[48px] px-2.5 py-2 text-xs border border-slate-200 dark:border-slate-700 rounded-md mb-2.5 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:border-slate-400"
            />

            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={disputeSubmitting}
                onClick={handleRaiseDispute}
                className="px-3.5 py-1.5 text-xs font-semibold bg-zinc-900 hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 text-white rounded-md cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
              >
                {disputeSubmitting ? 'Submitting…' : 'Submit Dispute'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setRaisingDispute(false);
                  setDisputeSelectedParams({});
                  setDisputeParamNotes({});
                  setDisputeNotes('');
                }}
                className="px-3.5 py-1.5 text-xs font-medium bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-md cursor-pointer text-slate-800 dark:text-slate-200 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MAIN CONTENT & SIDE PANEL SPLIT ── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 min-h-[580px]">
        {/* ── LEFT/CENTER: EMAIL REPLIES (7 COLS) ── */}
        <div className="lg:col-span-7 p-6 border-r border-slate-200 dark:border-slate-800 space-y-5 overflow-y-auto max-h-[750px]">
          {/* Inbound Customer Query Card */}
          <div className="bg-slate-50/80 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl p-4.5 space-y-3 shadow-xs">
            <div className="flex items-center justify-between border-b border-slate-200/70 dark:border-slate-700/60 pb-2.5">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-full bg-blue-100 dark:bg-blue-950/80 text-blue-700 dark:text-blue-300 flex items-center justify-center font-bold text-xs border border-blue-200 dark:border-blue-800">
                  {email.customerName.charAt(0).toUpperCase()}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-xs text-slate-900 dark:text-slate-100">
                      {email.customerName}
                    </span>
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300 border border-blue-200 dark:border-blue-800 uppercase tracking-wide">
                      Customer
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    {email.customerEmail} {email.customerPhone ? `· ${email.customerPhone}` : ''}
                  </div>
                </div>
              </div>
              <span className="text-[10.5px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                Inbound Query
              </span>
            </div>

            <div className="text-xs text-slate-800 dark:text-slate-200 font-semibold bg-white dark:bg-slate-900 px-3 py-1.5 rounded-md border border-slate-200/80 dark:border-slate-700/60 flex items-center gap-1.5">
              <span className="text-slate-400 font-normal">Subject:</span>
              <span>{email.subjectLine}</span>
            </div>

            <div className="bg-white dark:bg-slate-900 p-3.5 rounded-lg border border-slate-200/80 dark:border-slate-700/60 shadow-2xs">
              <FormattedEmailContent content={email.customerMessage} role="customer" />
            </div>
          </div>

          {/* Evaluated Outbound Reply / Active Reply Card */}
          <div
            className={`rounded-xl p-5 border space-y-3.5 transition-all ${
              isViewingEvaluatedReply
                ? 'bg-white dark:bg-slate-900 border-emerald-300 dark:border-emerald-800 shadow-sm'
                : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 shadow-xs'
            }`}
          >
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2.5">
              <div className="flex items-center gap-2.5">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center font-bold text-xs border ${
                  activeReply.authorRole === 'customer'
                    ? 'bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700'
                    : 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800'
                }`}>
                  {activeReply.authorName.charAt(0).toUpperCase()}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm text-slate-900 dark:text-white">
                      {activeReply.authorName}
                    </span>
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded font-bold tracking-wide uppercase ${
                        activeReply.authorRole === 'customer'
                          ? 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border border-slate-200 dark:border-slate-700'
                          : activeReply.authorRole === 'am' || isPcgAm(activeReply.authorName)
                            ? 'bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300 border border-purple-200 dark:border-purple-800'
                            : activeReply.authorRole === 'tl'
                              ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-200 dark:border-amber-800'
                              : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                      }`}
                    >
                      {activeReply.authorRole === 'customer'
                        ? 'CUSTOMER'
                        : activeReply.authorRole === 'tl'
                          ? 'TL'
                          : activeReply.authorRole === 'am' || isPcgAm(activeReply.authorName)
                            ? 'AM'
                            : 'RM'}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-400">
                    {activeReply.authorEmail}
                  </div>
                </div>
              </div>
              <span className="text-xs text-slate-400">
                {new Date(activeReply.sentAt).toLocaleString('en-IN', {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            </div>

            <div className="text-xs">
              {activeReply.content === email.customerMessage && !email.agentReplyText && activeReply.authorRole === 'customer' ? (
                <div className="p-4 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 text-center space-y-1">
                  <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Awaiting Outbound RM Reply
                  </div>
                  <div className="text-[11.5px] text-slate-500 dark:text-slate-400">
                    This ticket currently only contains the inbound inquiry. Once an RM sends a response, the evaluated reply will be displayed here.
                  </div>
                </div>
              ) : (
                <FormattedEmailContent
                  content={activeReply.content}
                  role={activeReply.authorRole === 'customer' ? 'customer' : 'rm'}
                />
              )}
            </div>

            {/* Evaluated Badge Notice */}
            {isViewingEvaluatedReply && (
              <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-[11px] text-emerald-800 dark:text-emerald-300">
                <span className="flex items-center gap-1.5 font-medium">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  Quality evaluation applied strictly to this reply. Preceding thread history evaluated as context.
                </span>
                <span className="font-bold">IQS Score: {email.iqsScore}%</span>
              </div>
            )}
          </div>
        </div>

        {/* ── RIGHT: SUMMARY CARDS & EVALUATION SCORECARD (5 COLS) ── */}
        <div className="lg:col-span-5 p-6 bg-slate-50/40 dark:bg-slate-900/40 space-y-5 overflow-y-auto max-h-[750px]">
          {/* 1. OVERALL TICKET SUMMARY CARD */}
          <div className="bg-white dark:bg-slate-800/90 border border-slate-200 dark:border-slate-700 rounded-xl p-4 shadow-xs space-y-2">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
              Overall Ticket Summary
            </div>
            <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
              {email.ticketSummary}
            </p>
          </div>

          {/* 2. IQS SCORE & COMPLIANCE SUMMARY */}
          <div className="bg-white dark:bg-slate-800/90 border border-slate-200 dark:border-slate-700 rounded-xl p-4 shadow-xs">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-3">
                <IQSRing iqs={displayedIqsScore} size={54} />
                <div>
                  <div className="text-xs text-slate-400">Quality Score</div>
                  <div className="text-base font-bold text-slate-900 dark:text-white">
                    {displayedIqsScore}%
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {email.disputeStatus === 'pending' && (
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300">
                    DISPUTE PENDING
                  </span>
                )}
                {userRole === 'agent' && email.disputeStatus === 'none' && allowRaiseDispute && !raisingDispute && (
                  <button
                    type="button"
                    onClick={() => setRaisingDispute(true)}
                    className="px-3 py-1.5 rounded-md text-xs font-semibold bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-slate-900 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                  >
                    Raise Dispute
                  </button>
                )}
                {canEditEvaluation && (
                  <button
                    type="button"
                    onClick={() => {
                      if (isEditing) handleCancelEdit();
                      else setIsEditing(true);
                    }}
                    className={`px-3 py-1.5 rounded-md text-xs font-semibold border transition-colors cursor-pointer ${
                      isEditing
                        ? 'bg-zinc-100 text-zinc-900 border-zinc-200 hover:bg-zinc-200 dark:bg-slate-700 dark:text-white dark:border-slate-600'
                        : 'bg-zinc-900 text-white border-zinc-900 hover:bg-zinc-800 dark:bg-white dark:text-zinc-900'
                    }`}
                  >
                    {isEditing ? 'Cancel Edit' : 'Edit Evaluation'}
                  </button>
                )}
                {onClose && (
                  <button
                    type="button"
                    onClick={onClose}
                    aria-label="Close evaluation"
                    title="Close"
                    className="w-7 h-7 flex items-center justify-center rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* 2b. COMPLIANCE GATES BANNER (matching PCG Chats) */}
          <div className={`eval-gates${currentTripwire ? ' failed' : ''}`} style={{ margin: 0 }}>
            <div className="eval-ghead">
              <span className="eval-gtitle">Compliance Gates</span>
              <span className={`eval-chip ${currentTripwire ? 'fail' : 'pass'}`}>
                {currentTripwire ? 'GATE BREACHED' : 'GATES PASS'}
              </span>
            </div>

            {activeGates.map((gate) => {
              const isFail = gate.status === 'FAIL';
              const isPass = gate.status === 'PASS';
              const isNA = !isFail && !isPass;

              return (
                <div key={gate.gate} className="eval-gate">
                  <div style={{ minWidth: 0 }}>
                    <b>{gate.label}</b>
                  </div>

                  <div className="eval-seg gate" role="group" aria-label={`${gate.label} result`}>
                    <button
                      type="button"
                      data-v="pass"
                      aria-pressed={isPass}
                      disabled={isReadOnly}
                      onClick={() => !isReadOnly && handleGateToggle(gate.gate, 'PASS')}
                    >
                      Pass
                    </button>
                    <button
                      type="button"
                      data-v="fail"
                      aria-pressed={isFail}
                      disabled={isReadOnly}
                      onClick={() => !isReadOnly && handleGateToggle(gate.gate, 'FAIL')}
                    >
                      Breach
                    </button>
                    <button
                      type="button"
                      data-v="not_applicable"
                      aria-pressed={isNA}
                      disabled={isReadOnly}
                      onClick={() => !isReadOnly && handleGateToggle(gate.gate, 'NA')}
                    >
                      NA
                    </button>
                  </div>

                  {/* Detail only shown on breach */}
                  {isFail && (
                    isReadOnly ? (
                      <div className="eval-gate-extra eval-reason" style={{ marginTop: 8, padding: '10px 14px', lineHeight: 1.6 }}>
                        <strong>Reason: </strong>{gate.reason}
                      </div>
                    ) : (
                      <div className="eval-gate-extra" style={{ gridColumn: '1 / -1', marginTop: 10 }}>
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
                          value={gate.reason || ''}
                          onChange={(e) => handleGateReasonChange(gate.gate, e.target.value)}
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

          {/* 3. 7 EVALUATION PARAMETERS ACCORDION */}
          <div className="bg-white dark:bg-slate-800/90 border border-slate-200 dark:border-slate-700 rounded-xl p-4 shadow-xs space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                Email Quality Parameters (7)
              </span>
              <span className="text-xs font-semibold text-slate-500">
                {isEditing ? 'Editing Mode · Click to change scores' : '100% Total Weight'}
              </span>
            </div>

            <div className="space-y-2">
              {paramEntries.map(([key, param]) => {
                const isExpanded = Boolean(expandedParams[key]);
                return (
                  <div
                    key={key}
                    className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden transition-all"
                  >
                    <div
                      onClick={() => toggleParam(key)}
                      className="px-3 py-2 bg-slate-50 dark:bg-slate-800/70 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-between gap-2 cursor-pointer"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate">
                          {param.name}
                        </span>
                        <span className="text-[10px] text-slate-400 shrink-0">({param.weight}%)</span>
                      </div>

                      {isEditing ? (
                        <div
                          className="flex items-center gap-1 shrink-0"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {(['yes', 'half', 'no', 'na'] as const).map((opt) => (
                            <button
                              key={opt}
                              type="button"
                              onClick={() => handleParamScoreChange(key, opt)}
                              className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase cursor-pointer border transition-colors ${
                                param.score === opt
                                  ? opt === 'yes'
                                    ? 'bg-emerald-600 text-white border-emerald-600'
                                    : opt === 'half'
                                      ? 'bg-amber-500 text-white border-amber-500'
                                      : opt === 'no'
                                        ? 'bg-rose-600 text-white border-rose-600'
                                        : 'bg-zinc-700 text-white border-zinc-700'
                                  : 'bg-white dark:bg-slate-900 text-slate-500 border-slate-200 dark:border-slate-700 hover:bg-slate-100'
                              }`}
                            >
                              {opt}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 shrink-0">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              param.score === 'yes'
                                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                                : param.score === 'half'
                                ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                                : param.score === 'no'
                                ? 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300'
                                : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                            }`}
                          >
                            {param.score === 'na'
                              ? 'NA'
                              : `${param.score.toUpperCase()} (${param.earnedScore}/${param.maxScore})`}
                          </span>
                          <span className="text-xs text-slate-400">{isExpanded ? '▲' : '▼'}</span>
                        </div>
                      )}
                    </div>

                    {isExpanded && (
                      <div className="p-3 bg-white dark:bg-slate-900 text-xs space-y-2 border-t border-slate-100 dark:border-slate-800">
                        <div className="text-slate-700 dark:text-slate-300 leading-relaxed">
                          <strong className="text-slate-900 dark:text-white">Reasoning: </strong>
                          {param.reasoning}
                        </div>
                        {param.quote && (
                          <div className="p-2 rounded bg-slate-50 dark:bg-slate-800 border-l-2 border-emerald-500 text-[11px] text-slate-600 dark:text-slate-300 italic">
                            "{param.quote}"
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Inline Save Bar while Editing */}
            {isEditing && (
              <div className="pt-3 mt-3 border-t border-slate-200 dark:border-slate-700 space-y-2.5">
                <textarea
                  value={overrideNotes}
                  onChange={(e) => setOverrideNotes(e.target.value)}
                  rows={2}
                  placeholder="Add TL evaluation note or rationale for edits (optional)..."
                  className="w-full text-xs p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:border-slate-500"
                />
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={handleCancelEdit}
                    className="px-3 py-1.5 rounded-md text-xs font-medium bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveEvaluation}
                    disabled={overrideSubmitting}
                    className="px-4 py-1.5 rounded-md text-xs font-semibold bg-zinc-900 hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 text-white disabled:opacity-60 cursor-pointer transition-colors"
                  >
                    {overrideSubmitting ? 'Saving…' : 'Save Evaluation'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  if (colSpan) {
    return (
      <tr>
        <td colSpan={colSpan} className="p-0 border-b border-slate-200 dark:border-slate-800">
          {panelContent}
        </td>
      </tr>
    );
  }

  return panelContent;
}
