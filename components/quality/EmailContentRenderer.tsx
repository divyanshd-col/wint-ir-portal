'use client';

import React, { useState, useEffect } from 'react';
import { trimEmailBody } from '@/lib/email/ui';

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
  let text = stripHtml(raw);

  // 1. Remove device signatures / footers
  text = text.replace(/sent from my (iphone|ipad|android|galaxy|mobile)[\s.,-]*/gi, '');

  // 2. Remove forwarded headers blocks (e.g. 'Begin forwarded message:', 'From: ...', etc.)
  text = text.replace(/begin forwarded message:[\s\S]*?(?=(dear|hi|hello|\b[a-z0-9]))/gi, '');
  text = text.replace(/-+\s*forwarded message\s*-+[\s\S]*?(?=(dear|hi|hello|\b[a-z0-9]))/gi, '');
  text = text.replace(/^[> ]*(from|to|date|subject|cc):[^\n\r]+/gim, '');
  text = text.replace(/on\s+.+?wrote:[\s\S]*/i, '');

  // 3. Remove leading greetings / salutations
  text = text.replace(/^\s*(dear\s+[a-z0-9\s]{1,30}|hi\s*[a-z0-9\s]{0,20}|hello\s*[a-z0-9\s]{0,20}|hey\s*[a-z0-9\s]{0,20}|good\s+(morning|afternoon|evening)\s*[a-z0-9\s]{0,20})[,.!:-]*/i, '');

  // Normalize whitespace and trim leftover leading punctuation
  const cleaned = text.replace(/\s+/g, ' ').replace(/^[.,:;!?\s-]+/, '').trim();

  if (!cleaned) return fallbackSubject || 'Customer inquiry';
  // Take first 2 sentences or first 200 chars
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
  const text = trimEmailBody(content);

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

export interface CustomerCoreQueryCardProps {
  threadSummary?: any;
  customerMessage?: string | null;
  subjectLine?: string | null;
  customerEmail?: string | null;
  parameterScores?: any;
  showHeader?: boolean;
  style?: React.CSSProperties;
}

/**
 * Dedicated, prominent card for the customer's core query / intent.
 * Clearly separated from the raw email thread with generous spacing and high readability.
 */
