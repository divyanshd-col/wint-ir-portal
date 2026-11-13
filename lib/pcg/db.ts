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
 * Stores an incoming PCG webhook payload as-is in `pcg_webhook_payloads`.
 * A failed write THROWS: the webhook route answers 5xx so the sender can retry, instead of answering 200 and losing the event
 * (the same fix as saveRobylonWebhookPayload). Raw rows are not de-duplicated here: Runo sends several events per callId and
 * the downstream tables upsert, so a repeated delivery is harmless.
 */
export async function savePcgWebhookPayload(record: PcgWebhookPayloadRecord): Promise<void> {
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
}

