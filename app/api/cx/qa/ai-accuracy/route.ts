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
    `);
    columnsEnsured = true;
  } catch (err) {
    console.warn('[ai-accuracy-api] ensureAuditColumns warning:', err);
  }
}

export async function GET(req: NextRequest) {
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

  if (!isQA) {
    return NextResponse.json({ error: 'Forbidden: QA only' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const channel = searchParams.get('channel') || 'calls';
  const filter = searchParams.get('filter') || 'accurate'; // 'accurate' | 'hallucinated' | 'all'
  const qa = searchParams.get('qa') || '';

  await ensureAuditColumns();

  // Load distinct QA reviewers
  let qas: string[] = ['Sindhu', 'Yashvi', 'Manorathi', 'Dipti', 'Nandani', 'Isna'];
  try {
    const revRows = await query<{ name: string }>(`
      SELECT DISTINCT reviewed_by AS name FROM call_evaluations WHERE reviewed_by IS NOT NULL AND reviewed_by != ''
      UNION
      SELECT DISTINCT reviewed_by AS name FROM email_reply_evaluations WHERE reviewed_by IS NOT NULL AND reviewed_by != ''
      UNION
      SELECT DISTINCT reviewed_by AS name FROM iqs_scores WHERE reviewed_by IS NOT NULL AND reviewed_by != ''
    `).catch(() => []);
    const fromDb = revRows.map(r => r.name).filter(Boolean);
    qas = Array.from(new Set([...qas, ...fromDb])).sort();
  } catch {
    // ignore
  }

  try {
    if (channel === 'calls') {
      let filterClause = '';
      const params: any[] = [];
      if (filter === 'accurate') {
        filterClause += ' AND ce.ai_hallucinated = false';
      } else if (filter === 'hallucinated') {
        filterClause += ' AND ce.ai_hallucinated = true';
      }
      if (qa && qa !== 'all') {
        params.push(`%${qa.trim()}%`);
        filterClause += ` AND ce.reviewed_by ILIKE $${params.length}`;
      }

      const rows = await query<any>(
        `SELECT
           ce.call_id,
           COALESCE(ce.chat_id, cr.chat_id) as chat_id,
           COALESCE(a.name, 'Unknown') as agent_name,
           ce.iqs_percent,
           cr.call_disposition as disposition,
           cr.duration_seconds,
           cr.called_at,
           ce.ai_hallucinated,
           ce.ai_hallucination_reason,
           ce.reviewed_by,
           ce.reviewed_at,
           ce.gates,
           ce.iqs_scores
         FROM call_evaluations ce
         JOIN call_recordings cr ON cr.id = ce.call_id
         LEFT JOIN agents a ON a.id = ce.agent_id
         WHERE ce.ai_hallucinated IS NOT NULL
           AND ce.ai_audited_at IS NOT NULL
           ${filterClause}
         ORDER BY COALESCE(ce.reviewed_at, cr.called_at) DESC
         LIMIT 100`,
        params
      );

      return NextResponse.json({ items: rows, count: rows.length, qas });
    }

    if (channel === 'chats') {
      let filterClause = '';
      const params: any[] = [];
      if (filter === 'accurate') {
        filterClause += ' AND c.ai_hallucinated = false';
      } else if (filter === 'hallucinated') {
        filterClause += ' AND c.ai_hallucinated = true';
      }
      if (qa && qa !== 'all') {
        params.push(`%${qa.trim()}%`);
        filterClause += ` AND (iqs.reviewed_by ILIKE $${params.length} OR c.tags->>'reviewed_by' ILIKE $${params.length})`;
      }

      const rows = await query<any>(
        `SELECT
           c.id as chat_id,
           COALESCE(a.name, 'Unknown') as agent_name,
           iqs.iqs_score,
           c.tags->>'disposition' as disposition,
           c.created_at,
           c.ai_hallucinated,
           c.ai_hallucination_reason,
           c.updated_at,
           iqs.reviewed_by
         FROM conversations c
         LEFT JOIN agents a ON a.id = c.agent_id
         LEFT JOIN iqs_scores iqs ON iqs.chat_id = c.id
         WHERE c.ai_hallucinated IS NOT NULL
           AND c.ai_audited_at IS NOT NULL
           ${filterClause}
         ORDER BY c.updated_at DESC
         LIMIT 100`,
        params
      );

      return NextResponse.json({ items: rows, count: rows.length, qas });
    }

    if (channel === 'emails') {
      let filterClause = '';
      const params: any[] = [];
      if (filter === 'accurate') {
        filterClause += ' AND e.ai_hallucinated = false';
      } else if (filter === 'hallucinated') {
        filterClause += ' AND e.ai_hallucinated = true';
      }
      if (qa && qa !== 'all') {
        params.push(`%${qa.trim()}%`);
        filterClause += ` AND e.reviewed_by ILIKE $${params.length}`;
      }

      const rows = await query<any>(
        `SELECT
           e.id,
           e.ticket_id,
           COALESCE(e.agent_name, a.name, 'Unknown') as agent_name,
           e.quality_score,
           ec.intent_l1 as intent,
           COALESCE(e.sent_at, e.created_at) as sent_at,
           e.ai_hallucinated,
           e.ai_hallucination_reason,
           e.reviewed_by,
           e.reviewed_at
         FROM email_reply_evaluations e
         LEFT JOIN email_conversations ec ON ec.id = e.ticket_id
         LEFT JOIN agents a ON a.id = e.agent_id
         WHERE e.ai_hallucinated IS NOT NULL
           AND e.ai_audited_at IS NOT NULL
           ${filterClause}
         ORDER BY COALESCE(e.reviewed_at, e.created_at) DESC
         LIMIT 100`,
        params
      );

      return NextResponse.json({ items: rows, count: rows.length, qas });
    }

    return NextResponse.json({ items: [], count: 0, qas });
  } catch (err: any) {
    console.error('[ai-accuracy-api] Error:', err);
    return NextResponse.json({ error: err.message || 'Error fetching AI accuracy list', items: [], count: 0 }, { status: 500 });
  }
}
