import type { PortalConfig } from './config';

export type CsatBifurcationType = 'solvable' | 'unsolvable';

export interface CsatBifurcationEntry {
  disposition: string;
  subDisposition: string;
  type: CsatBifurcationType;
}

export const DEFAULT_CSAT_BIFURCATION: CsatBifurcationEntry[] = [
  // ── Unsolvable (17 pairs) ──────────────────────────────────────────────────
  { disposition: 'Interest Repayment', subDisposition: 'Interest / Principal Not Credited', type: 'unsolvable' },
  { disposition: 'Bond Purchase', subDisposition: 'Bond Purchase Issue', type: 'unsolvable' },
  { disposition: 'Bond Purchase', subDisposition: 'Net Banking Unavailable', type: 'unsolvable' },
  { disposition: 'Liquidity', subDisposition: 'Liquidity Funds Not Received', type: 'unsolvable' },
  { disposition: 'Taxation', subDisposition: 'Form 121 Not Available', type: 'unsolvable' },
  { disposition: 'Taxation', subDisposition: 'Form 121 bugs', type: 'unsolvable' },
  { disposition: 'FD', subDisposition: 'FD Withdrawal', type: 'unsolvable' },
  { disposition: 'FD', subDisposition: 'FD Not Visible in Portfolio', type: 'unsolvable' },
  { disposition: 'FD', subDisposition: 'FD Bugs', type: 'unsolvable' },
  { disposition: 'SGB', subDisposition: 'SGBs Not Visible in Portfolio', type: 'unsolvable' },
  { disposition: 'KYC', subDisposition: 'Bank Account linking issues', type: 'unsolvable' },
  { disposition: 'KYC', subDisposition: 'KYC Status', type: 'unsolvable' },
  { disposition: 'KYC', subDisposition: 'Selfie Capture', type: 'unsolvable' },
  { disposition: 'KYC', subDisposition: 'SEBI KYC NSDL SPEEDE', type: 'unsolvable' },
  { disposition: 'Dashboard and Profile Query', subDisposition: 'Login & OTP Issue', type: 'unsolvable' },
  { disposition: 'Dashboard and Profile Query', subDisposition: 'App and Dashboard Bugs', type: 'unsolvable' },
  { disposition: 'Referral Program', subDisposition: 'Refer & Earn Not Activated', type: 'unsolvable' },

  // ── Solvable (51 pairs) ────────────────────────────────────────────────────
  { disposition: 'Asset', subDisposition: 'Asset General Enquiry', type: 'solvable' },
  { disposition: 'Asset', subDisposition: 'Asset Risk', type: 'solvable' },
  { disposition: 'Asset', subDisposition: 'Asset Specific Requirement', type: 'solvable' },
  { disposition: 'Asset', subDisposition: 'Asset Limit', type: 'solvable' },
  { disposition: 'Asset', subDisposition: 'Asset NRI', type: 'solvable' },
  { disposition: 'Asset', subDisposition: 'Asset Covenant Breach', type: 'solvable' },
  { disposition: 'Bond Purchase', subDisposition: 'Bond Purchase Order Status', type: 'solvable' },
  { disposition: 'Bond Purchase', subDisposition: 'Bond Purchase Cancellation', type: 'solvable' },
  { disposition: 'Bond Purchase', subDisposition: 'Bond Purchase Process', type: 'solvable' },
  { disposition: 'Bond Purchase', subDisposition: 'MLD purchase', type: 'solvable' },
  { disposition: 'Taxation', subDisposition: 'Form 121', type: 'solvable' },
  { disposition: 'Taxation', subDisposition: 'Tax Deduction', type: 'solvable' },
  { disposition: 'Taxation', subDisposition: 'Taxation Statement/Reports', type: 'solvable' },
  { disposition: 'Taxation', subDisposition: 'Form 121 Status & Confirmation', type: 'solvable' },
  { disposition: 'Taxation', subDisposition: 'Taxation TDS Certificate', type: 'solvable' },
  { disposition: 'Taxation', subDisposition: 'Taxation Capital Gain/Loss', type: 'solvable' },
  { disposition: 'Interest Repayment', subDisposition: 'Interest Repayment When/Where', type: 'solvable' },
  { disposition: 'Interest Repayment', subDisposition: 'Interest Repayment Breakup', type: 'solvable' },
  { disposition: 'Interest Repayment', subDisposition: 'Asset YTM/Coupon', type: 'solvable' },
  { disposition: 'Flexi-Tenure Bond', subDisposition: 'Flexi General Enquiry', type: 'solvable' },
  { disposition: 'Flexi-Tenure Bond', subDisposition: 'Flexi Tenure Change', type: 'solvable' },
  { disposition: 'Flexi-Tenure Bond', subDisposition: 'Flexi Sell Process', type: 'solvable' },
  { disposition: 'Flexi-Tenure Bond', subDisposition: 'Flexi Interest', type: 'solvable' },
  { disposition: 'KYC', subDisposition: 'SEBI KYC Delete Account', type: 'solvable' },
  { disposition: 'KYC', subDisposition: 'Aadhar / PAN Queries', type: 'solvable' },
  { disposition: 'KYC', subDisposition: 'SEBI KYC Demat Query', type: 'solvable' },
  { disposition: 'KYC', subDisposition: 'SEBI KYC HUF', type: 'solvable' },
  { disposition: 'KYC', subDisposition: 'Profile Change', type: 'solvable' },
  { disposition: 'KYC', subDisposition: 'KYC Process and Steps', type: 'solvable' },
  { disposition: 'KYC', subDisposition: 'SEBI KYC Documents', type: 'solvable' },
  { disposition: 'KYC', subDisposition: 'Nominee', type: 'solvable' },
  { disposition: 'KYC', subDisposition: 'SEBI KYC Details Change', type: 'solvable' },
  { disposition: 'KYC', subDisposition: 'ACF Link Generation', type: 'solvable' },
  { disposition: 'Liquidity', subDisposition: 'Liquidity General Enquiry', type: 'solvable' },
  { disposition: 'Liquidity', subDisposition: 'Liquidity Process', type: 'solvable' },
  { disposition: 'Liquidity', subDisposition: 'Liquidity Cancellation', type: 'solvable' },
  { disposition: 'Liquidity', subDisposition: 'Liquidity Charges', type: 'solvable' },
  { disposition: 'Liquidity', subDisposition: 'Liquidity Status Update', type: 'solvable' },
  { disposition: 'Liquidity', subDisposition: 'Liquidity DDPI Status', type: 'solvable' },
  { disposition: 'Liquidity', subDisposition: 'Interest Payout After Selling a Bond', type: 'solvable' },
  { disposition: 'SIP', subDisposition: 'SIP General Enquiry', type: 'solvable' },
  { disposition: 'SIP', subDisposition: 'SIP Modification', type: 'solvable' },
  { disposition: 'SIP', subDisposition: 'SIP Cancellation', type: 'solvable' },
  { disposition: 'SIP', subDisposition: 'SIP Instalment Skip', type: 'solvable' },
  { disposition: 'Referral Program', subDisposition: 'Referred User Not Showing', type: 'solvable' },
  { disposition: 'Referral Program', subDisposition: 'Referral Reward Calculation', type: 'solvable' },
  { disposition: 'Referral Program', subDisposition: 'Referral Program General Enquiry', type: 'solvable' },
  { disposition: 'Dashboard and Profile Query', subDisposition: 'Dashboard - Portfolio values', type: 'solvable' },
  { disposition: 'Dashboard and Profile Query', subDisposition: 'Dashboard and App Navigation', type: 'solvable' },
  { disposition: 'Dashboard and Profile Query', subDisposition: 'Dashboard - General Query', type: 'solvable' },
  { disposition: 'MLD', subDisposition: 'MLD General Enquiry', type: 'solvable' },
  { disposition: 'MLD', subDisposition: 'MLD Product Request', type: 'solvable' },
  { disposition: 'MLD', subDisposition: 'MLD Liquidity', type: 'solvable' },
  { disposition: 'Calls_Directly', subDisposition: 'MLD Calls', type: 'solvable' },
  { disposition: 'AIF', subDisposition: 'AIF General Enquiry', type: 'solvable' },
  { disposition: 'AIF', subDisposition: 'AIF Eligibility', type: 'solvable' },
  { disposition: 'AIF', subDisposition: 'AIF Liquidity', type: 'solvable' },
  { disposition: 'Wint Ivory', subDisposition: 'Wint Ivory General Query', type: 'solvable' },
  { disposition: 'Wint Ivory', subDisposition: 'Wint Ivory Required', type: 'solvable' },
  { disposition: 'Wint Wisdom', subDisposition: 'Portfolio and Risk', type: 'solvable' },
  { disposition: 'Diversification Meter', subDisposition: 'Diversification Meter General', type: 'solvable' },
  { disposition: 'FD', subDisposition: 'FD Interest', type: 'solvable' },
  { disposition: 'SGB', subDisposition: 'SGB Enquiry', type: 'solvable' },
  { disposition: 'Family Account', subDisposition: 'Family Account General Query', type: 'solvable' },
  { disposition: 'Others', subDisposition: 'Advisory', type: 'solvable' },
  { disposition: 'Others', subDisposition: 'Unsubscribe Whatsapp', type: 'solvable' },
  { disposition: 'Others', subDisposition: 'Partnership', type: 'solvable' },
  { disposition: 'Others', subDisposition: 'Request for RM', type: 'solvable' },
];

