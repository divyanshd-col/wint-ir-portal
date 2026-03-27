import { GoogleGenAI } from '@google/genai';

/** Returns all configured Gemini keys, starting with the active one. */
export function getOrderedGeminiKeys(config: any): string[] {
  const keyMap: Record<number, string | undefined> = {
    1: config.geminiApiKey,
    2: config.geminiApiKey2,
    3: config.geminiApiKey3,
    4: config.geminiApiKey4,
    5: config.geminiApiKey5,
  };
  const active = config.activeGeminiKey || 1;
  const order = [active, 1, 2, 3, 4, 5].filter((v, i, a) => a.indexOf(v) === i);
  return order.map(k => keyMap[k]).filter(Boolean) as string[];
}

function isRateLimit(err: any): boolean {
  return err?.status === 429 || String(err?.message).includes('429') || String(err?.message).toLowerCase().includes('quota');
}

const FALLBACK_MODEL: Record<string, string> = {
  'gemini-3-flash-preview': 'gemini-2.5-pro',
  'gemini-2.5-pro': 'gemini-2.5-flash',
};

/** Non-streaming Gemini call with automatic key rotation on 429, then model fallback. */
export async function geminiGenerate(
  keys: string[],
  model: string,
  contents: any[],
  extra?: Record<string, any>,
  timeoutMs = 8000
): Promise<string> {
  const modelsToTry = [model, ...(FALLBACK_MODEL[model] ? [FALLBACK_MODEL[model]] : [])];
  let lastError: any;

  for (const currentModel of modelsToTry) {
    for (const key of keys) {
      try {
        const ai = new GoogleGenAI({ apiKey: key });
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('geminiGenerate timeout')), timeoutMs)
        );
        const response = await Promise.race([
          ai.models.generateContent({ model: currentModel, contents, ...extra }),
          timeoutPromise,
        ]);
        if (currentModel !== model) console.warn(`[gemini] Pro quota exhausted — using ${currentModel} fallback`);
        return response.text || '';
      } catch (err: any) {
        if (isRateLimit(err)) { lastError = err; continue; }
        throw err;
      }
    }
  }
  throw lastError;
}

/** Streaming Gemini call with automatic key rotation on 429, then model fallback. */
export async function geminiStream(
  keys: string[],
  model: string,
  contents: any[],
  systemInstruction: string
) {
  const modelsToTry = [model, ...(FALLBACK_MODEL[model] ? [FALLBACK_MODEL[model]] : [])];
  let lastError: any;

  for (const currentModel of modelsToTry) {
    // Cap thinking for Pro to reduce latency at scale. Flash has no thinking by default.
    const thinkingConfig = currentModel.includes('pro')
      ? { thinkingConfig: { thinkingBudget: 2048 } }
      : {};
    for (const key of keys) {
      try {
        const ai = new GoogleGenAI({ apiKey: key });
        if (currentModel !== model) console.warn(`[gemini] Pro quota exhausted — using ${currentModel} fallback`);
        return await ai.models.generateContentStream({
          model: currentModel,
          contents,
          config: { systemInstruction, ...thinkingConfig },
        });
      } catch (err: any) {
        if (isRateLimit(err)) { lastError = err; continue; }
        throw err;
      }
    }
  }
  throw lastError;
}
