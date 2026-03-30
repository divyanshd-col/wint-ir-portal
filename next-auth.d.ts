import 'next-auth';
import 'next-auth/jwt';

export type UserRole = 'agent' | 'admin' | 'quality' | 'tl';

declare module 'next-auth' {
  interface Session {
    user: {
      name?: string | null;
      email?: string | null;
      image?: string | null;
      isAdmin?: boolean;
      role?: UserRole;
    };
  }
  interface User {
    isAdmin?: boolean;
    role?: UserRole;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    isAdmin?: boolean;
    role?: UserRole;
  }
}
