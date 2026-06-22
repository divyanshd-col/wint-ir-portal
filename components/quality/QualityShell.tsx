'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface Props {
  role:     string;
  email:    string;
  name:     string;
  children: React.ReactNode;
}

const NAV_ALL = [
  { label: 'Analytics',        href: '/quality',                roles: ['admin', 'quality'] },
  { label: 'Chat Evaluation',  href: '/quality/chat-evaluation', roles: ['admin', 'quality'] },
  { label: 'Call Evaluation',  href: '/quality/call-evaluation', roles: ['admin', 'quality'] },
  { label: 'Team Chats',       href: '/quality/tl-evaluation',  roles: ['admin', 'tl'] },
];

const BarChartIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>
  </svg>
);
const ChatIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
  </svg>
);
const PhoneIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12a19.79 19.79 0 0 1-3-8.63 2 2 0 0 1 2-2.18h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
  </svg>
);
const UsersIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
    <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
  </svg>
);

const NAV_ICONS: Record<string, () => React.ReactElement> = {
  '/quality':                BarChartIcon,
  '/quality/chat-evaluation': ChatIcon,
  '/quality/call-evaluation': PhoneIcon,
  '/quality/tl-evaluation':   UsersIcon,
};

const ROLE_LABELS: Record<string, string> = {
  admin:   'Admin',
  quality: 'QA Analyst',
  tl:      'Team Lead',
};

// Initials avatar from name
function initials(name: string) {
  return name.split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase() || '?';
}

export default function QualityShell({ role, email, name, children }: Props) {
  const pathname = usePathname();

  return (
    <div style={{ background: 'var(--qa-bg)', minHeight: '100vh', fontFamily: '-apple-system, BlinkMacSystemFont, "Inter", sans-serif', fontSize: 14, color: 'var(--qa-text)' }}>

      {/* ── Top Nav ─────────────────────────────────────────────────── */}
      <header style={{
        position: 'sticky', top: 0, zIndex: 30,
        height: 64, background: 'var(--qa-card)', borderBottom: '1px solid var(--qa-border)',
        display: 'flex', alignItems: 'center', padding: '0 24px', gap: 16,
      }}>
        {/* Wordmark */}
        <div style={{
          width: 120, height: 28, border: '1px dashed var(--qa-border)', borderRadius: 4,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 11, color: 'var(--qa-text-3)', letterSpacing: '0.08em', textTransform: 'uppercase',
        }}>
          Wint Wealth
        </div>

        {/* Role pill */}
        <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
          <span style={{
            height: 28, padding: '0 12px', borderRadius: 999,
            background: 'var(--qa-fill-light)', border: '1px solid var(--qa-border)',
            display: 'inline-flex', alignItems: 'center', gap: 6,
            fontSize: 12, fontWeight: 500,
          }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--qa-text)' }} />
            {ROLE_LABELS[role] ?? role}
          </span>
        </div>

        {/* User */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          <span style={{
            width: 32, height: 32, borderRadius: '50%', background: 'var(--qa-fill-med)',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 12, fontWeight: 600, color: 'var(--qa-text-2)',
          }}>
            {initials(name)}
          </span>
          <span>{name}</span>
          <span style={{ color: 'var(--qa-text-3)', fontSize: 10 }}>▾</span>
        </div>
      </header>

      <div style={{ display: 'flex' }}>
        {/* ── Sidebar ───────────────────────────────────────────────── */}
        <aside style={{
          width: 220, flexShrink: 0, background: 'var(--qa-card)',
          borderRight: '1px solid var(--qa-border)',
          padding: '16px 0', minHeight: 'calc(100vh - 64px)',
        }}>
          <div style={{
            fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em',
            color: 'var(--qa-text-3)', padding: '12px 16px 6px',
          }}>
            {ROLE_LABELS[role] ?? role}
          </div>

          {NAV_ALL.filter(item => item.roles.includes(role)).map((item) => {
            const Icon = NAV_ICONS[item.href] ?? BarChartIcon;
            const active = pathname === item.href;
            return (
              <Link key={item.href} href={item.href} style={{
                height: 44, padding: '0 16px', display: 'flex', alignItems: 'center', gap: 10,
                fontSize: 14, color: 'var(--qa-text)', textDecoration: 'none', position: 'relative',
                borderLeft: active ? '3px solid var(--qa-text)' : '3px solid transparent',
                background: active ? 'var(--qa-gray-100)' : 'transparent',
                fontWeight: active ? 500 : 400,
              }}>
                <span style={{ color: active ? 'var(--qa-text)' : 'var(--qa-text-3)' }}>
                  <Icon />
                </span>
                {item.label}
              </Link>
            );
          })}
        </aside>

        {/* ── Main content ──────────────────────────────────────────── */}
        <main style={{ flex: 1, padding: '32px 48px', minWidth: 0, maxWidth: 1400 }}>
          {children}
        </main>
      </div>
    </div>
  );
}
