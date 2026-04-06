import NextAuth, { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import type { UserRole } from './next-auth';

const ALLOWED_DOMAIN = 'wintwealth.com';

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
      },
      async authorize(credentials) {
        if (!credentials?.email) return null;

        const email = credentials.email.toLowerCase().trim();
        if (!email.endsWith(`@${ALLOWED_DOMAIN}`)) return null;

        const { readConfig, writeConfig } = await import('./lib/config');
        const config = await readConfig();

        let found = config.users.find(
          u => (u.email ?? u.username).toLowerCase() === email
        );

        if (!found) {
          // Auto-provision new user as agent on first login
          found = { username: email, email, role: 'agent' as UserRole };
          config.users.push(found);
          await writeConfig(config);
        }

        const role: UserRole = found.role ?? (found.isAdmin ? 'admin' : 'agent');
        return { id: email, name: email, email, role } as any;
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, account }) {
      if (account && user) {
        token.role = (user as any).role ?? 'agent';
        token.isAdmin = token.role === 'admin';
      }
      return token;
    },

    async session({ session, token }) {
      if (session.user) {
        session.user.role = token.role as UserRole | undefined;
        session.user.isAdmin = token.isAdmin ?? false;
      }
      return session;
    },
  },
  pages: { signIn: '/login' },
  session: { strategy: 'jwt', maxAge: 8 * 60 * 60 },
  secret: process.env.NEXTAUTH_SECRET,
};

export default NextAuth(authOptions);
