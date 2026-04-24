/**
 * Appends a quality alert row to a Google Sheet via a Google Apps Script web app.
 *
 * Setup:
 *  1. In your Google Sheet, open Extensions → Apps Script and paste the script
 *     from docs/quality-alert-appscript.js
 *  2. Deploy it as a web app (Execute as: Me, Who has access: Anyone)
 *  3. Paste the deployment URL into Settings → Integrations → Quality Alert Sheet
 *
 * No service account or API key needed — the Apps Script runs as you.
 */

import { readConfig } from './config';

export async function appendQualityAlertToSheet(opts: {
  chatId: string;
  agentName: string;
  contactPhone?: string;
  iqs?: number;
  csat?: string;
  disposition?: string;
  subDisposition?: string;
  failedParams: { label: string; reasoning: string }[];
}): Promise<void> {
  // Env var takes precedence; fall back to portal config
  let webhookUrl = process.env.QUALITY_ALERT_SHEET_URL || '';
  if (!webhookUrl) {
    try {
      const config = await readConfig();
      webhookUrl = config.qualityAlertSheetUrl || '';
    } catch {}
  }
  if (!webhookUrl) return;

  const csatLabel: Record<string, string> = { '5': 'Good', '3': 'CBB', '1': 'Bad' };

  const payload = {
    date:           new Date().toISOString().slice(0, 19).replace('T', ' '),
    chatId:         opts.chatId,
    agentName:      opts.agentName || 'Unknown',
    contactPhone:   opts.contactPhone || '',
    iqs:            opts.iqs != null ? `${opts.iqs}%` : '',
    csat:           opts.csat ? (csatLabel[opts.csat] || opts.csat) : '',
    disposition:    opts.disposition || '',
    subDisposition: opts.subDisposition || '',
    failedParams:   opts.failedParams.map(p => p.label).join(', '),
    reasoning:      opts.failedParams.map(p => `${p.label}: ${p.reasoning}`).join(' | '),
  };

  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    console.log(`[quality-sheet] Appended row for chat ${opts.chatId}`);
  } catch (err: any) {
    console.error('[quality-sheet] POST to Apps Script failed:', err.message);
  }
}
