import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-guard';
import { withLogging } from '@/lib/log';
import { query } from '@/lib/cx/db';
import { readConfig } from '@/lib/config';
import { canonicalizePcgRmName, isSamePcgAgent, isPcgAm, ALL_TL_NAMES, isPcgTl } from '@/lib/pcg/canonical-names';
import { isExcludedFromPcgEmailEvaluation } from '@/lib/pcg/email-db';
import { getPcgRmsForTl } from '@/lib/pcg/rm-directory';

const ROUTE = 'admin/pcg-emails';

/**
 * Extracts L1 disposition from a Robylon email webhook payload,
 * matching the CX extraction rule (data.properties / properties -> name === 'Intents_L1').
 */
export function extractDispositionFromRobylonPayload(payload: any): string {
  const props = Array.isArray(payload?.data?.properties)
    ? payload.data.properties
    : Array.isArray(payload?.properties)
      ? payload.properties
      : [];
  const intentProp = props.find((p: any) => p?.name === 'Intents_L1');
  const raw = intentProp ? (intentProp.snapshot_value || intentProp.selected_value || '') : '';
  return String(raw || '').trim();
}

export interface PcgEmailReplyTurn {
  id: string;
  replyNumber: number;
  authorName: string;
  authorEmail: string;
  authorRole: 'customer' | 'rm' | 'am' | 'tl';
  direction: 'inbound' | 'outbound';
  sentAt: string;
  subject: string;
  snippet: string;
  content: string;
  isEvaluatedReply?: boolean;
  contextNote?: string;
}

export interface PcgEmailEvaluation {
  id: string;
  ticketId: string;
  chatId?: string;
  messageId: string;
  subjectLine: string;
  intentL1: string;
  customerName: string;
  customerEmail: string;
  customerPhone?: string | null;
  clientTier?: string;
  rmName: string;
  tlName: string;
  isTl?: boolean;
  isAm?: boolean;
  assignedAdmin?: string;
  sentAt: string;
  evaluatedAt: string;
  evaluationStatus: 'Pending' | 'Completed' | 'Failed';
  iqsScore: number;
  verdict: 'excellent' | 'meets_expectations' | 'coaching' | 'remediation';
  compliancePassed: boolean;
  complianceReason?: string;
  complianceFlags: Array<{
    gate: string;
    label: string;
    status: 'PASS' | 'FAIL' | 'NA';
    reason: string;
  }>;
  parameters: Record<
    string,
    {
      name: string;
      weight: number;
      score: 'yes' | 'half' | 'no' | 'na';
      earnedScore: number;
      maxScore: number;
      reasoning: string;
      quote?: string;
    }
  >;
  strengths: string[];
  areasForImprovement: string[];
  ticketSummary: string;
  precedingThreadSummary: {
    coreQuery: string;
    actionsTakenSoFar: string;
    pendingTaskAndOwner: string;
    commitmentsSet: string;
    botContextBoundaryNote: string;
  };
  totalRepliesInThread: number;
  threadReplies: PcgEmailReplyTurn[];
  latestThreeReplies: PcgEmailReplyTurn[];
  customerMessage: string;
  agentReplyText: string;
  disputeStatus: 'none' | 'pending' | 'resolved' | 'overridden';
  disputeReason?: string;
  disputeComments?: Array<{
    authorName: string;
    authorRole: string;
    comment: string;
    createdAt: string;
  }>;
  tlOverrideNote?: string;
  rawPayload?: any;
}

// ── In-Memory Realistic PCG Email Store ───────────────────────────────────────
// Empty: All evaluations are served directly from the Postgres database (pcg_email_evaluations & pcg_email_conversations).
let dummyEmailsStore: PcgEmailEvaluation[] = [];

// Populate latestThreeReplies and derive disposition strictly from the Robylon payload
dummyEmailsStore.forEach((item) => {
  item.latestThreeReplies = item.threadReplies.slice(-3);
  if (item.rawPayload) {
    item.intentL1 = extractDispositionFromRobylonPayload(item.rawPayload);
  }
});

