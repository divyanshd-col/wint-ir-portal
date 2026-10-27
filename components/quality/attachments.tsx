import React from 'react';

// Robylon renders attachments inline as "[Attachment: <file name> - <https url>]".
const ATTACH_RE = /\[Attachment:\s*(.+?)\s+-\s+(https?:\/\/[^\s\]]+)\s*\]/g;

const CLIP = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
    <path d="M21.4 11.1l-9.2 9.2a5.5 5.5 0 0 1-7.8-7.8l9.2-9.2a3.7 3.7 0 0 1 5.2 5.2l-9.2 9.2a1.8 1.8 0 0 1-2.6-2.6l8.5-8.5" />
  </svg>
);

/** A clickable attachment: paperclip, file name, opens in a new tab. */
export function AttachmentChip({ name, url }: { name: string; url: string }) {
  return (
    <a className="attachment-chip" href={url} target="_blank" rel="noopener noreferrer" title={`Open ${name}`} onClick={e => e.stopPropagation()}>
      {CLIP}
      <span className="attachment-name">{name}</span>
      <span aria-hidden="true" className="attachment-arrow">↗</span>
    </a>
  );
}

/** Splits text around attachment markers; `renderRest` renders the plain stretches (e.g. to linkify URLs). */
export function renderWithAttachments(text: string, renderRest: (s: string) => React.ReactNode = s => s): React.ReactNode {
  if (!text || !text.includes('[Attachment:')) return renderRest(text);
  const out: React.ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(ATTACH_RE)) {
    const at = m.index ?? 0;
    if (at > last) out.push(<React.Fragment key={`t${at}`}>{renderRest(text.slice(last, at))}</React.Fragment>);
    out.push(<AttachmentChip key={`a${at}`} name={m[1]} url={m[2]} />);
    last = at + m[0].length;
  }
  if (last < text.length) out.push(<React.Fragment key="tend">{renderRest(text.slice(last))}</React.Fragment>);
  return out;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// An HTML converter may already have wrapped the URL in an anchor.
const ATTACH_HTML_RE = /\[Attachment:\s*(.+?)\s+-\s+(?:<a\b[^>]*>)?(https?:\/\/[^\s\]<"]+)(?:<\/a>)?\s*\]/g;
const CLIP_SVG = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21.4 11.1l-9.2 9.2a5.5 5.5 0 0 1-7.8-7.8l9.2-9.2a3.7 3.7 0 0 1 5.2 5.2l-9.2 9.2a1.8 1.8 0 0 1-2.6-2.6l8.5-8.5"/></svg>';

/** Same markers inside an HTML e-mail body: swap them for an anchor before the HTML is sanitised (href first: the sanitiser rewrites from there). */
export function attachmentsToHtml(html: string): string {
  if (!html.includes('[Attachment:')) return html;
  return html.replace(ATTACH_HTML_RE, (_m, name: string, url: string) =>
    `<a href="${esc(url)}" class="attachment-chip" target="_blank" rel="noopener noreferrer">${CLIP_SVG}<span class="attachment-name">${esc(name.replace(/<[^>]*>/g, ''))}</span><span class="attachment-arrow">↗</span></a>`);
}
