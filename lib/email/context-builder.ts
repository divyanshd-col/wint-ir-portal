/**
 * lib/email/context-builder.ts
 *
 * Implements context preparation logic per implementation plan:
 * - Threads with <= 3 previous emails: full previous conversation history.
 * - Threads with > 3 previous emails: structured 4-point JSON summary
 *   (core_query, actions_taken, pending_action, commitments_set).
 * - Merged tickets: context summary from merged ticket attached.
 */

export interface ThreadSummary {
  core_query: string;
  actions_taken: string;
  pending_action: string;
  commitments_set: string;
}

export interface ReplyEvaluationContextInput {
  ticketId: string;
  messageId: string;
  agentName: string;
  sentAt: string;
  customerMessage: string;
  agentReplyText: string;
  historyCount: number;
  rawHistory?: string;
  threadSummary?: ThreadSummary | null;
  mergedTicketSummary?: ThreadSummary | string | null;
}

export type ParameterScoreValue = 'yes' | 'partial' | 'no';

export interface EvaluationParameterConfig {
  key: string;
  name: string;
  description: string;
  defaultWeight: number;
}

/**
 * 6 Evaluation parameters for email quality scoring.
 * Values can be evaluated by Gemini and overridden/edited by QA reviewers.
 */
export const DEFAULT_EMAIL_PARAMETERS: EvaluationParameterConfig[] = [
  {
    key: 'accuracy',
    name: 'Accuracy & Financial Correctness',
    description: 'Factual accuracy regarding bonds, yields, TDS, maturity dates, and account details according to KB/SOP.',
    defaultWeight: 20,
  },
  {
    key: 'completeness',
    name: 'Completeness',
    description: 'Addressing all questions, sub-queries, and implicit requests in the customer email.',
    defaultWeight: 20,
  },
  {
    key: 'clarity',
    name: 'Clarity & Structure',
    description: 'Concise, well-organized response without confusing jargon or ambiguous phrasing.',
    defaultWeight: 15,
  },
  {
    key: 'tone',
    name: 'Tone & Empathy',
    description: 'Courteous, polite, empathetic, and professional language adhering to Wint Wealth standards.',
    defaultWeight: 15,
  },
  {
    key: 'process_adherence',
    name: 'Process & SOP Adherence',
    description: 'Following company workflows, identity verification checks, and escalation paths.',
    defaultWeight: 15,
  },
  {
    key: 'expectation_setting',
    name: 'Expectation Setting & SLA',
    description: 'Communicating explicit, realistic resolution timelines and commitments without over-promising.',
    defaultWeight: 15,
  },
];

/**
 * Strips HTML tags and excessive whitespace to save tokens in Gemini Batch API.
 */
function cleanEmailText(text: string): string {
  if (!text) return '';
  return text
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*[\/]?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s+\n/g, '\n\n')
    .trim();
}

/**
 * Builds prompt for evaluating an agent reply.
 */
export function buildEmailEvaluationPrompt(input: ReplyEvaluationContextInput): string {
  let contextBlock = '';

  // Case 1: Merged ticket context if available (Page 3)
  let mergedNote = '';
  if (input.mergedTicketSummary) {
    const summaryStr = typeof input.mergedTicketSummary === 'string'
      ? input.mergedTicketSummary
      : JSON.stringify(input.mergedTicketSummary, null, 2);
    mergedNote = `\n[NOTE: This ticket contains merged context from a prior merged ticket]:\n${summaryStr}\n`;
  }

  // Case 2: <= 3 previous emails vs > 3 previous emails (Page 2)
  if (input.historyCount <= 3) {
    contextBlock = `PREVIOUS CONVERSATION HISTORY (Full Transcript):\n${cleanEmailText(input.rawHistory || 'Initial inquiry on ticket.')}`;
  } else {
    const s = input.threadSummary;
    contextBlock = `PREVIOUS CONVERSATION SUMMARY (Longer Thread Context):
- Core Customer Query: ${s?.core_query || 'Customer query details on file'}
- Actions Taken So Far: ${s?.actions_taken || 'Prior updates provided to customer'}
- Current Pending Task & Owner: ${s?.pending_action || 'None specified'}
- Commitments / Expectations Set: ${s?.commitments_set || 'Standard SLA'}`;
  }

  const cleanCustomerMsg = cleanEmailText(input.customerMessage || 'See context above.');
  const cleanAgentReply = cleanEmailText(input.agentReplyText || '');

  return `You are a Senior Quality Assurance & Compliance Evaluator at Wint Wealth, evaluating an outbound email reply sent by an agent.

${mergedNote}
${contextBlock}

---
CUSTOMER'S LATEST EMAIL:
${cleanCustomerMsg}

---
AGENT'S OUTBOUND REPLY TO EVALUATE:
Agent Name: ${input.agentName}
Sent At: ${input.sentAt}
Reply Content:
${cleanAgentReply}

---
EVALUATION GUIDELINES (6 Quality Parameters - 3-Way Evaluation):
For each parameter, assign one of: "yes" (fully met standard), "partial" (partially met / minor gaps), or "no" (failed standard):
1. Accuracy & Financial Correctness ("yes" | "partial" | "no"): Did the agent provide accurate financial, investment, bond, withdrawal, or account information?
2. Completeness ("yes" | "partial" | "no"): Did the agent answer all questions, sub-queries, and explicit/implicit requests raised by the customer?
3. Clarity & Structure ("yes" | "partial" | "no"): Is the email well-structured, easy to read, concise, and free of confusing jargon?
4. Tone & Empathy ("yes" | "partial" | "no"): Professional, courteous, customer-centric tone adhering to Wint Wealth standards.
5. Process & SOP Adherence ("yes" | "partial" | "no"): Did the agent follow regulatory and internal SOP guidelines? (No false promises, correct verification, appropriate escalation).
6. Expectation Setting & SLA ("yes" | "partial" | "no"): Were clear, realistic turnaround times, SLAs, and next steps explicitly communicated?

Overall Quality Score (0-100%): Weighted overall composite percentage (yes = 100%, partial = 50%, no = 0%).

COMPLIANCE CHECKS:
Mark compliance_passed as false if any critical breach occurred:
- Guaranteed returns or misleading financial promises
- Sharing confidential account/PAN details without verification
- Misinforming the investor about withdrawal or maturity timelines
- Using rude or unprofessional language

OUTPUT FORMAT:
Return ONLY a valid JSON object matching this schema (no markdown formatting, no commentary outside the JSON):
{
  "quality_score": 85,
  "compliance_passed": true,
  "compliance_issues": [],
  "parameter_scores": {
    "accuracy": "yes",
    "completeness": "yes",
    "clarity": "partial",
    "tone": "yes",
    "process_adherence": "yes",
    "expectation_setting": "partial"
  },
  "summary": "Short 1-2 sentence review of the reply.",
  "strengths": ["Clear explanation of redemption timeline"],
  "areas_for_improvement": ["Could have included link to portal dashboard"]
}`;
}
