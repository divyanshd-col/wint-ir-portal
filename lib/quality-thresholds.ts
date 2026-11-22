/**
 * QA review thresholds, editable in Settings → Quality Thresholds.
 * A chat / call / email whose IQS is at or below its channel's threshold goes to QA review (the rule that used to be a
 * literal 85 in four SQL strings). Pure and client-safe: no config or DB access in here.
 */
export type ReviewChannel = 'chat' | 'call' | 'email';

export interface QualityThresholds {
  chatReview: number;
  callReview: number;
  emailReview: number;
}

export const DEFAULT_QUALITY_THRESHOLDS: QualityThresholds = { chatReview: 85, callReview: 85, emailReview: 85 };

const FIELD: Record<ReviewChannel, keyof QualityThresholds> = { chat: 'chatReview', call: 'callReview', email: 'emailReview' };

const isValid = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100;

/** Validates a saved-settings payload. All three values are required and must be numbers from 0 to 100. */
export function parseQualityThresholds(input: unknown): { ok: true; value: QualityThresholds } | { ok: false; error: string } {
  const o = (input ?? {}) as Record<string, unknown>;
  for (const key of Object.keys(DEFAULT_QUALITY_THRESHOLDS) as (keyof QualityThresholds)[]) {
    if (!isValid(o[key])) return { ok: false, error: `${key} must be a number from 0 to 100` };
  }
  return { ok: true, value: { chatReview: o.chatReview as number, callReview: o.callReview as number, emailReview: o.emailReview as number } };
}

/** The threshold for a channel, from any object that may carry `qualityThresholds` (the portal config). Falls back to 85.
 *  Always a finite number in 0–100, so it is safe to put straight into a SQL string. */
export function reviewThreshold(config: object | null | undefined, channel: ReviewChannel): number {
  const saved = (config as { qualityThresholds?: Partial<QualityThresholds> } | null | undefined)?.qualityThresholds;
  const v = saved?.[FIELD[channel]];
  return isValid(v) ? v : DEFAULT_QUALITY_THRESHOLDS[FIELD[channel]];
}
