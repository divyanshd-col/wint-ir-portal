import { query } from '@/lib/cx/db';
import { readConfig } from '@/lib/config';
import { getIQSGeminiKeys, geminiGenerate } from '@/lib/gemini';
import { getPcgKbContextForScoring } from '@/lib/pcg/kb';
import { resolvePcgRmByPhone } from '@/lib/pcg/rm-directory';
import { canonicalizePcgRmName, isPcgAm } from '@/lib/pcg/canonical-names';
import { detectPcgChatCategories, isPcgHiringOrRecruitmentChat } from '@/lib/pcg/chat-category';

export interface PcgChatParameterDef {
  id: string;
  num: number;
  name: string;
  weight: number;
  group: 'Process Skills' | 'Customer Service Skills' | 'Communication Skills';
  conditional: boolean;
  scoreType: 'Yes / Half / No' | 'Yes / No';
  description: string;
}

export const PCG_CHAT_PARAMETERS: PcgChatParameterDef[] = [
  // Group 1: Process Skills
  {
    id: 'QueryResolution',
    num: 1,
    name: 'Query Resolution',
    weight: 20,
    group: 'Process Skills',
    conditional: false,
    scoreType: 'Yes / Half / No',
    description: 'Did the RM deal with every question the client raised, and either resolve it or properly move it forward to the right team or call.',
  },
  {
    id: 'Accuracy',
    num: 2,
    name: 'Accuracy (Technically / Legally Correct)',
    weight: 20,
    group: 'Process Skills',
    conditional: false,
    scoreType: 'Yes / Half / No',
    description: 'Was what the RM said correct, as per Wint Knowledge Base, PMS Disclosure Document, AIF PPM, and SEBI rules (strategies, fees, lock-in, taxation, NAV, returns).',
  },
  {
    id: 'ExpectationFollowThrough',
    num: 3,
    name: 'Expectation & Follow-Through',
    weight: 15,
    group: 'Process Skills',
    conditional: false,
    scoreType: 'Yes / Half / No',
    description: 'Does the client know when they will hear back (TAT/next steps), and did the RM honour visible follow-through commitments.',
  },
  {
    id: 'Personalisation',
    num: 4,
    name: 'Personalisation & Relationship Context',
    weight: 15,
    group: 'Process Skills',
    conditional: false,
    scoreType: 'Yes / Half / No',
    description: "Was the reply built around this client's portfolio, specific holdings/tranches, and conversation history, without asking for info already shared.",
  },
  {
    id: 'EscalationToCall',
    num: 8,
    name: 'Escalation to Call',
    weight: 4,
    group: 'Process Skills',
    conditional: true,
    scoreType: 'Yes / No',
    description: 'Was moving to a call, or staying in chat, the right decision for this client situation. NA if call question never arose.',
  },
  {
    id: 'PostCallRecap',
    num: 9,
    name: 'Post-Call Recap',
    weight: 4,
    group: 'Process Skills',
    conditional: true,
    scoreType: 'Yes / No',
    description: 'Evaluated whenever chat references a completed call: did RM post a written summary of what was discussed and agreed. NA if no call took place.',
  },

  // Group 2: Customer Service Skills
  {
    id: 'DissatisfactionHandling',
    num: 5,
    name: 'Dissatisfaction Handling',
    weight: 8,
    group: 'Customer Service Skills',
    conditional: true,
    scoreType: 'Yes / Half / No',
    description: 'Judged only when client is visibly unhappy, complaining, demanding, or distressed. Stays non-defensive, offers a concrete way forward. Otherwise NA.',
  },
  {
    id: 'Empathy',
    num: 6,
    name: 'Empathy',
    weight: 5,
    group: 'Customer Service Skills',
    conditional: true,
    scoreType: 'Yes / Half / No',
    description: 'Judged only in gentler moments of confusion, worry about markets/drawdowns, anxiety, or apology. Specific acknowledgement fitting the moment. Otherwise NA.',
  },
  {
    id: 'SimplifyingConcepts',
    num: 7,
    name: 'Simplifying Concepts',
    weight: 5,
    group: 'Customer Service Skills',
    conditional: true,
    scoreType: 'Yes / Half / No',
    description: 'Judged only when complex terms arise (hurdle rate, high-water mark, drawdown, exit load, pass-through taxation, TWRR, XIRR, YTM, TDS, Record Date). Otherwise NA.',
  },

  // Group 3: Communication Skills
  {
    id: 'ReadabilityTone',
    num: 10,
    name: 'Readability & Professional Tone',
    weight: 2,
    group: 'Communication Skills',
    conditional: false,
    scoreType: 'Yes / No',
    description: 'Could the client easily read the messages on a phone, and was the tone respectful and professional for an HNI client (no solid unformatted text blocks, no raw internal jargon).',
  },
  {
    id: 'GreetingClosing',
    num: 11,
    name: 'Greeting & Closing',
    weight: 2,
    group: 'Communication Skills',
    conditional: false,
    scoreType: 'Yes / No',
    description: 'Did the RM open respectfully with Sir/Ma\'am, introduce self/Wint Wealth on first contact/new thread, and close the conversation properly upon resolution.',
  },
];

export interface PcgChatComplianceCheckDef {
  id: string;
  num: number;
  name: string;
  rule: string;
}

