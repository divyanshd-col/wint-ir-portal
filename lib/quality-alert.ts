/**
 * Quality Slack alerts — shared between:
 *   - app/api/quality/score/route.ts  (manual scoring)
 *   - app/api/webhooks/chat/route.ts  (auto-scoring)
 *
 * Each chat gets at most ONE alert per 24 h (deduped via KV).
 * Call-interaction chats are flagged separately and skipped from scoring.
 */

import { sendSlackMessage } from './slack';
import { storeHasQualityAlert, storeMarkQualityAlert } from './store';
import { appendQualityAlertToSheet } from './quality-sheet';

const ROBYLON_BASE = 'https://app.robylon.ai/unified-inbox/share';

// ── Call detection ────────────────────────────────────────────────────────────

const CALL_TAG_PATTERNS = [
  /\bcall\b/i, /callback/i, /phone call/i, /call back/i,
];

const CALL_TRANSCRIPT_PATTERNS = [
  /please\s+call/i,
  /can\s+you\s+call/i,
  /give\s+(me\s+)?a\s+call/i,
  /call\s+me\b/i,
  /talked\s+on\s+(the\s+)?call/i,
  /spoke\s+on\s+(the\s+)?call/i,
  /discussed\s+on\s+(the\s+)?call/i,
  /as\s+(per|discussed\s+(on\s+)?)(our\s+)?call/i,
  /already\s+(spoke|called|talked)/i,
  /call\s+kar/i,
  /call\s+kiya/i,
  /call\s+hua/i,
  /phone\s+pe\s+baat/i,
];

export function hasCallInteraction(transcript: string, tags?: any): boolean {
  const disposition    = String(tags?.disposition    || tags || '').toLowerCase();
  const subDisposition = String(tags?.sub_disposition || '').toLowerCase();
  const combined = `${disposition} ${subDisposition}`;

  if (CALL_TAG_PATTERNS.some(p => p.test(combined))) return true;
  if (CALL_TRANSCRIPT_PATTERNS.some(p => p.test(transcript))) return true;
  return false;
}

// ── Critical parameter alert ─────────────────────────────────────────────────

const CRITICAL_PARAMS: { key: string; label: string }[] = [
  { key: 'Technical',    label: 'Technically / Legally Incorrect' },
  { key: 'AllQuestions', label: 'All Questions Not Answered' },
  { key: 'Process',      label: 'Process Incorrect' },
];

export async function fireQualityAlert(opts: {
  chatId: string;
  agentName: string;
  contactPhone?: string;
  scores: Record<string, string>;
  reasoning: Record<string, string>;
  iqs?: number;
  csat?: string;
  disposition?: string;
  subDisposition?: string;
}): Promise<void> {
  const token   = process.env.SLACK_BOT_TOKEN   || '';
  const channel = process.env.QUALITY_SLACK_CHANNEL || '';

  const failedParams = CRITICAL_PARAMS
    .filter(p => opts.scores?.[p.key] === 'No')
    .map(p => ({ label: p.label, reasoning: opts.reasoning?.[p.key] || 'No reasoning provided' }));

  if (!failedParams.length) return;

  // Deduplicate — one alert per chat per 24 h
  if (await storeHasQualityAlert(opts.chatId)) {
    console.log(`[quality-alert] Skipping duplicate alert for chat ${opts.chatId}`);
    return;
  }
  await storeMarkQualityAlert(opts.chatId);

  // ── Slack ─────────────────────────────────────────────────────────────────
  if (token && channel) {
    const chatLink = /^\d+$/.test((opts.chatId || '').trim())
      ? `<${ROBYLON_BASE}/${opts.chatId}|${opts.chatId}>`
      : opts.chatId;

    const failLines = failedParams.map(p => `• *${p.label}*\n  ${p.reasoning}`).join('\n');

    const lines = [
      `⚠️ *Quality Flag — Parameter Failure*`,
      `*Chat:* ${chatLink}`,
      opts.contactPhone ? `*Phone:* ${opts.contactPhone}` : null,
      `*Agent:* ${opts.agentName || 'Unknown'}`,
      opts.iqs != null ? `*IQS:* ${opts.iqs}%` : null,
      opts.disposition  ? `*Disposition:* ${opts.disposition}` : null,
      ``,
      `*Failed parameters:*`,
      failLines,
    ].filter((l): l is string => l !== null);

    sendSlackMessage(channel, lines.join('\n'), token).catch(() => {});
  }

  // ── Google Sheet ──────────────────────────────────────────────────────────
  appendQualityAlertToSheet({
    chatId:         opts.chatId,
    agentName:      opts.agentName,
    contactPhone:   opts.contactPhone,
    iqs:            opts.iqs,
    csat:           opts.csat,
    disposition:    opts.disposition,
    subDisposition: opts.subDisposition,
    failedParams,
  }).catch((err) => console.error('[quality-alert] Sheet append failed:', err?.message));
}

// ── Call-interaction flag (skip scoring) ────────────────────────────────────

export async function fireCallSkipAlert(opts: {
  chatId: string;
  agentName: string;
  contactPhone?: string;
  reason: string;
}): Promise<void> {
  const token   = process.env.SLACK_BOT_TOKEN      || '';
  const channel = process.env.QUALITY_SLACK_CHANNEL || '';
  if (!token || !channel) return;

  const chatLink = /^\d+$/.test((opts.chatId || '').trim())
    ? `<${ROBYLON_BASE}/${opts.chatId}|${opts.chatId}>`
    : opts.chatId;

  const lines = [
    `📞 *Scoring Skipped — Call Interaction Detected*`,
    `*Chat:* ${chatLink}`,
    opts.contactPhone ? `*Phone:* ${opts.contactPhone}` : null,
    `*Agent:* ${opts.agentName || 'Unknown'}`,
    `*Reason:* ${opts.reason}`,
    ``,
    `This chat involved a phone call. Please review manually — scoring skipped as call content cannot be verified.`,
  ].filter((l): l is string => l !== null);

  sendSlackMessage(channel, lines.join('\n'), token).catch(() => {});
}
