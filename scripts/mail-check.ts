/**
 * Diagnose why invite emails aren't sending. Connects + authenticates to SMTP
 * (no email sent unless a recipient is passed).
 *
 * Run:  npx tsx scripts/mail-check.ts [recipient@wintwealth.com]
 * Uses the env in .env.local — to test production creds, `vercel env pull` first.
 */
import './_load-env';
import { mailerConfigured, verifyMailer, sendMail } from '@/lib/mailer';

async function main() {
  console.log('EMAIL_USER set:        ', !!process.env.EMAIL_USER);
  console.log('EMAIL_APP_PASSWORD set:', !!process.env.EMAIL_APP_PASSWORD);
  console.log('SMTP:', process.env.EMAIL_SMTP_HOST || 'smtp.gmail.com', process.env.EMAIL_SMTP_PORT || 465);
  console.log('APP_URL / NEXTAUTH_URL:', process.env.APP_URL || process.env.NEXTAUTH_URL || '(NOT SET — links will be relative/broken)');
  if (!mailerConfigured()) process.exit(1);

  try {
    await verifyMailer();
    console.log('SMTP login: OK');
  } catch (e) {
    const err = e as Error & { code?: string; responseCode?: number; response?: string };
    console.error('SMTP login FAILED:', err.code, err.responseCode, err.response || err.message);
    if (err.code === 'EAUTH') console.error('→ App password revoked/wrong (rotated Google password?). Generate a new one and update EMAIL_APP_PASSWORD.');
    else console.error('→ Network/port issue (check EMAIL_SMTP_HOST/PORT, firewall).');
    process.exit(1);
  }

  const to = process.argv[2];
  if (to) {
    const ok = await sendMail({ to, subject: 'IR Portal mail test', text: 'Mail test OK.', html: '<p>Mail test OK.</p>' });
    console.log(ok ? `Test email sent to ${to}` : 'Test send FAILED (see error above)');
  }
}
main().then(() => process.exit(0));