export const PCG_CHAT_COMPLIANCE_CHECKS: PcgChatComplianceCheckDef[] = [
  {
    id: 'NoInvestmentAdvice',
    num: 1,
    name: 'No investment advice',
    rule: 'We do not tell the client what to invest in beyond what SEBI permits.',
  },
  {
    id: 'NoPromisedReturns',
    num: 2,
    name: 'No promised returns',
    rule: 'We do not say returns are guaranteed, assured or risk-free.',
  },
  {
    id: 'NoUnqualifiedPastPerformance',
    num: 3,
    name: 'No unqualified past performance',
    rule: 'Past returns are shared only with the required disclaimer, and not selectively or deceptively.',
  },
  {
    id: 'NoPersonalOrInternalDocuments',
    num: 4,
    name: 'No personal or internal documents on WhatsApp',
    rule: 'No client statements, holding reports, KYC documents with PAN/Aadhaar/Bank details, or internal policies/tools screenshots sent by RM on WhatsApp.',
  },
  {
    id: 'NoMisleadingMistakes',
    num: 5,
    name: 'No misleading mistakes',
    rule: 'No factual error serious enough to push a client into a wrong money decision (e.g. wrong lock-in, wrong drawdown date).',
  },
];

export interface EvaluatedParameterResult {
  id: string;
  num: number;
  name: string;
  weight: number;
  group: string;
  status: 'Yes' | 'Half' | 'No' | 'NA';
  earnedScore: number;
  maxScore: number;
  quote?: string;
  reasoning: string;
  cannotTellFlag?: boolean;
  failedBy?: 'rm' | 'am' | 'both' | null;
  rmStatus?: 'Yes' | 'Half' | 'No' | 'NA';
  amStatus?: 'Yes' | 'Half' | 'No' | 'NA';
  rmReasoning?: string;
  amReasoning?: string;
  rmQuote?: string;
  amQuote?: string;
}

export interface EvaluatedComplianceResult {
  id: string;
  num: number;
  name: string;
  status: 'PASS' | 'FAIL' | 'NA';
  quote?: string;
  reasoning: string;
  failedBy?: 'rm' | 'am' | 'both' | null;
  rmStatus?: 'PASS' | 'FAIL' | 'NA';
  amStatus?: 'PASS' | 'FAIL' | 'NA';
  rmReasoning?: string;
  amReasoning?: string;
  rmQuote?: string;
  amQuote?: string;
}

export interface PcgChatEvaluationResult {
  iqsScore: number | null;
  processScore: number | null;
  communicationScore: number | null;
  customerServiceScore: number | null;
  applicableWeight: number;
  verdict: 'excellent' | 'meets_expectations' | 'coaching' | 'remediation' | 'NOT_SCOREABLE' | 'FAILED_CRITICAL' | 'EXCLUDED_NON_CLIENT';
  isEvaluable: boolean;
  exclusionReason: string | null;
  summary?: string | null;
  parameters: Record<string, EvaluatedParameterResult>;
  complianceFlags: EvaluatedComplianceResult[];
  complianceTripwire: boolean;
  complianceReason: string | null;
  aiCoachingTip: string;
  categories?: string[];
  rmName: string;
  tlName: string;
  isAm?: boolean;
  precedingRmName?: string | null;
  isCoHandled?: boolean;
  coHandledRm?: string | null;
  coHandledAm?: string | null;
  rmMistakesCount?: number;
  amMistakesCount?: number;
}

/**
 * Filter out system messages, broadcasts, automated assignment templates, and off-hours bot replies.
 * Only genuine RM dialogue turns are scored.
 */
export function sanitizeChatTurns(turns: any[]): any[] {
  if (!Array.isArray(turns)) return [];
  return turns.filter(t => {
    if (!t) return false;
    const text = (t.text || '').trim();
    if (!text) return false;
    // Exclude automated system notices
    const lower = text.toLowerCase();
    if (lower.startsWith('your chat has been assigned to') ||
      lower.startsWith('we are currently offline') ||
      lower.startsWith('thank you for contacting wint wealth. our working hours are') ||
      lower.includes('automated message') ||
      t.type === 'system_notification') {
      return false;
    }
    return true;
  });
}

/**
 * Extracts a search query from the transcript for KB context retrieval.
 */
export function extractQueryFromChatTranscript(turns: any[]): string {
  const words: string[] = [];
  for (const t of turns) {
    if (t.text) words.push(t.text);
  }
  const text = words.join(' ');
  // Extract key financial product mentions
  const matches = text.match(/\b(aif|pms|mld|bond|ncd|yield|xirr|twrr|drawdown|exit load|tax|tds|nav|spandana|ugro|incred|navi|asirvad)\b/gi) || [];
  return Array.from(new Set(matches)).join(' ') || text.slice(0, 150);
}

/**
 * Evaluates a closed PCG WhatsApp conversation using Gemini 2.5 Flash and Wint KB.
 */
