import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/cx/db';
import { runPcgChatPipeline } from '@/lib/scoring/pcg-chat-pipeline';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 mins on Vercel

function isAuthorized(req: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return true;
  const auth = req.headers.get('authorization') || '';
  if (auth === `Bearer ${cronSecret}`) return true;
  const { searchParams } = new URL(req.url);
  if (searchParams.get('secret') === cronSecret) return true;
  return false;
}

/**
 * GET /api/cron/process-pcg-chat-evaluations
 *
 * Automated cron and on-demand endpoint to evaluate 100% of closed PCG WhatsApp chats
 * using the gemini-3.5-flash evaluation pipeline with dynamic NA math and Wint KB verification.
 */
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized: Invalid cron secret' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '30', 10)));
  const concurrency = Math.min(5, Math.max(1, parseInt(searchParams.get('concurrency') || '3', 10)));

  try {
    // 1. Find closed conversations that do not yet have an evaluation in pcg_chat_evaluations
    const pending = await query<any>(`
      SELECT c.id, c.customer_phone, c.waba_number, c.customer_name, c.assigned_rm_id, c.rm_name,
             c.total_messages, c.status, c.closed_at, c.last_message_at, c.transcript
      FROM pcg_conversations c
      WHERE (c.status = 'CLOSED' OR c.closed_at IS NOT NULL)
        AND NOT EXISTS (
          SELECT 1 FROM pcg_chat_evaluations e
          WHERE e.conversation_id = c.id
             OR (e.customer_phone = c.customer_phone AND e.chat_closed_at = COALESCE(c.closed_at, c.last_message_at))
        )
      ORDER BY COALESCE(c.closed_at, c.last_message_at) DESC
      LIMIT $1
    `, [limit]);

    if (pending.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No pending closed PCG chats to evaluate.',
        evaluatedCount: 0,
      });
    }

    let successCount = 0;
    let failCount = 0;
    const results: Array<{ phone: string; iqs?: number | null; verdict?: string; error?: string }> = [];

    // 2. Process in chunks for controlled concurrency
    for (let i = 0; i < pending.length; i += concurrency) {
      const chunk = pending.slice(i, i + concurrency);
      await Promise.all(
        chunk.map(async (conv) => {
          try {
            const evalRecord = await runPcgChatPipeline(conv);
            successCount++;
            results.push({
              phone: conv.customer_phone,
              iqs: evalRecord.iqs_score,
              verdict: evalRecord.verdict,
            });
          } catch (err: any) {
            failCount++;
            console.error(`[process-pcg-chat-evaluations] Error evaluating ${conv.customer_phone}:`, err?.message || err);
            results.push({
              phone: conv.customer_phone,
              error: err?.message || String(err),
            });
          }
        })
      );
    }

    // Check remaining pending count
    const remainingRes = await query<any>(`
      SELECT COUNT(*) AS count
      FROM pcg_conversations c
      WHERE (c.status = 'CLOSED' OR c.closed_at IS NOT NULL)
        AND NOT EXISTS (
          SELECT 1 FROM pcg_chat_evaluations e
          WHERE e.conversation_id = c.id
             OR (e.customer_phone = c.customer_phone AND e.chat_closed_at = COALESCE(c.closed_at, c.last_message_at))
        )
    `);
    const remainingCount = parseInt(remainingRes[0]?.count || '0', 10);

    return NextResponse.json({
      success: true,
      batchSize: pending.length,
      successCount,
      failCount,
      remainingCount,
      model: 'gemini-3.5-flash',
      results,
    });
  } catch (err: any) {
    console.error('[process-pcg-chat-evaluations] Batch error:', err);
    return NextResponse.json(
      { success: false, error: err?.message || 'Failed to process PCG chat evaluations' },
      { status: 500 }
    );
  }
}