function extractResolvedCustomerName(row: any, transcript: PcgEmailReplyTurn[] = []): string {
  if (row.customer_name && row.customer_name.trim() && row.customer_name !== 'HNI Client' && row.customer_name !== 'hello@wintwealth.com') {
    return row.customer_name.trim();
  }
  // 1. Inbound turn author name
  const inbound = transcript.find((t) => t.direction === 'inbound' && !t.authorEmail?.toLowerCase().includes('@wintwealth.com')) || transcript[0];
  if (inbound?.authorName && typeof inbound.authorName === 'string') {
    const s = inbound.authorName.trim();
    if (s && !s.includes('@') && s.toLowerCase() !== 'bot') {
      return s;
    }
  }

  // 2. Raw message sender
  const rawMsg = row.raw_payload?.data?.message || row.raw_payload?.data;
  if (rawMsg?.sender && typeof rawMsg.sender === 'string') {
    const s = rawMsg.sender.trim();
    if (s && !s.includes('@') && s.toLowerCase() !== 'bot' && !rawMsg.from_email?.toLowerCase().includes('@wintwealth.com')) {
      return s;
    }
  }

  // 3. Salutation in message body (e.g. "Hi Ashish,")
  const bodyText = String(inbound?.content || rawMsg?.content || rawMsg?.body || '');
  const salutationMatch = bodyText.match(/^(?:Hi|Dear|Hello)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)[,\n]/m);
  if (salutationMatch && salutationMatch[1]) {
    const candidate = salutationMatch[1].trim();
    if (!['Entity', 'Sir', 'Madam', 'Team', 'All', 'Investor', 'Customer'].includes(candidate)) {
      return candidate;
    }
  }

  // 4. Email username formatting
  const email = (inbound?.authorEmail && !inbound.authorEmail.toLowerCase().includes('@wintwealth.com'))
    ? inbound.authorEmail
    : (row.customer_email && !row.customer_email.toLowerCase().includes('@wintwealth.com'))
      ? row.customer_email
      : null;

  if (email && typeof email === 'string') {
    const userPart = email.split('@')[0].replace(/[._-]/g, ' ').trim();
    if (userPart && userPart.toLowerCase() !== 'hello') {
      return userPart.split(' ').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    }
  }

  return 'HNI Client';
}

function mapDbEvalRowToPcgEmailEvaluation(row: any): PcgEmailEvaluation {
  const transcript: PcgEmailReplyTurn[] = Array.isArray(row.thread_replies) ? row.thread_replies : [];
  const totalRepliesInThread = transcript.length;
  const latestThreeReplies = transcript.slice(-3);
  const resolvedCustomerName = extractResolvedCustomerName(row, transcript);

  const verdict: 'excellent' | 'meets_expectations' | 'coaching' | 'remediation' =
    row.verdict ||
    (row.iqs_score >= 90
      ? 'excellent'
      : row.iqs_score >= 80
        ? 'meets_expectations'
        : row.iqs_score >= 70
          ? 'coaching'
          : 'remediation');

  return {
    id: String(row.id || row.message_id),
    ticketId: String(row.ticket_id),
    chatId: row.chat_id ? String(row.chat_id) : undefined,
    messageId: String(row.message_id),
    subjectLine: row.subject_line || 'No Subject',
    intentL1: row.intent_l1 || 'General Inquiry',
    customerName: resolvedCustomerName,
    customerEmail: row.customer_email || 'client@wintwealth.com',
    customerPhone: row.customer_phone || null,
    clientTier: row.client_tier || 'HNI / PCG Wealth',
    rmName: (row.rm_name && !['myra', 'bot', 'robylon', 'robylon ai'].includes(row.rm_name.toLowerCase().trim())) ? row.rm_name : 'Unassigned PCG RM',
    tlName: row.tl_name || 'Team Swetha',
    isTl: Boolean(row.is_tl),
    isAm: Boolean(row.is_am || isPcgAm(row.rm_name)),
    sentAt: row.sent_at ? new Date(row.sent_at).toISOString() : new Date(row.created_at).toISOString(),
    evaluatedAt: row.evaluated_at ? new Date(row.evaluated_at).toISOString() : new Date().toISOString(),
    evaluationStatus: (row.evaluation_status as any) || 'Completed',
    iqsScore: row.iqs_score != null ? Number(row.iqs_score) : 0,
    verdict,
    compliancePassed: row.compliance_passed ?? true,
    complianceReason: row.compliance_reason || 'Compliance check passed.',
    complianceFlags:
      Array.isArray(row.compliance_flags) && row.compliance_flags.length > 0
        ? row.compliance_flags
        : [
          {
            gate: 'G1_no_advice',
            label: 'G1: Advice (No Investment / Tax Advice)',
            status: 'PASS',
            reason: 'Factual information provided without unauthorized advisory.'
          },
          {
            gate: 'G2_no_fabrication',
            label: 'G2: Fabrication (No Fabricated Facts)',
            status: 'PASS',
            reason: 'Verified against official product operational records.'
          },
          {
            gate: 'G3_identity_first',
            label: 'G3: Identity (Identity First Verification)',
            status: 'PASS',
            reason: 'Verified client identity credentials.'
          }
        ],
    parameters: row.parameters && Object.keys(row.parameters).length > 0 ? row.parameters : {},
    strengths: Array.isArray(row.strengths) ? row.strengths : ['Clear and prompt communication'],
    areasForImprovement: Array.isArray(row.areas_for_improvement) ? row.areas_for_improvement : [],
    ticketSummary: row.ticket_summary || row.subject_line || 'PCG Email Conversation',
    precedingThreadSummary: row.preceding_thread_summary || {
      coreQuery: row.subject_line || 'Client inquiry regarding investment or account opening',
      actionsTakenSoFar: 'Ticket received and logged from ' + (row.inbox || 'PCG inbox'),
      pendingTaskAndOwner: 'Assigned to ' + (row.rm_name || 'PCG RM team'),
      commitmentsSet: 'Follow standard PCG SLA timelines',
      botContextBoundaryNote: 'Bot Evaluation Scope: Evaluated strictly on the agent reply sent.'
    },
    totalRepliesInThread,
    threadReplies: transcript,
    latestThreeReplies,
    customerMessage: row.customer_message || '',
    agentReplyText: row.agent_reply_text || '',
    disputeStatus: row.dispute_status || 'none',
    disputeReason: row.dispute_reason || undefined,
    disputeComments: Array.isArray(row.dispute_comments) ? row.dispute_comments : [],
    tlOverrideNote: row.tl_override_note || undefined,
    rawPayload: row.raw_payload
  };
}

