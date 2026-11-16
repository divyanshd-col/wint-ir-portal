/**
 * PCG Chat Category Detection Utility
 *
 * Detects financial product and discussion categories for PCG WhatsApp chats:
 * - AIF (Alternative Investment Fund / Wint Wealth Debt Fund)
 * - PMS (Portfolio Management Services)
 * - Bonds (Corporate Bonds, NCDs, Senior Secured, SGB, etc.)
 * - MLD (Market-Linked Debentures)
 * - FD (Fixed Deposits / Corporate FDs)
 * - General (Account, KYC, platform support, general queries)
 *
 * Supports single and multiple category detection per conversation.
 */

export type PcgProductCategory = 'AIF' | 'PMS' | 'Bonds' | 'MLD' | 'FD' | 'General';

export const PCG_CATEGORIES: PcgProductCategory[] = ['AIF', 'PMS', 'Bonds', 'MLD', 'FD', 'General'];

export const CATEGORY_LABELS: Record<PcgProductCategory, string> = {
  AIF: 'Alternative Investment Fund (Wint Debt Fund)',
  PMS: 'Portfolio Management Services',
  Bonds: 'Bonds & NCDs',
  MLD: 'Market-Linked Debentures',
  FD: 'Fixed Deposits',
  General: 'General Support / Account',
};

export interface CategoryBadgeConfig {
  label: PcgProductCategory;
  bgLight: string;
  textLight: string;
  borderLight: string;
  bgDark: string;
  textDark: string;
  borderDark: string;
}

export const CATEGORY_BADGE_STYLES: Record<PcgProductCategory, CategoryBadgeConfig> = {
  AIF: {
    label: 'AIF',
    bgLight: 'bg-purple-100',
    textLight: 'text-purple-800',
    borderLight: 'border-purple-200',
    bgDark: 'dark:bg-purple-950/60',
    textDark: 'dark:text-purple-300',
    borderDark: 'dark:border-purple-800',
  },
  PMS: {
    label: 'PMS',
    bgLight: 'bg-blue-100',
    textLight: 'text-blue-800',
    borderLight: 'border-blue-200',
    bgDark: 'dark:bg-blue-950/60',
    textDark: 'dark:text-blue-300',
    borderDark: 'dark:border-blue-800',
  },
  Bonds: {
    label: 'Bonds',
    bgLight: 'bg-emerald-100',
    textLight: 'text-emerald-800',
    borderLight: 'border-emerald-200',
    bgDark: 'dark:bg-emerald-950/60',
    textDark: 'dark:text-emerald-300',
    borderDark: 'dark:border-emerald-800',
  },
  MLD: {
    label: 'MLD',
    bgLight: 'bg-amber-100',
    textLight: 'text-amber-800',
    borderLight: 'border-amber-200',
    bgDark: 'dark:bg-amber-950/60',
    textDark: 'dark:text-amber-300',
    borderDark: 'dark:border-amber-800',
  },
  FD: {
    label: 'FD',
    bgLight: 'bg-teal-100',
    textLight: 'text-teal-800',
    borderLight: 'border-teal-200',
    bgDark: 'dark:bg-teal-950/60',
    textDark: 'dark:text-teal-300',
    borderDark: 'dark:border-teal-800',
  },
  General: {
    label: 'General',
    bgLight: 'bg-slate-100',
    textLight: 'text-slate-700',
    borderLight: 'border-slate-200',
    bgDark: 'dark:bg-slate-800',
    textDark: 'dark:text-slate-300',
    borderDark: 'dark:border-slate-700',
  },
};

