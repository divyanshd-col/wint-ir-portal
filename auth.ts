import NextAuth, { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { isRateLimited } from './lib/rate-limit';
import type { UserRole } from './next-auth';

const ALLOWED_DOMAIN = 'wintwealth.com';

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        email:    { label: 'Email',    type: 'email'    },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials, req) {
        if (!credentials?.email || !credentials?.password) return null;

        const email = credentials.email.toLowerCase().trim();
        if (!email.endsWith(`@${ALLOWED_DOMAIN}`)) return null;

        // Brute-force protection: 10 attempts per IP per 15 minutes
        const ip =
          (req as any)?.headers?.['x-forwarded-for']?.split(',')[0]?.trim() ||
          (req as any)?.socket?.remoteAddress ||
          'unknown';
        if (await isRateLimited(`login:${ip}`, 10, 900)) return null;

        const { readConfig } = await import('./lib/config');
        const config = await readConfig();

        const found = config.users.find(
          u => (u.email ?? u.username).toLowerCase() === email
        );

        if (!found || !found.password) return null;

        const valid = await bcrypt.compare(credentials.password, found.password);
        if (!valid) return null;

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

    async redirect({ url, baseUrl }) {
      // After sign-in, land on /quality: every role can access it and its page
      // role-routes internally (agent → own dashboard, QA/TL/admin → team view).
      // The old /analytics target bounced QA and agents off middleware back to /.
      if (url === baseUrl || url === `${baseUrl}/`) {
        return `${baseUrl}/quality`;
      }
      // Honour explicit callbackUrl (e.g. signOut → /login)
      return url.startsWith(baseUrl) ? url : baseUrl;
    },
  },
  pages: { signIn: '/login' },
  session: { strategy: 'jwt', maxAge: 8 * 60 * 60 },
  secret: process.env.NEXTAUTH_SECRET,
};

export default NextAuth(authOptions);
