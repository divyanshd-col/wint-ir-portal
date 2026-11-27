import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { query } from '@/lib/cx/db';
import { readConfig } from '@/lib/config';
import { calculateWeightedOverallIQS, extractPooledParams } from '@/lib/quality';

async function resolveAgentId(dbUser: any, agentName: string): Promise<number | null> {
  if (dbUser?.user_id) {
    const byUserId = await query<any>(`SELECT id FROM agents WHERE user_id = $1 LIMIT 1`, [dbUser.user_id]);
    if (byUserId.length > 0) return byUserId[0].id;
  }
  if (!agentName) return null;
  const nameTrimmed = agentName.trim();
  const byName = await query<any>(
    `SELECT id FROM agents 
     WHERE LOWER(name) = LOWER($1) 
        OR LOWER($1) LIKE LOWER(name || ' %') 
        OR LOWER(name) LIKE LOWER($1 || ' %')
     ORDER BY (CASE WHEN LOWER(name) = LOWER($1) THEN 0 ELSE 1 END), (status = 'active') DESC, id ASC
     LIMIT 1`,
    [nameTrimmed]
  );
  if (byName.length > 0) return byName[0].id;
  return null;
}

async function enrichReportsWithLiveScores(reports: any[]): Promise<any[]> {
  const chatIds = new Set<string>();
  for (const r of reports) {
    const evList = r.generated?.evidence;
    if (Array.isArray(evList)) {
      for (const ev of evList) {
        if (ev.chatId) chatIds.add(String(ev.chatId));
      }
    }
  }

  if (chatIds.size === 0) return reports;

  try {
    const scoreRows = await query<any>(
      `SELECT chat_id, iqs_score, reviewed_by, reviewed_at, review_note
       FROM iqs_scores
       WHERE chat_id = ANY($1)`,
      [Array.from(chatIds)]
    );
    const scoreMap = new Map<string, any>(scoreRows.map(s => [String(s.chat_id), s]));

    for (const r of reports) {
      if (r.generated && Array.isArray(r.generated.evidence)) {
        r.generated.evidence = r.generated.evidence.map((ev: any) => {
          const live = scoreMap.get(String(ev.chatId));
          if (live && live.iqs_score != null) {
            const liveScore = Math.round(Number(live.iqs_score));
            return {
              ...ev,
              score: liveScore,
              originalScore: ev.score,
              ...(live.reviewed_by ? {
                reviewedBy: live.reviewed_by,
                reviewedAt: live.reviewed_at,
                reviewNote: live.review_note,
                isReviewed: true,
              } : {}),
            };
          }
          return ev;
        });
      }
    }
  } catch (err: any) {
    console.error('[ir-reports-api] enrichReportsWithLiveScores error:', err?.message);
  }

  return reports;
}

