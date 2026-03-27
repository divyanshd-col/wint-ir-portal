import { google } from 'googleapis';

const SHEET_ID = '1d8LE5opfdIDdsHYZ9AxaX1Z7TImUwAW_Kzk29xtzOTA';
const SHEET_TAB = 'Logs';

export interface LogEntry {
  timestamp: string;
  username: string;
  query: string;
  model: string;
}

function getAuth() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON not set');
  const credentials = JSON.parse(Buffer.from(raw, 'base64').toString('utf-8'));
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
}

/**
 * Reads all log rows from the Google Sheet.
 * Returns them newest-first, matching the same shape as readLogs().
 * Throws if the service account is not configured.
 */
export async function readLogsFromSheet(): Promise<LogEntry[]> {
  const auth = getAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_TAB}!A:D`,
  });

  const rows: string[][] = res.data.values || [];
  if (rows.length <= 1) return []; // only header or empty

  // Skip header row, parse the rest
  const entries: LogEntry[] = rows
    .slice(1)
    .filter(r => r[0] && r[1]) // must have timestamp + username
    .map(r => ({
      timestamp: r[0] || '',
      username: r[1] || '',
      query: r[2] || '',
      model: r[3] || '',
    }));

  // Newest-first
  return entries.reverse();
}
