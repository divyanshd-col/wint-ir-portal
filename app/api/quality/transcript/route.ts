import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { storeGetTranscript } from '@/lib/store';
import { query } from '@/lib/cx/db';

function qualityAccess(session: any): boolean {
  const role = session?.user?.role;
  return !!role && ['admin', 'quality', 'tl', 'agent'].includes(role);
}

function dbMessagesToTimedMessages(messages: any[]): { sender: string; content: string; timestamp?: string }[] {
  return messages.map((m: any) => ({
    sender: m.sender_type === 'customer' ? 'user'
          : m.sender_type === 'bot'      ? 'bot'
          : (m.sender_name || 'Agent'),
    content: m.content || '',
    timestamp: m.timestamp,
  })).filter(m => m.content);
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !qualityAccess(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const chatId = req.nextUrl.searchParams.get('chatId');
  if (!chatId) return NextResponse.json({ error: 'chatId required' }, { status: 400 });

  // Check KV first
  const kvData = await storeGetTranscript(chatId);
  if (kvData) return NextResponse.json({ ok: true, found: true, ...kvData });

  // Fall back to DB: check transcript column, then raw_payload
  const rows = await query<{ transcript: any; raw_payload: any }>(
    `SELECT transcript, raw_payload FROM conversations WHERE id = $1`, [chatId]
  );
  if (!rows.length) return NextResponse.json({ ok: true, found: false });

  let messages: any[] = [];

  // 1. conversations.transcript (stored by webhook handler)
  const rawTranscript = rows[0].transcript;
  if (Array.isArray(rawTranscript) && rawTranscript.length) {
    messages = rawTranscript;
  } else if (rawTranscript && Array.isArray(rawTranscript.messages) && rawTranscript.messages.length) {
    messages = rawTranscript.messages;
  }

  // 2. raw_payload.data.transcript.messages (full webhook body stored at TICKET_CLOSED)
  if (!messages.length && rows[0].raw_payload) {
    const payload = rows[0].raw_payload;
    const payloadMsgs = payload?.data?.transcript?.messages;
    if (Array.isArray(payloadMsgs) && payloadMsgs.length) {
      // raw_payload messages use a different schema — map them
      messages = payloadMsgs.map((m: any) => ({
        sender_type: m.sender === 'User' || m.sender === 'user' ? 'customer'
                   : m.sender === 'Bot'  || m.sender === 'bot'  ? 'bot'
                   : 'agent',
        sender_name: m.sender,
        content: m.content || m.text || '',
        timestamp: m.timestamp,
      })).filter((m: any) => m.content);
    }
  }

  if (!messages.length) return NextResponse.json({ ok: true, found: false });

  const timedMessages = dbMessagesToTimedMessages(messages);
  return NextResponse.json({ ok: true, found: true, timedMessages });
}
