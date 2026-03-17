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

// Testing branch: minimum thinking budget to benchmark latency
// (Gemini 2.5 Pro requires thinking mode — 0 is rejected, 1 is the minimum)
const NO_THINKING = { thinkingConfig: { thinkingBudget: 128 } };

/** Non-streaming Gemini call with automatic key rotation on 429. */
export async function geminiGenerate(
  keys: string[],
  model: string,
  contents: any[],
  extra?: Record<string, any>
): Promise<string> {
  let lastError: any;
  for (const key of keys) {
    try {
      const ai = new GoogleGenAI({ apiKey: key });
      const response = await ai.models.generateContent({ model, contents, config: NO_THINKING, ...extra });
      return response.text || '';
    } catch (err: any) {
      if (isRateLimit(err)) { lastError = err; continue; }
      throw err;
    }
  }
  throw lastError;
}

/** Streaming Gemini call with automatic key rotation on 429 (rotation happens before streaming starts). */
export async function geminiStream(
  keys: string[],
  model: string,
  contents: any[],
  systemInstruction: string
) {
  let lastError: any;
  for (const key of keys) {
    try {
      const ai = new GoogleGenAI({ apiKey: key });
      return await ai.models.generateContentStream({
        model,
        contents,
        config: { systemInstruction, ...NO_THINKING },
      });
    } catch (err: any) {
      if (isRateLimit(err)) { lastError = err; continue; }
      throw err;
    }
  }
  throw lastError;
}
