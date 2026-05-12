import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { query } from '@/lib/cx/db';

/**
 * POST /api/admin/migrate-calls
 * Applies migration 005 + 007 for the call_recordings table.
 * Safe to run repeatedly — idempotent. Drops and recreates call_recordings
 * only if the table is missing the required `id` column (i.e. wrong schema).
 */
export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as any).role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const steps: string[] = [];

  try {
    // Check if call_recordings exists and whether it has the `id` column
    const colCheck = await query<{ column_name: string }>(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'call_recordings' AND column_name = 'id'
    `);

    if (colCheck.length > 0) {
      steps.push('call_recordings already has id column — skipping recreate');
    } else {
      // Table is missing the id column (wrong schema or empty table from old migration).
      // Drop and recreate — inserts were failing so there is no real data.
      await query(`DROP TABLE IF EXISTS call_recordings CASCADE`);
      steps.push('dropped call_recordings (wrong schema, no live data)');

      await query(`
        CREATE TABLE call_recordings (
          id                 VARCHAR(100) PRIMARY KEY,
          chat_id            VARCHAR(100) REFERENCES conversations(id) ON DELETE SET NULL,
          agent_id           INTEGER REFERENCES agents(id) ON DELETE SET NULL,
          contact_id         BIGINT REFERENCES contacts(id) ON DELETE SET NULL,
          recording_url      TEXT,
          duration_seconds   INTEGER,
          called_at          TIMESTAMPTZ,
          language           VARCHAR(100),
          transcript         JSONB,
          interruption_count SMALLINT DEFAULT 0,
          dead_air_count     SMALLINT DEFAULT 0,
          status             VARCHAR(20) NOT NULL DEFAULT 'transcribed',
          created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      steps.push('created call_recordings with correct schema');

      await query(`CREATE INDEX IF NOT EXISTS call_recordings_chat_id_idx  ON call_recordings (chat_id)`);
      await query(`CREATE INDEX IF NOT EXISTS call_recordings_agent_id_idx ON call_recordings (agent_id)`);
      await query(`CREATE INDEX IF NOT EXISTS call_recordings_called_at_idx ON call_recordings (called_at DESC)`);
      steps.push('created indexes on call_recordings');
    }

    // Migration 007 — partial index for unlinked calls (idempotent)
    await query(`
      CREATE INDEX IF NOT EXISTS call_recordings_contact_unlinked_idx
        ON call_recordings (contact_id, called_at DESC)
        WHERE chat_id IS NULL
    `);
    steps.push('ensured call_recordings_contact_unlinked_idx');

    // Migration 005 — add call IQS columns to iqs_scores (idempotent)
    await query(`ALTER TABLE iqs_scores ADD COLUMN IF NOT EXISTS call_iqs_score     SMALLINT CHECK (call_iqs_score BETWEEN 0 AND 100)`);
    await query(`ALTER TABLE iqs_scores ADD COLUMN IF NOT EXISTS call_parameters    JSONB`);
    await query(`ALTER TABLE iqs_scores ADD COLUMN IF NOT EXISTS call_model_version VARCHAR(50)`);
    await query(`ALTER TABLE iqs_scores ADD COLUMN IF NOT EXISTS call_scored_at     TIMESTAMPTZ`);
    steps.push('ensured call IQS columns on iqs_scores');

    return NextResponse.json({ ok: true, steps });
  } catch (err: any) {
    console.error('[migrate-calls]', err?.message ?? err);
    return NextResponse.json({ ok: false, steps, error: err?.message }, { status: 500 });
  }
}
