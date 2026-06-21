'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface IRShellProps {
  role: string;
  name: string;
  children: React.ReactNode;
}

export default function IRShell({ role, name, children }: IRShellProps) {
  const pathname = usePathname();

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#F7F7F8', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
      {/* Left sidebar */}
      <aside style={{ width: 200, background: '#111', display: 'flex', flexDirection: 'column', flexShrink: 0, position: 'sticky', top: 0, height: '100vh' }}>
        <div style={{ padding: '20px 16px 12px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <span style={{ color: '#fff', fontWeight: 700, fontSize: 15, letterSpacing: '-0.3px' }}>Wint Portal</span>
        </div>

        <nav style={{ flex: 1, padding: '12px 8px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          <SideLink href="/quality" label="My Analytics" active={pathname === '/quality'} icon={
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="1" y="9" width="3" height="6" rx="0.5"/><rect x="6" y="5" width="3" height="10" rx="0.5"/><rect x="11" y="1" width="3" height="14" rx="0.5"/>
            </svg>
          } />
          <SideLink href="/agent/quality-chats" label="My Quality Chats" active={pathname === '/agent/quality-chats'} icon={
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M8 1l1.8 3.6L14 5.6l-3 2.9.7 4.1L8 10.5l-3.7 2.1.7-4.1-3-2.9 4.2-.4z"/>
            </svg>
          } />
        </nav>

        <div style={{ padding: '12px 16px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#2D2D31', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 11, fontWeight: 600 }}>
              {name.charAt(0).toUpperCase()}
            </div>
            <div>
              <div style={{ color: '#fff', fontSize: 12, fontWeight: 500, lineHeight: 1.2 }}>{name}</div>
              <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{role}</div>
            </div>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main style={{ flex: 1, minWidth: 0, overflow: 'auto' }}>
        {children}
      </main>
    </div>
  );
}

function SideLink({ href, label, active, icon }: { href: string; label: string; active: boolean; icon: React.ReactNode }) {
  return (
    <Link href={href} style={{
      display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 6,
      color: active ? '#fff' : 'rgba(255,255,255,0.5)',
      background: active ? 'rgba(255,255,255,0.1)' : 'transparent',
      textDecoration: 'none', fontSize: 13, fontWeight: active ? 500 : 400,
      transition: 'background 0.15s, color 0.15s',
    }}>
      {icon}
      {label}
    </Link>
  );
}
