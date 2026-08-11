// Identity helpers shared by the write path (admin invite) and the resolve
// path (Robylon webhook attribution). Keeping normalization in one place is
// what makes exact-match name attribution reliable — see the identity PRD.

/** Normalize an email: trim + lowercase. Apply on every write AND comparison. */
export function normalizeEmail(raw: string): string {
  return (raw ?? '').trim().toLowerCase();
}

/**
 * Normalize a display / agent name: trim, collapse internal whitespace to a
 * single space, and Unicode NFC-normalize. Must be applied identically when
 * storing `users.name` and when comparing an incoming webhook `agent_name`,
 * or exact-match attribution will silently miss.
 */
export function normalizeName(raw: string): string {
  return (raw ?? '')
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .trim();
}

export const ALLOWED_EMAIL_DOMAIN = 'wintwealth.com';

/** True if the email is syntactically plausible and on the allowed domain. */
export function isAllowedEmail(email: string): boolean {
  const e = normalizeEmail(email);
  // single @, non-empty local part, and the exact allowed domain
  if (!e.includes('@')) return false;
  const [local, domain, ...rest] = e.split('@');
  if (rest.length > 0) return false;
  if (!local) return false;
  return domain === ALLOWED_EMAIL_DOMAIN;
}

export const MIN_PASSWORD_LENGTH = 8;

export interface PasswordCheck {
  ok: boolean;
  error?: string;
}

/** Single source of truth for password policy (min length). */
export function validatePassword(password: string): PasswordCheck {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` };
  }
  return { ok: true };
}
