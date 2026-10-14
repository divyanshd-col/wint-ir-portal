'use client';

import { useEffect, useRef, useState } from 'react';
import type { SavedConversation } from '@/lib/types';
import TimeAgo from '@/components/TimeAgo';

interface SidebarProps {
  username: string;
  isAdmin?: boolean;
  role?: string;
  skills?: string[];
  historyEnabled?: boolean;
  flags?: { callAnalysis?: boolean; cxDashboard?: boolean };
  onRestoreConversation?: (conv: SavedConversation) => void;
  onNewChat?: () => void;
}

const STORAGE_KEY = 'wint_sidebar_collapsed';

export default function Sidebar({ historyEnabled = false, onRestoreConversation, onNewChat }: SidebarProps) {
  const [open, setOpen] = useState(true); // mobile drawer
  const [collapsed, setCollapsed] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [conversations, setConversations] = useState<SavedConversation[]>([]);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const enterTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Restore collapsed preference
  useEffect(() => {
    try { setCollapsed(localStorage.getItem(STORAGE_KEY) === '1'); } catch { }
  }, []);

  useEffect(() => {
    if (!historyEnabled) return;
    fetch('/api/conversations')
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setConversations(data); })
      .catch(() => { });
  }, [historyEnabled]);

  const setAndPersistCollapsed = (v: boolean) => {
    setCollapsed(v);
    try { localStorage.setItem(STORAGE_KEY, v ? '1' : '0'); } catch { }
  };

  const handleMouseEnter = () => {
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
    enterTimer.current = setTimeout(() => setHovered(true), 200);
  };
  const handleMouseLeave = () => {
    if (enterTimer.current) clearTimeout(enterTimer.current);
    leaveTimer.current = setTimeout(() => setHovered(false), 120);
  };

  // When collapsed, the effective expanded state is governed by hover
  const isExpanded = !collapsed || hovered;

  return (
    <>
      {/* Mobile toggle */}
      <button
        onClick={() => setOpen(!open)}
        className="lg:hidden fixed top-[calc(var(--topbar-h)+12px)] left-3 z-30 bg-white border border-gray-200 rounded-lg p-2 shadow-sm"
      >
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="#1a1a1a" strokeWidth="1.5">
          <path d="M2 4h14M2 9h14M2 14h14" />
        </svg>
      </button>

      <aside
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        className={`${open ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0 transition-all duration-200 fixed lg:static top-[var(--topbar-h)] bottom-0 lg:top-auto lg:bottom-auto left-0 z-40 bg-[var(--sb-bg)] border-r border-[var(--sb-border)] flex flex-col overflow-hidden ${isExpanded ? 'w-56' : 'w-14'}`}
      >
        {/* Nav */}
        <nav className={`py-3 flex-1 overflow-y-auto space-y-1 ${isExpanded ? 'px-3' : 'px-2'}`}>

          <div className={isExpanded ? '' : 'flex flex-col items-center'}>
            <button
              onClick={onNewChat}
              title={!isExpanded ? 'New Chat' : undefined}
              className={`flex items-center gap-3 bg-[var(--sb-active-bg)] text-[var(--sb-active-text)] shadow-[var(--sb-active-shadow)] rounded-[10px] text-sm font-medium hover:brightness-95 transition ${isExpanded ? 'w-full px-3 min-h-[40px]' : 'w-10 h-10 justify-center'}`}
            >
              <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor" className="shrink-0 text-[var(--accent)]">
                <path d="M2 13.5L14 8 2 2.5v4l8.5 1.5L2 9.5v4z" />
              </svg>
              {isExpanded && 'New Chat'}
            </button>

            {isExpanded && historyEnabled && conversations.length > 0 && (
              <div className="pt-3">
                <p className="text-[var(--sb-text-muted)] text-[11px] font-semibold uppercase tracking-[0.08em] px-3 mb-1.5">Recent</p>
                <div className="space-y-0.5">
                  {conversations.map(conv => (
                    <button
                      key={conv.id}
                      onClick={() => onRestoreConversation?.(conv)}
                      className="w-full text-left px-3 py-2 rounded-lg hover:bg-[var(--sb-hover)] transition group min-h-[44px]"
                    >
                      <p className="text-[var(--sb-text)] text-sm truncate group-hover:text-[var(--sb-active-text)] transition">{conv.title}</p>
                      <p className="text-[var(--sb-text-muted)] text-xs mt-0.5"><TimeAgo ts={conv.timestamp} /></p>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

        </nav>

        <div className={`border-t border-[var(--sb-border)] p-2 flex ${isExpanded ? 'justify-end' : 'justify-center'}`}>
          <button
            onClick={() => setAndPersistCollapsed(!collapsed)}
            title={collapsed ? 'Pin sidebar open' : 'Collapse sidebar'}
            aria-label={collapsed ? 'Pin sidebar open' : 'Collapse sidebar'}
            className="p-1.5 rounded-lg text-[var(--sb-text-muted)] hover:text-[var(--sb-active-text)] hover:bg-[var(--sb-hover)] transition"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              {collapsed ? <path d="M6 3l5 5-5 5M2 8h9" /> : <path d="M10 3L5 8l5 5M14 8H5" />}
            </svg>
          </button>
        </div>
      </aside>
    </>
  );
}
