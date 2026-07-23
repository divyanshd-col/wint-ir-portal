'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut } from 'next-auth/react';
import type { SavedConversation } from '@/lib/types';
import TimeAgo from '@/components/TimeAgo';

interface SidebarProps {
  username: string;
  isAdmin?: boolean;
  role?: string;
  historyEnabled?: boolean;
  onRestoreConversation?: (conv: SavedConversation) => void;
  onNewChat?: () => void;
}

const STORAGE_KEY = 'wint_sidebar_collapsed';


export default function Sidebar({ username, isAdmin, role, historyEnabled = false, onRestoreConversation, onNewChat }: SidebarProps) {
  const canSeeQuality = isAdmin || role === 'quality' || role === 'tl' || role === 'agent';
  const canSeeAnalytics = isAdmin || role === 'tl';
  const [open, setOpen] = useState(true); // mobile drawer
  const [collapsed, setCollapsed] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [conversations, setConversations] = useState<SavedConversation[]>([]);
  const pathname = usePathname();
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const enterTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Restore collapsed preference
  useEffect(() => {
    try { setCollapsed(localStorage.getItem(STORAGE_KEY) === '1'); } catch {}
  }, []);

  useEffect(() => {
    if (!historyEnabled) return;
    fetch('/api/conversations')
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setConversations(data); })
      .catch(() => {});
  }, [historyEnabled]);

  const setAndPersistCollapsed = (v: boolean) => {
    setCollapsed(v);
    try { localStorage.setItem(STORAGE_KEY, v ? '1' : '0'); } catch {}
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
        className="lg:hidden fixed top-4 left-4 z-50 bg-white border border-gray-200 rounded-lg p-2 shadow-sm"
      >
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="#1a1a1a" strokeWidth="1.5">
          <path d="M2 4h14M2 9h14M2 14h14"/>
        </svg>
      </button>

      <aside
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        className={`${open ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0 transition-all duration-200 fixed lg:static inset-y-0 left-0 z-40 bg-[#1a1a1a] flex flex-col overflow-hidden ${isExpanded ? 'w-72' : 'w-14'}`}
      >
        {/* Logo */}
        <div className={`border-b border-white/10 ${isExpanded ? 'px-5 py-4' : 'px-2 py-4 flex flex-col items-center gap-2'}`}>
          {isExpanded ? (
            <>
              <div className="flex items-center justify-between mb-2">
                <div className="bg-white rounded-lg px-2.5 py-1.5 inline-block">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/wint-logo.png" alt="Wint Wealth" width={68} height={22} className="object-contain block" />
                </div>
                <button
                  onClick={() => setAndPersistCollapsed(!collapsed)}
                  title={collapsed ? 'Pin sidebar open' : 'Collapse sidebar'}
                  className="p-1.5 rounded-lg text-gray-600 hover:text-white hover:bg-white/10 transition"
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                    {collapsed
                      ? <path d="M6 3l5 5-5 5M2 8h9"/>
                      : <path d="M10 3L5 8l5 5M14 8H5"/>}
                  </svg>
                </button>
              </div>
              <p className="text-gray-500 text-xs">IR Portal{role ? ` · ${role.charAt(0).toUpperCase() + role.slice(1)}` : ''}</p>
            </>
          ) : (
            <>
              <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/wint-logo.png" alt="W" width={20} height={20} className="object-contain" />
              </div>
            </>
          )}
        </div>

        {/* Nav */}
        <nav className={`py-4 flex-1 overflow-y-auto space-y-1 ${isExpanded ? 'px-4' : 'px-2'}`}>

          {canSeeAnalytics && (
            <NavLink href="/call-analysis" icon={
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M3 2a1 1 0 00-1 1v1.5a9 9 0 009 9H12.5a1 1 0 001-1v-2a1 1 0 00-1-1h-2a1 1 0 00-1 1v.5A6 6 0 014.5 5h.5a1 1 0 001-1V2a1 1 0 00-1-1H3z"/>
              </svg>
            } label="Call Analysis" active={pathname === '/call-analysis'} expanded={isExpanded}
              onClick={() => setAndPersistCollapsed(true)} />
          )}
          {canSeeAnalytics && (
            <NavLink href="/analytics" icon={
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M2 12l3-4 3 2 3-5 3 3"/><rect x="1" y="1" width="14" height="14" rx="1.5"/>
              </svg>
            } label="Analytics" active={pathname === '/analytics'} expanded={isExpanded}
              onClick={() => setAndPersistCollapsed(true)} />
          )}
          {canSeeAnalytics && (
            <NavLink href="/tl" icon={
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M2 13l4-5 3 3 5-7" />
              </svg>
            } label="Team Analytics" active={pathname === '/tl'} expanded={isExpanded}
              onClick={() => setAndPersistCollapsed(true)} />
          )}
          {canSeeAnalytics && (
            <NavLink href="/tl/member-analytics" icon={
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="6" cy="5" r="2.5" />
                <path d="M1 14c0-2.8 2.2-5 5-5" />
                <circle cx="11.5" cy="9" r="2" />
                <path d="M8.5 14c0-1.7 1.3-3 3-3s3 1.3 3 3" />
              </svg>
            } label="Member Analytics" active={pathname === '/tl/member-analytics'} expanded={isExpanded}
              onClick={() => setAndPersistCollapsed(true)} />
          )}
          {canSeeAnalytics && (
            <NavLink href="/tl/quality-chats" icon={
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M14 10a2 2 0 01-2 2H5l-3 3V4a2 2 0 012-2h8a2 2 0 012 2v6z" />
              </svg>
            } label="Quality Chats" active={pathname === '/tl/quality-chats'} expanded={isExpanded}
              onClick={() => setAndPersistCollapsed(true)} />
          )}

          {canSeeQuality && (
            <NavLink href="/quality" icon={
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M8 1l1.8 3.6L14 5.6l-3 2.9.7 4.1L8 10.5l-3.7 2.1.7-4.1-3-2.9 4.2-.4z"/>
              </svg>
            } label={role === 'agent' ? 'My Quality' : 'Quality'} active={pathname === '/quality'} expanded={isExpanded}
              onClick={() => setAndPersistCollapsed(true)} />
          )}

          <NavLink href="/cx" icon={
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="1" y="9" width="3" height="6" rx="0.5"/><rect x="6" y="5" width="3" height="10" rx="0.5"/><rect x="11" y="1" width="3" height="14" rx="0.5"/>
            </svg>
          } label="CX Dashboard" active={pathname === '/cx'} expanded={isExpanded}
            onClick={() => setAndPersistCollapsed(true)} />

          <div className={isExpanded ? 'mt-3 pt-3 border-t border-white/10' : 'mt-2 pt-2 flex flex-col items-center border-t border-white/10'}>
            <button
              onClick={onNewChat}
              title={!isExpanded ? 'New Chat' : undefined}
              className={`flex items-center gap-3 bg-[#2d9e4f]/20 text-[#2d9e4f] rounded-lg text-sm font-medium hover:bg-[#2d9e4f]/30 transition ${isExpanded ? 'w-full px-3 min-h-[44px]' : 'w-10 h-10 justify-center'}`}
            >
              <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor" className="shrink-0">
                <path d="M2 13.5L14 8 2 2.5v4l8.5 1.5L2 9.5v4z"/>
              </svg>
              {isExpanded && 'New Chat'}
            </button>

            {isExpanded && historyEnabled && conversations.length > 0 && (
              <div className="pt-3">
                <p className="text-gray-500 text-xs font-semibold uppercase tracking-wider px-3 mb-1.5">Recent</p>
                <div className="space-y-0.5">
                  {conversations.map(conv => (
                    <button
                      key={conv.id}
                      onClick={() => onRestoreConversation?.(conv)}
                      className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-white/5 transition group min-h-[44px]"
                    >
                      <p className="text-gray-300 text-sm truncate group-hover:text-white transition">{conv.title}</p>
                      <p className="text-gray-500 text-xs mt-0.5"><TimeAgo ts={conv.timestamp} /></p>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

        </nav>

        {/* Footer */}
        <div className={`border-t border-white/10 ${isExpanded ? 'px-4 py-4 space-y-2' : 'px-2 py-4 flex flex-col items-center gap-3'}`}>
          <NavLink href="/settings" icon={
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="8" cy="8" r="2.5"/>
              <path d="M8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3.05 3.05l1.06 1.06M11.89 11.89l1.06 1.06M3.05 12.95l1.06-1.06M11.89 4.11l1.06-1.06"/>
            </svg>
          } label="Settings" active={pathname === '/settings'} expanded={isExpanded}
            onClick={() => setAndPersistCollapsed(true)} />
          {isExpanded ? (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 bg-[#2d9e4f] rounded-full flex items-center justify-center text-white text-sm font-bold uppercase shrink-0">
                  {username?.[0] || 'I'}
                </div>
                <div>
                  <span className="text-gray-300 text-sm truncate max-w-[100px] block">{username.split('@')[0]}</span>
                  {role && <span className="text-gray-500 text-xs capitalize">{role}</span>}
                </div>
              </div>
              <button onClick={() => signOut({ callbackUrl: '/login' })} className="text-gray-500 hover:text-white transition text-xs" title="Sign out">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M10 8H2M6 5l-3 3 3 3M7 2h5a1 1 0 011 1v10a1 1 0 01-1 1H7"/>
                </svg>
              </button>
            </div>
          ) : (
            <>
              <div className="w-8 h-8 bg-[#2d9e4f] rounded-full flex items-center justify-center text-white text-sm font-bold uppercase shrink-0" title={username.split('@')[0]}>
                {username?.[0] || 'I'}
              </div>
              <button onClick={() => signOut({ callbackUrl: '/login' })} className="text-gray-500 hover:text-white transition" title="Sign out">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M10 8H2M6 5l-3 3 3 3M7 2h5a1 1 0 011 1v10a1 1 0 01-1 1H7"/>
                </svg>
              </button>
            </>
          )}
        </div>

      </aside>
    </>
  );
}

function NavLink({ href, icon, label, active, expanded, onClick }: {
  href: string; icon: React.ReactNode; label: string; active: boolean; expanded: boolean; onClick?: () => void;
}) {
  return (
    <Link href={href} onClick={onClick} title={!expanded ? label : undefined}
      className={`flex items-center gap-3 rounded-lg text-sm font-medium transition relative ${
        expanded ? 'w-full px-3 min-h-[44px]' : 'w-10 h-10 justify-center'
      } ${
        active
          ? `${expanded ? 'bg-white/10' : 'bg-[#2d9e4f]/12'} text-white before:absolute before:left-0 before:top-2 before:bottom-2 before:w-0.5 before:bg-[#2d9e4f] before:rounded-full`
          : 'text-gray-400 hover:text-white hover:bg-white/5'
      }`}>
      {icon}
      {expanded && label}
    </Link>
  );
}
