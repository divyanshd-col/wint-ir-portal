/**
 * lib/scoring/pcg-email-pipeline.ts
 *
 * PCG Email Quality Evaluation Pipeline.
 * Uses the EXACT SAME PCG Knowledge Base engine (`lib/pcg/kb.ts`) as PCG Calls (`pcg-pipeline.ts`)
 * and PCG Chats (`pcg-chat-pipeline.ts`):
 *   - Shared Wint Wealth Drive KBs (bonds, KYC, taxation, liquidity, etc.)
 *   - Excludes CX AIF and CX MLD documents
 *   - Injects PCG-exclusive AIF (`lib/pcg/kb/pcg-aif-kb.txt`) and MLD (`lib/pcg/kb/pcg-mld-kb.txt`) KBs
 *
 * Evaluates strictly the specific outbound reply authored by the agent (RM or AM),
 * passing preceding email replies only as background context.
 */

import { GoogleGenAI } from '@google/genai';
import { readConfig } from '@/lib/config';
import { query } from '@/lib/cx/db';
import { getPcgEmailKbContextForScoring } from '@/lib/pcg/kb';
import { isExcludedFromPcgEmailEvaluation } from '@/lib/pcg/email-db';
import {
  buildEmailEvaluationPrompt,
  calculateEmailIQS,
  emailWeightMap,
  resolveEmailParameters,
  type ThreadSummary,
} from '@/lib/email/context-builder';

const DEFAULT_MODEL = 'gemini-2.5-flash';

export interface PcgEmailScoringInput {
  ticketId: string;
  messageId: string;
  agentName: string;
  sentAt: string;
  subjectLine?: string | null;
  customerMessage: string;
  agentReplyText: string;
  historyCount: number;
  rawHistory?: string;
  threadSummary?: ThreadSummary | null;
  mergedTicketSummary?: string | null;
}

export interface PcgEmailScoringResult {
  iqsScore: number | null;
  compliancePassed: boolean;
  complianceReason: string;
  complianceFlags: Array<{
    gate: string;
    label: string;
    status: 'PASS' | 'FAIL' | 'NA';
    reason: string;
  }>;
  parameters: Record<string, any>;
  kbContextUsed: boolean;
  rawParsed: any;
}

/**
 * Builds the PCG email evaluation prompt hydrated with the shared PCG Knowledge Base
 * (same KB corpus used for PCG Calls and PCG Chats).
 */
export async function buildPcgEmailScoringPrompt(input: PcgEmailScoringInput): Promise<{
  prompt: string;
  weights: Record<string, number>;
  kbContext: string;
  parameters: ReturnType<typeof resolveEmailParameters>;
}> {
  const config = await readConfig().catch(() => null);
  const parameters = resolveEmailParameters(config?.emailRubric);
  const weights = emailWeightMap(parameters);

  // Retrieve PCG Knowledge Base (identical corpus to PCG Calls & PCG Chats)
  const kbContext = await getPcgEmailKbContextForScoring(
    input.subjectLine,
    input.customerMessage,
    input.agentReplyText,
    6
  );

  const prompt = buildEmailEvaluationPrompt({
    parameters,
    promptText: {
      intro: config?.emailPromptIntro,
      compliance: config?.emailPromptCompliance,
    },
    knowledgeBase: kbContext,
    ticketId: input.ticketId,
    messageId: input.messageId,
    agentName: input.agentName,
    sentAt: input.sentAt,
    customerMessage: input.customerMessage || input.subjectLine || 'Customer inquiry',
    agentReplyText: input.agentReplyText,
    historyCount: input.historyCount,
    rawHistory: input.rawHistory,
    threadSummary: input.threadSummary,
    mergedTicketSummary: input.mergedTicketSummary,
  });

  return { prompt, weights, kbContext, parameters };
}

/**
 * Evaluates a single PCG outbound email reply with Gemini using the shared PCG KBs.
 * Does NOT touch any database tables.
 */
