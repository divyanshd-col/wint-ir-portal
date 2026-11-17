/**
 * Shared attribution resolver for PCG dual (co-handled) chats.
 *
 * Rules:
 * 1. Query Resolution (and Compliance Gate breaches) are shared across both handlers when failed.
 * 2. All other 10 quality parameters must be attributed strictly to the individual handler
 *    (RM or AM) who made the mistake. They must NEVER default to 'both'.
 * 3. Attribution sources checked in order:
 *    a) Explicit `failedBy` ('rm' | 'am' | 'both')
 *    b) Explicit `rmStatus` vs `amStatus`
 *    c) Transcript speaker matching the quoted mistake text
 *    d) Text analysis of reasoning (e.g., "The RM stated...", "RM failed to...")
 *    e) Default for non-query-resolution mistakes is 'rm' (primary handler), never 'both'.
 */

export interface ParameterAttributionInput {
  id?: string;
  failedBy?: 'rm' | 'am' | 'both' | null;
  rmStatus?: string | null;
  amStatus?: string | null;
  status?: string | null;
  reasoning?: string | null;
  quote?: string | null;
}

export interface TranscriptTurnInput {
  speaker?: string | null;
  role?: string | null;
  text?: string | null;
}

export function resolveParameterAttribution(
  param: ParameterAttributionInput,
  turns?: TranscriptTurnInput[] | null,
  rmName?: string | null,
  amName?: string | null
): 'rm' | 'am' | 'both' {
  const paramId = param.id || '';

  // 1. Query Resolution error is ALWAYS shared between RM and AM in dual chats
  if (paramId === 'QueryResolution') {
    return 'both';
  }

  // 2. Explicit attribution already stored on the parameter
  const fb = String(param.failedBy || '').trim().toLowerCase();
  if (fb === 'rm') return 'rm';
  if (fb === 'am') return 'am';
  if (fb === 'both') return 'both';

  // 3. Status stored per agent
  const rmFailed = param.rmStatus === 'No' || param.rmStatus === 'Half' || param.rmStatus === 'partial';
  const amFailed = param.amStatus === 'No' || param.amStatus === 'Half' || param.amStatus === 'partial';
  if (rmFailed && !amFailed) return 'rm';
  if (amFailed && !rmFailed) return 'am';
  if (rmFailed && amFailed) return 'both';

  // 4. Quote matching against transcript turns
  const rawQuote = String(param.quote || '').trim().toLowerCase();
  if (rawQuote && Array.isArray(turns) && turns.length > 0) {
    const cleanQuote = rawQuote.replace(/[^a-z0-9]/g, '');
    if (cleanQuote.length >= 6) {
      const matched = turns.find((t) => {
        const text = String(t.text || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        return text.includes(cleanQuote.slice(0, 20)) || (cleanQuote.length >= 10 && cleanQuote.includes(text.slice(0, 20)));
      });
      if (matched) {
        const spk = String(matched.speaker || matched.role || '').toUpperCase();
        if (spk === 'RM') return 'rm';
        if (spk === 'AM') return 'am';
      }
    }
  }

  // 5. Reasoning text inspection (strip timestamps like "10:42 AM" first so "AM" is not misidentified)
  const reasoning = String(param.reasoning || '');
  const cleaned = reasoning.replace(/\d{1,2}:\d{2}\s*(am|pm)/gi, '');
  const cleanLower = cleaned.toLowerCase();

  const rmFirst = (rmName || '').trim().split(/\s+/)[0]?.toLowerCase();
  const amFirst = (amName || '').trim().split(/\s+/)[0]?.toLowerCase();

  const mentionsRm =
    /\b(the\s+rm|rm\b)/i.test(cleaned) ||
    Boolean(rmFirst && rmFirst.length >= 3 && cleanLower.includes(rmFirst));

  const mentionsAm =
    /\b(the\s+am|associate\s+manager)\b/i.test(cleaned) ||
    /\bam\s+(stated|failed|did|was|responded|replied|asked|shared|sent|advised)\b/i.test(cleaned) ||
    Boolean(amFirst && amFirst.length >= 3 && cleanLower.includes(amFirst));

  if (mentionsRm && !mentionsAm) return 'rm';
  if (mentionsAm && !mentionsRm) return 'am';
  if (mentionsRm && mentionsAm) {
    if (cleanLower.includes('both rm and am') || cleanLower.includes('both handlers')) return 'both';
    if (/\brm\s+(stated|failed|did not|unnecessarily)/i.test(cleaned)) return 'rm';
    if (/\bam\s+(stated|failed|did not|unnecessarily)/i.test(cleaned)) return 'am';
  }

  // Default fallback for any quality parameter outside Query Resolution: RM (primary handler), never both
  return 'rm';
}
