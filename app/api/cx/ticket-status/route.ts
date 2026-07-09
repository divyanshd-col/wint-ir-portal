const ROUTE = 'cx/ticket-status';
import { log, withLogging } from '@/lib/log';
import { NextRequest, NextResponse } from 'next/server';
import { getLatestConversationByPhone } from '@/lib/robylon/db';

/**
 * GET /api/cx/ticket-status?phone=918626985252
 *
 * Returns the Ticket Raised status for the most recently closed chat
 * belonging to the given phone number.
 *
 * Auth: CX_API_KEY header (set CX_API_KEY env var), or open if not configured.
 */
async function _GET(req: NextRequest): Promise<NextResponse> {
  const apiKey = process.env.CX_API_KEY;
  if (apiKey) {
    const provided = req.headers.get('x-api-key') || req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
    if (provided !== apiKey) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }
  }

  const phone = new URL(req.url).searchParams.get('phone')?.trim();
  if (!phone) {
    return NextResponse.json({ error: 'phone query param is required' }, { status: 400 });
  }

  const row = await getLatestConversationByPhone(phone);
  if (!row) {
    return NextResponse.json({ found: false, phone, ticketRaised: null, chatId: null, closedAt: null });
  }

  const tags = row.tags || {};
  return NextResponse.json({
    found: true,
    phone,
    chatId:      row.chatId,
    closedAt:    row.closedAt,
    agentName:   row.agentName || null,
    ticketRaised: tags.ticket_raised || null,
  });
}

export const GET = withLogging(ROUTE, _GET);