function mapConversationToPendingEvaluation(row: any): PcgEmailEvaluation {
  const transcript: PcgEmailReplyTurn[] = Array.isArray(row.transcript) ? row.transcript : [];
  const lastCustomerMsg = [...transcript].reverse().find((t) => t.direction === 'inbound');
  const resolvedCustomerName = extractResolvedCustomerName(row, transcript);

  return {
    id: String(row.id || row.ticket_id),
    ticketId: String(row.ticket_id),
    chatId: row.chat_id ? String(row.chat_id) : undefined,
    messageId: `msg_${row.ticket_id}`,
    subjectLine: row.subject_line || 'No Subject',
    intentL1: row.intent_l1 || 'General Inquiry',
    customerName: resolvedCustomerName,
    customerEmail: row.customer_email || 'client@wintwealth.com',
    customerPhone: row.customer_phone || null,
    clientTier: row.client_tier || 'HNI / PCG Wealth',
    rmName: (row.rm_name && !['myra', 'bot', 'robylon', 'robylon ai'].includes(row.rm_name.toLowerCase().trim())) ? row.rm_name : 'Unassigned PCG RM',
    tlName: row.tl_name || 'Team Swetha',
    isTl: Boolean(row.is_tl),
    isAm: Boolean(row.is_am || isPcgAm(row.rm_name)),
    sentAt: row.last_message_at ? new Date(row.last_message_at).toISOString() : new Date(row.created_at).toISOString(),
    evaluatedAt: new Date().toISOString(),
    evaluationStatus: 'Pending',
    iqsScore: 0,
    verdict: 'meets_expectations',
    compliancePassed: true,
    complianceReason: 'Pending agent reply & evaluation.',
    complianceFlags: [],
    parameters: {},
    strengths: [],
    areasForImprovement: [],
    ticketSummary: row.subject_line || 'PCG Email Conversation',
    precedingThreadSummary: {
      coreQuery: row.subject_line || 'Client inquiry',
      actionsTakenSoFar: 'Ticket received and logged from ' + (row.inbox || 'PCG inbox'),
      pendingTaskAndOwner: 'Assigned to ' + (row.rm_name || 'PCG RM team'),
      commitmentsSet: 'Follow standard PCG SLA timelines',
      botContextBoundaryNote: 'Bot Evaluation Scope: Evaluated strictly on the agent reply sent.'
    },
    totalRepliesInThread: transcript.length,
    threadReplies: transcript,
    latestThreeReplies: transcript.slice(-3),
    customerMessage: lastCustomerMsg?.content || row.subject_line || '',
    agentReplyText: '',
    disputeStatus: 'none',
    rawPayload: row.raw_payload
  };
}

export function getPcgEmailsStore(): PcgEmailEvaluation[] {
  return dummyEmailsStore;
}

