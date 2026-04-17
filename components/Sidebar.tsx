'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { signOut } from 'next-auth/react';
import type { SavedConversation } from '@/lib/types';

interface SidebarProps {
  username: string;
  isAdmin?: boolean;
  role?: string;
  historyEnabled?: boolean;
  onRestoreConversation?: (conv: SavedConversation) => void;
  onNewChat?: () => void;
}

function formatTimeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function Sidebar({ username, isAdmin, role, historyEnabled = false, onRestoreConversation, onNewChat }: SidebarProps) {
  const canSeeQuality = isAdmin || role === 'quality' || role === 'tl' || role === 'agent';
  const [open, setOpen] = useState(true);
  const [conversations, setConversations] = useState<SavedConversation[]>([]);

  useEffect(() => {
    if (!historyEnabled) return;
    fetch('/api/conversations')
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setConversations(data); })
      .catch(() => {});
  }, [historyEnabled]);

  return (
    <>
      {/* Mobile toggle */}
      <button
        onClick={() => setOpen(!open)}
        className="lg:hidden fixed top-4 left-4 z-50 bg-white border border-gray-200 rounded-lg p-2 shadow-sm"
      >
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="#1a1a1a" strokeWidth="1.5">
          <path d="M2 4h14M2 9h14M2 14h14"/>
        </svg>
      </button>

      <aside className={`${open ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0 transition-transform fixed lg:static inset-y-0 left-0 z-40 w-72 bg-[#1a1a1a] flex flex-col`}>

        {/* Logo */}
        <div className="px-5 py-4 border-b border-white/10">
          <div className="bg-white rounded-lg px-2.5 py-1.5 inline-block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/wint-logo.png" alt="Wint Wealth" width={68} height={22} className="object-contain block" />
          </div>
          <p className="text-gray-500 text-xs mt-2">IR Portal{role ? ` · ${role.charAt(0).toUpperCase() + role.slice(1)}` : ''}</p>
        </div>

        {/* Nav */}
        <nav className="px-4 py-4 flex-1 overflow-y-auto space-y-1">
          <button
            onClick={onNewChat}
            className="w-full flex items-center gap-3 px-3 py-2.5 bg-[#2d9e4f]/20 text-[#2d9e4f] rounded-lg text-sm font-medium hover:bg-[#2d9e4f]/30 transition"
          >
            <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor">
              <path d="M2 13.5L14 8 2 2.5v4l8.5 1.5L2 9.5v4z"/>
            </svg>
            New Chat
          </button>

          {/* Recent conversations */}
          {historyEnabled && conversations.length > 0 && (
            <div className="pt-3">
              <p className="text-gray-500 text-[10px] font-semibold uppercase tracking-wider px-3 mb-1.5">Recent</p>
              <div className="space-y-0.5">
                {conversations.map(conv => (
                  <button
                    key={conv.id}
                    onClick={() => onRestoreConversation?.(conv)}
                    className="w-full text-left px-3 py-2 rounded-lg hover:bg-white/5 transition group"
                  >
                    <p className="text-gray-300 text-xs truncate group-hover:text-white transition">{conv.title}</p>
                    <p className="text-gray-600 text-[10px] mt-0.5">{formatTimeAgo(conv.timestamp)}</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {isAdmin && (
            <div className="pt-2">
              <Link
                href="/analytics"
                className="w-full flex items-center gap-3 px-3 py-2.5 text-gray-400 hover:text-white hover:bg-white/5 rounded-lg text-sm font-medium transition"
              >
                <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M2 12l3-4 3 2 3-5 3 3"/>
                  <rect x="1" y="1" width="14" height="14" rx="1.5"/>
                </svg>
                Analytics
              </Link>
            </div>
          )}
          {canSeeQuality && (
            <div className={isAdmin ? '' : 'pt-2'}>
              <Link
                href="/quality"
                className="w-full flex items-center gap-3 px-3 py-2.5 text-gray-400 hover:text-white hover:bg-white/5 rounded-lg text-sm font-medium transition"
              >
                <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M8 1l1.8 3.6L14 5.6l-3 2.9.7 4.1L8 10.5l-3.7 2.1.7-4.1-3-2.9 4.2-.4z"/>
                </svg>
                {role === 'agent' ? 'My Quality' : 'Quality'}
              </Link>
            </div>
          )}
        </nav>

        {/* Footer */}
        <div className="px-4 py-4 border-t border-white/10 space-y-2">
          {isAdmin && (
            <Link
              href="/settings"
              className="w-full flex items-center gap-3 px-3 py-2 text-gray-400 hover:text-white hover:bg-white/5 rounded-lg text-sm font-medium transition"
            >
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="8" cy="8" r="2.5"/>
                <path d="M8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3.05 3.05l1.06 1.06M11.89 11.89l1.06 1.06M3.05 12.95l1.06-1.06M11.89 4.11l1.06-1.06"/>
              </svg>
              Settings
            </Link>
          )}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 bg-[#2d9e4f] rounded-full flex items-center justify-center text-white text-xs font-bold uppercase">
                {username?.[0] || 'I'}
              </div>
              <div>
                <span className="text-gray-300 text-sm truncate max-w-[100px] block">{username.split('@')[0]}</span>
                {role && <span className="text-gray-600 text-[10px] capitalize">{role}</span>}
              </div>
            </div>
            <button onClick={() => signOut({ callbackUrl: '/login' })} className="text-gray-500 hover:text-white transition text-xs" title="Sign out">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M10 8H2M6 5l-3 3 3 3M7 2h5a1 1 0 011 1v10a1 1 0 01-1 1H7"/>
              </svg>
            </button>
          </div>
        </div>

      </aside>
    </>
  );
}
