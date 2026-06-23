import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { query } from '@/lib/cx/db';

/**
 * POST /api/admin/migrate-iqs-status
 * Adds status column to iqs_scores and back-fills existing rows.
 * Idempotent — safe to run multiple times.
 *
 * status values:
 *   'pending'  — scored, awaiting QA review
 *   'reviewed' — QA has submitted a review
 *   'skipped'  — unscoreable (no transcript / call-only) — never enters review queue
 */
export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as any).role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const steps: { step: string; affected?: number }[] = [];

  try {
    // 1. Add column
    await query(`
      ALTER TABLE iqs_scores
      ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending'
    `);
    steps.push({ step: 'status column ensured (default: pending)' });

    // 2. Mark already-reviewed rows
    const reviewed = await query<{ count: string }>(`
      WITH updated AS (
        UPDATE iqs_scores SET status = 'reviewed'
        WHERE reviewed_by IS NOT NULL AND status != 'reviewed'
        RETURNING 1
      )
      SELECT COUNT(*) AS count FROM updated
    `);
    steps.push({ step: 'backfill reviewed', affected: parseInt(reviewed[0]?.count ?? '0') });

    // 3. Mark unscoreable / sentinel rows (iqs_score IS NULL = never had a real score)
    const skipped = await query<{ count: string }>(`
      WITH updated AS (
        UPDATE iqs_scores SET status = 'skipped'
        WHERE iqs_score IS NULL AND status = 'pending'
        RETURNING 1
      )
      SELECT COUNT(*) AS count FROM updated
    `);
    steps.push({ step: 'backfill skipped (null iqs_score)', affected: parseInt(skipped[0]?.count ?? '0') });

    // 4. Verify distribution
    const dist = await query<{ status: string; count: string }>(`
      SELECT status, COUNT(*) AS count FROM iqs_scores GROUP BY status ORDER BY status
    `);

    return NextResponse.json({ ok: true, steps, distribution: dist });
  } catch (err: any) {
    return NextResponse.json({ ok: false, steps, error: err?.message }, { status: 500 });
  }
}
