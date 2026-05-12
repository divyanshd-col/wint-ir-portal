import { GoogleGenAI } from '@google/genai';

/**
 * Returns the dedicated IQS Gemini key if configured, otherwise falls back
 * to the ordered chat keys. Use this for all quality-scoring LLM calls so
 * spend can be tracked separately from chat.
 */
export function getIQSGeminiKeys(config: any): string[] {
  if (config.iqsGeminiApiKey) return [config.iqsGeminiApiKey];
  return getOrderedGeminiKeys(config);
}

/** Returns all configured Gemini keys in fixed order 1→2→3→4→5. */
export function getOrderedGeminiKeys(config: any): string[] {
  return [
    config.geminiApiKey,
    config.geminiApiKey2,
    config.geminiApiKey3,
    config.geminiApiKey4,
    config.geminiApiKey5,
  ].filter(Boolean) as string[];
}

function isRetryable(err: any): boolean {
  const msg = String(err?.message).toLowerCase();
  return err?.status === 429 || err?.status === 503
    || msg.includes('429') || msg.includes('503')
    || msg.includes('quota') || msg.includes('unavailable') || msg.includes('high demand');
}

// Fallback chain: follow links until no next entry or a cycle is detected.
// gemini-2.5-flash → gemini-3-flash-preview → gemini-3.1-flash-lite-preview → gemini-2.5-pro
const FALLBACK_MODEL: Record<string, string> = {
  'gemini-2.5-flash':              'gemini-3-flash-preview',
  'gemini-3-flash-preview':        'gemini-3.1-flash-lite-preview',
  'gemini-3.1-flash-lite-preview': 'gemini-2.5-pro',
};

function buildModelChain(model: string): string[] {
  const chain = [model];
  const seen = new Set([model]);
  let current = model;
  while (FALLBACK_MODEL[current]) {
    const next = FALLBACK_MODEL[current];
    if (seen.has(next)) break;
    chain.push(next);
    seen.add(next);
    current = next;
  }
  return chain;
}

/** Non-streaming Gemini call with automatic key rotation on 429/503, then model fallback chain. */
export async function geminiGenerate(
  keys: string[],
  model: string,
  contents: any[],
  extra?: Record<string, any>,
  timeoutMs = 8000
): Promise<string> {
  const modelsToTry = buildModelChain(model);
  let lastError: any;

  for (const currentModel of modelsToTry) {
    for (const key of keys) {
      try {
        const ai = new GoogleGenAI({ apiKey: key });
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('geminiGenerate timeout')), timeoutMs)
        );
        // systemInstruction must live inside config, not at the top level
        const { systemInstruction, config: extraConfig, ...rest } = (extra ?? {}) as any;
        const resolvedConfig = {
          ...(systemInstruction ? { systemInstruction } : {}),
          ...(extraConfig ?? {}),
        };
        const response = await Promise.race([
          ai.models.generateContent({
            model: currentModel,
            contents,
            ...(Object.keys(resolvedConfig).length ? { config: resolvedConfig } : {}),
            ...rest,
          }),
          timeoutPromise,
        ]);
        if (currentModel !== model) console.warn(`[gemini] ${model} unavailable — used ${currentModel} fallback`);
        return response.text || '';
      } catch (err: any) {
        if (isRetryable(err)) { lastError = err; continue; }
        throw err;
      }
    }
  }
  throw lastError;
}

// ── Call-quality specific Gemini caller ───────────────────────────────────────
// Dedicated model chain, temperature=0, thinkingBudget=0 for flash, 5 retries with 10s gaps.
const CALL_MODEL_CHAIN = [
  'gemini-2.5-flash-preview-05-20',
  'gemini-2.5-flash',
  'gemini-2.5-pro',
  'gemini-1.5-pro',
  'gemini-1.5-flash',
];

export async function callGeminiForCall(
  keys: string[],
  contents: any[],
  systemInstruction?: string,
  timeoutMs = 120_000,
): Promise<string> {
  let lastError: any;

  for (const model of CALL_MODEL_CHAIN) {
    const isFlash = model.includes('flash');
    const config: any = {
      temperature: 0,
      ...(isFlash ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
      ...(systemInstruction ? { systemInstruction } : {}),
    };

    for (let attempt = 0; attempt < 5; attempt++) {
      let triedAny = false;
      for (const key of keys) {
        try {
          const ai = new GoogleGenAI({ apiKey: key });
          const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('callGeminiForCall timeout')), timeoutMs)
          );
          const response = await Promise.race([
            ai.models.generateContent({ model, contents, config }),
            timeoutPromise,
          ]);
          if (model !== CALL_MODEL_CHAIN[0]) {
            console.warn(`[gemini-call] fallback to ${model} (primary unavailable)`);
          }
          return response.text || '';
        } catch (err: any) {
          if (isRetryable(err)) { lastError = err; triedAny = true; continue; }
          throw err;
        }
      }
      if (!triedAny) break;
      if (attempt < 4) await new Promise(r => setTimeout(r, 10_000));
    }
    console.warn(`[gemini-call] ${model} exhausted after 5 attempts — trying next model`);
  }

  throw lastError ?? new Error('All Gemini call-quality models failed');
}

/** Streaming Gemini call with automatic key rotation on 429/503, then model fallback chain. */
export async function geminiStream(
  keys: string[],
  model: string,
  contents: any[],
  systemInstruction: string
) {
  const modelsToTry = buildModelChain(model);
  let lastError: any;

  for (const currentModel of modelsToTry) {
    // Cap thinking for Pro to reduce latency at scale. Flash has no thinking by default.
    const thinkingConfig = currentModel.includes('pro')
      ? { thinkingConfig: { thinkingBudget: 2048 } }
      : {};
    for (const key of keys) {
      try {
        const ai = new GoogleGenAI({ apiKey: key });
        if (currentModel !== model) console.warn(`[gemini] ${model} unavailable — used ${currentModel} fallback`);
        return await ai.models.generateContentStream({
          model: currentModel,
          contents,
          config: { systemInstruction, ...thinkingConfig },
        });
      } catch (err: any) {
        if (isRetryable(err)) { lastError = err; continue; }
        throw err;
      }
    }
  }
  throw lastError;
}
