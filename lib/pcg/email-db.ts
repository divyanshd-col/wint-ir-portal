/**
 * lib/pcg/email-db.ts
 *
 * Database persistence, table lifecycle, and ingestion pipeline for PCG Email Conversations
 * and PCG Email Evaluations.
 *
 * Architectural Separation:
 *  - `pcg_email_conversations`: Holds strictly conversation thread & ticket metadata (inbox, customer info,
 *    assigned RM/AM/TL, status, full transcript of replies). Does NOT store evaluation data.
 *  - `pcg_email_evaluations` (and view `pcg_email_evaluation`): Stores all quality evaluations, IQS scores,
 *    compliance flags, 7 evaluation parameters, coaching tips, disputes, and TL overrides.
 *  - `pcg_webhook_payloads`: Preserved forever (raw events).
 */

import { query } from '@/lib/cx/db';
import { emailInboxOf } from '@/lib/email/inbox';
import { canonicalizePcgRmName, isPcgAm } from '@/lib/pcg/canonical-names';

let tablesEnsured = false;
let rmDirectoryCache: Map<string, { tl_name: string; role: string }> | null = null;
let rmDirectoryCacheExpiry = 0;

async function getRmDirectoryMap(): Promise<Map<string, { tl_name: string; role: string }>> {
  const now = Date.now();
  if (rmDirectoryCache && now < rmDirectoryCacheExpiry) {
    return rmDirectoryCache;
  }
  try {
    const rows = await query<any>(`SELECT rm_name, tl_name, role FROM pcg_rm_directory`);
    const map = new Map<string, { tl_name: string; role: string }>();
    for (const r of rows) {
      if (r.rm_name) {
        map.set(r.rm_name.toLowerCase().trim(), { tl_name: r.tl_name, role: r.role });
      }
    }
    rmDirectoryCache = map;
    rmDirectoryCacheExpiry = now + 10 * 60 * 1000; // 10 min TTL
    return map;
  } catch {
    return rmDirectoryCache || new Map();
  }
}

/**
 * Ensures `pcg_email_conversations` and `pcg_email_evaluations` tables exist with correct schemas.
 */
