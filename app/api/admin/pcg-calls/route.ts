import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-guard';
import { withLogging } from '@/lib/log';

const ROUTE = 'admin/pcg-calls';

// Deterministic hash helper
function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

// Canonical 11 PCG Call Quality Parameters across 3 Skill Groups
export const PCG_QUALITY_PARAMETERS = [
  // Group 1: Process Skills — 50%
  {
    id: 'CallOpening',
    num: 1,
    name: 'Call Opening',
    maxWeight: 5,
    group: 'Process Skills',
    groupWeight: '50%',
    defaultQuote: 'Greeted client respectfully with Sir/Ma\'am, identified self and Wint Wealth, and verified availability to speak.'
  },
  {
    id: 'CallClosing',
    num: 2,
    name: 'Call Closing',
    maxWeight: 5,
    group: 'Process Skills',
    groupWeight: '50%',
    defaultQuote: 'Thanked client, summarized agreed follow-up next steps, and closed with polite sign-off.'
  },
  {
    id: 'TechnicalLegal',
    num: 3,
    name: 'Technically / Legally Correct',
    maxWeight: 15,
    group: 'Process Skills',
    groupWeight: '50%',
    defaultQuote: 'All product information, yield terms, asset cover, and PMS/AIF disclosures match Wint Knowledge Base with zero return guarantees.'
  },
  {
    id: 'AllQuestions',
    num: 4,
    name: 'All Questions Addressed',
    maxWeight: 10,
    group: 'Process Skills',
    groupWeight: '50%',
    defaultQuote: 'Every client question was answered clearly or deferred with confirmed team follow-up timeline.'
  },
  {
    id: 'Expectation',
    num: 5,
    name: 'Expectation Setting',
    maxWeight: 10,
    group: 'Process Skills',
    groupWeight: '50%',
    defaultQuote: 'Clear next steps, WhatsApp document timeline, and backend coordination ownership established.'
  },
  {
    id: 'Process',
    num: 6,
    name: 'Process / Pre-check',
    maxWeight: 5,
    group: 'Process Skills',
    groupWeight: '50%',
    defaultQuote: 'Pre-checked portfolio and relationship history on PCG Finder beforehand; client did not have to repeat context.'
  },
  // Group 2: Communication Skills — 30%
  {
    id: 'Grammar',
    num: 7,
    name: 'Vocabulary / Sentence Structure / Grammar / Pronunciations',
    maxWeight: 10,
    group: 'Communication Skills',
    groupWeight: '30%',
    defaultQuote: 'Articulate delivery, professional vocabulary, correct pronunciation of fund names and financial terminology.'
  },
  {
    id: 'Fillers',
    num: 8,
    name: 'Fillers, Fumbling & Stammering / Speech Clarity / Avoid Dead Air',
    maxWeight: 10,
    group: 'Communication Skills',
    groupWeight: '30%',
    defaultQuote: 'Fluent and confident delivery with minimal fillers; all brief lookup pauses were announced clearly.'
  },
  {
    id: 'EnergyTone',
    num: 9,
    name: 'Energy Level, Enthusiasm & Tone Modulation',
    maxWeight: 10,
    group: 'Communication Skills',
    groupWeight: '30%',
    defaultQuote: 'Attentive, calm, and composed tone suited to HNI wealth management with reassuring modulation.'
  },
  // Group 3: Customer Service Skills — 20%
  {
    id: 'ActiveListening',
    num: 10,
    name: 'Active Listening, Interruptions & Empathy',
    maxWeight: 10,
    group: 'Customer Service Skills',
    groupWeight: '20%',
    defaultQuote: 'Listened attentively without speaking over client, acknowledged cash flow preferences with genuine empathy.'
  },
  {
    id: 'Simplifying',
    num: 11,
    name: 'Simplifying Answers',
    maxWeight: 10,
    group: 'Customer Service Skills',
    groupWeight: '20%',
    defaultQuote: 'Explained complex financial concepts (hurdle rate, senior secured debt cover, pass-through taxation) in plain language.'
  },
];

const COACHING_TIPS_POOL: Record<string, string[]> = {
  '13_pitching': [
    'Turn 8: Do not state that 13% Club returns are guaranteed. Emphasize that all corporate assets undergo rigorous due diligence with monthly cash flows.',
    'Turn 14: Failed to uncover customer investment objective before quoting minimum ticket size. Ask what horizon they have in mind first.',
    'Turn 19: Customer requested time to discuss with family. Commit to a firm callback slot and offer to send a 1-page summary on WhatsApp rather than leaving it open-ended.',
  ],
  'upselling': [
    'Turn 11: Customer objected that they already hold Senior Secured bonds. Reframe the pitch by showing portfolio diversification benefits across credit ratings.',
    'Turn 16: You jumped to ticket size before understanding their investment horizon. Always confirm their timeline before proposing a specific allocation amount.',
    'Turn 22: Did not address reinvestment queries. Explain accrued interest treatment and TDS deductions clearly before closing the transaction pitch.',
  ],
  'support': [
    'Turn 6: Customer expressed frustration with statement download delay. Acknowledge the inconvenience warmly before jumping into technical troubleshooting steps.',
    'Turn 12: Incomplete Form 15G explanation. Ensure customer understands that Form 15G applies only if total income is below the taxable threshold.',
    'Turn 18: Rushed the closing. Confirm explicitly with the investor if all their questions have been completely answered before ending the call.',
  ],
};

