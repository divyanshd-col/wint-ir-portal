import 'next-auth';
import 'next-auth/jwt';

export type UserRole = 'agent' | 'admin' | 'quality' | 'tl';
export type PlatformDomain = 'cx' | 'pcg' | 'both';

declare module 'next-auth' {
  interface Session {
    user: {
      name?: string | null;
      email?: string | null;
      image?: string | null;
      isAdmin?: boolean;
      role?: UserRole;
      skills?: string[];
      isSuperAdmin?: boolean;
      platformDomain?: PlatformDomain;
      activeDomain?: 'cx' | 'pcg';
    };
  }
  interface User {
    isAdmin?: boolean;
    role?: UserRole;
    skills?: string[];
    isSuperAdmin?: boolean;
    platformDomain?: PlatformDomain;
    activeDomain?: 'cx' | 'pcg';
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    isAdmin?: boolean;
    role?: UserRole;
    skills?: string[];
    isSuperAdmin?: boolean;
    platformDomain?: PlatformDomain;
    activeDomain?: 'cx' | 'pcg';
  }
}
