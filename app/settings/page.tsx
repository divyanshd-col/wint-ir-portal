import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { redirect } from 'next/navigation';
import { readConfig } from '@/lib/config';
import SettingsClient from '@/components/SettingsClient';
import { DEFAULT_CHAT_PROCESS_PROMPT } from '@/lib/prompts';
import { IQS_SYSTEM_PROMPT } from '@/lib/quality';
import { DEFAULT_QUALITY_THRESHOLDS } from '@/lib/quality-thresholds';
import { resolveEmailParameters, DEFAULT_EMAIL_PROMPT_INTRO, DEFAULT_EMAIL_PROMPT_COMPLIANCE } from '@/lib/email/context-builder';
import { CALL_GATES_SYSTEM_PROMPT, CALL_IQS_PASS_SYSTEM_PROMPT } from '@/lib/scoring/prompts/call';
import { PCG_QUALITY_SYSTEM_PROMPT, PCG_CLASSIFICATION_SYSTEM_PROMPT } from '@/lib/scoring/prompts/pcg';
import { visiblePromptFields, type PromptField } from '@/lib/prompt-overrides';

export default async function SettingsPage() {
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
  const PROMPT_DEFAULTS: Record<PromptField, string> = {
    callGatesPrompt: CALL_GATES_SYSTEM_PROMPT,
    callIqsPrompt: CALL_IQS_PASS_SYSTEM_PROMPT,
    emailPromptIntro: DEFAULT_EMAIL_PROMPT_INTRO,
    emailPromptCompliance: DEFAULT_EMAIL_PROMPT_COMPLIANCE,
    pcgQualityPrompt: PCG_QUALITY_SYSTEM_PROMPT,
    pcgClassificationPrompt: PCG_CLASSIFICATION_SYSTEM_PROMPT,
  };
  const prompts = isAdmin
    ? Object.fromEntries(visiblePromptFields(activeDomain === 'pcg' ? 'pcg' : 'cx', user).map(f => [f, { value: config[f] || '', defaultValue: PROMPT_DEFAULTS[f] }]))
    : {};
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
      emailParameters: resolveEmailParameters(config.emailRubric),
    }),
    prompts,
  };

  return (
    <SettingsClient
      config={safeConfig}
      isAdmin={isAdmin}
      isSuperAdmin={isSuperAdmin}
      hasPcgAccess={hasPcgAccess}
      platformDomain={platformDomain}
      activeDomain={activeDomain}
    />
  );
}
