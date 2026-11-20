import { query } from '@/lib/cx/db';

export interface ExotelSyncOptions {
  limit?: number;
  startDateOverride?: string;
}

export interface ExotelSyncResult {
  success: boolean;
  insertedCount: number;
  watermark: string;
  totalFetched: number;
  error?: string;
}

// Default initial cutoff: 2026-11-13 17:45:00 IST (implementation start time)
// Any call created before this timestamp is strictly excluded.
const DEFAULT_INITIAL_CUTOFF = '2026-11-13T17:45:00+05:30';

export async function syncExotelCalls(options?: ExotelSyncOptions): Promise<ExotelSyncResult> {
  const accountSid = process.env.EXOTEL_ACCOUNT_SID || 'wintwealth1';
  const subdomain = process.env.EXOTEL_SUBDOMAIN || 'api.exotel.com';
  const apiKey = process.env.EXOTEL_API_KEY;
  const apiToken = process.env.EXOTEL_API_TOKEN;

  if (!apiKey || !apiToken) {
    return {
      success: false,
      insertedCount: 0,
      totalFetched: 0,
      watermark: '',
      error: 'Missing EXOTEL_API_KEY or EXOTEL_API_TOKEN environment variables',
    };
  }

  // 1. Determine watermark: latest called_at in DB or initial cutoff
  const maxRow = await query<{ max_called: string | null }>(`
    SELECT MAX(called_at) as max_called FROM exotel_call_recordings
  `);

  let watermarkDate: Date;
  if (options?.startDateOverride) {
    watermarkDate = new Date(options.startDateOverride);
  } else if (maxRow[0]?.max_called) {
    watermarkDate = new Date(maxRow[0].max_called);
  } else {
    const envCutoff = process.env.EXOTEL_SYNC_START_DATE || DEFAULT_INITIAL_CUTOFF;
    watermarkDate = new Date(envCutoff);
  }

  const limit = options?.limit || 100;
  const authHeader = Buffer.from(`${apiKey}:${apiToken}`).toString('base64');
  const url = `https://${subdomain}/v1/Accounts/${accountSid}/Calls.json?SortBy=DateCreated:desc&Limit=${limit}`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Basic ${authHeader}`,
    },
  });

  if (!res.ok) {
    const errorText = await res.text();
    return {
      success: false,
      insertedCount: 0,
      totalFetched: 0,
      watermark: watermarkDate.toISOString(),
      error: `Exotel API error (${res.status} ${res.statusText}): ${errorText}`,
    };
  }

  const data = await res.json();
  const rawCalls: any[] = Array.isArray(data?.Calls) ? data.Calls : [];

  let insertedCount = 0;

  for (const call of rawCalls) {
    if (!call.Sid || !call.DateCreated) continue;

    const callDate = new Date(call.DateCreated);
    // Strictly filter out calls created before the watermark
    if (callDate < watermarkDate) {
      continue;
    }

    const durationSec = parseInt(call.Duration || '0', 10);
    const recordingUrl = call.RecordingUrl && call.RecordingUrl.trim().length > 0 ? call.RecordingUrl.trim() : null;

    await query(
      `INSERT INTO exotel_call_recordings (
        call_sid, agent_phone, customer_phone, duration_seconds,
        recording_url, status, direction, called_at, raw_payload
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (call_sid) DO UPDATE SET
        recording_url = COALESCE(EXCLUDED.recording_url, exotel_call_recordings.recording_url),
        duration_seconds = EXCLUDED.duration_seconds,
        status = EXCLUDED.status`,
      [
        call.Sid,
        call.From || null,
        call.To || null,
        isNaN(durationSec) ? 0 : durationSec,
        recordingUrl,
        call.Status || null,
        call.Direction || null,
        callDate.toISOString(),
        JSON.stringify(call),
      ]
    );

    insertedCount++;
  }

  return {
    success: true,
    insertedCount,
    totalFetched: rawCalls.length,
    watermark: watermarkDate.toISOString(),
  };
}

