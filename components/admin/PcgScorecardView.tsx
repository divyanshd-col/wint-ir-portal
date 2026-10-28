'use client';

import React, { useState } from 'react';

const StarIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
  </svg>
);

export interface ScorecardComment {
  id: string;
  targetKey: string;
  text: string;
  highlighted: boolean;
  createdAt: string;
}

export interface PcgWeeklyReport {
  id: string;
  rmName: string;
  tlName: string;
  weekStart: string;
  weekEnd: string;
  status: string;
  viewedAt: string | null;
  generatedAt: string;
  comments: ScorecardComment[];
  numbers: {
    callsHandled: number;
    averageScore: number;
    below85Count: number;
    pickupRateText?: string;
    connectRateText?: string;
    complianceBreachesCount: number;
  };
  whatWentWell: string;
  themes: Array<{
    pattern: string;
    associatedParameters: string[];
    whyItMatters: string;
    actionable: string;
    isBreach: boolean;
    rankScore: number;
    backingCallIds: string[];
  }>;
  breaches: Array<{
    callId: string;
    score: number;
    flaggedContent: string;
    note: string;
  }>;
  evidence: Array<{
    callId: string;
    score: number;
    topic: string;
    summary: string;
  }>;
}

// Sample PCG / IR Weekly Scorecards matching the exact schema and layout of CX scorecards
const INITIAL_PCG_REPORTS: PcgWeeklyReport[] = [
  // ── ADITYA R (Week of Oct 12 - Oct 18, 2026) ──────────────────────────────────
  {
    id: 'pcg-rep-aditya-w1',
    rmName: 'Aditya R',
    tlName: 'Gokul',
    weekStart: '2026-10-12T00:00:00Z',
    weekEnd: '2026-10-18T23:59:59Z',
    status: 'active',
    viewedAt: null,
    generatedAt: '2026-10-19T08:59:35Z',
    comments: [],
    numbers: {
      callsHandled: 30,
      averageScore: 98.6,
      below85Count: 2,
      pickupRateText: '100% positive (13 of 13 rated good)',
      connectRateText: '100% positive (13 of 13 rated good)',
      complianceBreachesCount: 0,
    },
    whatWentWell:
      'Aditya R demonstrated great strength in maintaining a warm, readable tone while personalizing interactions and setting clear expectations with customers.',
    themes: [
      {
        pattern: 'Providing inaccurate information regarding dates and KB policy visibility, while missing secondary customer requests.',
        associatedParameters: ['Accuracy', 'IssueResolution'],
        whyItMatters:
          'Delivering complete and accurate information directly impacts Accuracy and IssueResolution, preventing customer confusion and repeated inquiries regarding policy limitations or account details.',
        actionable:
          'Verify date fields against account records before sending, check KB articles regarding system visibility rules before confirming status updates, and re-read messages to ensure all customer requests are answered.',
        isBreach: false,
        rankScore: 82,
        backingCallIds: ['175772', '174362'],
      },
    ],
    breaches: [],
    evidence: [
      {
        callId: '175772',
        score: 78,
        topic: '13% Club High-Yield Pitch',
        summary: 'Inaccurate date disclosure on allotment cycle; missed secondary query on tax deduction certificates.',
      },
      {
        callId: '174362',
        score: 82,
        topic: 'Bond Maturity Roll-over',
        summary: 'Did not verify account visibility rules before quoting turnaround time to investor.',
      },
    ],
  },
  // ── AKSA JACOB ────────────────────────────────────────────────────────────────
  {
    id: 'pcg-rep-aksa-w1',
    rmName: 'Aksa Jacob',
    tlName: 'Gokul',
    weekStart: '2026-10-12T00:00:00Z',
    weekEnd: '2026-10-18T23:59:59Z',
    status: 'active',
    viewedAt: null,
    generatedAt: '2026-10-19T08:59:35Z',
    comments: [],
    numbers: {
      callsHandled: 28,
      averageScore: 99.2,
      below85Count: 1,
      pickupRateText: '100% positive (11 of 11 rated good)',
      connectRateText: '100% positive (11 of 11 rated good)',
      complianceBreachesCount: 0,
    },
    whatWentWell:
      'Aksa showed outstanding empathy and thorough explanation of bond maturity options. Client feedback was universally positive across all interactions.',
    themes: [
      {
        pattern: 'Proactive Confirmation of Investor Tax Status',
        associatedParameters: ['Compliance', 'Active Listening'],
        whyItMatters:
          'Confirming TDS and Form 15G submission upfront prevents avoidable follow-up tickets post-allotment.',
        actionable:
          'Prompt clients about Form 15G submission requirements before finalizing tranche orders.',
        isBreach: false,
        rankScore: 88,
        backingCallIds: ['176110'],
      },
    ],
    breaches: [],
    evidence: [
      {
        callId: '176110',
        score: 84,
        topic: 'TDS & Form 15G Inquiry',
        summary: 'Addressed interest credit timelines clearly but did not verify email address for certificate delivery.',
      },
    ],
  },
  // ── ANISTO ───────────────────────────────────────────────────────────────────
  {
    id: 'pcg-rep-anisto-w1',
    rmName: 'Anisto',
    tlName: 'Vaishnavi',
    weekStart: '2026-10-12T00:00:00Z',
    weekEnd: '2026-10-18T23:59:59Z',
    status: 'active',
    viewedAt: null,
    generatedAt: '2026-10-19T08:59:35Z',
    comments: [],
    numbers: {
      callsHandled: 32,
      averageScore: 98.6,
      below85Count: 2,
      pickupRateText: '100% positive (14 of 14 rated good)',
      connectRateText: '100% positive (14 of 14 rated good)',
      complianceBreachesCount: 0,
    },
    whatWentWell:
      'Anisto demonstrated masterclass product knowledge on senior secured debentures and clear communication of monthly payout mechanics.',
    themes: [
      {
        pattern: 'Firm Callback Scheduling on Multi-Day Objections',
        associatedParameters: ['Follow-up Pacing', 'Commitment Lock'],
        whyItMatters:
          'Investors reviewing large allocations need designated callback windows rather than general check-ins.',
        actionable:
          'Always secure a specific date and time slot on the investor calendar before concluding consultation calls.',
        isBreach: false,
        rankScore: 85,
        backingCallIds: ['175890'],
      },
    ],
    breaches: [],
    evidence: [
      {
        callId: '175890',
        score: 81,
        topic: 'Tranche Allocation Discussion',
        summary: 'Excellent breakdown of asset cover, but ended consultation without locking a specific callback time.',
      },
    ],
  },
  // ── BHAVNA SHARMA ────────────────────────────────────────────────────────────
  {
    id: 'pcg-rep-bhavna-w1',
    rmName: 'Bhavna Sharma',
    tlName: 'Gokul',
    weekStart: '2026-10-12T00:00:00Z',
    weekEnd: '2026-10-18T23:59:59Z',
    status: 'active',
    viewedAt: null,
    generatedAt: '2026-10-19T08:59:35Z',
    comments: [],
    numbers: {
      callsHandled: 35,
      averageScore: 99.7,
      below85Count: 0,
      pickupRateText: '100% positive (18 of 18 rated good)',
      connectRateText: '100% positive (18 of 18 rated good)',
      complianceBreachesCount: 0,
    },
    whatWentWell:
      'Bhavna maintained near-perfect quality adherence across all 35 calls with zero calls below 85%. Pristine compliance and rapid resolution.',
    themes: [],
    breaches: [],
    evidence: [],
  },
  // ── NITYAA ───────────────────────────────────────────────────────────────────
  {
    id: 'pcg-rep-nityaa-w1',
    rmName: 'Nityaa',
    tlName: 'Vaishnavi',
    weekStart: '2026-10-12T00:00:00Z',
    weekEnd: '2026-10-18T23:59:59Z',
    status: 'active',
    viewedAt: null,
    generatedAt: '2026-10-19T08:59:35Z',
    comments: [],
    numbers: {
      callsHandled: 29,
      averageScore: 98.9,
      below85Count: 1,
      pickupRateText: '100% positive (12 of 12 rated good)',
      connectRateText: '100% positive (12 of 12 rated good)',
      complianceBreachesCount: 0,
    },
    whatWentWell:
      'Nityaa was commended by several investors for swift issue ownership and transparent explanations regarding demat credit timelines.',
    themes: [
      {
        pattern: 'Consistent Recap of Regulatory Risk Disclosures',
        associatedParameters: ['Compliance', 'Disclaimer'],
        whyItMatters:
          'Reciting standard capital risk disclosures reinforces Wint Wealth institutional credibility.',
        actionable:
          'Ensure the mandatory risk disclosure statement is articulated clearly before taking order reservations.',
        isBreach: false,
        rankScore: 86,
        backingCallIds: ['176044'],
      },
    ],
    breaches: [],
    evidence: [
      {
        callId: '176044',
        score: 83,
        topic: '13% Club Secondary Window',
        summary: 'Good pacing; secondary window process explained well, but risk disclosure was slightly rushed.',
      },
    ],
  },
  // ── PRIYAM ───────────────────────────────────────────────────────────────────
  {
    id: 'pcg-rep-priyam-w1',
    rmName: 'Priyam',
    tlName: 'Gokul',
    weekStart: '2026-10-12T00:00:00Z',
    weekEnd: '2026-10-18T23:59:59Z',
    status: 'active',
    viewedAt: null,
    generatedAt: '2026-10-19T08:59:35Z',
    comments: [],
    numbers: {
      callsHandled: 34,
      averageScore: 99.8,
      below85Count: 0,
      pickupRateText: '100% positive (15 of 15 rated good)',
      connectRateText: '100% positive (15 of 15 rated good)',
      complianceBreachesCount: 0,
    },
    whatWentWell:
      'Priyam delivered top-tier consultations with 99.8% average IQS. Impeccable tone, active listening, and precision across all customer touchpoints.',
    themes: [],
    breaches: [],
    evidence: [],
  },
  // ── SAHANA ───────────────────────────────────────────────────────────────────
  {
    id: 'pcg-rep-sahana-w1',
    rmName: 'Sahana',
    tlName: 'Vaishnavi',
    weekStart: '2026-10-12T00:00:00Z',
    weekEnd: '2026-10-18T23:59:59Z',
    status: 'active',
    viewedAt: null,
    generatedAt: '2026-10-19T08:59:35Z',
    comments: [],
    numbers: {
      callsHandled: 27,
      averageScore: 98.6,
      below85Count: 1,
      pickupRateText: '100% positive (10 of 10 rated good)',
      connectRateText: '100% positive (10 of 10 rated good)',
      complianceBreachesCount: 0,
    },
    whatWentWell:
      'Sahana showed high responsiveness and structured guidance during investor KYC onboarding inquiries.',
    themes: [
      {
        pattern: 'Confirming Bank Demat Name Match on Fresh Registrations',
        associatedParameters: ['Verification', 'Account Security'],
        whyItMatters:
          'Name mismatches between DigiLocker PAN and bank records cause transaction delays.',
        actionable:
          'Remind clients to ensure bank account registered name matches PAN records verbatim before placing orders.',
        isBreach: false,
        rankScore: 84,
        backingCallIds: ['175920'],
      },
    ],
    breaches: [],
    evidence: [
      {
        callId: '175920',
        score: 82,
        topic: 'KYC & DigiLocker Troubleshooting',
        summary: 'Resolved OTP issue quickly but forgot to recap bank name verification step.',
      },
    ],
  },
  // ── ADITYA R (Week of Oct 5 - Oct 11, 2026) ──────────────────────────────────
  {
    id: 'pcg-rep-aditya-w2',
    rmName: 'Aditya R',
    tlName: 'Gokul',
    weekStart: '2026-10-05T00:00:00Z',
    weekEnd: '2026-10-11T23:59:59Z',
    status: 'active',
    viewedAt: '2026-10-12T10:00:00Z',
    generatedAt: '2026-10-12T08:59:35Z',
    comments: [],
    numbers: {
      callsHandled: 26,
      averageScore: 95.4,
      below85Count: 3,
      pickupRateText: '96% positive (12 of 13 rated good)',
      connectRateText: '96% positive (12 of 13 rated good)',
      complianceBreachesCount: 0,
    },
    whatWentWell:
      'Aditya handled a surge of quarterly coupon payout calls with calmness and patience, resolving 92% on first contact.',
    themes: [
      {
        pattern: 'Clear Framing of Corporate Bond Maturity Dates',
        associatedParameters: ['Accuracy', 'Pacing'],
        whyItMatters: 'Investors need exact calendar dates for redemption proceeds.',
        actionable: 'Reference the verified depositories calendar before citing repayment dates.',
        isBreach: false,
        rankScore: 80,
        backingCallIds: ['174201', '174150'],
      },
    ],
    breaches: [],
    evidence: [
      {
        callId: '174201',
        score: 79,
        topic: 'Redemption Timeline',
        summary: 'Quoted 3 working days instead of T+2 depository timeline.',
      },
      {
        callId: '174150',
        score: 81,
        topic: 'Coupon Payout Query',
        summary: 'Answered query correctly but tone was slightly rushed.',
      },
    ],
  },
  // ── AAHAN THAKER (PCG RM) ────────────────────────────────────────────────────
  {
    id: 'pcg-rep-aahan-w1',
    rmName: 'Aahan Thaker',
    tlName: 'Gokul',
    weekStart: '2026-10-12T00:00:00Z',
    weekEnd: '2026-10-18T23:59:59Z',
    status: 'active',
    viewedAt: null,
    generatedAt: '2026-10-19T08:59:35Z',
    comments: [],
    numbers: {
      callsHandled: 30,
      averageScore: 98.6,
      below85Count: 2,
      pickupRateText: '100% positive (13 of 13 rated good)',
      connectRateText: '100% positive (13 of 13 rated good)',
      complianceBreachesCount: 0,
    },
    whatWentWell:
      'Aahan demonstrated great strength in maintaining a warm, readable tone while personalizing interactions and setting clear expectations with customers.',
    themes: [
      {
        pattern: 'Providing inaccurate information regarding dates and KB policy visibility, while missing secondary customer requests.',
        associatedParameters: ['Accuracy', 'IssueResolution'],
        whyItMatters:
          'Delivering complete and accurate information directly impacts Accuracy and IssueResolution, preventing customer confusion and repeated inquiries regarding policy limitations or account details.',
        actionable:
          'Verify date fields against account records before sending, check KB articles regarding system visibility rules before confirming status updates, and re-read messages to ensure all customer requests are answered.',
        isBreach: false,
        rankScore: 82,
        backingCallIds: ['175772', '174362'],
      },
    ],
    breaches: [],
    evidence: [
      {
        callId: '175772',
        score: 78,
        topic: '13% Club High-Yield Pitch',
        summary: 'Inaccurate date disclosure on allotment cycle; missed secondary query on tax deduction certificates.',
      },
      {
        callId: '174362',
        score: 82,
        topic: 'Bond Maturity Roll-over',
        summary: 'Did not verify account visibility rules before quoting turnaround time to investor.',
      },
    ],
  },
  // ── DHANUSH (PCG RM) ─────────────────────────────────────────────────────────
  {
    id: 'pcg-rep-dhanush-w1',
    rmName: 'Dhanush',
    tlName: 'Gokul',
    weekStart: '2026-10-12T00:00:00Z',
    weekEnd: '2026-10-18T23:59:59Z',
    status: 'active',
    viewedAt: null,
    generatedAt: '2026-10-19T08:59:35Z',
    comments: [],
    numbers: {
      callsHandled: 28,
      averageScore: 98.2,
      below85Count: 2,
      pickupRateText: '100% positive (12 of 12 rated good)',
      connectRateText: '100% positive (12 of 12 rated good)',
      complianceBreachesCount: 0,
    },
    whatWentWell:
      'Dhanush demonstrated strong objection handling on secondary liquidity and senior secured asset backing across calls.',
    themes: [
      {
        pattern: 'Premature Yield Commitment Before Investor Suitability Profiling',
        associatedParameters: ['Investor Profiling', 'Risk Disclosure'],
        whyItMatters:
          'PCG compliance rules mandate suitability verification before pitching high-yield debentures.',
        actionable:
          'Confirm the investor debt portfolio horizon and risk profile in the first 90 seconds before introducing specific 13% tranche allocations.',
        isBreach: false,
        rankScore: 82,
        backingCallIds: ['175101', '174820'],
      },
    ],
    breaches: [],
    evidence: [
      {
        callId: '175101',
        score: 79,
        topic: '13% Club High-Yield Pitch',
        summary: 'Rushed pitch, omitted capital risk disclosures, and did not confirm KYC readiness before quoting allocation.',
      },
      {
        callId: '174820',
        score: 83,
        topic: 'Tranche B Senior Secured',
        summary: 'Incomplete explanation of lock-in period and payout calendar during objection handling.',
      },
    ],
  },
  // ── YAASHVI ARORA (PCG RM) ───────────────────────────────────────────────────
  {
    id: 'pcg-rep-yaashvi-w1',
    rmName: 'Yaashvi Arora',
    tlName: 'Gokul',
    weekStart: '2026-10-12T00:00:00Z',
    weekEnd: '2026-10-18T23:59:59Z',
    status: 'active',
    viewedAt: null,
    generatedAt: '2026-10-19T08:59:35Z',
    comments: [],
    numbers: {
      callsHandled: 34,
      averageScore: 94.2,
      below85Count: 1,
      pickupRateText: '94% positive (16 of 17 rated good)',
      connectRateText: '74% connect rate',
      complianceBreachesCount: 0,
    },
    whatWentWell:
      'Yaashvi excelled in Pitch Clarity & Senior Secured Backing, consistently framing indicative yield and liquidity disclaimers with flawless precision.',
    themes: [
      {
        pattern: 'Occasional delay in sending post-call summary message within 15 minutes of call end',
        associatedParameters: ['Post-Call Recap & Follow-Through'],
        whyItMatters:
          'Prompt recap messages maintain investor confidence and document key discussions on lock-in periods.',
        actionable:
          'Use template recap messages immediately after wrapping the call to ensure 100% timely follow-through.',
        isBreach: false,
        rankScore: 88,
        backingCallIds: ['176012'],
      },
    ],
    breaches: [],
    evidence: [
      {
        callId: '176012',
        score: 84,
        topic: '12.5% Senior Secured Bond Allocation',
        summary: 'Excellent investment framing; recap message delivered 45 minutes after call end instead of standard 15-min SLA.',
      },
    ],
  },
  // ── GAURAV NAUTIYAL (PCG RM) ─────────────────────────────────────────────────
  {
    id: 'pcg-rep-gaurav-w1',
    rmName: 'Gaurav Nautiyal',
    tlName: 'Gokul',
    weekStart: '2026-10-12T00:00:00Z',
    weekEnd: '2026-10-18T23:59:59Z',
    status: 'active',
    viewedAt: null,
    generatedAt: '2026-10-19T08:59:35Z',
    comments: [],
    numbers: {
      callsHandled: 22,
      averageScore: 68.0,
      below85Count: 9,
      pickupRateText: '83.5% positive',
      connectRateText: '60% connect rate',
      complianceBreachesCount: 1,
    },
    whatWentWell:
      'Gaurav maintained a polite and professional tone and answered basic TDS and Form 15G submission queries accurately.',
    themes: [
      {
        pattern: 'Missing Mandatory Senior Secured Risk Disclosures & Secondary Window Caveats',
        associatedParameters: ['Pitch Clarity & Senior Secured Backing', 'Secondary Liquidity Window Framing'],
        whyItMatters:
          'Investors must explicitly hear risk parameters and understand that secondary windows depend on buyer availability.',
        actionable:
          'Mandatory adherence to the 3-step PCG disclosure protocol before proceeding with investment link generation.',
        isBreach: true,
        rankScore: 64,
        backingCallIds: ['175440', '175210'],
      },
    ],
    breaches: [
      {
        callId: '175440',
        score: 65,
        flaggedContent: 'You can withdraw anytime you like at 100% par value without buyer matching caveats.',
        note: 'Coaching assigned: reinforce that secondary sales are matched trades.',
      },
    ],
    evidence: [
      {
        callId: '175440',
        score: 65,
        topic: 'Early Exit Inquiry on 11.8% NBFC Bond',
        summary: 'Promised unconditional early redemption without citing secondary liquidity market dependence.',
      },
      {
        callId: '175210',
        score: 68,
        topic: 'Portfolio Reinvestment Call',
        summary: 'Skipped asset allocation discovery questions and jumped straight into product pitch.',
      },
    ],
  },
  // ── SWATI SINGH (PCG RM) ─────────────────────────────────────────────────────
  {
    id: 'pcg-rep-swati-w1',
    rmName: 'Swati Singh',
    tlName: 'Vaishnavi',
    weekStart: '2026-10-12T00:00:00Z',
    weekEnd: '2026-10-18T23:59:59Z',
    status: 'active',
    viewedAt: null,
    generatedAt: '2026-10-19T08:59:35Z',
    comments: [],
    numbers: {
      callsHandled: 26,
      averageScore: 69.5,
      below85Count: 8,
      pickupRateText: '84.0% positive',
      connectRateText: '61% connect rate',
      complianceBreachesCount: 0,
    },
    whatWentWell:
      'Swati was responsive and patient when explaining monthly interest payout dates to retail bondholders.',
    themes: [
      {
        pattern: 'Talking Over Investor Objections & Incomplete Demat Linking Clarifications',
        associatedParameters: ['Active Listening & Objection Handling', 'Demat Linking & Account Verification'],
        whyItMatters:
          'Active listening builds trust with High Net Worth investors who require detailed reassurance on custody security.',
        actionable:
          'Pause 2 seconds when investor raises concerns; use reflective questioning before presenting solutions.',
        isBreach: false,
        rankScore: 67,
        backingCallIds: ['175330', '174990'],
      },
    ],
    breaches: [],
    evidence: [
      {
        callId: '175330',
        score: 67,
        topic: 'Demat Custody Safety Inquiry',
        summary: 'Interrupted customer twice during safety objection; omitted depository participant explanation.',
      },
      {
        callId: '174990',
        score: 70,
        topic: 'Bond Transfer from External Broker',
        summary: 'Gave vague timeline on CMR copy verification SLA.',
      },
    ],
  },
  // ── SUJAL DADWANI (PCG RM) ───────────────────────────────────────────────────
  {
    id: 'pcg-rep-sujal-w1',
    rmName: 'Sujal Dadwani',
    tlName: 'Vaishnavi',
    weekStart: '2026-10-12T00:00:00Z',
    weekEnd: '2026-10-18T23:59:59Z',
    status: 'active',
    viewedAt: null,
    generatedAt: '2026-10-19T08:59:35Z',
    comments: [],
    numbers: {
      callsHandled: 28,
      averageScore: 87.0,
      below85Count: 3,
      pickupRateText: '86.5% positive',
      connectRateText: '65% connect rate',
      complianceBreachesCount: 0,
    },
    whatWentWell:
      'Sujal made remarkable improvements (+6.8% over two weeks), showing substantial mastery of Monthly Interest Payout timeline disclosures.',
    themes: [
      {
        pattern: 'Occasional hesitation in framing credit rating upgrade implications',
        associatedParameters: ['Pitch Clarity & Senior Secured Backing'],
        whyItMatters:
          'Accurately articulating rating rationale (e.g. CRISIL AA-) enhances investor confidence in yield spreads.',
        actionable:
          'Review issuer credit rating tear-sheets on Monday morning before investor calls.',
        isBreach: false,
        rankScore: 84,
        backingCallIds: ['175120'],
      },
    ],
    breaches: [],
    evidence: [
      {
        callId: '175120',
        score: 83,
        topic: 'CRISIL AA- Rated Issuer Inquiry',
        summary: 'Solid presentation; slight hesitation when explaining rating agency watch status.',
      },
    ],
  },
  // ── SAMSKRITI RAO (PCG RM) ───────────────────────────────────────────────────
  {
    id: 'pcg-rep-samskriti-w1',
    rmName: 'Samskriti Rao',
    tlName: 'Gokul',
    weekStart: '2026-10-12T00:00:00Z',
    weekEnd: '2026-10-18T23:59:59Z',
    status: 'active',
    viewedAt: null,
    generatedAt: '2026-10-19T08:59:35Z',
    comments: [],
    numbers: {
      callsHandled: 26,
      averageScore: 85.4,
      below85Count: 4,
      pickupRateText: '85.0% positive',
      connectRateText: '63% connect rate',
      complianceBreachesCount: 0,
    },
    whatWentWell:
      'Samskriti significantly improved her Secondary Liquidity Window framing (+5.8% 2-wk rolling delta).',
    themes: [
      {
        pattern: 'Pacing during complex tax calculation walk-throughs',
        associatedParameters: ['TDS & Form 15G Compliance'],
        whyItMatters:
          'Explaining 10% TDS vs nil deduction with Form 15G requires measured pacing to prevent confusion.',
        actionable:
          'Slow down speech rate and verify comprehension after explaining net post-tax return comparisons.',
        isBreach: false,
        rankScore: 83,
        backingCallIds: ['175050'],
      },
    ],
    breaches: [],
    evidence: [
      {
        callId: '175050',
        score: 82,
        topic: 'Form 15G and Senior Citizen Tax Exemption',
        summary: 'Rushed through TDS threshold numbers; investor requested repetition.',
      },
    ],
  },
  // ── ARAVIND (PCG RM) ─────────────────────────────────────────────────────────
  {
    id: 'pcg-rep-aravind-w1',
    rmName: 'Aravind',
    tlName: 'Vaishnavi',
    weekStart: '2026-10-12T00:00:00Z',
    weekEnd: '2026-10-18T23:59:59Z',
    status: 'active',
    viewedAt: null,
    generatedAt: '2026-10-19T08:59:35Z',
    comments: [],
    numbers: {
      callsHandled: 31,
      averageScore: 89.8,
      below85Count: 2,
      pickupRateText: '90.0% positive',
      connectRateText: '68% connect rate',
      complianceBreachesCount: 0,
    },
    whatWentWell:
      'Aravind demonstrated outstanding demat linking walk-throughs and clear account verification guidance.',
    themes: [
      {
        pattern: 'Opportunities to expand portfolio allocation sizing for ultra-HNW callers',
        associatedParameters: ['Asset Allocation Need Discovery'],
        whyItMatters:
          'Investors with >₹50L debt capital benefit from structured allocation across multiple credit tiers.',
        actionable:
          'Ask proactive questions regarding existing FD maturity calendar to recommend multi-asset laddering.',
        isBreach: false,
        rankScore: 86,
        backingCallIds: ['175290'],
      },
    ],
    breaches: [],
    evidence: [
      {
        callId: '175290',
        score: 85,
        topic: '₹1Cr Allocation Consultation',
        summary: 'Excellent demat explanation; missed discovery on cash reserve timing.',
      },
    ],
  },
  // ── ANTARA CHAKRABARTY (PCG RM) ──────────────────────────────────────────────
  {
    id: 'pcg-rep-antara-w1',
    rmName: 'Antara Chakrabarty',
    tlName: 'Vaishnavi',
    weekStart: '2026-10-12T00:00:00Z',
    weekEnd: '2026-10-18T23:59:59Z',
    status: 'active',
    viewedAt: null,
    generatedAt: '2026-10-19T08:59:35Z',
    comments: [],
    numbers: {
      callsHandled: 25,
      averageScore: 84.2,
      below85Count: 4,
      pickupRateText: '84.5% positive',
      connectRateText: '62% connect rate',
      complianceBreachesCount: 0,
    },
    whatWentWell:
      'Antara demonstrated consistent warm rapport and strong adherence to greeting and compliance standards.',
    themes: [
      {
        pattern: 'Consistency in following up with written WhatsApp recap summaries',
        associatedParameters: ['Post-Call Recap & Follow-Through'],
        whyItMatters:
          'High net worth investors prioritize documented confirmation of coupon payout frequency.',
        actionable:
          'Ensure immediate dispatch of standard summary sheet post call.',
        isBreach: false,
        rankScore: 82,
        backingCallIds: ['174910'],
      },
    ],
    breaches: [],
    evidence: [
      {
        callId: '174910',
        score: 81,
        topic: 'Quarterly Coupon Payment Schedule',
        summary: 'Good verbal explanation; delayed recap communication.',
      },
    ],
  },
];

