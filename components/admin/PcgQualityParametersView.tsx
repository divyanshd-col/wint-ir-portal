'use client';

import React, { useState, useMemo } from 'react';

export interface QualityParameterDefinition {
  id: string;
  num: number;
  name: string;
  key: string;
  weight: number;
  group: 'Process Skills' | 'Communication Skills' | 'Customer Service Skills';
  groupWeight: string;
  isTripwire?: boolean;
  summary: string;
  criteria: string[];
  standards: {
    yes: string;
    no: string;
    na: string;
  };
  tripwireRules?: string[];
}

export const PCG_PARAMETER_DEFINITIONS: QualityParameterDefinition[] = [
  // ── GROUP 1: PROCESS SKILLS (50%) ──────────────────────────────────────────
  {
    id: 'CallOpening',
    num: 1,
    name: 'Call Opening',
    key: 'CallOpening',
    weight: 5,
    group: 'Process Skills',
    groupWeight: '50%',
    summary:
      'Evaluates the initial 15-30 seconds of the call for professional greeting, brand identity, and explicit permission to speak before starting the agenda.',
    criteria: [
      'RM opens warmly and respectfully, addressing the client as Sir or Ma\'am.',
      'Identifies self and Wint Wealth (or Wint Wealth PCG) clearly in the opening few seconds.',
      'Explicitly checks client availability to talk before starting the agenda ("Is this a good time to speak?", "Do you have 2 minutes?").',
    ],
    standards: {
      yes: 'RM delivered respectful salutation (Sir/Ma\'am), identified the Wint Wealth brand clearly, and explicitly confirmed client availability before pitching or introducing topics.',
      no: 'Skipped checking availability and jumped straight into pitch/agenda, omitted Wint Wealth brand identification, or lacked a respectful salutation.',
      na: 'Client initiated the call and launched immediately into their agenda, or call was an immediate reconnection within minutes of an accidental drop.',
    },
  },
  {
    id: 'CallClosing',
    num: 2,
    name: 'Call Closing',
    key: 'CallClosing',
    weight: 5,
    group: 'Process Skills',
    groupWeight: '50%',
    summary:
      'Evaluates how the call ends, ensuring clear recap of agreed next steps, expressing gratitude, and delivering a polite sign-off.',
    criteria: [
      'RM closes warmly, leaving client with a clear sense of what happens next.',
      'Summarizes agreed next steps and follow-up commitments.',
      'Thanks the client for their time and offers ongoing availability.',
      'Ends with a polite Sir/Ma\'am sign-off.',
    ],
    standards: {
      yes: 'RM recapped next steps/timelines, thanked the client for their time, offered continued assistance, and ended with a courteous sign-off.',
      no: 'Abrupt disconnect by RM, left next steps unconfirmed or ambiguous, or rushed off without thanking the client.',
      na: 'Client abruptly hung up mid-sentence or call experienced a sudden technical/carrier disconnect outside RM control.',
    },
  },
  {
    id: 'TechnicallyLegal',
    num: 3,
    name: 'Technically / Legally Correct',
    key: 'TechnicallyLegal',
    weight: 15,
    group: 'Process Skills',
    groupWeight: '50%',
    isTripwire: true,
    summary:
      'Highest-priority quality & regulatory parameter. Verifies 100% factual accuracy against Knowledge Base & SEBI guidelines. Triggers an automatic compliance tripwire on violations.',
    criteria: [
      'All statements regarding AIF (Wint Wealth Debt Fund), MLDs, PMS, and Bonds must match official KB context, PMS Disclosure Document, AIF PPM, and SEBI regulations.',
      'Accurately communicates yield mechanics (target yield, XIRR, coupon vs principal) without guaranteeing outcomes.',
      'Accurately explains fees, hurdle rate, lock-in, tenure, and pass-through taxation.',
      'Zero guarantee promises: Never states or implies fixed/guaranteed returns on market-linked securities.',
    ],
    tripwireRules: [
      'Promises or implies guaranteed, assured, or fixed returns on AIF, MLDs, or bonds.',
      'Compares market-linked debt or AIF returns to risk-free bank FDs without highlighting credit and market risks.',
      'Quotes past performance without stating the mandatory disclaimer that past performance does not guarantee future returns.',
      'Misrepresents product structure, hurdle rate, lock-in, tenure, or taxation (e.g. claiming AIF returns are tax-free or MLD is senior secured by default).',
      'Provides unauthorized personalized investment advice beyond permitted SEBI execution/distribution scope.',
    ],
    standards: {
      yes: 'Accurately stated targeted yield/XIRR, tenure, lock-in, taxation, and credit risk verified against Knowledge Base; zero return guarantees promised.',
      no: 'Any factual inaccuracy or regulatory violation. Triggers "COMPLIANCE TRIPWIRE" & Critical Fail on submit with mandatory reviewer documentation.',
      na: 'Purely administrative callback scheduling; zero discussion of products, yields, or financial mechanics.',
    },
  },
  {
    id: 'AllQuestions',
    num: 4,
    name: 'All Questions Addressed',
    key: 'AllQuestions',
    weight: 10,
    group: 'Process Skills',
    groupWeight: '50%',
    summary:
      'Ensures every client query or hesitation is answered accurately, or transparently escalated with a committed timeline.',
    criteria: [
      'Every single client query, objection, or clarification asked during the call is answered clearly and accurately.',
      'If RM cannot answer live on call, handles transparently: confirms and clarifies the question, acknowledges needing to verify with ops or fund management team (does not guess), and commits to a specific follow-up timeline.',
    ],
    standards: {
      yes: 'All client questions were resolved accurately on call, or transparently deferred with a confirmed follow-up timeline without guessing.',
      no: 'A question was ignored, brushed aside, guessed incorrectly, or left hanging without a follow-up commitment.',
      na: 'Client asked zero questions during this specific call.',
    },
  },
  {
    id: 'Expectation',
    num: 5,
    name: 'Expectation Setting',
    key: 'Expectation',
    weight: 10,
    group: 'Process Skills',
    groupWeight: '50%',
    summary:
      'Evaluates whether the RM sets clear operational timelines and ownership for pending investor workflows and requests.',
    criteria: [
      'On open items or pending requests (drawdown, allotment, onboarding, account statements, redemption, ops tickets), RM provides a clear timeline or takes clear ownership to coordinate with backend team and provide an update.',
      'Providing an exact TAT is not mandatory if the RM clearly takes ownership, commits to coordinate with backend team, and promises an update as soon as possible.',
    ],
    standards: {
      yes: 'RM provided a clear timeline, next step, or backend escalation commitment for pending actions.',
      no: 'Client had open pending items or asked for a timeline, but RM gave no timeline, took no ownership, or gave vague answers ("I\'ll see").',
      na: 'All matters were resolved live on the call with no open items or timeline-sensitive follow-ups.',
    },
  },
  {
    id: 'Process',
    num: 6,
    name: 'Process / Pre-check',
    key: 'Process',
    weight: 5,
    group: 'Process Skills',
    groupWeight: '50%',
    summary:
      'Checks whether the RM prepared with client context (CRM holdings, past calls, tickets) prior to dialing to avoid wasting client time.',
    criteria: [
      'RM is prepared with client context (holdings, prior calls, recent transactions, CRM notes) from CRM/PCG Finder.',
      'Does not ask the client to repeat known information already on record; avoids unnecessary hold time.',
    ],
    standards: {
      yes: 'RM demonstrated preparation by referencing existing holdings, prior discussions, or account details without making client repeat themselves.',
      no: 'Asked client to repeat basic holdings or ticket details already on record, or took prolonged unannounced holds to check basic details.',
      na: 'Brand new lead with zero prior CRM history or account records.',
    },
  },

  // ── GROUP 2: COMMUNICATION SKILLS (30%) ────────────────────────────────────
  {
    id: 'VocabularyGrammar',
    num: 7,
    name: 'Vocabulary / Sentence Structure / Grammar / Pronunciations',
    key: 'VocabularyGrammar',
    weight: 10,
    group: 'Communication Skills',
    groupWeight: '30%',
    summary:
      'Evaluates linguistic professionalism, sentence construction, and correct pronunciation of fund names and financial terminology.',
    criteria: [
      'Professional vocabulary, correct pronunciation of fund names and financial terms (e.g., AIF, MLD, debentures, XIRR).',
      'Comfortable code-switching between English and Hindi is acceptable.',
      'Minor slips excused; focus is purely on language, tone, and grammar per utterance.',
    ],
    standards: {
      yes: 'RM maintained polished, professional vocabulary and correct sentence construction, with accurate pronunciation of fund and financial terms.',
      no: 'Repeated grammatical breakdowns, broken phrasing, or mispronunciations that caused confusion or impaired advisory professionalism.',
      na: 'Language and communication could not be evaluated due to insufficient speech samples.',
    },
  },
  {
    id: 'FillersDeadAir',
    num: 8,
    name: 'Fillers, Fumbling & Stammering / Speech Clarity / Avoid Dead Air',
    key: 'FillersDeadAir',
    weight: 10,
    group: 'Communication Skills',
    groupWeight: '30%',
    summary:
      'Assesses delivery fluency, avoidance of excessive filler words, and elimination of unannounced dead air longer than 5 seconds.',
    criteria: [
      'Clear, steady delivery without excessive fillers ("uh", "um", "matlab", "like").',
      'Avoids awkward dead air.',
      'Announced pauses ("Please give me a moment while I pull up your statement") are treated as legitimate HOLDS, NOT dead air.',
      'Dead air > 5 seconds without a prior hold announcement is penalized.',
    ],
    standards: {
      yes: 'Fluent and confident delivery with minimal filler words; all system lookup pauses were clearly announced to the client.',
      no: 'Frequent distracting filler words, noticeable stammering/fumbling, or unannounced dead air exceeding 5 seconds.',
      na: 'Delivery fluency could not be reliably evaluated.',
    },
  },
  {
    id: 'EnergyTone',
    num: 9,
    name: 'Warmth, Energy & Tone Modulation',
    key: 'EnergyTone',
    weight: 10,
    group: 'Communication Skills',
    groupWeight: '30%',
    summary:
      'Evaluated directly from audio acoustics. Attentive, calm, composed energy suited to HNI wealth advisory rather than aggressive pitching.',
    criteria: [
      'Attentive, calm, composed energy suited to HNI wealth management (not high-pressure aggressive pitching).',
      'Modulates tone appropriately: reassuring and patient on market volatility, upbeat and confident on payouts and investment milestones.',
    ],
    standards: {
      yes: 'RM maintained a calm, composed, and courteous tone suited to HNI wealth advisory, remaining patient and welcoming throughout.',
      no: 'RM sounded flat, bored, monotone, impatient, or overly aggressive/rushed during client dialogue.',
      na: 'Audio recording was unavailable (scored on transcript-only fallback).',
    },
  },

  // ── GROUP 3: CUSTOMER SERVICE SKILLS (20%) ────────────────────────────────
  {
    id: 'ActiveListening',
    num: 10,
    name: 'Active Listening, Interruptions & Empathy',
    key: 'ActiveListening',
    weight: 10,
    group: 'Customer Service Skills',
    groupWeight: '20%',
    summary:
      'Measures conversational courtesy, zero client interruptions, and demonstrating genuine empathy when investors express concern.',
    criteria: [
      'Listens attentively without interrupting, talking over client, or having parallel background conversations.',
      'Demonstrates genuine empathy when client raises concerns (delays, volatility, statements) before jumping to explanations.',
    ],
    standards: {
      yes: 'RM listened patiently without interrupting and demonstrated genuine empathy when the client voiced questions or concerns.',
      no: 'RM interrupted, talked over the client, dismissed client concerns, or showed a lack of empathy.',
      na: 'Active listening and empathy situations did not arise during the call.',
    },
  },
  {
    id: 'Simplifying',
    num: 11,
    name: 'Simplifying Answers',
    key: 'Simplifying',
    weight: 10,
    group: 'Customer Service Skills',
    groupWeight: '20%',
    summary:
      'Evaluates ability to demystify complex financial concepts into plain language matched to client financial literacy.',
    criteria: [
      'Explains complex terms (hurdle rate, high-water mark, drawdown, carried interest, NAV, pass-through taxation, Senior Secured) in plain language matched to client understanding.',
      'Avoids over-explaining or patronizing savvy HNI investors.',
    ],
    standards: {
      yes: 'RM explained complex financial concepts using plain language, intuitive analogies, or concrete numerical examples.',
      no: 'RM used heavy, unexplained financial jargon that left the investor confused or overwhelmed.',
      na: 'No complex financial or technical concepts were discussed during the call.',
    },
  },
];

