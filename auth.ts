import NextAuth, { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { isRateLimitedFailClosed, isBreakGlassAdmin } from './lib/rate-limit';
import { normalizeEmail } from './lib/identity';
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

        const email = normalizeEmail(credentials.email);
        if (!email.endsWith(`@${ALLOWED_DOMAIN}`)) return null;

        // Brute-force protection (fail-closed): per-IP always, plus per-account
        // unless the email is on the break-glass admin allow-list (so an admin
        // can still get in to fix a limiter outage — they keep the IP limit).
        const ip =
          (req as any)?.headers?.['x-forwarded-for']?.split(',')[0]?.trim() ||
          (req as any)?.socket?.remoteAddress ||
          'unknown';
        if (await isRateLimitedFailClosed(`login:ip:${ip}`, 10, 900)) {
          throw new Error('Too many requests. Please try again later.');
        }
        if (!isBreakGlassAdmin(email)) {
          if (await isRateLimitedFailClosed(`login:acct:${email}`, 10, 900)) {
            throw new Error('Too many requests. Please try again later.');
          }
        }

        const { getUserByEmail, recordLogin, audit } = await import('./lib/users');

        // ── Primary: Postgres users table ──────────────────────────────────
        try {
          const user = await getUserByEmail(email);
          if (user) {
            // Verify password FIRST so account status is never revealed to
            // someone who doesn't already hold the credentials (anti-enumeration).
            if (!user.password_hash) return null;
            const valid = await bcrypt.compare(credentials.password, user.password_hash);
            if (!valid) {
              await audit('login_fail', { targetEmail: email, detail: { reason: 'bad_password' } }).catch(() => {});
              return null;
            }
            if (user.status !== 'active') {
              await audit('login_fail', { targetEmail: email, detail: { reason: `status_${user.status}` } }).catch(() => {});
              throw new Error(
                user.status === 'invited'
                  ? 'Your account setup is incomplete. Use the signup link in your email, or ask an admin to resend it.'
                  : 'Your account has been disabled. Please contact an admin.'
              );
            }
            await recordLogin(user.user_id).catch(() => {});
            await audit('login_success', { targetEmail: email, detail: { user_id: user.user_id } }).catch(() => {});
            return {
              id: email,
              name: user.name || email,
              email,
              role: user.role,
              isSuperAdmin: Boolean(user.is_super_admin),
              platformDomain: (user.platform_domain as any) || 'cx',
              activeDomain: user.platform_domain === 'pcg' ? 'pcg' : 'cx',
            } as any;
          }
        } catch (err) {
          // Re-throw the explicit status messages above; only swallow DB errors
          // so we can fall back to the legacy blob during the dual-read window.
          if (err instanceof Error && /account/i.test(err.message)) throw err;
          console.error('[auth] users-table lookup failed, falling back to blob:', (err as Error)?.message);
        }

        // ── Fallback: legacy config.users blob (pre-backfill users) ─────────
        const { readConfig } = await import('./lib/config');
        const config = await readConfig();
        const found = config.users.find(
          u => (u.email ?? u.username).toLowerCase() === email
        );
        if (!found || !found.password) return null;
        const valid = await bcrypt.compare(credentials.password, found.password);
        if (!valid) return null;

        const role: UserRole = found.role ?? (found.isAdmin ? 'admin' : 'agent');
        return {
          id: email,
          name: found.agentName || (found as any).name || email,
          email,
          role,
          isSuperAdmin: false,
          platformDomain: 'cx',
          activeDomain: 'cx',
        } as any;
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, account, trigger, session }) {
      if (account && user) {
        token.role = (user as any).role ?? 'agent';
        token.isAdmin = token.role === 'admin';
        token.isSuperAdmin = Boolean((user as any).isSuperAdmin);
        token.platformDomain = (user as any).platformDomain ?? 'cx';
        token.activeDomain = (user as any).activeDomain ?? (token.platformDomain === 'pcg' ? 'pcg' : 'cx');
        if ((user as any).name) token.name = (user as any).name;
        try {
          const { getSkillsForPersona } = await import('./lib/skills');
          token.skills = await getSkillsForPersona(token.role);
        } catch {
          token.skills = [];
        }
      }

      // Allow client-side update() calls to switch activeDomain for Super Admins
      if (trigger === 'update' && session?.activeDomain) {
        if (token.isSuperAdmin || token.platformDomain === 'both' || token.platformDomain === session.activeDomain) {
          token.activeDomain = session.activeDomain;
        }
      }

      return token;
    },

    async session({ session, token }) {
      if (session.user) {
        session.user.role = token.role as UserRole | undefined;
        session.user.isAdmin = token.isAdmin ?? false;
        session.user.isSuperAdmin = token.isSuperAdmin ?? false;
        session.user.platformDomain = token.platformDomain ?? 'cx';
        session.user.activeDomain = token.activeDomain ?? (token.platformDomain === 'pcg' ? 'pcg' : 'cx');
        if (token.name) session.user.name = token.name as string;
        try {
          const { getSkillsForPersona } = await import('./lib/skills');
          token.skills = await getSkillsForPersona(token.role as string);
        } catch {
          session.user.skills = token.skills || [];
        }
      }
      return session;
    },

    async redirect({ url, baseUrl }) {
      // After sign-in, land on /quality: every role can access it and its page
      // role-routes internally (agent → own dashboard, QA/TL/admin → team view).
      // The old /analytics target bounced QA and agents off middleware back to /.
      if (url === baseUrl || url === `${baseUrl}/` || url === '/' || url === '') {
        return `${baseUrl}/quality`;
      }
      if (url.startsWith('/')) {
        return `${baseUrl}${url}`;
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
