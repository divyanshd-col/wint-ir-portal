'use client';

import React, { useState, useEffect, useCallback } from 'react';

export interface IQSFlagComment {
  id: string;
  flagId: string;
  authorEmail: string;
  authorName: string;
  role: string;
  content: string;
  createdAt: string;
}

interface Props {
  flagId: string;
  agentNote?: string | null;
  reviewNote?: string | null;
  agentName?: string | null;
  reviewedBy?: string | null;
  flaggedAt?: string | null;
  reviewedAt?: string | null;
  compact?: boolean;
}

function fmtDateTime(iso?: string | null) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function RoleBadge({ role }: { role: string }) {
  const r = (role || 'user').toLowerCase();
  let bg = '#f4f4f5';
  let color = '#52525b';
  let border = '#e4e4e7';
  let label = role.toUpperCase();

  if (r === 'agent' || r === 'ir') {
    bg = '#eff6ff';
    color = '#1d4ed8';
    border = '#bfdbfe';
    label = 'AGENT';
  } else if (r === 'tl') {
    bg = '#f3e8ff';
    color = '#6b21a8';
    border = '#e9d5ff';
    label = 'TEAM LEAD';
  } else if (r === 'quality' || r === 'qa' || r === 'admin') {
    bg = '#ecfdf5';
    color = '#047857';
    border = '#a7f3d0';
    label = r === 'admin' ? 'ADMIN' : 'QA';
  }

  return (
    <span style={{
      fontSize: 10,
      fontWeight: 700,
      letterSpacing: '0.04em',
      background: bg,
      color: color,
      border: `1px solid ${border}`,
      borderRadius: 4,
      padding: '1px 6px',
      display: 'inline-block',
      verticalAlign: 'middle',
    }}>
      {label}
    </span>
  );
}