interface Props {
  activePersona: 'admin' | 'tl' | 'agent';
  selectedRm: string;
  onSelectRm: (rm: string) => void;
  selectedTl: string;
  onSelectTl: (tl: string) => void;
  onOpenCallView: (cid: string) => void;
  onSwitchToCallsTab?: () => void;
}

export default function PcgScorecardView({
  activePersona,
  selectedRm,
  onSelectRm,
  selectedTl,
  onSelectTl,
  onOpenCallView,
  onSwitchToCallsTab,
}: Props) {
  const [reports, setReports] = useState<PcgWeeklyReport[]>(INITIAL_PCG_REPORTS);
  const [activeReportId, setActiveReportId] = useState<string>('pcg-rep-aditya-w1');

  // Filters matching CX pattern
  const [selectedAgentFilter, setSelectedAgentFilter] = useState<string>('all');
  const [selectedWeekFilter, setSelectedWeekFilter] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Synchronize selection with active report
  React.useEffect(() => {
    if (selectedRm) {
      const match = reports.find((r) => r.rmName.toLowerCase() === selectedRm.toLowerCase());
      if (match) {
        setActiveReportId(match.id);
        setSelectedAgentFilter(match.rmName);
      }
    }
  }, [activePersona, selectedRm, reports]);

  const activeReport = reports.find((r) => r.id === activeReportId) || reports[0];

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    const options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' };
    return d.toLocaleDateString('en-US', options);
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(text);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const uniqueAgents = Array.from(new Set(reports.map((r) => r.rmName)));

  const uniqueWeeksMap = new Map<string, string>();
  reports.forEach((r) => {
    if (r.weekStart && !uniqueWeeksMap.has(r.weekStart)) {
      uniqueWeeksMap.set(r.weekStart, `${formatDate(r.weekStart)} – ${formatDate(r.weekEnd)}`);
    }
  });
  const uniqueWeeks = Array.from(uniqueWeeksMap.entries()).sort((a, b) => b[0].localeCompare(a[0]));

  const filteredReports = reports.filter((r) => {
    const weekRange = `${formatDate(r.weekStart)} - ${formatDate(r.weekEnd)}`.toLowerCase();
    const agentMatch = activePersona === 'agent'
      ? r.rmName.toLowerCase() === selectedRm.toLowerCase()
      : selectedAgentFilter === 'all' || r.rmName === selectedAgentFilter;
    const weekFilterMatch = selectedWeekFilter === 'all' || r.weekStart === selectedWeekFilter;
    const searchMatch = !searchTerm.trim() ||
      r.rmName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      weekRange.includes(searchTerm.toLowerCase());
    return agentMatch && weekFilterMatch && searchMatch;
  });

  const numbers = activeReport?.numbers;

  return (
    <div className="flex flex-col lg:flex-row min-h-[calc(100vh-140px)] bg-[#F7F7F8] border border-[#E4E4E7] rounded-2xl overflow-hidden shadow-sm">
      {/* ── LEFT SIDEBAR: SCORECARD HISTORY (MATCHING CX EXACTLY) ─────────────── */}
      <aside className="w-full lg:w-72 border-b lg:border-b-0 lg:border-r border-[#E4E4E7] bg-white flex flex-col shrink-0 overflow-y-auto">
        <div className="p-4 border-b border-[#E4E4E7] bg-gray-50 flex items-center justify-between">
          <span className="font-bold text-gray-800 text-sm tracking-wide uppercase">Scorecard History</span>
        </div>

        {/* Agents Dropdown Filter (Admin/TL View) */}
        {activePersona !== 'agent' && uniqueAgents.length > 0 && (
          <div className="p-2 border-b border-[#E4E4E7] bg-white">
            <select
              value={selectedAgentFilter}
              onChange={(e) => setSelectedAgentFilter(e.target.value)}
              className="w-full px-3 py-1.5 text-xs border border-[#E4E4E7] rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 font-semibold bg-gray-50 text-gray-700 cursor-pointer"
            >
              <option value="all">All Agents</option>
              {uniqueAgents.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          </div>
        )}

        {/* Week Dropdown Filter */}
        {uniqueWeeks.length > 0 && (
          <div className="p-2 border-b border-[#E4E4E7] bg-white">
            <select
              value={selectedWeekFilter}
              onChange={(e) => setSelectedWeekFilter(e.target.value)}
              className="w-full px-3 py-1.5 text-xs border border-[#E4E4E7] rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 font-semibold bg-gray-50 text-gray-700 cursor-pointer"
            >
              <option value="all">All Weeks</option>
              {uniqueWeeks.map(([weekStart, label]) => (
                <option key={weekStart} value={weekStart}>{label}</option>
              ))}
            </select>
          </div>
        )}

        {/* Search Input */}
        <div className="p-2 border-b border-[#E4E4E7] bg-white">
          <input
            type="text"
            placeholder="Search by name or date..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full px-3 py-1.5 text-xs border border-[#E4E4E7] rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 font-medium bg-gray-50 hover:bg-gray-100/50 transition-all text-gray-700 placeholder-gray-400"
          />
        </div>

        {/* History List */}
        <nav className="flex-1 p-2 space-y-1">
          {filteredReports.length === 0 ? (
            <div className="text-center py-8 text-xs text-gray-400 font-medium">
              No matching scorecards found.
            </div>
          ) : (
            filteredReports.map((r) => {
              const isSelected = r.id === activeReportId;
              const weekRange = `${formatDate(r.weekStart)} - ${formatDate(r.weekEnd)}`;
              const score = r.numbers?.averageScore;

              return (
                <button
                  key={r.id}
                  onClick={() => {
                    setActiveReportId(r.id);
                    if (activePersona !== 'agent') {
                      onSelectRm(r.rmName);
                    }
                  }}
                  className={`w-full text-left p-3 rounded-lg transition-all duration-200 flex items-center justify-between group cursor-pointer ${
                    isSelected
                      ? 'bg-indigo-50 border border-indigo-200 text-indigo-900 shadow-sm'
                      : 'hover:bg-gray-50 border border-transparent text-gray-700'
                  }`}
                >
                  <div className="truncate flex-1 pr-2">
                    <div className="flex items-center gap-1.5">
                      <span className={`font-bold text-xs block truncate ${isSelected ? 'text-indigo-700' : 'text-gray-900'}`}>
                        {r.rmName}
                      </span>
                    </div>
                    <span className="text-xs text-gray-500 font-medium block mt-0.5 truncate">
                      {weekRange}
                    </span>
                  </div>
                  {score !== null && score !== undefined && (
                    <span
                      className={`text-xs font-bold font-mono px-2 py-0.5 rounded-md ${
                        score >= 85
                          ? 'bg-green-100 text-green-700 border border-green-200'
                          : score >= 70
                          ? 'bg-amber-100 text-amber-700 border border-amber-200'
                          : 'bg-red-100 text-red-700 border border-red-200'
                      }`}
                    >
                      {score}%
                    </span>
                  )}
                </button>
              );
            })
          )}
        </nav>
      </aside>

      {/* ── MAIN SCORECARD VIEW (MATCHING CX EXACTLY) ─────────────────────────── */}
      <main className="flex-1 overflow-y-auto p-8 relative bg-[#F7F7F8]">
        {activeReport ? (
          <div className="max-w-4xl mx-auto space-y-8">
            {/* Header info */}
            <div className="flex flex-col md:flex-row md:items-center md:justify-between pb-6 border-b border-[#E4E4E7]">
              <div>
                <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">
                  {activePersona === 'agent' ? 'My Weekly Scorecard' : 'PCG Weekly RM Scorecard'}
                </h1>
                <p className="text-sm text-gray-500 font-medium mt-1">
                  Week of {formatDate(activeReport.weekStart)} to {formatDate(activeReport.weekEnd)}
                </p>
                <p className="text-sm font-semibold text-indigo-700 mt-0.5">
                  RM Name: {activeReport.rmName}
                </p>
              </div>
              <div className="mt-4 md:mt-0 flex items-center gap-3">
                <span className="text-xs text-gray-400 font-medium font-mono">
                  Generated at {new Date(activeReport.generatedAt).toLocaleString('en-GB')}
                </span>
              </div>
            </div>

            {/* ── 1. THE NUMBERS SECTION ─────────────────────────────────────── */}
            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                  <span className="bg-indigo-100 text-indigo-700 w-6 h-6 rounded-full inline-flex items-center justify-center text-xs font-bold font-mono">
                    1
                  </span>
                  The Numbers
                </h2>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
                {/* Calls Handled */}
                <div className="bg-white p-4 rounded-xl border border-[#E4E4E7] shadow-sm flex flex-col justify-between">
                  <span className="text-xs font-bold text-gray-400 uppercase tracking-wider block">
                    Calls Handled
                  </span>
                  <span className="text-2xl font-extrabold text-gray-900 font-mono mt-2">
                    {numbers?.callsHandled ?? 0}
                  </span>
                </div>

                {/* Avg IQS Score */}
                <div className="bg-white p-4 rounded-xl border border-[#E4E4E7] shadow-sm flex flex-col justify-between">
                  <span className="text-xs font-bold text-gray-400 uppercase tracking-wider block">
                    Avg IQS Score
                  </span>
                  <span
                    className={`text-2xl font-extrabold font-mono mt-2 ${
                      numbers?.averageScore !== null && numbers.averageScore >= 85
                        ? 'text-green-600'
                        : numbers?.averageScore !== null && numbers.averageScore >= 70
                        ? 'text-amber-600'
                        : 'text-red-600'
                    }`}
                  >
                    {numbers?.averageScore != null ? `${numbers.averageScore}%` : '—'}
                  </span>
                </div>

                {/* Below 85 Score */}
                <div className="bg-white p-4 rounded-xl border border-[#E4E4E7] shadow-sm flex flex-col justify-between">
                  <span className="text-xs font-bold text-gray-400 uppercase tracking-wider block">
                    Below 85 Score
                  </span>
                  <span
                    className={`text-2xl font-extrabold font-mono mt-2 ${
                      numbers?.below85Count > 0 ? 'text-amber-600' : 'text-gray-900'
                    }`}
                  >
                    {numbers?.below85Count ?? 0}
                  </span>
                </div>

                {/* Pickup Rate */}
                <div className="bg-white p-4 rounded-xl border border-[#E4E4E7] shadow-sm flex flex-col col-span-2 justify-between">
                  <span className="text-xs font-bold text-gray-400 uppercase tracking-wider block">
                    Pickup Rate
                  </span>
                  <span
                    className="text-xs font-semibold text-gray-800 mt-3 bg-zinc-50 p-1.5 rounded-lg border border-zinc-200 text-center truncate"
                    title={numbers?.pickupRateText || numbers?.connectRateText}
                  >
                    {numbers?.pickupRateText || numbers?.connectRateText || '92% pickup rate'}
                  </span>
                </div>

                {/* Compliance Breaches */}
                <div className="bg-white p-4 rounded-xl border border-[#E4E4E7] shadow-sm flex flex-col justify-between">
                  <span className="text-xs font-bold text-gray-400 uppercase tracking-wider block">
                    Breaches
                  </span>
                  <span
                    className={`text-2xl font-extrabold font-mono mt-2 ${
                      numbers?.complianceBreachesCount > 0
                        ? 'text-red-600 animate-pulse'
                        : 'text-gray-900'
                    }`}
                  >
                    {numbers?.complianceBreachesCount ?? 0}
                  </span>
                </div>
              </div>
            </div>

            {/* ── WHAT WENT WELL ─────────────────────────────────────────────── */}
            <div className="bg-green-50/50 border border-green-200/80 rounded-2xl p-6 relative overflow-hidden">
              <div className="absolute right-0 bottom-0 opacity-10 pointer-events-none transform translate-y-4 translate-x-2">
                <svg className="w-40 h-40 text-green-700" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 2l3.09 6.26 6.91.97-5 4.89 1.18 6.88L12 17.77l-6.18 3.25L7 14.12 2 9.23l6.91-.97L12 2z" />
                </svg>
              </div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-extrabold text-green-800 uppercase tracking-wider flex items-center gap-1.5">
                  <StarIcon /> What Went Well
                </h3>
              </div>
              <p className="text-green-950 font-bold text-base leading-relaxed">
                {activeReport.whatWentWell}
              </p>
            </div>

            {/* ── 2. 1-ON-1 DISCUSSION POINTS ─────────────────────────────────── */}
            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                  <span className="bg-indigo-100 text-indigo-700 w-6 h-6 rounded-full inline-flex items-center justify-center text-xs font-bold font-mono">
                    2
                  </span>
                  1-on-1 Discussion Points
                </h2>
              </div>

              {activeReport.themes && activeReport.themes.length > 0 ? (
                <div className="space-y-4">
                  {activeReport.themes.map((theme, index) => (
                    <div
                      key={index}
                      className={`bg-white rounded-2xl border shadow-sm p-6 space-y-4 transition-all hover:shadow-md ${
                        theme.isBreach ? 'border-red-200 bg-red-50/10' : 'border-[#E4E4E7]'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex items-center gap-2 flex-wrap">
                          {theme.isBreach && (
                            <span className="bg-red-100 text-red-800 text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full border border-red-200 tracking-wider">
                              Compliance Breach Root
                            </span>
                          )}
                          <h4 className="font-bold text-gray-900 text-base">
                            {theme.pattern}
                          </h4>
                        </div>
                      </div>

                      <div className="grid md:grid-cols-2 gap-4 text-sm text-gray-700">
                        <div>
                          <span className="text-xs font-bold text-gray-400 uppercase tracking-wider block">
                            Why it Matters
                          </span>
                          <p className="mt-1 text-gray-600 font-medium leading-relaxed">
                            {theme.whyItMatters}
                          </p>
                        </div>
                        <div>
                          <span className="text-xs font-bold text-gray-400 uppercase tracking-wider block">
                            Actionable Behavior Change
                          </span>
                          <p className="mt-1 text-gray-900 font-bold leading-relaxed">
                            {theme.actionable}
                          </p>
                        </div>
                      </div>

                      {/* Evidence Calls (Clickable to redirect to that Call Evaluation) */}
                      <div className="pt-2 flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">
                          Evidence:
                        </span>
                        {theme.backingCallIds?.map((cid: string) => (
                          <div
                            key={cid}
                            className="flex items-center bg-gray-100 hover:bg-indigo-50 hover:border-indigo-300 text-gray-700 hover:text-indigo-700 text-xs font-bold px-2.5 py-1 rounded-md border border-gray-200 font-mono transition-all group"
                          >
                            <button
                              type="button"
                              onClick={() => onOpenCallView(cid)}
                              className="hover:underline flex items-center gap-1 cursor-pointer"
                              title={`Redirect to Call #${cid} Evaluation`}
                            >
                              <span>Call #{cid.replace('call-', '').replace('runo-', '')}</span>
                              <svg className="w-3 h-3 text-indigo-500 opacity-0 group-hover:opacity-100 transition-opacity" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                              </svg>
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleCopy(cid);
                              }}
                              className="ml-1.5 text-gray-400 hover:text-indigo-600 p-0.5 cursor-pointer"
                              title="Copy Call ID"
                            >
                              {copiedId === cid ? (
                                <svg className="w-3.5 h-3.5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" />
                                </svg>
                              ) : (
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M8 5H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-1M8 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M8 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2m0 0h2a2 2 0 0 1 2 2v3" />
                                </svg>
                              )}
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="bg-white rounded-2xl border border-gray-200 p-6 text-center text-gray-500 font-medium">
                  🎉 Fantastic week! No low-scoring call themes were identified. Keep up the excellent work!
                </div>
              )}
            </div>

            {/* ── 3. FULL EVIDENCE LIST (LOW-SCORING CALLS) ────────────────────── */}
            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                  <span className="bg-indigo-100 text-indigo-700 w-6 h-6 rounded-full inline-flex items-center justify-center text-xs font-bold font-mono">
                    3
                  </span>
                  Full Evidence List (Low-Scoring Calls)
                </h2>
              </div>

              {activeReport.evidence && activeReport.evidence.length > 0 ? (
                <div className="bg-white rounded-2xl border border-[#E4E4E7] shadow-sm overflow-hidden">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr className="bg-gray-50 border-b border-[#E4E4E7] text-xs text-gray-400 font-bold uppercase tracking-wider text-left">
                        <th className="p-4">Call ID</th>
                        <th className="p-4 text-center">Score</th>
                        <th className="p-4">Topic / Disposition</th>
                        <th className="p-4">Primary Coaching Point / Issue</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E4E4E7] text-xs text-gray-700">
                      {activeReport.evidence.map((ev) => (
                        <tr key={ev.callId} className="hover:bg-gray-50 transition-all">
                          <td className="p-4 font-mono font-bold text-indigo-700 whitespace-nowrap">
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => onOpenCallView(ev.callId)}
                                className="hover:underline flex items-center gap-1 cursor-pointer text-indigo-700 font-bold"
                                title={`Redirect to Call #${ev.callId} Evaluation`}
                              >
                                <span>Call #{ev.callId.replace('call-', '').replace('runo-', '')}</span>
                                <svg className="w-3.5 h-3.5 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                </svg>
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleCopy(ev.callId);
                                }}
                                className="ml-1 text-gray-400 hover:text-indigo-600 p-0.5 cursor-pointer"
                                title="Copy Call ID"
                              >
                                {copiedId === ev.callId ? (
                                  <svg className="w-3.5 h-3.5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" />
                                  </svg>
                                ) : (
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M8 5H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-1M8 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M8 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2m0 0h2a2 2 0 0 1 2 2v3" />
                                  </svg>
                                )}
                              </button>
                            </div>
                          </td>
                          <td className="p-4 text-center whitespace-nowrap">
                            {/* QA / TL UPDATED OPTION REMOVED AS REQUESTED */}
                            <span
                              className={`text-xs font-extrabold font-mono px-2 py-0.5 rounded ${
                                ev.score >= 85
                                  ? 'bg-green-50 text-green-700 border border-green-200'
                                  : ev.score >= 70
                                  ? 'bg-amber-50 text-amber-700 border border-amber-200'
                                  : 'bg-red-50 text-red-700 border border-red-200'
                              }`}
                            >
                              {ev.score}%
                            </span>
                          </td>
                          <td className="p-4 font-semibold text-gray-800 whitespace-nowrap">
                            {ev.topic}
                          </td>
                          <td className="p-4 text-gray-600 font-medium">
                            {ev.summary}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="bg-white rounded-2xl border border-gray-200 p-6 text-center text-gray-500 font-medium">
                  No low-scoring calls to display this week. Excellent!
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="text-center py-24 text-gray-400 font-medium">
            No scorecard selected. Select a report from the history on the left.
          </div>
        )}
      </main>
    </div>
  );
}
