'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface IRShellProps {
  role: string;
  name: string;
  children: React.ReactNode;
}

const SANS = '-apple-system, BlinkMacSystemFont, "Inter", "Helvetica Neue", Arial, sans-serif';

export default function IRShell({ role, name, children }: IRShellProps) {
  const pathname = usePathname();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: '#F7F7F8', fontFamily: SANS }}>
      {/* Topnav */}
      <header style={{
        height: 64, background: '#FFFFFF', borderBottom: '1px solid #E4E4E7',
        padding: '0 24px', display: 'flex', alignItems: 'center', gap: 16,
        position: 'sticky', top: 0, zIndex: 30, flexShrink: 0,
      }}>
        {/* Wordmark */}
        <div style={{
          border: '1px dashed #E4E4E7', borderRadius: 6, padding: '4px 10px',
          fontSize: 11, color: '#A1A1AA', textTransform: 'uppercase', letterSpacing: '0.08em',
        }}>
          Wint Portal
        </div>

        {/* Role pill */}
        <div style={{
          height: 28, padding: '0 12px', borderRadius: 999,
          background: '#F4F4F5', border: '1px solid #E4E4E7',
          fontSize: 12, color: '#111111', fontWeight: 500,
          display: 'inline-flex', alignItems: 'center', gap: 6,
        }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#2D2D31', flexShrink: 0 }} />
          {role.charAt(0).toUpperCase() + role.slice(1)}
        </div>

        <div style={{ flex: 1 }} />

        {/* User info */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'default' }}>
          <div style={{
            width: 32, height: 32, borderRadius: '50%', background: '#E4E4E7',
            fontSize: 12, fontWeight: 600, color: '#6B6B6B',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {name.charAt(0).toUpperCase()}
          </div>
          <span style={{ fontSize: 13, color: '#111111' }}>{name}</span>
          <span style={{ fontSize: 10, color: '#A1A1AA' }}>▾</span>
        </div>
      </header>

      {/* Body */}
      <div style={{ display: 'flex', flex: 1 }}>
        {/* Sidebar */}
        <aside style={{
          width: 220, flexShrink: 0, background: '#FFFFFF',
          borderRight: '1px solid #E4E4E7', padding: '16px 0',
          minHeight: 'calc(100vh - 64px)',
        }}>
          <div style={{
            fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em',
            color: '#A1A1AA', padding: '12px 16px 6px',
          }}>
            My Quality
          </div>

          <SideLink
            href="/quality"
            label="My Analytics"
            active={pathname === '/quality'}
            icon={
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="1" y="9" width="3" height="6" rx="0.5"/>
                <rect x="6" y="5" width="3" height="10" rx="0.5"/>
                <rect x="11" y="1" width="3" height="14" rx="0.5"/>
              </svg>
            }
          />
          <SideLink
            href="/agent/quality-chats"
            label="My Quality Chats"
            active={pathname === '/agent/quality-chats'}
            icon={
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M2 2h12v10H9l-3 3V12H2z"/>
              </svg>
            }
          />
        </aside>

        {/* Main */}
        <main style={{ flex: 1, overflow: 'auto' }}>
          {children}
        </main>
      </div>
    </div>
  );
}

function SideLink({ href, label, active, icon }: { href: string; label: string; active: boolean; icon: React.ReactNode }) {
  return (
    <Link
      href={href}
      style={{
        height: 44, padding: '0 16px', display: 'flex', alignItems: 'center', gap: 10,
        fontSize: 14, color: '#111111', cursor: 'pointer',
        borderLeft: active ? '3px solid #111111' : '3px solid transparent',
        background: active ? '#F4F4F5' : 'transparent',
        fontWeight: active ? 500 : 400,
        textDecoration: 'none',
        transition: 'background 0.1s',
      }}
    >
      <span style={{
        width: 16, height: 16, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: active ? '#111111' : '#A1A1AA',
      }}>
        {icon}
      </span>
      {label}
    </Link>
  );
}
