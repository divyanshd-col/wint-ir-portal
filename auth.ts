import NextAuth, { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import type { UserRole } from './next-auth';

const ALLOWED_DOMAIN = 'wintwealth.com';

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const email = credentials.email.toLowerCase().trim();
        if (!email.endsWith(`@${ALLOWED_DOMAIN}`)) return null;

        const { readConfig } = await import('./lib/config');
        const config = await readConfig();
        const found = config.users.find(
          u => (u.email ?? u.username).toLowerCase() === email
        );
        if (!found || !found.password) return null;

        const ok = await bcrypt.compare(credentials.password, found.password);
        if (!ok) return null;

        const role: UserRole = found.role ?? (found.isAdmin ? 'admin' : 'agent');
        return { id: found.username, name: found.username, email, role } as any;
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
