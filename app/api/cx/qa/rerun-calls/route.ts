import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { query } from '@/lib/cx/db';
import { runCallPipeline } from '@/lib/scoring/call-pipeline';
import { log } from '@/lib/log';

export const runtime = 'nodejs';
export const maxDuration = 300;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function runRerunInBackground(statusFilter: string, limit: number | null, delayMs: number) {
  log.info('cx/qa/rerun-calls', `Starting background rerun: status=${statusFilter}, limit=${limit}`);
  
  try {
    let sql = `SELECT id FROM call_recordings`;
    const params: any[] = [];

    if (statusFilter !== 'all') {
      sql += ` WHERE status = $1`;
      params.push(statusFilter);
    }

    sql += ` ORDER BY called_at DESC`;

    if (limit !== null) {
      sql += ` LIMIT $${params.length + 1}`;
      params.push(limit);
    }

    const calls = await query(sql, params);
    log.info('cx/qa/rerun-calls', `Found ${calls.length} calls to re-evaluate in background`);

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < calls.length; i++) {
      const call = calls[i];
      try {
        await runCallPipeline(call.id);
        successCount++;
      } catch (err: any) {
        log.error('cx/qa/rerun-calls', `Failed re-evaluating call ${call.id}: ${err.message}`);
        failCount++;
      }

      if (i < calls.length - 1 && delayMs > 0) {
        await sleep(delayMs);
      }
    }

    log.info('cx/qa/rerun-calls', `Background rerun finished successfully. Success: ${successCount}, Fail: ${failCount}`);
  } catch (err: any) {
    log.error('cx/qa/rerun-calls', `Background rerun process crashed: ${err.message}`);
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const user    = session?.user as any;
  if (!user || (!user.isAdmin && user.role !== 'tl')) {
    return new Response('Forbidden', { status: 403 });
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {}

  const statusFilter = body.status || 'scored';
  const limit = body.limit !== undefined && body.limit !== null ? Number(body.limit) : null;
  const delayMs = body.delay !== undefined && body.delay !== null ? Number(body.delay) : 1500;

  // Fire-and-forget: run the re-evaluation in the background
  runRerunInBackground(statusFilter, limit, delayMs).catch((err) => {
    log.error('cx/qa/rerun-calls', `Failed to initiate rerun: ${err.message}`);
  });

  return NextResponse.json({
    ok: true,
    message: 'Rerun process initiated in background',
    config: {
      status: statusFilter,
      limit,
      delayMs,
    }
  }, { status: 202 });
}
