export interface ModelPricing {
  inputPer1M: number;  // USD per 1,000,000 input tokens
  outputPer1M: number; // USD per 1,000,000 output tokens
  provider: 'gemini' | 'anthropic' | 'pyannote' | 'openai' | 'other';
  displayName: string;
}

export const USD_TO_INR_RATE = 86.5; // Estimated conversion rate

export const MODEL_PRICING_MAP: Record<string, ModelPricing> = {
  // Gemini 3.5 Flash: $1.50 input / $9.00 output per 1M tokens
  'gemini-3.5-flash': {
    inputPer1M: 1.50,
    outputPer1M: 9.00,
    provider: 'gemini',
    displayName: 'Gemini 3.5 Flash',
  },
  'gemini-2.5-flash': {
    inputPer1M: 1.50,
    outputPer1M: 9.00,
    provider: 'gemini',
    displayName: 'Gemini 2.5 Flash',
  },
  'gemini/gemini-2.5-flash': {
    inputPer1M: 1.50,
    outputPer1M: 9.00,
    provider: 'gemini',
    displayName: 'Gemini 2.5 Flash',
  },
  'gemini-3-flash-preview': {
    inputPer1M: 1.50,
    outputPer1M: 9.00,
    provider: 'gemini',
    displayName: 'Gemini 3 Flash Preview',
  },

  // Pyannote Precision-2 (Starter Plan: €0.096/hr ≈ $0.104/hr = ~$0.96 per 1M audio tokens)
  'pyannote-precision-2': {
    inputPer1M: 0.96,
    outputPer1M: 0,
    provider: 'pyannote',
    displayName: 'Pyannote Precision-2',
  },
  'pyannote': {
    inputPer1M: 0.96,
    outputPer1M: 0,
    provider: 'pyannote',
    displayName: 'Pyannote Diarization',
  },

  // Gemini 3.5 Pro (3.x tier): $2.00 input / $12.00 output per 1M tokens
  'gemini-3.5-pro': {
    inputPer1M: 2.00,
    outputPer1M: 12.00,
    provider: 'gemini',
    displayName: 'Gemini 3.5 Pro',
  },

  // Gemini 2.0 Flash: $0.10 input / $0.40 output per 1M tokens
  'gemini-2.0-flash': {
    inputPer1M: 0.10,
    outputPer1M: 0.40,
    provider: 'gemini',
    displayName: 'Gemini 2.0 Flash',
  },
  'gemini-1.5-flash': {
    inputPer1M: 0.10,
    outputPer1M: 0.40,
    provider: 'gemini',
    displayName: 'Gemini 1.5 Flash',
  },

  // Gemini 1.5 Pro: $1.25 input / $5.00 output per 1M tokens
  'gemini-1.5-pro': {
    inputPer1M: 1.25,
    outputPer1M: 5.00,
    provider: 'gemini',
    displayName: 'Gemini 1.5 Pro',
  },

  // Anthropic Claude
  'claude-sonnet-4-6': {
    inputPer1M: 3.00,
    outputPer1M: 15.00,
    provider: 'anthropic',
    displayName: 'Claude Sonnet 4.6',
  },
  'claude-3-5-sonnet-20241022': {
    inputPer1M: 3.00,
    outputPer1M: 15.00,
    provider: 'anthropic',
    displayName: 'Claude 3.5 Sonnet',
  },
  'claude-3-5-sonnet': {
    inputPer1M: 3.00,
    outputPer1M: 15.00,
    provider: 'anthropic',
    displayName: 'Claude 3.5 Sonnet',
  },
  'claude-3-5-haiku-20241022': {
    inputPer1M: 0.80,
    outputPer1M: 4.00,
    provider: 'anthropic',
    displayName: 'Claude 3.5 Haiku',
  },
  'claude-3-haiku-20240307': {
    inputPer1M: 0.25,
    outputPer1M: 1.25,
    provider: 'anthropic',
    displayName: 'Claude 3 Haiku',
  },
};

const DEFAULT_FALLBACK_PRICING: ModelPricing = {
  inputPer1M: 0.15,
  outputPer1M: 0.60,
  provider: 'gemini',
  displayName: 'Unknown Model',
};

export function getModelPricing(modelName: string): ModelPricing {
  const clean = modelName.trim().toLowerCase();
  if (MODEL_PRICING_MAP[clean]) {
    return MODEL_PRICING_MAP[clean];
  }

  // Prefix matching
  for (const [key, pricing] of Object.entries(MODEL_PRICING_MAP)) {
    if (clean.startsWith(key) || clean.includes(key)) {
      return pricing;
    }
  }

  if (clean.includes('claude') || clean.includes('anthropic')) {
    return {
      inputPer1M: 3.00,
      outputPer1M: 15.00,
      provider: 'anthropic',
      displayName: modelName,
    };
  }

  if (clean.includes('pyannote')) {
    return {
      inputPer1M: 0.96,
      outputPer1M: 0,
      provider: 'pyannote',
      displayName: 'Pyannote Precision-2',
    };
  }

  if (clean.includes('3.5-pro') || clean.includes('3-pro')) {
    return {
      inputPer1M: 2.00,
      outputPer1M: 12.00,
      provider: 'gemini',
      displayName: modelName,
    };
  }

  if (clean.includes('3.5-flash') || clean.includes('3-flash')) {
    return {
      inputPer1M: 1.50,
      outputPer1M: 9.00,
      provider: 'gemini',
      displayName: modelName,
    };
  }

  if (clean.includes('pro')) {
    return {
      inputPer1M: 1.25,
      outputPer1M: 5.00,
      provider: 'gemini',
      displayName: modelName,
    };
  }

  return {
    ...DEFAULT_FALLBACK_PRICING,
    displayName: modelName,
  };
}

export function calculateCost(modelName: string, inputTokens: number, outputTokens: number): number {
  const pricing = getModelPricing(modelName);
  const inputCost = (inputTokens / 1_000_000) * pricing.inputPer1M;
  const outputCost = (outputTokens / 1_000_000) * pricing.outputPer1M;
  return Number((inputCost + outputCost).toFixed(6));
}

export function formatTokenCount(num: number): string {
  if (!num || isNaN(num)) return '0';
  if (num >= 1_000_000_000) return `${(num / 1_000_000_000).toFixed(2)}B`;
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}k`;
  return num.toLocaleString();
}

export function formatUsd(amount: number): string {
  if (!amount || isNaN(amount)) return '$0.00';
  if (amount < 0.01) return `$${amount.toFixed(4)}`;
  return `$${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatInr(amountUsd: number): string {
  const inr = (amountUsd || 0) * USD_TO_INR_RATE;
  if (!inr || isNaN(inr)) return '₹0.00';
  if (inr < 0.1) return `₹${inr.toFixed(2)}`;
  return `₹${inr.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
