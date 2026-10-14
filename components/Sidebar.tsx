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
        className={`${open ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0 transition-all duration-200 fixed lg:static top-[var(--topbar-h)] bottom-0 lg:top-auto lg:bottom-auto left-0 z-40 bg-[var(--color-background-primary)] border-r border-[var(--sb-border)] flex flex-col overflow-hidden ${isExpanded ? 'w-60' : 'w-14'}`}
      >
        {/* Collapse toggle */}
        <div className={`pt-4 pb-2 flex ${isExpanded ? 'justify-end px-4' : 'justify-center'}`}>
          <button
            onClick={() => setAndPersistCollapsed(!collapsed)}
            title={collapsed ? 'Pin sidebar open' : 'Collapse sidebar'}
            aria-label={collapsed ? 'Pin sidebar open' : 'Collapse sidebar'}
            className="p-1.5 rounded-lg text-[var(--sb-text-muted)] hover:text-[var(--sb-active-text)] hover:bg-[var(--sb-hover)] transition"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="16" rx="3" />
              <path d="M9 4v16" />
            </svg>
          </button>
        </div>

        {/* Nav */}
        <nav className={`py-2 flex-1 overflow-y-auto ${isExpanded ? 'px-3' : 'px-2'}`}>
          <div className={isExpanded ? '' : 'flex flex-col items-center'}>
            <button
              onClick={onNewChat}
              title={!isExpanded ? 'New Chat' : undefined}
              className={`flex items-center gap-3 rounded-lg text-[15px] text-[var(--sb-active-text)] hover:bg-[var(--sb-hover)] transition ${isExpanded ? 'w-full px-3 h-10' : 'w-10 h-10 justify-center'}`}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" className="shrink-0">
                <path d="M12 5v14M5 12h14" />
              </svg>
              {isExpanded && 'New Chat'}
            </button>

            {isExpanded && historyEnabled && conversations.length > 0 && (
              <div className="pt-6">
                <p className="text-[var(--sb-text-muted)] text-[14px] px-3 mb-2">Recent chats</p>
                <div className="space-y-0.5">
                  {conversations.map(conv => (
                    <button
                      key={conv.id}
                      onClick={() => onRestoreConversation?.(conv)}
                      className="w-full text-left px-3 py-2 rounded-lg hover:bg-[var(--sb-hover)] transition group min-h-[44px]"
                    >
                      <p className="text-[var(--sb-active-text)] text-[14.5px] truncate">{conv.title}</p>
                      <p className="text-[var(--sb-text-muted)] text-xs mt-0.5"><TimeAgo ts={conv.timestamp} /></p>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </nav>
      </aside>
    </>
  );
}