export async function ensurePcgEmailTables(): Promise<void> {
  if (tablesEnsured) return;

  // 1. Ensure pcg_email_conversations (strictly conversation fields)
  await query(`
    CREATE TABLE IF NOT EXISTS pcg_email_conversations (
      id BIGSERIAL PRIMARY KEY,
      ticket_id VARCHAR(255) NOT NULL UNIQUE,
      chat_id VARCHAR(255),
      inbox VARCHAR(255),
      subject_line TEXT,
      customer_name VARCHAR(255),
      customer_email VARCHAR(255),
      customer_phone VARCHAR(50),
      client_tier VARCHAR(100) DEFAULT 'HNI / PCG Wealth',
      assigned_rm_id VARCHAR(255),
      rm_name VARCHAR(255),
      tl_name VARCHAR(255),
      is_tl BOOLEAN DEFAULT FALSE,
      is_am BOOLEAN DEFAULT FALSE,
      status VARCHAR(50) DEFAULT 'OPEN',
      intent_l1 VARCHAR(255),
      transcript JSONB DEFAULT '[]'::jsonb,
      thread_summary JSONB,
      total_messages INTEGER DEFAULT 0,
      first_response_at TIMESTAMPTZ,
      last_message_at TIMESTAMPTZ,
      last_message_text TEXT,
      last_direction VARCHAR(50),
      closed_at TIMESTAMPTZ,
      raw_payload JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Ensure any legacy evaluation columns are removed from pcg_email_conversations
    ALTER TABLE pcg_email_conversations
      DROP COLUMN IF EXISTS evaluation_status,
      DROP COLUMN IF EXISTS iqs_score,
      DROP COLUMN IF EXISTS verdict,
      DROP COLUMN IF EXISTS compliance_passed,
      DROP COLUMN IF EXISTS compliance_reason,
      DROP COLUMN IF EXISTS compliance_flags,
      DROP COLUMN IF EXISTS parameters,
      DROP COLUMN IF EXISTS ai_coaching_tip,
      DROP COLUMN IF EXISTS strengths,
      DROP COLUMN IF EXISTS areas_for_improvement,
      DROP COLUMN IF EXISTS evaluated_message_id,
      DROP COLUMN IF EXISTS evaluated_reply_text,
      DROP COLUMN IF EXISTS evaluated_at,
      DROP COLUMN IF EXISTS dispute_status,
      DROP COLUMN IF EXISTS dispute_reason,
      DROP COLUMN IF EXISTS dispute_comments,
      DROP COLUMN IF EXISTS tl_override_note;

    CREATE INDEX IF NOT EXISTS idx_pcg_email_conv_ticket_id ON pcg_email_conversations(ticket_id);
    CREATE INDEX IF NOT EXISTS idx_pcg_email_conv_chat_id ON pcg_email_conversations(chat_id);
    CREATE INDEX IF NOT EXISTS idx_pcg_email_conv_inbox ON pcg_email_conversations(inbox);
    CREATE INDEX IF NOT EXISTS idx_pcg_email_conv_rm_name ON pcg_email_conversations(rm_name);
    CREATE INDEX IF NOT EXISTS idx_pcg_email_conv_created_at ON pcg_email_conversations(created_at);
    CREATE INDEX IF NOT EXISTS idx_pcg_email_conv_last_msg_at ON pcg_email_conversations(last_message_at);
  `);

  // 2. Ensure pcg_email_evaluations table (stores all evaluations)
  await query(`
    CREATE TABLE IF NOT EXISTS pcg_email_evaluations (
      id BIGSERIAL PRIMARY KEY,
      conversation_id BIGINT REFERENCES pcg_email_conversations(id) ON DELETE SET NULL,
      ticket_id VARCHAR(255) NOT NULL,
      chat_id VARCHAR(255),
      message_id VARCHAR(255) NOT NULL UNIQUE,
      inbox VARCHAR(255),
      subject_line TEXT,
      customer_name VARCHAR(255),
      customer_email VARCHAR(255),
      customer_phone VARCHAR(50),
      client_tier VARCHAR(100) DEFAULT 'HNI / PCG Wealth',
      rm_name VARCHAR(255),
      tl_name VARCHAR(255),
      is_tl BOOLEAN DEFAULT FALSE,
      is_am BOOLEAN DEFAULT FALSE,
      sent_at TIMESTAMPTZ,
      evaluated_at TIMESTAMPTZ DEFAULT NOW(),
      evaluation_status VARCHAR(50) DEFAULT 'Pending',
      iqs_score NUMERIC,
      verdict VARCHAR(50),
      compliance_passed BOOLEAN,
      compliance_reason TEXT,
      compliance_flags JSONB,
      parameters JSONB,
      strengths JSONB,
      areas_for_improvement JSONB,
      ticket_summary TEXT,
      preceding_thread_summary JSONB,
      thread_replies JSONB,
      customer_message TEXT,
      agent_reply_text TEXT,
      dispute_status VARCHAR(50) DEFAULT 'none',
      dispute_reason TEXT,
      dispute_comments JSONB DEFAULT '[]'::jsonb,
      tl_override_note TEXT,
      qa_override_score NUMERIC,
      qa_notes TEXT,
      reviewed_by VARCHAR(255),
      reviewed_at TIMESTAMPTZ,
      raw_payload JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Ensure chat_id column exists
    ALTER TABLE pcg_email_evaluations ADD COLUMN IF NOT EXISTS chat_id VARCHAR(255);

    CREATE INDEX IF NOT EXISTS idx_pcg_email_eval_conv_id ON pcg_email_evaluations(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_pcg_email_eval_ticket_id ON pcg_email_evaluations(ticket_id);
    CREATE INDEX IF NOT EXISTS idx_pcg_email_eval_chat_id ON pcg_email_evaluations(chat_id);
    CREATE INDEX IF NOT EXISTS idx_pcg_email_eval_message_id ON pcg_email_evaluations(message_id);
    CREATE INDEX IF NOT EXISTS idx_pcg_email_eval_rm_name ON pcg_email_evaluations(rm_name);
    CREATE INDEX IF NOT EXISTS idx_pcg_email_eval_status ON pcg_email_evaluations(evaluation_status);
    CREATE INDEX IF NOT EXISTS idx_pcg_email_eval_dispute ON pcg_email_evaluations(dispute_status);
    CREATE INDEX IF NOT EXISTS idx_pcg_email_eval_evaluated_at ON pcg_email_evaluations(evaluated_at);

    -- Ensure ai_coaching_tip is completely dropped from pcg_email_evaluations
    ALTER TABLE pcg_email_evaluations DROP COLUMN IF EXISTS ai_coaching_tip CASCADE;

    CREATE OR REPLACE VIEW pcg_email_evaluation AS SELECT * FROM pcg_email_evaluations;
  `);

  tablesEnsured = true;
}

