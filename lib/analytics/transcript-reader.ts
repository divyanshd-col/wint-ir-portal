import { query } from '@/lib/cx/db';

export interface TranscriptMessage {
  sender_type: 'customer' | 'agent' | 'bot';
  content: string;
  timestamp: string;
}

export interface ConversationTranscript {
  conversation_id: string;
  csat_label: string | null;
  csat_score: number | null;
  disposition: string | null;
  sub_disposition: string | null;
  iqs_score: number | null;
  messages: TranscriptMessage[];
}

export async function readTranscripts(conversationIds: string[]): Promise<ConversationTranscript[]> {
  if (!conversationIds.length) return [];
  const ids = conversationIds.slice(0, 20);

  const rows = await query<any>(
    `SELECT c.id, c.csat_label, c.csat_score,
            c.tags->>'disposition'     AS disposition,
            c.tags->>'sub_disposition' AS sub_disposition,
            c.transcript,
            i.iqs_score
     FROM conversations c
     LEFT JOIN iqs_scores i ON i.chat_id = c.id
     WHERE c.id = ANY($1)`,
    [ids],
  );

  return rows.map(r => {
    let messages: TranscriptMessage[] = [];
    if (r.transcript) {
      let t = r.transcript;
      if (typeof t === 'string') { try { t = JSON.parse(t); } catch { t = []; } }
      if (Array.isArray(t)) {
        messages = t.map((m: any) => ({
          sender_type: m.sender_type ?? m.senderType ?? 'agent',
          content:     m.content ?? m.message ?? '',
          timestamp:   m.timestamp ?? '',
        }));
      }
    }
    return {
      conversation_id: r.id,
      csat_label:      r.csat_label,
      csat_score:      r.csat_score,
      disposition:     r.disposition,
      sub_disposition: r.sub_disposition,
      iqs_score:       r.iqs_score,
      messages,
    };
  });
}
