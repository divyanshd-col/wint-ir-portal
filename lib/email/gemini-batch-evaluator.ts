/**
 * lib/email/gemini-batch-evaluator.ts
 *
 * Implements automated batch quality evaluation using Gemini Batch API (`@google/genai`).
 * Handles:
 * - 3:00 PM batch and overnight batch scheduling
 * - Context building (<= 3 vs > 3 emails & merged ticket history)
 * - Submitting Batch jobs via ai.batches.create
 * - Checking & collecting batch results via ai.batches.get
 * - Updating email_reply_evaluations
 * - Triggering compliance alerts for breaches
 */

import { GoogleGenAI } from '@google/genai';
import { query } from '@/lib/cx/db';
import { readConfig } from '@/lib/config';
import { buildEmailEvaluationPrompt, ThreadSummary } from './context-builder';
import { sendEmailComplianceSlackAlert } from './compliance-alert';

const DEFAULT_MODEL = 'gemini-2.5-flash';

async function getGeminiClient(): Promise<{ ai: GoogleGenAI; model: string }> {
  const config = await readConfig().catch(() => ({} as any));
  const apiKey =
    config.iqsGeminiApiKey ||
    config.geminiApiKey ||
    process.env.GEMINI_API_KEY ||
    '';

  if (!apiKey) {
    throw new Error('No Gemini API key configured in portal-config or environment');
  }

  const model = config.geminiModel || DEFAULT_MODEL;
  return { ai: new GoogleGenAI({ apiKey }), model };
}

/**
 * 1. Submits all pending replies to Gemini Batch API.
 * Called at 3:00 PM and Overnight (or manually via admin API).
 */
export async function submitPendingEmailBatchJob(options?: {
  cutoffTime?: string; // Optional ISO timestamp cutoff
  limit?: number;
}): Promise<{
  success: boolean;
  batchJobName?: string;
  count: number;
  message?: string;
}> {
  const { ai, model } = await getGeminiClient();

  // Fetch pending replies
  let sql = `
    SELECT e.id, e.ticket_id, e.message_id, e.agent_id, e.agent_name, e.sent_at,
           e.customer_message, e.agent_reply_text,
           c.subject_line, c.thread_summary, c.merged_into_ticket_id, c.status as ticket_status
    FROM email_reply_evaluations e
    JOIN email_conversations c ON e.ticket_id = c.id
    WHERE e.evaluation_status = 'Pending'
  `;
  const params: any[] = [];

  if (options?.cutoffTime) {
    params.push(options.cutoffTime);
    sql += ` AND e.sent_at <= $${params.length}`;
  }

  sql += ` ORDER BY e.sent_at ASC`;
  if (options?.limit) {
    params.push(options.limit);
    sql += ` LIMIT $${params.length}`;
  }

  const pendingRows = await query(sql, params);

  if (!pendingRows || pendingRows.length === 0) {
    return {
      success: true,
      count: 0,
      message: 'No pending email replies waiting for evaluation.',
    };
  }

  // Build inlined requests with respective ticket contexts
  const inlinedRequests: any[] = [];
  const processedMessageIds: string[] = [];

  for (const row of pendingRows) {
    // 1. Fetch prior replies count & text for this ticket to satisfy <= 3 vs > 3 rule
    const priorReplies = await query(
      `SELECT agent_name, agent_reply_text, sent_at
       FROM email_reply_evaluations
       WHERE ticket_id = $1 AND sent_at < $2
       ORDER BY sent_at ASC`,
      [row.ticket_id, row.sent_at]
    );

    const historyCount = priorReplies ? priorReplies.length : 0;
    let rawHistory = '';
    if (historyCount <= 3 && priorReplies?.length) {
      rawHistory = priorReplies
        .map(
          (p: any, idx: number) =>
            `[Message #${idx + 1} by ${p.agent_name || 'Agent'} at ${p.sent_at}]:\n${p.agent_reply_text || ''}`
        )
        .join('\n\n');
    }

    // 2. Fetch merged ticket context if any
    let mergedContext: string | null = null;
    if (row.ticket_status === 'MERGED' || row.merged_into_ticket_id) {
      mergedContext = `Ticket merged into ${row.merged_into_ticket_id || 'primary ticket'}`;
    }

    const promptText = buildEmailEvaluationPrompt({
      ticketId: row.ticket_id,
      messageId: row.message_id,
      agentName: row.agent_name || 'Agent',
      sentAt: new Date(row.sent_at).toISOString(),
      customerMessage: row.customer_message || row.subject_line || 'Customer inquiry',
      agentReplyText: row.agent_reply_text || '',
      historyCount,
      rawHistory,
      threadSummary: row.thread_summary as ThreadSummary | null,
      mergedTicketSummary: mergedContext,
    });

    inlinedRequests.push({
      contents: [{ role: 'user', parts: [{ text: promptText }] }],
      metadata: {
        message_id: String(row.message_id),
        ticket_id: String(row.ticket_id),
        agent_name: String(row.agent_name || 'Unknown'),
        sent_at: new Date(row.sent_at).toISOString(),
      },
      config: {
        responseMimeType: 'application/json',
      },
    });

    processedMessageIds.push(row.message_id);
  }

  // Submit Batch Job to Gemini
  console.log(`[gemini-batch] Submitting ${inlinedRequests.length} email replies to model ${model}…`);
  const batchJob = await ai.batches.create({
    model,
    src: inlinedRequests,
  });

  const batchJobName = batchJob.name || `batches/${Date.now()}`;
  console.log(`[gemini-batch] Created Batch Job: ${batchJobName} (State: ${batchJob.state})`);

  // Update rows in database to In_Batch
  await query(
    `UPDATE email_reply_evaluations
     SET evaluation_status = 'In_Batch',
         batch_job_id = $1,
         updated_at = NOW()
     WHERE message_id = ANY($2::text[])`,
    [batchJobName, processedMessageIds]
  );

  return {
    success: true,
    batchJobName,
    count: inlinedRequests.length,
    message: `Batch job submitted successfully with ${inlinedRequests.length} evaluations.`,
  };
}