function formatSimpleCoachingPoint(
  channel: 'chat' | 'call' | 'email',
  score: number,
  agentName: string,
  paramsObj: any,
  complianceIssues?: any,
  fallbackReason?: string | null,
  idx = 0
): string {
  const firstName = (agentName || 'Agent').split(' ')[0];

  const PARAM_PLAIN_ENGLISH: Record<string, string> = {
    issue_resolution: `${firstName} did not completely resolve the customer's issue before ending the interaction.`,
    accuracy: `${firstName} shared inaccurate or incomplete details while answering the query.`,
    expectation_follow_through: `${firstName} did not set clear expectations or a specific follow-up timeline.`,
    dissatisfactionhandling: `${firstName} could have handled the customer's dissatisfaction more empathetically and proactively.`,
    personalization: `${firstName} gave a generic response instead of personalizing it to the customer's specific context.`,
    empathy: `${firstName} could have acknowledged the customer's concern more warmly.`,
    escalation_decision: `${firstName} missed escalating or routing the issue appropriately.`,
    readability: `${firstName}'s message was hard to follow; clearer structure and formatting would help.`,
    greeting_handover: `${firstName} missed a polite greeting or proper closing handover.`,
    post_call_recap: `${firstName} did not provide a clear post-call summary of next steps.`,
    call_opening: `${firstName} missed a warm greeting and clear introduction at the start of the call.`,
    opening: `${firstName} missed a warm greeting and clear introduction at the start of the call.`,
    call_closing: `${firstName} ended the call without summarizing the outcome and next steps.`,
    follow_up: `${firstName} ended the call without summarizing the outcome and next steps.`,
    technical: `${firstName} quoted inaccurate or incomplete product or policy information.`,
    all_questions: `${firstName} missed answering one or more of the customer's questions during the interaction.`,
    expectation: `${firstName} did not set a clear timeline or next step for the customer.`,
    process: `${firstName} missed checking the customer's existing details beforehand or skipped a process step.`,
    grammar: `${firstName} had phrasing or grammar issues that made the explanation less clear.`,
    fillers: `${firstName} had noticeable pauses, dead air, or filler words during the call.`,
    energy_tone: `${firstName}'s tone sounded flat or rushed; a warmer, calmer tone helps build trust.`,
    active_listening: `${firstName} interrupted or missed acknowledging what the customer shared.`,
    simplifying: `${firstName} used technical terms without explaining them in simple words.`,
  };

  // High-scoring (> 75%) -> Demonstrated Strengths / Best Practice
  if (score > 75) {
    if (score === 100) {
      if (channel === 'call') {
        const lines = [
          `${firstName} delivered a stellar call with accurate answers, clear expectations, and warm customer rapport.`,
          `${firstName} answered all customer questions thoroughly and closed the call with clear next steps.`,
        ];
        return lines[idx % lines.length];
      }
      if (channel === 'email') {
        return `${firstName} wrote a clear, accurate, and complete email reply that resolved the customer's query.`;
      }
      return `${firstName} resolved the customer's chat query completely with accurate details and a helpful tone.`;
    }
    if (score >= 90) {
      if (channel === 'call') return `${firstName} handled the customer's questions clearly, maintained strong rapport, and followed all quality guidelines.`;
      if (channel === 'email') return `${firstName} sent a well-structured, accurate email reply with clear next steps.`;
      return `${firstName} responded promptly, explained the solution clearly, and followed all quality guidelines.`;
    }
    if (channel === 'call') return `${firstName} maintained good call flow and addressed the customer's query accurately.`;
    if (channel === 'email') return `${firstName} provided a helpful and compliant email reply to the customer.`;
    return `${firstName} handled the chat well with accurate answers and polite communication.`;
  }

  // Low-scoring (<= 75%) -> Primary Coaching Point / Issue in plain simple English
  if (complianceIssues) {
    const issueText = Array.isArray(complianceIssues)
      ? complianceIssues.map((x) => (typeof x === 'string' ? x : x?.reason || x?.mention || '')).filter(Boolean).join('; ')
      : String(complianceIssues);
    if (issueText && !issueText.includes('[object Object]')) {
      return issueText.length > 180 ? `${issueText.slice(0, 177)}...` : issueText;
    }
  }

  if (paramsObj && typeof paramsObj === 'object') {
    const entries = Object.entries(paramsObj);
    for (const [k, v] of entries) {
      if (k.startsWith('__')) continue;
      if (v && typeof v === 'object') {
        const val = v as any;
        const ans = String(val.answer || val.verdict || val.rating || '').toLowerCase();
        if (ans === 'no' || ans === 'partial' || ans === 'fail' || (typeof val.score === 'number' && val.score === 0)) {
          if (typeof val.reason === 'string' && val.reason.trim().length > 8) {
            const clean = val.reason.trim();
            return clean.length > 180 ? `${clean.slice(0, 177)}...` : clean;
          }
          if (PARAM_PLAIN_ENGLISH[k]) return PARAM_PLAIN_ENGLISH[k];
        }
      } else if (typeof v === 'string') {
        const ans = v.toLowerCase();
        if ((ans === 'no' || ans === 'partial' || ans === 'fail') && PARAM_PLAIN_ENGLISH[k]) {
          return PARAM_PLAIN_ENGLISH[k];
        }
      }
    }
  }

  if (fallbackReason && typeof fallbackReason === 'string') {
    const trimmed = fallbackReason.trim();
    const lower = trimmed.toLowerCase();
    const isEnum = /^[a-z0-9_]+$/i.test(trimmed) || ['remediation', 'pass', 'fail', 'failed critical', 'failed_critical', 'needs_review', 'pending', 'reviewed'].includes(lower);
    if (!isEnum && trimmed.length > 8) {
      return trimmed.length > 180 ? `${trimmed.slice(0, 177)}...` : trimmed;
    }
  }

  if (channel === 'call') return `${firstName} missed key quality steps on this call; review opening, accuracy, and expectation setting.`;
  if (channel === 'email') return `${firstName}'s email reply missed key details or clarity; ensure all customer questions are answered simply.`;
  return `${firstName} missed key resolution or clarity steps in this chat; review the conversation for coaching.`;
}