export default function PcgQualityParametersView() {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedGroup, setSelectedGroup] = useState<'all' | 'Process Skills' | 'Communication Skills' | 'Customer Service Skills' | 'compliance'>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filteredParams = useMemo(() => {
    return PCG_PARAMETER_DEFINITIONS.filter((param) => {
      // Group filter
      if (selectedGroup === 'compliance') {
        if (!param.isTripwire) return false;
      } else if (selectedGroup !== 'all' && param.group !== selectedGroup) {
        return false;
      }

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesName = param.name.toLowerCase().includes(q);
        const matchesKey = param.key.toLowerCase().includes(q);
        const matchesSummary = param.summary.toLowerCase().includes(q);
        const matchesCriteria = param.criteria.some((c) => c.toLowerCase().includes(q));
        const matchesStandards =
          param.standards.yes.toLowerCase().includes(q) ||
          param.standards.no.toLowerCase().includes(q) ||
          param.standards.na.toLowerCase().includes(q);
        const matchesTripwires = param.tripwireRules?.some((t) => t.toLowerCase().includes(q)) ?? false;

        return matchesName || matchesKey || matchesSummary || matchesCriteria || matchesStandards || matchesTripwires;
      }

      return true;
    });
  }, [searchQuery, selectedGroup]);

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  return (
    <div className="space-y-6 pb-12">
      {/* ── HEADER ───────────────────────────────────────────────────────────── */}
      <div className="bg-white border border-[#E4E4E7] rounded-xl p-6 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-[#18181B] tracking-tight">
              Quality Parameter Definitions
            </h1>
          </div>
        </div>

        {/* ── SCORING LOGIC CALLOUT ───────────────────────────────────────────── */}
        <div className="mt-5 pt-5 border-t border-[#F4F4F5] grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-[#FAFAFA] border border-[#E4E4E7] rounded-lg p-3.5">
            <div className="flex items-center gap-2 mb-1 text-xs font-semibold text-zinc-800">
              <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
              Rating Values
            </div>
            <p className="text-xs text-zinc-600 leading-relaxed">
              <strong className="text-zinc-900">Yes:</strong> 100% weight earned.<br />
              <strong className="text-zinc-900">No:</strong> 0% weight earned.<br />
              <strong className="text-zinc-900">NA:</strong> Dynamically dropped from both earned & possible weight.
            </p>
          </div>

          <div className="bg-[#FAFAFA] border border-[#E4E4E7] rounded-lg p-3.5">
            <div className="flex items-center gap-2 mb-1 text-xs font-semibold text-zinc-800">
              <span className="w-2 h-2 rounded-full bg-blue-500"></span>
              IQS Formula
            </div>
            <div className="text-xs text-zinc-600 leading-relaxed">
              <div className="font-mono bg-white px-2 py-1 rounded border border-zinc-200 text-zinc-800 text-[11px] mb-1.5 inline-block">
                IQS = (Earned Weights / Applicable Max Weights) × 100
              </div>
              <p className="text-[11px] text-zinc-500 leading-snug">
                RM is never penalized for scenarios that did not occur on the call (NA dynamically drops from both numerator &amp; denominator).
              </p>
            </div>
          </div>

          <div className="bg-red-50/60 border border-red-200 rounded-lg p-3.5">
            <div className="flex items-center gap-2 mb-1 text-xs font-semibold text-red-900">
              <span className="w-2 h-2 rounded-full bg-red-600"></span>
              Compliance Gate Rule
            </div>
            <p className="text-xs text-red-700 leading-relaxed">
              A failure on <strong className="text-red-950 font-semibold">Technically / Legally Correct</strong> triggers an automatic <strong className="text-red-950 font-semibold">GATE BREACH</strong> and Critical Fail on submit.
            </p>
          </div>
        </div>
      </div>

      {/* ── FILTER TABS & SEARCH BAR ─────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        {/* Skill Group Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
          <button
            onClick={() => setSelectedGroup('all')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
              selectedGroup === 'all'
                ? 'bg-zinc-900 text-white shadow-sm'
                : 'bg-white text-zinc-600 hover:bg-zinc-100 border border-zinc-200'
            }`}
          >
            All Groups (11)
          </button>
          <button
            onClick={() => setSelectedGroup('Process Skills')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
              selectedGroup === 'Process Skills'
                ? 'bg-zinc-900 text-white shadow-sm'
                : 'bg-white text-zinc-600 hover:bg-zinc-100 border border-zinc-200'
            }`}
          >
            Process Skills (50%)
          </button>
          <button
            onClick={() => setSelectedGroup('Communication Skills')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
              selectedGroup === 'Communication Skills'
                ? 'bg-zinc-900 text-white shadow-sm'
                : 'bg-white text-zinc-600 hover:bg-zinc-100 border border-zinc-200'
            }`}
          >
            Communication (30%)
          </button>
          <button
            onClick={() => setSelectedGroup('Customer Service Skills')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
              selectedGroup === 'Customer Service Skills'
                ? 'bg-zinc-900 text-white shadow-sm'
                : 'bg-white text-zinc-600 hover:bg-zinc-100 border border-zinc-200'
            }`}
          >
            Customer Service (20%)
          </button>
          <button
            onClick={() => setSelectedGroup('compliance')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer flex items-center gap-1.5 ${
              selectedGroup === 'compliance'
                ? 'bg-red-600 text-white shadow-sm'
                : 'bg-red-50 text-red-700 hover:bg-red-100 border border-red-200'
            }`}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            Compliance (1)
          </button>
        </div>

        {/* Search Input */}
        <div className="relative w-full sm:w-72">
          <svg
            className="absolute left-3 top-2.5 text-zinc-400"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search parameter or criteria..."
            className="w-full pl-9 pr-3 py-1.5 bg-white border border-zinc-200 rounded-lg text-xs text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-zinc-800"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-2 text-zinc-400 hover:text-zinc-600 text-xs cursor-pointer"
            >
              ×
            </button>
          )}
        </div>
      </div>

      {/* ── PARAMETERS LIST ──────────────────────────────────────────────────── */}
      {filteredParams.length === 0 ? (
        <div className="bg-white border border-[#E4E4E7] rounded-xl p-12 text-center text-zinc-500">
          <p className="text-sm">No quality parameters match your search query &quot;{searchQuery}&quot;.</p>
          <button
            onClick={() => {
              setSearchQuery('');
              setSelectedGroup('all');
            }}
            className="mt-3 text-xs text-zinc-900 underline font-medium cursor-pointer"
          >
            Clear filters
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredParams.map((param) => {
            const isExpanded = expandedId === 'all' || expandedId === param.id;

            return (
              <div
                key={param.id}
                className={`bg-white border rounded-xl overflow-hidden shadow-sm transition-all duration-150 ${
                  param.isTripwire ? 'border-red-200 hover:border-red-300' : 'border-[#E4E4E7] hover:border-zinc-300'
                }`}
              >
                {/* Parameter Card Header */}
                <div
                  onClick={() => toggleExpand(param.id)}
                  className="p-5 flex items-start justify-between gap-4 cursor-pointer hover:bg-zinc-50/60 transition-colors"
                >
                  <div className="flex items-start gap-3.5">
                    <span className="w-7 h-7 rounded-lg bg-zinc-100 text-zinc-800 text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                      P{param.num}
                    </span>

                    <div>
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <h2 className="text-base font-semibold text-[#18181B] tracking-tight">
                          {param.name}
                        </h2>
                        <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-zinc-900 text-white">
                          {param.weight}% Weight
                        </span>
                        <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-zinc-100 text-zinc-700">
                          {param.group}
                        </span>
                        {param.isTripwire && (
                          <span className="px-2 py-0.5 rounded text-[10px] font-extrabold uppercase tracking-wide bg-red-100 text-red-800 border border-red-300 flex items-center gap-1">
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                              <line x1="12" y1="9" x2="12" y2="13" />
                              <line x1="12" y1="17" x2="12.01" y2="17" />
                            </svg>
                            Compliance Gate
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-[#71717A] leading-relaxed line-clamp-2 md:line-clamp-none">
                        {param.summary}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 pt-1 text-zinc-400">
                    <span className="text-[11px] text-zinc-500 hidden sm:inline font-mono">
                      key: {param.key}
                    </span>
                    <svg
                      className={`transform transition-transform duration-200 ${isExpanded ? 'rotate-180 text-zinc-700' : ''}`}
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </div>
                </div>

                {/* Parameter Expanded Details */}
                {isExpanded && (
                  <div className="px-5 pb-6 pt-2 border-t border-[#F4F4F5] bg-[#FAFAFA]/40 space-y-5">
                    {/* 1. Evaluation Criteria */}
                    <div>
                      <h3 className="text-xs font-bold text-zinc-800 uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="9 11 12 14 22 4" />
                          <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                        </svg>
                        Exact Evaluation Criteria
                      </h3>
                      <ul className="space-y-1.5 bg-white border border-zinc-200/80 rounded-lg p-4">
                        {param.criteria.map((item, idx) => (
                          <li key={idx} className="text-xs text-zinc-700 flex items-start gap-2 leading-relaxed">
                            <span className="text-zinc-400 mt-0.5">•</span>
                            <span>{item}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    {/* Tripwire Rules Callout if applicable */}
                    {param.tripwireRules && (
                      <div className="bg-red-50/70 border border-red-200 rounded-lg p-4">
                        <h4 className="text-xs font-bold text-red-900 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2" />
                            <line x1="12" y1="8" x2="12" y2="12" />
                            <line x1="12" y1="16" x2="12.01" y2="16" />
                          </svg>
                          Automatic Compliance Failure Triggers:
                        </h4>
                        <ul className="space-y-1.5">
                          {param.tripwireRules.map((rule, idx) => (
                            <li key={idx} className="text-xs text-red-800 flex items-start gap-2 leading-relaxed">
                              <span className="text-red-500 font-bold shrink-0">✕</span>
                              <span>{rule}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* 2. Rating Standards: Yes / No / NA */}
                    <div>
                      <h3 className="text-xs font-bold text-zinc-800 uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="10" />
                          <line x1="12" y1="16" x2="12" y2="12" />
                          <line x1="12" y1="8" x2="12.01" y2="8" />
                        </svg>
                        System Rating Standards & Explanation Requirements
                      </h3>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        {/* Yes Standard */}
                        <div className="bg-white border border-emerald-200/90 rounded-lg p-3.5 shadow-2xs">
                          <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-800 mb-1.5">
                            <span className="w-4 h-4 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-[10px]">✓</span>
                            Pass (&quot;Yes&quot;)
                          </div>
                          <p className="text-xs text-zinc-600 leading-relaxed">
                            {param.standards.yes}
                          </p>
                        </div>

                        {/* No Standard */}
                        <div className="bg-white border border-rose-200/90 rounded-lg p-3.5 shadow-2xs">
                          <div className="flex items-center gap-1.5 text-xs font-bold text-rose-800 mb-1.5">
                            <span className="w-4 h-4 rounded-full bg-rose-100 text-rose-700 flex items-center justify-center text-[10px]">✕</span>
                            Fail (&quot;No&quot;)
                          </div>
                          <p className="text-xs text-zinc-600 leading-relaxed">
                            {param.standards.no}
                          </p>
                        </div>

                        {/* NA Standard */}
                        <div className="bg-white border border-zinc-200 rounded-lg p-3.5 shadow-2xs">
                          <div className="flex items-center gap-1.5 text-xs font-bold text-zinc-700 mb-1.5">
                            <span className="w-4 h-4 rounded-full bg-zinc-100 text-zinc-600 flex items-center justify-center text-[10px]">—</span>
                            Not Applicable (&quot;NA&quot;)
                          </div>
                          <p className="text-xs text-zinc-600 leading-relaxed">
                            {param.standards.na}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