const TRANSCRIPT_TEMPLATES: Record<string, Array<{ speaker: 'RM' | 'Customer'; text: string; time: string; segment?: string; isPivotTurn?: boolean }>> = {
  '13_pitching': [
    { speaker: 'RM', text: 'Hello, am I speaking with Mr. Sharma? This is Aahan from Wint Wealth PCG team.', time: '00:03' },
    { speaker: 'Customer', text: 'Yes Aahan, tell me. I received an alert about the 13% Club product.', time: '00:10' },
    { speaker: 'RM', text: 'Glad you saw that! I wanted to walk you through how the 13% Club offers fixed monthly returns backed by vetted corporate assets.', time: '00:22' },
    { speaker: 'Customer', text: 'Is there a lock-in period? What if I need funds in an emergency?', time: '00:45' },
    { speaker: 'RM', text: 'It has a standard 36-month horizon, but with monthly cash flow payouts and liquidity support via our secondary market window.', time: '01:05' },
    { speaker: 'Customer', text: 'Understood. Can you share the credit rating report and term sheet on my WhatsApp?', time: '01:30' },
    { speaker: 'RM', text: 'Absolutely. I will WhatsApp the factsheet right away and follow up on Thursday at 3 PM. Thank you!', time: '01:48' },
  ],
  'upselling': [
    { speaker: 'RM', text: 'Good afternoon, Mr. Verma. This is Yaashvi from Wint Wealth. Hope you are having a productive day.', time: '00:04' },
    { speaker: 'Customer', text: 'Hi Yaashvi, yes. My Muthoot bonds recently matured on Wint.', time: '00:15' },
    { speaker: 'RM', text: 'Exactly why I called! We have a new AA-rated asset offering 11.85% XIRR that fits your fixed-income allocation perfectly.', time: '00:30' },
    { speaker: 'Customer', text: 'What is the minimum ticket size for this new issuance?', time: '00:52' },
    { speaker: 'RM', text: 'The ticket size starts at ₹50,000, and interest is credited directly to your bank quarterly.', time: '01:12' },
    { speaker: 'Customer', text: 'Looks interesting. Please reserve 2 units for my demat account.', time: '01:38' },
  ],
  'support': [
    { speaker: 'RM', text: 'Hello, Wint Wealth support, Samskriti speaking. How may I assist you today?', time: '00:05' },
    { speaker: 'Customer', text: 'Hi, I need my annual TDS certificate and interest statement for ITR filing.', time: '00:18' },
    { speaker: 'RM', text: 'I can certainly help with that. Could you verify your registered PAN number?', time: '00:32' },
    { speaker: 'Customer', text: 'Sure, it is ABCDE1234F.', time: '00:45' },
    { speaker: 'RM', text: 'Thank you. I have verified your portfolio and emailed your Consolidated Tax Statement for FY 24-25 right to your inbox.', time: '01:10' },
    { speaker: 'Customer', text: 'Received it! Thank you so much for the quick resolution.', time: '01:25' },
  ],
  'mixed_upsell_support': [
    { speaker: 'Customer', text: 'Hi Aahan, I noticed my quarterly coupon interest from Muthoot Capital didn\'t show up in my HDFC account yesterday. Can you check?', time: '00:04', segment: 'Support Query' },
    { speaker: 'RM', text: 'Hello Mr. Kapoor! Let me check your transaction log right away. I see the payout was processed at 6 PM yesterday and will reflect in your HDFC account by 2 PM today.', time: '00:18', segment: 'Support Query' },
    { speaker: 'Customer', text: 'Okay perfect, that\'s a relief. Was worried there was an account mismatch.', time: '00:34', segment: 'Support Query' },
    { speaker: 'RM', text: 'No issue at all, your bank details are 100% verified. Also Mr. Kapoor, while I have you on the line, your CreditAccess bonds matured last week. We have a fresh AA-rated senior secured issuance yielding 11.25% open today.', time: '00:46', segment: 'Upselling Pitch', isPivotTurn: true },
    { speaker: 'Customer', text: 'What is the tenure and payout frequency on that new issuance?', time: '01:05', segment: 'Upselling Pitch' },
    { speaker: 'RM', text: 'It is a 24-month tenure with monthly interest payouts credited directly to your verified HDFC bank account, backed by 1.25x asset cover.', time: '01:22', segment: 'Upselling Pitch' },
    { speaker: 'Customer', text: 'That fits my cash flow needs. Can you WhatsApp the term sheet and IM?', time: '01:45', segment: 'Upselling Pitch' },
    { speaker: 'RM', text: 'Sent directly to your WhatsApp! I will follow up this evening to help reserve your units.', time: '02:05', segment: 'Upselling Pitch' },
    { speaker: 'Customer', text: 'Sounds good, thanks Aahan.', time: '02:18', segment: 'Upselling Pitch' },
  ],
  'mixed_pitch_support': [
    { speaker: 'RM', text: 'Good morning Mr. Mehta, Aahan here from Wint Wealth. You had registered on our platform to explore fixed-income senior secured bonds.', time: '00:05', segment: 'Support Query' },
    { speaker: 'Customer', text: 'Yes Aahan, but while completing my profile, my KYC got stuck on DigiLocker Aadhaar verification.', time: '00:16', segment: 'Support Query' },
    { speaker: 'RM', text: 'I can help you unlock that right away. Did it show an address mismatch or OTP timeout?', time: '00:30', segment: 'Support Query' },
    { speaker: 'Customer', text: 'It showed an OTP timeout. Can we re-trigger it?', time: '00:42', segment: 'Support Query' },
    { speaker: 'RM', text: 'I have reset the verification session from our end. Please refresh the Wint app and re-enter the OTP now.', time: '00:58', segment: 'Support Query' },
    { speaker: 'Customer', text: 'Done, it says KYC verified! Now tell me, how does the 13% Club fixed return product compare to standard bank FDs?', time: '01:14', segment: 'New Pitching', isPivotTurn: true },
    { speaker: 'RM', text: 'Unlike bank FDs which offer 6.5-7%, the 13% Club is backed by senior secured assets with 1.25x asset cover, giving fixed monthly returns.', time: '01:35', segment: 'New Pitching' },
    { speaker: 'Customer', text: 'Is there a minimum ticket size to start?', time: '01:58', segment: 'New Pitching' },
    { speaker: 'RM', text: 'You can start with ₹10,000, and interest is credited monthly right to your bank account.', time: '02:15', segment: 'New Pitching' },
    { speaker: 'Customer', text: 'Sounds solid. Let me transfer ₹50,000 to test the first allocation.', time: '02:35', segment: 'New Pitching' },
    { speaker: 'RM', text: 'Excellent! I will guide you through placing your first order as soon as funds reflect.', time: '02:50', segment: 'New Pitching' },
  ],
};

