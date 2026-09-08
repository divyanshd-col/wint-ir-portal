/**
 * Appends a compliance breach alert row to the Compliance Google Sheet.
 *
 * Supports two methods:
 *  1. Google Apps Script Web App (via COMPLIANCE_ALERT_SHEET_URL) - Recommended
 *  2. Direct Google Sheets API via service account (via COMPLIANCE_SHEET_ID)
 */

import { google } from 'googleapis';
import { readConfig } from './config';

export const COMPLIANCE_DEFAULT_SHEET_ID = '1IgPoXykhI9dSswVDGxto_hfmvhmhNaNKDmwqXggGmGY';

export interface ComplianceAlertSheetOpts {
  chatId: string;
  agentName: string;
  tl?: string;
  contactPhone?: string;
  iqs?: number | null;
  disposition?: string;
  subDisposition?: string;
  breaches?: Array<{ type: string; quote: string; note?: string }>;
  accuracyFailure?: { label: string; reasoning: string };
}

function getServiceAccountAuth() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  try {
    let credentials: any;
    try {
      credentials = JSON.parse(raw);
    } catch {
      credentials = JSON.parse(Buffer.from(raw, 'base64').toString('utf-8'));
    }
    return new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
  } catch (err) {
    console.error('[compliance-sheet] Failed to parse GOOGLE_SERVICE_ACCOUNT_JSON:', err);
    return null;
  }
}

export async function appendComplianceAlertToSheet(opts: ComplianceAlertSheetOpts): Promise<void> {
  let webhookUrl = process.env.COMPLIANCE_ALERT_SHEET_URL || '';
  if (!webhookUrl) {
    try {
      const config = await readConfig();
      webhookUrl = (config as any).complianceAlertSheetUrl || '';
    } catch {}
  }

  const sheetId = process.env.COMPLIANCE_SHEET_ID || COMPLIANCE_DEFAULT_SHEET_ID;

  const breaches = opts.breaches || [];
  const breachTypes = breaches.map(b => b.type).join(', ') || (opts.accuracyFailure ? 'ACCURACY' : 'COMPLIANCE');
  
  const reasons: string[] = [];
  for (const b of breaches) {
    const noteStr = b.note ? ` (${b.note})` : '';
    const quoteStr = b.quote ? `: "${b.quote}"` : '';
    reasons.push(`${b.type.toUpperCase()}${quoteStr}${noteStr}`);
  }
  if (opts.accuracyFailure) {
    reasons.push(`TECHNICALLY / LEGALLY INCORRECT: ${opts.accuracyFailure.reasoning}`);
  }
  const reasonText = reasons.join(' | ');

  const dateStr = new Date().toISOString().slice(0, 19).replace('T', ' ');

  const payload = {
    date:           dateStr,
    chatId:         opts.chatId,
    agentName:      opts.agentName || 'Unknown',
    tl:             opts.tl || 'N/A',
    contactPhone:   opts.contactPhone || '',
    iqs:            opts.iqs != null ? `${opts.iqs}%` : '',
    disposition:    opts.disposition || '',
    subDisposition: opts.subDisposition || '',
    breachType:     breachTypes,
    reasoning:      reasonText,
  };

  // Method 1: Via Apps Script Webhook URL (if configured)
  if (webhookUrl) {
    try {
      const url = new URL(webhookUrl);
      url.searchParams.set('payload', JSON.stringify(payload));
      const res = await fetch(url.toString(), { redirect: 'follow' });
      const body = await res.text();
      try {
        const json = JSON.parse(body);
        if (json.ok === false) {
          console.error(`[compliance-sheet] Apps Script error for chat ${opts.chatId}:`, json.error);
          return;
        }
      } catch {}
      console.log(`[compliance-sheet] Sent compliance row to Apps Script for chat ${opts.chatId} (status ${res.status})`);
      return;
    } catch (err: any) {
      console.error('[compliance-sheet] Webhook call failed:', err.message);
    }
  }

  // Method 2: Direct Google Sheets API via Service Account
  const auth = getServiceAccountAuth();
  if (auth && sheetId) {
    try {
      const sheets = google.sheets({ version: 'v4', auth });
      const row = [
        payload.date,
        payload.chatId,
        payload.agentName,
        payload.tl,
        payload.contactPhone,
        payload.iqs,
        payload.disposition,
        payload.subDisposition,
        payload.breachType,
        payload.reasoning,
      ];

      await sheets.spreadsheets.values.append({
        spreadsheetId: sheetId,
        range: `'Sheet1'!A:J`,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [row],
        },
      });

      console.log(`[compliance-sheet] Appended compliance row to Google Sheet ${sheetId} for chat ${opts.chatId}`);
      return;
    } catch (err: any) {
      if (err?.message?.includes('has not been used in project') || err?.message?.includes('disabled')) {
        console.warn('[compliance-sheet] Direct Sheets API disabled on GCP project. Please deploy Apps Script web app and set COMPLIANCE_ALERT_SHEET_URL.');
      } else {
        console.error('[compliance-sheet] Direct Sheets API append failed:', err?.message || err);
      }
    }
  }
}
