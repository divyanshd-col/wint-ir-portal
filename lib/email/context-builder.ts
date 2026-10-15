/**
 * lib/email/context-builder.ts
 *
 * Implements context preparation logic and scoring rubrics for Email Quality Evaluation:
 * - 7 Quality Parameters per Wint Wealth Email Evaluation Specifications:
 *   1. Issue resolution (25%, allow NA)
 *   2. Accuracy (25%)
 *   3. Expectation setting (15%)
 *   4. Personalisation (10%)
 *   5. Empathy (10%, allow NA)
 *   6. Sentences (Simple to understand) (10%)
 *   7. Opening and closing message (5%)
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

export type ParameterScoreValue = 'yes' | 'half' | 'partial' | 'no' | 'na';

export interface EvaluationParameterConfig {
  key: string;
  name: string;
  description: string;
  defaultWeight: number;
  allowNA?: boolean;
  aliases?: string[];
  scoringGuide: {
    yes: string;
    half: string;
    no: string;
    na?: string;
    exception?: string;
  };
}

/**
 * 7 Evaluation parameters for email quality scoring as per Wint Wealth QA standards.
 */
export const DEFAULT_EMAIL_PARAMETERS: EvaluationParameterConfig[] = [
  {
    key: 'issue_resolution',
    name: 'Issue resolution',
    description: 'Does the email address every question and request raised by the customer and either resolve the issue or properly move it forward?',
    defaultWeight: 25,
    allowNA: true,
    aliases: ['issue_resolution', 'IssueResolution', 'resolution'],
    scoringGuide: {
      yes: 'Every question and request is addressed, and the issue is resolved or properly progressed (raising a ticket, escalating, forwarding a document, arranging a call, or clear next step).',
      half: 'The main issue is addressed, but a smaller question or request is missed or only partly answered, or the next step is unclear.',
      no: "A key question or request is missed, the reply does not address the customer's actual concern, or the issue is left unresolved without a clear next step.",
      na: 'There is no customer issue to resolve (general announcement, routine update, survey, policy notification, standard auto-closure notice because customer did not reply, email not to a client).',
    },
  },
  {
    key: 'accuracy',
    name: 'Accuracy',
    description: 'Whether everything the agent told the client is correct, compliant and safe, required disclaimers present, client details protected, and any attachment is correct.',
    defaultWeight: 25,
    allowNA: false,
    aliases: ['accuracy', 'Accuracy', 'technical_accuracy'],
    scoringGuide: {
      yes: "All applicable checks pass. Information is accurate, right product named, no guarantees/predictions/personal advice, required disclaimer present, only client's own details shared, and any attachment is present, named and correct.",
      half: 'A minor lapse that does not mislead the client or cause harm (wording slip that does not change meaning, footer missing on Tier B reply where safe, attachment mentioned loosely or attached but not mentioned, detail of another account whose origin cannot be shown).',
      no: "Wrong fact, date, amount, step, TAT, offer term or explanation that could mislead; wrong product named; guaranteed return/prediction/advice; another client's details shared; missing required disclaimer on Tier A; core attachment missing/wrong; false statement about thread; essential info (amount, date/time, reference, document/reward) not restated.",
    },
  },
  {
    key: 'expectation_setting',
    name: 'Expectation setting',
    description: 'The agent answers the core query completely, states correct process and realistic TAT, provides personalized follow-up, and shares helpful educational points.',
    defaultWeight: 15,
    allowNA: false,
    aliases: ['expectation_setting', 'ExpectationSetting', 'expectation'],
    scoringGuide: {
      yes: 'Complete answer, correct process, clear TAT wherever applicable, and personalised follow-up.',
      half: 'Answer is correct, but the process, TAT (where applicable), or follow-up is missing or generic.',
      no: 'Core query unanswered, wrong process, or no expectation set.',
      exception: 'In repayment cases where a specific TAT cannot be defined, do not deduct marks solely for the absence of a specific timeline, provided the agent communicates available information and explains next steps.',
    },
  },
  {
    key: 'personalisation',
    name: 'Personalisation',
    description: 'Is the email written for this client, not a template? Uses actual situation, references specific details, builds on earlier replies, and avoids asking for info already provided.',
    defaultWeight: 10,
    allowNA: false,
    aliases: ['personalisation', 'personalization', 'Personalisation', 'Personalization'],
    scoringGuide: {
      yes: "The email reflects the client's actual case. It references their specific details (bond, amounts, dates, account status), builds on earlier replies, and asks for nothing already shared. On transferred chats, uses what bot already collected.",
      half: 'The email is partly tailored but still has template elements (mentions situation in general terms, leaves out available details, or includes one minor repeated ask for info already given).',
      no: 'The email reads like a template or copy-paste reply; does not reflect client situation; asks for info already given; ignores earlier replies / bot collected information.',
    },
  },
  {
    key: 'empathy',
    name: 'Empathy',
    description: 'Understands customer feelings and stakes (urgency, frustration, money involved), takes ownership with warm, polite language, and calms irritated customers.',
    defaultWeight: 10,
    allowNA: true,
    aliases: ['empathy', 'Empathy'],
    scoringGuide: {
      yes: "Ownership and warmth are genuine and specific to this customer's situation. At least one sentence acknowledges their actual concern, urgency or feeling in words that could not be pasted into another email.",
      half: 'The reply is polite and acknowledges customer, but acknowledgement is generic/templated, or warmth comes only from stock courtesy lines.',
      no: 'The reply is cold, mechanical or dismissive where care is clearly needed, or ignores something the customer said.',
      na: 'When customer is calm and has raised no worry, complaint, delay or problem, even if money is involved (status updates, confirmations, simple requests).',
    },
  },
  {
    key: 'sentences_simple_to_understand',
    name: 'Sentences (Simple to understand)',
    description: 'Easy to read, short sentences without unexplained jargon, formatted with emphasis (bold/italics) where needed, error-free, and natural/non-robotic tone.',
    defaultWeight: 10,
    allowNA: false,
    aliases: ['sentences_simple_to_understand', 'sentences', 'Sentences', 'readability_and_tone', 'clarity'],
    scoringGuide: {
      yes: 'All four checks pass: simple and clear, well formatted (key details emphasized), error-free, and sounds natural.',
      half: "Understandable, but dense/cluttered/lacks emphasis; or minor errors that don't affect understanding; or partly scripted/stiff; or contains filler/stock phrases in the body.",
      no: 'Confusing, jargon-heavy, hard to read; errors change meaning; whole response sounds robotic or like a copy-pasted template.',
    },
  },
  {
    key: 'opening_and_closing',
    name: 'Opening and closing message',
    description: 'Opening and closing messages are natural, personalised, and appropriate to the context of the thread and current stage of resolution.',
    defaultWeight: 5,
    allowNA: false,
    aliases: ['opening_and_closing', 'opening_closing_message', 'OpeningClosing', 'greeting_and_closing'],
    scoringGuide: {
      yes: 'The opening and closing are tied to the case, or standard pair on a first educational reply. One stock courtesy line is fine when personal touch is present.',
      half: 'One stock phrase, and the personal touch is missing or very light.',
      no: 'Multiple stock phrases; fully generic pair; repeated sympathy or appreciation line across consecutive emails; or closing that stacks generic lines after action is stated.',
    },
  },
];