export function CustomerCoreQueryCard({
  threadSummary,
  customerMessage,
  subjectLine,
  customerEmail,
  parameterScores,
  showHeader = true,
  style,
}: CustomerCoreQueryCardProps) {
  // Parse structured thread summary if present
  let summaryObj: any = null;
  if (typeof threadSummary === 'string') {
    try {
      summaryObj = JSON.parse(threadSummary);
    } catch {
      summaryObj = { core_query: threadSummary };
    }
  } else if (typeof threadSummary === 'object' && threadSummary !== null) {
    summaryObj = { ...threadSummary };
  }

  // Check synthesized core_query from thread_summary or parameterScores
  const synthesizedCore = summaryObj?.core_query || parameterScores?.core_query;
  const isAiSynthesized = Boolean(synthesizedCore && String(synthesizedCore).trim());
  const coreQueryText = (
    synthesizedCore ||
    extractConciseQuery(customerMessage, subjectLine || 'Customer inquiry')
  )?.trim();

  const actionsTaken = summaryObj?.actions_taken?.trim();
  const pendingAction = summaryObj?.pending_action?.trim();
  const commitmentsSet = summaryObj?.commitments_set?.trim();
  const hasThreadContext = Boolean(actionsTaken || pendingAction || commitmentsSet);

  const displaySubject = subjectLine && subjectLine !== 'Email Support Request' ? subjectLine : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, ...style }}>
      {showHeader && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{
              fontSize: 11,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              color: 'var(--qa-text-3, #71717A)',
            }}>
              Customer Core Query
            </span>
            <span style={{
              fontSize: 10,
              fontWeight: 600,
              padding: '1px 7px',
              borderRadius: 4,
              background: isAiSynthesized ? '#eff6ff' : 'var(--qa-fill-light, #F4F4F5)',
              color: isAiSynthesized ? '#1d4ed8' : 'var(--qa-text-2, #6B6B6B)',
              border: isAiSynthesized ? '1px solid #bfdbfe' : '1px solid var(--qa-border, #E4E4E7)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 3,
            }}>
              {isAiSynthesized ? 'AI Synthesized' : 'Customer Intent'}
            </span>
            {customerEmail && (
              <span
                title={`User Email: ${customerEmail}`}
                style={{
                  fontSize: 11,
                  color: '#1d4ed8',
                  background: '#eff6ff',
                  border: '1px solid #bfdbfe',
                  padding: '1px 7px',
                  borderRadius: 4,
                  fontWeight: 500,
                  fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                  <polyline points="22,6 12,13 2,6" />
                </svg>
                {customerEmail}
              </span>
            )}
          </div>

          {displaySubject && (
            <span
              title={displaySubject}
              style={{
                fontSize: 11,
                color: 'var(--qa-text-2, #6B6B6B)',
                maxWidth: 320,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                fontStyle: 'italic',
              }}
            >
              Subject: {displaySubject}
            </span>
          )}
        </div>
      )}

      {/* Prominent Core Query Card */}
      <div style={{
        background: 'var(--qa-card, #FFFFFF)',
        border: '1px solid var(--qa-border, #E4E4E7)',
        borderLeft: '4px solid #2563EB',
        borderRadius: 8,
        padding: '14px 18px',
        boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
      }}>
        <div style={{
          fontSize: 13.5,
          lineHeight: 1.6,
          color: 'var(--qa-text, #111111)',
          fontWeight: 500,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}>
          {coreQueryText || (
            <span style={{ fontStyle: 'italic', color: 'var(--qa-text-3, #A1A1AA)' }}>
              No customer query recorded.
            </span>
          )}
        </div>

        {hasThreadContext && (
          <div style={{
            marginTop: 12,
            paddingTop: 10,
            borderTop: '1px solid var(--qa-border-sub, #F0F0F2)',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}>
            {actionsTaken && (
              <div style={{ display: 'flex', gap: 8, fontSize: 12, lineHeight: 1.5 }}>
                <span style={{ fontWeight: 600, color: 'var(--qa-text-2, #6B6B6B)', minWidth: 125, flexShrink: 0 }}>
                  Actions Taken:
                </span>
                <span style={{ color: 'var(--qa-text-2, #6B6B6B)' }}>{actionsTaken}</span>
              </div>
            )}
            {pendingAction && (
              <div style={{ display: 'flex', gap: 8, fontSize: 12, lineHeight: 1.5 }}>
                <span style={{ fontWeight: 600, color: 'var(--qa-text-2, #6B6B6B)', minWidth: 125, flexShrink: 0 }}>
                  Pending Action:
                </span>
                <span style={{ color: 'var(--qa-text-2, #6B6B6B)' }}>{pendingAction}</span>
              </div>
            )}
            {commitmentsSet && (
              <div style={{ display: 'flex', gap: 8, fontSize: 12, lineHeight: 1.5 }}>
                <span style={{ fontWeight: 600, color: 'var(--qa-text-2, #6B6B6B)', minWidth: 125, flexShrink: 0 }}>
                  Commitments Set:
                </span>
                <span style={{ color: 'var(--qa-text-2, #6B6B6B)' }}>{commitmentsSet}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export interface CustomerEmailThreadCardProps {
  customerMessage?: string | null;
  subjectLine?: string | null;
  customerEmail?: string | null;
  defaultExpanded?: boolean;
  style?: React.CSSProperties;
}

/**
 * Dedicated card for the inbound customer email / thread.
 * Separated cleanly from the core query so reviewers can view the raw email thread
 * with scrollable or collapsible view without cluttering the synthesized intent.
 */
export function CustomerEmailThreadCard({
  customerMessage,
  subjectLine,
  customerEmail,
  defaultExpanded = true,
  style,
}: CustomerEmailThreadCardProps) {
  const [isExpanded, setIsExpanded] = useState<boolean>(defaultExpanded);

  if (!customerMessage) {
    return (
      <div style={{
        background: 'var(--qa-card, #FFFFFF)',
        border: '1px solid var(--qa-border, #E4E4E7)',
        borderRadius: 8,
        padding: '12px 16px',
        color: 'var(--qa-text-3, #71717A)',
        fontSize: 12,
        fontStyle: 'italic',
        ...style,
      }}>
        No inbound email message recorded.
      </div>
    );
  }

  return (
    <div style={{
      background: 'var(--qa-card, #FFFFFF)',
      border: '1px solid var(--qa-border, #E4E4E7)',
      borderRadius: 8,
      overflow: 'hidden',
      boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
      ...style,
    }}>
      {/* Thread subheader / controls */}
      <div style={{
        padding: '8px 14px',
        background: 'var(--qa-gray-50, #FAFAFB)',
        borderBottom: isExpanded ? '1px solid var(--qa-border-sub, #F0F0F2)' : 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        fontSize: 11,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 600, color: 'var(--qa-text-2, #6B6B6B)' }}>
            Inbound Message Body
          </span>
          {customerEmail && (
            <span
              title={`User Email: ${customerEmail}`}
              style={{
                fontSize: 11,
                color: '#1d4ed8',
                background: '#eff6ff',
                border: '1px solid #bfdbfe',
                padding: '1px 7px',
                borderRadius: 4,
                fontWeight: 500,
                fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                <polyline points="22,6 12,13 2,6" />
              </svg>
              {customerEmail}
            </span>
          )}
          {subjectLine && subjectLine !== 'Email Support Request' && (
            <span
              title={subjectLine}
              style={{
                color: 'var(--qa-text-3, #A1A1AA)',
                maxWidth: 260,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              • {subjectLine}
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={() => setIsExpanded(v => !v)}
          style={{
            background: 'transparent',
            border: 'none',
            padding: 0,
            fontSize: 11,
            fontWeight: 500,
            color: 'var(--accent, #1f7a4d)',
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          {isExpanded ? '▲ Collapse Email' : '▼ Expand Email'}
        </button>
      </div>

      {/* Email Body */}
      {isExpanded ? (
        <div style={{
          padding: '12px 16px',
          maxHeight: 280,
          overflowY: 'auto',
          fontSize: 13,
          lineHeight: 1.6,
          color: 'var(--qa-text, #111111)',
        }}>
          <EmailMessageView
            content={customerMessage}
            fallback="No message body available."
          />
        </div>
      ) : (
        <div
          onClick={() => setIsExpanded(true)}
          style={{
            padding: '8px 14px',
            fontSize: 12,
            color: 'var(--qa-text-3, #71717A)',
            cursor: 'pointer',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title="Click to expand"
        >
          {stripHtml(customerMessage).slice(0, 140)}…
        </div>
      )}
    </div>
  );
}

export interface CustomerSummaryBlockProps {
  threadSummary?: any;
  customerMessage?: string | null;
  subjectLine?: string | null;
  customerEmail?: string | null;
  parameterScores?: any;
  style?: React.CSSProperties;
}

/**
 * Renders the customer context cleanly separated:
 * 1. Dedicated CustomerCoreQueryCard for the synthesized core query
 * 2. Dedicated CustomerEmailThreadCard for the inbound message / thread with proper spacing
 */
export function CustomerSummaryBlock({
  threadSummary,
  customerMessage,
  subjectLine,
  customerEmail,
  parameterScores,
  style,
}: CustomerSummaryBlockProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, ...style }}>
      <CustomerCoreQueryCard
        threadSummary={threadSummary}
        customerMessage={customerMessage}
        subjectLine={subjectLine}
        customerEmail={customerEmail}
        parameterScores={parameterScores}
      />
      {customerMessage && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{
            fontSize: 11,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            color: 'var(--qa-text-3, #71717A)',
          }}>
            Customer Inbound Email
          </div>
          <CustomerEmailThreadCard
            customerMessage={customerMessage}
            subjectLine={subjectLine}
            customerEmail={customerEmail}
          />
        </div>
      )}
    </div>
  );
}

// ─── Internal Notes Component ────────────────────────────────────────────────

export interface InternalNote {
  sender?: string;
  content: string;
  created_at?: string;
}

export function formatNoteDate(ts?: string | number | null): string {
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
}

/**
 * Safely renders the internal note content, keeping URLs clickable
 * and preserving HTML formatting if sent as HTML by Robylon.
 */
export function renderNoteContent(raw?: string | null) {
  if (!raw) return 'No note content recorded.';

  if (isHtml(raw)) {
    const sanitized = sanitizeEmailHtml(raw);
    return (
      <div
        className="email-internal-note-content"
        dangerouslySetInnerHTML={{ __html: sanitized }}
      />
    );
  }

  const urlRegex = /(https?:\/\/[^\s\]\)\>]+)/gi;
  const parts = raw.split(urlRegex);
  if (parts.length === 1) {
    return <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{raw}</span>;
  }

  return (
    <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
      {parts.map((part, i) => {
        if (urlRegex.test(part)) {
          return (
            <a
              key={i}
              href={part}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: '#b45309', textDecoration: 'underline', fontWeight: 600, wordBreak: 'break-all' }}
            >
              {part}
            </a>
          );
        }
        return part;
      })}
    </span>
  );
}

export interface InternalNotesBlockProps {
  notes?: InternalNote[] | null;
  style?: React.CSSProperties;
}

/**
 * Renders internal notes with amber/yellow dashed highlighting identical to
 * chat transcripts in EvalPanel (background: #fffbeb, border: 1px dashed #f59e0b).
 */
export function InternalNotesBlock({ notes, style }: InternalNotesBlockProps) {
  if (!notes || notes.length === 0) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, ...style }}>
      <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#b45309', display: 'flex', alignItems: 'center', gap: 6 }}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
          <polyline points="14 2 14 8 20 8"></polyline>
          <line x1="16" y1="13" x2="8" y2="13"></line>
          <line x1="16" y1="17" x2="8" y2="17"></line>
        </svg>
        Internal Working Notes ({notes.length})
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {notes.map((note, idx) => {
          const noteTime = note.created_at ? '  •  ' + formatNoteDate(note.created_at) : '';
          const senderName = (note.sender || 'Agent').trim();

          return (
            <div
              key={idx}
              style={{
                background: '#fffbeb',
                border: '1px dashed #f59e0b',
                borderRadius: 8,
                fontSize: 12,
                color: '#78350f',
                padding: '10px 14px',
                lineHeight: 1.5,
                wordBreak: 'break-word',
                overflowWrap: 'anywhere',
                boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
              }}
            >
              <div
                style={{
                  fontWeight: 600,
                  fontSize: 11,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  color: '#b45309',
                  marginBottom: 6,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: 4,
                }}
              >
                <span>Internal Note ({senderName})</span>
                {noteTime && <span style={{ fontWeight: 400, color: '#92400e', fontSize: 10 }}>{noteTime.replace(/^\s*•\s*/, '')}</span>}
              </div>
              <div style={{ fontStyle: 'italic' }}>
                {renderNoteContent(note.content)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Customer History Panel Component ─────────────────────────────────────────

import TicketLinkButton from './TicketLinkButton';

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
  customerMessage?: string | null;
  agentReply?: string | null;
  messageId?: string | null;
  ticketId?: string | null;
  internalNotes?: InternalNote[];
}

export interface EmailHistoryPanelProps {
  customerEmail?: string | null;
  chatId?: string | null;
  ticketId?: string | null;
  currentMessageId?: string | null;
  onClose?: () => void;
}

export function EmailHistoryPanel({
  customerEmail,
  chatId,
  ticketId,
  currentMessageId,
  onClose,
}: EmailHistoryPanelProps) {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [resolvedEmail, setResolvedEmail] = useState<string | null>(customerEmail || null);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

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
        if (data.customerEmail) setResolvedEmail(data.customerEmail);
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

  const displayEmail = resolvedEmail || customerEmail;
  const emailCount = history.filter(h => h.channel === 'email').length;
  const chatCount = history.filter(h => h.channel === 'chat').length;

  return (
    <div
      style={{
        background: 'var(--qa-card, #FFFFFF)',
        border: '1px solid var(--qa-border, #E4E4E7)',
        borderRadius: 8,
        overflow: 'hidden',
        marginBottom: 14,
        boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
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
          flexWrap: 'wrap',
          gap: 8,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--qa-text-2, #6B6B6B)' }}>
            Customer History ({history.length} interaction{history.length === 1 ? '' : 's'})
          </span>
          {displayEmail && (
            <span style={{ fontSize: 11, color: 'var(--qa-text-3, #A1A1AA)', fontWeight: 500 }}>
              · {displayEmail}
            </span>
          )}
          {history.length > 0 && (
            <div style={{ display: 'inline-flex', gap: 4, marginLeft: 4 }}>
              {emailCount > 0 && (
                <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe', fontWeight: 600 }}>
                  {emailCount} Email{emailCount === 1 ? '' : 's'}
                </span>
              )}
              {chatCount > 0 && (
                <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: '#f0fdf4', color: '#15803d', border: '1px solid #bbf7d0', fontWeight: 600 }}>
                  {chatCount} Chat{chatCount === 1 ? '' : 's'}
                </span>
              )}
            </div>
          )}
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            title="Close History Panel"
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              fontSize: 14,
              color: 'var(--qa-text-3, #A1A1AA)',
              padding: '2px 6px',
              borderRadius: 4,
            }}
          >
            ✕
          </button>
        )}
      </div>

      <div style={{ maxHeight: 280, overflowY: 'auto' }}>
        {loading ? (
          <div style={{ padding: '20px', textAlign: 'center', fontSize: 12, color: 'var(--qa-text-3, #A1A1AA)' }}>
            Loading previous customer interactions &amp; threads…
          </div>
        ) : history.length === 0 ? (
          <div style={{ padding: '20px', textAlign: 'center', fontSize: 12, color: 'var(--qa-text-3, #A1A1AA)' }}>
            No prior conversation history found for this customer.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: 'var(--qa-gray-50, #FAFAFB)', borderBottom: '1px solid var(--qa-border-sub, #F0F0F2)' }}>
                {['', 'Date', 'Channel', 'ID', 'Agent', 'Subject / Summary', 'IQS', 'Status / CSAT'].map(h => (
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
              {history.map((h, i) => {
                const isExpanded = expandedId === h.id;
                const isCurrent = Boolean(
                  (currentMessageId && h.messageId === currentMessageId) ||
                  (!currentMessageId && ticketId && (h.ticketId === ticketId || h.id === ticketId))
                );

                return (
                  <React.Fragment key={`${h.id}_${i}`}>
                    <tr
                      onClick={() => setExpandedId(isExpanded ? null : h.id)}
                      style={{
                        borderBottom: '1px solid var(--qa-border-sub, #F0F0F2)',
                        background: isCurrent
                          ? '#f0fdf4'
                          : isExpanded
                          ? 'var(--qa-fill-light, #FAFAFB)'
                          : i % 2 === 0
                          ? 'transparent'
                          : 'var(--qa-fill-light, #FAFAFB)',
                        cursor: 'pointer',
                        transition: 'background 0.15s',
                      }}
                      title="Click to view message snippet and details"
                    >
                      <td style={{ padding: '7px 8px 7px 12px', width: 16, color: 'var(--qa-text-3, #A1A1AA)', fontSize: 10, textAlign: 'center' }}>
                        {isExpanded ? '▼' : '▶'}
                      </td>
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
                      <td style={{ padding: '7px 12px', whiteSpace: 'nowrap' }} onClick={e => e.stopPropagation()}>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <TicketLinkButton
                            id={h.chatId || h.ticketId || h.id}
                            label={h.chatId && /^\d+$/.test(h.chatId.trim()) ? h.chatId : `${(h.chatId || h.ticketId || h.id).slice(0, 8)}…`}
                          />
                          {isCurrent && (
                            <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4, background: '#dcfce7', color: '#166534', border: '1px solid #86efac' }}>
                              Current
                            </span>
                          )}
                        </div>
                      </td>
                      <td style={{ padding: '7px 12px', color: 'var(--qa-text, #111111)', fontWeight: 500, whiteSpace: 'nowrap' }}>
                        {h.agentName}
                      </td>
                      <td style={{ padding: '7px 12px', color: 'var(--qa-text-2, #6B6B6B)', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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

                    {/* Expanded Detail Drawer */}
                    {isExpanded && (
                      <tr style={{ background: 'var(--qa-fill-light, #FAFAFB)', borderBottom: '1px solid var(--qa-border, #E4E4E7)' }}>
                        <td colSpan={8} style={{ padding: '10px 14px 14px 34px' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                            {h.customerMessage && (
                              <div style={{ background: 'var(--qa-card, #FFFFFF)', border: '1px solid var(--qa-border, #E4E4E7)', borderRadius: 6, padding: '10px 12px' }}>
                                <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--qa-text-3, #A1A1AA)', marginBottom: 4 }}>
                                  Customer Query
                                </div>
                                <div style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--qa-text, #111111)', whiteSpace: 'pre-wrap', maxHeight: 120, overflowY: 'auto' }}>
                                  {stripHtml(h.customerMessage)}
                                </div>
                              </div>
                            )}

                            {h.internalNotes && h.internalNotes.length > 0 && (
                              <InternalNotesBlock notes={h.internalNotes} />
                            )}

                            {h.agentReply && (
                              <div style={{ background: 'var(--qa-card, #FFFFFF)', border: '1px solid var(--qa-border, #E4E4E7)', borderRadius: 6, padding: '10px 12px' }}>
                                <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--qa-text-3, #A1A1AA)', marginBottom: 4 }}>
                                  Agent Reply ({h.agentName})
                                </div>
                                <div style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--qa-text, #111111)', maxHeight: 150, overflowY: 'auto' }}>
                                  <EmailMessageView content={h.agentReply} />
                                </div>
                              </div>
                            )}

                            {!h.customerMessage && !h.agentReply && (
                              <div style={{ fontSize: 12, color: 'var(--qa-text-3, #A1A1AA)', fontStyle: 'italic' }}>
                                {h.channel === 'chat'
                                  ? `Chat interaction with ${h.agentName || 'Agent'}. Click the Ticket ID above to view the full Robylon chat transcript.`
                                  : 'No message preview stored for this interaction.'}
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
