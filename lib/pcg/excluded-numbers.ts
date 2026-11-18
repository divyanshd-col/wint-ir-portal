/**
 * Central registry of known internal / non-client phone numbers (normalized 10-digit numbers).
 *
 * Any PCG call or chat conversation involving one of these numbers is automatically
 * categorized as `internal_personal` / `EXCLUDED_NON_CLIENT` (excluded from IQS scoring,
 * RM Pickup Rate, off-hours responsiveness, and client call/chat counts).
 */
export const PCG_EXCLUDED_INTERNAL_PHONES_10: readonly string[] = [
  '7338112020', // Internal Wint Wealth number (+917338112020)
];

/**
 * Strips non-digits and returns the last 10 digits of a phone number.
 */
export function normalizePhoneLast10(phone?: string | null): string {
  if (!phone) return '';
  const digits = String(phone).replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

/**
 * Returns true if the given phone number matches any configured internal excluded number.
 */
export function isPcgExcludedInternalPhone(phone?: string | null): boolean {
  const last10 = normalizePhoneLast10(phone);
  if (!last10 || last10.length < 10) return false;
  return PCG_EXCLUDED_INTERNAL_PHONES_10.includes(last10);
}

/**
 * Builds a static SQL predicate checking whether `columnExpr` matches any configured
 * internal excluded phone number (comparing last 10 numeric digits).
 */
export function pcgExcludedPhoneSql(columnExpr: string): string {
  if (PCG_EXCLUDED_INTERNAL_PHONES_10.length === 0) return 'FALSE';
  const literals = PCG_EXCLUDED_INTERNAL_PHONES_10
    .map((p) => `'${p.replace(/[^0-9]/g, '')}'`)
    .join(', ');
  return `(RIGHT(REGEXP_REPLACE(COALESCE(${columnExpr}, ''), '[^0-9]', '', 'g'), 10) IN (${literals}))`;
}