/**
 * Standard IQS calculation adhering to Wint Wealth rubric rules:
 * - 'yes' = 100%
 * - 'half' / 'partial' = 50%
 * - 'no' = 0%
 * - 'na' = EXCLUDED from numerator and denominator
 */
export function calculateEmailIQS(
  params: Record<string, string | number | null | undefined>,
  customWeights?: Record<string, number>
): number {
  let activeWeight = 0;
  let earnedScore = 0;

  DEFAULT_EMAIL_PARAMETERS.forEach(def => {
    // Check key and any known aliases
    let rawVal = params[def.key];
    if (rawVal === undefined && def.aliases) {
      for (const alias of def.aliases) {
        if (params[alias] !== undefined) {
          rawVal = params[alias];
          break;
        }
      }
    }

    if (rawVal === undefined || rawVal === null) return;

    const valStr = String(rawVal).toLowerCase().trim();
    if (valStr === 'na' || valStr === 'n/a') {
      // Exclude NA from both numerator and denominator
      return;
    }

    const weight = customWeights?.[def.key] ?? def.defaultWeight;
    activeWeight += weight;

    if (valStr === 'yes' || valStr === 'pass' || valStr === '1' || valStr === 'true') {
      earnedScore += weight * 100;
    } else if (valStr === 'half' || valStr === 'partial' || valStr === '0.5') {
      earnedScore += weight * 50;
    } else if (valStr === 'no' || valStr === 'fail' || valStr === '0' || valStr === 'false') {
      earnedScore += 0;
    } else if (typeof rawVal === 'number') {
      earnedScore += weight * Math.max(0, Math.min(100, rawVal));
    }
  });

  if (activeWeight === 0) return 0;
  return Math.round(earnedScore / activeWeight);
}

