import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { query } from '@/lib/cx/db';

/**
 * GET /api/admin/debug/iqs-filter-check?from=2026-06-01&to=2026-06-30
 *
 * Breaks down scored conversations by which pending-review filter
 * condition excludes them. Use this to diagnose why chats are invisible
 * in the QA / TL pending queues.
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!(session?.user as any)?.isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const from = searchParams.get('from') ?? '2026-06-01';
  const to   = searchParams.get('to')   ?? '2026-06-30';

  const fromIST = new Date(from + 'T00:00:00+05:30').toISOString();
  const toIST   = new Date(to   + 'T23:59:59+05:30').toISOString();

  const CAT1_KEYS = ['technical', 'all_questions', 'expectation', 'process', 'follow_up', 'opening', 'call'];

  const rows = await query<{
    total:                    string;
    has_chat_score:           string;
    has_call_score:           string;
    chat_below_85:            string;
    chat_below_85_no_call:    string;
    already_reviewed:         string;
    no_cat1_fail:             string;
    visible_pending_qa:       string;
    visible_pending_tl:       string;
  }>(`
    SELECT
      COUNT(*)::text AS total,

      -- has a chat iqs score
      COUNT(*) FILTER (WHERE i.iqs_score IS NOT NULL)::text
        AS has_chat_score,

      -- has a call iqs score (blocks appearance in chat pending queue)
      COUNT(*) FILTER (WHERE i.call_iqs_score IS NOT NULL)::text
        AS has_call_score,

      -- chat score below 85
      COUNT(*) FILTER (WHERE i.iqs_score < 85)::text
        AS chat_below_85,

      -- chat score below 85 AND no call score (old filter, blocks queue)
      COUNT(*) FILTER (WHERE i.iqs_score < 85 AND i.call_iqs_score IS NULL)::text
        AS chat_below_85_no_call,

      -- already QA-reviewed
      COUNT(*) FILTER (WHERE i.reviewed_by IS NOT NULL)::text
        AS already_reviewed,

      -- no CAT1 parameter scored false (blocks queue even if score < 85)
      COUNT(*) FILTER (
        WHERE i.iqs_score < 85
          AND NOT EXISTS (
            SELECT 1 FROM jsonb_each(i.parameters) p(k,v)
            WHERE k = ANY($3)
              AND (v->>'score')::boolean = false
          )
      )::text AS no_cat1_fail,

      -- actually visible in QA pending queue RIGHT NOW (old filters)
      COUNT(*) FILTER (
        WHERE i.reviewed_by IS NULL
          AND i.call_iqs_score IS NULL
          AND i.iqs_score < 85
          AND EXISTS (
            SELECT 1 FROM jsonb_each(i.parameters) p(k,v)
            WHERE k = ANY($3)
              AND (v->>'score')::boolean = false
          )
      )::text AS visible_pending_qa,

      -- visible in QA pending queue AFTER removing call_iqs_score filter
      COUNT(*) FILTER (
        WHERE i.reviewed_by IS NULL
          AND i.iqs_score < 85
          AND EXISTS (
            SELECT 1 FROM jsonb_each(i.parameters) p(k,v)
            WHERE k = ANY($3)
              AND (v->>'score')::boolean = false
          )
      )::text AS visible_pending_tl

    FROM conversations c
    JOIN iqs_scores i ON i.chat_id = c.id
    WHERE c.closed_at >= $1 AND c.closed_at <= $2
  `, [fromIST, toIST, CAT1_KEYS]);

  const r = rows[0] ?? {};

  return NextResponse.json({
    dateRange: { from, to },
    total:               parseInt(r.total ?? '0'),
    hasChatScore:        parseInt(r.has_chat_score ?? '0'),
    hasCallScore:        parseInt(r.has_call_score ?? '0'),
    chatBelow85:         parseInt(r.chat_below_85 ?? '0'),
    chatBelow85NoCall:   parseInt(r.chat_below_85_no_call ?? '0'),
    alreadyReviewed:     parseInt(r.already_reviewed ?? '0'),
    noCat1Fail:          parseInt(r.no_cat1_fail ?? '0'),
    visiblePendingNow:   parseInt(r.visible_pending_qa ?? '0'),
    visibleAfterFix:     parseInt(r.visible_pending_tl ?? '0'),
    diagnosis: {
      blockedByCallScore: parseInt(r.has_call_score ?? '0'),
      blockedByHighScore: parseInt(r.total ?? '0') - parseInt(r.chat_below_85 ?? '0'),
      blockedByNoFail:    parseInt(r.no_cat1_fail ?? '0'),
      blockedByReviewed:  parseInt(r.already_reviewed ?? '0'),
    },
  });
}