export async function evaluatePcgChatConversation(
  conversation: {
    id?: number | string | null;
    customer_phone: string;
    waba_number: string;
    customer_name?: string | null;
    rm_name?: string | null;
    assigned_rm_id?: string | null;
    transcript: any[];
    closed_at?: string | null;
    summary?: string | null;
    is_am?: boolean;
    preceding_rm_name?: string | null;
  }
): Promise<PcgChatEvaluationResult> {
  const turns = sanitizeChatTurns(conversation.transcript);

  // Check if there is human conversation
  const rmTurns = turns.filter(t => t.speaker === 'RM' || t.speaker === 'AM' || t.direction === 'outbound');
  const customerTurns = turns.filter(t => t.speaker === 'Customer' || t.direction === 'inbound');

  // Resolve RM Name and Team Lead
  let rmName = conversation.rm_name || '';
  let tlName = 'Team Admin';

  if (!rmName || /^\+?\d{8,15}$/.test(rmName)) {
    // 1. Try resolving by assigned_rm_id if it matches a directory phone
    if (conversation.assigned_rm_id) {
      const resolved = await resolvePcgRmByPhone(conversation.assigned_rm_id);
      if (resolved?.rm) {
        rmName = resolved.rm;
        tlName = resolved.tl;
      }
    }

    // 2. If not resolved, fall back to waba_number (the RM's dedicated WhatsApp line)
    if (!rmName && conversation.waba_number) {
      const resolved = await resolvePcgRmByPhone(conversation.waba_number);
      if (resolved?.rm) {
        rmName = resolved.rm;
        tlName = resolved.tl;
      }
    }

    // 3. Fall back to rmName if passed as a raw phone number
    if (!rmName && conversation.rm_name) {
      const resolved = await resolvePcgRmByPhone(conversation.rm_name);
      if (resolved?.rm) {
        rmName = resolved.rm;
        tlName = resolved.tl;
      }
    }
  }

  if (rmName) {
    rmName = canonicalizePcgRmName(rmName);
  } else {
    rmName = 'Unassigned RM';
  }

  // Detect AM role and preceding RM handoff (co-handled conversation)
  const isAmConversation = Boolean(conversation.is_am) || isPcgAm(rmName) || turns.some(t => t.speaker === 'AM' || t.role === 'am' || (t.agent_name && isPcgAm(t.agent_name)));
  let precedingRmName = conversation.preceding_rm_name || null;

  if (isAmConversation) {
    // If TL is not explicitly set or is Team Admin, map to Team Swetha
    if (!conversation.rm_name || tlName === 'Team Admin') {
      tlName = 'Team Swetha';
    }

    if (!precedingRmName) {
      const priorRmTurn = turns.find(t => (t.speaker === 'RM' || t.role === 'rm' || (t.agent_name && !isPcgAm(t.agent_name))) && (t.direction === 'outbound' || t.speaker === 'RM'));
      if (priorRmTurn?.agent_name) {
        precedingRmName = canonicalizePcgRmName(priorRmTurn.agent_name);
      }
    }
  }

  const isCoHandled = Boolean(precedingRmName && isAmConversation);
  const coHandledRm = precedingRmName;
  const coHandledAm = rmName;

  // Extract preceding RM context when mid-chat handoff occurred
  let precedingRmContext = '';
  if (isAmConversation && precedingRmName) {
    const handoffIdx = turns.findIndex(t => t.is_handoff || t.speaker === 'AM' || t.role === 'am' || (t.agent_name && isPcgAm(t.agent_name)));
    const precedingTurns = handoffIdx > 0 ? turns.slice(0, handoffIdx) : turns.filter(t => t.speaker === 'RM' || (t.agent_name && !isPcgAm(t.agent_name)));

    if (precedingTurns.length > 0) {
      const priorHistoryText = precedingTurns
        .map(t => `${t.speaker || (t.direction === 'inbound' ? 'Customer' : 'RM')}${t.agent_name ? ` (${t.agent_name})` : ''}: ${t.text || ''}`)
        .join('\n');

      precedingRmContext = `
=== CO-HANDLED CHAT AUDIT INSTRUCTIONS (RM: "${coHandledRm}" + AM: "${coHandledAm}") ===
This WhatsApp interaction was handled collaboratively by both Relationship Manager (RM: "${coHandledRm}") and Associate Manager (AM: "${coHandledAm}").
Preceding message history before AM took over:
${priorHistoryText}

CRITICAL SCORING RULES FOR CO-HANDLED CHAT:
1. ENTIRE CHAT QUALITY: Audit the entire interaction as a cohesive service delivery to the client. Compute ONE single overall chat score based on all 11 parameters. There is NO separate overall percentage score for RM and AM.
2. ATTRIBUTED PARAMETER SCORING:
   - "QueryResolution" (Parameter 1) is a SHARED parameter for the entire interaction. Did the client's questions get resolved by the team?
   - For all other 10 parameters (Accuracy, ExpectationFollowThrough, Personalisation, DissatisfactionHandling, Empathy, SimplifyingConcepts, EscalationToCall, PostCallRecap, ReadabilityTone, GreetingClosing):
     Evaluate whether RM and AM met the requirements on their respective turns.
     If a parameter fails (status "No" or "Half"):
     - State explicitly in "failedBy" who made the mistake: "rm", "am", or "both".
     - In "rmStatus" / "amStatus": record "Yes", "Half", "No", or "NA" for that agent's contribution.
     - In "rmReasoning" / "amReasoning": explain what each agent did or what mistake was made.
3. COMPLIANCE GATE BREACHES ATTRIBUTE TO BOTH:
   - For all 5 compliance checks (NoInvestmentAdvice, NoPromisedReturns, NoUnqualifiedPastPerformance, NoPersonalOrInternalDocuments, NoMisleadingMistakes):
     If ANY compliance gate breach occurs anywhere in the co-handled interaction (committed by either RM or AM), the breach attributes to BOTH handlers ("failedBy": "both", "rmStatus": "FAIL", "amStatus": "FAIL"). Both co-handlers share joint accountability for regulatory compliance. Explain the specific violating message in "rmReasoning" and "amReasoning".
`;
    }
  }

  // If no RM replies or no real dialogue, mark NOT_SCOREABLE without LLM cost
  if (rmTurns.length === 0 || turns.length < 2) {
    const emptyParams: Record<string, EvaluatedParameterResult> = {};
    for (const p of PCG_CHAT_PARAMETERS) {
      emptyParams[p.id] = {
        id: p.id,
        num: p.num,
        name: p.name,
        weight: p.weight,
        group: p.group,
        status: 'NA',
        earnedScore: 0,
        maxScore: p.weight,
        reasoning: 'No two-way human dialogue or 0 RM replies in closed thread.',
      };
    }

    const emptyCompliance: EvaluatedComplianceResult[] = PCG_CHAT_COMPLIANCE_CHECKS.map(c => ({
      id: c.id,
      num: c.num,
      name: c.name,
      status: 'NA',
      reasoning: 'No conversation turns to evaluate.',
    }));

    return {
      iqsScore: null,
      processScore: null,
      communicationScore: null,
      customerServiceScore: null,
      applicableWeight: 0,
      verdict: 'NOT_SCOREABLE',
      isEvaluable: false,
      exclusionReason: rmTurns.length === 0 ? 'No RM reply sent in thread' : 'Insufficient conversation turns',
      parameters: emptyParams,
      complianceFlags: emptyCompliance,
      complianceTripwire: false,
      complianceReason: null,
      aiCoachingTip: 'Ensure RM acknowledges and responds to inbound client inquiries promptly.',
      categories: detectPcgChatCategories({ transcriptTurns: turns }),
      rmName,
      tlName,
    };
  }

  // Detect non-client hiring / recruitment interactions and exclude them without LLM cost
  const isHiring = isPcgHiringOrRecruitmentChat(turns, conversation.summary, conversation.customer_name);
  if (isHiring) {
    const emptyParams: Record<string, EvaluatedParameterResult> = {};
    for (const p of PCG_CHAT_PARAMETERS) {
      emptyParams[p.id] = {
        id: p.id,
        num: p.num,
        name: p.name,
        weight: p.weight,
        group: p.group,
        status: 'NA',
        earnedScore: 0,
        maxScore: p.weight,
        reasoning: 'Non-client recruitment / job application interaction.',
      };
    }

    const emptyCompliance: EvaluatedComplianceResult[] = PCG_CHAT_COMPLIANCE_CHECKS.map(c => ({
      id: c.id,
      num: c.num,
      name: c.name,
      status: 'NA',
      reasoning: 'Non-client conversation - compliance gates not applicable.',
    }));

    return {
      iqsScore: null,
      processScore: null,
      communicationScore: null,
      customerServiceScore: null,
      applicableWeight: 0,
      verdict: 'EXCLUDED_NON_CLIENT',
      isEvaluable: false,
      exclusionReason: 'Non-client interaction: Hiring / Candidate recruitment',
      parameters: emptyParams,
      complianceFlags: emptyCompliance,
      complianceTripwire: false,
      complianceReason: null,
      aiCoachingTip: 'Candidate / recruitment conversations are excluded from wealth management quality scoring.',
      categories: ['General'],
      rmName,
      tlName,
      isAm: isAmConversation,
      precedingRmName,
      isCoHandled,
    };
  }

  // Retrieve dynamic PCG KB Context
  const searchQuery = extractQueryFromChatTranscript(turns);
  const kbContext = await getPcgKbContextForScoring(searchQuery, 6);

  // Retrieve previous sessions summary context for this customer (Option 1 context chaining)
  let priorSessionsContext = '';
  if (conversation.customer_phone) {
    try {
      const priorRows = await query<any>(`
        SELECT id, chat_closed_at, summary
        FROM pcg_chat_evaluations
        WHERE customer_phone = $1
          AND summary IS NOT NULL
          AND summary != ''
          ${conversation.id ? 'AND (conversation_id IS NULL OR conversation_id != $2)' : ''}
          ${conversation.closed_at ? 'AND chat_closed_at < $3' : ''}
        ORDER BY chat_closed_at ASC, id ASC
      `, [
        conversation.customer_phone,
        ...(conversation.id ? [conversation.id] : []),
        ...(conversation.closed_at ? [conversation.closed_at] : []),
      ]);

      if (priorRows.length > 0) {
        priorSessionsContext = priorRows
          .map((r, idx) => `• Chat #${idx + 1} (${r.chat_closed_at ? new Date(r.chat_closed_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Earlier'}): ${r.summary}`)
          .join('\n');
      }
    } catch (err) {
      console.warn('[pcg-chat-pipeline] Could not fetch prior session summaries:', err);
    }
  }

  // Load Gemini Keys
  const config = await readConfig().catch(() => ({}));
  const geminiKeys = getIQSGeminiKeys(config);
  if (!geminiKeys || geminiKeys.length === 0) {
    throw new Error('No Gemini API keys found in configuration for PCG chat evaluation.');
  }

  const prompt = `You are the Lead Quality Auditor for Wint Wealth's Private Client Group (PCG) WhatsApp Relationship Management team.
You are evaluating a closed WhatsApp chat thread between an HNI Investor (Customer) and ${isAmConversation ? `an Associate Manager (AM: "${rmName}")` : `a Relationship Manager (RM: "${rmName}")`}${precedingRmName ? ` following a mid-chat handover from RM ("${precedingRmName}")` : ''}.

=== EVALUATION GUIDELINES & GOLDEN RULES ===
1. LANGUAGE: Language is NEVER penalised. Hinglish, Hindi, mixed scripts or Hindi typed in English are 100% fine. Only clarity of meaning matters.
2. SYSTEM MESSAGES: Automated assignment templates, broadcasts, or off-hours automated notices are completely excluded from scoring. Judge only what the ${isAmConversation ? 'AM' : 'RM'} wrote.
3. SCORING SCALE:
   - "Yes" (1.0 of maxWeight) = Fully done, nothing a QA reviewer would coach. If the gap cannot be named, score is Yes.
   - "Half" (0.5 of maxWeight) = Mostly done, with one specific nameable gap.
   - "No" (0.0 of maxWeight) = Clearly failed in a nameable way.
   - "NA" = Not Applicable. Situation never arose in this chat. (DO NOT invent a score. NA drops out of the denominator).
   - "Cannot tell" = It applies, but proof is not in the chat (e.g. call was scheduled but outcome not in chat). Flagged for review; drops out of denominator.
4. INDEPENDENT PARAMETERS: One problem lowers one parameter only. A factual error lowers Accuracy only.
5. CONTEXT: Respect thread context. If the chat refers to an earlier conversation or call ("as discussed", "like I mentioned last week"), judge Accuracy and Query Resolution leniently.
6. COMPLIANCE CHECKS: Checked separately from quality. Never changes the 0-100 quality score, but flags the chat for human QA review.
${precedingRmContext}
=== KNOWLEDGE BASE CONTEXT ===
${kbContext || 'Standard Wint Wealth PCG Knowledge Base (PMS, AIF, Bonds, MLD, SEBI regulations).'}
${priorSessionsContext ? `
=== PREVIOUS SESSION(S) CONTEXT (Background Only — Do Not Grade) ===
The customer previously had the following earlier chat session(s) with Wint Wealth PCG:
${priorSessionsContext}
Use this background context to understand ongoing requests, references to prior emails/forms, and relationship continuity without penalizing the agent for missing context established in earlier sessions.
` : ''}

=== 11 CHAT QUALITY PARAMETERS TO SCORE ===
1. QueryResolution (Weight: 20, max: 20, Group: 'Process Skills', Yes/Half/No): Did RM deal with every question the client raised, and either resolve it or properly route to ops/fund manager/call?
2. Accuracy (Weight: 20, max: 20, Group: 'Process Skills', Yes/Half/No): Was information technically/legally correct per Wint KB, PMS Disclosure, AIF PPM, SEBI rules? Corrected mistakes can still be Yes.
3. ExpectationFollowThrough (Weight: 15, max: 15, Group: 'Process Skills', Yes/Half/No): Does the client know when they will hear back (clear timeline/next step when pending)? Were promised follow-ups honoured?
4. Personalisation (Weight: 15, max: 15, Group: 'Process Skills', Yes/Half/No): Built around client's actual holdings, specific tranches, amounts, and past context? Not asking for info already shared.
5. DissatisfactionHandling (Weight: 8, max: 8, Group: 'Customer Service Skills', Yes/Half/No/NA): ONLY judged if client is visibly unhappy, complaining, or demanding. Stays non-defensive, concrete way forward. NA on calm chats.
6. Empathy (Weight: 5, max: 5, Group: 'Customer Service Skills', Yes/Half/No/NA): ONLY in gentler moments of confusion, market worry, anxiety, or apology. Specific acknowledgement fitting the moment. NA if Dissatisfaction applies or on calm chats.
7. SimplifyingConcepts (Weight: 5, max: 5, Group: 'Customer Service Skills', Yes/Half/No/NA): ONLY when complex terms arise (hurdle rate, high-water mark, drawdown, exit load, pass-through taxation, TWRR, XIRR, YTM, TDS, Record Date). NA if no complex terms used.
8. EscalationToCall (Weight: 4, max: 4, Group: 'Process Skills', Yes/No/NA): Was moving to a call, or staying in chat, the right decision? NA if question of call never arose.
9. PostCallRecap (Weight: 4, max: 4, Group: 'Process Skills', Yes/No/NA): Whenever chat references a completed call, did RM post a written summary/recap of what was discussed and agreed? NA if no call took place.
10. ReadabilityTone (Weight: 2, max: 2, Group: 'Communication Skills', Yes/No): Easy to read on phone (no solid unformatted text blocks), polite & professional tone, no raw internal jargon. Small typos/Hinglish never penalised.
11. GreetingClosing (Weight: 2, max: 2, Group: 'Communication Skills', Yes/No): Addresses client respectfully (Sir/Ma'am), introduces self/Wint on new thread/first contact, and closes properly upon resolution. (In ongoing threads, respectful "Hi Sir" is Yes).

=== 5 COMPLIANCE CHECKS ===
1. NoInvestmentAdvice: No advising what to invest in beyond SEBI rules.
2. NoPromisedReturns: No saying returns are guaranteed, assured, or risk-free.
3. NoUnqualifiedPastPerformance: Past returns shared only with required disclaimer.
4. NoPersonalOrInternalDocuments: No client statements, KYC docs, PAN/Aadhaar/Bank details, or internal policies/tools screenshots sent by RM on WhatsApp.
5. NoMisleadingMistakes: No serious factual mistake pushing a client into a wrong money decision.

=== TRANSCRIPT TO EVALUATE ===
${JSON.stringify(turns, null, 2)}

=== REQUIRED JSON OUTPUT FORMAT ===
Return ONLY a valid JSON object matching this schema:
{
  "summary": "A concise 1-2 sentence executive summary of what was discussed, requested, or resolved in this session.",
  "parameters": {
    "QueryResolution": { "status": "Yes" | "Half" | "No", "quote": "...", "reasoning": "..." },
    "Accuracy": { "status": "Yes" | "Half" | "No", "quote": "...", "reasoning": "..." },
    "ExpectationFollowThrough": { "status": "Yes" | "Half" | "No", "quote": "...", "reasoning": "..." },
    "Personalisation": { "status": "Yes" | "Half" | "No", "quote": "...", "reasoning": "..." },
    "DissatisfactionHandling": { "status": "Yes" | "Half" | "No" | "NA", "quote": "...", "reasoning": "..." },
    "Empathy": { "status": "Yes" | "Half" | "No" | "NA", "quote": "...", "reasoning": "..." },
    "SimplifyingConcepts": { "status": "Yes" | "Half" | "No" | "NA", "quote": "...", "reasoning": "..." },
    "EscalationToCall": { "status": "Yes" | "No" | "NA", "quote": "...", "reasoning": "..." },
    "PostCallRecap": { "status": "Yes" | "No" | "NA" | "Cannot tell", "quote": "...", "reasoning": "..." },
    "ReadabilityTone": { "status": "Yes" | "No", "quote": "...", "reasoning": "..." },
    "GreetingClosing": { "status": "Yes" | "No", "quote": "...", "reasoning": "..." }
  },
  "compliance_checks": {
    "NoInvestmentAdvice": { "status": "PASS" | "FAIL" | "NA", "quote": "...", "reasoning": "...", "failedBy": "rm" | "am" | "both" | null, "rmStatus": "PASS" | "FAIL" | "NA", "amStatus": "PASS" | "FAIL" | "NA", "rmReasoning": "...", "amReasoning": "..." },
    "NoPromisedReturns": { "status": "PASS" | "FAIL" | "NA", "quote": "...", "reasoning": "...", "failedBy": "rm" | "am" | "both" | null, "rmStatus": "PASS" | "FAIL" | "NA", "amStatus": "PASS" | "FAIL" | "NA", "rmReasoning": "...", "amReasoning": "..." },
    "NoUnqualifiedPastPerformance": { "status": "PASS" | "FAIL" | "NA", "quote": "...", "reasoning": "...", "failedBy": "rm" | "am" | "both" | null, "rmStatus": "PASS" | "FAIL" | "NA", "amStatus": "PASS" | "FAIL" | "NA", "rmReasoning": "...", "amReasoning": "..." },
    "NoPersonalOrInternalDocuments": { "status": "PASS" | "FAIL" | "NA", "quote": "...", "reasoning": "...", "failedBy": "rm" | "am" | "both" | null, "rmStatus": "PASS" | "FAIL" | "NA", "amStatus": "PASS" | "FAIL" | "NA", "rmReasoning": "...", "amReasoning": "..." },
    "NoMisleadingMistakes": { "status": "PASS" | "FAIL" | "NA", "quote": "...", "reasoning": "...", "failedBy": "rm" | "am" | "both" | null, "rmStatus": "PASS" | "FAIL" | "NA", "amStatus": "PASS" | "FAIL" | "NA", "rmReasoning": "...", "amReasoning": "..." }
  },
  "ai_coaching_tip": "One concise, constructive, actionable coaching recommendation for ${rmName}."
}`;

  const rawOutput = await geminiGenerate(
    geminiKeys,
    'gemini-3.5-flash',
    [{ text: prompt }],
    { responseMimeType: 'application/json' },
    120_000
  );

  const cleaned = rawOutput.replace(/```json/g, '').replace(/```/g, '').trim();
  let parsed: any;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err: any) {
    console.error('[pcg-chat-pipeline] Failed to parse Gemini JSON:', rawOutput);
    throw new Error(`Invalid JSON returned from Gemini: ${err.message}`);
  }

  // Deterministic Scoring Computation
  let totalEarned = 0;
  let totalApplicable = 0;

  let processEarned = 0;
  let processApplicable = 0;

  let commEarned = 0;
  let commApplicable = 0;

  let csEarned = 0;
  let csApplicable = 0;

  const evaluatedParams: Record<string, EvaluatedParameterResult> = {};

  for (const def of PCG_CHAT_PARAMETERS) {
    const aiItem = parsed.parameters?.[def.id] || {};
    let status: 'Yes' | 'Half' | 'No' | 'NA' = 'NA';
    let cannotTellFlag = false;

    const rawStatus = String(aiItem.status || '').trim();
    if (rawStatus === 'Yes' || rawStatus === '1') status = 'Yes';
    else if (rawStatus === 'Half' || rawStatus === '0.5') status = 'Half';
    else if (rawStatus === 'No' || rawStatus === '0') status = 'No';
    else if (rawStatus === 'Cannot tell') {
      status = 'NA';
      cannotTellFlag = true;
    } else {
      status = 'NA';
    }

    let earned = 0;
    if (status === 'Yes') earned = def.weight;
    else if (status === 'Half') earned = def.weight * 0.5;
    else earned = 0;

    if (status !== 'NA') {
      totalEarned += earned;
      totalApplicable += def.weight;

      if (def.group === 'Process Skills') {
        processEarned += earned;
        processApplicable += def.weight;
      } else if (def.group === 'Communication Skills') {
        commEarned += earned;
        commApplicable += def.weight;
      } else if (def.group === 'Customer Service Skills') {
        csEarned += earned;
        csApplicable += def.weight;
      }
    }

    const failedBy: 'rm' | 'am' | 'both' | null =
      (status === 'No' || status === 'Half')
        ? (aiItem.failedBy === 'rm' || aiItem.failedBy === 'am' || aiItem.failedBy === 'both' ? aiItem.failedBy : (isCoHandled ? 'am' : null))
        : null;

    evaluatedParams[def.id] = {
      id: def.id,
      num: def.num,
      name: def.name,
      weight: def.weight,
      group: def.group,
      status,
      earnedScore: earned,
      maxScore: def.weight,
      quote: aiItem.quote || undefined,
      reasoning: aiItem.reasoning || '',
      cannotTellFlag,
      failedBy,
      rmStatus: aiItem.rmStatus || (status === 'No' && failedBy === 'rm' ? 'No' : (status === 'Yes' ? 'Yes' : 'NA')),
      amStatus: aiItem.amStatus || (status === 'No' && failedBy === 'am' ? 'No' : (status === 'Yes' ? 'Yes' : 'NA')),
      rmReasoning: aiItem.rmReasoning || undefined,
      amReasoning: aiItem.amReasoning || undefined,
      rmQuote: aiItem.rmQuote || undefined,
      amQuote: aiItem.amQuote || undefined,
    };
  }

  // 5 Compliance Checks
  const complianceResults: EvaluatedComplianceResult[] = [];
  let complianceTripwire = false;
  const failureReasons: string[] = [];

  for (const c of PCG_CHAT_COMPLIANCE_CHECKS) {
    const aiCheck = parsed.compliance_checks?.[c.id] || {};
    const st = String(aiCheck.status || '').toUpperCase();
    const status: 'PASS' | 'FAIL' | 'NA' = (st === 'FAIL' || st === 'FAILED') ? 'FAIL' : (st === 'PASS' || st === 'PASSED' ? 'PASS' : 'NA');

    let failedBy: 'rm' | 'am' | 'both' | null = null;
    if (status === 'FAIL') {
      complianceTripwire = true;
      failureReasons.push(`${c.name}: ${aiCheck.reasoning || 'Breach identified.'} (Quote: "${aiCheck.quote || ''}")`);

      if (isCoHandled) {
        const rawFb = String(aiCheck.failedBy || '').toLowerCase();
        if (rawFb === 'rm') failedBy = 'rm';
        else if (rawFb === 'am') failedBy = 'am';
        else if (rawFb === 'both') failedBy = 'both';
        else {
          if (aiCheck.rmStatus === 'FAIL' && aiCheck.amStatus === 'FAIL') failedBy = 'both';
          else if (aiCheck.rmStatus === 'FAIL') failedBy = 'rm';
          else if (aiCheck.amStatus === 'FAIL') failedBy = 'am';
          else failedBy = 'both';
        }
      }
    }

    complianceResults.push({
      id: c.id,
      num: c.num,
      name: c.name,
      status,
      quote: aiCheck.quote || undefined,
      reasoning: aiCheck.reasoning || '',
      failedBy,
      rmStatus: aiCheck.rmStatus || (status === 'FAIL' && failedBy === 'rm' ? 'FAIL' : (status === 'PASS' ? 'PASS' : 'NA')),
      amStatus: aiCheck.amStatus || (status === 'FAIL' && failedBy === 'am' ? 'FAIL' : (status === 'PASS' ? 'PASS' : 'NA')),
      rmReasoning: aiCheck.rmReasoning || undefined,
      amReasoning: aiCheck.amReasoning || undefined,
      rmQuote: aiCheck.rmQuote || undefined,
      amQuote: aiCheck.amQuote || undefined,
    });
  }

  const iqsScore = totalApplicable > 0 ? Math.round((totalEarned / totalApplicable) * 100) : null;
  const processScore = processApplicable > 0 ? Math.round((processEarned / processApplicable) * 100) : null;
  const communicationScore = commApplicable > 0 ? Math.round((commEarned / commApplicable) * 100) : null;
  const customerServiceScore = csApplicable > 0 ? Math.round((csEarned / csApplicable) * 100) : null;

  let verdict: PcgChatEvaluationResult['verdict'] = 'NOT_SCOREABLE';
  if (totalApplicable === 0) {
    verdict = 'NOT_SCOREABLE';
  } else if (complianceTripwire) {
    verdict = 'FAILED_CRITICAL';
  } else if (iqsScore !== null) {
    if (iqsScore >= 85) verdict = 'excellent';
    else if (iqsScore >= 70) verdict = 'meets_expectations';
    else if (iqsScore >= 50) verdict = 'coaching';
    else verdict = 'remediation';
  }

  const rmMistakesCount = isCoHandled
    ? Object.values(evaluatedParams).filter(p => p.rmStatus === 'No' || p.failedBy === 'rm' || p.failedBy === 'both').length
    : 0;
  const amMistakesCount = isCoHandled
    ? Object.values(evaluatedParams).filter(p => p.amStatus === 'No' || p.failedBy === 'am' || p.failedBy === 'both').length
    : 0;

  return {
    iqsScore,
    processScore,
    communicationScore,
    customerServiceScore,
    applicableWeight: totalApplicable,
    verdict,
    isEvaluable: totalApplicable > 0,
    exclusionReason: totalApplicable === 0 ? 'All parameters NA' : null,
    summary: parsed.summary || null,
    parameters: evaluatedParams,
    complianceFlags: complianceResults,
    complianceTripwire,
    complianceReason: failureReasons.length > 0 ? failureReasons.join(' | ') : null,
    aiCoachingTip: parsed.ai_coaching_tip || 'Maintain prompt follow-ups and clear next-step expectation setting.',
    categories: detectPcgChatCategories({
      transcriptTurns: turns,
      parameters: evaluatedParams,
      aiCoachingTip: parsed.ai_coaching_tip,
      complianceReason: failureReasons.join(' | '),
    }),
    rmName,
    tlName,
    isAm: isAmConversation,
    precedingRmName: precedingRmName || null,
    isCoHandled,
    coHandledRm: isCoHandled ? coHandledRm : null,
    coHandledAm: isCoHandled ? coHandledAm : null,
    rmMistakesCount,
    amMistakesCount,
  };
}

