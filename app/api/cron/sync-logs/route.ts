import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { google } from 'googleapis';
import { readLogs } from '@/lib/logger';

const SHEET_ID = '1d8LE5opfdIDdsHYZ9AxaX1Z7TImUwAW_Kzk29xtzOTA';
const SHEET_TAB = 'Logs';

function getAuth() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON env var not set');
  const credentials = JSON.parse(Buffer.from(raw, 'base64').toString('utf-8'));
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

async function getLastSyncedTimestamp(sheets: any): Promise<string | null> {
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_TAB}!A:A`,
    });
    const rows: string[][] = res.data.values || [];
    if (rows.length <= 1) return null;
    const last = rows[rows.length - 1][0];
    return last || null;
  } catch {
    return null;
  }
}

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
        requestBody: { values: [['Timestamp', 'Username', 'Query', 'Model', 'Category', 'Query Type']] },
      });
    }
  } catch {
    // Tab doesn't exist — create it
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: { requests: [{ addSheet: { properties: { title: SHEET_TAB } } }] },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_TAB}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [['Timestamp', 'Username', 'Query', 'Model', 'Category', 'Query Type']] },
    });
  }
}

async function runSync() {
  const auth = getAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  await ensureHeader(sheets);
  const lastTs = await getLastSyncedTimestamp(sheets);
  console.log(`[cron/sync-logs] Last synced timestamp: ${lastTs ?? 'none (first run)'}`);

  const logs = await readLogs();
  const newLogs = lastTs ? logs.filter(l => l.timestamp > lastTs) : logs;

  if (newLogs.length === 0) {
    console.log('[cron/sync-logs] No new logs to sync');
    return { synced: 0, lastTs };
  }

  const rows = [...newLogs].reverse().map(l => [l.timestamp, l.username, l.query, l.model, (l as any).category || '', (l as any).queryType || '']);

  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_TAB}!A:F`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: rows },
  });

  console.log(`[cron/sync-logs] Synced ${rows.length} new entries`);
  return { synced: rows.length, lastTs };
}

// Called by Vercel cron (hourly)
// Auth: x-vercel-cron header (automatically added by Vercel) OR CRON_SECRET bearer token
export async function GET(request: Request) {
  const isVercelCron = request.headers.get('x-vercel-cron') === '1';
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  const hasValidSecret = cronSecret && authHeader === `Bearer ${cronSecret}`;

  if (!isVercelCron && !hasValidSecret) {
    console.warn('[cron/sync-logs] Unauthorized GET — missing x-vercel-cron header and no valid CRON_SECRET');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await runSync();
    return NextResponse.json(result);
  } catch (err: any) {
    console.error('[cron/sync-logs] Error:', err?.message || err);
    return NextResponse.json({ error: err?.message || 'Unknown error' }, { status: 500 });
  }
}

// Called manually by admins from the Analytics page
export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!(session?.user as any)?.isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const result = await runSync();
    return NextResponse.json(result);
  } catch (err: any) {
    console.error('[cron/sync-logs] Manual sync error:', err?.message || err);
    return NextResponse.json({ error: err?.message || 'Unknown error' }, { status: 500 });
  }
}