export const ensurePcgEmailConversationsTable = ensurePcgEmailTables;
export const ensurePcgEmailEvaluationsTable = ensurePcgEmailTables;

/**
 * Resolves customer name from payload, inbound message sender, onboarding salutations, or email username.
 * Robylon payload's `requester_info` only carries email/userId and omits name; this extracts the real customer name.
 */
export function resolveCustomerNameFromPayload(payload: any, transcript: any[] = []): string {
  // 1. Direct name in requester_info
  const directName = payload?.requester_info?.name || payload?.data?.requester_info?.name;
  if (directName && typeof directName === 'string' && directName.trim() && directName.trim() !== 'HNI Client') {
    return directName.trim();
  }

  // 2. Direct sender from incoming turn or rawMsg
  const inboundTurn = transcript.find((t: any) => t.direction === 'inbound' && !t.authorEmail?.toLowerCase().includes('@wintwealth.com')) || transcript[0];
  if (inboundTurn?.authorName && typeof inboundTurn.authorName === 'string') {
    const s = inboundTurn.authorName.trim();
    if (s && !s.includes('@') && s.toLowerCase() !== 'bot') {
      return s;
    }
  }

  const rawMsg = payload?.data?.message || payload?.data;
  if (rawMsg?.sender && typeof rawMsg.sender === 'string') {
    const s = rawMsg.sender.trim();
    if (s && !s.includes('@') && s.toLowerCase() !== 'bot' && !rawMsg.from_email?.toLowerCase().includes('@wintwealth.com')) {
      return s;
    }
  }

  // 3. Check for onboarding salutation: "Hi <Name>," or "Dear <Name>," in the email body
  const bodyText = String(inboundTurn?.content || rawMsg?.content || rawMsg?.body || '');
  const salutationMatch = bodyText.match(/^(?:Hi|Dear|Hello)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)[,\n]/m);
  if (salutationMatch && salutationMatch[1]) {
    const candidate = salutationMatch[1].trim();
    if (!['Entity', 'Sir', 'Madam', 'Team', 'All', 'Investor', 'Customer'].includes(candidate)) {
      return candidate;
    }
  }

  // 4. Fallback to clean readable email username
  const email = (inboundTurn?.authorEmail && !inboundTurn.authorEmail.toLowerCase().includes('@wintwealth.com'))
    ? inboundTurn.authorEmail
    : (payload?.requester_info?.email && !payload.requester_info.email.toLowerCase().includes('@wintwealth.com'))
      ? payload.requester_info.email
      : null;

  if (email && typeof email === 'string') {
    const userPart = email.split('@')[0].replace(/[._-]/g, ' ').trim();
    if (userPart && userPart.toLowerCase() !== 'hello') {
      return userPart.split(' ').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    }
  }

  return 'HNI Client';
}

/**
 * Extracts Intent_L1 property from Robylon properties array.
 */
function extractIntentL1(payload: any): string | null {
  const props = Array.isArray(payload?.data?.properties)
    ? payload.data.properties
    : Array.isArray(payload?.properties)
      ? payload.properties
      : [];
  const p = props.find((x: any) => x?.name === 'Intents_L1');
  return p ? (p.snapshot_value || p.selected_value || null) : null;
}

/**
 * Extracts assigned agent info from Robylon properties.
 */
