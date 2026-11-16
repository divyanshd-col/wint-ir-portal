import { NextRequest, NextResponse } from 'next/server';
import { closeInactivePcgConversations, PCG_INACTIVITY_HOURS } from '@/lib/pcg/doubletick';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

/**
 * GET /api/cron/pcg-close-inactive
 *
 * Automated cron & on-demand maintenance endpoint for PCG Conversations.
 * Identifies all OPEN pcg_conversations with no message activity for >= 48 hours
 * (or ?hours=<custom>), transitions them to status='CLOSED', and logs closed_at.
 */
function isAuthorized(req: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return true;
  const auth = req.headers.get('authorization') || '';
  if (auth === `Bearer ${cronSecret}`) return true;
  const { searchParams } = new URL(req.url);
  if (searchParams.get('secret') === cronSecret) return true;
  return false;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized: Invalid cron secret' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const hoursParam = searchParams.get('hours');
  const inactivityHours = hoursParam && !isNaN(parseInt(hoursParam, 10))
    ? Math.max(1, parseInt(hoursParam, 10))
    : PCG_INACTIVITY_HOURS;

  try {
    const result = await closeInactivePcgConversations(inactivityHours);

    // Auto-evaluate 100% of newly closed PCG chats via gemini-3.5-flash bot pipeline
    if (result.closed && result.closed.length > 0) {
      try {
        const { runPcgChatPipeline } = await import('@/lib/scoring/pcg-chat-pipeline');
        for (const item of result.closed) {
          runPcgChatPipeline(item).catch((e: any) =>
            console.error('[pcg-close-inactive] Auto-eval error for closed chat:', e?.message || e)
          );
        }
      } catch (pipeErr: any) {
        console.warn('[pcg-close-inactive] Warning triggering auto-eval pipeline:', pipeErr?.message || pipeErr);
      }
    }

    return NextResponse.json({
      success: true,
      message: `Successfully closed ${result.closedCount} PCG conversation(s) inactive for >= ${inactivityHours} hours.`,
      inactivityHoursThreshold: inactivityHours,
      closedCount: result.closedCount,
      closedConversations: result.closed,
      executedAt: new Date().toISOString(),
    }, { status: 200 });
  } catch (err: any) {
    console.error('[cron/pcg-close-inactive] Error:', err?.message || err);
    return NextResponse.json(
      {
        success: false,
        error: err?.message || 'Failed to close inactive PCG conversations',
      },
      { status: 500 }
    );
  }
}