async function enrichDhanushLatestScorecard(report: any, agentId: number, agentName: string): Promise<any> {
  if (!report || !report.generated) return report;
  const weekStart = report.week_start;
  const weekEnd = report.week_end;
  const gen = report.generated;
  const nums = gen.numbers || {};

  // 1. Live Chats for [weekStart, weekEnd] matching My Analytics / Member Analytics
  let chatRows: any[] = [];
  try {
    chatRows = await query<any>(
      `SELECT
         c.id AS chat_id,
         c.csat_score,
         c.csat_label,
         c.tags->>'disposition' AS disposition,
         c.tags->>'sub_disposition' AS sub_disposition,
         s.iqs_score,
         s.parameters,
         s.reviewed_by,
         s.review_note
       FROM conversations c
       LEFT JOIN iqs_scores s ON s.chat_id = c.id
       WHERE c.agent_id = $1
         AND c.closed_at::date >= $2::date
         AND c.closed_at::date <= $3::date
       ORDER BY s.iqs_score ASC NULLS LAST, c.closed_at DESC`,
      [agentId, weekStart, weekEnd]
    );
  } catch (err: any) {
    console.warn('[ir-reports-api] chats live enrichment warning:', err?.message);
  }

  const chatEvidenceFromGen = new Map<string, any>(
    (Array.isArray(gen.evidence) ? gen.evidence : []).map((e: any) => [String(e.chatId), e])
  );
  const chatBreaches: any[] = Array.isArray(gen.breaches) ? gen.breaches : [];

  const chatsHandled = chatRows.length > 0 ? chatRows.length : Number(nums.chatsHandled ?? 0);
  const scoredNonJunkChats = chatRows.filter((r) => {
    const isJunk = r.disposition && String(r.disposition).toLowerCase().includes('junk');
    return !isJunk && r.iqs_score != null;
  });
  const chatScores = scoredNonJunkChats.map((r) => Math.round(Number(r.iqs_score))).filter((n) => !Number.isNaN(n));
  const pooledChatParams = extractPooledParams(
    scoredNonJunkChats.map((r) => r.parameters).filter(Boolean)
  );
  const weightedChatIqs = calculateWeightedOverallIQS(pooledChatParams, 'human', { roundDecimals: 1 });
  const chatsAvgScore = weightedChatIqs != null
    ? Math.round(weightedChatIqs)
    : chatScores.length > 0
      ? Math.round(chatScores.reduce((a, b) => a + b, 0) / chatScores.length)
      : (nums.averageScore != null ? Number(nums.averageScore) : null);
  const chatsBelow85 = chatScores.length > 0
    ? chatScores.filter((s) => s < 85).length
    : Number(nums.below85Count ?? 0);
  const chatsBreachesCount = Number(nums.complianceBreachesCount ?? chatBreaches.length ?? 0);

  // Live CSAT for chats
  let csatText = nums.csatText || 'No ratings recorded';
  if (chatRows.length > 0) {
    const rated = chatRows.filter((r) => r.csat_score != null || r.csat_label != null);
    if (rated.length > 0) {
      const good = rated.filter((r) => Number(r.csat_score) === 5 || String(r.csat_label || '').toLowerCase() === 'good').length;
      const pct = Math.round((good / rated.length) * 1000) / 10;
      csatText = `${pct}% (${good}/${rated.length} rated)`;
    }
  }

  const chatsEvidence: any[] = (scoredNonJunkChats.length > 0
    ? scoredNonJunkChats.map((r, idx) => {
        const sc = Math.round(Number(r.iqs_score));
        const prev = chatEvidenceFromGen.get(String(r.chat_id));
        const rawSummary = prev?.summary || '';
        const coaching = formatSimpleCoachingPoint('chat', sc, agentName, r.parameters, null, rawSummary, idx);
        return {
          channel: 'chat',
          id: String(r.chat_id),
          chatId: String(r.chat_id),
          score: sc,
          topic: [r.disposition, r.sub_disposition].filter(Boolean).join(' › ') || prev?.topic || 'Chat Interaction',
          summary: coaching,
          isReviewed: Boolean(r.reviewed_by),
          reviewNote: r.review_note || undefined,
        };
      })
    : (Array.isArray(gen.evidence) ? gen.evidence : []).map((ev: any, idx: number) => ({
        ...ev,
        channel: 'chat',
        id: String(ev.chatId),
        summary: formatSimpleCoachingPoint('chat', Number(ev.score ?? 100), agentName, null, null, ev.summary, idx),
      }))
  );

  // 2. Live Calls for [weekStart, weekEnd]
  let callRows: any[] = [];
  try {
    callRows = await query<any>(
      `SELECT
         cr.id AS call_id,
         COALESCE(ce.chat_id, cr.chat_id) AS chat_id,
         cr.duration_seconds,
         cr.call_disposition,
         cr.call_sub_disposition,
         COALESCE(ce.iqs_percent, s.call_iqs_score) AS score,
         COALESCE(ce.iqs_scores, s.call_parameters) AS call_params,
         ce.call_gate_result,
         ce.breach_mentions,
         ce.verdict,
         COALESCE(ce.reviewed_by, s.reviewed_by) AS reviewed_by,
         COALESCE(ce.review_note, s.review_note) AS review_note
       FROM call_recordings cr
       LEFT JOIN call_evaluations ce ON ce.call_id = cr.id
       LEFT JOIN conversations c ON c.id = cr.chat_id
       LEFT JOIN iqs_scores s ON s.chat_id = cr.chat_id
       WHERE COALESCE(ce.agent_id, cr.agent_id, c.agent_id) = $1
         AND cr.called_at::date >= $2::date
         AND cr.called_at::date <= $3::date
       ORDER BY COALESCE(ce.iqs_percent, s.call_iqs_score) ASC NULLS LAST, cr.called_at DESC`,
      [agentId, weekStart, weekEnd]
    );
  } catch (err: any) {
    console.warn('[ir-reports-api] calls enrichment warning:', err?.message);
  }

  const callsHandled = callRows.length;
  const scoredNonJunkCalls = callRows.filter((r) => {
    const d1 = String(r.call_disposition || '').toLowerCase();
    const d2 = String(r.call_sub_disposition || '').toLowerCase();
    return !d1.includes('junk') && !d2.includes('junk') && r.score != null;
  });
  const callScores = scoredNonJunkCalls.map((r) => Math.round(Number(r.score))).filter((n) => !Number.isNaN(n));
  const callsAvgScore = callScores.length > 0 ? Math.round(callScores.reduce((a, b) => a + b, 0) / callScores.length) : null;
  const callsBelow85 = callScores.filter((s) => s < 85).length;

  const durations = callRows.map((r) => Number(r.duration_seconds)).filter((d) => !Number.isNaN(d) && d > 0);
  let avgDurationText = '—';
  if (durations.length > 0) {
    const avgSec = Math.round(durations.reduce((a, b) => a + b, 0) / durations.length);
    const m = Math.floor(avgSec / 60);
    const s = avgSec % 60;
    avgDurationText = `${m}m ${s}s avg duration`;
  }

  let callsBreachesCount = 0;
  const callsEvidence: any[] = scoredNonJunkCalls.map((r, idx) => {
    const sc = Math.round(Number(r.score));
    const hasGateFail = String(r.call_gate_result || '').toUpperCase() === 'FAIL';
    const mentions = Array.isArray(r.breach_mentions) ? r.breach_mentions : [];
    if (hasGateFail) callsBreachesCount++;
    const coaching = formatSimpleCoachingPoint('call', sc, agentName, r.call_params, hasGateFail ? mentions : null, r.verdict, idx);
    return {
      channel: 'call',
      id: String(r.call_id),
      chatId: r.chat_id ? String(r.chat_id) : String(r.call_id),
      score: sc,
      topic: [r.call_disposition, r.call_sub_disposition].filter(Boolean).join(' › ') || 'Call Interaction',
      summary: coaching,
      isReviewed: Boolean(r.reviewed_by),
      reviewNote: r.review_note || undefined,
    };
  });

  // 3. Live Emails for [weekStart, weekEnd] (using c.subject_line!)
  let emailRows: any[] = [];
  try {
    emailRows = await query<any>(
      `SELECT
         e.id,
         e.ticket_id,
         e.message_id,
         COALESCE(e.qa_override_score, e.quality_score) AS score,
         e.compliance_passed,
         e.compliance_issues,
         e.parameter_scores,
         e.qa_notes,
         e.reviewed_by,
         c.subject_line,
         c.intent_l1
       FROM email_reply_evaluations e
       LEFT JOIN email_conversations c ON c.id = e.ticket_id
       WHERE (e.agent_id = $1 OR LOWER(TRIM(e.agent_name)) = LOWER(TRIM($2)))
         AND e.sent_at::date >= $3::date
         AND e.sent_at::date <= $4::date
         AND e.evaluation_status = 'Completed'
       ORDER BY COALESCE(e.qa_override_score, e.quality_score) ASC NULLS LAST, e.sent_at DESC`,
      [agentId, agentName, weekStart, weekEnd]
    );
  } catch (err: any) {
    console.warn('[ir-reports-api] emails enrichment warning:', err?.message);
  }

  const emailsHandled = emailRows.length;
  const scoredNonJunkEmails = emailRows.filter((r) => {
    const l1 = String(r.intent_l1 || '').toLowerCase();
    return !l1.includes('junk') && r.score != null;
  });
  const emailScores = scoredNonJunkEmails.map((r) => Math.round(Number(r.score))).filter((n) => !Number.isNaN(n));
  const emailsAvgScore = emailScores.length > 0 ? Math.round(emailScores.reduce((a, b) => a + b, 0) / emailScores.length) : null;
  const emailsBelow85 = emailScores.filter((s) => s < 85).length;
  let emailsBreachesCount = 0;
  const emailsEvidence: any[] = scoredNonJunkEmails.map((r, idx) => {
    const sc = Math.round(Number(r.score));
    if (r.compliance_passed === false) emailsBreachesCount++;
    const coaching = formatSimpleCoachingPoint('email', sc, agentName, r.parameter_scores, r.compliance_issues, r.qa_notes, idx);
    return {
      channel: 'email',
      id: String(r.ticket_id || r.message_id || r.id),
      messageId: String(r.message_id || r.id),
      score: sc,
      topic: r.intent_l1 || r.subject_line || 'Email Support',
      summary: coaching,
      isReviewed: Boolean(r.reviewed_by),
    };
  });

  // 4. Consolidated metrics across all 3 channels
  const totalInteractions = chatsHandled + callsHandled + emailsHandled;
  const totalBelow85Count = chatsBelow85 + callsBelow85 + emailsBelow85;
  const totalComplianceBreaches = chatsBreachesCount + callsBreachesCount + emailsBreachesCount;

  let weightedScoreSum = 0;
  let weightedCount = 0;
  if (chatsHandled > 0 && chatsAvgScore != null) {
    weightedScoreSum += chatsAvgScore * chatsHandled;
    weightedCount += chatsHandled;
  }
  if (callsHandled > 0 && callsAvgScore != null) {
    weightedScoreSum += callsAvgScore * callsHandled;
    weightedCount += callsHandled;
  }
  if (emailsHandled > 0 && emailsAvgScore != null) {
    weightedScoreSum += emailsAvgScore * emailsHandled;
    weightedCount += emailsHandled;
  }
  const blendedAvgScore = weightedCount > 0 ? Math.round(weightedScoreSum / weightedCount) : chatsAvgScore;

  // 5. Channel highlights
  const whatWentWellChats = gen.whatWentWell || (
    chatsHandled > 0
      ? `Maintained ${chatsAvgScore ?? 0}% average IQS across ${chatsHandled} evaluated chat${chatsHandled === 1 ? '' : 's'} (${csatText}).`
      : 'No evaluated chats recorded during this period.'
  );
  const whatWentWellCalls = callsHandled > 0
    ? `Handled ${callsHandled} evaluated call${callsHandled === 1 ? '' : 's'} with an average IQS of ${callsAvgScore ?? 0}% (${avgDurationText}). Maintained clear communication and structured issue resolution.`
    : 'No evaluated calls recorded during this period.';
  const whatWentWellEmails = emailsHandled > 0
    ? `Resolved ${emailsHandled} evaluated email repl${emailsHandled === 1 ? 'y' : 'ies'} with an average IQS of ${emailsAvgScore ?? 0}% and thorough written clarity.`
    : 'No evaluated email replies recorded during this period.';

  return {
    ...report,
    generated: {
      ...gen,
      unified: {
        blendedAvgScore,
        totalInteractions,
        totalBelow85Count,
        totalComplianceBreaches,
        chats: {
          handled: chatsHandled,
          avgScore: chatsAvgScore,
          below85Count: chatsBelow85,
          breachesCount: chatsBreachesCount,
          csatText,
        },
        calls: {
          handled: callsHandled,
          avgScore: callsAvgScore,
          below85Count: callsBelow85,
          breachesCount: callsBreachesCount,
          avgDurationText,
        },
        emails: {
          handled: emailsHandled,
          avgScore: emailsAvgScore,
          below85Count: emailsBelow85,
          breachesCount: emailsBreachesCount,
          resolutionText: emailsHandled > 0 ? `${emailsHandled} evaluated ${emailsHandled === 1 ? 'reply' : 'replies'}` : 'No evaluated emails this period',
        },
        whatWentWellChats,
        whatWentWellCalls,
        whatWentWellEmails,
        callsEvidence,
        chatsEvidence,
        emailsEvidence,
      },
    },
  };
}

