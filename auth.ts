import NextAuth, { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        username: { label: 'Username', type: 'text' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.username || !credentials?.password) return null;
        const { readConfig } = await import('./lib/config');
        const config = await readConfig();
        const user = config.users.find(u => u.username === credentials.username);
        if (!user) return null;

        const isHashed = user.password.startsWith('$2b$') || user.password.startsWith('$2a$');
        if (!isHashed) return null; // reject unhashed passwords
        const valid = await bcrypt.compare(credentials.password, user.password);

        if (valid) {
          return {
            id: user.username,
            name: user.username,
            email: `${user.username}@wintwealth.com`,
            isAdmin: user.isAdmin ?? false,
          };
        }
        return null;
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) token.isAdmin = (user as any).isAdmin ?? false;
      return token;
    },
    async session({ session, token }) {
      if (session.user) session.user.isAdmin = token.isAdmin ?? false;
      return session;
    },
  },
  pages: { signIn: '/login' },
  session: { strategy: 'jwt', maxAge: 8 * 60 * 60 },
  secret: process.env.NEXTAUTH_SECRET,
};

export default NextAuth(authOptions);
