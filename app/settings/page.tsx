import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { redirect } from 'next/navigation';
import { readConfig } from '@/lib/config';
import SettingsClient from '@/components/SettingsClient';
import { DEFAULT_CHAT_PROCESS_PROMPT } from '@/lib/prompts';
import { IQS_SYSTEM_PROMPT } from '@/lib/quality';
import { PLANNER_PROMPT, SYNTHESIZER_PROMPT } from '@/lib/analytics/agent';

export default async function SettingsPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  const user = session.user as any;
  const role = user?.role;
  const isAdmin = role === 'admin' || !!user?.isAdmin;
  const isSuperAdmin = Boolean(user?.isSuperAdmin);
  const platformDomain = user?.platformDomain || 'cx';
  const isPcgAdmin = isAdmin && (platformDomain === 'pcg' || platformDomain === 'both');
  const hasPcgAccess = isSuperAdmin || isPcgAdmin;
  const activeDomain = user?.activeDomain || (platformDomain === 'pcg' ? 'pcg' : 'cx');

  const config = await readConfig();
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
    analyticsPlannerPrompt: config.analyticsPlannerPrompt || '',
    analyticsSynthesizerPrompt: config.analyticsSynthesizerPrompt || '',
    defaultChatPrompt: DEFAULT_CHAT_PROCESS_PROMPT,
    defaultIqsScoringPrompt: IQS_SYSTEM_PROMPT,
    defaultAnalyticsPlannerPrompt: PLANNER_PROMPT,
    defaultAnalyticsSynthesizerPrompt: SYNTHESIZER_PROMPT,
    conversationHistoryEnabled: !!config.conversationHistoryEnabled,
    callAnalysisEnabled: !!config.callAnalysisEnabled,
    cxDashboardEnabled: !!config.cxDashboardEnabled,
    hasSlackToken: !!config.slackUserToken,
    qualityAlertSheetUrl: config.qualityAlertSheetUrl || '',
    hasPyannoteKey: !!config.pyannoteApiKey,
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