const CATEGORY_PATTERNS: Array<{
  category: PcgProductCategory;
  patterns: RegExp[];
}> = [
  {
    category: 'AIF',
    patterns: [
      /\b(?:aif|aifs|alternative\s+investment\s+funds?)\b/i,
      /\b(?:wint\s+(?:wealth\s+)?debt\s+fund|debt\s+fund)\b/i,
      /\b(?:cat(?:egory)?\s*(?:2|ii)(?:\s*aif)?)\b/i,
      /\b(?:hurdle\s+rate|capital\s+call|drawdown|ppm|private\s+placement\s+memorandum)\b/i,
      /\b(?:13%\s*(?:fund|xirr|debt|return))\b/i,
      /\b(?:sponsor\s+commitment|blind\s+pool)\b/i,
    ],
  },
  {
    category: 'PMS',
    patterns: [
      /\b(?:pms|portfolio\s+management\s+services?)\b/i,
      /\b(?:high[\s-]water\s+mark|hwm)\b/i,
      /\b(?:twrr)\b/i,
      /\b(?:discretionary\s+pms|non[\s-]discretionary\s+pms)\b/i,
      /\b(?:pms\s+(?:disclosure|strategy|portfolio|agreement|fees?|document))\b/i,
    ],
  },
  {
    category: 'MLD',
    patterns: [
      /\b(?:mlds?|market[\s-]linked\s+debentures?)\b/i,
      /\b(?:equity[\s-]linked\s+debentures?|nifty[\s-]linked|index[\s-]linked)\b/i,
    ],
  },
  {
    category: 'Bonds',
    patterns: [
      /\b(?:corporate\s+bonds?|unlisted\s+bonds?|listed\s+bonds?|tax[\s-]free\s+bonds?|government\s+bonds?)\b/i,
      /\b(?:ncds?|non[\s-]convertible\s+debentures?)\b/i,
      /\b(?:debentures?|senior\s+secured|subordinated?\s+debt)\b/i,
      /\b(?:ytm|yield\s+to\s+maturity|coupon(?:\s+payout|\s+rate)?)\b/i,
      /\b(?:isin|face\s+value)\b/i,
      /\b(?:sovereign\s+gold\s+bonds?|sgb)\b/i,
      // Standalone 'bond' or 'bonds'
      /\b(?<!debt\s+fund\s+)bonds?\b/i,
    ],
  },
  {
    category: 'FD',
    patterns: [
      /\b(?:fixed\s+deposits?|corporate\s+fds?)\b/i,
      /\b(?:bajaj\s+finance\s+fd|shriram\s+fd|mahindra\s+fd)\b/i,
      /\b(?<![a-z0-9])fds?\b/i,
    ],
  },
];

/**
 * Extracts and consolidates full textual content from a chat evaluation object.
 */
function extractFullChatText(chat: any): string {
  const parts: string[] = [];

  // 1. Transcript turns
  const turns = Array.isArray(chat?.transcriptTurns)
    ? chat.transcriptTurns
    : Array.isArray(chat?.transcript_turns)
    ? chat.transcript_turns
    : typeof chat?.transcript_turns === 'string'
    ? (() => { try { return JSON.parse(chat.transcript_turns); } catch { return []; } })()
    : [];

  turns.forEach((t: any) => {
    if (t?.text) parts.push(String(t.text));
  });

  // 2. Parameters reasoning & quotes
  const params = typeof chat?.parameters === 'string'
    ? (() => { try { return JSON.parse(chat.parameters); } catch { return {}; } })()
    : chat?.parameters;

  if (params && typeof params === 'object') {
    const list = Array.isArray(params) ? params : Object.values(params);
    list.forEach((p: any) => {
      if (p?.reasoning) parts.push(String(p.reasoning));
      if (p?.quote) parts.push(String(p.quote));
      if (p?.name) parts.push(String(p.name));
    });
  }

  // 3. AI Coaching Tip
  if (chat?.aiCoachingTip || chat?.ai_coaching_tip) {
    parts.push(String(chat.aiCoachingTip || chat.ai_coaching_tip));
  }

  // 4. Compliance Reason
  if (chat?.complianceReason || chat?.compliance_reason) {
    parts.push(String(chat.complianceReason || chat.compliance_reason));
  }

  // 5. Dispute & Override notes
  if (chat?.disputeReason || chat?.dispute_reason) {
    parts.push(String(chat.disputeReason || chat.dispute_reason));
  }
  if (chat?.tlOverrideNote || chat?.tl_override_note) {
    parts.push(String(chat.tlOverrideNote || chat.tl_override_note));
  }

  return parts.join(' ');
}

