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
    connectRateText: string;
    complianceBreachesCount: number;
    scoresAdjustedCount: number;
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
    isReviewed?: boolean;
    reviewNote?: string;
  }>;
}

// Sample PCG Weekly Scorecards matching the exact schema and richness of RM reports
const INITIAL_PCG_REPORTS: PcgWeeklyReport[] = [
  // ── AAHAN THAKER (RM) ────────────────────────────────────────────────────────
  {
    id: 'pcg-rep-aahan-w1',
    rmName: 'Aahan Thaker',
    tlName: 'Gokul',
    weekStart: '2026-10-06T00:00:00Z',
    weekEnd: '2026-10-12T23:59:59Z',
    status: 'active',
    viewedAt: null,
    generatedAt: '2026-10-12T18:30:00Z',
    comments: [
      {
        id: 'c-aahan-1',
        targetKey: 'general',
        text: 'Discussed during 1-on-1: Solid product explanations on 13% Club; maintain steady pacing during secondary liquidity disclaimer.',
        highlighted: true,
        createdAt: '2026-10-12T19:15:00Z',
      },
    ],
    numbers: {
      callsHandled: 15,
      averageScore: 87,
      below85Count: 2,
      connectRateText: '60.0% connected (9 of 15)',
      complianceBreachesCount: 0,
      scoresAdjustedCount: 1,
    },
    whatWentWell:
      'Aahan demonstrated great professionalism and structured product explanations. Key coupon payout timelines and senior secured backing aspects were articulated clearly. Customer verification and call protocol were adhered to with high consistency.',
    themes: [
      {
        pattern: 'Crisp Yield & Secondary Market Window Framing',
        associatedParameters: ['Product Benefits', 'Liquidity Positioning'],
        whyItMatters:
          'Explaining the secondary liquidity window upfront reassures investors on emergency access while maintaining the 3-year investment horizon expectation.',
        actionable:
          'Proactively cite the secondary sale window when investors query early redemption options.',
        isBreach: false,
        rankScore: 88,
        backingCallIds: ['6ad1b3fb6ff6ad4fe4a38288', '6ad1c607f5277b2f769dd72a'],
      },
      {
        pattern: 'Firm Allotment & Follow-up Commitment',
        associatedParameters: ['Follow-up Timeline', 'Next Steps'],
        whyItMatters:
          'HNW prospects appreciate firm callback slots rather than vague future check-ins.',
        actionable:
          'Lock down the next check-in with an exact date and time on WhatsApp/Calendar before disconnecting.',
        isBreach: false,
        rankScore: 85,
        backingCallIds: ['6ad1c607f5277b2f769dd72a'],
      },
    ],
    breaches: [],
    evidence: [
      {
        callId: '6ad1b3fb6ff6ad4fe4a38288',
        score: 88,
        topic: '13% Club High-Yield Pitch',
        summary: 'Clear positioning of indicative yield, monthly cash flows, and regulated NBFC partner structure.',
      },
      {
        callId: '6ad1c607f5277b2f769dd72a',
        score: 86,
        topic: 'Upselling Senior Secured Debentures',
        summary: 'Addressed investor questions on quarterly interest crediting directly to bank account.',
      },
    ],
  },
  // ── DHANUSH (RM) ─────────────────────────────────────────────────────────────
  {
    id: 'pcg-rep-dhanush-w1',
    rmName: 'Dhanush',
    tlName: 'Gokul',
    weekStart: '2026-10-06T00:00:00Z',
    weekEnd: '2026-10-12T23:59:59Z',
    status: 'active',
    viewedAt: null,
    generatedAt: '2026-10-12T18:30:00Z',
    comments: [
      {
        id: 'c1',
        targetKey: 'general',
        text: 'Discussed during Monday catchup: focus on asking suitability profiling questions prior to giving yield quotes.',
        highlighted: true,
        createdAt: '2026-10-12T19:15:00Z',
      },
    ],
    numbers: {
      callsHandled: 142,
      averageScore: 88,
      below85Count: 14,
      connectRateText: '68.4% connected (97 of 142)',
      complianceBreachesCount: 1,
      scoresAdjustedCount: 2,
    },
    whatWentWell:
      'Dhanush demonstrated exceptional clarity when explaining the 13% Club coupon payout structure and senior secured backing. Objection handling on tenure liquidity was executed smoothly without pushy sales pressure. Call consent and greeting protocols were adhered to across 100% of connected calls.',
    themes: [
      {
        pattern: 'Premature Yield Commitment Before Investor Suitability Profiling',
        associatedParameters: ['Investor Profiling', 'Risk Disclosure'],
        whyItMatters:
          'PCG compliance rules mandate suitability verification before pitching high-yield debentures. Quoting 13% yield upfront without knowing risk tolerance triggers investor drop-offs.',
        actionable:
          'Confirm the investor debt portfolio horizon and risk profile in the first 90 seconds before introducing specific 13% tranche allocations.',
        isBreach: true,
        rankScore: 82,
        backingCallIds: ['PCG-9942', 'PCG-9883'],
      },
      {
        pattern: 'Incomplete Post-Call Recap & Next Allotment Timeline',
        associatedParameters: ['Post-Call Recap', 'Action Items'],
        whyItMatters:
          'HNW prospects require exact written dates for debenture allotment, interest credit schedules, and demat transfer steps.',
        actionable:
          'Summarize next steps clearly at the end of the call and offer to trigger the automated WhatsApp/Email tranche datasheet immediately.',
        isBreach: false,
        rankScore: 86,
        backingCallIds: ['PCG-9712', 'PCG-9620'],
      },
    ],
    breaches: [
      {
        callId: 'PCG-9942',
        score: 68,
        flaggedContent: "RM stated: 'You are guaranteed 13% with zero chance of capital loss' without reciting mandatory SEBI risk disclosures.",
        note: 'AI Compliance Flag: Absolute guarantee claim without mandatory credit rating disclosure',
      },
    ],
    evidence: [
      {
        callId: 'PCG-9942',
        score: 68,
        topic: '13% Club High-Yield Pitch',
        summary: 'Rushed pitch, omitted capital risk disclosures, and did not confirm KYC readiness before quoting allocation.',
        isReviewed: false,
      },
      {
        callId: 'PCG-9883',
        score: 74,
        topic: 'Upselling Tranche B (Senior Secured)',
        summary: 'Incomplete explanation of lock-in period and payout calendar during objection handling.',
        isReviewed: true,
        reviewNote: 'TL adjusted +6 pts after reviewing objection handling context.',
      },
      {
        callId: 'PCG-9620',
        score: 79,
        topic: 'Bond Maturity Roll-over',
        summary: 'Skipped post-call recap of next tranche allotment steps; did not confirm preferred contact time.',
        isReviewed: false,
      },
      {
        callId: 'PCG-9712',
        score: 83,
        topic: 'General Fixed Income Inquiry',
        summary: 'Good product knowledge but interrupted the client twice while discussing secondary exit options.',
        isReviewed: true,
        reviewNote: 'TL approved dispute: client connection was lagging.',
      },
    ],
  },
  {
    id: 'pcg-rep-dhanush-w2',
    rmName: 'Dhanush',
    tlName: 'Gokul',
    weekStart: '2026-09-29T00:00:00Z',
    weekEnd: '2026-10-05T23:59:59Z',
    status: 'active',
    viewedAt: '2026-10-06T10:00:00Z',
    generatedAt: '2026-10-05T18:30:00Z',
    comments: [],
    numbers: {
      callsHandled: 138,
      averageScore: 85,
      below85Count: 18,
      connectRateText: '66.7% connected (92 of 138)',
      complianceBreachesCount: 2,
      scoresAdjustedCount: 1,
    },
    whatWentWell:
      'Strong call engagement rate with prospective high-net-worth investors. Clear presentation of CRISIL / ICRA rating grades and escrow mechanics.',
    themes: [
      {
        pattern: 'Uncertainty Addressing Secondary Market Exit Liquidity',
        associatedParameters: ['Secondary Liquidity', 'Transparency'],
        whyItMatters: 'Investors need confidence that their funds are not locked indefinitely if emergency redemption is needed.',
        actionable: 'Walk prospects through the 3-day secondary liquidation process on the Wint platform clearly.',
        isBreach: false,
        rankScore: 81,
        backingCallIds: ['PCG-9540', 'PCG-9480'],
      },
    ],
    breaches: [
      {
        callId: 'PCG-9540',
        score: 64,
        flaggedContent: "RM stated: 'There is zero credit risk on this issuer because Wint vets all bonds.'",
        note: 'AI Compliance Flag: Misleading representation of credit vetting vs zero default guarantee',
      },
    ],
    evidence: [
      {
        callId: 'PCG-9540',
        score: 64,
        topic: 'High Yield Alternative Debt',
        summary: 'Misrepresented risk parameters and rushed client into instant commitment.',
        isReviewed: false,
      },
      {
        callId: 'PCG-9480',
        score: 72,
        topic: '13% Club Follow-up',
        summary: 'Did not send follow-up material requested by client.',
        isReviewed: false,
      },
    ],
  },

  // ── VIKRAM (Senior RM) ───────────────────────────────────────────────────────
  {
    id: 'pcg-rep-vikram-w1',
    rmName: 'Vikram',
    tlName: 'Vaishnavi',
    weekStart: '2026-10-06T00:00:00Z',
    weekEnd: '2026-10-12T23:59:59Z',
    status: 'active',
    viewedAt: '2026-10-12T14:00:00Z',
    generatedAt: '2026-10-12T18:30:00Z',
    comments: [],
    numbers: {
      callsHandled: 156,
      averageScore: 92,
      below85Count: 7,
      connectRateText: '70.5% connected (110 of 156)',
      complianceBreachesCount: 0,
      scoresAdjustedCount: 1,
    },
    whatWentWell:
      'Vikram consistently delivered masterclass consultations on senior secured debentures. His pacing, professional demeanor, and structured breakdown of security cover (1.25x) established immediate rapport with high-ticket prospects.',
    themes: [
      {
        pattern: 'Optimizing Follow-up Speed on Client Voicemail Drops',
        associatedParameters: ['Follow-up Pacing', 'CRM Hygiene'],
        whyItMatters: 'Unanswered high-ticket leads lose warmth if not requeued within 45 minutes.',
        actionable: 'Leverage the automated dialer callback schedule to re-engage dropped dials promptly.',
        isBreach: false,
        rankScore: 90,
        backingCallIds: ['PCG-9810'],
      },
    ],
    breaches: [],
    evidence: [
      {
        callId: 'PCG-9810',
        score: 82,
        topic: 'Upsell to 25L Ticket Size',
        summary: 'Strong rapport, but follow-up tranche datasheet was delayed by 4 hours.',
        isReviewed: true,
        reviewNote: 'TL adjusted: call quality was flawless.',
      },
    ],
  },

  // ── PRIYA (RM) ──────────────────────────────────────────────────────────────
  {
    id: 'pcg-rep-priya-w1',
    rmName: 'Priya',
    tlName: 'Gokul',
    weekStart: '2026-10-06T00:00:00Z',
    weekEnd: '2026-10-12T23:59:59Z',
    status: 'active',
    viewedAt: null,
    generatedAt: '2026-10-12T18:30:00Z',
    comments: [],
    numbers: {
      callsHandled: 136,
      averageScore: 86,
      below85Count: 16,
      connectRateText: '66.9% connected (91 of 136)',
      complianceBreachesCount: 1,
      scoresAdjustedCount: 1,
    },
    whatWentWell:
      'Priya demonstrated great patience and active listening when addressing first-time alternative debt investors. Excellent explanation of credit ratings (CRISIL / ICRA A+) and tax deductibility.',
    themes: [
      {
        pattern: 'Clarifying TDS Deductions on Coupon Crediting',
        associatedParameters: ['Taxation & Returns', 'Clarity'],
        whyItMatters: 'HNW clients frequently ask if 13% yield is pre-tax or post-tax.',
        actionable: 'State clearly upfront that 13% XIRR is pre-tax with 10% TDS deduction at source.',
        isBreach: false,
        rankScore: 84,
        backingCallIds: ['PCG-9788'],
      },
    ],
    breaches: [
      {
        callId: 'PCG-9788',
        score: 72,
        flaggedContent: "RM stated: 'No taxes will be deducted on this bond tranche.'",
        note: 'AI Compliance Flag: Inaccurate tax claim on debenture coupon interest',
      },
    ],
    evidence: [
      {
        callId: 'PCG-9788',
        score: 72,
        topic: 'Taxation & 13% Club Inquiry',
        summary: 'Gave incorrect TDS guidance; corrected later on WhatsApp but call score penalized.',
        isReviewed: false,
      },
    ],
  },

  // ── RAHUL (RM) ──────────────────────────────────────────────────────────────
  {
    id: 'pcg-rep-rahul-w1',
    rmName: 'Rahul',
    tlName: 'Gokul',
    weekStart: '2026-10-06T00:00:00Z',
    weekEnd: '2026-10-12T23:59:59Z',
    status: 'active',
    viewedAt: null,
    generatedAt: '2026-10-12T18:30:00Z',
    comments: [],
    numbers: {
      callsHandled: 128,
      averageScore: 82,
      below85Count: 22,
      connectRateText: '64.1% connected (82 of 128)',
      complianceBreachesCount: 2,
      scoresAdjustedCount: 1,
    },
    whatWentWell:
      'Consistent call volume and high connect attempts. High energy during introductory pitches.',
    themes: [
      {
        pattern: 'Allowing Client Speaking Time & Avoiding Interruptions',
        associatedParameters: ['Active Listening', 'Empathy'],
        whyItMatters: 'Prospects will not commit capital if they feel pressured or spoken over.',
        actionable: 'Practice the 3-second pause rule before responding to investor objections.',
        isBreach: false,
        rankScore: 78,
        backingCallIds: ['PCG-9730', 'PCG-9690'],
      },
    ],
    breaches: [
      {
        callId: 'PCG-9730',
        score: 70,
        flaggedContent: 'RM dismissed investor query regarding credit rating downgrade history abruptly.',
        note: 'AI Compliance Flag: Tone & non-transparent risk dismissal',
      },
    ],
    evidence: [
      {
        callId: 'PCG-9730',
        score: 70,
        topic: '13% Club Risk Analysis',
        summary: 'Dismissed client query about default risk; interrupted client 4 times.',
        isReviewed: false,
      },
      {
        callId: 'PCG-9690',
        score: 76,
        topic: 'Upsell to Senior Secured Tranche',
        summary: 'Did not explain debenture trustee role; skipped compliance disclosure.',
        isReviewed: true,
        reviewNote: 'TL coached on active listening.',
      },
    ],
  },

  // ── SNEHA (RM) ──────────────────────────────────────────────────────────────
  {
    id: 'pcg-rep-sneha-w1',
    rmName: 'Sneha',
    tlName: 'Vaishnavi',
    weekStart: '2026-10-06T00:00:00Z',
    weekEnd: '2026-10-12T23:59:59Z',
    status: 'active',
    viewedAt: '2026-10-12T12:00:00Z',
    generatedAt: '2026-10-12T18:30:00Z',
    comments: [],
    numbers: {
      callsHandled: 134,
      averageScore: 87,
      below85Count: 15,
      connectRateText: '66.4% connected (89 of 134)',
      complianceBreachesCount: 1,
      scoresAdjustedCount: 1,
    },
    whatWentWell:
      'Excellent objection handling on lock-in periods. Smooth transition from general debt inquiries to 13% Club senior secured bonds.',
    themes: [
      {
        pattern: 'Reinforcing Demat Credit Assurance',
        associatedParameters: ['Post-Call Assurance'],
        whyItMatters: 'Investors need peace of mind that bonds reflect in their Zerodha/Groww demat account.',
        actionable: 'Always explain the T+2 demat crediting workflow before closing the call.',
        isBreach: false,
        rankScore: 85,
        backingCallIds: ['PCG-9655'],
      },
    ],
    breaches: [
      {
        callId: 'PCG-9655',
        score: 75,
        flaggedContent: 'Incomplete explanation of collateral hypothecation.',
        note: 'AI Review Flag: Parameter partial credit on security cover',
      },
    ],
    evidence: [
      {
        callId: 'PCG-9655',
        score: 75,
        topic: '13% Club Tranche Introduction',
        summary: 'Missed detailed collateral backing explanation; client asked for follow-up.',
        isReviewed: false,
      },
    ],
  },

  // ── KARAN (RM) ──────────────────────────────────────────────────────────────
  {
    id: 'pcg-rep-karan-w1',
    rmName: 'Karan',
    tlName: 'Vaishnavi',
    weekStart: '2026-10-06T00:00:00Z',
    weekEnd: '2026-10-12T23:59:59Z',
    status: 'active',
    viewedAt: null,
    generatedAt: '2026-10-12T18:30:00Z',
    comments: [],
    numbers: {
      callsHandled: 119,
      averageScore: 78,
      below85Count: 28,
      connectRateText: '63.9% connected (76 of 119)',
      complianceBreachesCount: 3,
      scoresAdjustedCount: 2,
    },
    whatWentWell:
      'High persistence on outbound dialer queues. Willingness to ask for feedback.',
    themes: [
      {
        pattern: 'Persistent Omission of Mandatory SEBI Disclaimers',
        associatedParameters: ['Compliance Disclaimer', 'Yield Pitch'],
        whyItMatters: 'SEBI regulations require risk statements on all high-yield fixed income calls.',
        actionable: 'Keep the mandatory disclaimer script pinned next to the dialer screen.',
        isBreach: true,
        rankScore: 72,
        backingCallIds: ['PCG-9610', 'PCG-9590'],
      },
    ],
    breaches: [
      {
        callId: 'PCG-9610',
        score: 65,
        flaggedContent: "RM stated: 'This is 100% risk free like a bank fixed deposit.'",
        note: 'AI Compliance Flag: Prohibited bank FD comparison claim',
      },
    ],
    evidence: [
      {
        callId: 'PCG-9610',
        score: 65,
        topic: '13% Club Fixed Income Pitch',
        summary: 'Compared high-yield debenture directly to a bank FD; failed compliance gate.',
        isReviewed: false,
      },
    ],
  },

  // ── MEERA (RM) ──────────────────────────────────────────────────────────────
  {
    id: 'pcg-rep-meera-w1',
    rmName: 'Meera',
    tlName: 'Vaishnavi',
    weekStart: '2026-10-06T00:00:00Z',
    weekEnd: '2026-10-12T23:59:59Z',
    status: 'active',
    viewedAt: '2026-10-12T16:00:00Z',
    generatedAt: '2026-10-12T18:30:00Z',
    comments: [],
    numbers: {
      callsHandled: 126,
      averageScore: 84,
      below85Count: 19,
      connectRateText: '65.9% connected (83 of 126)',
      complianceBreachesCount: 2,
      scoresAdjustedCount: 1,
    },
    whatWentWell:
      'Professional tone and deep familiarity with fixed-income bond mathematics.',
    themes: [
      {
        pattern: 'Balancing Technical Jargon with Investor Comprehension',
        associatedParameters: ['Call Clarity', 'Personalization'],
        whyItMatters: 'Using complex bond terms like modified duration and convexities confuses retail HNWIs.',
        actionable: 'Simplify explanations to focus on monthly cash flows and security cover.',
        isBreach: false,
        rankScore: 82,
        backingCallIds: ['PCG-9570'],
      },
    ],
    breaches: [],
    evidence: [
      {
        callId: 'PCG-9570',
        score: 78,
        topic: 'Bond Yield Calculation',
        summary: 'Over-complicated XIRR vs simple interest calculation; client was left confused.',
        isReviewed: false,
      },
    ],
  },

  // ── ANANYA (RM) ─────────────────────────────────────────────────────────────
  {
    id: 'pcg-rep-ananya-w1',
    rmName: 'Ananya',
    tlName: 'Gokul',
    weekStart: '2026-10-06T00:00:00Z',
    weekEnd: '2026-10-12T23:59:59Z',
    status: 'active',
    viewedAt: '2026-10-12T17:00:00Z',
    generatedAt: '2026-10-12T18:30:00Z',
    comments: [],
    numbers: {
      callsHandled: 145,
      averageScore: 90,
      below85Count: 10,
      connectRateText: '69.7% connected (101 of 145)',
      complianceBreachesCount: 0,
      scoresAdjustedCount: 0,
    },
    whatWentWell:
      'Exceptional performance across greeting, expectation setting, and objection handling. Consistently high call quality scores across 100+ dials.',
    themes: [
      {
        pattern: 'Sharing Best Practices with Peer RMs',
        associatedParameters: ['Team Leadership', 'Mentorship'],
        whyItMatters: 'Ananya objection handling script on secondary liquidity can be standardized for the team.',
        actionable: 'Conduct a 15-minute mock pitch session during the team huddle.',
        isBreach: false,
        rankScore: 92,
        backingCallIds: ['PCG-9530'],
      },
    ],
    breaches: [],
    evidence: [
      {
        callId: 'PCG-9530',
        score: 84,
        topic: '13% Club High-Yield Pitch',
        summary: 'Minor point missed on minimum lot size, but overall excellent call structure.',
        isReviewed: false,
      },
    ],
  },
];

