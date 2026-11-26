import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { query } from '@/lib/cx/db';
import { storeGetIQSFlags, type IQSFlag } from '@/lib/store';
import { readConfig } from '@/lib/config';
import { reviewThreshold } from '@/lib/quality-thresholds';
import { isTlActionable, getDisputeOwner } from '@/lib/dispute-owner';

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
    `);
    columnsEnsured = true;
  } catch (err) {
    console.warn('[simplified-analytics] ensureAuditColumns warning:', err);
  }
}

async function safe<T>(promise: Promise<T>, fallback: T): Promise<T> {
  try {
    return await promise;
  } catch (err) {
    console.warn('[simplified-analytics] query failed:', err);
    return fallback;
  }
}

function periodDates(params: URLSearchParams): { from: Date; to: Date } | null {
  const p = params.get('period');
  if (p === 'all') return null;

  const now = new Date();
  if (p === 'custom') {
    const from = params.get('from');
    const to = params.get('to');
    if (!from || !to) return null;
    return {
      from: new Date(`${from}T00:00:00+05:30`),
      to: new Date(`${to}T23:59:59+05:30`),
    };
  }

  // Exactly matching app/api/cx/qa/analytics/route.ts
  const days = p === '30' ? 30 : 7;
  const from = new Date(now);
  from.setDate(from.getDate() - days);
  from.setHours(0, 0, 0, 0);
  return { from, to: now };
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const role = ((session.user as any)?.role || '').toLowerCase();
  const email = ((session.user as any)?.email || '').toLowerCase();
  const name = ((session.user as any)?.name || '');

  if (!['quality', 'admin', 'tl'].includes(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const range = periodDates(searchParams);
  const fromISO = range?.from.toISOString();
  const toISO = range?.to.toISOString();

  // ── 1. Resolve dispositions assigned to this QA (exact match with main portal) ──
  const config = await readConfig().catch(() => null);
  let dispositions: string[] = [];

  if (role === 'admin') {
    const explicit = searchParams.getAll('disposition');
    if (explicit.length) {
      dispositions = explicit;
    } else {
      const rows = await query<{ d: string }>(
        `SELECT DISTINCT tags->>'disposition' AS d FROM conversations
         WHERE tags->>'disposition' IS NOT NULL AND tags->>'disposition' != ''`
      ).catch(() => []);
      dispositions = rows.map((r) => r.d);
    }
  } else {
    const map = config?.qaDispositionMap ?? [];
    const entry = map.find((e: any) => e.email?.toLowerCase() === email);
    const configUser = config?.users?.find((u: any) => (u.email || u.username || '').toLowerCase() === email);
    dispositions = entry?.dispositions ?? configUser?.assignedDispositions ?? [];
    if (!dispositions.length && (email.includes('sindhu') || name.toLowerCase().includes('sindhu'))) {
      dispositions = ['Asset', 'Bond Purchase', 'Wint Wisdom', 'Wint Ivory'];
    }
  }

  const lowerDispositions = dispositions.map((d) => d.toLowerCase().trim());
  const chatThreshold = reviewThreshold(config, 'chat');
  const callThreshold = reviewThreshold(config, 'call');
  const emailThreshold = reviewThreshold(config, 'email') || 85;

  // ── 2. Live Pending Reviews for Chats & Calls (exact match with /api/cx/qa/chats-to-review & /api/cx/qa/calls-to-review) ──
  const chatPendingPromise = safe(
    (async () => {
      const chatDispWhere = dispositions.length > 0 ? `c.tags->>'disposition' = ANY($1::text[]) AND ` : '';
      const chatParams = dispositions.length > 0 ? [dispositions] : [];
      const rows = await query<{ cnt: string }>(`
        SELECT COUNT(*)::text AS cnt
        FROM iqs_scores i
        JOIN conversations c ON c.id = i.chat_id
        LEFT JOIN agents a ON a.id = c.agent_id
        WHERE ${chatDispWhere}i.status IN ('pending', 'reopened')
          AND (
            (i.iqs_score IS NOT NULL AND i.iqs_score <= ${chatThreshold})
            OR (i.iqs_score IS NULL AND (c.csat_score = 1 OR c.csat_label = 'bad'))
          )
          AND (a.status IS NULL OR a.status != 'inactive')
          AND (a.name IS NULL OR a.name != 'Robylon AI')
          AND (c.agent_id IS NULL OR c.agent_id NOT IN (15, 447, 784))
      `, chatParams);
      return parseInt(rows[0]?.cnt ?? '0', 10);
    })(),
    0
  );

  const callPendingPromise = safe(
    (async () => {
      const callDispWhere = dispositions.length > 0
        ? `EXISTS (SELECT 1 FROM unnest($1::text[]) d WHERE LOWER(cr.call_disposition) = LOWER(d)) AND `
        : '';
      const callParams = dispositions.length > 0 ? [dispositions] : [];
      const rows = await query<{ cnt: string }>(`
        SELECT COUNT(*)::text AS cnt
        FROM call_evaluations ce
        JOIN call_recordings cr ON cr.id = ce.call_id
        LEFT JOIN agents a ON a.id = ce.agent_id
        WHERE ${callDispWhere}ce.status IN ('pending', 'reopened')
          AND ce.iqs_percent IS NOT NULL
          AND (ce.iqs_percent <= ${callThreshold} OR ce.verdict = 'FAILED_CRITICAL')
          AND (a.status IS NULL OR a.status != 'inactive')
      `, callParams);
      return parseInt(rows[0]?.cnt ?? '0', 10);
    })(),
    0
  );

  const [pendingChats, pendingCalls] = await Promise.all([chatPendingPromise, callPendingPromise]);

  // ── 3. Live Pending Emails (always unreviewed backlog, no period filter) ──
  const emailPendingPromise = safe(
    (async () => {
      let q = `
        SELECT COUNT(*)::text AS cnt
        FROM email_reply_evaluations e
        LEFT JOIN email_conversations ec ON ec.id = e.ticket_id
        WHERE e.evaluation_status = 'Completed'
          AND (e.review_status = 'pending' OR e.review_status IS NULL)
          AND (
            e.quality_score IS NULL
            OR e.quality_score <= $1
            OR e.compliance_passed = FALSE
            OR COALESCE(array_length(e.compliance_issues, 1), 0) > 0
          )
      `;
      const params: any[] = [emailThreshold];

      if (lowerDispositions.length > 0) {
        params.push(lowerDispositions);
        q += ` AND LOWER(TRIM(COALESCE(ec.intent_l1, ''))) = ANY($${params.length}::text[])`;
      }

      const rows = await query<{ cnt: string }>(q, params);
      return parseInt(rows[0]?.cnt || '0', 10);
    })(),
    0
  );

  // ── 4. Disputes (Chats, Calls, Emails) ──
  const flagsPromise = safe(
    (async () => {
      const owner = await getDisputeOwner();
      const rawFlags = await storeGetIQSFlags();
      let parsed: IQSFlag[] = rawFlags
        .map((r) => {
          try {
            return JSON.parse(r) as IQSFlag;
          } catch {
            return null;
          }
        })
        .filter((f): f is IQSFlag => {
          if (!f || f.messageId) return false;
          if (isTlActionable(f, owner)) return false;
          return f.status === 'tl_forwarded' || f.status === 'pending' || f.status === 'ir_pending_tl';
        });

      if (range) {
        const fromMs = range.from.getTime();
        const toMs = range.to.getTime();
        parsed = parsed.filter((f) => {
          const dateStr = f.flaggedAt || (f as any).createdAt;
          if (!dateStr) return true;
          const t = new Date(dateStr).getTime();
          return t >= fromMs && t <= toMs;
        });
      }

      // Filter by QA dispositions if assigned
      if (dispositions.length > 0) {
        const dispSet = new Set(lowerDispositions);
        parsed = parsed.filter((f) => {
          if (!f.disposition) return true;
          return dispSet.has(f.disposition.toLowerCase().trim());
        });
      }

      const chats = parsed.filter((f) => !f.callId && !f.messageId).length;
      const calls = parsed.filter((f) => Boolean(f.callId) && !f.messageId).length;
      return { chats, calls };
    })(),
    { chats: 0, calls: 0 }
  );

  const emailDisputesPromise = safe(
    (async () => {
      let q = `
        SELECT COUNT(*)::text AS cnt
        FROM email_reply_evaluations e
        LEFT JOIN email_conversations ec ON ec.id = e.ticket_id
        WHERE e.dispute_status IN ('Raised', 'Under_Review')
      `;
      const params: any[] = [];
      if (lowerDispositions.length > 0) {
        params.push(lowerDispositions);
        q += ` AND LOWER(TRIM(COALESCE(ec.intent_l1, ''))) = ANY($${params.length}::text[])`;
      }
      if (range && fromISO && toISO) {
        params.push(fromISO, toISO);
        q += ` AND e.sent_at >= $${params.length - 1} AND e.sent_at <= $${params.length}`;
      }
      const rows = await query<{ cnt: string }>(q, params);
      return parseInt(rows[0]?.cnt || '0', 10);
    })(),
    0
  );

  // ── 5. AI Accuracy vs. Hallucination Audit Breakdown (Only QA marked moving forward) ──
  await ensureAuditColumns();

  const chatAiAuditPromise = safe(
    (async () => {
      let q = `
        SELECT
          COUNT(*)::text AS total,
          COUNT(*) FILTER (WHERE c.ai_hallucinated = false)::text AS accurate,
          COUNT(*) FILTER (WHERE c.ai_hallucinated = true)::text AS hallucinated
        FROM conversations c
        WHERE c.ai_hallucinated IS NOT NULL
          AND c.ai_audited_at IS NOT NULL
      `;
      const params: any[] = [];
      if (dispositions.length > 0) {
        params.push(dispositions);
        q += ` AND c.tags->>'disposition' = ANY($${params.length})`;
      }
      if (range && fromISO && toISO) {
        params.push(fromISO, toISO);
        q += ` AND c.ai_audited_at >= $${params.length - 1} AND c.ai_audited_at <= $${params.length}`;
      }
      const rows = await query<{ total: string; accurate: string; hallucinated: string }>(q, params);
      const r = rows[0];
      const total = parseInt(r?.total || '0', 10);
      const accurate = total > 0 ? parseInt(r?.accurate || '0', 10) : 0;
      const hallucinated = total > 0 ? parseInt(r?.hallucinated || '0', 10) : 0;
      const rate = total > 0 ? Math.round((accurate / total) * 1000) / 10 : null;
      return { evaluated: total, accurate, hallucinated, accuracyRate: rate };
    })(),
    { evaluated: 0, accurate: 0, hallucinated: 0, accuracyRate: null }
  );

  const callAiAuditPromise = safe(
    (async () => {
      let q = `
        SELECT
          COUNT(*)::text AS total,
          COUNT(*) FILTER (WHERE ce.ai_hallucinated = false)::text AS accurate,
          COUNT(*) FILTER (WHERE ce.ai_hallucinated = true)::text AS hallucinated
        FROM call_evaluations ce
        LEFT JOIN call_recordings rec ON rec.id = ce.call_id
        WHERE ce.ai_hallucinated IS NOT NULL
          AND ce.ai_audited_at IS NOT NULL
      `;
      const params: any[] = [];
      if (dispositions.length > 0) {
        params.push(dispositions);
        q += ` AND rec.call_disposition = ANY($${params.length})`;
      }
      if (range && fromISO && toISO) {
        params.push(fromISO, toISO);
        q += ` AND ce.ai_audited_at >= $${params.length - 1} AND ce.ai_audited_at <= $${params.length}`;
      }
      const rows = await query<{ total: string; accurate: string; hallucinated: string }>(q, params);
      const r = rows[0];
      const total = parseInt(r?.total || '0', 10);
      const accurate = total > 0 ? parseInt(r?.accurate || '0', 10) : 0;
      const hallucinated = total > 0 ? parseInt(r?.hallucinated || '0', 10) : 0;
      const rate = total > 0 ? Math.round((accurate / total) * 1000) / 10 : null;
      return { evaluated: total, accurate, hallucinated, accuracyRate: rate };
    })(),
    { evaluated: 0, accurate: 0, hallucinated: 0, accuracyRate: null }
  );

  const emailAiAuditPromise = safe(
    (async () => {
      let q = `
        SELECT
          COUNT(*)::text AS total,
          COUNT(*) FILTER (WHERE e.ai_hallucinated = false)::text AS accurate,
          COUNT(*) FILTER (WHERE e.ai_hallucinated = true)::text AS hallucinated
        FROM email_reply_evaluations e
        LEFT JOIN email_conversations ec ON ec.id = e.ticket_id
        WHERE e.ai_hallucinated IS NOT NULL
          AND e.ai_audited_at IS NOT NULL
      `;
      const params: any[] = [];
      if (lowerDispositions.length > 0) {
        params.push(lowerDispositions);
        q += ` AND LOWER(TRIM(COALESCE(ec.intent_l1, ''))) = ANY($${params.length}::text[])`;
      }
      if (range && fromISO && toISO) {
        params.push(fromISO, toISO);
        q += ` AND e.ai_audited_at >= $${params.length - 1} AND e.ai_audited_at <= $${params.length}`;
      }
      const rows = await query<{ total: string; accurate: string; hallucinated: string }>(q, params);
      const r = rows[0];
      const total = parseInt(r?.total || '0', 10);
      const accurate = total > 0 ? parseInt(r?.accurate || '0', 10) : 0;
      const hallucinated = total > 0 ? parseInt(r?.hallucinated || '0', 10) : 0;
      const rate = total > 0 ? Math.round((accurate / total) * 1000) / 10 : null;
      return { evaluated: total, accurate, hallucinated, accuracyRate: rate };
    })(),
    { evaluated: 0, accurate: 0, hallucinated: 0, accuracyRate: null }
  );

  const [pendingEmails, flagCounts, emailDisputes, chatAi, callAi, emailAi] = await Promise.all([
    emailPendingPromise,
    flagsPromise,
    emailDisputesPromise,
    chatAiAuditPromise,
    callAiAuditPromise,
    emailAiAuditPromise,
  ]);

  const totalPending = pendingChats + pendingCalls + pendingEmails;
  const totalDisputes = flagCounts.chats + flagCounts.calls + emailDisputes;

  const totalAiEvaluated = chatAi.evaluated + callAi.evaluated + emailAi.evaluated;
  const totalAiAccurate = chatAi.accurate + callAi.accurate + emailAi.accurate;
  const totalAiHallucinated = chatAi.hallucinated + callAi.hallucinated + emailAi.hallucinated;
  const totalAiAccuracyRate =
    totalAiEvaluated > 0
      ? Math.round((totalAiAccurate / totalAiEvaluated) * 1000) / 10
      : null;

  return NextResponse.json({
    period: searchParams.get('period') || '7',
    from: fromISO,
    to: toISO,
    dispositions,
    pending: {
      total: totalPending,
      chats: pendingChats,
      calls: pendingCalls,
      emails: pendingEmails,
    },
    disputes: {
      total: totalDisputes,
      chats: flagCounts.chats,
      calls: flagCounts.calls,
      emails: emailDisputes,
    },
    aiAccuracy: {
      total: {
        evaluated: totalAiEvaluated,
        accurate: totalAiAccurate,
        hallucinated: totalAiHallucinated,
        accuracyRate: totalAiAccuracyRate,
      },
      chats: chatAi,
      calls: callAi,
      emails: emailAi,
    },
    botPoorDispositions: await safe(
      (async () => {
        const params: any[] = [];
        const whereParts: string[] = [
          `(a.name IN ('Robylon', 'Robylon AI', 'Robylon Automation') OR c.agent_id IN (15, 447, 784))`,
          `c.tags->>'disposition' IS NOT NULL`,
          `c.tags->>'disposition' != ''`,
          `c.tags->>'disposition' NOT ILIKE '%junk%'`,
          `(c.tags->>'sub_disposition' IS NULL OR c.tags->>'sub_disposition' NOT ILIKE '%junk%')`,
        ];
        if (range && fromISO && toISO) {
          params.push(fromISO, toISO);
          whereParts.push(`c.closed_at >= $${params.length - 1} AND c.closed_at <= $${params.length}`);
        }
        return query<{
          disposition: string;
          volume: number;
          avg_iqs: number | null;
          low_iqs_count: number;
          csat_pct: number | null;
          bad_csat_count: number;
        }>(`
          SELECT
            COALESCE(NULLIF(TRIM(c.tags->>'disposition'), ''), 'Other') AS disposition,
            COUNT(c.id)::int AS volume,
            ROUND(AVG(COALESCE((i.parameters->'__scores'->>'bot_iqs')::numeric, i.iqs_score))::numeric, 1)::float AS avg_iqs,
            COUNT(*) FILTER (WHERE COALESCE((i.parameters->'__scores'->>'bot_iqs')::numeric, i.iqs_score) < 80)::int AS low_iqs_count,
            ROUND(COUNT(CASE WHEN c.csat_label = 'good' OR c.csat_score = 5 THEN 1 END)::numeric
                  / NULLIF(COUNT(CASE WHEN c.csat_label IS NOT NULL OR c.csat_score IN (1,3,5) THEN 1 END), 0) * 100, 1)::float AS csat_pct,
            COUNT(*) FILTER (WHERE c.csat_label = 'bad' OR c.csat_score = 1)::int AS bad_csat_count
          FROM conversations c
          LEFT JOIN agents a ON a.id = c.agent_id
          LEFT JOIN iqs_scores i ON i.chat_id = c.id
          WHERE ${whereParts.join(' AND ')}
          GROUP BY 1
          HAVING COUNT(c.id) >= 3
            AND (
              AVG(COALESCE((i.parameters->'__scores'->>'bot_iqs')::numeric, i.iqs_score)) < 90
              OR COUNT(*) FILTER (WHERE COALESCE((i.parameters->'__scores'->>'bot_iqs')::numeric, i.iqs_score) < 80) > 0
            )
          ORDER BY AVG(COALESCE((i.parameters->'__scores'->>'bot_iqs')::numeric, i.iqs_score)) ASC NULLS LAST, COUNT(c.id) DESC
          LIMIT 12
        `, params);
      })(),
      []
    ),
  });
}
