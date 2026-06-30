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
    || msg.includes('quota') || msg.includes('unavailable') || msg.includes('high demand')
    || msg.includes('text content blocks must be non-empty');
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
// Raw-fetch implementation: responseMimeType=application/json, thinkingBudget=0 for flash,
// reverse-part iteration to skip thought entries, 5 retries with 10s gaps, model fallback.
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
  _systemInstruction?: string,
  timeoutMs = 120_000,
): Promise<string> {
  let lastError: any;

  for (const model of CALL_MODEL_CHAIN) {
    const isPro = model.includes('-pro');
    const body = JSON.stringify({
      contents,
      generationConfig: {
        temperature: 0,
        responseMimeType: 'application/json',
      },
    });

    let skipModel = false;
    for (let attempt = 1; attempt <= 5; attempt++) {
      if (attempt > 1) await new Promise(r => setTimeout(r, 10_000));

      for (const key of keys) {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
        try {
          const fetchPromise = fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body,
          });
          const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('callGeminiForCall timeout')), timeoutMs)
          );
          const res  = await Promise.race([fetchPromise, timeoutPromise]);
          const data = await res.json() as any;

          const errMsg = (data.error?.message) ?? '';
          const isCapacity   = res.status === 503 || res.status === 429
            || errMsg.includes('demand') || errMsg.includes('overload');
          const isDeprecated = errMsg.includes('no longer available')
            || errMsg.includes('deprecated')
            || errMsg.includes('Budget 0 is invalid')
            || res.status === 404;

          if (isDeprecated) { skipModel = true; break; }
          if (isCapacity)   { lastError = new Error(errMsg || `HTTP ${res.status}`); break; }
          if (!res.ok)      throw new Error(errMsg || `API error ${res.status}`);

          // Reverse-iterate parts to skip thought:true entries (Gemini 2.5 Pro)
          const parts: any[] = data.candidates?.[0]?.content?.parts ?? [];
          for (let i = parts.length - 1; i >= 0; i--) {
            if (!parts[i].thought && parts[i].text) return (parts[i].text as string).trim();
          }
          return '';
        } catch (err: any) {
          const msg = String(err?.message ?? '').toLowerCase();
          const isCapacity = msg.includes('demand') || msg.includes('503') || msg.includes('429');
          if (!isCapacity) throw err;
          lastError = err;
        }
      }
      if (skipModel) break;
    }

    if (model !== CALL_MODEL_CHAIN[CALL_MODEL_CHAIN.length - 1]) {
      console.warn(`[gemini-call] ${model} exhausted — trying next model`);
    }
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
