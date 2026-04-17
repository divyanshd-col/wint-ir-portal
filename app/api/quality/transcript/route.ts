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

  // Fall back to DB transcript column
  const rows = await query<{ transcript: any }>(`SELECT transcript FROM conversations WHERE id = $1`, [chatId]);
  if (!rows.length || !rows[0].transcript) return NextResponse.json({ ok: true, found: false });

  let messages: any[] = [];
  const raw = rows[0].transcript;
  if (Array.isArray(raw)) messages = raw;
  else if (raw && Array.isArray(raw.messages)) messages = raw.messages;

  if (!messages.length) return NextResponse.json({ ok: true, found: false });

  const timedMessages = dbMessagesToTimedMessages(messages);
  return NextResponse.json({ ok: true, found: true, timedMessages });
}
