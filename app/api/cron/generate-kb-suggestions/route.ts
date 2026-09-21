import { NextRequest, NextResponse } from 'next/server';
import { generateWeeklyKBSuggestions } from '@/lib/kb-suggestions/generator';

export const maxDuration = 300; // 5 minutes max duration on Vercel Pro
export const dynamic = 'force-dynamic';

async function handler(req: NextRequest) {
  const searchParams = req.nextUrl ? req.nextUrl.searchParams : new URL(req.url, 'http://localhost').searchParams;

  // 1. Authorisation check using CRON_SECRET if present
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get('authorization') || '';
    if (auth !== `Bearer ${cronSecret}` && searchParams.get('secret') !== cronSecret) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }
  }

  // 2. Parse query parameters
  const weekParam = searchParams.get('week'); // e.g. ?week=2026-09-14
  const dryRunParam = searchParams.get('dryRun') === 'true';
  const limitParam = searchParams.get('limit') ? parseInt(searchParams.get('limit')!, 10) : undefined;

  try {
    const result = await generateWeeklyKBSuggestions({
      targetDate: weekParam || undefined,
      dryRun: dryRunParam,
      limit: limitParam,
    });

    return NextResponse.json({
      ...result,
      message: dryRunParam ? 'Dry-run complete (no database writes)' : 'KB draft suggestions generated and inserted successfully',
    });
  } catch (err: any) {
    console.error('[cron/generate-kb-suggestions] Error:', err.message);
    return NextResponse.json(
      {
        ok: false,
        error: err.message || 'Failed to generate weekly KB draft suggestions',
      },
      { status: 500 }
    );
  }
}

export const GET = handler;
export const POST = handler;
