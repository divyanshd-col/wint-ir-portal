import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { redirect } from 'next/navigation';
import { readConfig } from '@/lib/config';
import SettingsClient from '@/components/SettingsClient';

export default async function SettingsPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  const role = (session.user as any)?.role;
  if (role !== 'admin') redirect('/');

  const config = await readConfig();
  // Strip actual key values — only pass presence flags to client
  const safeConfig = {
    llmProvider: config.llmProvider,
    geminiModel: config.geminiModel || 'gemini-2.5-flash',
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
    systemPrompt: config.systemPrompt || '',
    conversationHistoryEnabled: !!config.conversationHistoryEnabled,
    hasSlackToken: !!config.slackUserToken,
  };

  return <SettingsClient config={safeConfig} />;
}