/**
 * 2. Checks all active batch jobs and collects finished results.
 */
export async function collectAndProcessEmailBatchResults(targetJobName?: string): Promise<{
  activeJobsCount: number;
  completedJobsCount: number;
  evaluatedRepliesCount: number;
  details: any[];
}> {
  const { ai } = await getGeminiClient();

  // Find all distinct batch jobs currently In_Batch
  let jobsToPoll: string[] = [];
  if (targetJobName) {
    jobsToPoll = [targetJobName];
  } else {
    const rows = await query(
      `SELECT DISTINCT batch_job_id 
       FROM email_reply_evaluations 
       WHERE evaluation_status = 'In_Batch' AND batch_job_id IS NOT NULL`
    );
    jobsToPoll = (rows || []).map((r: any) => r.batch_job_id);
  }

  if (jobsToPoll.length === 0) {
    return {
      activeJobsCount: 0,
      completedJobsCount: 0,
      evaluatedRepliesCount: 0,
      details: [],
    };
  }

  let completedJobsCount = 0;
  let evaluatedRepliesCount = 0;
  const details: any[] = [];

  for (const jobName of jobsToPoll) {
    try {
      const job = await ai.batches.get({ name: jobName });
      const stateStr = String(job.state);
      console.log(`[gemini-batch] Polled job ${jobName}: State = ${stateStr}`);

      if (stateStr === 'JOB_STATE_SUCCEEDED' || stateStr === 'SUCCEEDED') {
        completedJobsCount++;
        const inlinedResponses: any[] =
          (job as any).dest?.inlinedResponses ||
          (job as any).inlinedResponses ||
          [];

        for (const item of inlinedResponses) {
          const messageId = item.metadata?.message_id;
          if (!messageId) continue;

          if (item.error) {
            console.error(`[gemini-batch] Item error for message ${messageId}:`, item.error);
            await query(
              `UPDATE email_reply_evaluations
               SET evaluation_status = 'Failed',
                   qa_notes = $1,
                   updated_at = NOW()
               WHERE message_id = $2`,
              [JSON.stringify(item.error), messageId]
            );
            continue;
          }

          const rawText =
            item.response?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';

          let parsedResult: any = {};
          try {
            parsedResult = JSON.parse(rawText);
          } catch (pe) {
            // strip markdown code fencing if any
            const cleaned = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
            parsedResult = JSON.parse(cleaned);
          }

          const qualityScore = Number(parsedResult.quality_score ?? 0);
          const compliancePassed = Boolean(parsedResult.compliance_passed ?? true);
          const complianceIssues = Array.isArray(parsedResult.compliance_issues)
            ? parsedResult.compliance_issues
            : [];
          const parameterScores = parsedResult.parameter_scores || {};
          const summaryNote = parsedResult.summary || '';

          await query(
            `UPDATE email_reply_evaluations
             SET quality_score = $1,
                 compliance_passed = $2,
                 compliance_issues = $3,
                 parameter_scores = $4,
                 qa_notes = COALESCE(qa_notes, $5),
                 evaluation_status = 'Completed',
                 evaluated_at = NOW(),
                 updated_at = NOW()
             WHERE message_id = $6`,
            [
              qualityScore,
              compliancePassed,
              complianceIssues,
              JSON.stringify(parameterScores),
              summaryNote || null,
              messageId,
            ]
          );

          evaluatedRepliesCount++;

          // Step 4 of Implementation Plan: Compliance Slack Alert on failure
          if (!compliancePassed || complianceIssues.length > 0) {
            const replySnippet = item.metadata?.agent_reply_text || '';
            await sendEmailComplianceSlackAlert({
              ticketId: item.metadata?.ticket_id || 'Unknown',
              messageId,
              agentName: item.metadata?.agent_name || 'Agent',
              qualityScore,
              complianceIssues,
              replySnippet,
              evaluatedAt: new Date().toISOString(),
            });
          }
        }

        details.push({ jobName, state: stateStr, processedReplies: inlinedResponses.length });
      } else if (
        stateStr === 'JOB_STATE_FAILED' ||
        stateStr === 'FAILED' ||
        stateStr === 'JOB_STATE_CANCELLED' ||
        stateStr === 'CANCELLED'
      ) {
        await query(
          `UPDATE email_reply_evaluations
           SET evaluation_status = 'Failed',
               qa_notes = $1,
               updated_at = NOW()
           WHERE batch_job_id = $2 AND evaluation_status = 'In_Batch'`,
          [`Batch Job terminated with state: ${stateStr}`, jobName]
        );
        details.push({ jobName, state: stateStr, error: 'Job failed on Gemini' });
      } else {
        // Still pending or running
        details.push({ jobName, state: stateStr, message: 'Still in progress' });
      }
    } catch (err: any) {
      console.error(`[gemini-batch] Error polling job ${jobName}:`, err?.message || err);
      details.push({ jobName, error: err?.message || String(err) });
    }
  }

  return {
    activeJobsCount: jobsToPoll.length,
    completedJobsCount,
    evaluatedRepliesCount,
    details,
  };
}

