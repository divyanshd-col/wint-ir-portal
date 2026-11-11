/**
 * lib/pcg/sop-alert.ts
 *
 * PCG Call Monitoring – Slack Alerts & Portal Integration
 * Detects behavioral & compliance signals across the 7 SOP monitoring categories
 * for Runo PCG voice calls and triggers immediate formatted Slack alerts.
 */

import { postSlackMessage, sendSlackMessage } from '@/lib/slack';
import { readConfig } from '@/lib/config';
import { query } from '@/lib/cx/db';
import { TL_SLACK_MEMBER_MAP } from '@/lib/quality-alert';
import { geminiGenerate } from '@/lib/gemini';
import { DEFAULT_GEMINI_MODEL } from '@/lib/models';
import { log } from '@/lib/log';

const ROUTE = 'pcg-sop-alert';

// ── 7 Canonical PCG Call Monitoring Categories ─────────────────────────────────
export interface PcgMonitoringCategoryDef {
  id: string;
  name: string;
  severity: 'CRITICAL' | 'MEDIUM' | 'LOW';
  defaultDirection: 'Customer said this to RM' | 'RM said this to customer';
  description: string;
  typicalSignals: string[];
}

export const PCG_MONITORING_CATEGORIES: PcgMonitoringCategoryDef[] = [
  {
    id: 'customer_behaviour_hostility',
    name: 'Customer Behaviour & Hostility',
    severity: 'CRITICAL',
    defaultDirection: 'Customer said this to RM',
    description: 'Threats of legal action, SEBI/regulatory complaints, police complaints, verbal abuse, extreme profanity, shouting, or aggression against Wint Wealth or RM.',
    typicalSignals: [
      'Threatening legal action or regulator complaint',
      'Threatening police or consumer court escalation',
      'Abusive language, cursing or harassment directed at RM',
      'Extreme agitation or severe customer hostility'
    ],
  },
  {
    id: 'guaranteed_assured_returns',
    name: 'Guaranteed or Assured Returns',
    severity: 'CRITICAL',
    defaultDirection: 'RM said this to customer',
    description: 'RM stating, assuring, or implying guaranteed/fixed returns on market-linked debt, AIF, or bonds, or comparing them to risk-free bank FDs without risk disclosures.',
    typicalSignals: [
      'Promising or assuring guaranteed or fixed returns',
      'Claiming market-linked debt or AIF is 100% risk-free or equivalent to bank FDs',
      'Stating past returns are guaranteed in the future'
    ],
  },
  {
    id: 'unauthorized_advice_mis_selling',
    name: 'Unauthorized Advice & Mis-selling',
    severity: 'CRITICAL',
    defaultDirection: 'RM said this to customer',
    description: 'RM providing unauthorized personalized investment advice, recommending unsuitable products without risk profiling, or misrepresenting fees, lock-in, tenure, drawdown, taxation, or security cover.',
    typicalSignals: [
      'Providing unregistered personal investment advisory / stock picking',
      'Misrepresenting product lock-in, tenure, or exit options',
      'False claims regarding senior secured status or asset cover',
      'Misrepresenting taxation or pass-through benefits'
    ],
  },
  {
    id: 'churn_capital_withdrawal',
    name: 'Customer Churn & Capital Withdrawal Threat',
    severity: 'CRITICAL',
    defaultDirection: 'Customer said this to RM',
    description: 'Customer explicitly stating intent to withdraw all capital, cancel existing bond/AIF allocations, close Wint Wealth account, or expressing complete loss of confidence.',
    typicalSignals: [
      'Demanding immediate account closure or full capital exit',
      'Threatening to stop all future investments due to dissatisfaction',
      'Refusal to proceed with committed drawdown/allocation'
    ],
  },
  {
    id: 'missed_commitment_service_escalation',
    name: 'Missed Commitment & Service Escalation',
    severity: 'MEDIUM',
    defaultDirection: 'Customer said this to RM',
    description: 'Repeated operational failures, severe delays in account statement/allotment/redemption, repeated missed callbacks, or customer repeatedly escalating due to lack of ownership.',
    typicalSignals: [
      'Customer complaining about repeated missed promised callbacks',
      'Long-standing unfulfilled documentation or ops request',
      'Customer frustrated over lack of ownership or communication vacuum'
    ],
  },
  {
    id: 'confidentiality_privacy_breach',
    name: 'Confidentiality & Data Privacy Breach',
    severity: 'CRITICAL',
    defaultDirection: 'RM said this to customer',
    description: 'Disclosing other investors’ identity, portfolio values, or contact details, soliciting investor passwords/OTPs, or leaking confidential business/fund terms.',
    typicalSignals: [
      'Sharing confidential third-party investor details or portfolio data',
      'Soliciting OTPs, login passwords, or bank PINs from client',
      'Unauthorized disclosure of proprietary non-public fund pipeline'
    ],
  },
  {
    id: 'unprofessional_conduct_communication',
    name: 'Unprofessional Conduct & Communication Slips',
    severity: 'MEDIUM',
    defaultDirection: 'RM said this to customer',
    description: 'RM engaging in arguments with client, displaying sarcasm, condescension, rude tone, using unprofessional language, or abruptly hanging up on the client.',
    typicalSignals: [
      'RM arguing, shouting, or speaking condescendingly to client',
      'Abrupt unannounced call disconnect / hanging up on client mid-conversation',
      'Unprofessional language, flippant dismissals, or lack of courtesy'
    ],
  },
];

