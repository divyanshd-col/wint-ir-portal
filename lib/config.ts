import { storeGetConfig, storeSetConfig } from './store';

export type UserRole = 'agent' | 'admin' | 'quality' | 'tl';

export interface PortalUser {
  username: string;   // kept for legacy credentials users; email for Google users
  password?: string;  // optional — Google OAuth users have no password
  isAdmin?: boolean;  // legacy — derived from role === 'admin'
  role?: UserRole;    // new role field
  email?: string;     // Google email (primary identifier for OAuth users)
  agentName?: string;
  assignedDispositions?: string[]; // QA only — soft default filter; empty/absent = no default
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
  // ── Feature flags (absent/false = hidden) ──────────────────────────────────
  callAnalysisEnabled?: boolean;
  cxDashboardEnabled?: boolean;
  slackUserToken?: string;
  qualityAlertSheetUrl?: string; // Apps Script web app URL for quality alert sheet
  isConfigured: boolean;
  // ── Dedicated IQS / quality-scoring keys (for spend tracking) ──────────────
  iqsGeminiApiKey?: string;    // dedicated Gemini key for all IQS scoring
  iqsAnthropicApiKey?: string; // dedicated Anthropic key for IQS scoring (if provider = claude)
  // ── Editable prompts (empty = use hardcoded default) ────────────────────────
  iqsScoringPrompt?: string;
  analyticsPlannerPrompt?: string;
  analyticsSynthesizerPrompt?: string;
  pcgTeamAssignments?: Record<string, string>;
  // ── QA disposition mapping ───────────────────────────────────────────────
  qaDispositionMap?: QADispositionEntry[];
  // ── KB document display names (Drive ID → human-readable name) ──────────────
  knowledgeBaseDocNames?: Record<string, string>;
  pyannoteApiKey?: string;
}

export interface QADispositionEntry {
  email: string;
  dispositions: string[];
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
  geminiModel: 'gemini-3.5-flash',
  knowledgeBaseUrls: [],
  users: [],
  systemPrompt: '',
  conversationHistoryEnabled: false,
  isConfigured: false,
  pyannoteApiKey: '',
};

// Short-lived per-instance cache. readConfig() is called from ~86 places and each
// call used to be an uncached Upstash HTTP round trip. 5s keeps admin changes
// near-instant (writeConfig also invalidates this instance) while collapsing
// bursts of parallel requests into one fetch. Callers get a clone so mutating
// the result before writeConfig() can't corrupt the cache.
const CONFIG_CACHE_TTL_MS = 5000;
let configCache: { value: PortalConfig; at: number } | null = null;
let configInflight: Promise<PortalConfig> | null = null;

export async function readConfig(): Promise<PortalConfig> {
  if (configCache && Date.now() - configCache.at < CONFIG_CACHE_TTL_MS) {
    return structuredClone(configCache.value);
  }
  if (!configInflight) {
    configInflight = loadConfig()
      .then(value => { configCache = { value, at: Date.now() }; return value; })
      .finally(() => { configInflight = null; });
  }
  return structuredClone(await configInflight);
}

async function loadConfig(): Promise<PortalConfig> {
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
  } catch (err: any) {
    console.error('[config] Failed to read portal-config.json:', err?.message ?? String(err));
  }

  return DEFAULT_CONFIG;
}

function readFromEnv(): PortalConfig {
  const geminiApiKey    = process.env.GEMINI_API_KEY     || '';
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY  || '';
  const llmProvider     = (process.env.LLM_PROVIDER as 'gemini' | 'claude') || 'gemini';
  const urlsRaw         = process.env.KNOWLEDGE_BASE_URLS || '';
  const usersRaw        = process.env.IR_USERS_JSON       || '';
  const iqsGeminiApiKey    = process.env.IQS_GEMINI_API_KEY    || '';
  const iqsAnthropicApiKey = process.env.IQS_ANTHROPIC_API_KEY || '';
  const pyannoteApiKey  = process.env.PYANNOTE_API_KEY || process.env.PYANNOTEAI_API_KEY || '';

  if ((!geminiApiKey && !anthropicApiKey) || !usersRaw) return DEFAULT_CONFIG;

  try {
    const users = JSON.parse(usersRaw);
    const knowledgeBaseUrls = urlsRaw ? urlsRaw.split('|||').filter(Boolean) : [];
    return {
      geminiApiKey, anthropicApiKey, llmProvider, knowledgeBaseUrls, users, isConfigured: true,
      ...(iqsGeminiApiKey    && { iqsGeminiApiKey }),
      ...(iqsAnthropicApiKey && { iqsAnthropicApiKey }),
      pyannoteApiKey,
    };
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
  configCache = null; // next read on this instance sees the new value
}

async function writeToFile(config: PortalConfig): Promise<void> {
  try {
    const fs = require('fs');
    const path = require('path');
    const CONFIG_PATH = path.join(process.cwd(), 'portal-config.json');
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
  } catch {}
}
