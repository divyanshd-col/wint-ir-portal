'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession } from 'next-auth/react';

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
  skills?: string[];
  flags?: { callAnalysis?: boolean; cxDashboard?: boolean };
  /** When provided (Analytics page), the Analytics item expands to show sessions. */
  analytics?: AnalyticsNavData;
}

const DEFAULT_ROLE_SKILLS: Record<string, string[]> = {
  admin: [
    'chat:access', 'analytics:access', 'call_analysis:access', 'cx_dashboard:access',
    'quality:analytics:access', 'tokens:view:access', 'settings:manage:access',
  ],
  tl: [
    'chat:access', 'analytics:access', 'call_analysis:access', 'cx_dashboard:access',
    'quality:analytics:access',
  ],
  quality: ['chat:access', 'cx_dashboard:access', 'quality:analytics:access'],
  agent: ['chat:access', 'quality:analytics:access'],
};

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
        className={`w-full flex items-center gap-3 px-3 min-h-[40px] rounded-[10px] text-sm font-medium transition-colors relative ${
          onAnalytics
            ? 'bg-[var(--sb-active-bg)] text-[var(--sb-active-text)] shadow-[var(--sb-active-shadow)]'
            : 'text-[var(--sb-text-muted)] hover:text-[var(--sb-active-text)] hover:bg-[var(--sb-hover)]'
        }`}
      >
        <Link href="/analytics" className="flex items-center gap-3 flex-1 min-w-0">
          {AnalyticsIcon}
          MCP
        </Link>
        <button
          type="button"
          onClick={() => setExpanded(e => !e)}
          aria-label={expanded ? 'Collapse Analytics' : 'Expand Analytics'}
          aria-expanded={expanded}
          className="p-1 -mr-1 rounded text-[var(--sb-text-muted)] hover:text-[var(--sb-active-text)] transition-colors"
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
            className="flex items-center gap-2 pl-4 pr-3 min-h-[34px] rounded-lg text-[13px] font-medium text-[var(--accent-active)] hover:bg-[var(--accent-weak)] disabled:opacity-40 transition-colors text-left"
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
                  active ? 'bg-[var(--sb-active-bg)] text-[var(--sb-active-text)]' : 'text-[var(--sb-text-muted)] hover:text-[var(--sb-active-text)] hover:bg-[var(--sb-hover)]'
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
                    className="shrink-0 text-[var(--sb-text-muted)] opacity-0 group-hover:opacity-100 hover:text-[var(--sb-active-text)] transition-opacity text-[15px] leading-none px-1 disabled:opacity-0"
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
      className={`w-full flex items-center gap-3 px-3 min-h-[40px] rounded-[10px] text-sm font-medium transition-colors relative ${
        active
          ? 'bg-[var(--sb-active-bg)] text-[var(--sb-active-text)] shadow-[var(--sb-active-shadow)]'
          : 'text-[var(--sb-text-muted)] hover:text-[var(--sb-active-text)] hover:bg-[var(--sb-hover)]'
      }`}
    >
      {icon}
      {label}
    </Link>
  );
}

export default function PageNav({ role, isAdmin, skills: propSkills, flags, analytics }: PageNavProps) {
  const { data: session } = useSession();
  const sessionSkills = (session?.user as any)?.skills as string[] | undefined;
  const userRole = role || (session?.user as any)?.role || (isAdmin ? 'admin' : 'agent');
  const effectiveSkills = Array.isArray(propSkills) && propSkills.length
    ? propSkills
    : Array.isArray(sessionSkills) && sessionSkills.length
    ? sessionSkills
    : (DEFAULT_ROLE_SKILLS[userRole] || []);

  const checkSkill = (req: string) => isAdmin || userRole === 'admin' || effectiveSkills.includes(req);
  const pathname = usePathname();

  const canSeeAnalytics    = checkSkill('analytics:access');
  const canSeeCx           = checkSkill('cx_dashboard:access');
  const canSeeCallAnalysis = checkSkill('call_analysis:access');

  const showCx = !!flags?.cxDashboard && canSeeCx;
  const showCall = !!flags?.callAnalysis && canSeeCallAnalysis;

  // A sidebar that only repeats the tab it sits under (Analytics alone) is just noise: show it once there is somewhere else to go.
  const destinations = (canSeeAnalytics ? 1 : 0) + (showCx ? 1 : 0) + (showCall ? 1 : 0);
  if (pathname === '/tokens' || pathname.startsWith('/tokens/')) return null; // Token Usage belongs to Settings, not to this sidebar
  if (!analytics && destinations <= 1) return null;

  return (
    <aside className="w-56 bg-[var(--sb-bg)] border-r border-[var(--sb-border)] flex-col shrink-0 hidden lg:flex h-screen sticky top-0">
      <nav className="px-3 py-3 flex-1 overflow-y-auto space-y-1">
        {canSeeAnalytics && (
          analytics
            ? <AnalyticsNav {...analytics} />
            : <NavLink href="/analytics" label="MCP" icon={AnalyticsIcon} />
        )}
        {showCx && (
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
        {showCall && (
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
      </nav>
    </aside>
  );
}
