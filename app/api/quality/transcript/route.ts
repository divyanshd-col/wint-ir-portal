import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { storeGetTranscript } from '@/lib/store';
import { query } from '@/lib/cx/db';
import { log } from '@/lib/log';
import { readConfig } from '@/lib/config';
import {
  getAllCallRecordingsByChatId,
  getCallRecordingsByConversationContact,
  getCallRecordingsByContactWindow,
  linkCallToChat,
} from '@/lib/robylon/db';
import { scoreLinkedCallsForChat, transcriptFromJsonb } from '@/app/api/webhooks/chat/route';

const ROUTE = 'quality/transcript';

function qualityAccess(session: any): boolean {
  const role = session?.user?.role;
  return !!role && ['admin', 'quality', 'tl', 'agent'].includes(role);
}

// Collapse internal newlines and extra spaces — WhatsApp line breaks within a bubble
// become a single space so the portal display matches Robylon's rendered view.
function normalizeContent(raw: string): string {
  return (raw || '').replace(/\r\n|\r|\n/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

// Filter out Robylon internal system annotations (e.g. "918758589296 {ticket_raised}")
// sent by "Robylon AI" — these are never visible to customers and must not appear in the portal.
const ROBYLON_INTERNAL_ANNOTATION = /^[\d\s+()-]*(\{[^}]+\}\s*)+$/;
function isInternalAnnotation(senderName: string, content: string): boolean {
  if ((senderName || '').toLowerCase().includes('robylon')) return true;
  return ROBYLON_INTERNAL_ANNOTATION.test(content.trim());
}

function dbMessagesToTimedMessages(messages: any[]): { sender: string; content: string; timestamp?: string }[] {
  return messages.map((m: any) => ({
    sender: m.sender_type === 'customer' ? 'user'
          : m.sender_type === 'bot'      ? 'bot'
          : m.sender_type === 'activity' ? 'activity'
          : (m.sender_name || 'Agent'),
    content: normalizeContent(m.content || m.text || ''),
    senderName: m.sender_name || m.sender || '',
    timestamp: m.timestamp,
  })).filter(m => m.content && !isInternalAnnotation(m.senderName, m.content));
}

function parseRobyTimestamp(ts: string, year: number): string {
  try {
    const match = (ts || '').match(/^(\w+)\s+(\d+),\s+(\d+):(\d+)\s+(AM|PM)$/);
    if (!match) return ts;
    const [, mon, day, hr, min, ampm] = match;
    let hour = parseInt(hr, 10);
    if (ampm === 'PM' && hour !== 12) hour += 12;
    if (ampm === 'AM' && hour === 12) hour = 0;
    const months: Record<string, number> = {
      Jan:0, Feb:1, Mar:2, Apr:3, May:4, Jun:5,
      Jul:6, Aug:7, Sep:8, Oct:9, Nov:10, Dec:11,
    };
    const monthIdx = months[mon];
    if (monthIdx === undefined) return ts;
    const d = new Date(Date.UTC(year, monthIdx, parseInt(day, 10), hour, parseInt(min, 10)));
    d.setMinutes(d.getMinutes() - 330); // IST → UTC
    return d.toISOString();
  } catch { return ts; }
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !qualityAccess(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const chatId = req.nextUrl.searchParams.get('chatId');
  if (!chatId) return NextResponse.json({ error: 'chatId required' }, { status: 400 });

  try {
    const t0 = Date.now();

    // Fetch conversation row first to obtain contact details, dates and tags
    const convRows = await query<any>(
      `SELECT transcript, raw_payload, closed_at, tags, contact_id, started_at FROM conversations WHERE id = $1`,
      [chatId]
    );

    if (convRows.length > 0) {
      const chatConv = convRows[0];

      // Perform 3-stage call recording lookup
      const seenIds = new Set<string>();
      const allRecs: any[] = [];
      
      function addRecs(rows: any[]) {
        for (const r of rows) {
          if (r?.id && !seenIds.has(String(r.id))) {
            seenIds.add(String(r.id));
            allRecs.push(r);
          }
        }
      }

      try { addRecs(await getAllCallRecordingsByChatId(chatId)); } catch {}
      try { addRecs(await getCallRecordingsByConversationContact(chatId)); } catch {}
      if (chatConv?.contact_id) {
        const windowStart = chatConv.started_at ?? new Date(Date.now() - 24 * 3600 * 1000).toISOString();
        const windowEnd   = chatConv.closed_at  ?? new Date().toISOString();
        try { addRecs(await getCallRecordingsByContactWindow(chatConv.contact_id, windowStart, windowEnd)); } catch {}
      }

      let needsScoring = false;
      for (const r of allRecs) {
        let isTranscribed = false;
        if (r.transcript) {
          try {
            const parsed = typeof r.transcript === 'string' ? JSON.parse(r.transcript) : r.transcript;
            isTranscribed = Array.isArray(parsed) && parsed.length > 0;
          } catch {}
        }
        if (r.chat_id !== chatId) {
          await linkCallToChat(r.id, chatId);
          if (!isTranscribed && r.recording_url) {
            needsScoring = true;
          }
        } else {
          if (!isTranscribed && r.recording_url) {
            await query(`UPDATE call_recordings SET status = 'linked' WHERE id = $1`, [r.id]);
            needsScoring = true;
          }
        }
      }

      if (needsScoring) {
        let messages: any[] = [];
        let rawTranscript = chatConv.transcript;
        if (typeof rawTranscript === 'string') {
          try { rawTranscript = JSON.parse(rawTranscript); } catch { rawTranscript = null; }
        }
        if (Array.isArray(rawTranscript) && rawTranscript.length) {
          messages = rawTranscript;
        } else if (rawTranscript && Array.isArray(rawTranscript.messages) && rawTranscript.messages.length) {
          messages = rawTranscript.messages;
        }

        const hasActivity = messages.some((m: any) => m.sender_type === 'activity');
        if ((!messages.length || !hasActivity) && chatConv.raw_payload) {
          const payload = chatConv.raw_payload;
          const payloadMsgs = payload?.data?.transcript?.messages;
          if (Array.isArray(payloadMsgs) && payloadMsgs.length) {
            const closedAt = chatConv.closed_at;
            const year = closedAt ? new Date(closedAt).getUTCFullYear() : new Date().getUTCFullYear();
            messages = payloadMsgs.map((m: any) => {
              const sender = (m.sender || '').trim();
              const content = (m.content || m.text || '').trim();
              if (!content) return null;
              const low = content.toLowerCase();
              if (low.includes('auto-assigned') || low.includes('assigned by') || low.includes('waiting to assign')) {
                const isoTs = m.timestamp ? parseRobyTimestamp(m.timestamp, year) : undefined;
                return { sender_type: 'activity', sender_name: 'system', content, timestamp: isoTs };
              }
              if (low.includes('please rate your experience') || m.buttons) return null;
              const isoTs = m.timestamp ? parseRobyTimestamp(m.timestamp, year) : undefined;
              const senderLow = sender.toLowerCase();
              const senderType = senderLow === 'user' || senderLow === 'customer' ? 'customer'
                               : senderLow === 'bot' || senderLow === 'myra' ? 'bot'
                               : 'agent';
              return { sender_type: senderType, sender_name: sender, content, timestamp: isoTs };
            }).filter(Boolean);
          }
        }

        const timedMessages = dbMessagesToTimedMessages(messages);
        const chatTranscriptText = transcriptFromJsonb(timedMessages);
        const tags = chatConv.tags || {};
        const disposition = tags.disposition || '';
        const subDisposition = tags.sub_disposition || '';
        const config = await readConfig();
        await scoreLinkedCallsForChat(chatId, chatTranscriptText, disposition, subDisposition, config);
      }
    }

    // Check KV first
    const kvData = await storeGetTranscript(chatId);
    if (kvData?.timedMessages?.length || kvData?.rawTranscript) {
      const callRows = await query<any>(
        `SELECT id, recording_url, duration_seconds, called_at, language, transcript, status, interruption_count, dead_air_count
         FROM call_recordings WHERE chat_id = $1 ORDER BY called_at ASC`,
        [chatId]
      );
      const callRecordings = callRows.map(r => ({
        id: r.id,
        recordingUrl: r.recording_url,
        durationSeconds: r.duration_seconds,
        calledAt: r.called_at,
        language: r.language,
        segments: Array.isArray(r.transcript) ? r.transcript : [],
        status: r.status,
        interruptionCount: r.interruption_count || 0,
        deadAirCount: r.dead_air_count || 0,
      }));
      log.info(ROUTE, 'hit', { chatId, source: 'kv', messageCount: kvData.timedMessages?.length ?? 0, callCount: callRecordings.length, durationMs: Date.now() - t0 });
      return NextResponse.json({ ok: true, found: true, ...kvData, callRecordings });
    }

    // Fall back to DB: check transcript column, then raw_payload
    const rows = convRows;
    let messages: any[] = [];
    if (rows.length > 0) {
      let rawTranscript = rows[0].transcript;
      if (typeof rawTranscript === 'string') {
        try { rawTranscript = JSON.parse(rawTranscript); } catch { rawTranscript = null; }
      }
      if (Array.isArray(rawTranscript) && rawTranscript.length) {
        messages = rawTranscript;
      } else if (rawTranscript && Array.isArray(rawTranscript.messages) && rawTranscript.messages.length) {
        messages = rawTranscript.messages;
      }

      // 2. Reconstruct from raw_payload if missing activity messages or empty transcript
      const hasActivity = messages.some((m: any) => m.sender_type === 'activity');
      if ((!messages.length || !hasActivity) && rows[0].raw_payload) {
        const payload = rows[0].raw_payload;
        const payloadMsgs = payload?.data?.transcript?.messages;
        if (Array.isArray(payloadMsgs) && payloadMsgs.length) {
          const closedAt = rows[0].closed_at;
          const year = closedAt ? new Date(closedAt).getUTCFullYear() : new Date().getUTCFullYear();

          const rawHasActivity = payloadMsgs.some((m: any) => {
            const c = (m.content || m.text || '').toLowerCase();
            return c.includes('auto-assigned') || c.includes('assigned by') || c.includes('waiting to assign');
          });

          if (rawHasActivity || !messages.length) {
            messages = payloadMsgs.map((m: any) => {
              const sender = (m.sender || '').trim();
              const content = (m.content || m.text || '').trim();
              if (!content) return null;
              const low = content.toLowerCase();

              if (low.includes('auto-assigned') || low.includes('assigned by') || low.includes('waiting to assign')) {
                const isoTs = m.timestamp ? parseRobyTimestamp(m.timestamp, year) : undefined;
                return {
                  sender_type: 'activity',
                  sender_name: 'system',
                  content,
                  timestamp: isoTs,
                };
              }

              if (low.includes('please rate your experience') || m.buttons) return null;

              const isoTs = m.timestamp ? parseRobyTimestamp(m.timestamp, year) : undefined;
              const senderLow = sender.toLowerCase();
              const senderType = senderLow === 'user' || senderLow === 'customer' ? 'customer'
                               : senderLow === 'bot' || senderLow === 'myra' ? 'bot'
                               : 'agent';

              return {
                sender_type: senderType,
                sender_name: sender,
                content,
                timestamp: isoTs,
              };
            }).filter(Boolean);
          }
        }
      }
    }

    const callRows = await query<any>(
      `SELECT id, recording_url, duration_seconds, called_at, language, transcript, status, interruption_count, dead_air_count
       FROM call_recordings WHERE chat_id = $1 ORDER BY called_at ASC`,
      [chatId]
    );
    const callRecordings = callRows.map(r => ({
      id: r.id,
      recordingUrl: r.recording_url,
      durationSeconds: r.duration_seconds,
      calledAt: r.called_at,
      language: r.language,
      segments: Array.isArray(r.transcript) ? r.transcript : [],
      status: r.status,
      interruptionCount: r.interruption_count || 0,
      deadAirCount: r.dead_air_count || 0,
    }));

    if (!messages.length && !callRecordings.length) {
      log.warn(ROUTE, 'not found', { chatId, durationMs: Date.now() - t0 });
      return NextResponse.json({ ok: true, found: false });
    }

    const timedMessages = dbMessagesToTimedMessages(messages);
    log.info(ROUTE, 'hit', { chatId, source: 'db', messageCount: timedMessages.length, callCount: callRecordings.length, durationMs: Date.now() - t0 });
    return NextResponse.json({ ok: true, found: true, timedMessages, callRecordings });
  } catch (err: any) {
    log.error(ROUTE, 'db error', { chatId, err: err?.message });
    return NextResponse.json({ error: 'DB error', detail: err?.message }, { status: 500 });
  }
}
