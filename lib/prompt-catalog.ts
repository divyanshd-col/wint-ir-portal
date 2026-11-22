/**
 * Every AI prompt in the portal, grouped by channel and agent, for Settings → Prompts.
 * Pure and client-safe: texts for hardcoded prompts are attached by the server page (SettingsPageContent).
 * `field` set = editable in Settings (saved override, built-in default as fallback). No `field` = hardcoded in code, shown read-only.
 */
export type Channel = 'chat' | 'call' | 'email' | 'pcg';
export type Role = 'iqs' | 'compliance' | 'assistant' | 'support';

export interface CatalogEntry {
  id: string;
  channel: Channel;
  role: Role;
  title: string;
  description: string;
  /** Where it lives in code, so a developer can find a hardcoded one. */
  source: string;
  field?: string;
  /** 'chatbot' = part of the live support chatbot (own Settings page), not quality scoring. */
  area?: 'chatbot';
  /** No separate prompt exists for this agent; says where its rules live instead. */
  missing?: string;
  note?: string;
}

export const CHANNELS: { id: Channel; label: string; workspace: 'cx' | 'pcg' }[] = [
  { id: 'chat', label: 'Chat', workspace: 'cx' },
  { id: 'call', label: 'Call', workspace: 'cx' },
  { id: 'email', label: 'Email', workspace: 'cx' },
  { id: 'pcg', label: 'PCG', workspace: 'pcg' },
];

export const ROLES: { id: Role; label: string }[] = [
  { id: 'iqs', label: 'IQS agent' },
  { id: 'compliance', label: 'Compliance agent' },
  { id: 'assistant', label: 'Assistant' },
  { id: 'support', label: 'Supporting prompts' },
];