export function DisputeThread({
  flagId,
  agentNote,
  reviewNote,
  agentName,
  reviewedBy,
  flaggedAt,
  reviewedAt,
  compact = false,
}: Props) {
  const [comments, setComments] = useState<IQSFlagComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [newComment, setNewComment] = useState('');
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchComments = useCallback(async () => {
    if (!flagId) return;
    try {
      setLoading(true);
      const res = await fetch(`/api/quality/flag-thread?flagId=${encodeURIComponent(flagId)}`);
      const d = await res.json();
      if (res.ok && Array.isArray(d.comments)) {
        setComments(d.comments);
      }
    } catch (err: any) {
      console.error('Failed to load dispute comments:', err);
    } finally {
      setLoading(false);
    }
  }, [flagId]);

  useEffect(() => {
    fetchComments();
  }, [fetchComments]);

  async function handleSubmitComment(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (!newComment.trim() || posting) return;

    try {
      setPosting(true);
      setError(null);
      const res = await fetch('/api/quality/flag-thread', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ flagId, content: newComment.trim() }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || 'Failed to post comment');
      }
      setNewComment('');
      await fetchComments();
    } catch (err: any) {
      setError(err.message || 'Failed to post comment');
    } finally {
      setPosting(false);
    }
  }

  return (
    <div style={{
      background: 'var(--qa-card, #FFFFFF)',
      border: '1px solid var(--qa-border, #E4E4E7)',
      borderRadius: compact ? 8 : 12,
      padding: compact ? '12px 14px' : '16px 20px',
      marginTop: 12,
      marginBottom: 12,
      boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 12,
        paddingBottom: 8,
        borderBottom: '1px solid var(--qa-border-sub, #F0F0F2)',
      }}>
        <div style={{
          fontSize: 12,
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          color: 'var(--qa-text-2, #52525B)',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}>
          <span>💬</span> Dispute Activity & Comments
        </div>
        <span style={{ fontSize: 11, color: 'var(--qa-text-3, #71717A)' }}>
          {comments.length + (agentNote ? 1 : 0) + (reviewNote ? 1 : 0)} messages
        </span>
      </div>

      {/* Message History Container */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
        {/* Initial Dispute Note (from Agent/TL) */}
        {agentNote && (
          <div style={{
            background: 'var(--qa-fill-light, #F8FAFC)',
            border: '1px solid var(--qa-border, #E2E8F0)',
            borderRadius: 8,
            padding: '10px 12px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--qa-text, #0F172A)' }}>
                {agentName || 'Dispute Creator'}
              </span>
              <RoleBadge role="agent" />
              <span style={{
                fontSize: 10,
                fontWeight: 600,
                background: '#fef3c7',
                color: '#92400e',
                border: '1px solid #fde68a',
                borderRadius: 4,
                padding: '1px 5px',
              }}>
                DISPUTE RAISED
              </span>
              {flaggedAt && (
                <span style={{ fontSize: 11, color: 'var(--qa-text-3, #64748B)', marginLeft: 'auto' }}>
                  {fmtDateTime(flaggedAt)}
                </span>
              )}
            </div>
            <div style={{ fontSize: 13, color: 'var(--qa-text, #334155)', lineHeight: 1.5, whitespace: 'pre-wrap' }}>
              {agentNote}
            </div>
          </div>
        )}

        {/* Thread Comments */}
        {loading ? (
          <div style={{ fontSize: 12, color: 'var(--qa-text-3, #71717A)', fontStyle: 'italic', padding: '4px 0' }}>
            Loading comments…
          </div>
        ) : (
          comments.map(c => (
            <div key={c.id} style={{
              background: '#FFFFFF',
              border: '1px solid var(--qa-border, #E4E4E7)',
              borderRadius: 8,
              padding: '10px 12px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--qa-text, #18181B)' }}>
                  {c.authorName}
                </span>
                <RoleBadge role={c.role} />
                <span style={{ fontSize: 11, color: 'var(--qa-text-3, #71717A)', marginLeft: 'auto' }}>
                  {fmtDateTime(c.createdAt)}
                </span>
              </div>
              <div style={{ fontSize: 13, color: 'var(--qa-text, #27272A)', lineHeight: 1.5, whitespace: 'pre-wrap' }}>
                {c.content}
              </div>
            </div>
          ))
        )}

        {/* Resolution Note (if dispute resolved) */}
        {reviewNote && (
          <div style={{
            background: '#ecfdf5',
            border: '1px solid #a7f3d0',
            borderRadius: 8,
            padding: '10px 12px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#065f46' }}>
                {reviewedBy || 'Reviewer'}
              </span>
              <RoleBadge role="quality" />
              <span style={{
                fontSize: 10,
                fontWeight: 600,
                background: '#d1fae5',
                color: '#065f46',
                border: '1px solid #6ee7b7',
                borderRadius: 4,
                padding: '1px 5px',
              }}>
                RESOLUTION NOTE
              </span>
              {reviewedAt && (
                <span style={{ fontSize: 11, color: '#047857', marginLeft: 'auto' }}>
                  {fmtDateTime(reviewedAt)}
                </span>
              )}
            </div>
            <div style={{ fontSize: 13, color: '#064e3b', lineHeight: 1.5, whitespace: 'pre-wrap' }}>
              {reviewNote}
            </div>
          </div>
        )}
      </div>

      {/* New Comment Input */}
      <form onSubmit={handleSubmitComment} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {error && (
          <div style={{ fontSize: 12, color: '#ef4444', marginBottom: 2 }}>{error}</div>
        )}
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <textarea
            value={newComment}
            onChange={e => setNewComment(e.target.value)}
            placeholder="Write a comment or response… (Cmd+Enter to post)"
            rows={compact ? 2 : 3}
            onKeyDown={e => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                handleSubmitComment();
              }
            }}
            style={{
              flex: 1,
              resize: 'vertical',
              border: '1px solid var(--qa-border, #D4D4D8)',
              borderRadius: 8,
              padding: '8px 10px',
              fontSize: 13,
              color: 'var(--qa-text, #18181B)',
              lineHeight: 1.4,
              fontFamily: 'inherit',
              background: '#FFFFFF',
              outline: 'none',
            }}
          />
          <button
            type="submit"
            disabled={posting || !newComment.trim()}
            style={{
              height: 36,
              padding: '0 16px',
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 600,
              background: posting || !newComment.trim() ? '#E4E4E7' : '#18181B',
              color: posting || !newComment.trim() ? '#A1A1AA' : '#FFFFFF',
              border: 'none',
              cursor: posting || !newComment.trim() ? 'default' : 'pointer',
              whiteSpace: 'nowrap',
              transition: 'background 0.15s',
            }}
          >
            {posting ? 'Posting…' : 'Comment'}
          </button>
        </div>
      </form>
    </div>
  );
}