// GET: Fetch reports depending on user role
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });

  const email = session.user.email;
  const { getUserByEmail } = await import('@/lib/users');
  const dbUser = await getUserByEmail(email).catch(() => null);
  const config = await readConfig();
  const user = config.users.find(u => (u.email || u.username).toLowerCase() === email.toLowerCase());
  const role = dbUser?.role || user?.role || (session.user as any)?.role || 'agent';
  let agentName = dbUser?.name || user?.agentName || '';
  if (email.toLowerCase() === 'pooja.hb@wintwealth.com') {
    agentName = 'Pooja';
  }

  try {
    const systemWeekRes = await query<any>(`SELECT MAX(week_start)::date::text AS latest_week FROM ir_reports WHERE status = 'published'`);
    const latestSystemWeek = systemWeekRes[0]?.latest_week || null;

    if (role === 'agent') {
      if (!agentName) {
        return NextResponse.json({ error: 'Agent profile name is not mapped in your user account.' }, { status: 400 });
      }

      const agentId = await resolveAgentId(dbUser, agentName);
      if (!agentId) {
        return NextResponse.json({ reports: [], latestSystemWeek });
      }

      // Fetch published scorecards for this agent
      const rawReports = await query<any>(
        `SELECT id, agent_id, week_start::date::text AS week_start, week_end::date::text AS week_end, status, generated, comments, viewed_at, generated_at
         FROM ir_reports
         WHERE agent_id = $1 AND status = 'published'
         ORDER BY week_start DESC`,
        [agentId]
      );
      const reports = await enrichReportsWithLiveScores(rawReports);
      if (reports.length > 0) {
        reports[0] = await enrichDhanushLatestScorecard(reports[0], agentId, agentName);
      }
      return NextResponse.json({ reports, latestSystemWeek });
    }

    if (role === 'tl') {
      const tlIdentifier = dbUser?.name || user?.agentName || email;
      const normalizedEmail = email.toLowerCase().trim();
      const emailPrefix = normalizedEmail.includes('@') ? normalizedEmail.split('@')[0] : normalizedEmail;
      const firstName = emailPrefix.split('.')[0];
      const dbUserName = dbUser?.name?.toLowerCase() || '';
      const configName = user?.agentName?.toLowerCase() || '';

      const tokens = Array.from(
        new Set([normalizedEmail, emailPrefix, firstName, dbUserName, configName, tlIdentifier.toLowerCase()].filter(Boolean))
      );

      // Fetch agent IDs mapped via tl_name in agents table
      const mappedAgentsFromDb = await query<any>(
        `SELECT id, name FROM agents
         WHERE (
           LOWER(TRIM(tl_name)) = ANY($1::text[])
           OR EXISTS (
             SELECT 1 FROM unnest($1::text[]) t
             WHERE LOWER(tl_name) LIKE LOWER(t || '%')
                OR LOWER(t) LIKE LOWER(TRIM(tl_name) || '%')
           )
         )`,
        [tokens]
      );

      // Also fetch agent names from getAgentNamesByTL helper
      const { getAgentNamesByTL } = await import('@/lib/robylon/db');
      const extraAgentNames = await getAgentNamesByTL(tlIdentifier).catch(() => []);

      const allMappedNames = Array.from(
        new Set([...mappedAgentsFromDb.map((a: any) => a.name), ...extraAgentNames])
      );

      if (allMappedNames.length === 0) {
        return NextResponse.json({ reports: [], latestSystemWeek });
      }

      const reports = await query<any>(
        `SELECT r.id, r.agent_id, a.name AS agent_name, r.week_start::date::text AS week_start, r.week_end::date::text AS week_end, r.status, r.generated, r.comments, r.viewed_at, r.generated_at
         FROM ir_reports r
         JOIN agents a ON a.id = r.agent_id
         WHERE r.status = 'published' AND a.name = ANY($1::text[])
         ORDER BY r.week_start DESC, a.name ASC`,
        [allMappedNames]
      );
      const enrichedReports = await enrichReportsWithLiveScores(reports);
      // Enrich the latest scorecard per team member with the unified 3-channel template
      const seenAgents = new Set<number>();
      await Promise.all(
        enrichedReports.map(async (rep, idx) => {
          if (rep.agent_id && !seenAgents.has(rep.agent_id)) {
            seenAgents.add(rep.agent_id);
            enrichedReports[idx] = await enrichDhanushLatestScorecard(rep, rep.agent_id, rep.agent_name || 'Agent');
          }
        })
      );
      return NextResponse.json({ reports: enrichedReports, latestSystemWeek });
    }

    if (role === 'admin' || role === 'quality') {
      // Admins and Quality see all published reports
      const reports = await query<any>(
        `SELECT r.id, r.agent_id, a.name AS agent_name, r.week_start::date::text AS week_start, r.week_end::date::text AS week_end, r.status, r.generated, r.comments, r.viewed_at, r.generated_at
         FROM ir_reports r
         JOIN agents a ON a.id = r.agent_id
         WHERE r.status = 'published'
         ORDER BY r.week_start DESC, a.name ASC`
      );
      const enrichedReports = await enrichReportsWithLiveScores(reports);
      // Enrich the latest scorecard per team member with the unified 3-channel template
      const seenAgents = new Set<number>();
      await Promise.all(
        enrichedReports.map(async (rep, idx) => {
          if (rep.agent_id && !seenAgents.has(rep.agent_id)) {
            seenAgents.add(rep.agent_id);
            enrichedReports[idx] = await enrichDhanushLatestScorecard(rep, rep.agent_id, rep.agent_name || 'Agent');
          }
        })
      );
      return NextResponse.json({ reports: enrichedReports, latestSystemWeek });
    }

    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  } catch (err: any) {
    console.error('[ir-reports-api] GET error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// POST: Add / update comments on a scorecard (Agents only)
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });

  const { reportId, comments } = await req.json();
  if (!reportId || !Array.isArray(comments)) {
    return NextResponse.json({ error: 'Missing reportId or invalid comments array' }, { status: 400 });
  }

  const email = session.user.email;
  const { getUserByEmail } = await import('@/lib/users');
  const dbUser = await getUserByEmail(email).catch(() => null);
  const config = await readConfig();
  const user = config.users.find(u => (u.email || u.username).toLowerCase() === email.toLowerCase());
  const role = dbUser?.role || user?.role || (session.user as any)?.role || 'agent';
  let agentName = dbUser?.name || user?.agentName || '';
  if (email.toLowerCase() === 'pooja.hb@wintwealth.com') {
    agentName = 'Pooja';
  }

  try {
    // Only agents can comment on their own reports (and admin/tl for safety/verification)
    if (role === 'agent') {
      if (!agentName) {
        return NextResponse.json({ error: 'Agent profile name is not mapped in your user account.' }, { status: 403 });
      }

      const agentId = await resolveAgentId(dbUser, agentName);
      if (!agentId) {
        return NextResponse.json({ error: 'Agent profile not found in DB.' }, { status: 403 });
      }

      const reportRows = await query<any>(`SELECT agent_id FROM ir_reports WHERE id = $1`, [reportId]);
      if (reportRows.length === 0) {
        return NextResponse.json({ error: 'Report not found' }, { status: 404 });
      }
      if (reportRows[0].agent_id !== agentId) {
        return NextResponse.json({ error: 'Forbidden: Cannot comment on another agent\'s scorecard.' }, { status: 403 });
      }
    } else if (role !== 'admin' && role !== 'tl') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Update the comments JSONB array
    await query(
      `UPDATE ir_reports SET comments = $1 WHERE id = $2`,
      [JSON.stringify(comments), reportId]
    );

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('[ir-reports-api] POST error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// PATCH: Mark a scorecard as viewed/read (Agents only when they open it)
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });

  const { reportId } = await req.json();
  if (!reportId) {
    return NextResponse.json({ error: 'Missing reportId' }, { status: 400 });
  }

  const email = session.user.email;
  const { getUserByEmail } = await import('@/lib/users');
  const dbUser = await getUserByEmail(email).catch(() => null);
  const config = await readConfig();
  const user = config.users.find(u => (u.email || u.username).toLowerCase() === email.toLowerCase());
  const role = dbUser?.role || user?.role || (session.user as any)?.role || 'agent';
  let agentName = dbUser?.name || user?.agentName || '';
  if (email.toLowerCase() === 'pooja.hb@wintwealth.com') {
    agentName = 'Pooja';
  }

  try {
    if (role === 'agent') {
      if (!agentName) {
        return NextResponse.json({ error: 'Agent profile name is not mapped.' }, { status: 403 });
      }

      const agentId = await resolveAgentId(dbUser, agentName);
      if (!agentId) {
        return NextResponse.json({ error: 'Agent profile not found.' }, { status: 403 });
      }

      const reportRows = await query<any>(`SELECT agent_id, viewed_at FROM ir_reports WHERE id = $1`, [reportId]);
      if (reportRows.length === 0) {
        return NextResponse.json({ error: 'Report not found' }, { status: 404 });
      }
      if (reportRows[0].agent_id !== agentId) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }

      if (!reportRows[0].viewed_at) {
        await query(`UPDATE ir_reports SET viewed_at = NOW() WHERE id = $1`, [reportId]);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('[ir-reports-api] PATCH error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
