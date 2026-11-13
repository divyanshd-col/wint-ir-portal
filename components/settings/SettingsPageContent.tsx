import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { redirect } from 'next/navigation';
import { readConfig } from '@/lib/config';
import SettingsClient from '@/components/SettingsClient';
import { DEFAULT_CHAT_PROCESS_PROMPT } from '@/lib/prompts';
import { IQS_SYSTEM_PROMPT, BOT_IQS_SYSTEM_PROMPT } from '@/lib/quality';
import { CALL_TRANSCRIPTION_PROMPT, ENERGY_TONE_PROMPT, CALL_DISPOSITION_PROMPT, CALL_DISPOSITION_CLASSIFY_PROMPT, CALL_CHUNK_PROMPT, CALL_IQS_SYSTEM_PROMPT } from '@/lib/call-quality';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_QUALITY_THRESHOLDS } from '@/lib/quality-thresholds';
import { resolveEmailParameters } from '@/lib/email/context-builder';
import { visiblePromptFields } from '@/lib/prompt-overrides';
import { PROMPT_DEFAULTS } from '@/lib/prompt-defaults';

/** The whole Settings screen, as a server component: used by the full page (/settings) and by the popup (@modal/(.)settings). */
export default async function SettingsPageContent({ inModal = false }: { inModal?: boolean }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  const user = session.user as any;
  const role = user?.role;
  const isSuperAdmin = Boolean(user?.isSuperAdmin);
  const isAdmin = role === 'admin' || !!user?.isAdmin || isSuperAdmin;
  const platformDomain = user?.platformDomain || 'cx';
  const isPcgAdmin = isAdmin && (platformDomain === 'pcg' || platformDomain === 'both');
  const hasPcgAccess = isSuperAdmin || isPcgAdmin;
  const activeDomain = user?.activeDomain || (platformDomain === 'pcg' ? 'pcg' : 'cx');

  const config = await readConfig();

  // Prompts are per workspace: send only the ones for the workspace this admin is in (and allowed to manage).
  const prompts = isAdmin
    ? Object.fromEntries(visiblePromptFields(activeDomain === 'pcg' ? 'pcg' : 'cx', user).map(f => [f, { value: config[f] || '', defaultValue: PROMPT_DEFAULTS[f] }]))
    : {};
  // Hardcoded prompts, shown read-only in Settings → Prompts. The chat stage prompts live in files read at runtime.
  const file = (name: string) => { try { return readFileSync(join(process.cwd(), name), 'utf8'); } catch { return '(file not found on this server)'; } };
  const readOnlyPrompts: Record<string, string> = !isAdmin || activeDomain === 'pcg' ? {} : {
    chat_iqs_bot: BOT_IQS_SYSTEM_PROMPT,
    chat_router: file('PROMPT_router.txt'), chat_analyze: file('PROMPT_analyze.txt'), chat_extract_repayment: file('PROMPT_extract_repayment.txt'),
    call_iqs_legacy: CALL_IQS_SYSTEM_PROMPT, call_transcription: CALL_TRANSCRIPTION_PROMPT, call_energy: ENERGY_TONE_PROMPT,
    call_disposition: CALL_DISPOSITION_PROMPT, call_disposition_classify: CALL_DISPOSITION_CLASSIFY_PROMPT, call_chunk: CALL_CHUNK_PROMPT,
  };
  // Strip actual key values — only pass presence flags to client
  const safeConfig = {
    llmProvider: config.llmProvider,
    geminiModel: config.geminiModel || 'gemini-3.5-flash',
    hasGeminiKey: !!config.geminiApiKey,
    hasGeminiKey2: !!config.geminiApiKey2,
    hasGeminiKey3: !!config.geminiApiKey3,
    hasGeminiKey4: !!config.geminiApiKey4,
    hasGeminiKey5: !!config.geminiApiKey5,
    activeGeminiKey: config.activeGeminiKey || 1,
    hasAnthropicKey: !!config.anthropicApiKey,
    hasIqsGeminiKey: !!config.iqsGeminiApiKey,
    hasIqsAnthropicKey: !!config.iqsAnthropicApiKey,
    knowledgeBaseUrls: config.knowledgeBaseUrls || [],
    knowledgeBaseDocNames: config.knowledgeBaseDocNames || {},
    systemPrompt: config.systemPrompt || '',
    iqsScoringPrompt: config.iqsScoringPrompt || '',
    defaultChatPrompt: DEFAULT_CHAT_PROCESS_PROMPT,
    defaultIqsScoringPrompt: IQS_SYSTEM_PROMPT,
    conversationHistoryEnabled: !!config.conversationHistoryEnabled,
    callAnalysisEnabled: !!config.callAnalysisEnabled,
    cxDashboardEnabled: !!config.cxDashboardEnabled,
    hasSlackToken: !!config.slackUserToken,
    qualityAlertSheetUrl: config.qualityAlertSheetUrl || '',
    hasPyannoteKey: !!config.pyannoteApiKey,
    ...(activeDomain !== 'pcg' && {
      qualityThresholds: { ...DEFAULT_QUALITY_THRESHOLDS, ...config.qualityThresholds },
      disputeOwner: (config.disputeOwner === 'tl' ? 'tl' : 'qa') as 'qa' | 'tl',
      emailParameters: resolveEmailParameters(config.emailRubric),
    }),
    prompts,
    readOnlyPrompts,
  };

  return (
    <SettingsClient
      config={safeConfig}
      isAdmin={isAdmin}
      isSuperAdmin={isSuperAdmin}
      hasPcgAccess={hasPcgAccess}
      platformDomain={platformDomain}
      activeDomain={activeDomain}
      inModal={inModal}
    />
  );
}