/** Normalizes a lookup key from disposition and subDisposition */
export function makeBifurcationKey(disposition: string, subDisposition: string): string {
  return `${(disposition || '').trim().toLowerCase()}::${(subDisposition || '').trim().toLowerCase()}`;
}

/** Returns the active bifurcation list from config, falling back to defaults */
export function getCsatBifurcationList(config?: Partial<PortalConfig> | null): CsatBifurcationEntry[] {
  if (Array.isArray(config?.csatBifurcationMap) && config.csatBifurcationMap.length > 0) {
    return config.csatBifurcationMap;
  }
  return DEFAULT_CSAT_BIFURCATION;
}

/** Builds a fast lookup map: `disposition::sub_disposition` -> `'solvable' | 'unsolvable'` */
export function buildBifurcationLookup(list: CsatBifurcationEntry[]): Map<string, CsatBifurcationType> {
  const map = new Map<string, CsatBifurcationType>();
  for (const entry of list) {
    if (entry.disposition && entry.subDisposition) {
      map.set(makeBifurcationKey(entry.disposition, entry.subDisposition), entry.type);
    }
  }
  return map;
}

export interface ChatCsatClassification {
  bifurcation: CsatBifurcationType | null;
  bifurcatedCsatLabel: 'good' | 'could_be_better' | 'bad' | null;
}