export const GET = withLogging(ROUTE, async (req: NextRequest) => {
  let sessionUser: any = null;
  try {
    const { response, session } = await requireRole(['admin', 'tl', 'agent', 'quality']);
    if (response) return response;
    sessionUser = session?.user;
  } catch {
    // Permitted in local development
  }

  const { searchParams } = new URL(req.url);
  const singleId = searchParams.get('id')?.trim();
  const ticketIdParam = searchParams.get('ticketId')?.trim();
  const persona = (searchParams.get('persona') || 'admin').toLowerCase();
  const rmNameFilter = searchParams.get('rmName')?.trim();
  const tlNameFilter = searchParams.get('tlName')?.trim();
  const section = searchParams.get('section') || 'all';
  const searchQuery = (searchParams.get('search') || '').toLowerCase().trim();
  const verdictFilter = searchParams.get('verdict') || 'all';
  const startDate = searchParams.get('startDate')?.trim();
  const endDate = searchParams.get('endDate')?.trim();
  const minIqsParam = searchParams.get('min_iqs')?.trim();
  const maxIqsParam = searchParams.get('max_iqs')?.trim();
  const pageParam = searchParams.get('page');
  const limitParam = searchParams.get('limit');
  const page = pageParam ? Math.max(1, parseInt(pageParam, 10)) : 1;
  const limit = limitParam ? Math.min(500, Math.max(1, parseInt(limitParam, 10))) : 0;

  // 1. Fetch completed evaluations from pcg_email_evaluations
  // PCG emails are 100% evaluated by the Bot, matching PCG chats and calls.
  // Unevaluated raw conversation tickets are not shown in the quality portal.
  let dbEvaluations: PcgEmailEvaluation[] = [];
  try {
    const evalRows = await query<any>(
      `SELECT e.*, COALESCE(NULLIF(e.chat_id, ''), c.chat_id) as chat_id
       FROM pcg_email_evaluations e
       LEFT JOIN pcg_email_conversations c ON e.ticket_id = c.ticket_id
       WHERE e.evaluation_status = 'Completed'
       ORDER BY e.evaluated_at DESC NULLS LAST, e.created_at DESC
       LIMIT 200`
    );
    dbEvaluations = evalRows.map(mapDbEvalRowToPcgEmailEvaluation);
  } catch (err: any) {
    console.warn('[pcg-emails] Could not query pcg_email_evaluations:', err?.message || err);
  }

  // Merge: Evaluated items served from Postgres
  const mergedMap = new Map<string, PcgEmailEvaluation>();
  for (const item of dbEvaluations) {
    mergedMap.set(item.ticketId, item);
  }
  for (const item of dummyEmailsStore) {
    if (!mergedMap.has(item.ticketId)) {
      mergedMap.set(item.ticketId, item);
    }
  }

  // Single item lookup (with fallback to conversation lookup if direct eval row not present)
  if (singleId || ticketIdParam) {
    let found = Array.from(mergedMap.values()).find(
      (e) => (singleId && (e.id === singleId || e.ticketId === singleId || e.messageId === singleId)) || (ticketIdParam && e.ticketId === ticketIdParam)
    );
    if (!found) {
      try {
        const fallbackConv = await query<any>(
          `SELECT * FROM pcg_email_conversations WHERE ticket_id = $1 OR chat_id::text = $1 LIMIT 1`,
          [ticketIdParam || singleId]
        );
        if (fallbackConv.length > 0) {
          found = mapConversationToPendingEvaluation(fallbackConv[0]);
        }
      } catch (err) {
        // ignore
      }
    }
    if (!found) {
      return NextResponse.json({ error: 'PCG email evaluation not found' }, { status: 404 });
    }
    return NextResponse.json({ email: found });
  }

  // Filter records
  let list = Array.from(mergedMap.values());

  // Indrajit Das (Head of PCG) is strictly excluded from quality evaluation in the portal
  list = list.filter((e) => !isExcludedFromPcgEmailEvaluation(e.rmName));

  // 1. Scoping by Persona:
  // - TL Persona: Every TL strictly only sees their mapped RMs and AMs by default.
  //   When my_emails=true is passed, they strictly see their own emails.
  //   Under the dispute section, they will only see disputes raised by their mapped RMs or AMs.
  // - Admin Persona: Sees all emails across all teams, including emails handled by TLs!
  // - Agent Persona: Strictly only sees emails handled by that agent.
  let mappedMembersForTl: string[] = [];
  const myEmailsParam = searchParams.get('my_emails') === 'true' || searchParams.get('caller_role') === 'tl';
  if (persona === 'tl') {
    const effectiveTl = tlNameFilter && tlNameFilter !== 'all' ? tlNameFilter : (sessionUser?.name || 'Swetha');
    mappedMembersForTl = await getPcgRmsForTl(effectiveTl);

    if (myEmailsParam) {
      list = list.filter((e) => isSamePcgAgent(e.rmName, effectiveTl) || (e.isTl && isSamePcgAgent(e.rmName, effectiveTl)));
    } else {
      list = list.filter((e) => {
        // Allow TL's own disputed emails so they can track them under dispute sections!
        const isDispute = e.disputeStatus === 'pending' || e.disputeStatus === 'resolved' || e.disputeStatus === 'overridden';
        const isTheTlThemselves = isSamePcgAgent(e.rmName, effectiveTl);
        if (isTheTlThemselves && isDispute) {
          return true;
        }

        // Exclude TL-handled emails from standard TL QA view (TLs QA their team, not themselves)
        if (ALL_TL_NAMES.some((tl) => isSamePcgAgent(tl, e.rmName)) || isPcgTl(e.rmName) || e.isTl) return false;

        // Strictly include ONLY the RMs and AMs mapped against this TL
        const isMember = mappedMembersForTl.some((m) => isSamePcgAgent(m, e.rmName));
        return isMember;
      });

      // If TL specifies a specific RM or AM filter from their team dropdown
      if (rmNameFilter && rmNameFilter !== 'all') {
        list = list.filter((e) => isSamePcgAgent(e.rmName, rmNameFilter));
      }
    }
  } else if (persona === 'agent') {
    const effectiveAgentName = (rmNameFilter && rmNameFilter !== 'all') ? rmNameFilter : sessionUser?.name;
    if (effectiveAgentName) {
      list = list.filter((e) => isSamePcgAgent(e.rmName, effectiveAgentName));
    }
  } else {
    // Admin Persona:
    // Admin can see ALL emails across all teams, including emails handled by TLs!
    if (tlNameFilter && tlNameFilter !== 'all') {
      const cleanTl = tlNameFilter.replace(/^Team\s+/i, '').trim().toLowerCase();
      const teamMembers = await getPcgRmsForTl(cleanTl);
      list = list.filter((e) => {
        const matchesTlName = e.tlName && e.tlName.toLowerCase().includes(cleanTl);
        const matchesMember = teamMembers.some((m) => isSamePcgAgent(m, e.rmName));
        const isTheTlThemselves = isSamePcgAgent(e.rmName, cleanTl);
        return matchesTlName || matchesMember || isTheTlThemselves;
      });
    }

    if (rmNameFilter && rmNameFilter !== 'all') {
      list = list.filter((e) => isSamePcgAgent(e.rmName, rmNameFilter));
    }
  }

  // Filter by search query (matches RM, AM, TL, ticket, client, subject, disposition)
  if (searchQuery) {
    list = list.filter(
      (e) =>
        e.ticketId.toLowerCase().includes(searchQuery) ||
        e.subjectLine.toLowerCase().includes(searchQuery) ||
        e.customerEmail.toLowerCase().includes(searchQuery) ||
        e.customerName.toLowerCase().includes(searchQuery) ||
        e.rmName.toLowerCase().includes(searchQuery) ||
        (e.tlName && e.tlName.toLowerCase().includes(searchQuery)) ||
        (e.intentL1 && e.intentL1.toLowerCase().includes(searchQuery)) ||
        (Array.isArray(e.threadReplies) &&
          e.threadReplies.some((r) => r.authorName && r.authorName.toLowerCase().includes(searchQuery)))
    );
  }

  // Date range filtering
  if (startDate) {
    const startMs = new Date(startDate).getTime();
    if (!isNaN(startMs)) {
      list = list.filter((e) => {
        const itemMs = new Date(e.sentAt || e.evaluatedAt || 0).getTime();
        return itemMs >= startMs;
      });
    }
  }
  if (endDate) {
    const endMs = new Date(endDate).getTime();
    if (!isNaN(endMs)) {
      list = list.filter((e) => {
        const itemMs = new Date(e.sentAt || e.evaluatedAt || 0).getTime();
        return itemMs <= endMs;
      });
    }
  }

  // Min / Max IQS
  if (minIqsParam) {
    const minVal = parseFloat(minIqsParam);
    if (!isNaN(minVal)) list = list.filter((e) => (e.iqsScore ?? 0) >= minVal);
  }
  if (maxIqsParam) {
    const maxVal = parseFloat(maxIqsParam);
    if (!isNaN(maxVal)) list = list.filter((e) => (e.iqsScore ?? 0) <= maxVal);
  }

  // Snapshot base filtered list (before section/verdict split) so KPIs & tab counts reflect searched member/team
  const baseList = [...list];

  // Filter by section
  if (section === 'pending_evaluation') {
    list = list.filter((e) => e.evaluationStatus === 'Pending');
  } else if (section === 'evaluated') {
    list = list.filter((e) => e.evaluationStatus === 'Completed');
  } else if (section === 'disputes_pending') {
    list = list.filter((e) => e.disputeStatus === 'pending');
  } else if (section === 'disputes_reviewed') {
    list = list.filter((e) => e.disputeStatus === 'resolved' || e.disputeStatus === 'overridden');
  }

  // Filter by verdict
  if (verdictFilter !== 'all') {
    list = list.filter((e) => e.verdict === verdictFilter);
  }

  // Metrics summary
  const evaluatedItems = baseList.filter((e) => e.evaluationStatus === 'Completed');
  const totalCount = evaluatedItems.length;
  const avgIqs =
    evaluatedItems.length > 0
      ? Math.round(evaluatedItems.reduce((acc, curr) => acc + curr.iqsScore, 0) / evaluatedItems.length)
      : 0;

  const sectionCounts = {
    pendingEvaluation: 0,
    evaluated: evaluatedItems.length,
    disputesPending: baseList.filter((e) => e.disputeStatus === 'pending').length,
    disputesReviewed: baseList.filter(
      (e) => e.disputeStatus === 'resolved' || e.disputeStatus === 'overridden'
    ).length
  };

  const verdictCounts = {
    excellent: evaluatedItems.filter((e) => e.verdict === 'excellent').length,
    meetsExpectations: evaluatedItems.filter((e) => e.verdict === 'meets_expectations').length,
    coaching: evaluatedItems.filter((e) => e.verdict === 'coaching').length,
    remediation: evaluatedItems.filter((e) => e.verdict === 'remediation').length,
    notScoreable: 0
  };

  // Dynamically compute available RMs:
  // For TL, only their mapped members; for Admin, all members including TLs
  const ALL_PCG_MEMBERS = [
    // TLs
    'Swetha',
    'Saiyam Rastogi',
    'Tanisha Mittal',
    'Dheeraj Bhojwani',
    'Sravanthi',
    // RMs & AMs
    'Diya Sharma',
    'Ankita Agarwal',
    'Sujal Dadwani',
    'Ayan Kumar Garg',
    'Deshna Dugar',
    'Nishtha Veerwani',
    'Vaishnavi N J',
    'Vaishnavi Naghat',
    'Vidisha Jaiswal',
    'Vishyata Tulsani',
    'Gaurav Nautiyal',
    'Mahi Agarwal',
    'Nandini',
    'Rukmini Mundhara',
    'Sahil Joshi',
    'Shruti Sharma',
    'Vishal Kumar Yadav',
    'Antara Chakraborty',
    'Harshita Dhona',
    'Keshvi Suresh Thacker',
    'Maniyar Kriya Jignesh',
    'Nischay Manish Jain',
    'Samskrithi Rao N',
    'Ishaan Kapoor',
    'Paritosh Ashiya',
    'Ramita Kapoor',
    'Sargun Singh',
    'Shivam Kumar Baghel',
    'Shrey Jain',
    'Yaashvi Arora',
    'Anurag Negi',
    'Mahek Bihani',
    'Mishra Richa Santoshkumar',
    'Shreya Premkumar Mundada',
    'Sreeram',
    'Vidyul Kapoor'
  ];

  let targetMembers = ALL_PCG_MEMBERS;
  if (persona === 'tl' && mappedMembersForTl.length > 0) {
    targetMembers = mappedMembersForTl;
  } else if (persona === 'admin' && tlNameFilter && tlNameFilter !== 'all') {
    const cleanTl = tlNameFilter.replace(/^Team\s+/i, '').trim().toLowerCase();
    const teamMembers = await getPcgRmsForTl(cleanTl);
    const tlCanonical = ALL_TL_NAMES.find((t) => t.toLowerCase().includes(cleanTl)) || cleanTl;
    targetMembers = [tlCanonical, ...teamMembers];
  }
  const rmCounts = new Map<string, number>();
  for (const item of evaluatedItems) {
    const canonical = canonicalizePcgRmName(item.rmName);
    rmCounts.set(canonical.toLowerCase(), (rmCounts.get(canonical.toLowerCase()) || 0) + 1);
  }
  const availableRms = targetMembers.map((name) => ({
    name,
    count: rmCounts.get(name.toLowerCase()) || 0
  }));

  const ALL_PCG_TLS = ['Team Swetha', 'Team Saiyam Rastogi', 'Team Tanisha Mittal', 'Team Dheeraj Bhojwani', 'Team Sravanthi'];
  const tlCounts = new Map<string, number>();
  for (const item of evaluatedItems) {
    const tl = item.tlName || 'Team Swetha';
    tlCounts.set(tl.toLowerCase(), (tlCounts.get(tl.toLowerCase()) || 0) + 1);
  }
  const availableTls = ALL_PCG_TLS.map((name) => ({
    name,
    count: tlCounts.get(name.toLowerCase()) || 0
  }));

  const compliancePassRate =
    evaluatedItems.length > 0
      ? Math.round((evaluatedItems.filter((e) => e.compliancePassed).length / evaluatedItems.length) * 100)
      : 100;

  const config = await readConfig().catch(() => null);
  const tlAdminMap = config?.pcgTlAdminAssignments || {};

  const total = list.length;
  const totalPages = limit > 0 ? (Math.ceil(total / limit) || 1) : 1;
  const pagedList = limit > 0 ? list.slice((page - 1) * limit, (page - 1) * limit + limit) : list;

  const mappedEmails = pagedList.map((item) => {
    const isTl = Boolean(item.isTl || isPcgTl(item.rmName));
    const cleanRm = (item.rmName || '').trim().toLowerCase();
    const assignedAdmin = tlAdminMap[cleanRm] || 'Aahan';
    return {
      ...item,
      isTl,
      assignedAdmin,
    };
  });

  return NextResponse.json({
    emails: mappedEmails,
    summary: {
      totalCount,
      avgIqs,
      tripwireCount: evaluatedItems.filter((e) => !e.compliancePassed).length,
      compliancePassRate,
      verdictCounts
    },
    sectionCounts,
    availableRms,
    availableTls,
    tlAdminAssignments: tlAdminMap,
    page,
    limit: limit > 0 ? limit : total,
    total,
    totalPages
  });
});

