import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { query } from '@/lib/cx/db';

/**
 * POST /api/admin/backfill-phone
 * Adds phone_number column to conversations and backfills from:
 *   1. contacts table (via contact_id FK) — already normalised
 *   2. raw_payload JSONB fields (for rows without a contact_id)
 * Idempotent — safe to run multiple times.
 */
export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as any).role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const steps: string[] = [];

  try {
    // 1. Add column if missing
    await query(`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS phone_number VARCHAR(30)`);
    steps.push('phone_number column ensured');

    // 2. Backfill from contacts table (most reliable — already deduplicated)
    const fromContacts = await query(`
      UPDATE conversations c
      SET phone_number = ct.phone
      FROM contacts ct
      WHERE ct.id = c.contact_id
        AND c.phone_number IS NULL
        AND ct.phone IS NOT NULL
        AND ct.phone <> ''
      RETURNING c.id
    `);
    steps.push(`Filled ${fromContacts.length} rows from contacts table`);

    // 3. Backfill remaining from raw_payload JSONB (tries all known field paths)
    const fromPayload = await query(`
      UPDATE conversations c
      SET phone_number = COALESCE(
        NULLIF(c.raw_payload->'requester_info'->>'phone_number', ''),
        NULLIF(c.raw_payload->>'user_phone',      ''),
        NULLIF(c.raw_payload->>'customer_phone',  ''),
        NULLIF(c.raw_payload->>'phone_number',    ''),
        NULLIF(c.raw_payload->>'mobile',          ''),
        NULLIF(c.raw_payload->'data'->>'user_phone',     ''),
        NULLIF(c.raw_payload->'data'->>'customer_phone', ''),
        NULLIF(c.raw_payload->'data'->>'phone_number',   ''),
        NULLIF(c.raw_payload->'data'->>'mobile',         '')
      )
      WHERE c.phone_number IS NULL
        AND c.raw_payload IS NOT NULL
        AND COALESCE(
          NULLIF(c.raw_payload->'requester_info'->>'phone_number', ''),
          NULLIF(c.raw_payload->>'user_phone',      ''),
          NULLIF(c.raw_payload->>'customer_phone',  ''),
          NULLIF(c.raw_payload->>'phone_number',    ''),
          NULLIF(c.raw_payload->>'mobile',          ''),
          NULLIF(c.raw_payload->'data'->>'user_phone',     ''),
          NULLIF(c.raw_payload->'data'->>'customer_phone', ''),
          NULLIF(c.raw_payload->'data'->>'phone_number',   ''),
          NULLIF(c.raw_payload->'data'->>'mobile',         '')
        ) IS NOT NULL
      RETURNING c.id
    `);
    steps.push(`Filled ${fromPayload.length} rows from raw_payload`);

    // 4. Summary counts
    const [total] = await query(`SELECT COUNT(*) AS total FROM conversations`);
    const [filled] = await query(`SELECT COUNT(*) AS filled FROM conversations WHERE phone_number IS NOT NULL`);
    const [empty]  = await query(`SELECT COUNT(*) AS empty  FROM conversations WHERE phone_number IS NULL`);

    return NextResponse.json({
      ok: true,
      steps,
      summary: {
        total:  parseInt(total.total),
        filled: parseInt(filled.filled),
        empty:  parseInt(empty.empty),
      },
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, steps, error: err?.message }, { status: 500 });
  }
}