/**
 * Normalizes any parameter value string or number to a valid toggle value.
 */
export function normalizeParamScoreValue(val: any): ParameterScoreValue {
  if (val === 'yes' || val === 'half' || val === 'partial' || val === 'no' || val === 'na') {
    return val === 'partial' ? 'half' : val;
  }
  if (typeof val === 'string') {
    const s = val.toLowerCase().trim();
    if (s === 'yes' || s === 'pass' || s === '1' || s === 'true') return 'yes';
    if (s === 'half' || s === 'partial' || s === '0.5') return 'half';
    if (s === 'no' || s === 'fail' || s === '0' || s === 'false') return 'no';
    if (s === 'na' || s === 'n/a' || s === 'none') return 'na';
  }
  if (typeof val === 'number') {
    if (val >= 80) return 'yes';
    if (val >= 40) return 'half';
    return 'no';
  }
  return 'yes';
}

/**
 * Strips HTML tags and excessive whitespace to save tokens in Gemini Batch API.
 */
export function cleanEmailText(text: string): string {
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
 * Builds the comprehensive prompt for evaluating an agent reply against the 7 parameters.
 */
export function buildEmailEvaluationPrompt(input: ReplyEvaluationContextInput): string {
  let contextBlock = '';

  // Merged ticket context if available
  let mergedNote = '';
  if (input.mergedTicketSummary) {
    const summaryStr = typeof input.mergedTicketSummary === 'string'
      ? input.mergedTicketSummary
      : JSON.stringify(input.mergedTicketSummary, null, 2);
    mergedNote = `\n[NOTE: This ticket contains merged context from a prior merged ticket]:\n${summaryStr}\n`;
  }

  // Conversation history: <= 3 previous emails vs > 3 previous emails
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

  return `You are an expert Quality Assurance & Compliance Auditor at Wint Wealth, evaluating an outbound email reply sent by an agent to an investor.

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
EVALUATION PARAMETERS & SCORING RUBRIC (7 Parameters):

1. Issue resolution
- Question: Does the email address every question and request raised by the customer and either resolve the issue or properly move it forward?
- What to check:
  • Every question and request is addressed, not just the first one. Nothing is skipped, including anything left open from earlier emails. The issue is either resolved or the customer is given a clear next step, so they are never left without guidance.
  • If the agent says they will check or follow up, the reply explains what will happen next. Mentioning "our team" or "the concerned team" is acceptable; the team does not need to be named specifically.
  • If the customer shares a document, screenshot, account update, or confirmation without asking a direct question, the agent acknowledges it and takes the appropriate next step.
  • The customer is not left without guidance on what to do next.
- Scoring:
  • "yes": Every question and request is addressed, and the issue is resolved or properly progressed. Examples include raising a ticket, escalating the case, forwarding a document, arranging a call, or giving the customer a clear next step.
  • "half": The main issue is addressed, but a smaller question or request is missed or only partly answered, or the next step is unclear.
  • "no": A key question or request is missed, the reply does not address the customer's actual concern, or the issue is left unresolved without a clear next step.
  • "na": There is no customer issue to resolve. This applies to: a general announcement, routine update, survey, or policy notification; a standard auto-closure notice sent because the customer did not reply; an email that is not to a client. Do not score an auto-closure as an issue left unresolved.

2. Accuracy
- What this parameter measures: Whether everything the agent told the client is correct, compliant and safe, and whether any document the agent sent is the right one. Every agent reply in a ticket is scored separately. Customer messages, internal notes and automated messages are not scored.
- What to check (no separate points):
  1. Facts, dates, amounts and steps are correct.
  2. The correct product is named.
  3. Every explanation or educational point (how a product works, rules, charges, offer terms, timelines) is correct.
  4. No guaranteed returns, predictions or personal investment advice.
  5. Required disclaimers are included.
  6. Only the client's own details are shared.
  7. The document (statement, certificate, form, confirmation) is actually attached.
  8. The email says a document is attached and names it.
  9. It is the right document, and it belongs to this client.
  (Checks 7, 8 and 9 apply only when the reply sends a document. If no document is involved, they are N/A.)
- Guidelines:
  • Client-specific facts (amounts, dates, bond held, order or account status, bank details, IDs): account data first, then attachment, then thread.
  • General rules (how product works, charges, TDS, settlement cycles, steps, TATs, offer terms, app paths): knowledge base (KB).
  • Claims about thread ("as shared in our earlier email"): thread itself.
  • Essential information must be restated in current reply: Amount, date and time, transaction reference, and document or reward details must appear in the reply itself. If reply points to an earlier email for these details instead of restating them, score "no", whether or not the earlier email exists.
  • If sources conflict, account data wins for client facts and KB wins for general rules.
  • Never mark something right or wrong from your own knowledge of product, SEBI rules or tax.
  • If a claim cannot be checked against any source, note it as unverified for human review.
  • A reply is judged against facts as they are now known. A reply that repeats an earlier error is scored down; a reply that corrects one is not.
- Scoring:
  • "yes": All applicable checks pass. Information is accurate, right product named, no guarantees/predictions/advice, required disclaimer present, only client's own details shared, attachment present, named and correct.
  • "half": Minor lapse that does not mislead client or cause harm (wording slip that does not change meaning; footer missing on Tier B reply where safe; attachment mentioned loosely or attached but not mentioned; detail of another account whose origin cannot be shown).
  • "no": Any one of these: wrong fact, date, amount, step, TAT, offer term or explanation that could mislead; wrong product named; guaranteed return/prediction/personal advice; another client's details shared; required disclaimer missing on Tier A reply; core attachment missing, wrong, or belonging to another client; false statement about thread; essential information (amount, date/time, reference, document/reward details) not restated, pointing only to earlier email.

3. Expectation setting
- Objective: The agent answers the user's core query completely and shares all related information without waiting to be asked. The user should leave knowing exactly what happens next and by when.
- What to check:
  • If agent asks a question and user doesn't reply, agent gives a generic response and tries to move query toward resolution.
  • If user isn't understanding, agent reframes in simpler words until they do.
  • Correct process and realistic TAT always stated. Example: missed interest repayment: ask user to check bank statement (last 4 digits). If not credited, ask to send statement to registered email, and set TAT for check and escalation.
  • For repayment cases where specific TAT cannot be defined, agent should communicate available information and explain next steps without committing to unrealistic timeline. Do not deduct marks solely for absence of timeline in such cases.
  • Follow-ups are personalized to user's query, not generic.
  • Correct any past errors in the thread without being asked.
  • Give helpful educational points client did not ask for.
- Scoring:
  • "yes": Complete answer, correct process, clear TAT wherever applicable, and personalised follow-up.
  • "half": Answer is correct, but process, TAT (where applicable), or follow-up is missing or generic.
  • "no": Core query unanswered, wrong process, or no expectation set.
  • Exception: In repayment cases where specific TAT cannot be defined, do not deduct marks solely for absence of specific timeline, provided agent communicates available information and explains next steps.

4. Personalisation
- Question: Is the email written for this client, not a template?
- What to check:
  • Uses client's actual situation and earlier replies.
  • Does not ask for information client already gave.
  • Uses correct pronunciations and terms.
  • Refers to customer's actual bond, amounts, dates, or account status; on transferred chat, uses what bot already collected instead of asking to repeat.
- Scoring:
  • "yes": Reflects client's actual case. References specific details (bond, amounts, dates, account status), builds on earlier replies, asks for nothing client already shared. Uses bot collected information.
  • "half": Partly tailored but has template elements (mentions situation only in general terms, leaves out available details, minor repeated ask for information already given).
  • "no": Reads like a template or copy-paste reply; does not reflect actual situation; asks for info client already gave; ignores earlier replies; makes client repeat what bot already collected.

5. Empathy
- Objective: Agent understands what customer is really saying/asking, takes ownership, and responds to emotion (confusion, worry, anxiety, frustration). Where customer's money is involved and they raised a concern, this care is expected. Tone is warm, polite and natural. Calms an irritated customer.
- What to check:
  1. Understanding query: responds to what customer actually said.
  2. Understanding emotion: acknowledges specific feeling or stakes (urgency, frustration, confusion, money at risk).
  3. Colloquial / too formal: natural and professional tone, neither slangy nor stiff/robotic.
  4. Requesting the user: polite and comes with a reason, not a command.
- Scoring:
  • "yes": Ownership and warmth are genuine and specific to this customer's situation. At least one sentence acknowledges their actual concern, urgency or feeling in words that could not be pasted into another email.
  • "half": Polite and acknowledges customer, but acknowledgement is generic/templated, or warmth comes only from stock courtesy lines.
  • "no": Cold, mechanical or dismissive where care is clearly needed, or ignores something the customer said.
  • "na": Customer is calm and has raised no worry, complaint, delay or problem, even if money is involved. Includes status updates, confirmations and replies to simple requests.

6. Sentences (Simple to understand)
- Objective: Response is easy to read, correctly written, and sounds like a real person.
- What to check:
  • Simple and clear: Sentences are short and easy to follow; technical jargon avoided or explained.
  • Well formatted: Important details (amounts, dates, TAT, steps) are emphasized with bold, italics, or underline where needed so user finds them quickly.
  • Error-free: No spelling mistakes, typos, omitted words, or grammatical errors.
  • Not robotic: Natural and conversational tone. Does not read as stiff script. Filler and stock phrases in body judged here (e.g. "We understand your concern" when none raised).
- Scoring:
  • "yes": All four checks pass: clear, simple, well formatted, error-free, and sounds natural.
  • "half": Understandable, but dense, cluttered, or lacks emphasis on key details; or minor errors that don't affect understanding; or partly scripted/stiff; or contains filler/stock phrases in body that add nothing.
  • "no": Confusing, jargon-heavy, or hard to read; errors change meaning or make message unclear; whole response sounds robotic or like a copy-paste template.

7. Opening and closing message
- Objective: Evaluate whether opening and closing messages are natural, personalised, and appropriate to context and stage of resolution.
- Scoring:
  • "yes": Opening and closing tied to case, or standard pair on first educational reply. One stock courtesy line is fine when personal touch is present.
  • "half": One stock phrase, and personal touch is missing or very light.
  • "no": Multiple stock phrases; fully generic pair; repeated sympathy or appreciation across consecutive emails; or closing that stacks generic lines after action is stated.

---
CRITICAL COMPLIANCE TRIPWIRES:
Mark compliance_passed as false and list specific violation in compliance_issues if:
- Guaranteed returns or investment predictions promised
- Disclosing another client's details, PII, or confidential account information
- Misinforming the investor about withdrawal, tax, or maturity timelines
- Using rude, disrespectful, or unprofessional language

---
OUTPUT FORMAT:
Return ONLY a valid JSON object matching this schema (no markdown formatting, no commentary outside the JSON):
{
  "quality_score": 88,
  "compliance_passed": true,
  "compliance_issues": [],
  "parameter_scores": {
    "issue_resolution": "yes",
    "accuracy": "yes",
    "expectation_setting": "yes",
    "personalisation": "half",
    "empathy": "na",
    "sentences_simple_to_understand": "yes",
    "opening_and_closing": "yes"
  },
  "parameter_reasoning": {
    "issue_resolution": "Addressed both the interest credit date and the Form 16A download path.",
    "accuracy": "All facts match Wint Wealth KB; disclaimer included; client details verified.",
    "expectation_setting": "Clear TAT of 24 hours provided for interest reflection.",
    "personalisation": "Used client's bond name, but included a standard closing boilerplate.",
    "empathy": "NA - Customer had a calm, standard transactional question.",
    "sentences_simple_to_understand": "Clean bullet points, important dates bolded, zero typos.",
    "opening_and_closing": "Natural opening greeting and polite closing aligned with issue."
  },
  "summary": "Clear, accurate and compliant response addressing customer query with prompt turnaround.",
  "strengths": ["Bolded key dates for readability", "Directly provided download path for tax document"],
  "areas_for_improvement": ["Avoid repetitive template sign-off"]
}`;
}
