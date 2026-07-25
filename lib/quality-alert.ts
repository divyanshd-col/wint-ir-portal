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

// Tag patterns — checked against disposition + sub-disposition combined.
// IMPORTANT: keep these specific. "/\bcall\b/i" is intentionally absent because
// dispositions like "Callback Required" or "Call Not Answered" contain "call"
// but do NOT mean a live call occurred — they would cause false positives that
// skip chat scoring entirely.
const CALL_TAG_PATTERNS = [
  /\bphone\s+call\b/i,
  /\bcall\s+back\b/i,
  /\bcallback\b/i,          // "Callback Scheduled" — agent arranged a call
  /\bcall\s+done\b/i,
  /\bcall\s+completed\b/i,
  /\bcall\s+connected\b/i,
];

const CALL_TRANSCRIPT_PATTERNS = [
  // Requests for a call — agent or customer asking for one
  /please\s+call/i,
  /can\s+you\s+call/i,
  /give\s+(me\s+)?a\s+call/i,
  /call\s+me\b/i,
  /arrange\s+a\s+call/i,
  /schedule\s+a\s+call/i,
  // Post-call references — evidence a call already happened
  /talked\s+on\s+(the\s+)?call/i,
  /spoke\s+on\s+(the\s+)?call/i,
  /discussed\s+on\s+(the\s+)?call/i,
  /as\s+(per|discussed\s+(on\s+)?)(our\s+)?call/i,
  /already\s+(spoke|called|talked)\s+(with|to|on)/i,
  /spoke\s+(with|to)\s+(you|the\s+team|our\s+team)/i,
  // Hindi patterns — both explicit call references and post-call phrases
  /call\s+kar/i,
  /call\s+kiya/i,
  /call\s+hua/i,
  /call\s+pe\b/i,
  /call\s+par\b/i,
  /phone\s+pe\s+baat/i,
  /phone\s+par\s+baat/i,
  /baat\s+ki\s+thi/i,
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

// Callers pass scores in two dialects:
//  - lib/scoring/engine.ts (auto-pipeline): v4 snake_case keys with stringified
//    raw values ('true' | 'false' | '0.5' | 'null')
//  - app/api/quality/score/route.ts (manual v3 path): PascalCase keys with
//    'Yes' | 'No' | 'Half' | 'NA'
// Accept every alias per logical parameter and every "failed" value spelling,
// otherwise the auto-pipeline never fires an alert at all.
const CRITICAL_PARAMS: { keys: string[]; label: string }[] = [
  { keys: ['Accuracy', 'accuracy', 'Technical', 'technical'],                       label: 'Technically / Legally Incorrect' },
  { keys: ['IssueResolution', 'issue_resolution', 'AllQuestions', 'all_questions'], label: 'Issue Not Resolved / Questions Unanswered' },
  { keys: ['Process', 'process'],                                                   label: 'Process Incorrect' },
];

const FAIL_VALUES = new Set(['No', 'no', 'false', '0']);

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
  uncertainParameters?: Array<{ parameter: string; question: string }>;
}): Promise<void> {
  const token   = process.env.SLACK_BOT_TOKEN   || '';
  const channel = process.env.QUALITY_SLACK_CHANNEL || '';

  const failedParams = CRITICAL_PARAMS
    .map(p => {
      const hitKey = p.keys.find(k => FAIL_VALUES.has(String(opts.scores?.[k])));
      return hitKey ? { label: p.label, reasoning: opts.reasoning?.[hitKey] || 'No reasoning provided' } : null;
    })
    .filter((p): p is { label: string; reasoning: string } => p !== null);

  const hasUncertain = !!(opts.uncertainParameters && opts.uncertainParameters.length > 0);

  // Nothing to report at all — skip everything
  if (!failedParams.length && !hasUncertain) return;

  // Deduplicate — one alert per chat per 24 h
  if (await storeHasQualityAlert(opts.chatId)) {
    console.log(`[quality-alert] Skipping duplicate alert for chat ${opts.chatId}`);
    return;
  }
  await storeMarkQualityAlert(opts.chatId);

  // ── Slack — critical failures only (uncertain chats surface via Pending tab) ──
  if (failedParams.length && token && channel) {
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

  // ── Google Sheet — critical failures + uncertain chats ────────────────────
  const sheetParams = failedParams.length
    ? failedParams
    : (opts.uncertainParameters ?? []).map(u => ({ label: u.parameter, reasoning: `Needs QA review: ${u.question}` }));

  appendQualityAlertToSheet({
    chatId:         opts.chatId,
    agentName:      opts.agentName,
    contactPhone:   opts.contactPhone,
    iqs:            opts.iqs,
    csat:           opts.csat,
    disposition:    opts.disposition,
    subDisposition: opts.subDisposition,
    failedParams:   sheetParams,
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
