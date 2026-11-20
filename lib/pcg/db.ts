import { query } from '@/lib/cx/db';
import { ingestPcgEmailEvent } from '@/lib/pcg/email-db';

export * from '@/lib/pcg/email-db';

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


/**
 * Stores a Robylon email event that belongs to PCG (its inbox is in Settings → PCG → Email Inbox) as-is in `pcg_webhook_payloads`
 * (source 'robylon_email', channel 'email'). Same contract as saveRobylonWebhookPayload for CX:
 *  - a failed write THROWS, so the webhook answers 5xx and Robylon retries (it retries non-2xx, slow or unreachable deliveries
 *    about 5 more times over roughly 2 minutes, always with the same event_id);
 *  - an event_id already stored for this source is not stored again and returns 'duplicate' (a retry of a delivery we already have).
 */
export async function savePcgEmailEvent(record: { eventType?: string | null; eventId?: string | null; chatId?: string | null; payload: any }): Promise<'stored' | 'duplicate'> {
  // ponytail: check-then-insert, so two deliveries of one event arriving in the same instant can both land; a unique index on
  // (source, event_id) would close that, add it if duplicates ever show up.
  const rows = await query<{ id: number }>(
    `INSERT INTO pcg_webhook_payloads (source, channel, event_type, event_id, chat_id, payload)
     SELECT 'robylon_email', 'email', $1::text, $2::text, $3::text, $4::jsonb
     WHERE $2::text IS NULL
        OR NOT EXISTS (SELECT 1 FROM pcg_webhook_payloads WHERE source = 'robylon_email' AND event_id = $2::text)
     RETURNING id`,
    [record.eventType ?? null, record.eventId ?? null, record.chatId ?? null, JSON.stringify(record.payload)],
  );
  return rows.length ? 'stored' : 'duplicate';
}

/** True when an earlier event of this ticket was already stored as PCG. Used for events that name no inbox (some NEW_MESSAGE and
 *  INTERNAL_NOTE_ADDED): they follow the ticket. */
export async function isKnownPcgEmailTicket(chatId: string): Promise<boolean> {
  const rows = await query(`SELECT 1 FROM pcg_webhook_payloads WHERE source = 'robylon_email' AND chat_id = $1 LIMIT 1`, [chatId]);
  return rows.length > 0;
}

/**
 * Events of one ticket can arrive out of order: an inbox-less NEW_MESSAGE can reach us before the TICKET_CREATED that names the PCG
 * inbox, and was processed as CX. When the first PCG event of a ticket arrives, move whatever CX already holds for it into
 * pcg_webhook_payloads and remove the CX email rows (their evaluations go with them), so a PCG ticket never shows up in CX SLA
 * alerts, analytics or scores. One atomic statement for the raw rows. Returns how many raw events were moved.
 */
export async function adoptCxEmailTicketIntoPcg(chatId: string): Promise<number> {
  const moved = await query<{ id: number; payload: any }>(
    `WITH moved AS (
       DELETE FROM robylon_webhook_payloads WHERE source = 'email' AND chat_id = $1
       RETURNING event_type, event_id, chat_id, payload, headers, received_at
     )
     INSERT INTO pcg_webhook_payloads (source, channel, event_type, event_id, chat_id, payload, headers, received_at)
     SELECT 'robylon_email', 'email', m.event_type, m.event_id, m.chat_id, m.payload, m.headers, m.received_at
     FROM moved m
     WHERE m.event_id IS NULL OR NOT EXISTS (SELECT 1 FROM pcg_webhook_payloads p WHERE p.source = 'robylon_email' AND p.event_id = m.event_id)
     RETURNING id, payload`,
    [chatId],
  );
  // email_reply_evaluations rows go with their conversation (ON DELETE CASCADE).
  await query(`DELETE FROM email_conversations WHERE chat_id = $1`, [chatId]);

  // Ingest into pcg_email_conversations as well
  if (moved.length > 0) {
    for (const r of moved) {
      if (r.payload) {
        await ingestPcgEmailEvent(r.payload).catch((e: any) =>
          console.error('[adoptCxEmailTicketIntoPcg] Error ingesting to pcg_email_conversations:', e)
        );
      }
    }
  }

  return moved.length;
}