/**
 * 3. Synchronous on-demand evaluation fallback for a single reply
 * Useful when QA triggers immediate re-evaluation from portal UI.
 */
export async function evaluateSingleReplySync(messageId: string): Promise<any> {
  const { ai, model } = await getGeminiClient();

  const rows = await query(
    `SELECT e.*, c.subject_line, c.thread_summary, c.merged_into_ticket_id
     FROM email_reply_evaluations e
     JOIN email_conversations c ON e.ticket_id = c.id
     WHERE e.message_id = $1`,
    [messageId]
  );

  if (!rows || rows.length === 0) {
    throw new Error(`Reply message ${messageId} not found`);
  }

  const row = rows[0];
  const priorReplies = await query(
    `SELECT agent_name, agent_reply_text, sent_at
     FROM email_reply_evaluations
     WHERE ticket_id = $1 AND sent_at < $2
     ORDER BY sent_at ASC`,
    [row.ticket_id, row.sent_at]
  );

  const historyCount = priorReplies ? priorReplies.length : 0;
  let rawHistory = '';
  if (historyCount <= 3 && priorReplies?.length) {
    rawHistory = priorReplies
      .map(
        (p: any, idx: number) =>
          `[Message #${idx + 1} by ${p.agent_name || 'Agent'} at ${p.sent_at}]:\n${p.agent_reply_text || ''}`
      )
      .join('\n\n');
  }

  const promptText = buildEmailEvaluationPrompt({
    ticketId: row.ticket_id,
    messageId: row.message_id,
    agentName: row.agent_name || 'Agent',
    sentAt: new Date(row.sent_at).toISOString(),
    customerMessage: row.customer_message || row.subject_line || 'Customer inquiry',
    agentReplyText: row.agent_reply_text || '',
    historyCount,
    rawHistory,
    threadSummary: row.thread_summary as ThreadSummary | null,
    mergedTicketSummary: row.merged_into_ticket_id ? `Merged into ${row.merged_into_ticket_id}` : null,
  });

  const response = await ai.models.generateContent({
    model,
    contents: [{ role: 'user', parts: [{ text: promptText }] }],
    config: {
      responseMimeType: 'application/json',
    },
  });

  const text = response.text || '{}';
  let parsed: any = {};
  try {
    parsed = JSON.parse(text);
  } catch {
    const cleaned = text.replace(/```json/g, '').replace(/```/g, '').trim();
    parsed = JSON.parse(cleaned);
  }

  const qualityScore = Number(parsed.quality_score ?? 0);
  const compliancePassed = Boolean(parsed.compliance_passed ?? true);
  const complianceIssues = Array.isArray(parsed.compliance_issues)
    ? parsed.compliance_issues
    : [];
  const parameterScores = parsed.parameter_scores || {};
  const summaryNote = parsed.summary || '';

  await query(
    `UPDATE email_reply_evaluations
     SET quality_score = $1,
         compliance_passed = $2,
         compliance_issues = $3,
         parameter_scores = $4,
         qa_notes = COALESCE(qa_notes, $5),
         evaluation_status = 'Completed',
         evaluated_at = NOW(),
         updated_at = NOW()
     WHERE message_id = $6`,
    [
      qualityScore,
      compliancePassed,
      complianceIssues,
      JSON.stringify(parameterScores),
      summaryNote || null,
      messageId,
    ]
  );

  if (!compliancePassed || complianceIssues.length > 0) {
    await sendEmailComplianceSlackAlert({
      ticketId: row.ticket_id,
      messageId,
      agentName: row.agent_name || 'Agent',
      qualityScore,
      complianceIssues,
      replySnippet: row.agent_reply_text || '',
      evaluatedAt: new Date().toISOString(),
    });
  }

  return parsed;
}
