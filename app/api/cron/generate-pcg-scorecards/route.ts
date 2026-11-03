import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/cx/db';
import { generatePcgScorecard } from '@/lib/pcg/scorecard-generator';
import { canonicalizePcgRmName } from '@/lib/pcg/canonical-names';

// Helper to get the Monday date for a given Date
function getMonday(d: Date): string {
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d.setDate(diff));
  return monday.toISOString().split('T')[0];
}

export const maxDuration = 300; // 5 minutes max duration on Vercel
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  // 1. Authorisation check using CRON_SECRET if present
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get('authorization') || '';
    const { searchParams } = new URL(req.url);
    if (auth !== `Bearer ${cronSecret}` && searchParams.get('secret') !== cronSecret) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }
  }

  // 2. Parse query parameters
  const { searchParams } = new URL(req.url);
  const rmParam = searchParams.get('rm');       // e.g. ?rm=Antara
  const weekParam = searchParams.get('week');   // e.g. ?week=2026-10-19

  // Determine week range
  let targetDate = new Date();
  if (weekParam) {
    targetDate = new Date(weekParam);
    if (isNaN(targetDate.getTime())) {
      return NextResponse.json({ error: 'Invalid week date format. Use YYYY-MM-DD.' }, { status: 400 });
    }
  } else {
    // Default to last completed week: subtract 7 days from today
    targetDate.setDate(targetDate.getDate() - 7);
  }

  const weekStart = getMonday(targetDate);
  const weekEnd = new Date(new Date(weekStart).getTime() + 6 * 86400000).toISOString().split('T')[0];
  const nextMonday = new Date(new Date(weekStart).getTime() + 7 * 86400000).toISOString().split('T')[0];

  console.log(`[generate-pcg-scorecards] Generating PCG scorecards for week ${weekStart} to ${weekEnd}`);

  // 3. Determine scope of RMs with calls in that week
  let targetRms: string[] = [];
  if (rmParam) {
    targetRms = [canonicalizePcgRmName(rmParam.trim())];
  } else {
    const activeRows = await query<any>(
      `SELECT 
        COALESCE(NULLIF(e.rm_name, 'Unknown'), r.called_by, r.agent_name) AS rm_name,
        COUNT(r.id) AS calls_count
       FROM pcg_call_recordings r
       LEFT JOIN pcg_call_evaluations e ON (e.call_id = r.call_id OR e.call_id = r.id::text)
       WHERE r.start_time >= $1 AND r.start_time < $2
         AND COALESCE(NULLIF(e.rm_name, 'Unknown'), r.called_by, r.agent_name) IS NOT NULL
       GROUP BY 1`,
      [`${weekStart}T00:00:00.000Z`, `${nextMonday}T00:00:00.000Z`]
    );

    const nonRmSet = new Set([
      'gokul', 'gokul_admin', 'aahan thaker', 'aahan', 'unknown', 'unknown rm', 'test-pcg-admin', 'test-cx-tl',
      'dheeraj', 'dheeraj bhojwani', 'swetha', 'swetha jayakumar', 'saiyam', 'saiyam rastogi', 'tanisha', 'tanisha mittal'
    ]);

    // Exclude all users with role 'tl' or 'admin'
    const { listUsers } = await import('@/lib/users');
    const allUsers = await listUsers().catch(() => []);
    allUsers.forEach((u) => {
      if (u.role === 'tl' || u.role === 'admin' || (u as any).is_super_admin) {
        nonRmSet.add(u.name.toLowerCase().trim());
        nonRmSet.add(canonicalizePcgRmName(u.name).toLowerCase().trim());
      }
    });

    const rmNamesSet = new Set<string>();
    const lowVolumeRms: Array<{ rm: string; calls: number }> = [];

    activeRows.forEach((row) => {
      const canonical = canonicalizePcgRmName(row.rm_name);
      if (canonical && !nonRmSet.has(canonical.toLowerCase()) && !canonical.toLowerCase().includes('admin')) {
        const count = Number(row.calls_count || 0);
        if (count >= 5) {
          rmNamesSet.add(canonical);
        } else {
          lowVolumeRms.push({ rm: canonical, calls: count });
        }
      }
    });
    targetRms = Array.from(rmNamesSet);
    console.log(`[generate-pcg-scorecards] Skipped ${lowVolumeRms.length} RMs with < 5 calls:`, lowVolumeRms);
  }

  console.log(`[generate-pcg-scorecards] Found ${targetRms.length} active RMs for week ${weekStart}:`, targetRms);

  // 4. Batch generate and persist scorecards
  let generatedCount = 0;
  let failedCount = 0;
  const failures: Array<{ rm: string; reason: string }> = [];
  const results: any[] = [];

  const BATCH_SIZE = 4;
  for (let i = 0; i < targetRms.length; i += BATCH_SIZE) {
    const batch = targetRms.slice(i, i + BATCH_SIZE);

    await Promise.all(
      batch.map(async (rmName) => {
        try {
          const scorecard = await generatePcgScorecard({
            rmName,
            weekStart,
            weekEnd,
          });

          await query(
            `INSERT INTO pcg_reports (id, rm_name, tl_name, week_start, week_end, status, generated, model_version)
             VALUES ($1, $2, $3, $4, $5, 'published', $6, $7)
             ON CONFLICT (rm_name, week_start)
             DO UPDATE SET
               tl_name = EXCLUDED.tl_name,
               week_end = EXCLUDED.week_end,
               status = EXCLUDED.status,
               generated = EXCLUDED.generated,
               generated_at = NOW()`,
            [
              scorecard.id,
              scorecard.rmName,
              scorecard.tlName,
              scorecard.weekStart,
              scorecard.weekEnd,
              JSON.stringify(scorecard),
              'gemini-3-flash-preview',
            ]
          );

          generatedCount++;
          results.push({
            rm: rmName,
            callsHandled: scorecard.numbers.callsHandled,
            averageScore: scorecard.numbers.averageScore,
          });
        } catch (err: any) {
          failedCount++;
          failures.push({ rm: rmName, reason: err.message });
          console.error(`[generate-pcg-scorecards] Error generating for ${rmName}:`, err);
        }
      })
    );
  }

  return NextResponse.json({
    success: true,
    weekStart,
    weekEnd,
    totalTargetRms: targetRms.length,
    generatedCount,
    failedCount,
    failures,
    results,
  });
}

export const POST = GET;

