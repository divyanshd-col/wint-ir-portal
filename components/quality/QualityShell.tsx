'use client';

import React from 'react';
import RoleShell from '../RoleShell';

interface Props {
  role:     string;
  email?:   string;
  name:     string;
  children: React.ReactNode;
}

const BarChartIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>
  </svg>
);
const TrendingUpIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>
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
const UserIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
  </svg>
);
const StarIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
  </svg>
);

export const NAV_ALL = [
  { label: 'Analytics',        href: '/quality',                icon: StarIcon,       roles: ['admin', 'quality', 'tl', 'agent'] },
  { label: 'Chat Evaluation',  href: '/quality/chat-evaluation', icon: ChatIcon,       roles: ['admin', 'quality'] },
  { label: 'Call Evaluation',  href: '/quality/call-evaluation', icon: PhoneIcon,      roles: ['admin', 'quality'] },
  { label: 'Team Analytics',   href: '/tl',                     icon: TrendingUpIcon, roles: ['admin', 'tl'] },
  { label: 'Member Analytics', href: '/tl/member-analytics',    icon: UserIcon,       roles: ['admin', 'tl'] },
  { label: 'My Analytics',     href: '/tl/member-analytics',    icon: UserIcon,       roles: ['agent'] },
  { label: 'My Quality Chats', href: '/agent/quality-chats',    icon: ChatIcon,       roles: ['agent'] },
  { label: 'Quality Chats',    href: '/tl/quality-chats',       icon: ChatIcon,       roles: ['admin', 'tl'] },
];

const ROLE_LABELS: Record<string, string> = {
  admin:   'Admin',
  quality: 'QA Analyst',
  tl:      'Team Lead',
  agent:   'IR Agent',
};

export default function QualityShell({ role, name, children }: Props) {
  return (
    <RoleShell
      role={role}
      name={name}
      navItems={NAV_ALL}
      roleLabel={ROLE_LABELS[role] ?? role}
    >
      {children}
    </RoleShell>
  );
}
