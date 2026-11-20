import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/cx/db';
import { readConfig } from '@/lib/config';
import { runPcgCallPipeline, resolvePcgAgent, resolvePcgAgentAsync, PCG_QUALITY_PARAMETERS } from '@/lib/scoring/pcg-pipeline';
import { isPcgExcludedInternalPhone } from '@/lib/pcg/excluded-numbers';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 minutes max duration on Vercel

async function syncShortCalls(fromDate: string, minDuration: number) {
  const config = await readConfig().catch(() => null);
  const customTeamMap = config?.pcgTeamAssignments || {};

  const shortCalls = await query<any>(`
    SELECT r.call_id, r.called_by, r.user_phone, r.agent_name, r.duration_seconds, r.phone_number
    FROM pcg_call_recordings r
    LEFT JOIN pcg_call_evaluations e ON r.call_id = e.call_id
    WHERE (r.start_time >= $1 OR r.created_at >= $1)
      AND (r.duration_seconds < $2 OR r.recording_url IS NULL)
      AND e.call_id IS NULL
  `, [fromDate, minDuration]);

  if (!shortCalls.length) {
    return 0;
  }

  const emptyParams: Record<string, any> = {};
  PCG_QUALITY_PARAMETERS.forEach(p => {
    emptyParams[p.id] = { id: p.id, name: p.name, maxScore: p.weight, earnedScore: 0, status: 'NA', quote: 'Unanswered / Zero duration call' };
  });
  const emptyParamsJson = JSON.stringify(emptyParams);

  for (const c of shortCalls) {
    const { rm, tl } = await resolvePcgAgentAsync(c.called_by || c.agent_name || c, customTeamMap);
    if (isPcgExcludedInternalPhone(c.phone_number)) {
      const exclusionText = `Internal company number (${c.phone_number || 'configured internal number'})`;
      await query(`
        INSERT INTO pcg_call_evaluations (
          call_id, rm_name, tl_name, customer_phone, call_category, duration_seconds,
          iqs_score, process_score, communication_score, customer_service_score, applicable_weight,
          verdict, is_evaluable, exclusion_reason, parameters, transcript_turns, compliance_tripwire, scored_at
        ) VALUES ($1, $2, $3, $4, 'internal_personal', $5, null, null, null, null, 0, 'EXCLUDED_NON_CLIENT', false, $6, '[]'::jsonb, '[]'::jsonb, false, NOW())
        ON CONFLICT (call_id) DO UPDATE SET
          call_category = 'internal_personal',
          verdict = 'EXCLUDED_NON_CLIENT',
          is_evaluable = false,
          exclusion_reason = EXCLUDED.exclusion_reason,
          scored_at = NOW()
      `, [c.call_id, rm, tl, c.phone_number, c.duration_seconds || 0, exclusionText]);

      await query(`
        UPDATE pcg_call_recordings
        SET call_nature = 'non_client', call_category = 'internal_personal', exclusion_reason = $1, category_source = 'internal_number_rule'
        WHERE call_id = $2
      `, [exclusionText, c.call_id]);
      continue;
    }

    await query(`
      INSERT INTO pcg_call_evaluations (
        call_id, rm_name, tl_name, customer_phone, call_category, duration_seconds,
        iqs_score, process_score, communication_score, customer_service_score, applicable_weight,
        verdict, parameters, transcript_turns, compliance_tripwire, scored_at
      ) VALUES ($1, $2, $3, $4, 'support', $5, null, null, null, null, 0, 'NOT_SCOREABLE', $6, '[]'::jsonb, false, NOW())
      ON CONFLICT (call_id) DO UPDATE SET
        verdict = 'NOT_SCOREABLE', scored_at = NOW()
    `, [c.call_id, rm, tl, c.phone_number, c.duration_seconds || 0, emptyParamsJson]);
  }

  return shortCalls.length;
}

export async function GET(req: NextRequest) {
  // 1. Authorization check using CRON_SECRET if present
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get('authorization') || '';
    const { searchParams } = new URL(req.url);
    if (auth !== `Bearer ${cronSecret}` && searchParams.get('secret') !== cronSecret) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }
  }

  const { searchParams } = new URL(req.url);
  const limit = parseInt(searchParams.get('limit') || '40', 10);
  const minDuration = parseInt(searchParams.get('minDuration') || '15', 10);
  const concurrency = parseInt(searchParams.get('concurrency') || '4', 10);

  // Default to calls from the past 7 days
  const defaultFrom = new Date(Date.now() - 7 * 86400000).toISOString();
  const fromDate = searchParams.get('from') || defaultFrom;

  console.log(`[cron/process-pcg-evaluations] Starting PCG evaluation batch from ${fromDate}, limit=${limit}`);

  // Step 1: Immediately populate short / unrecorded calls as NOT_SCOREABLE (0 LLM cost)
  const shortCount = await syncShortCalls(fromDate, minDuration);

  // Step 2: Fetch candidate conversation calls needing AI evaluation
  const pendingCalls = await query<any>(`
    SELECT r.call_id, r.called_by, r.duration_seconds, r.start_time, r.recording_url
    FROM pcg_call_recordings r
    LEFT JOIN pcg_call_evaluations e ON r.call_id = e.call_id
    WHERE (r.start_time >= $1 OR r.created_at >= $1)
      AND r.duration_seconds >= $2
      AND r.recording_url IS NOT NULL
      AND e.call_id IS NULL
    ORDER BY r.start_time DESC
    LIMIT $3
  `, [fromDate, minDuration, limit]);

  console.log(`[cron/process-pcg-evaluations] Found ${pendingCalls.length} candidate calls needing AI evaluation.`);

  if (pendingCalls.length === 0) {
    return NextResponse.json({
      success: true,
      message: 'No pending PCG calls to evaluate',
      shortCallsMarked: shortCount,
      evaluatedCount: 0,
    });
  }

  let successCount = 0;
  let failCount = 0;
  const results: Array<{ callId: string; status: string; iqs?: number; error?: string }> = [];

  // Step 3: Run pipeline with controlled concurrency
  for (let i = 0; i < pendingCalls.length; i += concurrency) {
    const chunk = pendingCalls.slice(i, i + concurrency);
    await Promise.all(
      chunk.map(async (c) => {
        try {
          const res = await runPcgCallPipeline(c.call_id);
          successCount++;
          results.push({ callId: c.call_id, status: 'scored', iqs: res?.iqs });
        } catch (err: any) {
          failCount++;
          console.error(`[cron/process-pcg-evaluations] Failed evaluating call ${c.call_id}:`, err?.message || err);
          results.push({ callId: c.call_id, status: 'error', error: err?.message || String(err) });
        }
      })
    );
  }

  return NextResponse.json({
    success: true,
    shortCallsMarked: shortCount,
    totalCandidateCalls: pendingCalls.length,
    successCount,
    failCount,
    results,
  });
}

