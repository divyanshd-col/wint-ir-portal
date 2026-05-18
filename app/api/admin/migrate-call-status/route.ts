import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { query } from '@/lib/cx/db';

/**
 * POST /api/admin/migrate-call-status
 * Widens call_recordings.status from VARCHAR(20) to VARCHAR(30).
 * Required because 'pending_transcription' (21 chars) exceeds the old limit.
 * Idempotent — safe to call more than once.
 */
export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    await query(`ALTER TABLE call_recordings ALTER COLUMN status TYPE VARCHAR(30)`);
    return NextResponse.json({ ok: true, message: 'call_recordings.status widened to VARCHAR(30)' });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message }, { status: 500 });
  }
}