// TL to RM mappings for team views
const TL_TEAMS: Record<string, string[]> = {
  Gokul: ['Aahan Thaker', 'Dhanush', 'Yaashvi Arora', 'Samskriti Rao', 'Gaurav Nautiyal'],
  Vaishnavi: ['Aravind', 'Sujal Dadwani', 'Antara Chakrabarty', 'Swati Singh'],
};

const DUMMY_RMS = [
  { name: 'Aahan Thaker', tl: 'Gokul', count: 20 },
  { name: 'Dhanush', tl: 'Gokul', count: 16 },
  { name: 'Yaashvi Arora', tl: 'Gokul', count: 14 },
  { name: 'Samskriti Rao', tl: 'Gokul', count: 12 },
  { name: 'Gaurav Nautiyal', tl: 'Gokul', count: 10 },
  { name: 'Aravind', tl: 'Vaishnavi', count: 14 },
  { name: 'Sujal Dadwani', tl: 'Vaishnavi', count: 12 },
  { name: 'Antara Chakrabarty', tl: 'Vaishnavi', count: 10 },
  { name: 'Swati Singh', tl: 'Vaishnavi', count: 8 },
];

export interface DummyPCGCall {
  id: string;
  callId: string;
  clientName: string;
  rmName: string;
  tlName: string;
  phoneNumber: string;
  callType: string;
  tag: string | null;
  durationSeconds: number;
  startTime: string;
  isAnswered: boolean;
  hasRecording: boolean;
  category: string;
  categoryKey: '13_pitching' | 'upselling' | 'support';
  secondaryCategories?: string[];
  allCategories?: string[];
  aiCategoryReasoning?: string | null;
  iqsScore: number;
  gates: { status: 'PASS' | 'FAIL'; reason?: string | null };
  needsAttention: boolean;
  unansweredBy: 'Customer' | 'RM' | null;
  unansweredReason: string | null;
  parameters: Array<{
    id: string;
    name: string;
    maxScore: number;
    earnedScore: number;
    status: 'Yes' | 'Half' | 'No';
    quote: string;
  }>;
  aiCoachingTip: string | null;
  transcriptTurns: Array<{ speaker: 'RM' | 'Customer'; text: string; time: string; segment?: string; isPivotTurn?: boolean }>;
  disputeStatus: 'none' | 'pending' | 'resolved';
}

