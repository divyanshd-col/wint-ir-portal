'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut } from 'next-auth/react';

export interface AnalyticsNavData {
  sessions: { id: string; title: string }[];
  activeId: string;
  onSelect: (id: string) => void;
  onNew: () => void;
  onClose?: (id: string) => void;
  streaming?: boolean;
}

interface PageNavProps {
  username: string;
  role?: string;
  isAdmin?: boolean;
  flags?: { callAnalysis?: boolean; cxDashboard?: boolean };
  /** When provided (Analytics page), the Analytics item expands to show sessions. */
  analytics?: AnalyticsNavData;
}

const AnalyticsIcon = (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M2 12l3-4 3 2 3-5 3 3" />
    <rect x="1" y="1" width="14" height="14" rx="1.5" />
  </svg>
);

function AnalyticsNav({ sessions, activeId, onSelect, onNew, onClose, streaming }: AnalyticsNavData) {
  const pathname = usePathname();
  const onAnalytics = pathname === '/analytics';
  const [expanded, setExpanded] = useState(onAnalytics);

  return (
    <div>
      <div
        className={`w-full flex items-center gap-3 px-3 min-h-[44px] rounded-lg text-sm font-medium transition-colors relative ${
          onAnalytics
            ? 'bg-white/10 text-white before:absolute before:left-0 before:top-2 before:bottom-2 before:w-0.5 before:bg-[#2d9e4f] before:rounded-full'
            : 'text-gray-400 hover:text-white hover:bg-white/5'
        }`}
      >
        <Link href="/analytics" className="flex items-center gap-3 flex-1 min-w-0">
          {AnalyticsIcon}
          Analytics
        </Link>
        <button
          type="button"
          onClick={() => setExpanded(e => !e)}
          aria-label={expanded ? 'Collapse Analytics' : 'Expand Analytics'}
          aria-expanded={expanded}
          className="p-1 -mr-1 rounded text-gray-500 hover:text-white transition-colors"
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"
            className={`transition-transform ${expanded ? 'rotate-180' : ''}`}>
            <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {expanded && (
        <div className="mt-1 mb-1 pl-3 flex flex-col gap-0.5">
          <button
            type="button"
            onClick={onNew}
            disabled={streaming}
            className="flex items-center gap-2 pl-4 pr-3 min-h-[34px] rounded-lg text-[13px] font-medium text-[#2d9e4f] hover:bg-[#2d9e4f]/10 disabled:opacity-40 transition-colors text-left"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M8 3v10M3 8h10" strokeLinecap="round" />
            </svg>
            New chat
          </button>
          {sessions.map(s => {
            const active = s.id === activeId && onAnalytics;
            return (
              <div
                key={s.id}
                className={`group flex items-center gap-1 pl-4 pr-2 min-h-[34px] rounded-lg text-[13px] transition-colors ${
                  active ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-white hover:bg-white/5'
                }`}
              >
                <button
                  type="button"
                  onClick={() => onSelect(s.id)}
                  disabled={streaming}
                  className="flex-1 min-w-0 text-left truncate disabled:cursor-default py-1"
                  title={s.title}
                >
                  {s.title}
                </button>
                {onClose && sessions.length > 1 && (
                  <button
                    type="button"
                    onClick={() => onClose(s.id)}
                    disabled={streaming}
                    aria-label="Close chat"
                    className="shrink-0 text-gray-500 opacity-0 group-hover:opacity-100 hover:text-white transition-opacity text-[15px] leading-none px-1 disabled:opacity-0"
                  >
                    ×
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function NavLink({
  href,
  label,
  icon,
}: {
  href: string;
  label: string;
  icon: React.ReactNode;
}) {
  const pathname = usePathname();
  const active = pathname === href;
  return (
    <Link
      href={href}
      className={`w-full flex items-center gap-3 px-3 min-h-[44px] rounded-lg text-sm font-medium transition-colors relative ${
        active
          ? 'bg-white/10 text-white before:absolute before:left-0 before:top-2 before:bottom-2 before:w-0.5 before:bg-[#2d9e4f] before:rounded-full'
          : 'text-gray-400 hover:text-white hover:bg-white/5'
      }`}
    >
      {icon}
      {label}
    </Link>
  );
}

export default function PageNav({ username, role, isAdmin, flags, analytics }: PageNavProps) {
  const canSeeQuality         = isAdmin || role === 'quality' || role === 'tl' || role === 'agent';
  const canSeeAnalytics       = isAdmin || role === 'tl';

  return (
    <aside className="w-64 bg-[#1a1a1a] flex-col shrink-0 hidden lg:flex h-screen sticky top-0">
      {/* Logo */}
      <div className="px-5 py-4 border-b border-white/10">
        <Link href="/chat">
          <div className="bg-white rounded-lg px-2.5 py-1.5 inline-block">
            <img src="/wint-logo.png" alt="Wint Wealth" width={68} height={22} className="object-contain block" />
          </div>
        </Link>
        <p className="text-gray-500 text-xs mt-2">
          IR Portal{role ? ` · ${role.charAt(0).toUpperCase() + role.slice(1)}` : ''}
        </p>
      </div>

      {/* Nav */}
      <nav className="px-4 py-4 flex-1 overflow-y-auto space-y-1">
        <NavLink
          href="/chat"
          label="Chat"
          icon={
            <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor">
              <path d="M2 13.5L14 8 2 2.5v4l8.5 1.5L2 9.5v4z" />
            </svg>
          }
        />
        {canSeeAnalytics && (
          analytics
            ? <AnalyticsNav {...analytics} />
            : <NavLink href="/analytics" label="Analytics" icon={AnalyticsIcon} />
        )}
        {canSeeQuality && (
          <NavLink
            href="/quality"
            label="Quality Tool"
            icon={
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M8 1l1.8 3.6L14 5.6l-3 2.9.7 4.1L8 10.5l-3.7 2.1.7-4.1-3-2.9 4.2-.4z" />
              </svg>
            }
          />
        )}
        {flags?.cxDashboard && role !== 'agent' && (
          <NavLink
            href="/cx"
            label="CX Dashboard"
            icon={
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="1" y="9" width="3" height="6" rx="0.5" />
                <rect x="6" y="5" width="3" height="10" rx="0.5" />
                <rect x="11" y="1" width="3" height="14" rx="0.5" />
              </svg>
            }
          />
        )}
        {flags?.callAnalysis && canSeeAnalytics && (
          <NavLink
            href="/call-analysis"
            label="Call Analysis"
            icon={
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M3 2a1 1 0 00-1 1v1.5a9 9 0 009 9H12.5a1 1 0 001-1v-2a1 1 0 00-1-1h-2a1 1 0 00-1 1v.5A6 6 0 014.5 5h.5a1 1 0 001-1V2a1 1 0 00-1-1H3z"/>
              </svg>
            }
          />
        )}
        {isAdmin && (
          <NavLink
            href="/settings"
            label="Settings"
            icon={
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="8" cy="8" r="2.5" />
                <path d="M8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3.05 3.05l1.06 1.06M11.89 11.89l1.06 1.06M3.05 12.95l1.06-1.06M11.89 4.11l1.06-1.06" />
              </svg>
            }
          />
        )}
      </nav>

      {/* Footer */}
      <div className="px-4 py-4 border-t border-white/10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 bg-[#2d9e4f] rounded-full flex items-center justify-center text-white text-sm font-bold uppercase shrink-0">
              {username?.[0] || 'U'}
            </div>
            <div className="min-w-0">
              <span className="text-gray-300 text-sm truncate max-w-[100px] block">{username.split('@')[0]}</span>
              {role && <span className="text-gray-500 text-xs capitalize">{role}</span>}
            </div>
          </div>
          <button
            onClick={() => signOut({ callbackUrl: '/login' })}
            className="text-gray-500 hover:text-white transition-colors text-xs shrink-0"
            title="Sign out"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M10 8H2M6 5l-3 3 3 3M7 2h5a1 1 0 011 1v10a1 1 0 01-1 1H7" />
            </svg>
          </button>
        </div>
      </div>
    </aside>
  );
}