/**
 * Automatically evaluates a PCG WhatsApp conversation by ID or object and saves the result into pcg_chat_evaluations.
 * Uses gemini-3.5-flash for evaluation.
 */
export async function runPcgChatPipeline(
  convIdentifier: string | number | { customer_phone: string; waba_number?: string; transcript?: any[];[key: string]: any }
): Promise<any> {
  let conv: any = null;
  if (typeof convIdentifier === 'object' && convIdentifier.transcript) {
    conv = convIdentifier;
  } else if (typeof convIdentifier === 'number' || (typeof convIdentifier === 'string' && /^\d+$/.test(convIdentifier) && convIdentifier.length < 10)) {
    const rows = await query<any>('SELECT * FROM pcg_conversations WHERE id = $1', [convIdentifier]);
    conv = rows[0];
  } else if (typeof convIdentifier === 'string') {
    const rows = await query<any>('SELECT * FROM pcg_conversations WHERE customer_phone = $1 ORDER BY updated_at DESC LIMIT 1', [convIdentifier]);
    conv = rows[0];
  } else if (typeof convIdentifier === 'object' && convIdentifier.customer_phone) {
    const rows = await query<any>('SELECT * FROM pcg_conversations WHERE customer_phone = $1 ORDER BY updated_at DESC LIMIT 1', [convIdentifier.customer_phone]);
    conv = rows[0];
  }

  if (!conv) {
    throw new Error(`Conversation not found for identifier: ${JSON.stringify(convIdentifier)}`);
  }

  const evalRes = await evaluatePcgChatConversation(conv);

  // Compute First Response Time (FRT)
  const turns = Array.isArray(conv.transcript) ? conv.transcript : [];
  let frtSeconds: number | null = null;
  const firstCust = turns.find((t: any) => t.speaker === 'Customer' || t.direction === 'inbound');
  const firstRmAfter = firstCust
    ? turns.find((t: any) => (t.speaker === 'RM' || t.direction === 'outbound') && new Date(t.timestamp) > new Date(firstCust.timestamp))
    : null;
  if (firstCust && firstRmAfter) {
    const diff = (new Date(firstRmAfter.timestamp).getTime() - new Date(firstCust.timestamp).getTime()) / 1000;
    if (diff > 0 && diff < 86400 * 7) frtSeconds = Math.round(diff);
  }

  const closedAt = conv.closed_at || conv.last_message_at || new Date().toISOString();

  const insertRes = await query<any>(`
    INSERT INTO pcg_chat_evaluations (
      conversation_id, customer_phone, waba_number, customer_name, rm_name, tl_name,
      iqs_score, process_score, communication_score, customer_service_score, applicable_weight,
      verdict, is_evaluable, exclusion_reason, summary, parameters, compliance_flags,
      compliance_tripwire, compliance_reason, ai_coaching_tip,
      total_messages, first_response_time_seconds, transcript_turns, chat_closed_at,
      model_version, scored_at, updated_at,
      is_am, preceding_rm_name
    ) VALUES (
      $1, $2, $3, $4, $5, $6,
      $7, $8, $9, $10, $11,
      $12, $13, $14, $15, $16, $17,
      $18, $19, $20,
      $21, $22, $23, $24,
      'gemini-3.5-flash', NOW(), NOW(),
      $25, $26
    )
    RETURNING *;
  `, [
    conv.id || null,
    conv.customer_phone,
    conv.waba_number || '918045681600',
    conv.customer_name || 'Client',
    evalRes.rmName,
    evalRes.tlName,
    evalRes.iqsScore,
    evalRes.processScore,
    evalRes.communicationScore,
    evalRes.customerServiceScore,
    evalRes.applicableWeight,
    evalRes.verdict,
    evalRes.isEvaluable,
    evalRes.exclusionReason,
    evalRes.summary || null,
    JSON.stringify(evalRes.parameters),
    JSON.stringify(evalRes.complianceFlags),
    evalRes.complianceTripwire,
    evalRes.complianceReason,
    evalRes.aiCoachingTip,
    turns.length,
    frtSeconds,
    JSON.stringify(turns),
    closedAt,
    Boolean(evalRes.isAm || conv.is_am),
    evalRes.precedingRmName || conv.preceding_rm_name || null,
  ]);

  if (conv.id) {
    try {
      await query(`
        UPDATE pcg_conversations
        SET summary = COALESCE($1, summary),
            is_am = $2
        WHERE id = $3
      `, [evalRes.summary || null, Boolean(evalRes.isAm || conv.is_am), conv.id]);
    } catch (e) {
      console.warn('[pcg-chat-pipeline] Failed to update pcg_conversations:', e);
    }
  }

  return insertRes[0];
}

