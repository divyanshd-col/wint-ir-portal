import { DEFAULT_EMAIL_PROMPT_INTRO, DEFAULT_EMAIL_PROMPT_COMPLIANCE } from '@/lib/email/context-builder';
import { CALL_GATES_SYSTEM_PROMPT, CALL_IQS_PASS_SYSTEM_PROMPT } from '@/lib/scoring/prompts/call';
import { PCG_QUALITY_SYSTEM_PROMPT, PCG_CLASSIFICATION_SYSTEM_PROMPT } from '@/lib/scoring/prompts/pcg';
import { IQS_SYSTEM_PROMPT } from '@/lib/quality';
import type { PromptField } from '@/lib/prompt-overrides';

/** Built-in text for each admin-editable prompt field. */
export const PROMPT_DEFAULTS: Record<PromptField, string> = {
  callGatesPrompt: CALL_GATES_SYSTEM_PROMPT,
  callIqsPrompt: CALL_IQS_PASS_SYSTEM_PROMPT,
  emailPromptIntro: DEFAULT_EMAIL_PROMPT_INTRO,
  emailPromptCompliance: DEFAULT_EMAIL_PROMPT_COMPLIANCE,
  pcgQualityPrompt: PCG_QUALITY_SYSTEM_PROMPT,
  pcgClassificationPrompt: PCG_CLASSIFICATION_SYSTEM_PROMPT,
};

/** Every config field whose output-format block is locked, including the chat IQS prompt (saved outside PROMPT_FIELDS). */
export const LOCKED_OUTPUT_DEFAULTS: Record<string, string> = { ...PROMPT_DEFAULTS, iqsScoringPrompt: IQS_SYSTEM_PROMPT };