/**
 * Classifies a chat as Solvable or Unsolvable, and determines the bifurcated CSAT score label.
 *
 * Rules:
 * 1. If not mapped in bifurcation settings: bifurcation is null, keeps raw CSAT label.
 * 2. If 'solvable':
 *    - bifurcation = 'solvable'
 *    - bifurcatedCsatLabel = rawCsatLabel (customer's raw rating is retained).
 * 3. If 'unsolvable':
 *    - bifurcation = 'unsolvable'
 *    - If customer provided a CSAT rating (rawCsatLabel is not null):
 *      - If agent IQS >= 90: upgraded to 'good'!
 *      - Else: keeps raw customer rating.
 *    - If customer did not provide CSAT: remains null.
 */
export function classifyChatCsat(
  disposition?: string | null,
  subDisposition?: string | null,
  iqsScore?: number | null,
  rawCsatLabel?: string | null,
  config?: Partial<PortalConfig> | null,
): ChatCsatClassification {
  const normalizedRaw = rawCsatLabel ? (rawCsatLabel.toLowerCase().trim() as 'good' | 'could_be_better' | 'bad') : null;

  if (!disposition || !subDisposition) {
    return { bifurcation: null, bifurcatedCsatLabel: normalizedRaw };
  }

  const list = getCsatBifurcationList(config);
  const lookup = buildBifurcationLookup(list);
  const type = lookup.get(makeBifurcationKey(disposition, subDisposition));

  if (!type) {
    return { bifurcation: null, bifurcatedCsatLabel: normalizedRaw };
  }

  if (type === 'solvable') {
    return {
      bifurcation: 'solvable',
      bifurcatedCsatLabel: normalizedRaw,
    };
  }

  // type === 'unsolvable'
  if (!normalizedRaw) {
    return {
      bifurcation: 'unsolvable',
      bifurcatedCsatLabel: null,
    };
  }

  // For unsolvable chats with customer rating:
  // If IQS >= 90, upgrade to 'good' CSAT
  const iqsNum = typeof iqsScore === 'number' ? iqsScore : null;
  const isUpgradedToGood = iqsNum !== null && iqsNum >= 90;

  return {
    bifurcation: 'unsolvable',
    bifurcatedCsatLabel: isUpgradedToGood ? 'good' : normalizedRaw,
  };
}
