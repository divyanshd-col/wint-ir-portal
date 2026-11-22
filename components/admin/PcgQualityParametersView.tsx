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
  conditional?: boolean;
  conditionalInfo?: {
    whenEvaluated: string;
    whenNA: string;
    reason: string;
  };
  summary: string;
  criteria: string[];
  standards: {
    yes: string;
    half?: string;
    no: string;
    na: string;
  };
  tripwireRules?: string[];
}

export interface ChatComplianceCheckItem {
  id: string;
  num: number;
  name: string;
  rule: string;
  description: string;
  triggerExample: string;
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. VOICE CALL QUALITY PARAMETERS (11 Parameters across 3 Groups)
// ══════════════════════════════════════════════════════════════════════════════
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

// ══════════════════════════════════════════════════════════════════════════════
// 2. WHATSAPP CHAT QUALITY PARAMETERS (11 Parameters across 3 Groups)
// ══════════════════════════════════════════════════════════════════════════════
export const PCG_CHAT_PARAMETER_DEFINITIONS: QualityParameterDefinition[] = [
  // ── GROUP 1: PROCESS SKILLS (50%) ──────────────────────────────────────────
  {
    id: 'QueryResolution',
    num: 1,
    name: 'Query Resolution',
    key: 'QueryResolution',
    weight: 20,
    group: 'Process Skills',
    groupWeight: '50%',
    summary:
      'Did the RM or AM deal with every single query, objection, or request raised by the client, and either resolve it fully or properly move it forward to the right team or call.',
    criteria: [
      'Every question and request raised by the customer is addressed across the conversation, not just the first or easiest query.',
      'If the agent cannot answer live, properly escalates to ops, product, or fund management team, or coordinates a voice call.',
      'Never leaves a customer question hanging, brushed aside, or ignored.',
      'Leaves the investor with a clear next step or confirmed resolution before concluding the session.',
    ],
    standards: {
      yes: 'Every single client question was resolved fully, or escalated with confirmed next steps and clear ownership.',
      half: 'The main query was resolved, but a secondary question or follow-up clarification was missed or left partially answered.',
      no: 'Ignored, dodged, or dismissed key investor questions, gave an incorrect brush-off, or closed the chat leaving open queries unaddressed.',
      na: 'No queries or questions were raised by the customer in this thread (pure greeting exchange or acknowledgment).',
    },
  },
  {
    id: 'Accuracy',
    num: 2,
    name: 'Accuracy (Technically / Legally Correct)',
    key: 'Accuracy',
    weight: 20,
    group: 'Process Skills',
    groupWeight: '50%',
    isTripwire: true,
    summary:
      'Was what the RM or AM said 100% correct per Wint Knowledge Base, PMS Disclosure Document, AIF PPM, and SEBI rules (strategies, fees, lock-in, taxation, NAV, returns).',
    criteria: [
      'All product statements regarding AIF, PMS, MLDs, and High-Yield Bonds match official Knowledge Base and SEBI rules.',
      'Accurately explains yields (XIRR, target IRR, coupon vs. principal), fees, hurdle rate, lock-in, tenure, and pass-through taxation.',
      'Zero promises or implications of guaranteed, fixed, or risk-free returns on market-linked securities.',
      'Minor phrasing slips that are immediately self-corrected in the same thread before client action are scored leniently.',
    ],
    tripwireRules: [
      'Promises or implies guaranteed, assured, or fixed returns on AIF, MLDs, or market-linked bonds.',
      'Quotes past performance without stating the mandatory statutory disclaimer that past performance does not guarantee future results.',
      'Misrepresents product structure, lock-in, tenure, hurdle rate, or taxation (e.g. claiming AIF returns are tax-free).',
      'Provides unauthorized personalized investment advice beyond permitted SEBI execution and distribution scope.',
    ],
    standards: {
      yes: 'All financial details, product mechanics, tax implications, and regulatory terms were completely accurate per Knowledge Base; zero return guarantees.',
      half: 'Minor slip in phrasing or non-critical specification that was immediately self-corrected in thread and did not mislead the client.',
      no: 'Factual inaccuracy, incorrect product terms, or misleading statement regarding returns, lock-in, taxation, or risk. Triggers Compliance Gate Review.',
      na: 'Purely administrative logistics with zero discussion of financial products, returns, yields, or tax mechanics.',
    },
  },
  {
    id: 'ExpectationFollowThrough',
    num: 3,
    name: 'Expectation & Follow-Through',
    key: 'ExpectationFollowThrough',
    weight: 15,
    group: 'Process Skills',
    groupWeight: '50%',
    summary:
      'Does the client know when they will hear back (clear TAT / next steps), took personal ownership, and did the agent honour visible follow-through commitments.',
    criteria: [
      'On open items or pending requests (drawdown, allotment, statement generation, redemption, KYC), establishes a transparent timeline (TAT) or next update window.',
      'Takes clear personal ownership ("I am coordinating with our ops team and will update you by 3 PM") rather than vague hand-waving.',
      'Faithfully honours follow-through commitments made in earlier messages or preceding sessions.',
    ],
    standards: {
      yes: 'Client clearly knows when they will hear back, next steps are explicit, and all follow-through commitments were honoured.',
      half: 'Took ownership to follow up, but timeline was vague ("soon", "later") or delayed without a proactive advance update.',
      no: 'Open pending items left without any expectation set, vague uncommitted promises, or failed to deliver on committed updates.',
      na: 'Query resolved immediately and completely on the spot with zero open items or pending operational workflows.',
    },
  },
  {
    id: 'Personalisation',
    num: 4,
    name: 'Personalisation & Relationship Context',
    key: 'Personalisation',
    weight: 15,
    group: 'Process Skills',
    groupWeight: '50%',
    summary:
      'Was the reply built around this client\'s portfolio, specific holdings/tranches, and conversation history, without asking for info already shared.',
    criteria: [
      'References the investor\'s specific holdings, tranche names, invested amounts, or prior interactions from CRM / preceding chat summary.',
      'Avoids asking the investor for information, screenshots, or documents already provided in earlier messages or preceding chats.',
      'Does not send robotic, one-size-fits-all copy-paste templates that ignore the investor\'s specific scenario.',
    ],
    standards: {
      yes: 'Response was distinctly tailored to this client\'s specific portfolio, holdings, and history, leveraging preceding context seamlessly.',
      half: 'Partially tailored to the issue, but relies on boilerplate text or re-confirms a detail already visible in the conversation history.',
      no: 'Generic copy-pasted template that ignores client context, or forces the client to repeat details already provided.',
      na: 'Brand new lead with zero prior CRM history or account records.',
    },
  },
  {
    id: 'EscalationToCall',
    num: 8,
    name: 'Escalation to Call',
    key: 'EscalationToCall',
    weight: 4,
    group: 'Process Skills',
    groupWeight: '50%',
    conditional: true,
    conditionalInfo: {
      whenEvaluated: 'Only when an issue is complex or heated enough that offering or conducting a voice call is relevant.',
      whenNA: 'When the customer\'s question is straightforward and easily handled via text in chat.',
      reason: 'Transitioning to a voice call is only evaluated when necessary for high-touch complex topics or severe complaints. Routine inquiries drop cleanly to NA without penalty.',
    },
    summary:
      'Was moving to a call, or staying in chat, the right decision for this client situation. NA if call question never arose.',
    criteria: [
      'Correctly recognizes when a complex query, multi-step financial planning topic, or escalating frustration requires a voice call rather than prolonged typing.',
      'Smoothly coordinates the call offer: checks client convenience and confirms scheduled dialing time.',
      'Does not push unnecessary calls for simple questions that can easily be answered in a 2-line chat.',
    ],
    standards: {
      yes: 'Made the right call: proactively offered/executed a voice call for high-touch complexity, or kept simple matter in chat seamlessly.',
      half: 'Offered a call but did not specify a time or follow up to confirm client convenience.',
      no: 'Persisted in endless back-and-forth chat text during a complex escalation that clearly demanded an immediate voice call.',
      na: 'Routine inquiry where call escalation was neither necessary nor suggested.',
    },
  },
  {
    id: 'PostCallRecap',
    num: 9,
    name: 'Post-Call Recap',
    key: 'PostCallRecap',
    weight: 4,
    group: 'Process Skills',
    groupWeight: '50%',
    conditional: true,
    conditionalInfo: {
      whenEvaluated: 'Only when a phone call actually took place between the RM and client.',
      whenNA: 'When no voice call occurred (100% text-only conversation on WhatsApp).',
      reason: 'A written recap is mandatory only after concluding a call so that both parties share documented next steps. If no call was conducted, this parameter drops to NA without deducting points.',
    },
    summary:
      'Evaluated whenever chat references a completed call: did RM post a written summary of what was discussed and agreed. NA if no call took place.',
    criteria: [
      'Sends a concise written recap on WhatsApp summarizing agreed decisions, investment actions, and next steps discussed on the call.',
      'Provides a clear reference point so the investor has a documented record of commitments.',
    ],
    standards: {
      yes: 'Sent a clear, structured written recap on WhatsApp summarizing what was agreed on the call and next steps.',
      half: 'Sent a message after the call, but only thanked the client without summarizing agreed actions or timelines.',
      no: 'Completed a substantive call but posted zero written recap or follow-up summary in the chat thread.',
      na: 'No phone call occurred during or preceding this WhatsApp session (purely text conversation).',
    },
  },

  // ── GROUP 2: CUSTOMER SERVICE SKILLS (20%) ────────────────────────────────
  {
    id: 'DissatisfactionHandling',
    num: 5,
    name: 'Dissatisfaction Handling',
    key: 'DissatisfactionHandling',
    weight: 8,
    group: 'Customer Service Skills',
    groupWeight: '20%',
    conditional: true,
    conditionalInfo: {
      whenEvaluated: 'Only when the client is visibly upset, complaining, demanding, or distressed.',
      whenNA: 'On calm, routine, or positive chats with zero expressions of dissatisfaction.',
      reason: 'RMs are never penalized for dissatisfaction handling on calm chats where the client never raised a grievance. The parameter drops from both numerator and denominator (NA).',
    },
    summary:
      'Judged only when client is visibly unhappy, complaining, demanding, or distressed. Stays non-defensive, offers a concrete way forward. Otherwise NA.',
    criteria: [
      'Stays calm, courteous, and non-defensive when the investor expresses frustration or criticism.',
      'Validates the client\'s frustration without blaming other internal departments or arguing.',
      'Offers a concrete, actionable resolution path and prioritization.',
    ],
    standards: {
      yes: 'Handled dissatisfaction with poise, empathy, and non-defensiveness; provided an immediate, concrete solution and escalation plan.',
      half: 'Polite and non-argumentative, but response was somewhat mechanical or failed to fully address the emotional temperature.',
      no: 'Defensive, argumentative, dismissive of client frustration, shifted blame, or ignored the complaint entirely.',
      na: 'Calm, routine conversation with zero expressions of dissatisfaction, frustration, or complaints from the investor.',
    },
  },
  {
    id: 'Empathy',
    num: 6,
    name: 'Empathy',
    key: 'Empathy',
    weight: 5,
    group: 'Customer Service Skills',
    groupWeight: '20%',
    conditional: true,
    conditionalInfo: {
      whenEvaluated: 'Only when the investor expresses anxiety, worry about market drops, delays, or confusion.',
      whenNA: 'On standard transactional inquiries (e.g. requesting a statement or drawdown link) where reassurance is not warranted.',
      reason: 'Demonstrating empathy is judged specifically when the client displays vulnerability, distress, or confusion. For purely transactional interactions, this parameter drops cleanly to NA.',
    },
    summary:
      'Judged only in gentler moments of confusion, worry about markets/drawdowns, anxiety, or apology. Specific acknowledgement fitting the moment. Otherwise NA.',
    criteria: [
      'Acknowledges investor concerns with genuine warmth and reassurance before launching into technical details.',
      'Tailors empathetic acknowledgment to the specific situation (e.g. drawdown anxiety vs. onboarding delay) rather than stock sympathy lines.',
    ],
    standards: {
      yes: 'Demonstrated genuine, tailored empathy acknowledging the investor\'s concern before guiding them to clarity.',
      half: 'Acknowledged the concern, but used generic stock courtesy phrasing ("We understand your concern") without situation-specific warmth.',
      no: 'Cold, purely robotic transaction that completely bypassed investor\'s stated anxiety or hesitation.',
      na: 'Standard transactional or informational chat where emotional reassurance was not warranted.',
    },
  },
  {
    id: 'SimplifyingConcepts',
    num: 7,
    name: 'Simplifying Concepts',
    key: 'SimplifyingConcepts',
    weight: 5,
    group: 'Customer Service Skills',
    groupWeight: '20%',
    conditional: true,
    conditionalInfo: {
      whenEvaluated: 'Only when complex financial concepts arise (hurdle rate, drawdown, pass-through taxation, TWRR vs XIRR, exit load, senior secured debt).',
      whenNA: 'When the conversation does not involve complex financial terminology or technical structuring.',
      reason: 'Agents should not force complex explanations or patronize investors when not needed. When no advanced financial concepts are discussed, this parameter is excluded as NA.',
    },
    summary:
      'Judged only when complex terms arise (hurdle rate, high-water mark, drawdown, exit load, pass-through taxation, TWRR, XIRR, YTM, TDS, Record Date). Otherwise NA.',
    criteria: [
      'Demystifies complex terms (hurdle rate, high-water mark, drawdown, pass-through taxation, TWRR vs XIRR, exit load, TDS, senior secured structure).',
      'Uses intuitive plain language, clear analogies, or quick numerical examples suited to client understanding.',
      'Avoids patronizing experienced HNI investors while ensuring clear comprehension.',
    ],
    standards: {
      yes: 'Complex financial mechanics were explained with crisp, intuitive language and concrete examples easy to digest on mobile.',
      half: 'Explanation was technically accurate but somewhat dense, requiring extra effort from the investor to unpack.',
      no: 'Overwhelmed client with unexplained technical jargon or gave confusing, contradictory explanations.',
      na: 'No complex financial concepts or technical terms arose in this conversation.',
    },
  },

  // ── GROUP 3: COMMUNICATION SKILLS (30%) ────────────────────────────────────
  {
    id: 'ReadabilityTone',
    num: 10,
    name: 'Readability & Professional Tone',
    key: 'ReadabilityTone',
    weight: 2,
    group: 'Communication Skills',
    groupWeight: '30%',
    summary:
      'Could the client easily read the messages on a phone, and was the tone respectful and professional for an HNI client (no solid unformatted text blocks, no raw internal jargon).',
    criteria: [
      'Messages are formatted cleanly with bullet points, line breaks, and bold emphasis so they are effortless to read on a mobile phone screen.',
      'Maintains a polished, courteous, and professional tone suited to HNI wealth management.',
      'Free of internal acronyms or raw ops jargon (e.g. "backend ticket #1024 dropped").',
      'Note: Hinglish, Hindi typed in English script, and minor casual typos are NEVER penalized.',
    ],
    standards: {
      yes: 'Messages were easy to read on mobile with clean paragraphs/spacing, respectful tone, and polished language.',
      no: 'Sent massive unbroken text walls, used inappropriate slang or harsh tone, or exposed confusing internal raw system jargon.',
      na: 'Insufficient agent text to evaluate readability and tone.',
    },
  },
  {
    id: 'GreetingClosing',
    num: 11,
    name: 'Greeting & Closing',
    key: 'GreetingClosing',
    weight: 2,
    group: 'Communication Skills',
    groupWeight: '30%',
    summary:
      'Did the RM open respectfully with Sir/Ma\'am, introduce self/Wint Wealth on first contact/new thread, and close the conversation properly upon resolution.',
    criteria: [
      'Opens respectfully with Sir/Ma\'am or personalized salutation.',
      'Introduces self and Wint Wealth on first contact or brand-new thread.',
      'In ongoing threads, polite acknowledgment ("Hi Sir", "Good morning Sir") meets the opening standard.',
      'Concludes the conversation politely once the query is resolved, thanking the investor and offering ongoing availability.',
    ],
    standards: {
      yes: 'Respectful opening with Sir/Ma\'am, proper brand introduction when appropriate, and polite conversational closing upon resolution.',
      no: 'Lacked respectful salutation, jumped abruptly into messages without greeting, or abandoned chat abruptly without closing.',
      na: 'Ongoing rapid back-and-forth exchange where formal re-greeting would be awkward.',
    },
  },
];

// 5 Dedicated WhatsApp Compliance Checks
export const PCG_CHAT_COMPLIANCE_DEFINITIONS: ChatComplianceCheckItem[] = [
  {
    id: 'NoInvestmentAdvice',
    num: 1,
    name: 'No Investment Advice',
    rule: 'We do not tell the client what to invest in beyond what SEBI permits.',
    description:
      'RMs and AMs act strictly within SEBI distribution and execution-only guidelines. Never recommend specific portfolio allocation or provide personalized advisory opinions without SEBI RIA licensure.',
    triggerExample:
      'Telling an investor "You should definitely allocate 25 Lakhs into this AIF tranche instead of equity" violates SEBI distribution boundaries.',
  },
  {
    id: 'NoPromisedReturns',
    num: 2,
    name: 'No Promised / Guaranteed Returns',
    rule: 'We do not say returns are guaranteed, assured, or risk-free.',
    description:
      'Market-linked debentures (MLDs), AIFs, and high-yield bonds carry market, credit, and liquidity risks. Never state or imply that capital or returns are 100% assured or risk-free.',
    triggerExample:
      'Stating "Your 13.5% return is guaranteed by Wint" triggers an immediate critical compliance failure.',
  },
  {
    id: 'NoUnqualifiedPastPerformance',
    num: 3,
    name: 'No Unqualified Past Performance',
    rule: 'Past returns are shared only with the mandatory disclaimer, and not selectively or deceptively.',
    description:
      'Whenever past track record, annualized yields, or historical tranche exits are quoted, the mandatory regulatory disclaimer ("Past performance is not indicative of future returns") must accompany the message.',
    triggerExample:
      'Sharing historical fund performance numbers while omitting the statutory SEBI disclaimer.',
  },
  {
    id: 'NoPersonalOrInternalDocuments',
    num: 4,
    name: 'No Personal or Internal Documents on WhatsApp',
    rule: 'No client statements, holding reports, KYC documents with PAN/Aadhaar/Bank details, or internal policies/tools screenshots sent by RM on WhatsApp.',
    description:
      'Client data privacy and security policy strictly forbids transmitting raw PAN cards, Aadhaar images, unmasked bank account statements, or internal tool/admin screenshots over WhatsApp chat.',
    triggerExample:
      'Agent sending a screenshot of internal admin CRM or an unmasked client bank passbook on WhatsApp.',
  },
  {
    id: 'NoMisleadingMistakes',
    num: 5,
    name: 'No Misleading Mistakes',
    rule: 'No factual error serious enough to push a client into a wrong money decision.',
    description:
      'Zero tolerance for severe factual misstatements on critical parameters such as lock-in duration, drawdown dates, minimum ticket size, tax deduction (TDS), or capital seniority.',
    triggerExample:
      'Informing an investor that an AIF has zero lock-in or that quarterly distributions are completely tax-exempt.',
  },
];

// ══════════════════════════════════════════════════════════════════════════════
// 3. EMAIL QUALITY PARAMETERS (7 Parameters across 3 Groups)
// ══════════════════════════════════════════════════════════════════════════════
export const EMAIL_PARAMETER_DEFINITIONS: QualityParameterDefinition[] = [
  // ── GROUP 1: PROCESS SKILLS (65%) ──────────────────────────────────────────
  {
    id: 'issue_resolution',
    num: 1,
    name: 'Issue Resolution',
    key: 'issue_resolution',
    weight: 25,
    group: 'Process Skills',
    groupWeight: '65%',
    summary:
      'Does the email address every question and request raised by the customer and either resolve the issue or properly move it forward with clear guidance.',
    criteria: [
      'Every single question and request is addressed, including any pending items left open from earlier emails in the thread.',
      'If the agent says they will check or follow up, the reply explains what will happen next (concerned team or next check-in).',
      'If customer shares a document, screenshot, or account update without a direct question, agent acknowledges it and takes next steps.',
      'The customer is never left without guidance on what to do next.',
    ],
    standards: {
      yes: 'Every question and request is addressed, and the issue is resolved or properly progressed (ticket raised, escalated, doc forwarded, or clear next step).',
      half: 'The main issue is addressed, but a smaller question or request is missed or only partly answered, or the next step is unclear.',
      no: 'A key question or request is missed, the reply does not address the customer\'s actual concern, or the issue is left unresolved without a clear next step.',
      na: 'No customer issue to resolve (general announcement, routine update, survey, policy notification, or standard auto-closure notice).',
    },
  },
  {
    id: 'accuracy',
    num: 2,
    name: 'Accuracy',
    key: 'accuracy',
    weight: 25,
    group: 'Process Skills',
    groupWeight: '65%',
    isTripwire: true,
    summary:
      'Whether everything the agent told the client is correct per Wint Knowledge Base, PCG-exclusive AIF & MLD KBs, PMS Disclosure Document, AIF PPM, and SEBI rules, with required disclaimers, protected client details, and verified attachments.',
    criteria: [
      'Facts, dates, amounts, product terms (AIF, MLD, PMS, Bonds), and process steps are 100% accurate against customer account data and the shared PCG Knowledge Base (same KBs used for PCG Calls and Chats).',
      'No guaranteed returns, predictions, or unauthorized personal investment advice.',
      'Required statutory and SEBI disclaimers are present where applicable.',
      'Only the client\'s own details are shared; zero data leakage of other investors.',
      'Any attached document (statement, certificate, form) is actually attached, named in the body, and verified correct.',
    ],
    tripwireRules: [
      'Promises or implies guaranteed or fixed returns on market-linked investments.',
      'Shares another client\'s personal details, PAN, statement, or confidential account information.',
      'Omits required statutory disclaimer on Tier A investment communications.',
      'Attaches the wrong customer statement or sends an incorrect document.',
    ],
    standards: {
      yes: 'All information is accurate, correct product named, no guarantees/predictions/advice, required disclaimer present, and attachments correct.',
      half: 'Minor wording slip that does not change meaning, safe footer omission on Tier B reply, or attachment mentioned loosely.',
      no: 'Wrong fact, date, amount, or step that could mislead; wrong product named; return guarantee; another client\'s data shared; or wrong attachment.',
      na: 'Not applicable to this email context.',
    },
  },
  {
    id: 'expectation_setting',
    num: 3,
    name: 'Expectation Setting',
    key: 'expectation_setting',
    weight: 15,
    group: 'Process Skills',
    groupWeight: '65%',
    summary:
      'The agent answers the core query completely, states correct process and realistic TAT, provides personalized follow-up, and shares helpful educational points.',
    criteria: [
      'Answers the core query completely and states correct process and realistic turnaround time (TAT).',
      'For repayment cases where specific TAT cannot be defined, communicates available information and next steps without committing to unrealistic timelines.',
      'Follow-ups are personalized to the user\'s query rather than generic.',
      'Corrects any past errors in the thread without waiting to be asked.',
    ],
    standards: {
      yes: 'Complete answer, correct process, clear TAT wherever applicable, and personalized follow-up.',
      half: 'Answer is correct, but process, TAT (where applicable), or follow-up is missing or generic.',
      no: 'Core query unanswered, wrong process, or no expectation set.',
      na: 'Resolved immediately with zero open operational workflows.',
    },
  },

  // ── GROUP 2: CUSTOMER SERVICE SKILLS (20%) ────────────────────────────────
  {
    id: 'personalisation',
    num: 4,
    name: 'Personalisation',
    key: 'personalisation',
    weight: 10,
    group: 'Customer Service Skills',
    groupWeight: '20%',
    summary:
      'Is the email written for this client, not a template? Uses actual situation, references specific details, builds on earlier replies, and avoids asking for info already provided.',
    criteria: [
      'Written specifically for this client and situation rather than sounding like a raw copy-pasted template.',
      'Refers to customer\'s actual bonds, amounts, dates, or account status.',
      'Builds on earlier replies and avoids asking for information the client already provided.',
    ],
    standards: {
      yes: 'Reflects client\'s actual case, references specific details (bond, amounts, dates, status), and asks for nothing already shared.',
      half: 'Partly tailored but has template elements (mentions situation in general terms, leaves out available details).',
      no: 'Reads like a robotic template or copy-paste reply; does not reflect actual situation; asks for info client already gave.',
      na: 'First-time generic inquiry with zero account context.',
    },
  },
  {
    id: 'empathy',
    num: 5,
    name: 'Empathy',
    key: 'empathy',
    weight: 10,
    group: 'Customer Service Skills',
    groupWeight: '20%',
    conditional: true,
    conditionalInfo: {
      whenEvaluated:
        'Only when the client expresses concern, frustration, urgency, dissatisfaction, confusion, or worry about a delay, payout, tax filing, or financial stake.',
      whenNA:
        'On calm, purely transactional emails (e.g. routine document requests, status confirmations, simple factual queries) where the client has raised no complaint, delay, or emotional concern.',
      reason:
        'Empathy is judged specifically when genuine care, reassurance, or ownership is warranted. Agents are never forced to add scripted sympathy lines to routine transactional emails—when no emotional concern is present, this parameter drops cleanly to NA (excluded from both numerator and denominator without penalizing IQS).',
    },
    summary:
      'Understands customer feelings and stakes (urgency, frustration, money involved), takes ownership with warm, polite language, and calms irritated customers.',
    criteria: [
      'Understands customer feelings and stakes (urgency, frustration, money involved).',
      'Takes ownership with warm, polite language, calming irritated or anxious customers.',
      'Natural and professional tone, neither overly colloquial nor stiff and robotic.',
    ],
    standards: {
      yes: 'Ownership and warmth are genuine and specific to this customer\'s situation with personalized empathetic phrasing.',
      half: 'Polite and acknowledges customer, but acknowledgement is generic/templated, or warmth comes only from stock courtesy lines.',
      no: 'Cold, mechanical, or dismissive where care was clearly needed, or ignores emotional concern raised.',
      na: 'Customer is calm and has raised no worry, complaint, delay, or problem (status updates, confirmations, simple requests).',
    },
  },

  // ── GROUP 3: COMMUNICATION SKILLS (15%) ────────────────────────────────────
  {
    id: 'sentences_simple_to_understand',
    num: 6,
    name: 'Sentences (Simple to Understand)',
    key: 'sentences_simple_to_understand',
    weight: 10,
    group: 'Communication Skills',
    groupWeight: '15%',
    summary:
      'Easy to read, short sentences without unexplained jargon, formatted with emphasis (bold/italics) where needed, error-free, and natural/non-robotic tone.',
    criteria: [
      'Sentences are short, clean, and easy to follow; technical jargon is avoided or demystified.',
      'Well formatted: important details (amounts, dates, TAT, steps) are emphasized with bold or spacing for quick scanning.',
      'Error-free: zero spelling mistakes, typos, or grammatical slips.',
      'Conversational and human, not a stiff or robotic script.',
    ],
    standards: {
      yes: 'All four checks pass: simple and clear, well formatted (key details emphasized), error-free, and sounds natural.',
      half: 'Understandable, but dense, cluttered, or lacks emphasis on key details; or minor errors; or partly scripted/stiff.',
      no: 'Confusing, jargon-heavy, hard to read; errors change meaning; or whole response sounds robotic.',
      na: 'Insufficient text to evaluate sentence structure.',
    },
  },
  {
    id: 'opening_and_closing',
    num: 7,
    name: 'Opening & Closing Message',
    key: 'opening_and_closing',
    weight: 5,
    group: 'Communication Skills',
    groupWeight: '15%',
    summary:
      'Opening and closing messages are natural, personalised, and appropriate to the context of the thread and current stage of resolution.',
    criteria: [
      'Opening and closing messages are natural, personalized, and appropriate to the context and stage of resolution.',
      'Avoids multiple stacked stock phrases or repetitive sympathy lines across consecutive emails.',
    ],
    standards: {
      yes: 'Opening and closing are tied to the case, natural, and respectful.',
      half: 'Contains one stock phrase, and personal touch is missing or very light.',
      no: 'Multiple stock phrases, fully generic pair, repeated sympathy across consecutive emails, or awkward closing.',
      na: 'Ongoing rapid exchange where formal re-opening is redundant.',
    },
  },
];

export const EMAIL_COMPLIANCE_DEFINITIONS: ChatComplianceCheckItem[] = [
  {
    id: 'G1_no_advice',
    num: 1,
    name: 'G1: Advice (No Investment / Tax Advice)',
    rule: 'We do not provide unauthorized personal investment recommendations or tax advisory beyond factual disclosures.',
    description:
      'Agents must strictly share factual product details, coupon schedules, and filing statuses without recommending specific allocations or giving personal tax advice. Marked NA when the customer query is purely operational and no advisory context arises.',
    triggerExample:
      '"You should definitely move your FD into this NCD before March to save tax—it is the safest option for your portfolio."',
  },
  {
    id: 'G2_no_fabrication',
    num: 2,
    name: 'G2: Fabrication (No Fabricated Facts)',
    rule: 'All dates, amounts, payout timelines, and operational statuses must be verified and truthful.',
    description:
      'Never guess or fabricate coupon dates, TRACES/Form 16A timelines, payout figures, or operations confirmations. If details are pending verification, clearly communicate next steps instead of inventing commitments.',
    triggerExample:
      '"Your Form 16A has already been uploaded to 26AS today" when the return is still awaiting TRACES generation.',
  },
  {
    id: 'G3_identity_first',
    num: 3,
    name: 'G3: Identity (Identity Verified First)',
    rule: 'Protect client PII and share account-specific details only after verifying registered client identity.',
    description:
      'Verify registered email, PAN, or masked account details before disclosing holdings, statements, or payout information. Never expose another investor\'s details or unmasked sensitive identifiers.',
    triggerExample:
      'Sending an account statement or full bank/PAN details to an unverified third-party email address without confirmation.',
  },
];

interface PcgQualityParametersViewProps {
  initialChannel?: 'calls' | 'chats' | 'emails';
}

export default function PcgQualityParametersView({ initialChannel = 'calls' }: PcgQualityParametersViewProps = {}) {
  const [selectedChannel, setSelectedChannel] = useState<'calls' | 'chats' | 'emails'>(initialChannel);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedGroup, setSelectedGroup] = useState<'all' | 'Process Skills' | 'Communication Skills' | 'Customer Service Skills' | 'compliance'>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Switch channel handler
  const handleChannelChange = (channel: 'calls' | 'chats' | 'emails') => {
    setSelectedChannel(channel);
    setSelectedGroup('all');
    setSearchQuery('');
    setExpandedId(null);
  };

