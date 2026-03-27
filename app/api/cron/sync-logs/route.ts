import { NextResponse } from 'next/server';
import { google } from 'googleapis';
import { readLogs } from '@/lib/logger';

const SHEET_ID = '1d8LE5opfdIDdsHYZ9AxaX1Z7TImUwAW_Kzk29xtzOTA';
const SHEET_TAB = 'Logs'; // change if your tab is named differently

function getAuth() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON env var not set');
  const credentials = JSON.parse(Buffer.from(raw, 'base64').toString('utf-8'));
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

// Returns the latest ISO timestamp already in the sheet (col A), or null if sheet is empty
async function getLastSyncedTimestamp(sheets: any): Promise<string | null> {
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_TAB}!A:A`,
    });
    const rows: string[][] = res.data.values || [];
    // rows[0] is the header row ("Timestamp")
    if (rows.length <= 1) return null;
    // Last row with data
    const last = rows[rows.length - 1][0];
    return last || null;
  } catch {
    return null;
  }
}

// Ensures the header row exists; creates the sheet tab if needed
async function ensureHeader(sheets: any) {
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_TAB}!A1`,
    });
    if (!res.data.values?.length) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `${SHEET_TAB}!A1`,
        valueInputOption: 'RAW',
        requestBody: { values: [['Timestamp', 'Username', 'Query', 'Model']] },
      });
    }
  } catch {
    // Tab may not exist — create it then write header
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: { requests: [{ addSheet: { properties: { title: SHEET_TAB } } }] },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_TAB}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [['Timestamp', 'Username', 'Query', 'Model']] },
    });
  }
}

export async function GET(request: Request) {
  // Vercel cron requests include this header; reject anything else
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const auth = getAuth();
    const sheets = google.sheets({ version: 'v4', auth });

    await ensureHeader(sheets);
    const lastTs = await getLastSyncedTimestamp(sheets);
    console.log(`[cron/sync-logs] Last synced timestamp in sheet: ${lastTs ?? 'none'}`);

    const logs = await readLogs(); // newest-first from Redis
    // Keep only logs newer than what's already in the sheet
    const newLogs = lastTs
      ? logs.filter(l => l.timestamp > lastTs)
      : logs;

    if (newLogs.length === 0) {
      console.log('[cron/sync-logs] No new logs to sync');
      return NextResponse.json({ synced: 0 });
    }

    // Append oldest-first so sheet stays chronological
    const rows = [...newLogs].reverse().map(l => [l.timestamp, l.username, l.query, l.model]);

    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_TAB}!A:D`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: rows },
    });

    console.log(`[cron/sync-logs] Synced ${rows.length} new log entries`);
    return NextResponse.json({ synced: rows.length });
  } catch (err: any) {
    console.error('[cron/sync-logs] Error:', err?.message || err);
    return NextResponse.json({ error: err?.message || 'Unknown error' }, { status: 500 });
  }
}
