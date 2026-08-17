// Email sender for the identity layer. Stateless — no DB table; the signup
// link it sends is backed by signup_tokens, and the fact that an email was
// sent is captured in identity_audit.
//
// Auth mechanism: Google Workspace SMTP with an App Password on
// cx_business@wintwealth.com. All sender/creds come from env, and every send
// goes through the single sendMail() below, so swapping to a service account
// or a transactional provider later is an adapter change, not a rewrite.

const SMTP_HOST = process.env.EMAIL_SMTP_HOST || 'smtp.gmail.com';
const SMTP_PORT = Number(process.env.EMAIL_SMTP_PORT || 465);
const EMAIL_USER = process.env.EMAIL_USER || '';
const EMAIL_PASSWORD = process.env.EMAIL_APP_PASSWORD || '';
const EMAIL_FROM = process.env.EMAIL_FROM || EMAIL_USER;

let transporter: any = null;

export function mailerConfigured(): boolean {
  return !!(EMAIL_USER && EMAIL_PASSWORD);
}

async function getTransporter(): Promise<any> {
  if (!transporter) {
    const nodemailer = (await import('nodemailer')).default;
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465, // SSL on 465, STARTTLS otherwise
      auth: { user: EMAIL_USER, pass: EMAIL_PASSWORD },
    });
  }
  return transporter;
}

export interface SendMailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/**
 * Sends one email. Returns true on success, false on failure (never throws) so
 * callers can treat a mail outage as non-fatal (e.g. keep the invited user and
 * offer a resend). Throws only if the mailer isn't configured at all, which is
 * a deployment error the caller should surface distinctly.
 */
export async function sendMail(input: SendMailInput): Promise<boolean> {
  if (!mailerConfigured()) {
    throw new Error('Email is not configured (EMAIL_USER / EMAIL_APP_PASSWORD missing).');
  }
  try {
    const t = await getTransporter();
    await t.sendMail({
      from: EMAIL_FROM,
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html,
    });
    return true;
  } catch (err) {
    console.error('[mailer] send failed:', (err as Error)?.message ?? err);
    return false;
  }
}

// ── Invite / signup email template ───────────────────────────────────────────

function appBaseUrl(): string {
  return (process.env.APP_URL || process.env.NEXTAUTH_URL || '').replace(/\/$/, '');
}

export function buildSignupLink(token: string): string {
  const base = appBaseUrl();
  return `${base}/set-password?token=${encodeURIComponent(token)}`;
}

export interface InviteEmailInput {
  to: string;
  name: string;
  token: string;
  expiresAt: Date;
}

export async function sendInviteEmail(input: InviteEmailInput): Promise<boolean> {
  const link = buildSignupLink(input.token);
  const expiry = input.expiresAt.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
  const subject = 'Set up your Wint IR Portal account';

  const text =
    `Hi ${input.name},\n\n` +
    `You've been invited to the Wint IR Portal. Set your password to finish signing up:\n\n` +
    `${link}\n\n` +
    `This link works once and expires on ${expiry}. If it expires, ask your admin to resend the invite.\n\n` +
    `— Wint CX`;

  const html =
    `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1a1d1a;line-height:1.6">` +
    `<p>Hi ${escapeHtml(input.name)},</p>` +
    `<p>You've been invited to the <strong>Wint IR Portal</strong>. Set your password to finish signing up:</p>` +
    `<p><a href="${link}" style="display:inline-block;background:#2d9e4f;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600">Set your password</a></p>` +
    `<p style="color:#5b625b;font-size:14px">This link works once and expires on <strong>${expiry}</strong>. If it expires, ask your admin to resend the invite.</p>` +
    `<p style="color:#8b918a;font-size:13px">— Wint CX</p>` +
    `</div>`;

  return sendMail({ to: input.to, subject, html, text });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ));
}
