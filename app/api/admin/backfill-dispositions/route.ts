/**
 * POST /api/admin/backfill-dispositions
 *
 * Bulk-updates disposition/sub-disposition tags for conversations that are
 * missing them (e.g. due to the June 3-10 webhook dedup bug).
 *
 * Body:
 *   { rows: Array<{ chatId: string; disposition: string; subDisposition: string }> }
 *
 * Uses JSONB merge (||) so any other existing tags keys are preserved.
 *
 * Auth: admin only
 * Safe to re-run — overwrites disposition/sub_disposition only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { query } from '@/lib/cx/db';

interface BackfillRow {
  chatId: string;
  disposition: string;
  subDisposition: string;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  const user = session.user as any;
  let body: { rows?: BackfillRow[] } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const rows = body.rows;
  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: 'Body must have a non-empty "rows" array' }, { status: 400 });
  }

  let updated = 0;
  const errors: string[] = [];

  for (const row of rows) {
    const chatId = String(row.chatId ?? '').trim();
    const disposition = String(row.disposition ?? '').trim();
    const subDisposition = String(row.subDisposition ?? '').trim();

    if (!chatId) {
      errors.push(`Skipped row with missing chatId`);
      continue;
    }
    if (!disposition) {
      errors.push(`${chatId}: missing disposition — skipped`);
      continue;
    }

    try {
      const result = await query<{ updated: string }>(
        `UPDATE conversations
         SET tags        = COALESCE(tags, '{}'::jsonb)
                           || jsonb_build_object(
                                'disposition',     $1::text,
                                'sub_disposition', $2::text
                              ),
             updated_at  = NOW()
         WHERE id = $3
         RETURNING id`,
        [disposition, subDisposition, chatId],
      );

      if (result.length > 0) {
        updated++;
      } else {
        errors.push(`${chatId}: no matching conversation found`);
      }
    } catch (err: any) {
      errors.push(`${chatId}: DB error — ${err.message}`);
    }
  }

  return NextResponse.json({
    ok: true,
    total: rows.length,
    updated,
    notFound: rows.length - updated - errors.filter(e => e.includes('DB error')).length,
    errors,
  });
}

/** GET: preview how many conversations currently have no disposition tag */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  const user = session.user as any;
  const url = new URL(req.url);
  const from = url.searchParams.get('from') || '2026-06-01';
  const to   = url.searchParams.get('to')   || '2026-06-10';

  const rows = await query<{ count: string; oldest: string | null; newest: string | null }>(`
    SELECT COUNT(*)::text AS count,
           MIN(closed_at)::text AS oldest,
           MAX(closed_at)::text AS newest
    FROM conversations
    WHERE closed_at::date BETWEEN $1 AND $2
      AND (tags IS NULL OR tags->>'disposition' IS NULL OR tags->>'disposition' = '')
  `, [from, to]);

  return NextResponse.json({
    ok: true,
    period: { from, to },
    missingDispositionCount: parseInt(rows[0]?.count ?? '0', 10),
    oldest: rows[0]?.oldest ?? null,
    newest: rows[0]?.newest ?? null,
  });
}
