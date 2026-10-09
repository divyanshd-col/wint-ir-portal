'use client';

import React, { useState, useEffect } from 'react';

/**
 * Strips HTML tags and decodes common HTML entities for plain-text previews and snippets.
 */
export function stripHtml(raw?: string | null): string {
  if (!raw) return '';
  return raw
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*[\/]?>/gi, ' ')
    .replace(/<\/p>/gi, ' ')
    .replace(/<\/div>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Checks if a string looks like HTML content.
 */
export function isHtml(str?: string | null): boolean {
  if (!str) return false;
  return /<\/?[a-z][\s\S]*>/i.test(str);
}

/**
 * Extracts a concise 1-2 sentence query summary from a raw customer email message
 * by stripping salutations, quotation headers, and boilerplate.
 */
export function extractConciseQuery(raw?: string | null, fallbackSubject?: string): string {
  if (!raw) return fallbackSubject || 'Customer inquiry';
  const plain = stripHtml(raw);
  // Remove common reply / forward patterns
  const cleaned = plain
    .replace(/^-+ Forwarded message -+[\s\S]*/i, '')
    .replace(/On .*?wrote:[\s\S]*/i, '')
    .replace(/^(dear|hi|hello|hey|good morning|good afternoon)\s+[\w\s,.-]+/i, '')
    .trim();

  if (!cleaned) return fallbackSubject || 'Customer inquiry';
  // Take first 2 sentences or first 160 chars
  const sentences = cleaned.split(/(?<=[.?!])\s+/);
  const snippet = sentences.slice(0, 2).join(' ');
  return snippet.length > 200 ? snippet.slice(0, 197) + '…' : snippet;
}

/**
 * Client-safe sanitizer for email HTML content.
 */
export function sanitizeEmailHtml(html?: string | null): string {
  if (!html) return '';
  let clean = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
    .replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, '')
    .replace(/<embed\b[^<]*(?:(?!<\/embed>)<[^<]*)*<\/embed>/gi, '')
    .replace(/on\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/href\s*=\s*["']javascript:[^"']*["']/gi, 'href="#"');

  clean = clean.replace(/<a\s+(?:[^>]*?\s+)?href="([^"]*)"/gi, (match, href) => {
    return `<a href="${href}" target="_blank" rel="noopener noreferrer"`;
  });

  return clean;
}

interface EmailMessageViewProps {
  content?: string | null;
  fallback?: string;
  style?: React.CSSProperties;
  className?: string;
}

/**
 * Safely renders email content:
 * - If HTML is detected, renders clean formatted HTML with .email-html-body styling.
 * - If plain text, renders with whiteSpace: pre-wrap.
 */
export default function EmailMessageView({
  content,
  fallback = 'No content available.',
  style,
  className = '',
}: EmailMessageViewProps) {
  const text = content?.trim() || '';

  if (!text) {
    return (
      <div style={{ color: 'var(--qa-text-3, #A1A1AA)', fontStyle: 'italic', fontSize: 13, ...style }}>
        {fallback}
      </div>
    );
  }

  if (isHtml(text)) {
    const sanitized = sanitizeEmailHtml(text);
    return (
      <div
        className={`email-html-body ${className}`}
        style={style}
        dangerouslySetInnerHTML={{ __html: sanitized }}
      />
    );
  }

  return (
    <div
      className={className}
      style={{
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        ...style,
      }}
    >
      {text}
    </div>
  );
}

// ─── Customer Query / Context Summary Block ───────────────────────────────────

export interface CustomerSummaryBlockProps {
  threadSummary?: any;
  customerMessage?: string | null;
  subjectLine?: string | null;
  style?: React.CSSProperties;
}

/**
 * Displays ONLY the customer context / query summary:
 * - Structured 4-point summary if thread_summary is provided
 * - Or clean extracted core inquiry
 * - With a collapsible link to view full raw message if needed
 */
