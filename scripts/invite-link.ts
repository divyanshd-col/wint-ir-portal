/**
 * Create (or re-issue) an invite and print the signup link to THIS TERMINAL
 * only. The link is never returned by any HTTP API, so it can't show up in a
 * browser network tab. Send it to the user yourself (Slack, etc.).
 *
 * Run:  npx tsx scripts/invite-link.ts <email> "<Full Name>" [role=agent] [--email]
 *   --email  also send the normal invite email (needs working SMTP)
 *
 * If the user already exists and is still `invited`, a fresh token is issued
 * (older unused tokens are invalidated). Active/disabled users are refused.
 */
import './_load-env';
import { createInvite, createSignupToken, getUserByEmail } from '@/lib/users';
import { normalizeEmail, normalizeName, isAllowedEmail } from '@/lib/identity';
import { buildSignupLink, sendInviteEmail } from '@/lib/mailer';
import type { UserRole } from '@/next-auth';

const VALID_ROLES: UserRole[] = ['agent', 'admin', 'quality', 'tl'];

async function main() {
  const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
  const sendEmail = process.argv.includes('--email');
  const [rawEmail, rawName, rawRole = 'agent'] = args;
  if (!rawEmail || !rawName) {
    console.error('Usage: npx tsx scripts/invite-link.ts <email> "<Full Name>" [role] [--email]');
    process.exit(1);
  }
  const email = normalizeEmail(rawEmail);
  const name = normalizeName(rawName);
  if (!isAllowedEmail(email)) { console.error('Email must be @wintwealth.com'); process.exit(1); }
  if (!VALID_ROLES.includes(rawRole as UserRole)) { console.error(`Role must be one of ${VALID_ROLES.join(', ')}`); process.exit(1); }

  let user = await getUserByEmail(email);
  if (user && user.status !== 'invited') {
    console.error(`User ${email} already exists with status '${user.status}' — not issuing a signup link.`);
    process.exit(1);
  }
  if (!user) {
    user = await createInvite({ email, name, role: rawRole as UserRole, createdBy: 'cli:invite-link', platformDomain: 'cx' });
    console.log(`Created invited user ${user.email} (${rawRole}).`);
  } else {
    console.log(`User ${user.email} already invited — issuing a fresh link.`);
  }

  const { token, expiresAt } = await createSignupToken(user.user_id, user.email);
  console.log(`\nSignup link (single-use, expires ${expiresAt.toISOString()}):\n${buildSignupLink(token)}\n`);

  if (sendEmail) {
    const ok = await sendInviteEmail({ to: user.email, name: user.name, token, expiresAt });
    console.log(ok ? 'Invite email sent.' : 'Invite email FAILED (see [mailer] error above).');
  }
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
