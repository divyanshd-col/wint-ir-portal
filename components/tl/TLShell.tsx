'use client';

import React from 'react';
import RoleShell from '../RoleShell';
import { NAV_ALL } from '../quality/QualityShell';

interface Props {
  role:     string;
  email?:   string;
  name:     string;
  skills?:  string[];
  children: React.ReactNode;
}

export default function TLShell({ role, name, email, skills, children }: Props) {
  const emailLower = (email || '').toLowerCase();
  const nameLower = (name || '').toLowerCase();
  if (emailLower.includes('harsh') || nameLower.includes('harsh')) {
    return <>{children}</>;
  }

  return (
    <RoleShell
      role={role}
      name={name}
      skills={skills}
      navItems={NAV_ALL}
      roleLabel={role === 'admin' ? 'Admin' : role === 'agent' ? 'IR Agent' : 'Team Lead'}
    >
      {children}
    </RoleShell>
  );
}
