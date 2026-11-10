'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import type { SavedConversation } from '@/lib/types';
import TimeAgo from '@/components/TimeAgo';
import WorkspaceSwitcher from '@/components/WorkspaceSwitcher';

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

// Same key and values as RoleShell, so collapsing the sidebar on one page collapses it everywhere.
const STORAGE_KEY = 'wint_sidebar';

/** Chat page sidebar. Built on the shared .quality-shell-sidebar classes so it matches the other pages:
 *  full height in the top-left corner, workspace switcher row, 32px rows, icon rail when collapsed. */
export default function Sidebar({ historyEnabled = false, onRestoreConversation, onNewChat }: SidebarProps) {
  const { data: session } = useSession();
  const [collapsed, setCollapsed] = useState(false);
  const [conversations, setConversations] = useState<SavedConversation[]>([]);

  useEffect(() => {
    try { setCollapsed(localStorage.getItem(STORAGE_KEY) === 'collapsed'); } catch { /* storage blocked: stay expanded */ }
  }, []);

  useEffect(() => {
    if (!historyEnabled) return;
    fetch('/api/conversations')
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setConversations(data); })
      .catch(() => { });
  }, [historyEnabled]);

  const toggle = () => setCollapsed(prev => {
    const next = !prev;
    try { localStorage.setItem(STORAGE_KEY, next ? 'collapsed' : 'expanded'); } catch { /* ignore */ }
    return next;
  });

  const canSwitch = Boolean(session?.user?.isSuperAdmin) || session?.user?.platformDomain === 'both';

  return (
    <aside className={`quality-shell-sidebar chat-sidebar${collapsed ? ' collapsed' : ''}`}>
      <div className="quality-shell-sidebar-head">
        {canSwitch ? (!collapsed && <WorkspaceSwitcher />) : <div className="quality-shell-sidebar-title">Chat</div>}
        <button
          type="button" className="quality-shell-sidebar-toggle" onClick={toggle}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!collapsed} title={collapsed ? 'Expand sidebar' : undefined}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="11 17 6 12 11 7" /><polyline points="18 17 13 12 18 7" /></svg>
        </button>
      </div>
      {canSwitch && collapsed && <div className="quality-shell-ws-collapsed"><WorkspaceSwitcher collapsed /></div>}

      <button type="button" onClick={onNewChat} className="quality-shell-sidebar-link quality-shell-sidebar-btn" aria-label="New chat" title={collapsed ? 'New chat' : undefined}>
        <span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
        </span>
        <span className="quality-shell-sidebar-label">New chat</span>
      </button>

      {!collapsed && historyEnabled && conversations.length > 0 && (
        <div className="chat-sidebar-recents">
          <div className="quality-shell-sidebar-title">Recent chats</div>
          {conversations.map(conv => (
            <button key={conv.id} type="button" onClick={() => onRestoreConversation?.(conv)} className="quality-shell-sidebar-link quality-shell-sidebar-btn chat-recent" title={conv.title}>
              <span className="chat-recent-title">{conv.title}</span>
              <span className="chat-recent-time"><TimeAgo ts={conv.timestamp} /></span>
            </button>
          ))}
        </div>
      )}
    </aside>
  );
}
