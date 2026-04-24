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
  if (!webhookUrl) {
    console.log('[quality-sheet] No webhook URL configured — skipping sheet append');
    return;
  }
  console.log(`[quality-sheet] Using webhook URL: ${webhookUrl.slice(0, 60)}…`);

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
    // Apps Script web apps process GET requests reliably. POST requests go
    // through an infrastructure redirect that may drop the body in Node.js.
    // We encode the payload as a URL parameter so doGet receives it directly.
    const url = new URL(webhookUrl);
    url.searchParams.set('payload', JSON.stringify(payload));

    const res = await fetch(url.toString(), { redirect: 'follow' });
    const body = await res.text();
    try {
      const json = JSON.parse(body);
      if (json.ok === false) {
        console.error(`[quality-sheet] Apps Script error for chat ${opts.chatId}:`, json.error);
        return;
      }
    } catch {}

    console.log(`[quality-sheet] Sent row for chat ${opts.chatId} (status ${res.status})`);
  } catch (err: any) {
    console.error('[quality-sheet] POST to Apps Script failed:', err.message);
  }
}