  // Select active parameters list based on channel
  const currentParamsList = useMemo(() => {
    if (selectedChannel === 'chats') return PCG_CHAT_PARAMETER_DEFINITIONS;
    if (selectedChannel === 'emails') return EMAIL_PARAMETER_DEFINITIONS;
    return PCG_PARAMETER_DEFINITIONS;
  }, [selectedChannel]);

  // Filtered parameters
  const filteredParams = useMemo(() => {
    return currentParamsList.filter((param) => {
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
          (param.standards.half?.toLowerCase().includes(q) ?? false) ||
          param.standards.no.toLowerCase().includes(q) ||
          param.standards.na.toLowerCase().includes(q);
        const matchesTripwires = param.tripwireRules?.some((t) => t.toLowerCase().includes(q)) ?? false;

        return matchesName || matchesKey || matchesSummary || matchesCriteria || matchesStandards || matchesTripwires;
      }

      return true;
    });
  }, [currentParamsList, searchQuery, selectedGroup]);

  // Filtered compliance checks for Chat
  const filteredChatCompliance = useMemo(() => {
    if (selectedChannel !== 'chats') return [];
    if (!searchQuery.trim()) return PCG_CHAT_COMPLIANCE_DEFINITIONS;
    const q = searchQuery.toLowerCase().trim();
    return PCG_CHAT_COMPLIANCE_DEFINITIONS.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.rule.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q) ||
        c.triggerExample.toLowerCase().includes(q)
    );
  }, [selectedChannel, searchQuery]);

  // Filtered compliance gates for Email
  const filteredEmailCompliance = useMemo(() => {
    if (selectedChannel !== 'emails') return [];
    if (!searchQuery.trim()) return EMAIL_COMPLIANCE_DEFINITIONS;
    const q = searchQuery.toLowerCase().trim();
    return EMAIL_COMPLIANCE_DEFINITIONS.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.rule.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q) ||
        c.triggerExample.toLowerCase().includes(q)
    );
  }, [selectedChannel, searchQuery]);

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  return (
    <div className="space-y-6 pb-12">
      {/* ── HEADER & CHANNEL TOGGLES ────────────────────────────────────────── */}
      <div className="bg-white border border-[#E4E4E7] rounded-xl p-6 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-[#18181B] tracking-tight">
              Quality Parameter Definitions
            </h1>
            <p className="text-xs text-zinc-500 mt-1">
              {selectedChannel === 'calls' && '11 Voice call evaluation parameters across 3 skill groups, covering client greeting, regulatory adherence, and relationship conduct.'}
              {selectedChannel === 'chats' && '11 WhatsApp chat quality parameters + 5 compliance checks, covering query resolution, multi-session thread continuity, and SEBI compliance.'}
              {selectedChannel === 'emails' && '7 Email quality parameters + 3 compliance gates across 3 skill groups, covering issue resolution, accuracy, expectation setting, and professional communication.'}
            </p>
          </div>

          {/* Channel Switcher Pills */}
          <div className="inline-flex items-center p-1 bg-zinc-100 rounded-xl border border-zinc-200/80 self-start md:self-auto shrink-0">
            {/* Calls Toggle */}
            <button
              onClick={() => handleChannelChange('calls')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center gap-2 ${selectedChannel === 'calls'
                  ? 'bg-white text-zinc-900 shadow-sm font-bold'
                  : 'text-zinc-600 hover:text-zinc-900'
                }`}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
              </svg>
              <span>Calls</span>
              <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${selectedChannel === 'calls' ? 'bg-zinc-100 text-zinc-900' : 'bg-zinc-200/60 text-zinc-600'}`}>
                11
              </span>
            </button>

            {/* Chats Toggle */}
            <button
              onClick={() => handleChannelChange('chats')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center gap-2 ${selectedChannel === 'chats'
                  ? 'bg-white text-zinc-900 shadow-sm font-bold'
                  : 'text-zinc-600 hover:text-zinc-900'
                }`}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              <span>Chats</span>
              <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${selectedChannel === 'chats' ? 'bg-zinc-100 text-zinc-900' : 'bg-zinc-200/60 text-zinc-600'}`}>
                11
              </span>
            </button>

            {/* Emails Toggle */}
            <button
              onClick={() => handleChannelChange('emails')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center gap-2 ${selectedChannel === 'emails'
                  ? 'bg-white text-zinc-900 shadow-sm font-bold'
                  : 'text-zinc-600 hover:text-zinc-900'
                }`}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect width="20" height="16" x="2" y="4" rx="2" />
                <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
              </svg>
              <span>Emails</span>
              <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${selectedChannel === 'emails' ? 'bg-zinc-100 text-zinc-900' : 'bg-zinc-200/60 text-zinc-600'}`}>
                7
              </span>
            </button>
          </div>
        </div>

        {/* ── SCORING LOGIC CALLOUTS (CALLS, CHATS & EMAILS) ─────────────────── */}
        <div className="mt-5 pt-5 border-t border-[#F4F4F5] grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Card 1: Rating Values */}
          <div className="bg-[#FAFAFA] border border-[#E4E4E7] rounded-lg p-3.5">
            <div className="flex items-center gap-2 mb-1 text-xs font-semibold text-zinc-800">
              <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
              Rating Values
            </div>
            {selectedChannel === 'calls' ? (
              <p className="text-xs text-zinc-600 leading-relaxed">
                <strong className="text-zinc-900">Yes:</strong> 100% weight earned.<br />
                <strong className="text-zinc-900">No:</strong> 0% weight earned.<br />
                <strong className="text-zinc-900">NA:</strong> Dynamically dropped from both earned &amp; possible weight.
              </p>
            ) : (
              <p className="text-xs text-zinc-600 leading-relaxed">
                <strong className="text-zinc-900">Yes:</strong> 100% weight earned (fully met).<br />
                <strong className="text-zinc-900">Half:</strong> 50% weight earned (one minor gap).<br />
                <strong className="text-zinc-900">No:</strong> 0% weight earned &bull; <strong className="text-zinc-900">NA:</strong> Excluded from denominator.
              </p>
            )}
          </div>

          {/* Card 2: IQS Formula */}
          <div className="bg-[#FAFAFA] border border-[#E4E4E7] rounded-lg p-3.5">
            <div className="flex items-center gap-2 mb-1 text-xs font-semibold text-zinc-800">
              <span className="w-2 h-2 rounded-full bg-blue-500"></span>
              {selectedChannel === 'calls' ? 'IQS Formula' : selectedChannel === 'emails' ? 'Email IQS Formula' : 'Chat IQS Formula'}
            </div>
            <div className="text-xs text-zinc-600 leading-relaxed">
              <div className="font-mono bg-white px-2 py-1 rounded border border-zinc-200 text-zinc-800 text-[11px] mb-1.5 inline-block">
                IQS = (Earned Weights / Applicable Max Weights) × 100
              </div>
              <p className="text-[11px] text-zinc-500 leading-snug">
                {selectedChannel === 'calls'
                  ? 'RM is never penalized for scenarios that did not occur on the call (NA dynamically drops from both numerator & denominator).'
                  : selectedChannel === 'emails'
                    ? 'Agent is never penalized for scenarios that did not apply to the email reply (NA dynamically drops from both numerator & denominator).'
                    : 'Agent is never penalized for conditional scenarios that did not occur (e.g. Dissatisfaction or Recap drop cleanly from denominator).'}
              </p>
            </div>
          </div>

          {/* Card 3: Compliance Rule */}
          <div className="bg-red-50/60 border border-red-200 rounded-lg p-3.5">
            <div className="flex items-center gap-2 mb-1 text-xs font-semibold text-red-900">
              <span className="w-2 h-2 rounded-full bg-red-600"></span>
              {selectedChannel === 'calls'
                ? 'Compliance Gate Rule'
                : selectedChannel === 'emails'
                  ? '3 Email Compliance Gates'
                  : '5 WhatsApp Compliance Checks'}
            </div>
            {selectedChannel === 'calls' ? (
              <p className="text-xs text-red-700 leading-relaxed">
                A failure on <strong className="text-red-950 font-semibold">Technically / Legally Correct</strong> triggers an automatic <strong className="text-red-950 font-semibold">GATE BREACH</strong> and Critical Fail on submit.
              </p>
            ) : selectedChannel === 'emails' ? (
              <p className="text-xs text-red-700 leading-relaxed">
                Evaluated against 3 gates (<strong className="text-red-950 font-semibold">Pass / Breach / NA</strong>): G1 Advice (No Investment / Tax Advice), G2 Fabrication (No Fabricated Facts), and G3 Identity (Identity Verified First). NA does not count as a breach.
              </p>
            ) : (
              <p className="text-xs text-red-700 leading-relaxed">
                Evaluated against 5 checks: No Investment Advice, No Promised Returns, No Unqualified Past Performance, No Docs on WhatsApp, and No Misleading Mistakes.
              </p>
            )}
          </div>
        </div>

        {/* ── PRECEDING CHAT EVALUATION SUMMARY CALLOUT (FOR CHATS) ──────────── */}
        {selectedChannel === 'chats' && (
          <div className="mt-5 pt-5 border-t border-[#F4F4F5]">
            <div className="bg-[#FAFAFA] border border-[#E4E4E7] rounded-xl p-4 sm:p-5 shadow-2xs">
              <div className="flex items-start gap-3.5">
                <div className="w-8 h-8 rounded-lg bg-zinc-900 text-white flex items-center justify-center shrink-0 mt-0.5 shadow-2xs">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                    <line x1="9" y1="10" x2="15" y2="10" />
                    <line x1="12" y1="7" x2="12" y2="13" />
                  </svg>
                </div>
                <div className="space-y-3 flex-1 min-w-0">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-sm font-bold text-zinc-900 tracking-tight">
                        How Preceding Chats &amp; Session Summaries are Evaluated
                      </h2>
                      <span className="px-2 py-0.5 rounded text-[10px] font-extrabold uppercase bg-zinc-200/80 text-zinc-800 border border-zinc-300">
                        Multi-Session &amp; AM Handoff Rule
                      </span>
                    </div>
                    <p className="text-xs text-zinc-600 mt-1 leading-relaxed">
                      WhatsApp client relationships often span multiple sessions and may involve mid-thread handovers (e.g. from an RM to an Associate Manager / AM). The AI pipeline automatically summarizes preceding sessions to ensure fair and contextual evaluations:
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-0.5">
                    {/* Pillar 1 */}
                    <div className="bg-white border border-zinc-200 rounded-lg p-3 shadow-2xs">
                      <div className="flex items-center gap-1.5 text-xs font-bold text-zinc-900 mb-1">
                        <span className="w-4 h-4 rounded-full bg-zinc-100 text-zinc-800 flex items-center justify-center text-[10px] font-bold border border-zinc-200">1</span>
                        Evaluated Strictly on Authored Messages
                      </div>
                      <p className="text-[11px] text-zinc-600 leading-relaxed">
                        The active agent is graded <strong className="text-zinc-900 font-semibold">only on the messages they personally authored</strong>. When an RM transfers a chat to an AM, the AM is evaluated exclusively from the moment they take over.
                      </p>
                    </div>

                    {/* Pillar 2 */}
                    <div className="bg-white border border-zinc-200 rounded-lg p-3 shadow-2xs">
                      <div className="flex items-center gap-1.5 text-xs font-bold text-zinc-900 mb-1">
                        <span className="w-4 h-4 rounded-full bg-zinc-100 text-zinc-800 flex items-center justify-center text-[10px] font-bold border border-zinc-200">2</span>
                        Zero Inherited Penalties
                      </div>
                      <p className="text-[11px] text-zinc-600 leading-relaxed">
                        The current agent is <strong className="text-zinc-900 font-semibold">never penalized</strong> for the prior RM&apos;s delays, tone, speed, or errors. Preceding history and AI session summaries are passed to the evaluator strictly as background context.
                      </p>
                    </div>

                    {/* Pillar 3 */}
                    <div className="bg-white border border-zinc-200 rounded-lg p-3 shadow-2xs">
                      <div className="flex items-center gap-1.5 text-xs font-bold text-zinc-900 mb-1">
                        <span className="w-4 h-4 rounded-full bg-zinc-100 text-zinc-800 flex items-center justify-center text-[10px] font-bold border border-zinc-200">3</span>
                        Context Awareness &amp; Thread Continuity
                      </div>
                      <p className="text-[11px] text-zinc-600 leading-relaxed">
                        The agent is expected to <strong className="text-zinc-900 font-semibold">leverage prior context</strong> so the investor is not asked to repeat details. References to prior agreements (&ldquo;as discussed yesterday&rdquo;) are verified using the summary to award full marks.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* ── DUAL CHATS (CO-HANDLED) EVALUATION SUMMARY CALLOUT ──────────── */}
            <div className="mt-3 bg-[#FAFAFA] border border-[#E4E4E7] rounded-xl p-4 sm:p-5 shadow-2xs">
              <div className="flex items-start gap-3.5">
                <div className="w-8 h-8 rounded-lg bg-indigo-600 text-white flex items-center justify-center shrink-0 mt-0.5 shadow-2xs">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                    <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                  </svg>
                </div>
                <div className="space-y-3 flex-1 min-w-0">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-sm font-bold text-zinc-900 tracking-tight">
                        How Dual Chats (Co-Handled) are Evaluated
                      </h2>
                      <span className="px-2 py-0.5 rounded text-[10px] font-extrabold uppercase bg-indigo-50 text-indigo-700 border border-indigo-200">
                        Dual Chat Audit Rule
                      </span>
                    </div>
                    <p className="text-xs text-zinc-600 mt-1 leading-relaxed">
                      When a WhatsApp conversation is handled collaboratively by two agents (e.g. an RM transfers to an AM, or two RMs co-handle), the evaluation applies both client-level scoring and individual accountability:
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-0.5">
                    {/* Pillar 1 */}
                    <div className="bg-white border border-zinc-200 rounded-lg p-3 shadow-2xs">
                      <div className="flex items-center gap-1.5 text-xs font-bold text-zinc-900 mb-1">
                        <span className="w-4 h-4 rounded-full bg-indigo-50 text-indigo-700 flex items-center justify-center text-[10px] font-bold border border-indigo-200">1</span>
                        One Overall Chat Score
                      </div>
                      <p className="text-[11px] text-zinc-600 leading-relaxed">
                        The interaction is graded as <strong className="text-zinc-900 font-semibold">one cohesive client experience</strong>. A single IQS score (0–100%) is generated for the thread reflecting whether the client&apos;s inquiries were smoothly resolved from start to finish.
                      </p>
                    </div>

                    {/* Pillar 2 */}
                    <div className="bg-white border border-zinc-200 rounded-lg p-3 shadow-2xs">
                      <div className="flex items-center gap-1.5 text-xs font-bold text-zinc-900 mb-1">
                        <span className="w-4 h-4 rounded-full bg-indigo-50 text-indigo-700 flex items-center justify-center text-[10px] font-bold border border-indigo-200">2</span>
                        General Enquiries Attribute to Both
                      </div>
                      <p className="text-[11px] text-zinc-600 leading-relaxed">
                        Handling client queries (<strong className="text-zinc-900 font-semibold">Query Resolution</strong>) is a shared responsibility. Both agents are held jointly accountable for ensuring all general enquiries and objections are completely addressed across the handoff.
                      </p>
                    </div>

                    {/* Pillar 3 */}
                    <div className="bg-white border border-zinc-200 rounded-lg p-3 shadow-2xs">
                      <div className="flex items-center gap-1.5 text-xs font-bold text-zinc-900 mb-1">
                        <span className="w-4 h-4 rounded-full bg-indigo-50 text-indigo-700 flex items-center justify-center text-[10px] font-bold border border-indigo-200">3</span>
                        Compliance Breaches Attribute to Both
                      </div>
                      <p className="text-[11px] text-zinc-600 leading-relaxed">
                        Regulatory compliance is a zero-tolerance standard. If a compliance gate breach occurs anywhere in the co-handled thread (e.g. promising returns or sending internal docs), the breach is <strong className="text-zinc-900 font-semibold">attributed to both agents</strong>.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── PREVIOUS EMAIL REPLIES & CONTEXT EVALUATION CALLOUT (FOR EMAILS) ── */}
        {selectedChannel === 'emails' && (
          <div className="mt-5 pt-5 border-t border-[#F4F4F5]">
            <div className="bg-[#FAFAFA] border border-[#E4E4E7] rounded-xl p-4 sm:p-5 shadow-2xs">
              <div className="flex items-start gap-3.5">
                <div className="w-8 h-8 rounded-lg bg-zinc-900 text-white flex items-center justify-center shrink-0 mt-0.5 shadow-2xs">
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect width="20" height="16" x="2" y="4" rx="2" />
                    <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                  </svg>
                </div>
                <div className="space-y-3 flex-1 min-w-0">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-sm font-bold text-zinc-900 tracking-tight">
                        How Previous Email Replies &amp; Thread Context are Evaluated
                      </h2>
                      <span className="px-2 py-0.5 rounded text-[10px] font-extrabold uppercase bg-zinc-200/80 text-zinc-800 border border-zinc-300">
                        Per-Reply Evaluation Rule
                      </span>
                    </div>
                    <p className="text-xs text-zinc-600 mt-1 leading-relaxed">
                      Client email threads often span multiple back-and-forth replies and handoffs between RMs and AMs. Earlier emails in the thread are passed to the evaluator strictly for context, while each agent is evaluated exclusively on the reply they sent:
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-0.5">
                    {/* Pillar 1 */}
                    <div className="bg-white border border-zinc-200 rounded-lg p-3 shadow-2xs">
                      <div className="flex items-center gap-1.5 text-xs font-bold text-zinc-900 mb-1">
                        <span className="w-4 h-4 rounded-full bg-zinc-100 text-zinc-800 flex items-center justify-center text-[10px] font-bold border border-zinc-200">1</span>
                        Evaluated Only on the Reply Sent
                      </div>
                      <p className="text-[11px] text-zinc-600 leading-relaxed">
                        The agent (RM or AM) is scored <strong className="text-zinc-900 font-semibold">strictly on the specific outbound email reply they personally sent</strong>. Earlier or subsequent replies by other handlers on the same ticket are never mixed into their score.
                      </p>
                    </div>

                    {/* Pillar 2 */}
                    <div className="bg-white border border-zinc-200 rounded-lg p-3 shadow-2xs">
                      <div className="flex items-center gap-1.5 text-xs font-bold text-zinc-900 mb-1">
                        <span className="w-4 h-4 rounded-full bg-zinc-100 text-zinc-800 flex items-center justify-center text-[10px] font-bold border border-zinc-200">2</span>
                        Previous Replies Used Only as Context
                      </div>
                      <p className="text-[11px] text-zinc-600 leading-relaxed">
                        Preceding customer emails and prior agent responses are provided purely as <strong className="text-zinc-900 font-semibold">background context</strong>. The agent is never penalized for delays, missing details, or tone from previous replies in the thread.
                      </p>
                    </div>

                    {/* Pillar 3 */}
                    <div className="bg-white border border-zinc-200 rounded-lg p-3 shadow-2xs">
                      <div className="flex items-center gap-1.5 text-xs font-bold text-zinc-900 mb-1">
                        <span className="w-4 h-4 rounded-full bg-zinc-100 text-zinc-800 flex items-center justify-center text-[10px] font-bold border border-zinc-200">3</span>
                        Thread Continuity &amp; Awareness
                      </div>
                      <p className="text-[11px] text-zinc-600 leading-relaxed">
                        Using the prior thread context, the evaluator verifies that the agent <strong className="text-zinc-900 font-semibold">addresses open questions cleanly</strong> without asking the client to repeat information already shared earlier in the conversation.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── FILTER TABS & SEARCH BAR ─────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        {/* Skill Group Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
          <button
            onClick={() => setSelectedGroup('all')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${selectedGroup === 'all'
                ? 'bg-zinc-900 text-white shadow-sm'
                : 'bg-white text-zinc-600 hover:bg-zinc-100 border border-zinc-200'
              }`}
          >
            All Parameters ({currentParamsList.length})
          </button>

          <button
            onClick={() => setSelectedGroup('Process Skills')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${selectedGroup === 'Process Skills'
                ? 'bg-zinc-900 text-white shadow-sm'
                : 'bg-white text-zinc-600 hover:bg-zinc-100 border border-zinc-200'
              }`}
          >
            Process Skills ({selectedChannel === 'emails' ? '65%' : '50%'})
          </button>

          <button
            onClick={() => setSelectedGroup('Communication Skills')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${selectedGroup === 'Communication Skills'
                ? 'bg-zinc-900 text-white shadow-sm'
                : 'bg-white text-zinc-600 hover:bg-zinc-100 border border-zinc-200'
              }`}
          >
            Communication ({selectedChannel === 'emails' ? '15%' : '30%'})
          </button>

          <button
            onClick={() => setSelectedGroup('Customer Service Skills')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${selectedGroup === 'Customer Service Skills'
                ? 'bg-zinc-900 text-white shadow-sm'
                : 'bg-white text-zinc-600 hover:bg-zinc-100 border border-zinc-200'
              }`}
          >
            Customer Service (20%)
          </button>

          {/* Compliance Pill */}
          <button
            onClick={() => setSelectedGroup('compliance')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer flex items-center gap-1.5 ${selectedGroup === 'compliance'
                ? 'bg-red-600 text-white shadow-sm'
                : 'bg-red-50 text-red-700 hover:bg-red-100 border border-red-200'
              }`}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            Compliance ({selectedChannel === 'chats' ? '5' : selectedChannel === 'emails' ? '3' : '1'})
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

      {/* ── CHAT COMPLIANCE CARDS (SHOWN WHEN CHAT + COMPLIANCE FILTER ACTIVE) ── */}
      {selectedChannel === 'chats' && selectedGroup === 'compliance' && (
        <div className="space-y-4">
          <div className="bg-red-50/70 border border-red-200 rounded-xl p-4">
            <h2 className="text-xs font-bold text-red-900 uppercase tracking-wider mb-1 flex items-center gap-1.5">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              5 Mandatory WhatsApp Compliance Gate Rules
            </h2>
            <p className="text-xs text-red-800 leading-relaxed">
              In addition to the 11 quality parameters, all WhatsApp conversations are continuously audited against these 5 non-negotiable regulatory and data privacy checks. A breach triggers an immediate human QA review.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            {filteredChatCompliance.map((comp) => (
              <div key={comp.id} className="bg-white border border-red-200/90 rounded-xl p-4 shadow-2xs space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-md bg-red-100 text-red-800 font-bold text-xs flex items-center justify-center shrink-0">
                      C{comp.num}
                    </span>
                    <h3 className="text-sm font-semibold text-zinc-900">{comp.name}</h3>
                  </div>
                </div>

                <div className="p-2.5 bg-red-50/50 border border-red-100 rounded-lg">
                  <p className="text-xs font-semibold text-red-950">&ldquo;{comp.rule}&rdquo;</p>
                </div>

                <p className="text-xs text-zinc-600 leading-relaxed">{comp.description}</p>

                <div className="pt-2 border-t border-zinc-100">
                  <span className="text-[10px] font-bold uppercase text-zinc-500 tracking-wider">Example Violation:</span>
                  <p className="text-[11px] text-red-700 italic mt-0.5">{comp.triggerExample}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── EMAIL COMPLIANCE GATES (SHOWN WHEN EMAIL + COMPLIANCE FILTER ACTIVE) ── */}
      {selectedChannel === 'emails' && selectedGroup === 'compliance' && (
        <div className="space-y-4">
          <div className="bg-red-50/70 border border-red-200 rounded-xl p-4">
            <h2 className="text-xs font-bold text-red-900 uppercase tracking-wider mb-1 flex items-center gap-1.5">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              3 Mandatory Email Compliance Gate Rules
            </h2>
            <p className="text-xs text-red-800 leading-relaxed">
              In addition to the 7 email quality parameters, every evaluated outbound email reply is audited against these 3 gates with <strong>Pass</strong>, <strong>Breach</strong>, or <strong>NA</strong> (for cases where a gate does not apply). Only a <strong>Breach</strong> triggers a compliance failure.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            {filteredEmailCompliance.map((comp) => (
              <div key={comp.id} className="bg-white border border-red-200/90 rounded-xl p-4 shadow-2xs space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-md bg-red-100 text-red-800 font-bold text-xs flex items-center justify-center shrink-0">
                      G{comp.num}
                    </span>
                    <h3 className="text-sm font-semibold text-zinc-900">{comp.name}</h3>
                  </div>
                </div>

                <div className="p-2.5 bg-red-50/50 border border-red-100 rounded-lg">
                  <p className="text-xs font-semibold text-red-950">&ldquo;{comp.rule}&rdquo;</p>
                </div>

                <p className="text-xs text-zinc-600 leading-relaxed">{comp.description}</p>

                <div className="pt-2 border-t border-zinc-100">
                  <span className="text-[10px] font-bold uppercase text-zinc-500 tracking-wider">Example Violation:</span>
                  <p className="text-[11px] text-red-700 italic mt-0.5">{comp.triggerExample}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── PARAMETERS LIST ──────────────────────────────────────────────────── */}
      {filteredParams.length === 0 && !((selectedChannel === 'chats' || selectedChannel === 'emails') && selectedGroup === 'compliance') ? (
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
                className={`bg-white border rounded-xl overflow-hidden shadow-sm transition-all duration-150 ${param.isTripwire ? 'border-red-200 hover:border-red-300' : 'border-[#E4E4E7] hover:border-zinc-300'
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
                        {param.conditional && (
                          <span
                            title={`Only evaluated when this specific scenario occurs in the ${selectedChannel === 'emails' ? 'email' : selectedChannel === 'calls' ? 'call' : 'chat'}. Otherwise marked NA without penalizing IQS.`}
                            className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide bg-amber-100 text-amber-800 border border-amber-300 cursor-help flex items-center gap-1"
                          >
                            <span>Conditional</span>
                            <span className="text-[9px] text-amber-600 font-mono">ⓘ</span>
                          </span>
                        )}
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
                    {/* Conditional Parameter Callout */}
                    {param.conditional && param.conditionalInfo && (
                      <div className="bg-amber-50/70 border border-amber-200/90 rounded-xl p-4 space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 text-xs font-bold text-amber-900 uppercase tracking-wider">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-700">
                              <circle cx="12" cy="12" r="10" />
                              <line x1="12" y1="8" x2="12" y2="12" />
                              <line x1="12" y1="16" x2="12.01" y2="16" />
                            </svg>
                            Why is this Parameter Conditional?
                          </div>
                          <span className="px-2 py-0.5 rounded text-[10px] font-extrabold uppercase bg-amber-100 text-amber-800 border border-amber-300">
                            Evaluated only when scenario occurs
                          </span>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                          <div className="bg-white/95 border border-amber-200/80 rounded-lg p-3 shadow-2xs">
                            <div className="flex items-center gap-1.5 text-[11px] font-bold text-emerald-800 uppercase tracking-wide mb-1">
                              <span className="w-3.5 h-3.5 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-[9px] font-bold">✓</span>
                              When is it evaluated?
                            </div>
                            <p className="text-xs text-zinc-800 leading-relaxed font-medium">
                              {param.conditionalInfo.whenEvaluated}
                            </p>
                          </div>

                          <div className="bg-white/95 border border-amber-200/80 rounded-lg p-3 shadow-2xs">
                            <div className="flex items-center gap-1.5 text-[11px] font-bold text-zinc-700 uppercase tracking-wide mb-1">
                              <span className="w-3.5 h-3.5 rounded-full bg-zinc-100 text-zinc-600 flex items-center justify-center text-[9px] font-bold">—</span>
                              When is it marked NA (Excluded)?
                            </div>
                            <p className="text-xs text-zinc-600 leading-relaxed">
                              {param.conditionalInfo.whenNA}
                            </p>
                          </div>
                        </div>

                        <div className="pt-2 border-t border-amber-200/60 flex items-start gap-1.5 text-xs text-amber-950 leading-relaxed">
                          <span className="font-bold text-amber-900 shrink-0">Scoring Impact:</span>
                          <span>{param.conditionalInfo.reason}</span>
                        </div>
                      </div>
                    )}
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

                    {/* 2. Rating Standards: Yes / (Half) / No / NA */}
                    <div>
                      <h3 className="text-xs font-bold text-zinc-800 uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="10" />
                          <line x1="12" y1="16" x2="12" y2="12" />
                          <line x1="12" y1="8" x2="12.01" y2="8" />
                        </svg>
                        System Rating Standards &amp; Explanation Requirements
                      </h3>
                      <div className={`grid grid-cols-1 ${param.standards.half ? 'sm:grid-cols-2 md:grid-cols-4' : 'md:grid-cols-3'} gap-3`}>
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

                        {/* Half Standard if applicable */}
                        {param.standards.half && (
                          <div className="bg-white border border-amber-200/90 rounded-lg p-3.5 shadow-2xs">
                            <div className="flex items-center gap-1.5 text-xs font-bold text-amber-800 mb-1.5">
                              <span className="w-4 h-4 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center text-[10px]">½</span>
                              Partial (&quot;Half&quot;)
                            </div>
                            <p className="text-xs text-zinc-600 leading-relaxed">
                              {param.standards.half}
                            </p>
                          </div>
                        )}

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
