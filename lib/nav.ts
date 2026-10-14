/** Top-level navigation rules: which tabs a user sees, which one is active, where each role lands. Pure, so it is unit-tested. */

export type TabKey = 'chat' | 'analytics' | 'quality' | 'settings';
export interface NavTab { key: TabKey; label: string; href: string }

// Same defaults the sidebars use when a session carries no explicit skills.
const DEFAULT_ROLE_SKILLS: Record<string, string[]> = {
  tl: ['chat:access', 'analytics:access', 'call_analysis:access', 'cx_dashboard:access', 'quality:analytics:access'],
  quality: ['chat:access', 'cx_dashboard:access', 'quality:analytics:access'],
  agent: ['chat:access', 'quality:analytics:access'],
};

export function hasNavSkill(role: string | undefined, skills: string[] | undefined, req: string): boolean {
  if (role === 'admin') return true;
  const effective = skills && skills.length ? skills : DEFAULT_ROLE_SKILLS[role ?? ''] ?? [];
  return effective.includes(req);
}

const TABS: (NavTab & { skill: string })[] = [
  { key: 'chat',      label: 'Chat',      href: '/chat',      skill: 'chat:access' },
  { key: 'analytics', label: 'Analytics', href: '/analytics', skill: 'analytics:access' },
  { key: 'quality',   label: 'Quality',   href: '/quality',   skill: 'quality:analytics:access' },
  { key: 'settings',  label: 'Settings',  href: '/settings',  skill: 'settings:manage:access' },
];

export function topTabs(role: string | undefined, skills: string[] | undefined): NavTab[] {
  return TABS.filter((t) => hasNavSkill(role, skills, t.skill)).map(({ key, label, href }) => ({ key, label, href }));
}

const AREAS: [TabKey, string[]][] = [
  ['chat', ['/chat']],
  ['analytics', ['/analytics', '/call-analysis', '/cx']],
  ['quality', ['/quality', '/tl', '/agent']],
  ['settings', ['/settings', '/tokens']], // Token Usage is opened from Settings
];

const inPath = (pathname: string, base: string) => pathname === base || pathname.startsWith(`${base}/`);

export function activeTab(pathname: string): TabKey | null {
  return AREAS.find(([, bases]) => bases.some((b) => inPath(pathname, b)))?.[0] ?? null;
}

export const isAuthPath = (pathname: string) => ['/login', '/setup', '/set-password'].some((b) => inPath(pathname, b));