export async function evaluatePcgEmailReply(
  input: PcgEmailScoringInput
): Promise<PcgEmailScoringResult> {
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
  const ai = new GoogleGenAI({ apiKey });

  const { prompt, weights, kbContext, parameters } = await buildPcgEmailScoringPrompt(input);

  const response = await ai.models.generateContent({
    model,
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    config: {
      responseMimeType: 'application/json',
      temperature: 0.1,
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

  const rawParamScores = parsed.parameter_scores || parsed.parameters || {};
  const parameterReasoning = parsed.parameter_reasoning || parsed.parameterReasoning || {};

  const structuredParameters: Record<string, any> = {};
  for (const p of parameters) {
    const rawVal = String(rawParamScores[p.key] || rawParamScores[p.name] || 'no').trim().toLowerCase();
    const scoreVal: 'yes' | 'half' | 'no' | 'na' =
      rawVal === 'yes' || rawVal === 'pass'
        ? 'yes'
        : rawVal === 'half' || rawVal === 'partial'
        ? 'half'
        : rawVal === 'na' || rawVal === 'not_applicable'
        ? 'na'
        : 'no';

    const maxScore = p.defaultWeight;
    const earnedScore = scoreVal === 'yes' ? maxScore : scoreVal === 'half' ? Math.round(maxScore * 0.5 * 10) / 10 : 0;
    const reasoning = parameterReasoning[p.key] || parameterReasoning[p.name] || '';

    structuredParameters[p.key] = {
      name: p.name,
      weight: p.defaultWeight,
      score: scoreVal,
      earnedScore,
      maxScore,
      reasoning,
    };
  }

  const calculatedScore = calculateEmailIQS(rawParamScores, weights);
  const iqsScore = calculatedScore !== null && !isNaN(calculatedScore)
    ? calculatedScore
    : Number(parsed.quality_score ?? 0);

  const normalizeGateStatus = (val: any): 'PASS' | 'FAIL' | 'NA' => {
    const s = String(val || '').trim().toLowerCase();
    if (s === 'fail' || s === 'breach') return 'FAIL';
    if (s === 'na' || s === 'not_applicable' || s === 'n/a') return 'NA';
    return 'PASS';
  };

  const gatesRaw = parsed.compliance_gates || parsed.complianceGates || {};
  const complianceFlags: PcgEmailScoringResult['complianceFlags'] = [
    {
      gate: 'G1_no_advice',
      label: 'G1: Advice (No Investment / Tax Advice)',
      status: normalizeGateStatus(gatesRaw.G1_no_advice?.status ?? gatesRaw.G1?.status),
      reason: String(gatesRaw.G1_no_advice?.reasoning ?? gatesRaw.G1?.reasoning ?? ''),
    },
    {
      gate: 'G2_no_fabrication',
      label: 'G2: Fabrication (No Fabricated Facts)',
      status: normalizeGateStatus(gatesRaw.G2_no_fabrication?.status ?? gatesRaw.G2?.status),
      reason: String(gatesRaw.G2_no_fabrication?.reasoning ?? gatesRaw.G2?.reasoning ?? ''),
    },
    {
      gate: 'G3_identity_first',
      label: 'G3: Identity (Identity Verified First)',
      status: normalizeGateStatus(gatesRaw.G3_identity_first?.status ?? gatesRaw.G3?.status),
      reason: String(gatesRaw.G3_identity_first?.reasoning ?? gatesRaw.G3?.reasoning ?? ''),
    },
  ];

  // NA gates do not trigger a compliance breach
  const compliancePassed = !complianceFlags.some((g) => g.status === 'FAIL');
  const complianceReason = compliancePassed
    ? 'All applicable compliance gates passed.'
    : complianceFlags
        .filter((g) => g.status === 'FAIL')
        .map((g) => `${g.label}: ${g.reason || 'Breach flagged'}`)
        .join(' | ');

  return {
    iqsScore,
    compliancePassed,
    complianceReason,
    complianceFlags,
    parameters: structuredParameters,
    kbContextUsed: Boolean(kbContext),
    rawParsed: parsed,
  };
}

/**
 * End-to-end evaluation runner for a single PCG email reply:
 * 1. Reads the pending reply & preceding context from pcg_email_evaluations / pcg_email_conversations.
 * 2. Evaluates the reply with Gemini against the 7 PCG parameters, 3 compliance tripwires, and shared PCG KBs.
 * 3. Persists the evaluated IQS score, compliance status, and parameter scorecard to the database with `evaluation_status = 'Completed'`.
 */
export async function evaluatePcgEmailReplySync(messageId: string): Promise<any> {
  const rows = await query<any>(
    `SELECT e.*, COALESCE(NULLIF(e.chat_id, ''), c.chat_id) as chat_id, c.transcript as conv_transcript
     FROM pcg_email_evaluations e
     LEFT JOIN pcg_email_conversations c ON e.ticket_id = c.ticket_id
     WHERE e.message_id = $1
     LIMIT 1`,
    [messageId]
  );

  if (!rows || rows.length === 0) {
    throw new Error(`PCG email evaluation record not found for message_id: ${messageId}`);
  }
  const row = rows[0];

  // Head of PCG (Indrajit Das) is strictly excluded from quality scoring
  if (isExcludedFromPcgEmailEvaluation(row.rm_name)) {
    await query(
      `UPDATE pcg_email_evaluations SET
        evaluation_status = 'Completed',
        compliance_passed = true,
        compliance_reason = 'Excluded from QA evaluation (Head of PCG)',
        updated_at = NOW()
       WHERE message_id = $1`,
      [messageId]
    );
    return { excluded: true, rmName: row.rm_name };
  }

  // Preceding thread context extraction
  const transcript: any[] =
    Array.isArray(row.thread_replies) && row.thread_replies.length > 0
      ? row.thread_replies
      : Array.isArray(row.conv_transcript)
      ? row.conv_transcript
      : [];

  const replyIdx = transcript.findIndex((t: any) => t.id === messageId);
  const preceding =
    replyIdx >= 0
      ? transcript.slice(0, replyIdx)
      : transcript.filter((t: any) => t.id !== messageId);

  const rawHistory = preceding
    .map((t: any, idx: number) => {
      const role = t.authorRole
        ? String(t.authorRole).toUpperCase()
        : t.direction === 'inbound'
        ? 'CUSTOMER'
        : 'AGENT';
      const sender = t.authorName || 'Participant';
      return `[Turn ${idx + 1} - ${role} (${sender})]\n${t.content || t.snippet || ''}`;
    })
    .join('\n\n---\n\n');

  try {
    const scoringResult = await evaluatePcgEmailReply({
      ticketId: row.ticket_id,
      messageId: row.message_id,
      agentName: row.rm_name,
      sentAt: row.sent_at ? new Date(row.sent_at).toISOString() : new Date().toISOString(),
      subjectLine: row.subject_line,
      customerMessage: row.customer_message || row.subject_line || 'Customer inquiry',
      agentReplyText: row.agent_reply_text,
      historyCount: preceding.length,
      rawHistory,
      mergedTicketSummary: row.ticket_summary,
    });

    const iqsScore = scoringResult.iqsScore ?? 0;
    const verdict =
      iqsScore >= 90
        ? 'excellent'
        : iqsScore >= 80
        ? 'meets_expectations'
        : iqsScore >= 70
        ? 'coaching'
        : 'remediation';

    const strengths: string[] =
      Array.isArray(scoringResult.rawParsed?.strengths) && scoringResult.rawParsed.strengths.length > 0
        ? scoringResult.rawParsed.strengths
        : [
            scoringResult.compliancePassed ? 'Compliance gates verified' : 'Prompt communication',
            iqsScore >= 80 ? 'Clear and structured explanation' : 'Addressed customer inquiry',
          ];

    const areasForImprovement: string[] = Array.isArray(
      scoringResult.rawParsed?.areas_for_improvement
    )
      ? scoringResult.rawParsed.areas_for_improvement
      : Array.isArray(scoringResult.rawParsed?.areasForImprovement)
      ? scoringResult.rawParsed.areasForImprovement
      : [];

    await query(
      `UPDATE pcg_email_evaluations SET
        evaluation_status = 'Completed',
        iqs_score = $1,
        verdict = $2,
        compliance_passed = $3,
        compliance_reason = $4,
        compliance_flags = $5::jsonb,
        parameters = $6::jsonb,
        strengths = $7::jsonb,
        areas_for_improvement = $8::jsonb,
        evaluated_at = NOW(),
        updated_at = NOW()
       WHERE message_id = $9`,
      [
        iqsScore,
        verdict,
        scoringResult.compliancePassed,
        scoringResult.complianceReason,
        JSON.stringify(scoringResult.complianceFlags),
        JSON.stringify(scoringResult.parameters),
        JSON.stringify(strengths),
        JSON.stringify(areasForImprovement),
        messageId,
      ]
    );

    return {
      messageId,
      iqsScore,
      verdict,
      compliancePassed: scoringResult.compliancePassed,
      parameters: scoringResult.parameters,
    };
  } catch (err: any) {
    console.error(`[pcg-email-eval] Failed evaluating ${messageId}:`, err);
    await query(
      `UPDATE pcg_email_evaluations SET
        evaluation_status = 'Failed',
        compliance_reason = $1,
        updated_at = NOW()
       WHERE message_id = $2`,
      [err?.message || 'Evaluation error', messageId]
    ).catch(() => {});
    throw err;
  }
}