/**
 * Detects whether a WhatsApp conversation is a non-client hiring / recruitment interaction.
 */
export function isPcgHiringOrRecruitmentChat(turns: any[], summary?: string | null, customerName?: string | null): boolean {
  const textParts: string[] = [];
  if (summary) textParts.push(summary);
  if (customerName) textParts.push(customerName);
  if (Array.isArray(turns)) {
    for (const t of turns) {
      if (t?.text) textParts.push(String(t.text));
    }
  }
  const combined = textParts.join(' ').toLowerCase();

  // 1. Definite automated or RM rejection templates
  if (
    combined.includes('regret to inform you that we will not be moving forward') ||
    (combined.includes('thank you for taking the time to apply') && combined.includes('application')) ||
    (combined.includes('interest in exploring opportunities with us') && combined.includes('application')) ||
    combined.includes('does not reflect your abilities or potential')
  ) {
    return true;
  }

  // 2. Clear candidate and hiring query patterns
  const candidatePatterns = [
    /\b(?:shared|attached|sent)\s+(?:my\s+)?(?:resume|cv)\b/i,
    /\b(?:resume|cv)\s+(?:for|regarding)\s+(?:the\s+)?(?:role|position|opening|job)\b/i,
    /\b(?:job\s+application|job\s+openings?|hiring\s+for|openings?\s+related\s+to)\b/i,
    /\b(?:screening\s+(?:we\s+had|call|round|interview)|interview\s+update|application\s+update)\b/i,
    /\b(?:joining\s+formalities\s+with\s+hr|joining\s+formalities)\b/i,
    /\b(?:interview\s+round|interview\s+scheduled|hr\s+round)\b/i,
    /\b(?:applying|applied)\s+for\s+(?:the\s+)?(?:job|position|role|internship)\b/i,
    /\b(?:consider(?:ing)?\s+my\s+application)\b/i,
    /\b(?:shortlisted\s+for|notice\s+period\s+please\s+let\s+me\s+know)\b/i,
    /\b(?:investor\s+relations\s+position|operations\s+position)\b/i,
    /\b(?:apply|re-?apply)\s+(?:once\s+again|again)?\s*for\s+(?:the\s+)?(?:role|position|job)\b/i,
    /\b(?:suitable\s+openings|openings\s+in\s+the\s+future|openings\s+at\s+wint)\b/i,
    /\b(?:re-?applying\s+for\s+a\s+job|re-?applying\s+for\s+a\s+role)\b/i,
  ];

  for (const pat of candidatePatterns) {
    if (pat.test(combined)) return true;
  }
  return false;
}

/**
 * Detects which categories a chat belongs to.
 * Returns an array of category names (e.g. ['AIF'], ['AIF', 'PMS'], or ['General']).
 */
export function detectPcgChatCategories(chat: any): PcgProductCategory[] {
  if (!chat) return ['General'];

  // If already computed and populated on the chat object
  if (Array.isArray(chat.categories) && chat.categories.length > 0) {
    return chat.categories;
  }

  const fullText = extractFullChatText(chat);
  if (!fullText || fullText.trim().length === 0) {
    return ['General'];
  }

  const detected: PcgProductCategory[] = [];

  for (const { category, patterns } of CATEGORY_PATTERNS) {
    const matched = patterns.some((p) => p.test(fullText));
    if (matched) {
      detected.push(category);
    }
  }

  if (detected.length === 0) {
    return ['General'];
  }

  return detected;
}