function extractAssignedAgent(payload: any): { agentId: string | null; agentName: string | null } {
  const props = Array.isArray(payload?.data?.properties)
    ? payload.data.properties
    : Array.isArray(payload?.properties)
      ? payload.properties
      : [];

  const nameProp = props.find((x: any) => x?.name === 'Robylon Assigned Agent Name');
  const idProp = props.find((x: any) => x?.name === 'Robylon Assigned Agent ID');

  const rawName = nameProp ? (nameProp.snapshot_value || nameProp.selected_value || null) : null;
  const rawId = idProp ? (idProp.snapshot_value || idProp.selected_value || null) : null;

  const candidateName = rawName || payload?.human_agent_info?.name || payload?.handled_by_name || null;
  const candidateId = rawId || payload?.human_agent_info?.agent_id || payload?.handled_by_id || null;

  // Filter out automated bot names (e.g. Myra, Robylon AI) — PCG tracks human RMs & AMs
  const isBot =
    !candidateName ||
    ['myra', 'bot', 'robylon', 'robylon ai', 'ai'].includes(candidateName.toLowerCase().trim()) ||
    payload?.handled_by === 'AI';

  return {
    agentId: isBot ? null : candidateId,
    agentName: isBot ? null : candidateName,
  };
}

/**
 * Strips HTML tags and excessive whitespace for snippets.
 */
