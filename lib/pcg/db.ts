import { query } from '@/lib/cx/db';

export interface PcgWebhookPayloadRecord {
  source: string;
  channel?: string | null;
  eventType?: string | null;
  eventId?: string | null;
  chatId?: string | null;
  payload: any;
  headers?: any;
}

/**
 * Stores incoming PCG webhook payloads as-is into `pcg_webhook_payloads`.
 * Catches and logs errors so that failure to log never interrupts webhook processing.
 */
export async function savePcgWebhookPayload(record: PcgWebhookPayloadRecord): Promise<void> {
  try {
    const channel =
      record.channel ??
      (record.source === 'doubletick' ? 'whatsapp' : record.source === 'runo' ? 'call' : null);

    await query(
      `INSERT INTO pcg_webhook_payloads (source, channel, event_type, event_id, chat_id, payload, headers)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        record.source,
        channel,
        record.eventType ?? null,
        record.eventId ?? null,
        record.chatId ?? null,
        JSON.stringify(record.payload),
        record.headers ? JSON.stringify(record.headers) : null,
      ]
    );
  } catch (err: any) {
    console.error('[pcg-db] Failed to save PCG webhook payload:', err?.message || err);
  }
}