const CLIENT_NAMES = [
  'Amit Kapoor',
  'Sunil Mehta',
  'Rajesh Sharma',
  'Vikram Verma',
  'Pooja Nair',
  'Ramesh Iyer',
  'Ananya Deshmukh',
  'Sanjay Patel',
  'Naveen Reddy',
  'Deepak Joshi',
  'Priya Kulkarni',
  'Arun Malhotra',
  'Kavita Sen',
  'Rohan Singhal',
  'Meera Krishnan',
  'Vivek Agarwal',
  'Aditi Bose',
  'Harish Choudhary',
];

// Generate realistic synthetic dummy calls
function buildDummyCalls(): DummyPCGCall[] {
  const dummyList: DummyPCGCall[] = [];
  let globalId = 100;

  // Curated scores for Aahan Thaker so his overall average IQS is ~87%
  const aahanScores = [94, 88, 92, 85, 78, 86, 90, 89, 76, 95, 88, 91, 84, 96];

  DUMMY_RMS.forEach((rm) => {
    for (let i = 0; i < rm.count; i++) {
      globalId++;
      // Answered ~65%, Unanswered ~35%
      const isAnswered = (i % 3 !== 2);
      const durationSeconds = isAnswered ? (65 + ((globalId * 37) % 275)) : 0;

      // Categories
      const catMod = (globalId * 3 + i) % 10;
      let categoryKey: '13_pitching' | 'upselling' | 'support' =
        !isAnswered ? '13_pitching' : (catMod < 5 ? '13_pitching' : catMod < 8 ? 'upselling' : 'support');
      let category = categoryKey === '13_pitching' ? '13% Club / Pitching' : categoryKey === 'upselling' ? 'Upselling Calls' : 'General / Support';

      // Timestamps spread across last 13 days
      const daysAgo = (globalId % 13);
      const hoursAgo = (globalId * 7) % 24;
      const startTime = new Date(Date.now() - (daysAgo * 86400000) - (hoursAgo * 3600000)).toISOString();

      // IQS Score
      let iqsScore = 0;
      let gateStatus: 'PASS' | 'FAIL' = 'PASS';
      let gateReason: string | null = null;

      if (isAnswered) {
        if (rm.name === 'Aahan Thaker') {
          iqsScore = aahanScores[i % aahanScores.length];
        } else {
          const sMod = (globalId * 11) % 100;
          if (sMod < 15) iqsScore = 72 + (globalId % 8);
          else if (sMod < 35) iqsScore = 80 + (globalId % 5);
          else if (sMod < 80) iqsScore = 86 + (globalId % 9);
          else iqsScore = 95 + (globalId % 5);
        }

        // Compliance tripwire gate (~4% fails)
        if (globalId % 26 === 0) {
          gateStatus = 'FAIL';
          gateReason = 'Turn 18: Advice Tripwire — Assured returns without disclosing secondary market risk.';
        }
      }

      const needsAttention = isAnswered && (iqsScore < 85 || gateStatus === 'FAIL');

      // Unanswered diagnostics
      let unansweredBy: 'Customer' | 'RM' | null = null;
      let unansweredReason: string | null = null;
      if (!isAnswered) {
        if (globalId % 6 === 0) {
          unansweredBy = 'RM';
          unansweredReason = 'RM Dropped Early (<5s)';
        } else if (globalId % 8 === 0) {
          unansweredBy = 'RM';
          unansweredReason = 'RM Missed Incoming Call';
        } else if (globalId % 4 === 0) {
          unansweredBy = 'Customer';
          unansweredReason = 'Customer Busy / Declined';
        } else {
          unansweredBy = 'Customer';
          unansweredReason = 'Rang Out (No Answer)';
        }
      }

      // Specific Multi-Category (Mixed Intent) autotagged test calls
      let isMultiCategoryCall = false;
      let secondaryCategories: string[] | undefined = undefined;
      let allCategories: string[] | undefined = undefined;
      let aiCategoryReasoning: string | null = null;
      let mixedTurns: Array<{ speaker: 'RM' | 'Customer'; text: string; time: string; segment?: string; isPivotTurn?: boolean }> | null = null;

      if (rm.name === 'Aahan Thaker' && i === 1) {
        isMultiCategoryCall = true;
        categoryKey = 'upselling';
        category = 'Upselling Calls';
        secondaryCategories = ['General / Support'];
        allCategories = ['upselling', 'support'];
        aiCategoryReasoning = 'AI Autotag (2 Categories Detected): Turns 1-3 addressed customer support query on delayed coupon payout from Muthoot bond. Turns 4-9 pivoted to upselling a new 11.25% Senior Secured Bond for reinvestment. Scored on primary intent: Upselling (7 Parameters).';
        mixedTurns = TRANSCRIPT_TEMPLATES['mixed_upsell_support'];
      } else if (rm.name === 'Aahan Thaker' && i === 4) {
        isMultiCategoryCall = true;
        categoryKey = '13_pitching';
        category = '13% Club / Pitching';
        secondaryCategories = ['General / Support'];
        allCategories = ['13_pitching', 'support'];
        aiCategoryReasoning = 'AI Autotag (2 Categories Detected): Turns 1-5 resolved DigiLocker Aadhaar KYC timeout (Customer Support). Turns 6-11 conducted full 13% Club pitch discovering investment horizon & comparing with bank FDs (Pitching). Scored on primary intent: Pitching (13 Parameters).';
        mixedTurns = TRANSCRIPT_TEMPLATES['mixed_pitch_support'];
      } else if (rm.name === 'Dhanush' && i === 1) {
        isMultiCategoryCall = true;
        categoryKey = 'upselling';
        category = 'Upselling Calls';
        secondaryCategories = ['General / Support'];
        allCategories = ['upselling', 'support'];
        aiCategoryReasoning = 'AI Autotag (2 Categories Detected): Turns 1-3 handled Form 15G tax compliance inquiry (Support). Turns 4-8 pitched ₹1 Lakh reinvestment into NBFC Senior Secured NCD (Upselling). Scored on primary intent: Upselling (7 Parameters).';
        mixedTurns = TRANSCRIPT_TEMPLATES['mixed_upsell_support'].map(t => ({
          ...t,
          text: t.text.replace(/Aahan/g, 'Dhanush')
        }));
      } else if (rm.name === 'Aravind' && i === 1) {
        isMultiCategoryCall = true;
        categoryKey = 'upselling';
        category = 'Upselling Calls';
        secondaryCategories = ['General / Support'];
        allCategories = ['upselling', 'support'];
        aiCategoryReasoning = 'AI Autotag (2 Categories Detected): Turns 1-4 assisted investor with bank IFSC update inquiry (Customer Support). Turns 5-9 pitched newly listed 11.60% XIRR Secondary Market Bond using idle wallet balance (Upselling). Scored on primary intent: Upselling (7 Parameters).';
        mixedTurns = TRANSCRIPT_TEMPLATES['mixed_upsell_support'].map(t => ({
          ...t,
          text: t.text.replace(/Aahan/g, 'Aravind')
        }));
      } else if (rm.name === 'Sujal Dadwani' && i === 2) {
        isMultiCategoryCall = true;
        categoryKey = '13_pitching';
        category = '13% Club / Pitching';
        secondaryCategories = ['General / Support'];
        allCategories = ['13_pitching', 'support'];
        aiCategoryReasoning = 'AI Autotag (2 Categories Detected): Turns 1-4 resolved Demat account CDSL linking status (Customer Support). Turns 5-11 pitched 13% Club senior secured debt asset (Pitching). Scored on primary intent: Pitching (13 Parameters).';
        mixedTurns = TRANSCRIPT_TEMPLATES['mixed_pitch_support'].map(t => ({
          ...t,
          text: t.text.replace(/Aahan/g, 'Sujal')
        }));
      }

      // 11 PCG Quality Parameters
      const parameters = PCG_QUALITY_PARAMETERS.map((def, pIdx) => {
        const pHash = (globalId * 7 + pIdx * 19) % 100;
        let pStatus: 'Yes' | 'Half' | 'No' = 'Yes';
        let earned = def.maxWeight;
        if (iqsScore < 85) {
          if (pHash < 35) {
            pStatus = 'No';
            earned = 0;
          } else if (pHash < 55) {
            pStatus = 'Half';
            earned = Math.round(def.maxWeight / 2);
          }
        }

        let quote = def.defaultQuote;
        if (pStatus === 'No') {
          if (def.id === 'TechnicalLegal') quote = `Turn ${8 + pIdx}: Failed to disclose secondary market liquidity risk during yield discussion.`;
          else if (def.id === 'Expectation') quote = `Turn ${10 + pIdx}: Deferred client query without confirming callback time or ownership.`;
          else if (def.id === 'Fillers') quote = `Turn ${5 + pIdx}: Repeated filler words and unannounced silence during document lookup.`;
          else if (def.id === 'Process') quote = `Turn ${4 + pIdx}: Asked client to repeat holding information already on CRM record.`;
          else if (def.id === 'ActiveListening') quote = `Turn ${6 + pIdx}: Spoke over client while they were detailing liquidity requirements.`;
          else quote = `Turn ${7 + pIdx}: Did not fully satisfy parameter standard during conversation.`;
        } else if (pStatus === 'Half') {
          quote = `Turn ${5 + pIdx}: Partially met requirement; minor clarity slip noted.`;
        }

        return {
          id: def.id,
          name: `${def.num}. ${def.name}`,
          maxScore: def.maxWeight,
          earnedScore: earned,
          status: pStatus,
          quote,
        };
      });

      // Coaching tip
      let aiCoachingTip: string | null = null;
      if (needsAttention) {
        const tips = COACHING_TIPS_POOL[categoryKey] || COACHING_TIPS_POOL['13_pitching'];
        aiCoachingTip = tips[globalId % tips.length];
      }

      // Transcript turns
      const transcriptTurns = mixedTurns || TRANSCRIPT_TEMPLATES[categoryKey] || TRANSCRIPT_TEMPLATES['13_pitching'];

      // Dispute status: realistic sample for testing
      let disputeStatus: 'none' | 'pending' | 'resolved' = 'none';
      if (rm.name === 'Aahan Thaker') {
        if (i === 3) disputeStatus = 'pending';
        if (i === 6) disputeStatus = 'pending';
        if (i === 9) disputeStatus = 'resolved';
        if (i === 12) disputeStatus = 'resolved';
      } else if (globalId % 18 === 0) {
        disputeStatus = 'pending';
      } else if (globalId % 24 === 0) {
        disputeStatus = 'resolved';
      }

      // Synthetic Runo Call ID, client name & synthetic masked phone number
      const callId = `runo-${globalId}`;
      const dummyPhone = `+91 98765 ${String(10000 + globalId).slice(-5)}`;
      let clientName = CLIENT_NAMES[globalId % CLIENT_NAMES.length];
      if (rm.name === 'Aahan Thaker' && i === 1) clientName = 'Amit Kapoor';
      else if (rm.name === 'Aahan Thaker' && i === 4) clientName = 'Sunil Mehta';
      else if (rm.name === 'Dhanush' && i === 1) clientName = 'Pooja Nair';
      else if (rm.name === 'Aravind' && i === 1) clientName = 'Ramesh Iyer';
      else if (rm.name === 'Sujal Dadwani' && i === 2) clientName = 'Ananya Deshmukh';

      dummyList.push({
        id: String(globalId),
        callId,
        clientName,
        rmName: rm.name,
        tlName: `Team ${rm.tl}`,
        phoneNumber: dummyPhone,
        callType: i % 7 === 0 ? 'incoming' : 'outgoing',
        tag: !isAnswered ? (unansweredReason?.toLowerCase().includes('busy') ? 'busy' : 'unanswered') : null,
        durationSeconds: isMultiCategoryCall ? (140 + (globalId % 35)) : durationSeconds,
        startTime,
        isAnswered: isMultiCategoryCall ? true : isAnswered,
        hasRecording: isMultiCategoryCall ? true : isAnswered,
        category,
        categoryKey,
        secondaryCategories,
        allCategories,
        aiCategoryReasoning,
        iqsScore: isMultiCategoryCall ? (rm.name === 'Aahan Thaker' ? (i === 1 ? 88 : 92) : (85 + (globalId % 6))) : iqsScore,
        gates: { status: gateStatus, reason: gateReason },
        needsAttention: isMultiCategoryCall ? false : needsAttention,
        unansweredBy: isMultiCategoryCall ? null : unansweredBy,
        unansweredReason: isMultiCategoryCall ? null : unansweredReason,
        parameters,
        aiCoachingTip,
        transcriptTurns,
        disputeStatus,
      });
    }
  });

  return dummyList;
}