function cleanContentText(content: string): string {
  return content
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Determines whether an agent or email address is excluded from PCG email quality evaluation.
 * Indrajit Das is Head of PCG and is strictly excluded from quality evaluation.
 * His replies are stored in the DB transcript for preceding context, but are never evaluated.
 */
export function isExcludedFromPcgEmailEvaluation(nameOrEmail?: string | null): boolean {
  if (!nameOrEmail) return false;
  const lower = nameOrEmail.toLowerCase().trim();
  return (
    lower.includes('indrajit') ||
    lower.includes('indrajit das') ||
    lower.includes('indrajit@wintwealth.com') ||
    lower.includes('compliance@wintwealth.com') ||
    lower.includes('hello@wintwealth.com')
  );
}

export interface IngestPcgEmailOptions {
  isBackfill?: boolean;
}

/**
 * Ingests a single Robylon email event payload into `pcg_email_conversations`.
 * When an outbound agent reply (`REPLY_SENT`) is detected, it also queues an evaluation
 * in `pcg_email_evaluations`.
 */
export async function ingestPcgEmailEvent(
  payload: any,
  options: IngestPcgEmailOptions = {}
): Promise<{ ticketId: string; updated: boolean; evaluationQueued?: boolean; evaluatedMessageId?: string | null }> {
  await ensurePcgEmailTables();

  const eventType = String(payload?.event_type || 'UNKNOWN').toUpperCase();
  const chatId = String(payload?.chat_id || payload?.ticket_id || payload?.data?.ticket_id || '');
  const ticketId = String(payload?.ticket_id || payload?.data?.ticket_id || chatId);

  if (!ticketId) {
    throw new Error('Cannot ingest email payload without ticket_id or chat_id');
  }

  const inbox = emailInboxOf(payload);
  const subjectLine =
    payload?.data?.subject ||
    payload?.subject ||
    payload?.data?.message?.subject ||
    '';

  const customerEmail =
    payload?.requester_info?.email ||
    payload?.data?.requester_info?.email ||
    payload?.user_email ||
    '';

  const customerName =
    payload?.requester_info?.name ||
    payload?.data?.requester_info?.name ||
    '';

  const customerPhone =
    payload?.requester_info?.phone_number ||
    payload?.data?.requester_info?.phone_number ||
    '';

  const intentL1 = extractIntentL1(payload);
  const assigned = extractAssignedAgent(payload);

  const createdAt =
    payload?.created_at ||
    payload?.data?.created_at ||
    new Date().toISOString();

  // Extract message if present (NEW_MESSAGE, REPLY_SENT, or INTERNAL_NOTE_ADDED)
  const rawMsg =
    payload?.data?.message ||
    (eventType === 'NEW_MESSAGE' || eventType === 'REPLY_SENT' || eventType === 'INTERNAL_NOTE_ADDED'
      ? payload?.data
      : null);

  let messageTurn: any = null;
  let isOutboundAgentReply = false;
  let replyAuthorName = '';
  let evaluatedMessageId: string | null = null;
  let agentReplyContent = '';

  if (rawMsg && (rawMsg.content || rawMsg.body)) {
    const rawContent = String(rawMsg.content || rawMsg.body || '');
    const cleanSnippet = cleanContentText(rawContent).slice(0, 160);
    const msgId = String(rawMsg.message_id || payload?.event_id || `msg_${Date.now()}`);
    const authorType = String(rawMsg.author_type || payload?.handled_by || '').toLowerCase();
    const sender = String(rawMsg.sender || rawMsg.from_email || 'Unknown').trim();
    const fromEmail = String(rawMsg.from_email || rawMsg.sender_email || '');
    const msgSentAt = rawMsg.created_at || createdAt;

    const isWintEmail = fromEmail.toLowerCase().includes('@wintwealth.com');
    const isCustomer =
      !isWintEmail &&
      (authorType === 'customer' ||
        rawMsg.sender_type === 'customer' ||
        (eventType === 'NEW_MESSAGE' && !isWintEmail));

    isOutboundAgentReply =
      isWintEmail ||
      (!isCustomer && (eventType === 'REPLY_SENT' || authorType === 'human_agent' || authorType === 'agent'));
    replyAuthorName = isOutboundAgentReply ? sender : '';
    if (isOutboundAgentReply) {
      evaluatedMessageId = msgId;
      agentReplyContent = rawContent;
    }

    let authorRole: 'customer' | 'rm' | 'am' | 'tl' = 'customer';
    if (!isCustomer) {
      let isAmMatch = isPcgAm(sender);
      let isTlMatch = false;
      try {
        const dirMap = await getRmDirectoryMap();
        const match = dirMap.get(sender.toLowerCase().trim()) || dirMap.get(canonicalizePcgRmName(sender).toLowerCase().trim());
        if (match) {
          if (match.role === 'am') isAmMatch = true;
          if (match.role === 'tl') isTlMatch = true;
        }
      } catch {
        // Fallback to static check
      }

      if (isAmMatch) {
        authorRole = 'am';
      } else if (isTlMatch) {
        authorRole = 'tl';
      } else {
        authorRole = 'rm';
      }
    }

    messageTurn = {
      id: msgId,
      authorName: sender,
      authorEmail: fromEmail || (isCustomer ? customerEmail : ''),
      authorRole,
      direction: isCustomer ? 'inbound' : 'outbound',
      sentAt: msgSentAt,
      subject: rawMsg.subject || subjectLine,
      snippet: cleanSnippet,
      content: rawContent,
      messageType: rawMsg.message_type || (isCustomer ? 'incoming' : 'outgoing'),
    };
  }

  // Look up existing conversation row
  const existingRows = await query<any>(
    `SELECT * FROM pcg_email_conversations WHERE ticket_id = $1 LIMIT 1`,
    [ticketId]
  );
  const existing = existingRows[0] || null;

  // Resolve RM & TL
  let effectiveRmName = existing?.rm_name || assigned.agentName || replyAuthorName || '';
  if (replyAuthorName) {
    effectiveRmName = replyAuthorName;
  }
  if (effectiveRmName) {
    effectiveRmName = canonicalizePcgRmName(effectiveRmName);
  }

  let effectiveTlName = existing?.tl_name || '';
  let isAm = existing?.is_am || false;
  let isTl = existing?.is_tl || false;

  if (effectiveRmName) {
    isAm = isPcgAm(effectiveRmName);
    try {
      const dirMap = await getRmDirectoryMap();
      const match = dirMap.get(effectiveRmName.toLowerCase().trim());
      if (match) {
        effectiveTlName = match.tl_name;
        if (match.role === 'am') isAm = true;
        if (match.role === 'tl') isTl = true;
      }
    } catch {
      // Best effort lookup
    }
  }

  if (!effectiveTlName) {
    effectiveTlName = 'Team Swetha';
  }

  // Merge transcripts
  let transcript: any[] = Array.isArray(existing?.transcript) ? [...existing.transcript] : [];
  if (messageTurn) {
    const existingIndex = transcript.findIndex((m: any) => m.id === messageTurn.id);
    if (existingIndex >= 0) {
      transcript[existingIndex] = { ...transcript[existingIndex], ...messageTurn };
    } else {
      messageTurn.replyNumber = transcript.length + 1;
      transcript.push(messageTurn);
    }
    transcript.forEach((t, i) => {
      t.replyNumber = i + 1;
    });
  }

  const lastMsg = transcript.length > 0 ? transcript[transcript.length - 1] : null;
  const lastMsgAt = lastMsg?.sentAt || createdAt;
  const lastMsgText = lastMsg?.content ? cleanContentText(lastMsg.content) : null;
  const lastDirection = lastMsg?.direction || (eventType === 'REPLY_SENT' ? 'outbound' : 'inbound');

  let status = existing?.status || 'OPEN';
  let closedAt = existing?.closed_at || null;
  if (eventType === 'TICKET_CLOSED') {
    status = 'CLOSED';
    closedAt = createdAt;
  } else if (eventType === 'REPLY_SENT') {
    status = 'RESOLVED';
  }

  let firstResponseAt = existing?.first_response_at || null;
  if (isOutboundAgentReply && !firstResponseAt) {
    firstResponseAt = messageTurn?.sentAt || createdAt;
  }

  const resolvedName = resolveCustomerNameFromPayload(payload, transcript);
  const finalCustomerEmail = customerEmail || existing?.customer_email || null;
  const finalCustomerName = (resolvedName && resolvedName !== 'HNI Client') ? resolvedName : (existing?.customer_name || resolvedName || null);
  const finalCustomerPhone = customerPhone || existing?.customer_phone || null;
  const finalSubject = subjectLine || existing?.subject_line || 'No Subject';
  const finalInbox = inbox || existing?.inbox || null;
  const finalIntent = intentL1 || existing?.intent_l1 || null;

  let conversationId: number | null = existing?.id ? Number(existing.id) : null;

  if (existing) {
    await query(
      `UPDATE pcg_email_conversations SET
        chat_id = COALESCE(NULLIF($1, ''), chat_id),
        inbox = COALESCE(NULLIF($2, ''), inbox),
        subject_line = COALESCE(NULLIF($3, ''), subject_line),
        customer_name = COALESCE(NULLIF($4, ''), customer_name),
        customer_email = COALESCE(NULLIF($5, ''), customer_email),
        customer_phone = COALESCE(NULLIF($6, ''), customer_phone),
        rm_name = COALESCE(NULLIF($7, ''), rm_name),
        tl_name = COALESCE(NULLIF($8, ''), tl_name),
        is_tl = COALESCE($9, is_tl),
        is_am = COALESCE($10, is_am),
        status = $11,
        intent_l1 = COALESCE(NULLIF($12, ''), intent_l1),
        transcript = $13::jsonb,
        total_messages = $14,
        first_response_at = COALESCE(first_response_at, $15),
        last_message_at = $16,
        last_message_text = $17,
        last_direction = $18,
        closed_at = COALESCE(closed_at, $19),
        raw_payload = $20::jsonb,
        updated_at = NOW()
       WHERE ticket_id = $21`,
      [
        chatId,
        finalInbox,
        finalSubject,
        finalCustomerName,
        finalCustomerEmail,
        finalCustomerPhone,
        effectiveRmName || null,
        effectiveTlName || null,
        isTl,
        isAm,
        status,
        finalIntent,
        JSON.stringify(transcript),
        transcript.length,
        firstResponseAt,
        lastMsgAt,
        lastMsgText,
        lastDirection,
        closedAt,
        JSON.stringify(payload),
        ticketId,
      ]
    );
  } else {
    const insertRes = await query<{ id: string }>(
      `INSERT INTO pcg_email_conversations (
        ticket_id, chat_id, inbox, subject_line, customer_name, customer_email, customer_phone,
        client_tier, assigned_rm_id, rm_name, tl_name, is_tl, is_am, status, intent_l1,
        transcript, total_messages, first_response_at, last_message_at, last_message_text,
        last_direction, closed_at, raw_payload, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10, $11, $12, $13, $14, $15,
        $16::jsonb, $17, $18, $19, $20,
        $21, $22, $23::jsonb, $24, NOW()
      )
      ON CONFLICT (ticket_id) DO UPDATE SET
        inbox = COALESCE(NULLIF(EXCLUDED.inbox, ''), pcg_email_conversations.inbox),
        transcript = EXCLUDED.transcript,
        total_messages = EXCLUDED.total_messages,
        last_message_at = EXCLUDED.last_message_at,
        last_message_text = EXCLUDED.last_message_text,
        last_direction = EXCLUDED.last_direction,
        updated_at = NOW()
      RETURNING id`,
      [
        ticketId,
        chatId,
        finalInbox,
        finalSubject,
        finalCustomerName,
        finalCustomerEmail,
        finalCustomerPhone,
        'HNI / PCG Wealth',
        assigned.agentId,
        effectiveRmName || null,
        effectiveTlName || null,
        isTl,
        isAm,
        status,
        finalIntent,
        JSON.stringify(transcript),
        transcript.length,
        firstResponseAt,
        lastMsgAt,
        lastMsgText,
        lastDirection,
        closedAt,
        JSON.stringify(payload),
        createdAt,
      ]
    );
    if (insertRes[0]?.id) {
      conversationId = Number(insertRes[0].id);
    }
  }

  // If this event is an outbound agent reply, queue it in pcg_email_evaluations
  // Indrajit Das (Head of PCG) is strictly excluded from QA scoring.
  let evaluationQueued = false;
  const isExcludedAgent =
    isExcludedFromPcgEmailEvaluation(replyAuthorName) ||
    isExcludedFromPcgEmailEvaluation(effectiveRmName);

  if (isOutboundAgentReply && evaluatedMessageId && !isExcludedAgent) {
    const priorCustomerMsg = [...transcript]
      .reverse()
      .find((t) => t.direction === 'inbound')?.content || finalSubject;

    await query(
      `INSERT INTO pcg_email_evaluations (
        conversation_id, ticket_id, chat_id, message_id, inbox, subject_line,
        customer_name, customer_email, customer_phone, client_tier,
        rm_name, tl_name, is_tl, is_am, sent_at,
        customer_message, agent_reply_text, thread_replies,
        evaluation_status, raw_payload, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10,
        $11, $12, $13, $14, $15,
        $16, $17, $18::jsonb,
        'Pending', $19::jsonb, NOW(), NOW()
      )
      ON CONFLICT (message_id) DO UPDATE SET
        chat_id = COALESCE(NULLIF(EXCLUDED.chat_id, ''), pcg_email_evaluations.chat_id),
        agent_reply_text = EXCLUDED.agent_reply_text,
        thread_replies = EXCLUDED.thread_replies,
        updated_at = NOW()
      WHERE pcg_email_evaluations.evaluation_status != 'Completed'`,
      [
        conversationId,
        ticketId,
        chatId || null,
        evaluatedMessageId,
        finalInbox,
        finalSubject,
        finalCustomerName,
        finalCustomerEmail,
        finalCustomerPhone,
        'HNI / PCG Wealth',
        effectiveRmName || null,
        effectiveTlName || null,
        isTl,
        isAm,
        messageTurn?.sentAt || createdAt,
        priorCustomerMsg,
        agentReplyContent,
        JSON.stringify(transcript),
        JSON.stringify(payload),
      ]
    );
    evaluationQueued = true;
  }

  return {
    ticketId,
    updated: true,
    evaluationQueued,
    evaluatedMessageId: evaluationQueued ? evaluatedMessageId : null,
  };
}

/**
 * Backfills historical PCG email payloads from `pcg_webhook_payloads` into `pcg_email_conversations`.
 * NOTE: NEVER deletes any records from `pcg_webhook_payloads`.
 */
export async function backfillPcgEmailConversations(): Promise<{
  totalPayloads: number;
  processedPayloads: number;
  distinctTickets: number;
}> {
  await ensurePcgEmailTables();

  const payloads = await query<any>(
    `SELECT id, source, channel, event_type, event_id, chat_id, received_at, payload
     FROM pcg_webhook_payloads
     WHERE source = 'robylon_email' OR channel = 'email'
     ORDER BY received_at ASC, id ASC`
  );

  let processedCount = 0;
  for (const row of payloads) {
    try {
      await ingestPcgEmailEvent(row.payload, { isBackfill: true });
      processedCount++;
    } catch (err: any) {
      console.error(`[backfill-pcg-emails] Error ingesting row ${row.id}:`, err?.message || err);
    }
  }

  const countRes = await query<{ count: string }>(
    `SELECT COUNT(*) as count FROM pcg_email_conversations`
  );
  const distinctTickets = parseInt(countRes[0]?.count || '0', 10);

  return {
    totalPayloads: payloads.length,
    processedPayloads: processedCount,
    distinctTickets,
  };
}

/**
 * Inserts or updates a scored evaluation in `pcg_email_evaluations`.
 */
export async function savePcgEmailEvaluation(record: {
  conversationId?: number | null;
  ticketId: string;
  chatId?: string | number | null;
  messageId: string;
  inbox?: string | null;
  subjectLine?: string | null;
  customerName?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
  clientTier?: string | null;
  rmName: string;
  tlName: string;
  isTl?: boolean;
  isAm?: boolean;
  sentAt: string;
  evaluatedAt?: string;
  evaluationStatus: 'Pending' | 'Completed' | 'Failed';
  iqsScore: number;
  verdict: string;
  compliancePassed: boolean;
  complianceReason?: string;
  complianceFlags: any[];
  parameters: Record<string, any>;
  strengths?: string[];
  areasForImprovement?: string[];
  ticketSummary?: string;
  precedingThreadSummary?: any;
  threadReplies?: any[];
  customerMessage?: string;
  agentReplyText?: string;
  rawPayload?: any;
}): Promise<void> {
  // Indrajit Das (Head of PCG) is strictly excluded from quality evaluation
  if (isExcludedFromPcgEmailEvaluation(record.rmName)) {
    return;
  }
  await ensurePcgEmailTables();

  await query(
    `INSERT INTO pcg_email_evaluations (
      conversation_id, ticket_id, chat_id, message_id, inbox, subject_line,
      customer_name, customer_email, customer_phone, client_tier,
      rm_name, tl_name, is_tl, is_am, sent_at, evaluated_at,
      evaluation_status, iqs_score, verdict, compliance_passed, compliance_reason,
      compliance_flags, parameters, strengths, areas_for_improvement,
      ticket_summary, preceding_thread_summary, thread_replies, customer_message, agent_reply_text,
      raw_payload, updated_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6,
      $7, $8, $9, $10,
      $11, $12, $13, $14, $15, $16,
      $17, $18, $19, $20, $21,
      $22::jsonb, $23::jsonb, $24::jsonb, $25::jsonb,
      $26, $27::jsonb, $28::jsonb, $29, $30,
      $31::jsonb, NOW()
    )
    ON CONFLICT (message_id) DO UPDATE SET
      chat_id = COALESCE(NULLIF(EXCLUDED.chat_id, ''), pcg_email_evaluations.chat_id),
      evaluation_status = EXCLUDED.evaluation_status,
      iqs_score = EXCLUDED.iqs_score,
      verdict = EXCLUDED.verdict,
      compliance_passed = EXCLUDED.compliance_passed,
      compliance_reason = EXCLUDED.compliance_reason,
      compliance_flags = EXCLUDED.compliance_flags,
      parameters = EXCLUDED.parameters,
      strengths = EXCLUDED.strengths,
      areas_for_improvement = EXCLUDED.areas_for_improvement,
      ticket_summary = EXCLUDED.ticket_summary,
      preceding_thread_summary = EXCLUDED.preceding_thread_summary,
      thread_replies = EXCLUDED.thread_replies,
      evaluated_at = NOW(),
      updated_at = NOW()`,
    [
      record.conversationId ?? null,
      record.ticketId,
      record.chatId ? String(record.chatId) : null,
      record.messageId,
      record.inbox ?? null,
      record.subjectLine ?? null,
      record.customerName ?? null,
      record.customerEmail ?? null,
      record.customerPhone ?? null,
      record.clientTier ?? 'HNI / PCG Wealth',
      record.rmName,
      record.tlName,
      record.isTl ?? false,
      record.isAm ?? false,
      record.sentAt,
      record.evaluatedAt ?? new Date().toISOString(),
      record.evaluationStatus,
      record.iqsScore,
      record.verdict,
      record.compliancePassed,
      record.complianceReason ?? null,
      JSON.stringify(record.complianceFlags || []),
      JSON.stringify(record.parameters || {}),
      JSON.stringify(record.strengths || []),
      JSON.stringify(record.areasForImprovement || []),
      record.ticketSummary ?? null,
      JSON.stringify(record.precedingThreadSummary || {}),
      JSON.stringify(record.threadReplies || []),
      record.customerMessage ?? null,
      record.agentReplyText ?? null,
      record.rawPayload ? JSON.stringify(record.rawPayload) : null,
    ]
  );
}