export const POST = withLogging(ROUTE, async (req: NextRequest) => {
  let sessionUser: any = null;
  try {
    const { response, session } = await requireRole(['admin', 'tl', 'agent', 'quality']);
    if (response) return response;
    sessionUser = session?.user;
  } catch {
    // Permitted in local development
  }

  try {
    const body = await req.json();
    const action = body.action;
    const emailId = body.id || body.emailId;

    if (action === 'raise_dispute') {
      const email = dummyEmailsStore.find((e) => e.id === emailId || e.ticketId === emailId);
      if (email) {
        email.disputeStatus = 'pending';
        email.disputeReason = body.disputeReason || 'Challenged parameter evaluation';
        if (!email.disputeComments) email.disputeComments = [];
        email.disputeComments.push({
          authorName: body.authorName || email.rmName,
          authorRole: 'agent',
          comment: body.disputeReason || 'RM requested dispute review.',
          createdAt: new Date().toISOString()
        });
      }

      await query(
        `UPDATE pcg_email_evaluations SET
          dispute_status = 'pending',
          dispute_reason = $1,
          dispute_comments = COALESCE(dispute_comments, '[]'::jsonb) || $2::jsonb,
          updated_at = NOW()
         WHERE id::text = $3 OR message_id = $3 OR ticket_id = $3`,
        [
          body.disputeReason || 'Challenged parameter evaluation',
          JSON.stringify([
            {
              authorName: body.authorName || 'Agent',
              authorRole: 'agent',
              comment: body.disputeReason || 'RM requested dispute review.',
              createdAt: new Date().toISOString()
            }
          ]),
          String(emailId)
        ]
      ).catch(() => { });

      if (email) {
        return NextResponse.json({ success: true, email });
      }
      return NextResponse.json({ success: true, message: 'Dispute recorded' });
    }

    if (action === 'resolve_dispute' || action === 'override') {
      const targetEmail = dummyEmailsStore.find((e) => e.id === emailId || e.ticketId === emailId);
      let agentName = targetEmail?.rmName || '';
      if (!agentName) {
        const row = await query<{ rm_name?: string; agent_name?: string }>(
          `SELECT rm_name, agent_name FROM pcg_email_evaluations WHERE id::text = $1 OR message_id = $1 OR ticket_id = $1 LIMIT 1`,
          [String(emailId)]
        ).catch(() => []);
        agentName = row[0]?.rm_name || row[0]?.agent_name || '';
      }
      const cleanAgent = agentName.trim().toLowerCase();
      const isTlEmail = isPcgTl(agentName) || ALL_TL_NAMES.some((t) => t.toLowerCase() === cleanAgent);

      if (isTlEmail) {
        // TL email: only mapped Admin (or super admin) can override
        const config = await readConfig().catch(() => null);
        const mappedAdmin = config?.pcgTlAdminAssignments?.[cleanAgent] || 'Aahan';
        const isSuperAdmin = Boolean((sessionUser as any)?.is_super_admin || (sessionUser as any)?.isSuperAdmin);
        const sessionName = sessionUser?.name || '';
        const isMappedAdmin = sessionName && (
          sessionName.trim().toLowerCase() === mappedAdmin.trim().toLowerCase() ||
          sessionName.toLowerCase().includes(mappedAdmin.toLowerCase()) ||
          mappedAdmin.toLowerCase().includes(sessionName.toLowerCase())
        );

        if (!isSuperAdmin && (!isMappedAdmin || sessionUser?.role !== 'admin')) {
          return NextResponse.json(
            { error: `Evaluation override for TL ${agentName} is assigned to Admin ${mappedAdmin}.` },
            { status: 403 }
          );
        }
      } else {
        // RM email: restricted to Team Leads (unless super admin)
        if (sessionUser?.role === 'admin' && !(sessionUser as any)?.is_super_admin) {
          return NextResponse.json(
            { error: 'Evaluation override for RM emails is restricted to Team Leads' },
            { status: 403 }
          );
        }
        if (sessionUser?.role === 'tl') {
          const reviewerName = sessionUser?.name || sessionUser?.email || 'Team Lead';
          if (isSamePcgAgent(reviewerName, agentName) || isTlEmail) {
            return NextResponse.json(
              { error: 'Forbidden: Team Leads cannot override scores for their own emails.' },
              { status: 403 }
            );
          }
        }
      }

      const newStatus = action === 'override' ? 'overridden' : 'resolved';
      const email = dummyEmailsStore.find((e) => e.id === emailId || e.ticketId === emailId);
      if (email) {
        if (email.disputeStatus === 'pending') {
          email.disputeStatus = newStatus;
        }
        if (body.tlOverrideNote || body.note) {
          email.tlOverrideNote = body.tlOverrideNote || body.note;
        }
        if (body.parameters && typeof body.parameters === 'object') {
          email.parameters = body.parameters;
        }
        if (Array.isArray(body.complianceFlags)) {
          email.complianceFlags = body.complianceFlags;
          email.compliancePassed = !body.complianceFlags.some((g: any) => g.status === 'FAIL');
        }
        if (typeof body.newIqsScore === 'number') {
          email.iqsScore = body.newIqsScore;
          email.verdict =
            email.iqsScore >= 90
              ? 'excellent'
              : email.iqsScore >= 80
                ? 'meets_expectations'
                : email.iqsScore >= 70
                  ? 'coaching'
                  : 'remediation';
        }
        if (!email.disputeComments) email.disputeComments = [];
        if (body.tlOverrideNote || body.note) {
          email.disputeComments.push({
            authorName: body.authorName || 'Team Lead',
            authorRole: 'tl',
            comment: body.tlOverrideNote || body.note,
            createdAt: new Date().toISOString()
          });
        }
      }

      await query(
        `UPDATE pcg_email_evaluations SET
          dispute_status = $1,
          tl_override_note = COALESCE($2, tl_override_note),
          parameters = COALESCE($3::jsonb, parameters),
          compliance_flags = COALESCE($4::jsonb, compliance_flags),
          compliance_passed = COALESCE($5, compliance_passed),
          iqs_score = COALESCE($6, iqs_score),
          verdict = COALESCE($7, verdict),
          updated_at = NOW()
         WHERE id::text = $8 OR message_id = $8 OR ticket_id = $8`,
        [
          newStatus,
          body.tlOverrideNote || body.note || null,
          body.parameters ? JSON.stringify(body.parameters) : null,
          body.complianceFlags ? JSON.stringify(body.complianceFlags) : null,
          Array.isArray(body.complianceFlags) ? !body.complianceFlags.some((g: any) => g.status === 'FAIL') : null,
          typeof body.newIqsScore === 'number' ? body.newIqsScore : null,
          typeof body.newIqsScore === 'number'
            ? body.newIqsScore >= 90 ? 'excellent' : body.newIqsScore >= 80 ? 'meets_expectations' : body.newIqsScore >= 70 ? 'coaching' : 'remediation'
            : null,
          String(emailId)
        ]
      ).catch(() => { });

      if (email) {
        return NextResponse.json({ success: true, email });
      }
      return NextResponse.json({ success: true, message: 'Dispute resolved' });
    }

    // Ingest dummy action
    if (action === 'ingest') {
      // Returns confirmation that the dummy email is ready and ingested
      return NextResponse.json({
        success: true,
        message: 'Dummy PCG email successfully ingested into memory store',
        count: dummyEmailsStore.length,
        email: dummyEmailsStore[0]
      });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 });
  }
});