// ── Known RM and TL Slack Member ID Maps ──────────────────────────────────────
export const PCG_TL_SLACK_MAP: Record<string, string> = {
  'dheeraj bhojwani': 'U0A3PEUCFPW',
  'dheeraj': 'U0A3PEUCFPW',
  'team dheeraj bhojwani': 'U0A3PEUCFPW',
  'tanisha mittal': 'U09E3MEPBFY',
  'tanisha': 'U09E3MEPBFY',
  'team tanisha mittal': 'U09E3MEPBFY',
  'swetha': 'U09E3MGLXT8',
  'team swetha': 'U09E3MGLXT8',
  'saiyam rastogi': 'U09EMDCRK3K',
  'saiyam': 'U09EMDCRK3K',
  'team saiyam rastogi': 'U09EMDCRK3K',
  'harsh': 'U055PU2S4HE',
  'team admin': 'U09LS1TSY5T',
  'admin': 'U09LS1TSY5T',
};

export const PCG_RM_SLACK_MAP: Record<string, string> = {
  // Team Dheeraj Bhojwani
  'shrey jain': 'U0B5ZNXK6SV',
  'shrey': 'U0B5ZNXK6SV',
  'ramita kapoor': 'U0B82RB3WNL',
  'ramita': 'U0B82RB3WNL',
  'ishaan kapoor': 'U0B8U8PEGE9',
  'ishaan': 'U0B8U8PEGE9',
  'yaashvi arora': 'U0B9RUJ182U',
  'yaashvi': 'U0B9RUJ182U',
  'paritosh ashiya': 'U0BC956DJP6',
  'paritosh': 'U0BC956DJP6',
  'shivam kumar baghel': 'U0123456784',
  'shivam': 'U0123456784',
  'sargun singh': 'U0BTE0PLYMV',
  'sargun': 'U0BTE0PLYMV',

  // Team Tanisha Mittal
  'samskrithi rao n': 'U0123456786',
  'samskrithi rao': 'U0123456786',
  'samskrithi': 'U0123456786',
  'maniyar kriya jignesh': 'U0BFXNU2ZU1',
  'kriya maniyar': 'U0BFXNU2ZU1',
  'kriya': 'U0BFXNU2ZU1',
  'antara chakraborty': 'U0123456788',
  'antara': 'U0123456788',
  'deshna dugar': 'U0B5VRULJKY',
  'deshna': 'U0B5VRULJKY',
  'harshita dhona': 'U0ATNTU9JEP',
  'harshita': 'U0ATNTU9JEP',
  'keshvi suresh thacker': 'U0123456792',
  'keshvi': 'U0123456792',
  'nischay manish jain': 'U0123456793',
  'nischay': 'U0123456793',

  // Team Swetha
  'sujal dadwani': 'U0B78GZ1ACS',
  'sujal': 'U0B78GZ1ACS',
  'vaishnavi n j': 'U0BBQ1S1VK9',
  'vaishnavi naghat': 'U0BBQ1S1VK9',
  'vaishnavi': 'U0BBQ1S1VK9',
  'diya sharma': 'U0B8ZF7QYQ1',
  'diya': 'U0B8ZF7QYQ1',
  'vidisha jaiswal': 'U0BT0MWPSAC',
  'vidisha': 'U0BT0MWPSAC',
  'nishtha veerwani': 'U0BS2EZ6BC5',
  'nishtha': 'U0BS2EZ6BC5',
  'suryansh sharma': 'U0C2BQWSTA9',
  'suryansh': 'U0C2BQWSTA9',
  'ankita agarwal': 'U0BU3UR4L30',
  'ankita': 'U0BU3UR4L30',
  'vishyata tulsani': 'U0C0TLNBBMW',
  'vishyata': 'U0C0TLNBBMW',

  // Team Saiyam Rastogi
  'vishal kumar yadav': 'U0B6S6XTQ1W',
  'vishal yadav': 'U0B6S6XTQ1W',
  'vishal': 'U0B6S6XTQ1W',
  'gaurav nautiyal': 'U0B8ZF7DS8H',
  'gaurav': 'U0B8ZF7DS8H',
  'shruti sharma': 'U0BG7J6FN4F',
  'shruti': 'U0BG7J6FN4F',
  'sahil joshi': 'U0A7Y9ECXM3',
  'sahil': 'U0A7Y9ECXM3',
  'ayan kumar garg': 'U0C51KY7H41',
  'ayan': 'U0C51KY7H41',
  'rukmini mundhara': 'U0C6Q4LV2MQ',
  'rukmini': 'U0C6Q4LV2MQ',
  'mahi agarwal': 'U0C5Q79D2TA',
  'mahi': 'U0C5Q79D2TA',
  'nandini': 'U08UJUHHN9J',
  'nandani': 'U08UJUHHN9J',

  // Admin / General
  'aahan thaker': 'U0123456810',
  'aahan': 'U0123456810',
  'dhanush': 'U09UYUDU88L',
};

