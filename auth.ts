import NextAuth, { NextAuthOptions } from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';
import type { UserRole } from './next-auth';

const ALLOWED_DOMAIN = 'wintwealth.com';

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  callbacks: {
    async signIn({ user }) {
      // Only allow @wintwealth.com Google accounts
      const email = user.email || '';
      return email.endsWith(`@${ALLOWED_DOMAIN}`);
    },

    async jwt({ token, user, account }) {
      if (account && user) {
        // First sign-in — look up role from config
        const { readConfig, writeConfig } = await import('./lib/config');
        const config = await readConfig();
        const email = user.email || '';

        let existing = config.users.find(u => u.email === email || u.username === email);

        if (!existing) {
          // Auto-provision new @wintwealth.com user as agent
          const newUser = { username: email, email, role: 'agent' as UserRole };
          config.users.push(newUser);
          await writeConfig(config);
          existing = newUser;
        }

        const role: UserRole = existing.role || (existing.isAdmin ? 'admin' : 'agent');
        token.role = role;
        token.isAdmin = role === 'admin';
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
