import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { query } from '@/lib/cx/db';
import { runCallPipeline } from '@/lib/scoring/call-pipeline';
import { log } from '@/lib/log';

export const runtime = 'nodejs';
export const maxDuration = 300;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function runTranscribeInBackground(statusFilter: string, limit: number | null, delayMs: number) {
  log.info('cx/qa/transcribe-calls', `Starting background re-transcription: status=${statusFilter}, limit=${limit}`);
  
  try {
    let sql = `SELECT id FROM call_recordings WHERE recording_url IS NOT NULL`;
    const params: any[] = [];

    if (statusFilter !== 'all') {
      sql += ` AND status = $1`;
      params.push(statusFilter);
    }

    sql += ` ORDER BY called_at DESC`;

    if (limit !== null) {
      sql += ` LIMIT $${params.length + 1}`;
      params.push(limit);
    }

    const calls = await query(sql, params);
    log.info('cx/qa/transcribe-calls', `Found ${calls.length} calls to re-transcribe in background`);

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < calls.length; i++) {
      const call = calls[i];
      try {
        log.info('cx/qa/transcribe-calls', `[${i + 1}/${calls.length}] Resetting and transcribing call ID: ${call.id}`);
        
        // Reset transcription status in the database to force runCallPipeline to transcribe
        await query(`
          UPDATE call_recordings
          SET transcript = NULL,
              status = 'stored',
              language = NULL,
              duration_seconds = NULL,
              interruption_count = 0,
              dead_air_count = 0,
              updated_at = NOW()
          WHERE id = $1
        `, [call.id]);

        await runCallPipeline(call.id);
        successCount++;
      } catch (err: any) {
        log.error('cx/qa/transcribe-calls', `Failed transcribing call ${call.id}: ${err.message}`);
        failCount++;
      }

      if (i < calls.length - 1 && delayMs > 0) {
        await sleep(delayMs);
      }
    }

    log.info('cx/qa/transcribe-calls', `Background re-transcription finished. Success: ${successCount}, Fail: ${failCount}`);
  } catch (err: any) {
    log.error('cx/qa/transcribe-calls', `Background re-transcription process crashed: ${err.message}`);
  }
}

export async function POST(req: NextRequest) {
  let authorized = false;

  const seedSecret = process.env.SEED_SECRET;
  const webhookSecret = process.env.WEBHOOK_SECRET;
  const cronSecret = process.env.CRON_SECRET;

  const authHeader = req.headers.get('authorization') || '';
  const url = new URL(req.url);
  const urlSecret = url.searchParams.get('secret');

  const checkSecret = (sec: string | undefined) => {
    if (!sec) return false;
    return authHeader === `Bearer ${sec}` || urlSecret === sec;
  };

  if (checkSecret(seedSecret) || checkSecret(webhookSecret) || checkSecret(cronSecret)) {
    authorized = true;
  }

  if (!authorized) {
    const session = await getServerSession(authOptions);
    const user    = session?.user as any;
    if (user && (user.isAdmin || user.role === 'tl' || user.role === 'admin' || user.role === 'quality')) {
      authorized = true;
    }
  }

  if (!authorized) {
    return new Response('Forbidden', { status: 403 });
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {}

  const statusFilter = body.status || 'all';
  const limit = body.limit !== undefined && body.limit !== null ? Number(body.limit) : null;
  const delayMs = body.delay !== undefined && body.delay !== null ? Number(body.delay) : 1500;

  // Fire-and-forget
  runTranscribeInBackground(statusFilter, limit, delayMs).catch((err) => {
    log.error('cx/qa/transcribe-calls', `Failed to initiate re-transcription: ${err.message}`);
  });

  return NextResponse.json({
    ok: true,
    message: 'Re-transcription process initiated in background',
    config: {
      status: statusFilter,
      limit,
      delayMs,
    }
  }, { status: 202 });
}
