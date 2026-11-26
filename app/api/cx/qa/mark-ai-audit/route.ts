import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { query } from '@/lib/cx/db';

export const dynamic = 'force-dynamic';

let columnsEnsured = false;
async function ensureAuditColumns() {
  if (columnsEnsured) return;
  try {
    await query(`
      ALTER TABLE call_evaluations ADD COLUMN IF NOT EXISTS ai_hallucinated BOOLEAN;
      ALTER TABLE call_evaluations ADD COLUMN IF NOT EXISTS ai_hallucination_reason TEXT;
      ALTER TABLE call_evaluations ADD COLUMN IF NOT EXISTS ai_audited_at TIMESTAMPTZ;
      ALTER TABLE conversations ADD COLUMN IF NOT EXISTS ai_hallucinated BOOLEAN;
      ALTER TABLE conversations ADD COLUMN IF NOT EXISTS ai_hallucination_reason TEXT;
      ALTER TABLE conversations ADD COLUMN IF NOT EXISTS ai_audited_at TIMESTAMPTZ;
      ALTER TABLE email_reply_evaluations ADD COLUMN IF NOT EXISTS ai_hallucinated BOOLEAN;
      ALTER TABLE email_reply_evaluations ADD COLUMN IF NOT EXISTS ai_hallucination_reason TEXT;
      ALTER TABLE email_reply_evaluations ADD COLUMN IF NOT EXISTS ai_audited_at TIMESTAMPTZ;

      ALTER TABLE call_evaluations ALTER COLUMN ai_hallucinated DROP DEFAULT;
      ALTER TABLE conversations ALTER COLUMN ai_hallucinated DROP DEFAULT;
      ALTER TABLE email_reply_evaluations ALTER COLUMN ai_hallucinated DROP DEFAULT;

      UPDATE call_evaluations
      SET ai_hallucinated = NULL
      WHERE ai_hallucinated = false
        AND (ai_hallucination_reason IS NULL OR ai_hallucination_reason = '')
        AND call_id NOT IN (SELECT call_id FROM call_review_comparisons WHERE action IN ('submit', 'override'));

      UPDATE conversations
      SET ai_hallucinated = NULL
      WHERE ai_hallucinated = false
        AND (ai_hallucination_reason IS NULL OR ai_hallucination_reason = '')
        AND id NOT IN (SELECT chat_id FROM chat_review_comparisons WHERE action IN ('submit', 'override'));

      UPDATE email_reply_evaluations
      SET ai_hallucinated = NULL
      WHERE ai_hallucinated = false
        AND (ai_hallucination_reason IS NULL OR ai_hallucination_reason = '');
    `);
    columnsEnsured = true;
  } catch (err) {
    console.warn('[mark-ai-audit] ensureAuditColumns warning:', err);
  }
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const type = searchParams.get('type') || 'call';
  const id = searchParams.get('id');

  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 });
  }

  await ensureAuditColumns();

  try {
    if (type === 'call') {
      const rows = await query<{
        ai_hallucinated: boolean | null;
        ai_hallucination_reason: string | null;
      }>(
        `SELECT ai_hallucinated, ai_hallucination_reason
         FROM call_evaluations
         WHERE call_id = $1 OR chat_id = $1
         LIMIT 1`,
        [id.trim()]
      );
      return NextResponse.json({
        ai_hallucinated: rows[0]?.ai_hallucinated != null ? Boolean(rows[0]?.ai_hallucinated) : null,
        ai_hallucination_reason: rows[0]?.ai_hallucination_reason || '',
      });
    }

    if (type === 'chat') {
      const rows = await query<{
        ai_hallucinated: boolean | null;
        ai_hallucination_reason: string | null;
      }>(
        `SELECT ai_hallucinated, ai_hallucination_reason
         FROM conversations
         WHERE id = $1
         LIMIT 1`,
        [id.trim()]
      );
      return NextResponse.json({
        ai_hallucinated: rows[0]?.ai_hallucinated != null ? Boolean(rows[0]?.ai_hallucinated) : null,
        ai_hallucination_reason: rows[0]?.ai_hallucination_reason || '',
      });
    }

    if (type === 'email') {
      const rows = await query<{
        ai_hallucinated: boolean | null;
        ai_hallucination_reason: string | null;
      }>(
        `SELECT ai_hallucinated, ai_hallucination_reason
         FROM email_reply_evaluations
         WHERE message_id = $1 OR ticket_id = $1 OR id::text = $1
         LIMIT 1`,
        [id.trim()]
      );
      return NextResponse.json({
        ai_hallucinated: rows[0]?.ai_hallucinated != null ? Boolean(rows[0]?.ai_hallucinated) : null,
        ai_hallucination_reason: rows[0]?.ai_hallucination_reason || '',
      });
    }

    return NextResponse.json({ ai_hallucinated: false, ai_hallucination_reason: '' });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Error fetching audit' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const role = ((session.user as any)?.role || '').toLowerCase();
  const isAdmin = (session.user as any)?.isAdmin;
  const userEmail = ((session.user as any)?.email || '').toLowerCase();
  const userName = ((session.user as any)?.name || '').toLowerCase();
  const isQA =
    role === 'quality' ||
    role === 'admin' ||
    isAdmin ||
    userEmail.includes('sindhu') ||
    userName.includes('sindhu') ||
    userEmail.includes('yashvi') ||
    userName.includes('yashvi');

  // This option is only available to QAs
  if (!isQA) {
    return NextResponse.json({ error: 'Forbidden: QA only' }, { status: 403 });
  }

  const email = ((session.user as any)?.email || session.user?.name || 'QA');

  let body: {
    type?: 'call' | 'chat' | 'email';
    id?: string;
    ai_hallucinated?: boolean | null;
    ai_hallucination_reason?: string;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { type = 'call', id, ai_hallucinated = null, ai_hallucination_reason = '' } = body;
  if (!id?.trim()) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 });
  }

  await ensureAuditColumns();

  try {
    const cleanId = id.trim();
    const cleanReason = ai_hallucination_reason.trim();

    if (type === 'call') {
      // 1. Update call_evaluations
      const updateResult = await query(
        `UPDATE call_evaluations
         SET ai_hallucinated = $1,
             ai_hallucination_reason = $2,
             ai_audited_at = CASE WHEN $1 IS NULL THEN NULL ELSE NOW() END,
             reviewed_by = COALESCE(reviewed_by, $3),
             reviewed_at = COALESCE(reviewed_at, NOW())
         WHERE call_id = $4 OR chat_id = $4`,
        [ai_hallucinated, cleanReason, email, cleanId]
      );

      // 2. Fetch existing call info to sync call_review_comparisons
      const evalRows = await query<{
        call_id: string;
        iqs_percent: string | null;
      }>(
        `SELECT call_id, iqs_percent FROM call_evaluations WHERE call_id = $1 OR chat_id = $1 LIMIT 1`,
        [cleanId]
      );

      if (evalRows.length > 0) {
        const actualCallId = evalRows[0].call_id;
        const score = Math.round(parseFloat(evalRows[0].iqs_percent || '70')) || 70;
        const action = ai_hallucinated ? 'override' : 'submit';

        await query(
          `INSERT INTO call_review_comparisons (
             call_id, ai_score, human_score, action, reviewed_by, reviewed_at, review_note
           ) VALUES ($1, $2, $3, $4, $5, NOW(), $6)
           ON CONFLICT (call_id) DO UPDATE SET
             action = EXCLUDED.action,
             reviewed_by = EXCLUDED.reviewed_by,
             reviewed_at = NOW(),
             review_note = EXCLUDED.review_note`,
          [
            actualCallId,
            score,
            ai_hallucinated ? Math.max(0, score - 20) : score,
            action,
            email,
            cleanReason,
          ]
        );
      }

      return NextResponse.json({
        ok: true,
        callId: cleanId,
        ai_hallucinated,
        ai_hallucination_reason: cleanReason,
      });
    }

    if (type === 'chat') {
      await query(
        `UPDATE conversations
         SET ai_hallucinated = $1,
             ai_hallucination_reason = $2,
             ai_audited_at = CASE WHEN $1 IS NULL THEN NULL ELSE NOW() END
         WHERE id = $3`,
        [ai_hallucinated, cleanReason, cleanId]
      );

      const iqsRows = await query<{ iqs_score: number | null }>(
        `SELECT iqs_score FROM iqs_scores WHERE chat_id = $1 LIMIT 1`,
        [cleanId]
      );

      const score = iqsRows[0]?.iqs_score ?? 70;
      const action = ai_hallucinated ? 'override' : 'submit';

      await query(
        `INSERT INTO chat_review_comparisons (
           chat_id, ai_score, human_score, action, reviewed_by, reviewed_at, review_note
         ) VALUES ($1, $2, $3, $4, $5, NOW(), $6)
         ON CONFLICT (chat_id) DO UPDATE SET
           action = EXCLUDED.action,
           reviewed_by = EXCLUDED.reviewed_by,
           reviewed_at = NOW(),
           review_note = EXCLUDED.review_note`,
        [
          cleanId,
          score,
          ai_hallucinated ? Math.max(0, score - 20) : score,
          action,
          email,
          cleanReason,
        ]
      );

      return NextResponse.json({
        ok: true,
        chatId: cleanId,
        ai_hallucinated,
        ai_hallucination_reason: cleanReason,
      });
    }

    if (type === 'email') {
      await query(
        `UPDATE email_reply_evaluations
         SET ai_hallucinated = $1,
             ai_hallucination_reason = $2,
             ai_audited_at = CASE WHEN $1 IS NULL THEN NULL ELSE NOW() END,
             reviewed_by = COALESCE(reviewed_by, $3),
             reviewed_at = COALESCE(reviewed_at, NOW())
         WHERE message_id = $4 OR ticket_id = $4 OR id::text = $4`,
        [ai_hallucinated, cleanReason, email, cleanId]
      );

      return NextResponse.json({
        ok: true,
        emailId: cleanId,
        ai_hallucinated,
        ai_hallucination_reason: cleanReason,
      });
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Error updating audit' }, { status: 500 });
  }
}
