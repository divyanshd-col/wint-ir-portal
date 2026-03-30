import { storeGetConfig, storeSetConfig } from './store';

export type UserRole = 'agent' | 'admin' | 'quality' | 'tl';

export interface PortalUser {
  username: string;   // kept for legacy credentials users; email for Google users
  password?: string;  // optional — Google OAuth users have no password
  isAdmin?: boolean;  // legacy — derived from role === 'admin'
  role?: UserRole;    // new role field
  email?: string;     // Google email (primary identifier for OAuth users)
}

export interface PortalConfig {
  geminiApiKey: string;
  geminiApiKey2?: string;
  geminiApiKey3?: string;
  geminiApiKey4?: string;
  geminiApiKey5?: string;
  activeGeminiKey?: 1 | 2 | 3 | 4 | 5;
  anthropicApiKey: string;
  llmProvider: 'gemini' | 'claude';
  geminiModel?: string;
  knowledgeBaseUrls: string[];
  users: PortalUser[];
  systemPrompt?: string;
  conversationHistoryEnabled?: boolean;
  slackUserToken?: string;
  isConfigured: boolean;
}

const DEFAULT_CONFIG: PortalConfig = {
  geminiApiKey: '',
  geminiApiKey2: '',
  geminiApiKey3: '',
  geminiApiKey4: '',
  geminiApiKey5: '',
  activeGeminiKey: 1,
  anthropicApiKey: '',
  llmProvider: 'gemini',
  geminiModel: 'gemini-2.5-flash',
  knowledgeBaseUrls: [],
  users: [],
  systemPrompt: '',
  conversationHistoryEnabled: false,
  isConfigured: false,
};

export async function readConfig(): Promise<PortalConfig> {
  // 1. KV store — persists admin changes on Vercel
  const fromKV = await storeGetConfig();
  if (fromKV?.isConfigured) return fromKV;

  // 2. Env vars — initial Vercel setup
  const fromEnv = readFromEnv();
  if (fromEnv.isConfigured) return fromEnv;

  // 3. File — local development
  try {
    const fs = require('fs');
    const path = require('path');
    const CONFIG_PATH = path.join(process.cwd(), 'portal-config.json');
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed.isConfigured) return { ...DEFAULT_CONFIG, ...parsed };
    }
  } catch {}

  return DEFAULT_CONFIG;
}

function readFromEnv(): PortalConfig {
  const geminiApiKey = process.env.GEMINI_API_KEY || '';
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY || '';
  const llmProvider = (process.env.LLM_PROVIDER as 'gemini' | 'claude') || 'gemini';
  const urlsRaw = process.env.KNOWLEDGE_BASE_URLS || '';
  const usersRaw = process.env.IR_USERS_JSON || '';

  if ((!geminiApiKey && !anthropicApiKey) || !usersRaw) return DEFAULT_CONFIG;

  try {
    const users = JSON.parse(usersRaw);
    const knowledgeBaseUrls = urlsRaw ? urlsRaw.split('|||').filter(Boolean) : [];
    return { geminiApiKey, anthropicApiKey, llmProvider, knowledgeBaseUrls, users, isConfigured: true };
  } catch {
    return DEFAULT_CONFIG;
  }
}

export async function writeConfig(config: PortalConfig): Promise<void> {
  // Write to KV (Vercel) and file (local) in parallel
  await Promise.allSettled([
    storeSetConfig(config),
    writeToFile(config),
  ]);
}

async function writeToFile(config: PortalConfig): Promise<void> {
  try {
    const fs = require('fs');
    const path = require('path');
    const CONFIG_PATH = path.join(process.cwd(), 'portal-config.json');
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
  } catch {}
}