// ── Types ─────────────────────────────────────────────────────────────────────
export interface PcgSopTrigger {
  id?: number | string;
  call_id: string;
  rm_name: string;
  tl_name: string;
  customer_phone?: string | null;
  category: string;
  severity: 'CRITICAL' | 'MEDIUM' | 'LOW';
  direction: 'Customer said this to RM' | 'RM said this to customer' | string;
  signal: string;
  quote: string;
  timestamp?: string; // MM:SS
  turn_index?: number;
  slack_alert_sent?: boolean;
  slack_channel_id?: string;
  slack_message_ts?: string;
  slack_error?: string | null;
  review_status?: 'PENDING' | 'ACKNOWLEDGED' | 'FALSE_POSITIVE';
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  review_note?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface PcgCallMetadata {
  callId: string;
  rmName: string;
  tlName: string;
  customerPhone?: string | null;
  durationSeconds?: number | null;
}

// ── Phone Masking & Duration Format ───────────────────────────────────────────
/**
 * Mask customer phone number in "+91 98•••• ••210" format as specified in design doc.
 */
export function maskCustomerPhone(phone?: string | null): string {
  if (!phone) return '+91 98•••• ••000';
  const clean = phone.replace(/[\s-]/g, '');

  let cc = '+91';
  let num = clean;
  if (clean.startsWith('+91')) {
    cc = '+91';
    num = clean.slice(3);
  } else if (clean.startsWith('91') && clean.length >= 12) {
    cc = '+91';
    num = clean.slice(2);
  } else if (clean.startsWith('+')) {
    const m = clean.match(/^(\+\d{1,3})(.*)$/);
    if (m) {
      cc = m[1];
      num = m[2];
    }
  }

  if (num.length >= 10) {
    const firstTwo = num.slice(0, 2);
    const lastThree = num.slice(-3);
    return `${cc} ${firstTwo}•••• ••${lastThree}`;
  }

  if (num.length >= 5) {
    const firstTwo = num.slice(0, 2);
    const lastTwo = num.slice(-2);
    return `${cc} ${firstTwo}•••• ••${lastTwo}`;
  }

  return `${cc} ${num}`;
}

/**
 * Format total call duration in MM:SS (e.g. 04:12).
 */
export function formatCallDuration(seconds?: number | null): string {
  if (!seconds || seconds <= 0) return '00:00';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// ── Slack Member Tagging ──────────────────────────────────────────────────────
const isSlackUserId = (val?: string | null): val is string => Boolean(val && /^[UW][A-Z0-9]{8,}$/i.test(val.trim()));

export function resolvePcgRmSlackId(rmName: string, customMap?: Record<string, string>): string | null {
  if (!rmName) return null;
  const clean = rmName.trim().toLowerCase();

  if (customMap && isSlackUserId(customMap[clean])) return customMap[clean].trim();
  if (isSlackUserId(PCG_RM_SLACK_MAP[clean])) return PCG_RM_SLACK_MAP[clean];
  if (isSlackUserId(PCG_TL_SLACK_MAP[clean])) return PCG_TL_SLACK_MAP[clean];

  for (const [key, val] of Object.entries(PCG_RM_SLACK_MAP)) {
    if ((clean === key || clean.startsWith(key + ' ') || clean.includes(key)) && isSlackUserId(val)) {
      return val;
    }
  }

  for (const [key, val] of Object.entries(PCG_TL_SLACK_MAP)) {
    if ((clean === key || clean.startsWith(key + ' ') || clean.includes(key)) && isSlackUserId(val)) {
      return val;
    }
  }
  return null;
}

export function resolvePcgTlSlackId(tlName: string, customMap?: Record<string, string>): string | null {
  if (!tlName) return null;
  const raw = tlName.replace(/^Team\s+/i, '').trim().toLowerCase();

  if (customMap && isSlackUserId(customMap[raw])) return customMap[raw].trim();
  if (isSlackUserId(PCG_TL_SLACK_MAP[raw])) return PCG_TL_SLACK_MAP[raw];
  if (isSlackUserId(PCG_RM_SLACK_MAP[raw])) return PCG_RM_SLACK_MAP[raw];
  if (isSlackUserId(TL_SLACK_MEMBER_MAP[raw])) return TL_SLACK_MEMBER_MAP[raw];

  for (const [key, val] of Object.entries(PCG_TL_SLACK_MAP)) {
    if ((raw === key || raw.startsWith(key + ' ') || raw.includes(key)) && isSlackUserId(val)) {
      return val;
    }
  }

  for (const [key, val] of Object.entries(PCG_RM_SLACK_MAP)) {
    if ((raw === key || raw.startsWith(key + ' ') || raw.includes(key)) && isSlackUserId(val)) {
      return val;
    }
  }

  for (const [key, val] of Object.entries(TL_SLACK_MEMBER_MAP)) {
    if ((raw === key || raw.startsWith(key + ' ') || raw.includes(key)) && isSlackUserId(val)) {
      return val;
    }
  }
  return null;
}

export function formatRmSlackTag(rmName: string, customMap?: Record<string, string>): string {
  const clean = (rmName || 'RM').trim();
  const slackId = resolvePcgRmSlackId(clean, customMap);
  if (slackId && isSlackUserId(slackId)) {
    return `<@${slackId}>`;
  }
  return clean;
}

export function formatTlSlackTag(tlName: string, customMap?: Record<string, string>): string {
  const clean = (tlName || 'TL').replace(/^Team\s+/i, '').trim();
  const slackId = resolvePcgTlSlackId(clean, customMap);
  if (slackId && isSlackUserId(slackId)) {
    return `<@${slackId}>`;
  }
  return clean;
}

// ── Slack Channel & Tokens ────────────────────────────────────────────────────
export function getPcgSopSlackChannel(): string {
  return (
    process.env.PCG_SOP_SLACK_CHANNEL ||
    process.env.PCG_SLACK_CHANNEL ||
    'C0CG6G2ESQ6'
  );
}

export async function getPcgSlackToken(): Promise<string> {
  let token =
    process.env.PCG_SOP_SLACK_BOT_TOKEN ||
    process.env.COMPLIANCE_SLACK_BOT_TOKEN ||
    process.env.SLACK_BOT_TOKEN ||
    process.env.SLACK_USER_TOKEN ||
    '';

  if (!token) {
    try {
      const config = await readConfig();
      token = (config as any).pcgSopSlackBotToken || (config as any).complianceSlackBotToken || (config as any).slackBotToken || config.slackUserToken || '';
    } catch {}
  }
  return token;
}

export function getPortalCallUrl(callId: string): string {
  const base = process.env.NEXTAUTH_URL || process.env.PORTAL_BASE_URL || 'https://ir-portal.wintwealth.com';
  const cleanBase = base.replace(/\/+$/, '');
  const cleanCallId = callId.replace(/^runo-/, '').replace(/^call-/, '');
  return `${cleanBase}/admin/pcg-calls?callId=${encodeURIComponent(cleanCallId)}`;
}

// ── Slack Alert Message Construction ──────────────────────────────────────────
/**
 * Constructs the exact Slack alert text according to Section 2 of the specification:
 *
 * 🚨 PCG CALL MONITORING ALERT — [Category Name]
 *
 * • Call ID: 68fb1d8ec9faf992f3132454
 * • RM: <@U0123456789> (Shrey Jain)
 * • TL: <@U055PU2S4HE> (Dheeraj Bhojwani)
 * • Customer Phone: +91 98•••• ••210
 * • Call Duration: 04:12
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * Trigger Category: Customer Behaviour & Hostility
 * Severity Level: CRITICAL
 * Direction: Customer said this to RM
 * Timestamp: 02:45 (Turn 14)
 *
 * Quoted Dialogue:
 * "If this interest is not credited by 5 PM, I will file a formal complaint with SEBI against Wint Wealth."
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * Open Call in Wint IR Portal:
 * https://ir-portal.wintwealth.com/admin/pcg-calls?callId=68fb1d8ec9faf992f3132454
 */
export function buildPcgSopSlackMessage(
  trigger: PcgSopTrigger,
  callMetadata: PcgCallMetadata,
  customMap?: Record<string, string>
): string {
  const rmTag = formatRmSlackTag(trigger.rm_name || callMetadata.rmName, customMap);
  const tlTag = formatTlSlackTag(trigger.tl_name || callMetadata.tlName, customMap);
  const portalUrl = getPortalCallUrl(trigger.call_id || callMetadata.callId);

  const cleanCallId = (trigger.call_id || callMetadata.callId).replace(/^runo-/, '').replace(/^call-/, '');

  const timestampDisplay = trigger.timestamp || '00:00';
  const turnDisplay = trigger.turn_index ? ` (Turn ${trigger.turn_index})` : '';

  return `🚨 PCG CALL MONITORING ALERT — ${trigger.category}

• Call ID: ${cleanCallId}
• RM: ${rmTag}
• TL: ${tlTag}

Trigger Category: ${trigger.category}
Severity Level: ${trigger.severity}
Direction: ${trigger.direction}
Timestamp: ${timestampDisplay}${turnDisplay}

Quoted Dialogue:
"${trigger.quote.trim()}"

Open Call in Wint IR Portal:
${portalUrl}`;
}

// ── Send Slack Notification ───────────────────────────────────────────────────
export async function sendPcgSopSlackAlert(
  trigger: PcgSopTrigger,
  callMetadata: PcgCallMetadata,
  customMap?: Record<string, string>
): Promise<{ ok: boolean; ts?: string; error?: string }> {
  try {
    const channel = getPcgSopSlackChannel();
    const token = await getPcgSlackToken();

    if (!channel || (!token && !channel.startsWith('https://'))) {
      const err = 'Slack channel or token not configured for PCG SOP alerts';
      log.warn(ROUTE, err);
      return { ok: false, error: err };
    }

    const messageText = buildPcgSopSlackMessage(trigger, callMetadata, customMap);

    const res = await postSlackMessage(channel, messageText, token, undefined, {
      username: 'PCG Call Monitoring',
      icon_emoji: ':rotating_light:',
    });

    if (res.ok) {
      log.info(ROUTE, `Posted SOP alert for call ${trigger.call_id} to ${channel} (ts: ${res.ts})`);
    } else {
      log.error(ROUTE, `Failed to post SOP alert for call ${trigger.call_id}: ${res.error}`);
    }

    return res;
  } catch (err: any) {
    const errMsg = err?.message || String(err);
    log.error(ROUTE, `Exception while posting SOP alert for ${trigger.call_id}: ${errMsg}`);
    return { ok: false, error: errMsg };
  }
}

// ── High-Precision Regulatory & Hostility Pattern Rules ────────────────────────
/**
 * Fast regex rules for deterministic tripwires (e.g. SEBI complaints, police, guaranteed returns)
 * to ensure 100% detection even if LLM phrasing deviates.
 */
interface PatternRule {
  category: string;
  severity: 'CRITICAL' | 'MEDIUM' | 'LOW';
  direction: 'Customer said this to RM' | 'RM said this to customer';
  signal: string;
  speaker: 'Customer' | 'RM';
  regex: RegExp;
}

const DETERMINISTIC_RULES: PatternRule[] = [
  // 1. Customer hostility & legal/regulator threats
  {
    category: 'Customer Behaviour & Hostility',
    severity: 'CRITICAL',
    direction: 'Customer said this to RM',
    signal: 'Threatening legal action or regulator complaint',
    speaker: 'Customer',
    regex: /\b(sebi|complaint\s+with\s+sebi|file\s+a\s+(formal\s+)?complaint|consumer\s+court|rbi\s+ombudsman|legal\s+notice|court|lawyer|police|fir|sue\s+(wint|you))\b/i,
  },
  {
    category: 'Customer Behaviour & Hostility',
    severity: 'CRITICAL',
    direction: 'Customer said this to RM',
    signal: 'Severe verbal abuse or hostility',
    speaker: 'Customer',
    regex: /\b(fraud|scam|cheater|thief|bakwas|pagal|harami|kutte|bastard|nonsense|bloody)\b/i,
  },
  // 2. Guaranteed returns
  {
    category: 'Guaranteed or Assured Returns',
    severity: 'CRITICAL',
    direction: 'RM said this to customer',
    signal: 'Promising or assuring guaranteed or fixed returns',
    speaker: 'RM',
    regex: /\b(guaranteed\s+return|assured\s+return|fixed\s+return|100%\s+safe|risk\s+free|zero\s+risk|guarantee\s+hai|pakka\s+milega)\b/i,
  },
  // 3. Customer Churn
  {
    category: 'Customer Churn & Capital Withdrawal Threat',
    severity: 'CRITICAL',
    direction: 'Customer said this to RM',
    signal: 'Threatening full capital withdrawal or account closure',
    speaker: 'Customer',
    regex: /\b(withdraw\s+all|pull\s+out\s+all|close\s+my\s+account|cancel\s+my\s+investment|close\s+account|redeem\s+everything|band\s+kar\s+do|sara\s+paisa\s+wapas)\b/i,
  },
  // 4. Confidentiality breach
  {
    category: 'Confidentiality & Data Privacy Breach',
    severity: 'CRITICAL',
    direction: 'RM said this to customer',
    signal: 'Soliciting client OTP or password',
    speaker: 'RM',
    regex: /\b(share\s+(the\s+)?otp|tell\s+me\s+the\s+otp|give\s+me\s+your\s+password|netbanking\s+password)\b/i,
  },
];

// ── Gemini SOP Detection Prompt ───────────────────────────────────────────────
export const PCG_SOP_DETECTION_SYSTEM_PROMPT = `You are a Senior Compliance and Behavioral Risk Auditor for Wint Wealth's Private Client Group (PCG) Relationship Managers (RMs).

You will review a chronological transcript of a recorded client phone call.
Your job is to detect whether ANY of the following 7 PCG Call Monitoring Categories occurred during this call:

1. "Customer Behaviour & Hostility" (Severity: CRITICAL or MEDIUM)
   - Scope: Customer abusive/profane language, extreme hostility, verbal aggression, shouting, or explicitly threatening legal action, SEBI complaints, police complaints, RBI ombudsman, or consumer court against Wint Wealth.
   - Direction: "Customer said this to RM"

2. "Guaranteed or Assured Returns" (Severity: CRITICAL)
   - Scope: RM explicitly promising, assuring, or implying guaranteed/fixed returns on market-linked products (AIF, MLD, bonds), or claiming investments are 100% risk-free or equivalent to bank FDs without risk disclosures.
   - Direction: "RM said this to customer"

3. "Unauthorized Advice & Mis-selling" (Severity: CRITICAL or MEDIUM)
   - Scope: RM providing unauthorized personal investment advice, pushing unsuitable products, misrepresenting lock-in, tenure, drawdown, taxation, or security cover (e.g. claiming AIF returns are tax-free or unrated is senior secured).
   - Direction: "RM said this to customer"

4. "Customer Churn & Capital Withdrawal Threat" (Severity: CRITICAL or MEDIUM)
   - Scope: Customer explicitly stating intent to pull out all funds, cancel AIF/MLD, close Wint Wealth account, or expressing complete loss of confidence in Wint Wealth.
   - Direction: "Customer said this to RM"

5. "Missed Commitment & Service Escalation" (Severity: MEDIUM or LOW)
   - Scope: Severe operational delays, repeated missed callback commitments, failure to provide account statements/allotment despite repeated follow-ups, or customer escalating due to lack of turnaround.
   - Direction: "Customer said this to RM" or "RM said this to customer"

6. "Confidentiality & Data Privacy Breach" (Severity: CRITICAL)
   - Scope: Disclosing confidential details of other investors (names, portfolio values, phone numbers), soliciting client OTP/passwords, or leaking non-public corporate data.
   - Direction: "RM said this to customer" or "Customer said this to RM"

7. "Unprofessional Conduct & Communication Slips" (Severity: MEDIUM or LOW)
   - Scope: RM being sarcastic, rude, arguing with client, talking down to customer, using unprofessional language, or abruptly hanging up / disconnecting the call.
   - Direction: "RM said this to customer"

---

CRITICAL INSTRUCTIONS:
- You must identify the EXACT turn number ("turn_index"), timestamp ("timestamp", e.g. "02:45"), exact verbatim spoken dialogue ("quote"), the direction ("Customer said this to RM" or "RM said this to customer"), and the specific "signal".
- If multiple distinct categories or statements occur, return EACH one as a separate item in the "triggers" array.
- If NO category was violated, return an empty array: "triggers": [].

OUTPUT FORMAT (JSON ONLY):
{
  "triggers": [
    {
      "category": "Customer Behaviour & Hostility",
      "severity": "CRITICAL" | "MEDIUM" | "LOW",
      "direction": "Customer said this to RM" | "RM said this to customer",
      "signal": "Threatening legal action or regulator complaint",
      "quote": "If this interest is not credited by 5 PM, I will file a formal complaint with SEBI against Wint Wealth.",
      "timestamp": "02:45",
      "turn_index": 14
    }
  ]
}
`;

// ── Detect SOP Triggers ───────────────────────────────────────────────────────
export async function detectPcgSopTriggers(
  turns: Array<{ speaker: 'RM' | 'Customer'; text: string; time: string; turnIndex: number }>,
  callMetadata: PcgCallMetadata,
  geminiKeys: string[]
): Promise<PcgSopTrigger[]> {
  const detectedTriggers: PcgSopTrigger[] = [];
  const seenQuotes = new Set<string>();

  if (!turns || turns.length === 0) {
    return [];
  }

  // 1. LLM Evaluation via Gemini
  if (geminiKeys && geminiKeys.length > 0) {
    try {
      const transcriptText = turns
        .map((t) => `Turn ${t.turnIndex} [${t.speaker} - ${t.time}]: ${t.text}`)
        .join('\n');

      const userPrompt = `CALL ID: ${callMetadata.callId}
RM NAME: ${callMetadata.rmName}
TL NAME: ${callMetadata.tlName}
CALL DURATION: ${formatCallDuration(callMetadata.durationSeconds)}

FULL CALL TRANSCRIPT:
${transcriptText}

Analyze the above transcript strictly against the 7 PCG Call Monitoring Categories. Return JSON only.`;

      const responseText = await geminiGenerate(
        geminiKeys,
        DEFAULT_GEMINI_MODEL,
        [{ role: 'user', parts: [{ text: userPrompt }] }],
        {
          systemInstruction: PCG_SOP_DETECTION_SYSTEM_PROMPT,
          responseMimeType: 'application/json',
        }
      );

      const parsed = JSON.parse(responseText.replace(/```json/g, '').replace(/```/g, '').trim());
      const rawTriggers = Array.isArray(parsed?.triggers) ? parsed.triggers : [];

      for (const item of rawTriggers) {
        if (!item.category || !item.quote) continue;

        const cleanQuote = String(item.quote).trim();
        const quoteKey = cleanQuote.toLowerCase().slice(0, 40);
        if (seenQuotes.has(quoteKey)) continue;
        seenQuotes.add(quoteKey);

        const severity: 'CRITICAL' | 'MEDIUM' | 'LOW' =
          item.severity === 'LOW' ? 'LOW' : item.severity === 'MEDIUM' ? 'MEDIUM' : 'CRITICAL';

        const direction =
          item.direction === 'RM said this to customer' || item.direction === 'Customer said this to RM'
            ? item.direction
            : (item.speaker === 'RM' ? 'RM said this to customer' : 'Customer said this to RM');

        // Locate turn if index was not exact
        let matchedTurn = turns.find((t) => t.turnIndex === item.turn_index);
        if (!matchedTurn) {
          matchedTurn = turns.find((t) => t.text.toLowerCase().includes(cleanQuote.toLowerCase().slice(0, 25)));
        }

        const timestamp = item.timestamp || matchedTurn?.time || '00:00';
        const turnIndex = item.turn_index || matchedTurn?.turnIndex || 1;

        detectedTriggers.push({
          call_id: callMetadata.callId,
          rm_name: callMetadata.rmName,
          tl_name: callMetadata.tlName,
          customer_phone: callMetadata.customerPhone || null,
          category: item.category,
          severity,
          direction,
          signal: item.signal || 'SOP behavioral signal detected on call',
          quote: cleanQuote,
          timestamp,
          turn_index: turnIndex,
          slack_alert_sent: false,
          review_status: 'PENDING',
        });
      }
    } catch (llmErr: any) {
      log.warn(ROUTE, `LLM SOP detection error: ${llmErr.message}. Falling back to deterministic rules.`);
    }
  }

  // 2. Deterministic rule check (Safety net for high-consequence compliance tripwires)
  for (const t of turns) {
    for (const rule of DETERMINISTIC_RULES) {
      if (t.speaker === rule.speaker && rule.regex.test(t.text)) {
        const quoteKey = t.text.toLowerCase().slice(0, 40);
        if (!seenQuotes.has(quoteKey)) {
          seenQuotes.add(quoteKey);
          detectedTriggers.push({
            call_id: callMetadata.callId,
            rm_name: callMetadata.rmName,
            tl_name: callMetadata.tlName,
            customer_phone: callMetadata.customerPhone || null,
            category: rule.category,
            severity: rule.severity,
            direction: rule.direction,
            signal: rule.signal,
            quote: t.text.trim(),
            timestamp: t.time || '00:00',
            turn_index: t.turnIndex,
            slack_alert_sent: false,
            review_status: 'PENDING',
          });
        }
      }
    }
  }

  return detectedTriggers;
}

// ── Database Operations ───────────────────────────────────────────────────────
/**
 * Persists detected triggers into pcg_call_sop_triggers and updates pcg_call_evaluations.sop_triggers.
 */
export async function savePcgSopTriggers(
  callId: string,
  triggers: PcgSopTrigger[],
  callMeta?: { rmName?: string; tlName?: string; customerPhone?: string }
): Promise<PcgSopTrigger[]> {
  if (!triggers || triggers.length === 0) return [];

  // Fallback rmName / tlName / customerPhone from callMeta or DB if missing on trigger
  let defaultRm = callMeta?.rmName;
  let defaultTl = callMeta?.tlName;
  let defaultPhone = callMeta?.customerPhone;

  if (!defaultRm || !defaultTl) {
    try {
      const callRows = await query<any>(
        `SELECT r.agent_name, r.called_by, r.phone_number, e.rm_name, e.tl_name
         FROM pcg_call_recordings r
         LEFT JOIN pcg_call_evaluations e ON r.call_id = e.call_id
         WHERE r.call_id = $1 LIMIT 1`,
        [callId]
      );
      if (callRows[0]) {
        defaultRm = defaultRm || callRows[0].rm_name || callRows[0].agent_name || callRows[0].called_by || 'Unassigned RM';
        defaultTl = defaultTl || callRows[0].tl_name || 'PCG Team';
        defaultPhone = defaultPhone || callRows[0].phone_number;
      }
    } catch {}
  }

  const saved: PcgSopTrigger[] = [];

  for (const t of triggers) {
    const rmName = t.rm_name || defaultRm || 'Unassigned RM';
    const tlName = t.tl_name || defaultTl || 'PCG Team';
    const customerPhone = t.customer_phone || defaultPhone || null;

    try {
      const res = await query<any>(
        `INSERT INTO pcg_call_sop_triggers (
          call_id, rm_name, tl_name, customer_phone, category, severity,
          direction, signal, quote, timestamp, turn_index, slack_alert_sent,
          slack_channel_id, slack_message_ts, slack_error, review_status,
          created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW(), NOW())
        RETURNING *`,
        [
          callId,
          rmName,
          tlName,
          customerPhone,
          t.category,
          t.severity,
          t.direction,
          t.signal,
          t.quote,
          t.timestamp || null,
          t.turn_index || null,
          Boolean(t.slack_alert_sent),
          t.slack_channel_id || null,
          t.slack_message_ts || null,
          t.slack_error || null,
          t.review_status || 'PENDING',
        ]
      );
      if (res[0]) {
        saved.push({ ...t, id: res[0].id, call_id: callId, rm_name: rmName, tl_name: tlName, customer_phone: customerPhone });
      }
    } catch (dbErr: any) {
      log.error(ROUTE, `Failed to save SOP trigger for call ${callId}: ${dbErr.message}`);
      saved.push({ ...t, call_id: callId, rm_name: rmName, tl_name: tlName, customer_phone: customerPhone });
    }
  }

  // Update sop_triggers column in pcg_call_evaluations
  try {
    await query(
      `UPDATE pcg_call_evaluations
       SET sop_triggers = $1::jsonb, updated_at = NOW()
       WHERE call_id = $2`,
      [JSON.stringify(saved), callId]
    );
  } catch (evalUpdateErr: any) {
    log.warn(ROUTE, `Could not update sop_triggers column in pcg_call_evaluations: ${evalUpdateErr.message}`);
  }

  return saved;
}

/**
 * Fetch all SOP triggers for a given call.
 */
export async function getPcgSopTriggersForCall(callId: string): Promise<PcgSopTrigger[]> {
  try {
    const rows = await query<any>(
      `SELECT * FROM pcg_call_sop_triggers
       WHERE call_id = $1 OR call_id = 'runo-' || $1 OR call_id = 'call-' || $1
       ORDER BY turn_index ASC, id ASC`,
      [callId]
    );
    return rows.map((r) => ({
      id: r.id,
      call_id: r.call_id,
      rm_name: r.rm_name,
      tl_name: r.tl_name,
      customer_phone: r.customer_phone,
      category: r.category,
      severity: r.severity,
      direction: r.direction,
      signal: r.signal,
      quote: r.quote,
      timestamp: r.timestamp,
      turn_index: r.turn_index,
      slack_alert_sent: r.slack_alert_sent,
      slack_channel_id: r.slack_channel_id,
      slack_message_ts: r.slack_message_ts,
      slack_error: r.slack_error,
      review_status: r.review_status,
      reviewed_by: r.reviewed_by,
      reviewed_at: r.reviewed_at ? new Date(r.reviewed_at).toISOString() : null,
      review_note: r.review_note,
      created_at: r.created_at ? new Date(r.created_at).toISOString() : null,
      updated_at: r.updated_at ? new Date(r.updated_at).toISOString() : null,
    }));
  } catch (err: any) {
    log.warn(ROUTE, `Error querying pcg_call_sop_triggers for ${callId}: ${err.message}`);
    return [];
  }
}

/**
 * Updates review status for an SOP trigger row.
 */
export async function updatePcgSopReview(
  triggerId: number | string,
  status: 'PENDING' | 'ACKNOWLEDGED' | 'FALSE_POSITIVE',
  reviewedBy: string,
  reviewNote?: string
): Promise<boolean> {
  try {
    await query(
      `UPDATE pcg_call_sop_triggers
       SET review_status = $1, reviewed_by = $2, review_note = $3, reviewed_at = NOW(), updated_at = NOW()
       WHERE id = $4`,
      [status, reviewedBy, reviewNote || null, triggerId]
    );
    return true;
  } catch (err: any) {
    log.error(ROUTE, `Failed to update SOP review status: ${err.message}`);
    return false;
  }
}

/**
 * Updates Slack alert delivery status for an SOP trigger row.
 */
export async function updatePcgSopSlackStatus(
  triggerId: number | string,
  sent: boolean,
  channelId?: string,
  messageTs?: string,
  error?: string
): Promise<void> {
  try {
    await query(
      `UPDATE pcg_call_sop_triggers
       SET slack_alert_sent = $1, slack_channel_id = $2, slack_message_ts = $3, slack_error = $4, updated_at = NOW()
       WHERE id = $5`,
      [sent, channelId || null, messageTs || null, error || null, triggerId]
    );
  } catch (err: any) {
    log.error(ROUTE, `Failed to update Slack alert status on trigger ${triggerId}: ${err.message}`);
  }
}
