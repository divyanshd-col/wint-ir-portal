'use client';

import React from 'react';

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
 * Basic client-safe sanitizer for email HTML content.
 * Removes script, iframe, object, embed tags, event handlers, and javascript: links.
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

  // Ensure external links open safely in a new tab
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