export function CustomerSummaryBlock({
  threadSummary,
  customerMessage,
  subjectLine,
  style,
}: CustomerSummaryBlockProps) {
  const [showFullEmail, setShowFullEmail] = useState(false);

  // Parse structured thread summary if present
  let summaryObj: any = null;
  if (typeof threadSummary === 'string') {
    try {
      summaryObj = JSON.parse(threadSummary);
    } catch {
      summaryObj = { core_query: threadSummary };
    }
  } else if (typeof threadSummary === 'object' && threadSummary !== null) {
    summaryObj = threadSummary;
  }

  const hasStructured = summaryObj && (
    summaryObj.core_query ||
    summaryObj.actions_taken ||
    summaryObj.pending_action ||
    summaryObj.commitments_set
  );

  const fallbackSummary = !hasStructured
    ? extractConciseQuery(customerMessage, subjectLine || 'Customer inquiry')
    : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, ...style }}>
      {/* Summary View */}
      {hasStructured ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {summaryObj.core_query && (
            <div style={{ display: 'flex', gap: 6, fontSize: 13, lineHeight: 1.5 }}>
              <span style={{ fontWeight: 600, color: 'var(--qa-text, #111111)', minWidth: 140, flexShrink: 0 }}>
                Core Query:
              </span>
              <span style={{ color: 'var(--qa-text, #111111)' }}>
                {summaryObj.core_query}
              </span>
            </div>
          )}

          {summaryObj.actions_taken && (
            <div style={{ display: 'flex', gap: 6, fontSize: 13, lineHeight: 1.5 }}>
              <span style={{ fontWeight: 600, color: 'var(--qa-text-2, #6B6B6B)', minWidth: 140, flexShrink: 0 }}>
                Actions Taken:
              </span>
              <span style={{ color: 'var(--qa-text-2, #6B6B6B)' }}>
                {summaryObj.actions_taken}
              </span>
            </div>
          )}

          {summaryObj.pending_action && (
            <div style={{ display: 'flex', gap: 6, fontSize: 13, lineHeight: 1.5 }}>
              <span style={{ fontWeight: 600, color: 'var(--qa-text-2, #6B6B6B)', minWidth: 140, flexShrink: 0 }}>
                Pending Action:
              </span>
              <span style={{ color: 'var(--qa-text-2, #6B6B6B)' }}>
                {summaryObj.pending_action}
              </span>
            </div>
          )}

          {summaryObj.commitments_set && (
            <div style={{ display: 'flex', gap: 6, fontSize: 13, lineHeight: 1.5 }}>
              <span style={{ fontWeight: 600, color: 'var(--qa-text-2, #6B6B6B)', minWidth: 140, flexShrink: 0 }}>
                Commitments Set:
              </span>
              <span style={{ color: 'var(--qa-text-2, #6B6B6B)' }}>
                {summaryObj.commitments_set}
              </span>
            </div>
          )}
        </div>
      ) : (
        <div style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--qa-text, #111111)' }}>
          <span style={{ fontWeight: 600, color: 'var(--qa-text, #111111)', marginRight: 6 }}>
            Core Query:
          </span>
          {fallbackSummary}
        </div>
      )}

      {/* Collapsible toggle to view full raw email if required */}
      {customerMessage && (
        <div style={{ paddingTop: 4, borderTop: '1px solid var(--qa-border-sub, #F0F0F2)' }}>
          <button
            type="button"
            onClick={() => setShowFullEmail(v => !v)}
            style={{
              background: 'transparent',
              border: 'none',
              padding: 0,
              fontSize: 11,
              fontWeight: 500,
              color: 'var(--accent, #2d9e4f)',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            {showFullEmail ? '▲ Hide Full Customer Email' : '▼ View Full Customer Email'}
          </button>

          {showFullEmail && (
            <div style={{
              marginTop: 8,
              padding: '10px 12px',
              borderRadius: 6,
              background: 'var(--qa-fill-light, #F4F4F5)',
              maxHeight: 200,
              overflowY: 'auto',
            }}>
              <EmailMessageView
                content={customerMessage}
                fallback="No additional message body."
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Customer History Panel Component ─────────────────────────────────────────

export interface HistoryEntry {
  id: string;
  chatId: string;
  channel: 'email' | 'chat';
  date: string;
  agentName: string;
  subject: string;
  disposition: string;
  subDisposition?: string;
  iqs: number | null;
  status: string;
  csat?: string;
}

export interface EmailHistoryPanelProps {
  customerEmail?: string | null;
  chatId?: string | null;
  ticketId?: string | null;
  onClose?: () => void;
}

export function EmailHistoryPanel({
  customerEmail,
  chatId,
  ticketId,
  onClose,
}: EmailHistoryPanelProps) {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    setLoading(true);

    const params = new URLSearchParams();
    if (customerEmail) params.set('customerEmail', customerEmail);
    if (chatId) params.set('chatId', chatId);
    if (ticketId) params.set('ticketId', ticketId);

    fetch(`/api/quality/history?${params.toString()}`)
      .then(res => res.json())
      .then(data => {
        if (!mounted) return;
        setHistory(data.history || []);
      })
      .catch(() => {
        if (!mounted) return;
        setHistory([]);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [customerEmail, chatId, ticketId]);

  return (
    <div
      style={{
        background: 'var(--qa-card, #FFFFFF)',
        border: '1px solid var(--qa-border, #E4E4E7)',
        borderRadius: 8,
        overflow: 'hidden',
        marginBottom: 14,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 14px',
          background: 'var(--qa-gray-50, #FAFAFB)',
          borderBottom: '1px solid var(--qa-border, #E4E4E7)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--qa-text-2, #6B6B6B)' }}>
            Customer History ({history.length} interaction{history.length === 1 ? '' : 's'})
          </span>
          {customerEmail && (
            <span style={{ fontSize: 11, color: 'var(--qa-text-3, #A1A1AA)' }}>
              · {customerEmail}
            </span>
          )}
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              fontSize: 14,
              color: 'var(--qa-text-3, #A1A1AA)',
              padding: '2px 6px',
            }}
          >
            ✕
          </button>
        )}
      </div>

      <div style={{ maxHeight: 220, overflowY: 'auto' }}>
        {loading ? (
          <div style={{ padding: '16px', textAlign: 'center', fontSize: 12, color: 'var(--qa-text-3, #A1A1AA)' }}>
            Loading previous customer interactions…
          </div>
        ) : history.length === 0 ? (
          <div style={{ padding: '16px', textAlign: 'center', fontSize: 12, color: 'var(--qa-text-3, #A1A1AA)' }}>
            No prior conversation history found for this customer.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: 'var(--qa-gray-50, #FAFAFB)', borderBottom: '1px solid var(--qa-border-sub, #F0F0F2)' }}>
                {['Date', 'Channel', 'ID', 'Agent', 'Subject / Disposition', 'IQS', 'Status / CSAT'].map(h => (
                  <th
                    key={h}
                    style={{
                      padding: '6px 12px',
                      textAlign: 'left',
                      color: 'var(--qa-text-3, #A1A1AA)',
                      fontWeight: 500,
                      fontSize: 10,
                      textTransform: 'uppercase',
                      letterSpacing: '0.06em',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {history.map((h, i) => (
                <tr
                  key={`${h.id}_${i}`}
                  style={{
                    borderBottom: '1px solid var(--qa-border-sub, #F0F0F2)',
                    background: i % 2 === 0 ? 'transparent' : 'var(--qa-fill-light, #FAFAFB)',
                  }}
                >
                  <td style={{ padding: '7px 12px', color: 'var(--qa-text-2, #6B6B6B)', whiteSpace: 'nowrap' }}>
                    {h.date || '—'}
                  </td>
                  <td style={{ padding: '7px 12px', whiteSpace: 'nowrap' }}>
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 600,
                        padding: '1px 6px',
                        borderRadius: 4,
                        textTransform: 'uppercase',
                        background: h.channel === 'email' ? '#eff6ff' : '#f0fdf4',
                        color: h.channel === 'email' ? '#1d4ed8' : '#15803d',
                        border: `1px solid ${h.channel === 'email' ? '#bfdbfe' : '#bbf7d0'}`,
                      }}
                    >
                      {h.channel}
                    </span>
                  </td>
                  <td style={{ padding: '7px 12px', fontFamily: 'ui-monospace, monospace', fontSize: 11 }}>
                    {h.chatId && /^\d+$/.test(h.chatId.trim()) ? (
                      <a
                        href={`https://app.robylon.ai/unified-inbox/share/${h.chatId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: '#2563eb', textDecoration: 'underline' }}
                      >
                        {h.chatId}
                      </a>
                    ) : (
                      <span>{(h.chatId || h.id).slice(0, 8)}…</span>
                    )}
                  </td>
                  <td style={{ padding: '7px 12px', color: 'var(--qa-text, #111111)', fontWeight: 500, whiteSpace: 'nowrap' }}>
                    {h.agentName}
                  </td>
                  <td style={{ padding: '7px 12px', color: 'var(--qa-text-2, #6B6B6B)', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {h.subject || h.disposition || 'Support Ticket'}
                  </td>
                  <td style={{ padding: '7px 12px' }}>
                    {h.iqs != null ? (
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          minWidth: 32,
                          height: 20,
                          borderRadius: 4,
                          fontSize: 11,
                          fontWeight: 600,
                          fontFamily: 'ui-monospace, monospace',
                          background: h.iqs >= 85 ? '#f0fdf4' : h.iqs >= 70 ? '#fefce8' : '#fef2f2',
                          color: h.iqs >= 85 ? '#166534' : h.iqs >= 70 ? '#854d0e' : '#991b1b',
                          border: `1px solid ${h.iqs >= 85 ? '#bbf7d0' : h.iqs >= 70 ? '#fef08a' : '#fecaca'}`,
                        }}
                      >
                        {h.iqs}
                      </span>
                    ) : (
                      <span style={{ color: 'var(--qa-text-3, #A1A1AA)' }}>—</span>
                    )}
                  </td>
                  <td style={{ padding: '7px 12px', whiteSpace: 'nowrap', color: 'var(--qa-text-2, #6B6B6B)' }}>
                    {h.status || h.csat || 'Completed'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ── Score Ring Component (Matching EvalPanel & IRScorePanel in Quality Chats) ───
export function ScoreRing({ score }: { score: number | null | undefined }) {
  if (score == null) {
    return (
      <svg width="56" height="56" viewBox="0 0 64 64" style={{ flexShrink: 0 }}>
        <circle cx="32" cy="32" r="27" fill="none" stroke="var(--qa-fill-med, #E4E4E7)" strokeWidth="5" />
        <text x="32" y="33" textAnchor="middle" dominantBaseline="central"
          fontSize="13" fontWeight="700" fill="var(--qa-text-3, #71717A)" fontFamily="inherit">
          NIL
        </text>
      </svg>
    );
  }
  const val = Math.max(0, Math.min(100, Math.round(Number(score))));
  const RING_C = 169.6;
  const offset = ((100 - val) / 100 * RING_C).toFixed(1);
  return (
    <svg width="56" height="56" viewBox="0 0 64 64" style={{ flexShrink: 0 }}>
      <circle cx="32" cy="32" r="27" fill="none" stroke="var(--qa-fill-med, #E4E4E7)" strokeWidth="5" />
      <circle cx="32" cy="32" r="27" fill="none" stroke="var(--qa-gray-700, #27272a)" strokeWidth="5"
        strokeLinecap="round" strokeDasharray="169.6" strokeDashoffset={offset}
        transform="rotate(-90 32 32)" style={{ transition: 'stroke-dashoffset 0.3s' }} />
      <text x="32" y="33" textAnchor="middle" dominantBaseline="central"
        fontSize="17" fontWeight="700" fill="var(--qa-text, #09090b)" fontFamily="inherit">
        {val}
      </text>
    </svg>
  );
}

export function normalizeParamScore(val: any): 'yes' | 'partial' | 'no' | 'na' {
  if (val === null || val === undefined || val === '') return 'na';
  const s = String(val).toLowerCase().trim();
  if (s === 'yes' || s === 'true' || s === '1' || s === '1.0' || s === 'pass') return 'yes';
  if (s === 'partial' || s === 'half' || s === '0.5' || s === 'part') return 'partial';
  if (s === 'no' || s === 'false' || s === '0' || s === '0.0' || s === 'fail') return 'no';
  if (typeof val === 'number') {
    if (val >= 80) return 'yes';
    if (val >= 40) return 'partial';
    return 'no';
  }
  return 'na';
}

const EMAIL_PARAM_METADATA: Record<string, { name: string; description: string; weight: number }> = {
  accuracy: {
    name: 'Accuracy & Financial Correctness',
    description: 'Factual accuracy regarding bonds, yields, TDS, maturity dates, and account details.',
    weight: 20,
  },
  completeness: {
    name: 'Completeness',
    description: 'Addressing all customer queries, explicit questions, and implicit requests.',
    weight: 20,
  },
  clarity: {
    name: 'Clarity & Structure',
    description: 'Concise, well-organized explanation without jargon or ambiguous phrasing.',
    weight: 15,
  },
  tone: {
    name: 'Tone & Empathy',
    description: 'Courteous, empathetic, and professional language adhering to brand standards.',
    weight: 15,
  },
  process_adherence: {
    name: 'Process & SOP Adherence',
    description: 'Following company workflows, identity checks, and escalation paths.',
    weight: 15,
  },
  expectation_setting: {
    name: 'Expectation Setting & SLA',
    description: 'Communicating explicit, realistic resolution timelines and commitments.',
    weight: 15,
  },
};

export interface EmailEvaluationFeedbackPanelProps {
  qualityScore?: number | null;
  effectiveScore?: number | null;
  qaOverrideScore?: number | null;
  compliancePassed?: boolean | null;
  complianceIssues?: string[] | null;
  qaNotes?: string | null;
  parameterScores?: Record<string, any> | null;
  disputeStatus?: string | null;
}

/**
 * Renders Evaluation Feedback & Parameters matching the design, tokens,
 * and components used in Quality Chats (ScoreRing, parameter pill badges, and feedback box).
 */
export function EmailEvaluationFeedbackPanel({
  qualityScore,
  effectiveScore,
  qaOverrideScore,
  compliancePassed,
  complianceIssues,
  qaNotes,
  parameterScores,
  disputeStatus,
}: EmailEvaluationFeedbackPanelProps) {
  const displayScore = effectiveScore ?? qualityScore ?? null;

  // Build normalized parameters list
  const rawParams = parameterScores || {};
  const standardKeys = [
    'accuracy',
    'completeness',
    'clarity',
    'tone',
    'process_adherence',
    'expectation_setting',
  ];

  // Map known parameters
  const paramList = standardKeys.map(key => {
    const meta = EMAIL_PARAM_METADATA[key] || {
      name: key.replace(/_/g, ' '),
      description: '',
      weight: 15,
    };
    // Match against rawParams (case-insensitive & snake/camelCase)
    let rawVal = rawParams[key];
    if (rawVal === undefined) {
      const camel = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
      rawVal = rawParams[camel];
    }
    if (rawVal === undefined) {
      const foundKey = Object.keys(rawParams).find(
        k => k.toLowerCase().replace(/_/g, '') === key.toLowerCase().replace(/_/g, '')
      );
      if (foundKey) rawVal = rawParams[foundKey];
    }

    return {
      key,
      name: meta.name,
      description: meta.description,
      weight: meta.weight,
      score: rawVal,
    };
  });

  // Check for any extra custom parameters that weren't in standardKeys
  Object.keys(rawParams).forEach(k => {
    const normK = k.toLowerCase().replace(/_/g, '');
    const alreadyMapped = standardKeys.some(sk => sk.toLowerCase().replace(/_/g, '') === normK);
    if (!alreadyMapped && !k.startsWith('__')) {
      paramList.push({
        key: k,
        name: k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
        description: '',
        weight: 0,
        score: rawParams[k],
      });
    }
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* ── 1. Score Summary & Compliance Card ── */}
      <div
        style={{
          background: 'var(--qa-card, #FFFFFF)',
          border: '1px solid var(--qa-border, #E4E4E7)',
          borderRadius: 8,
          padding: '14px 18px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <ScoreRing score={displayScore} />
          <div>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--qa-text-3, #71717A)', fontWeight: 600 }}>
              IQS Score
            </div>
            <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--qa-text, #111111)', marginTop: 2, fontFamily: 'ui-monospace, monospace' }}>
              {displayScore != null ? `${Math.round(displayScore)}%` : 'Pending'}
            </div>
            {qaOverrideScore != null && qualityScore != null && (
              <div style={{ fontSize: 11, color: '#6b21a8', fontWeight: 600, marginTop: 2 }}>
                QA Adjusted from {qualityScore}%
              </div>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {disputeStatus && disputeStatus !== 'None' && (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                padding: '3px 8px',
                borderRadius: 4,
                fontSize: 11,
                fontWeight: 600,
                background: '#fef3c7',
                color: '#92400e',
                border: '1px solid #fde68a',
                whiteSpace: 'nowrap',
              }}
            >
              Dispute: {disputeStatus}
            </span>
          )}

          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--qa-text-3, #71717A)', fontWeight: 600, marginBottom: 4 }}>
              Compliance
            </div>
            {compliancePassed === false ? (
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  padding: '3px 8px',
                  borderRadius: 4,
                  background: '#fee2e2',
                  color: '#b91c1c',
                  border: '1px solid #fca5a5',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                ⚠️ Non-Compliant
              </span>
            ) : compliancePassed === true ? (
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  padding: '3px 8px',
                  borderRadius: 4,
                  background: '#dcfce7',
                  color: '#15803d',
                  border: '1px solid #86efac',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                ✓ Compliant
              </span>
            ) : (
              <span style={{ fontSize: 12, color: 'var(--qa-text-3, #71717A)' }}>Pending Eval</span>
            )}
          </div>
        </div>
      </div>

      {/* ── 2. Compliance Breaches Banner (if any) ── */}
      {complianceIssues && complianceIssues.length > 0 && (
        <div
          style={{
            background: '#fff1f2',
            border: '1px solid #fecdd3',
            borderRadius: 8,
            padding: '10px 14px',
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 700, color: '#9f1239', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            ⚠️ Compliance Breaches ({complianceIssues.length})
          </div>
          <ul style={{ margin: '6px 0 0 16px', padding: 0, fontSize: 12, color: '#881337', lineHeight: 1.5 }}>
            {complianceIssues.map((issue, idx) => (
              <li key={idx}>{issue}</li>
            ))}
          </ul>
        </div>
      )}

      {/* ── 3. Evaluator Feedback & Remarks ── */}
      <div>
        <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--qa-text-3, #71717A)', marginBottom: 6 }}>
          Evaluator Feedback &amp; Remarks
        </div>
        <div
          style={{
            background: 'var(--qa-card, #FFFFFF)',
            border: '1px solid var(--qa-border, #E4E4E7)',
            borderRadius: 8,
            padding: '12px 16px',
            fontSize: 13,
            lineHeight: 1.6,
            color: 'var(--qa-text, #111111)',
          }}
        >
          {qaNotes ? (
            qaNotes
          ) : (
            <span style={{ color: 'var(--qa-text-3, #71717A)', fontStyle: 'italic', fontSize: 12 }}>
              No specific evaluator notes provided.
            </span>
          )}
        </div>
      </div>

      {/* ── 4. Parameter Scores Card (Quality Chats Styling & Colors) ── */}
      <div>
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            color: 'var(--qa-text-3, #71717A)',
            marginBottom: 6,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span>Parameter Scores ({paramList.length})</span>
          <span style={{ fontSize: 10, fontWeight: 500, color: 'var(--qa-text-3, #71717A)' }}>IQS Breakdown</span>
        </div>

        <div
          style={{
            border: '1px solid var(--qa-border, #E4E4E7)',
            borderRadius: 8,
            background: 'var(--qa-card, #FFFFFF)',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              padding: '8px 16px',
              background: 'var(--qa-gray-50, #F9FAFB)',
              borderBottom: '1px solid var(--qa-border, #E4E4E7)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              fontSize: 11,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              color: 'var(--qa-text-3, #71717A)',
            }}
          >
            <span>Parameter</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
              <span>Evaluation</span>
              <span style={{ minWidth: 32, textAlign: 'right' }}>Weight</span>
            </div>
          </div>

          {paramList.map((param, idx) => {
            const isLast = idx === paramList.length - 1;
            const norm = normalizeParamScore(param.score);
            return (
              <div
                key={param.key}
                style={{
                  padding: '11px 16px',
                  borderBottom: isLast ? 'none' : '1px solid var(--qa-border-sub, #F4F4F5)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--qa-text, #111111)' }}>
                    {param.name}
                  </div>
                  {param.description && (
                    <div style={{ fontSize: 11, color: 'var(--qa-text-3, #71717A)', marginTop: 2, lineHeight: 1.3 }}>
                      {param.description}
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexShrink: 0 }}>
                  {/* Segmented Pill Group matching IRScorePanel & EvalPanel from Quality Chats */}
                  <div style={{ display: 'flex', gap: 4 }}>
                    {(['yes', 'partial', 'no'] as const).map(opt => {
                      const isSel = norm === opt;
                      const label = opt === 'yes' ? 'Yes' : opt === 'partial' ? 'Partial' : 'No';

                      let bg = 'var(--qa-card, #FFFFFF)';
                      let color = 'var(--qa-text-3, #A1A1AA)';
                      let border = '1px solid var(--qa-border-sub, #F4F4F5)';

                      if (isSel) {
                        if (opt === 'yes') {
                          bg = '#DCFCE7';
                          color = '#15803D';
                          border = '1px solid #86EFAC';
                        } else if (opt === 'partial') {
                          bg = '#FEF3C7';
                          color = '#B45309';
                          border = '1px solid #FDE68A';
                        } else if (opt === 'no') {
                          bg = '#FEE2E2';
                          color = '#B91C1C';
                          border = '1px solid #FCA5A5';
                        }
                      }

                      return (
                        <span
                          key={opt}
                          style={{
                            height: 25,
                            padding: '0 8px',
                            borderRadius: 6,
                            border,
                            background: bg,
                            color,
                            fontSize: 11,
                            fontWeight: isSel ? 700 : 400,
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontFamily: 'inherit',
                          }}
                        >
                          {isSel && (opt === 'yes' ? '✓ ' : opt === 'partial' ? '½ ' : '✗ ')}
                          {label}
                        </span>
                      );
                    })}
                  </div>

                  <span
                    style={{
                      fontSize: 11,
                      color: 'var(--qa-text-3, #71717A)',
                      fontFamily: 'ui-monospace, monospace',
                      minWidth: 32,
                      textAlign: 'right',
                    }}
                  >
                    {param.weight > 0 ? `${param.weight}%` : '—'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