export const CATALOG: CatalogEntry[] = [
  // ── Chat ──
  { id: 'chat_iqs', channel: 'chat', role: 'iqs', field: 'iqsScoringPrompt', title: 'Chat IQS: human agents', source: 'IQS_SYSTEM_PROMPT in lib/quality.ts',
    description: 'Scores a human agent\'s chat on 11 parameters and gives the reasoning shown to QA.' },
  { id: 'chat_iqs_bot', channel: 'chat', role: 'iqs', title: 'Chat IQS: bot chats', source: 'BOT_IQS_SYSTEM_PROMPT in lib/quality.ts',
    description: 'Scores the support bot\'s conversations. Includes the bot\'s compliance flag. Hardcoded: changes need a code deploy.' },
  { id: 'chat_compliance', channel: 'chat', role: 'compliance', title: 'Chat compliance', source: 'none',
    description: 'Advice, guaranteed returns, data handling and misleading-error checks on chats.',
    missing: 'There is no separate chat compliance prompt. For bot chats the compliance flag is written inside "Chat IQS: bot chats" (read-only). Human-agent chats have no compliance check yet.' },
  { id: 'chat_assistant', channel: 'chat', area: 'chatbot', role: 'assistant', field: 'systemPrompt', title: 'Chat assistant', source: 'DEFAULT_CHAT_PROCESS_PROMPT in lib/prompts.ts',
    description: 'Shapes how the AI briefs the support agent during a live chat. Injected at the start of every conversation.',
    note: 'The assistant replies in free text, so there is no fixed output format to lock here.' },
  { id: 'chat_router', channel: 'chat', area: 'chatbot', role: 'support', title: 'Router (intent classifier)', source: 'PROMPT_router.txt', description: 'Classifies the first message into a product category and query type.' },
  { id: 'chat_analyze', channel: 'chat', area: 'chatbot', role: 'support', title: 'Triage and questions', source: 'PROMPT_analyze.txt', description: 'Stage 1B: triages the case and decides what to ask next.' },
  { id: 'chat_extract_repayment', channel: 'chat', area: 'chatbot', role: 'support', title: 'Repayment extractor', source: 'PROMPT_extract_repayment.txt', description: 'Stage 1A micro-prompt that pulls repayment facts from the chat.' },

  // ── Call ──
  { id: 'call_iqs', channel: 'call', role: 'iqs', field: 'callIqsPrompt', title: 'Call IQS scoring', source: 'CALL_IQS_PASS_SYSTEM_PROMPT in lib/scoring/prompts/call.ts',
    description: 'Second pass when scoring a call: scores the quality parameters and gives the reasoning shown to QA.',
    note: 'The weights behind the final IQS are set in code, so percentages written in this text do not change the score arithmetic.' },
  { id: 'call_compliance', channel: 'call', role: 'compliance', field: 'callGatesPrompt', title: 'Call compliance gates', source: 'CALL_GATES_SYSTEM_PROMPT in lib/scoring/prompts/call.ts',
    description: 'First pass when scoring a call: decides whether it breaches a compliance gate (investment or tax advice, fabricated facts, identity verification).' },
  { id: 'call_iqs_legacy', channel: 'call', role: 'iqs', title: 'Call IQS: manual scoring', source: 'CALL_IQS_SYSTEM_PROMPT in lib/call-quality.ts', description: 'Older single-pass call scorer still used by manual scoring and link tests.' },
  { id: 'call_transcription', channel: 'call', role: 'support', title: 'Call transcription', source: 'CALL_TRANSCRIPTION_PROMPT in lib/call-quality.ts', description: 'Turns call audio into a speaker-labelled transcript.' },
  { id: 'call_energy', channel: 'call', role: 'support', title: 'Energy and tone', source: 'ENERGY_TONE_PROMPT in lib/call-quality.ts', description: 'Rates the IR executive\'s energy and tone from the audio.' },
  { id: 'call_disposition', channel: 'call', role: 'support', title: 'Disposition extractor', source: 'CALL_DISPOSITION_PROMPT in lib/call-quality.ts', description: 'Extracts the primary topic of the call.' },
  { id: 'call_disposition_classify', channel: 'call', role: 'support', title: 'Taxonomy classifier', source: 'CALL_DISPOSITION_CLASSIFY_PROMPT in lib/call-quality.ts', description: 'Classifies the call into the official disposition taxonomy.' },
  { id: 'call_chunk', channel: 'call', role: 'support', title: 'Chunk splitter', source: 'CALL_CHUNK_PROMPT in lib/call-quality.ts', description: 'Breaks a transcript into topic chunks for knowledge-base analysis.' },

  // ── Email ──
  { id: 'email_iqs', channel: 'email', role: 'iqs', field: 'emailPromptIntro', title: 'Email IQS: role and tasks', source: 'DEFAULT_EMAIL_PROMPT_INTRO in lib/email/context-builder.ts',
    description: "What the AI evaluator is told when it scores an agent's email reply. The seven parameters are edited under Scoring Rubric.",
    note: 'The email itself and the JSON output format are fixed in code, so an edit here cannot break scoring.' },
  { id: 'email_compliance', channel: 'email', role: 'compliance', field: 'emailPromptCompliance', title: 'Email compliance rules', source: 'DEFAULT_EMAIL_PROMPT_COMPLIANCE in lib/email/context-builder.ts',
    description: 'The tripwires that fail an email on compliance (guaranteed returns, another client\'s data, wrong timelines, rude language).',
    note: 'The output format is fixed in code, so an edit here cannot break scoring.' },

  // ── PCG ──
  { id: 'pcg_quality', channel: 'pcg', role: 'iqs', field: 'pcgQualityPrompt', title: 'PCG quality', source: 'PCG_QUALITY_SYSTEM_PROMPT in lib/scoring/prompts/pcg.ts',
    description: 'System prompt for scoring Private Client Group relationship-manager calls: the quality and compliance audit.' },
  { id: 'pcg_compliance', channel: 'pcg', role: 'compliance', title: 'PCG compliance', source: 'none',
    description: 'Compliance tripwires on RM calls.',
    missing: 'There is no separate PCG compliance prompt. The tripwires are written inside "PCG quality" (see compliance_tripwire in its output).' },
  { id: 'pcg_classification', channel: 'pcg', role: 'support', field: 'pcgClassificationPrompt', title: 'PCG classification', source: 'PCG_CLASSIFICATION_SYSTEM_PROMPT in lib/scoring/prompts/pcg.ts',
    description: 'Classifies a call\'s purpose and nature, and excludes non-investor conversations.' },
];