// Cached in-memory dummy pool
const ALL_DUMMY_CALLS = buildDummyCalls();

export const GET = withLogging(ROUTE, async (req: NextRequest) => {
  try {
    const { response } = await requireRole(['admin', 'tl', 'agent', 'quality']);
    if (response) return response;
  } catch {
    // Permitted in test branch local development
  }

  const { searchParams } = new URL(req.url);
  const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '10')));
  const offset = (page - 1) * limit;

  const rmFilter = searchParams.get('rm_name')?.trim();
  const tlFilter = searchParams.get('tl_name')?.trim();
  const callStatusFilter = searchParams.get('status')?.trim(); // 'all' | 'answered' | 'unanswered' | 'needs_attention'
  const categoryFilter = searchParams.get('category')?.trim(); // 'all' | '13_pitching' | 'upselling' | 'support' | 'coaching_available'
  const searchFilter = searchParams.get('search')?.trim().toLowerCase();
  const dateFrom = searchParams.get('date_from')?.trim();
  const dateTo = searchParams.get('date_to')?.trim();
  const dateRangeParam = searchParams.get('date_range')?.trim();
  const minIqsParam = searchParams.get('min_iqs')?.trim();
  const maxIqsParam = searchParams.get('max_iqs')?.trim();

  // Filter in-memory dummy calls
  let filtered = ALL_DUMMY_CALLS;

  if (rmFilter && rmFilter !== 'all') {
    filtered = filtered.filter(c => c.rmName.toLowerCase() === rmFilter.toLowerCase());
  }

  if (tlFilter && tlFilter !== 'all' && TL_TEAMS[tlFilter]) {
    const teamMembers = TL_TEAMS[tlFilter];
    filtered = filtered.filter(c => teamMembers.includes(c.rmName));
  }

  if (categoryFilter && categoryFilter !== 'all') {
    if (categoryFilter === 'coaching_available') {
      filtered = filtered.filter(c => !!c.aiCoachingTip);
    } else {
      filtered = filtered.filter(c => 
        c.categoryKey === categoryFilter || 
        (c.allCategories && c.allCategories.includes(categoryFilter))
      );
    }
  }

  if (searchFilter) {
    filtered = filtered.filter(c =>
      c.callId.toLowerCase().includes(searchFilter) ||
      c.phoneNumber.toLowerCase().includes(searchFilter) ||
      (c.clientName && c.clientName.toLowerCase().includes(searchFilter)) ||
      c.rmName.toLowerCase().includes(searchFilter)
    );
  }

  // Date filtering
  if (dateFrom && dateTo) {
    filtered = filtered.filter(c => c.startTime >= dateFrom && c.startTime <= `${dateTo}T23:59:59.999Z`);
  } else if (dateRangeParam === '7d') {
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    filtered = filtered.filter(c => c.startTime >= sevenDaysAgo);
  } else if (dateRangeParam === '30d') {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();
    filtered = filtered.filter(c => c.startTime >= thirtyDaysAgo);
  }

  // Summary calculation strictly scoped to filtered calls before evaluation table connected-only filter
  const scopedCallsList = filtered;
  const scopedTotal = scopedCallsList.length;
  const answeredCallsList = scopedCallsList.filter(c => c.isAnswered);
  const unansweredCallsList = scopedCallsList.filter(c => !c.isAnswered);
  const answeredCount = answeredCallsList.length;
  const unansweredCount = unansweredCallsList.length;
  const unansweredByRmCount = unansweredCallsList.filter(c => c.unansweredBy === 'RM').length;
  const unansweredByCustomerCount = unansweredCallsList.filter(c => c.unansweredBy === 'Customer').length;
  const totalDuration = scopedCallsList.reduce((acc, c) => acc + c.durationSeconds, 0);

  // Dynamic avgIqs computation across all answered calls in this scoped filter
  const avgIqs = answeredCount > 0
    ? parseFloat((answeredCallsList.reduce((acc, c) => acc + c.iqsScore, 0) / answeredCount).toFixed(1))
    : 83.4;

  // Evaluation table should NOT show calls which are not connected
  if (callStatusFilter === 'unanswered') {
    filtered = filtered.filter(c => !c.isAnswered);
  } else if (callStatusFilter === 'needs_attention') {
    filtered = filtered.filter(c => c.needsAttention && c.isAnswered);
  } else {
    // Default: Evaluation calls table only displays connected calls with evaluation data
    filtered = filtered.filter(c => c.isAnswered);
  }

  // Filter by Min / Max IQS
  if (minIqsParam && minIqsParam !== 'all') {
    const minVal = parseFloat(minIqsParam);
    if (!isNaN(minVal)) {
      filtered = filtered.filter(c => c.iqsScore >= minVal);
    }
  }

  if (maxIqsParam && maxIqsParam !== 'all') {
    const maxVal = parseFloat(maxIqsParam);
    if (!isNaN(maxVal)) {
      filtered = filtered.filter(c => c.iqsScore <= maxVal);
    }
  }

  // Total count for current filter (connected evaluation calls matching IQS range)
  const total = filtered.length;

  // Paginated calls
  const paginatedCalls = filtered.slice(offset, offset + limit);

  // Date-filtered pool for scorecards and team analytics
  let dateFilteredPool = ALL_DUMMY_CALLS;
  if (dateFrom && dateTo) {
    dateFilteredPool = dateFilteredPool.filter(c => c.startTime >= dateFrom && c.startTime <= `${dateTo}T23:59:59.999Z`);
  } else if (dateRangeParam === '7d') {
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    dateFilteredPool = dateFilteredPool.filter(c => c.startTime >= sevenDaysAgo);
  } else if (dateRangeParam === '30d') {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();
    dateFilteredPool = dateFilteredPool.filter(c => c.startTime >= thirtyDaysAgo);
  }

  // Distinct RMs list for dropdowns
  const rms = DUMMY_RMS.map(r => ({
    name: r.name,
    count: dateFilteredPool.filter(c => c.rmName === r.name).length,
  }));

  // RM Leaderboard & Scorecards calculated across the date-filtered dataset
  const rmScores: Record<string, { total: number; answered: number; pitch: number[]; upsell: number[]; support: number[]; flags: number }> = {};
  dateFilteredPool.forEach(c => {
    if (!rmScores[c.rmName]) {
      rmScores[c.rmName] = { total: 0, answered: 0, pitch: [], upsell: [], support: [], flags: 0 };
    }
    rmScores[c.rmName].total++;
    if (c.isAnswered) {
      rmScores[c.rmName].answered++;
      if (c.categoryKey === '13_pitching') rmScores[c.rmName].pitch.push(c.iqsScore);
      if (c.categoryKey === 'upselling') rmScores[c.rmName].upsell.push(c.iqsScore);
      if (c.categoryKey === 'support') rmScores[c.rmName].support.push(c.iqsScore);
      if (c.gates.status === 'FAIL') rmScores[c.rmName].flags++;
    }
  });

  const avg = (arr: number[]) => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null;

  const rmScorecards = DUMMY_RMS.map(r => {
    const data = rmScores[r.name] || { total: 0, answered: 0, pitch: [], upsell: [], support: [], flags: 0 };
    const allScores = [...data.pitch, ...data.upsell, ...data.support];
    const overall = avg(allScores) || (data.total > 0 ? 82 : 85);
    const trend = overall >= 85 ? 'improving' : overall < 78 ? 'declining' : 'stable';
    return {
      rmName: r.name,
      totalCalls: data.total,
      connectRate: data.total ? Math.round((data.answered / data.total) * 100) : 0,
      pitchScore: avg(data.pitch) || (overall + 2),
      upsellScore: avg(data.upsell) || (overall - 1),
      supportScore: avg(data.support) || overall,
      overallScore: overall,
      trend,
      complianceFlags: data.flags,
      topWeakness: overall < 85 ? 'Objection Handling on lock-in periods' : 'Brand introduction consistency',
    };
  }).sort((a, b) => b.overallScore - a.overallScore);

  return NextResponse.json({
    success: true,
    total,
    page,
    limit,
    totalPages: Math.max(1, Math.ceil(total / limit)),
    rms,
    rmScorecards,
    teamLeads: [
      {
        tlName: 'Gokul',
        teamSize: 5,
        totalCalls: dateFilteredPool.filter(c => TL_TEAMS.Gokul.includes(c.rmName)).length,
        connectRate: (() => {
          const tCalls = dateFilteredPool.filter(c => TL_TEAMS.Gokul.includes(c.rmName));
          const ans = tCalls.filter(c => c.isAnswered).length;
          return tCalls.length ? Math.round((ans / tCalls.length) * 100) : 67;
        })(),
        avgScore: (() => {
          const ans = dateFilteredPool.filter(c => TL_TEAMS.Gokul.includes(c.rmName) && c.isAnswered);
          return ans.length ? parseFloat((ans.reduce((a, c) => a + c.iqsScore, 0) / ans.length).toFixed(1)) : 86.8;
        })(),
        callsUnder85: dateFilteredPool.filter(c => TL_TEAMS.Gokul.includes(c.rmName) && c.needsAttention).length,
        rms: TL_TEAMS.Gokul,
      },
      {
        tlName: 'Vaishnavi',
        teamSize: 4,
        totalCalls: dateFilteredPool.filter(c => TL_TEAMS.Vaishnavi.includes(c.rmName)).length,
        connectRate: (() => {
          const tCalls = dateFilteredPool.filter(c => TL_TEAMS.Vaishnavi.includes(c.rmName));
          const ans = tCalls.filter(c => c.isAnswered).length;
          return tCalls.length ? Math.round((ans / tCalls.length) * 100) : 65;
        })(),
        avgScore: (() => {
          const ans = dateFilteredPool.filter(c => TL_TEAMS.Vaishnavi.includes(c.rmName) && c.isAnswered);
          return ans.length ? parseFloat((ans.reduce((a, c) => a + c.iqsScore, 0) / ans.length).toFixed(1)) : 85.1;
        })(),
        callsUnder85: dateFilteredPool.filter(c => TL_TEAMS.Vaishnavi.includes(c.rmName) && c.needsAttention).length,
        rms: TL_TEAMS.Vaishnavi,
      },
    ],
    summary: {
      totalCalls: scopedTotal,
      answeredCalls: answeredCount,
      unansweredCalls: unansweredCount,
      unansweredByRm: unansweredByRmCount,
      unansweredByCustomer: unansweredByCustomerCount,
      avgIqs,
      totalDurationSeconds: totalDuration,
      activeRmsCount: new Set(scopedCallsList.map(c => c.rmName)).size,
      categoryCounts: {
        pitching: scopedCallsList.filter(c => c.categoryKey === '13_pitching').length,
        upselling: scopedCallsList.filter(c => c.categoryKey === 'upselling').length,
        support: scopedCallsList.filter(c => c.categoryKey === 'support').length,
      },
      unansweredBreakdown: {
        customerRangOut: unansweredCallsList.filter(c => c.unansweredReason?.includes('Rang Out')).length,
        customerBusy: unansweredCallsList.filter(c => c.unansweredReason?.includes('Busy')).length,
        rmDroppedEarly: unansweredCallsList.filter(c => c.unansweredReason?.includes('Dropped Early')).length,
        rmMissed: unansweredCallsList.filter(c => c.unansweredReason?.includes('Missed')).length,
      },
      needsAttentionCount: scopedCallsList.filter(c => c.needsAttention).length,
      complianceFlagsCount: scopedCallsList.filter(c => c.gates.status === 'FAIL').length,
    },
    calls: paginatedCalls,
  });
});
