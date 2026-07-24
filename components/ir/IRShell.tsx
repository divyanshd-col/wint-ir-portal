'use client';

import React from 'react';
import RoleShell from '../RoleShell';

interface IRShellProps {
  role: string;
  name: string;
  children: React.ReactNode;
}

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

const UserIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
  </svg>
);

const NAV = [
  { label: 'Analytics', href: '/quality', icon: BarChartIcon },
  { label: 'My Analytics', href: '/tl/member-analytics', icon: UserIcon },
  { label: 'My Quality Chats', href: '/agent/quality-chats', icon: ChatIcon },
];

export default function IRShell({ role, name, children }: IRShellProps) {
  return (
    <RoleShell role={role} name={name} navItems={NAV} roleLabel="IR Agent" mainStyle={{ overflow: 'auto' }}>
      {children}
    </RoleShell>
  );
}