interface Props {
  activePersona: 'agent' | 'tl' | 'admin';
  selectedRm: string;
  onSelectRm: (rm: string) => void;
  selectedTl: string;
  onSelectTl: (tl: string) => void;
  onOpenCallView: (callId: string) => void;
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
  const [activeReportId, setActiveReportId] = useState<string>('pcg-rep-dhanush-w1');

  // Filters
  const [selectedAgentFilter, setSelectedAgentFilter] = useState<string>(activePersona === 'agent' ? selectedRm : 'all');
  const [selectedWeekFilter, setSelectedWeekFilter] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Comment Modal state
  const [commentTarget, setCommentTarget] = useState<{ key: string; label: string } | null>(null);
  const [commentText, setCommentText] = useState('');
  const [isHighlighted, setIsHighlighted] = useState(false);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);

  // Synchronize persona selection with active report
  React.useEffect(() => {
    if (activePersona === 'agent') {
      setSelectedAgentFilter(selectedRm);
      const match = reports.find((r) => r.rmName === selectedRm);
      if (match) setActiveReportId(match.id);
    }
  }, [activePersona, selectedRm]);

  const activeReport = reports.find((r) => r.id === activeReportId) || reports[0];

  const formatDate = (dateStr: string) => {
    const options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' };
    return new Date(dateStr).toLocaleDateString('en-US', options);
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(text);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleOpenComment = (targetKey: string, label: string, existing?: ScorecardComment) => {
    setCommentTarget({ key: targetKey, label });
    if (existing) {
      setCommentText(existing.text);
      setIsHighlighted(existing.highlighted);
      setEditingCommentId(existing.id);
    } else {
      setCommentText('');
      setIsHighlighted(false);
      setEditingCommentId(null);
    }
  };

  const handleSaveComment = () => {
    if (!activeReport || !commentTarget || !commentText.trim()) return;

    let updatedComments = [...(activeReport.comments || [])];
    if (editingCommentId) {
      updatedComments = updatedComments.map((c) =>
        c.id === editingCommentId ? { ...c, text: commentText, highlighted: isHighlighted } : c
      );
    } else {
      const newComment: ScorecardComment = {
        id: Math.random().toString(36).substring(2, 9),
        targetKey: commentTarget.key,
        text: commentText.trim(),
        highlighted: isHighlighted,
        createdAt: new Date().toISOString(),
      };
      updatedComments.push(newComment);
    }

    setReports((prev) =>
      prev.map((r) => (r.id === activeReport.id ? { ...r, comments: updatedComments } : r))
    );
    setCommentTarget(null);
    setCommentText('');
    setIsHighlighted(false);
    setEditingCommentId(null);
  };

  const handleDeleteComment = (commentId: string) => {
    if (!activeReport) return;
    const updatedComments = (activeReport.comments || []).filter((c) => c.id !== commentId);
    setReports((prev) =>
      prev.map((r) => (r.id === activeReport.id ? { ...r, comments: updatedComments } : r))
    );
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
    const weekRange = `${formatDate(r.weekStart)} – ${formatDate(r.weekEnd)}`.toLowerCase();
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

  // Render comments helper
  const renderCommentsForTarget = (targetKey: string, headerText?: string) => {
    if (!activeReport) return null;
    const targetComments = (activeReport.comments || []).filter((c) => c.targetKey === targetKey);
    if (targetComments.length === 0) return null;

    return (
      <div className="mt-3 space-y-2">
        {headerText && (
          <span className="text-[10px] font-extrabold text-gray-400 uppercase tracking-wider block">
            {headerText}
          </span>
        )}
        {targetComments.map((c) => (
          <div
            key={c.id}
            className={`p-4 rounded-xl border text-sm flex items-start justify-between gap-4 transition-all ${
              c.highlighted
                ? 'bg-amber-50 border-amber-300 text-amber-900 shadow-sm'
                : 'bg-gray-50 border-gray-200 text-gray-700'
            }`}
          >
            <div className="space-y-1">
              {c.highlighted && (
                <span className="bg-amber-100 text-amber-800 text-[10px] font-extrabold uppercase px-1.5 py-0.5 rounded border border-amber-200 tracking-wider">
                  Highlighted for 1-on-1 Discussion
                </span>
              )}
              <p className="font-semibold text-xs leading-relaxed whitespace-pre-wrap">{c.text}</p>
              <span className="text-[10px] text-gray-400 font-medium font-mono block">
                {new Date(c.createdAt).toLocaleString()}
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => handleOpenComment(c.targetKey, commentTarget?.label || 'Edit Note', c)}
                className="text-gray-400 hover:text-indigo-600 text-xs font-semibold"
              >
                Edit
              </button>
              <span className="text-gray-300">|</span>
              <button
                onClick={() => handleDeleteComment(c.id)}
                className="text-gray-400 hover:text-red-600 text-xs font-semibold"
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="flex flex-col lg:flex-row min-h-[calc(100vh-140px)] bg-[#F7F7F8] border border-[#E4E4E7] rounded-2xl overflow-hidden shadow-sm">
      {/* ── LEFT SIDEBAR: SCORECARD HISTORY ──────────────────────────────────── */}
      <aside className="w-full lg:w-72 border-b lg:border-b-0 lg:border-r border-[#E4E4E7] bg-white flex flex-col shrink-0">
        <div className="p-4 border-b border-[#E4E4E7] bg-gray-50 flex items-center justify-between">
          <span className="font-bold text-gray-800 text-xs tracking-wide uppercase">Scorecard History</span>
          <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
            100% AI Evaluated
          </span>
        </div>

        {/* Agent Dropdown Filter (TL / Admin View) */}
        {activePersona !== 'agent' && (
          <div className="p-2 border-b border-[#E4E4E7] bg-white">
            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1 px-1">
              Select RM
            </label>
            <select
              value={selectedAgentFilter}
              onChange={(e) => setSelectedAgentFilter(e.target.value)}
              className="w-full px-3 py-1.5 text-xs border border-[#E4E4E7] rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 font-semibold bg-gray-50 text-gray-700 cursor-pointer"
            >
              <option value="all">All Team RMs ({uniqueAgents.length})</option>
              {uniqueAgents.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Week Dropdown Filter */}
        <div className="p-2 border-b border-[#E4E4E7] bg-white">
          <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1 px-1">
            Evaluation Period
          </label>
          <select
            value={selectedWeekFilter}
            onChange={(e) => setSelectedWeekFilter(e.target.value)}
            className="w-full px-3 py-1.5 text-xs border border-[#E4E4E7] rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 font-semibold bg-gray-50 text-gray-700 cursor-pointer"
          >
            <option value="all">All Available Cycles</option>
            {uniqueWeeks.map(([weekStart, label]) => (
              <option key={weekStart} value={weekStart}>
                {label}
              </option>
            ))}
          </select>
        </div>

        {/* Search Input */}
        <div className="p-2 border-b border-[#E4E4E7] bg-white">
          <input
            type="text"
            placeholder={activePersona === 'agent' ? 'Filter by month or week…' : 'Search RM name or week…'}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full px-3 py-1.5 text-xs border border-[#E4E4E7] rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 font-medium bg-gray-50 text-gray-700 placeholder-gray-400"
          />
        </div>

        {/* History List */}
        <nav className="flex-1 p-2 space-y-1 overflow-y-auto max-h-[600px]">
          {filteredReports.length === 0 ? (
            <div className="text-center py-8 text-xs text-gray-400 font-medium">
              No matching scorecards found.
            </div>
          ) : (
            filteredReports.map((r) => {
              const isSelected = r.id === activeReportId;
              const isUnread = !r.viewedAt;
              const weekRange = `${formatDate(r.weekStart)} – ${formatDate(r.weekEnd)}`;
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
                  className={`w-full text-left p-3 rounded-xl transition-all duration-200 flex items-center justify-between group ${
                    isSelected
                      ? 'bg-indigo-50 border border-indigo-200 text-indigo-900 shadow-sm'
                      : 'hover:bg-gray-50 border border-transparent text-gray-700'
                  }`}
                >
                  <div className="truncate flex-1 pr-2">
                    <div className="flex items-center gap-1.5">
                      <span className="font-bold text-xs text-indigo-700 block truncate">
                        {r.rmName}
                      </span>
                      {isUnread && (
                        <span
                          className="w-2 h-2 min-w-[8px] rounded-full bg-indigo-600 inline-block animate-pulse"
                          title="New unread report"
                        />
                      )}
                    </div>
                    <span className="text-[11px] text-gray-500 font-medium block mt-0.5 truncate">
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

      {/* ── MAIN SCORECARD VIEW (PROPER RM LAYOUT) ───────────────────────────── */}
      <main className="flex-1 overflow-y-auto p-6 lg:p-8 bg-white">
        {activeReport ? (
          <div className="max-w-4xl mx-auto space-y-8">
            {/* Header info */}
            <div className="flex flex-col md:flex-row md:items-center md:justify-between pb-6 border-b border-[#E4E4E7] gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">
                    PCG Weekly RM Scorecard
                  </h1>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">
                    RM Standard
                  </span>
                </div>
                <p className="text-sm text-gray-500 font-medium mt-1">
                  Week of {formatDate(activeReport.weekStart)} to {formatDate(activeReport.weekEnd)}
                </p>
                <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                  <span className="text-sm font-bold text-indigo-700">
                    RM: {activeReport.rmName}
                  </span>
                  <span className="text-gray-300">•</span>
                  <span className="text-xs font-semibold text-gray-600">
                    Team Lead: {activeReport.tlName}
                  </span>
                  <span className="text-gray-300">•</span>
                  <span className="text-xs text-gray-400 font-mono">
                    Generated at {new Date(activeReport.generatedAt).toLocaleString()}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleOpenComment('general', 'General 1-on-1 Feedback')}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 hover:border-indigo-500 hover:text-indigo-600 bg-white text-gray-700 text-xs font-semibold shadow-sm transition-all"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 0 1-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                    />
                  </svg>
                  1-on-1 Notes
                </button>
                {onSwitchToCallsTab && (
                  <button
                    onClick={onSwitchToCallsTab}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-white text-xs font-bold transition-all shadow-sm"
                  >
                    <span>View All Calls</span>
                    <span>→</span>
                  </button>
                )}
              </div>
            </div>

            {/* General Report Comments */}
            {renderCommentsForTarget('general', 'General Notes & 1-on-1 Coaching')}

            {/* ── 1. THE NUMBERS SECTION ─────────────────────────────────────── */}
            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                  <span className="bg-indigo-100 text-indigo-700 w-6 h-6 rounded-full inline-flex items-center justify-center text-xs font-bold font-mono">
                    1
                  </span>
                  The Numbers
                </h2>
                <span className="text-xs text-gray-500 font-medium">Weekly Aggregate Summary</span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3.5">
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
                      numbers?.averageScore >= 85
                        ? 'text-green-600'
                        : numbers?.averageScore >= 70
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

                {/* Connect Rate / Reachability */}
                <div className="bg-white p-4 rounded-xl border border-[#E4E4E7] shadow-sm flex flex-col col-span-2 justify-between">
                  <span className="text-xs font-bold text-gray-400 uppercase tracking-wider block">
                    Connect Rate &amp; Reachability
                  </span>
                  <span
                    className="text-xs font-semibold text-gray-800 mt-3 bg-indigo-50 p-2 rounded-lg border border-indigo-100 text-center truncate"
                    title={numbers?.connectRateText}
                  >
                    {numbers?.connectRateText || 'no dials'}
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
                        ? 'text-red-600 animate-pulse font-black'
                        : 'text-gray-900'
                    }`}
                  >
                    {numbers?.complianceBreachesCount ?? 0}
                  </span>
                </div>
              </div>
            </div>

            {/* ── 2. WHAT WENT WELL ──────────────────────────────────────────── */}
            <div className="bg-green-50/50 border border-green-200/80 rounded-2xl p-6 relative overflow-hidden">
              <div className="absolute right-0 bottom-0 opacity-10 pointer-events-none transform translate-y-4 translate-x-2">
                <svg className="w-40 h-40 text-green-700" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 2l3.09 6.26 6.91.97-5 4.89 1.18 6.88L12 17.77l-6.18 3.25L7 14.12 2 9.23l6.91-.97L12 2z" />
                </svg>
              </div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-extrabold text-green-800 uppercase tracking-wider flex items-center gap-1.5">
                  <StarIcon /> What Went Well
                </h3>
              </div>
              <p className="text-green-950 font-medium text-sm leading-relaxed">
                {activeReport.whatWentWell}
              </p>
            </div>

            {/* ── 3. 1-ON-1 DISCUSSION POINTS (COACHING THEMES) ──────────────── */}
            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                  <span className="bg-indigo-100 text-indigo-700 w-6 h-6 rounded-full inline-flex items-center justify-center text-xs font-bold font-mono">
                    2
                  </span>
                  1-on-1 Discussion Points
                </h2>
                <span className="text-xs text-gray-400 font-medium">Coaching Themes &amp; Growth</span>
              </div>

              {activeReport.themes && activeReport.themes.length > 0 ? (
                <div className="space-y-4">
                  {activeReport.themes.map((theme, index) => {
                    return (
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
                            <h4 className="font-bold text-gray-900 text-base">{theme.pattern}</h4>
                          </div>
                          {theme.associatedParameters && theme.associatedParameters.length > 0 && (
                            <div className="flex items-center gap-1 flex-wrap">
                              {theme.associatedParameters.map((p) => (
                                <span
                                  key={p}
                                  className="text-[10px] font-semibold bg-gray-100 text-gray-600 px-2 py-0.5 rounded-md"
                                >
                                  {p}
                                </span>
                              ))}
                            </div>
                          )}
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

                        {/* Backing Calls */}
                        <div className="pt-2 flex items-center gap-2 flex-wrap border-t border-gray-100">
                          <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">
                            Evidence Calls:
                          </span>
                          {theme.backingCallIds?.map((cid) => (
                            <div
                              key={cid}
                              className="flex items-center bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold px-2 py-1 rounded-md border border-gray-200 font-mono transition-all gap-1.5"
                            >
                              <span>Call #{cid}</span>
                              <button
                                onClick={() => handleCopy(cid)}
                                className="text-gray-400 hover:text-indigo-600"
                                title="Copy Call ID"
                              >
                                {copiedId === cid ? (
                                  <span className="text-emerald-600 text-[10px]">Copied</span>
                                ) : (
                                  <span className="text-[10px] text-gray-400 hover:text-indigo-600">Copy</span>
                                )}
                              </button>
                              <button
                                onClick={() => onOpenCallView(cid)}
                                className="px-1.5 py-0.5 rounded bg-zinc-900 text-white text-[10px] hover:bg-zinc-800 ml-1 font-sans"
                                title="Open Call Audit in Drawer"
                              >
                                View
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="bg-white rounded-2xl border border-gray-200 p-6 text-center text-gray-500 font-medium">
                  Outstanding performance this evaluation period. No low-scoring call themes were identified.
                </div>
              )}
            </div>

            {/* ── 4. COMPLIANCE FLAGS SURFACED ───────────────────────────────── */}
            {activeReport.breaches && activeReport.breaches.length > 0 && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                    <span className="bg-indigo-100 text-indigo-700 w-6 h-6 rounded-full inline-flex items-center justify-center text-xs font-bold font-mono">
                      3
                    </span>
                    Compliance Flags Surfaced
                  </h2>
                  <span className="text-xs text-red-600 font-bold">
                    {activeReport.breaches.length} Flagged
                  </span>
                </div>

                <div className="bg-amber-50/90 border border-amber-300 text-amber-900 p-4 sm:p-5 rounded-2xl text-xs sm:text-sm font-medium leading-relaxed shadow-sm flex items-start gap-3.5">
                  <span className="text-xl sm:text-2xl flex-shrink-0 mt-0.5" role="img" aria-label="warning">
                    
                  </span>
                  <div>
                    <strong className="font-bold text-amber-950">Note on compliance flags: </strong>
                    <span>
                      These are flagged automatically by the AI speech classifier for human review. Verify against call audio and context.
                    </span>
                  </div>
                </div>

                <div className="bg-white rounded-2xl border border-[#E4E4E7] shadow-sm overflow-hidden">
                  <div className="divide-y divide-[#E4E4E7]">
                    {activeReport.breaches.map((breach, idx) => (
                      <div
                        key={idx}
                        className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:bg-gray-50 transition-all"
                      >
                        <div className="flex-1 space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="bg-gray-100 text-gray-700 text-xs font-bold px-2 py-0.5 rounded border border-gray-200 font-mono">
                              Call #{breach.callId}
                            </span>
                            <span className="bg-red-50 text-red-700 text-[10px] font-extrabold uppercase px-1.5 py-0.5 rounded border border-red-100">
                              Flagged
                            </span>
                            {breach.note && (
                              <span className="text-[11px] text-gray-500 font-medium">
                                {breach.note}
                              </span>
                            )}
                          </div>
                          <p className="text-xs font-mono text-gray-700 break-all bg-gray-50 p-2 rounded border border-gray-100 mt-2">
                            {breach.flaggedContent}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {breach.score !== null && (
                            <span className="text-xs font-bold font-mono px-2 py-0.5 rounded bg-gray-100 text-gray-700 border border-gray-200">
                              IQS: {breach.score}%
                            </span>
                          )}
                          <button
                            onClick={() => onOpenCallView(breach.callId)}
                            className="px-2.5 py-1 rounded bg-zinc-900 text-white text-xs font-bold hover:bg-zinc-800 transition-colors"
                          >
                            View
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* ── 5. FULL EVIDENCE LIST (LOW-SCORING CALLS) ───────────────────── */}
            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                  <span className="bg-indigo-100 text-indigo-700 w-6 h-6 rounded-full inline-flex items-center justify-center text-xs font-bold font-mono">
                    {activeReport.breaches && activeReport.breaches.length > 0 ? 4 : 3}
                  </span>
                  Full Evidence List (Low-Scoring Calls)
                </h2>
                <span className="text-xs text-gray-400 font-medium">Calls Scoring Under 85%</span>
              </div>

              {activeReport.evidence && activeReport.evidence.length > 0 ? (
                <div className="bg-white rounded-2xl border border-[#E4E4E7] shadow-sm overflow-hidden">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr className="bg-gray-50 border-b border-[#E4E4E7] text-[11px] text-gray-400 font-bold uppercase tracking-wider text-left">
                        <th className="p-3.5">Call ID</th>
                        <th className="p-3.5 text-center">Score</th>
                        <th className="p-3.5">Topic / Disposition</th>
                        <th className="p-3.5">Primary Coaching Point / Issue</th>
                        <th className="p-3.5 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E4E4E7] text-xs text-gray-700">
                      {activeReport.evidence.map((ev) => (
                        <tr key={ev.callId} className="hover:bg-gray-50 transition-all">
                          <td className="p-3.5 font-mono font-bold text-indigo-600 whitespace-nowrap">
                            <div className="flex items-center gap-1.5">
                              <span>#{ev.callId}</span>
                              <button
                                onClick={() => handleCopy(ev.callId)}
                                className="text-gray-400 hover:text-indigo-600"
                                title="Copy Call ID"
                              >
                                {copiedId === ev.callId ? 'Copied' : 'Copy ID'}
                              </button>
                            </div>
                          </td>
                          <td className="p-3.5 text-center whitespace-nowrap">
                            <div className="flex flex-col items-center gap-1">
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
                              {ev.isReviewed && (
                                <span
                                  className="text-[10px] font-semibold text-green-700 bg-green-50 px-1.5 py-0.2 rounded border border-green-200"
                                  title={ev.reviewNote || 'Score updated by TL'}
                                >
                                  ✓ TL Updated
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="p-3.5 font-semibold text-gray-800 whitespace-nowrap">
                            {ev.topic}
                          </td>
                          <td className="p-3.5 text-gray-600 font-medium max-w-md">
                            {ev.summary}
                          </td>
                          <td className="p-3.5 text-right whitespace-nowrap">
                            <button
                              onClick={() => onOpenCallView(ev.callId)}
                              className="px-2.5 py-1 rounded bg-zinc-900 text-white font-bold hover:bg-zinc-800 transition-colors"
                            >
                              View
                            </button>
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
          <div className="text-center py-24 text-gray-500 font-medium">
            Please select a scorecard from the left sidebar to inspect.
          </div>
        )}
      </main>

      {/* ── FLOATING COMMENT MODAL DIALOG ─────────────────────────────────────── */}
      {commentTarget && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in">
          <div className="bg-white rounded-2xl border border-[#E4E4E7] shadow-xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="font-extrabold text-gray-800 text-sm tracking-wide uppercase">
                {editingCommentId ? 'Edit 1-on-1 Note / Flag' : 'Add 1-on-1 Discussion Note'}
              </h3>
              <button
                onClick={() => {
                  setCommentTarget(null);
                  setCommentText('');
                  setIsHighlighted(false);
                  setEditingCommentId(null);
                }}
                className="text-gray-400 hover:text-gray-700 text-lg font-bold"
              >
                ×
              </button>
            </div>

            <div>
              <span className="text-[10px] font-extrabold text-indigo-600 uppercase tracking-wider block">
                Target Section
              </span>
              <span className="text-xs font-semibold text-gray-800 mt-1 block">
                {commentTarget.label}
              </span>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-extrabold text-gray-400 uppercase tracking-wider block">
                My Comment / Note
              </label>
              <textarea
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                placeholder="Type 1-on-1 coaching observation or action plan agreed with the RM…"
                rows={4}
                className="w-full p-3 rounded-lg border border-gray-300 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-xs text-gray-700 focus:outline-none"
              />
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="highlight-check-pcg"
                checked={isHighlighted}
                onChange={(e) => setIsHighlighted(e.target.checked)}
                className="w-4 h-4 rounded text-amber-600 border-gray-300 focus:ring-amber-500"
              />
              <label
                htmlFor="highlight-check-pcg"
                className="text-xs font-bold text-amber-800 cursor-pointer select-none"
              >
                Highlight / Flag for 1-on-1 discussion
              </label>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => {
                  setCommentTarget(null);
                  setCommentText('');
                  setIsHighlighted(false);
                  setEditingCommentId(null);
                }}
                className="px-4 py-2 border border-gray-300 text-gray-600 hover:bg-gray-50 text-xs font-bold rounded-lg transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveComment}
                disabled={!commentText.trim()}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white disabled:bg-indigo-300 text-xs font-bold rounded-lg shadow-sm transition-all"
              >
                Save Note
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
