import { query } from '@/lib/cx/db';

export type FeatureGroup = 'Chats' | 'Calls' | 'Analytics' | 'Reports' | 'Admin Tools';

export type JobType =
  | 'bot_leg_scoring'
  | 'human_leg_scoring'
  | 'compliance_gate_audit'
  | 'on_demand_chat_rescore'
  | 'corrections_apply'
  | 'call_diarization_pass1'
  | 'call_transcription_pass2'
  | 'call_gates_audit'
  | 'call_iqs_scoring'
  | 'call_disposition_classify'
  | 'on_demand_call_score'
  | 'bulk_call_retranscribe'
  | 'link_test_call_scoring'
  | 'kb_query_expansion'
  | 'analytics_routing_extraction'
  | 'analytics_insight_synthesizer'
  | 'chat_draft_generator'
  | 'cron_scorecard_gen';

export const JOB_DISPLAY_NAMES: Record<JobType, { label: string; group: FeatureGroup }> = {
  bot_leg_scoring:                 { label: 'Bot Chat Evaluation', group: 'Chats' },
  human_leg_scoring:               { label: 'Agent Chat Evaluation', group: 'Chats' },
  compliance_gate_audit:           { label: 'Chat Compliance Audit', group: 'Chats' },
  on_demand_chat_rescore:          { label: 'On-Demand Chat Re-evaluation', group: 'Chats' },
  corrections_apply:               { label: 'Chat Dispute Correction', group: 'Chats' },
  call_diarization_pass1:          { label: 'Call Speaker Diarization', group: 'Calls' },
  call_transcription_pass2:         { label: 'Call Audio Transcription', group: 'Calls' },
  call_gates_audit:                { label: 'Call Compliance Audit', group: 'Calls' },
  call_iqs_scoring:                { label: 'Call Quality Scoring', group: 'Calls' },
  call_disposition_classify:       { label: 'Call Disposition Classifier', group: 'Calls' },
  on_demand_call_score:            { label: 'On-Demand Call Evaluation', group: 'Calls' },
  bulk_call_retranscribe:          { label: 'Bulk Call Retranscription', group: 'Calls' },
  link_test_call_scoring:          { label: 'Test Call Evaluation', group: 'Calls' },
  kb_query_expansion:              { label: 'Knowledge Base Search Helper', group: 'Analytics' },
  analytics_routing_extraction:    { label: 'Analytics Question Router', group: 'Analytics' },
  analytics_insight_synthesizer:   { label: 'Analytics Insights Generator', group: 'Analytics' },
  chat_draft_generator:            { label: 'Customer Response Draft Generator', group: 'Analytics' },
  cron_scorecard_gen:              { label: 'Weekly Performance Report', group: 'Reports' },
};

const USD_TO_INR = 85.0;

export function calculateModelCost(modelName: string, inputTokens: number, outputTokens: number, durationSeconds = 0): { costUsd: number; costInr: number } {
  const model = modelName.toLowerCase();
  let costUsd = 0;

  if (model.includes('pyannote')) {
    costUsd = (durationSeconds || 0) * 0.0001;
  } else if (model.includes('claude-3-5') || model.includes('claude-sonnet')) {
    costUsd = (inputTokens * 3.00 + outputTokens * 15.00) / 1_000_000;
  } else if (model.includes('gemini-3.5-pro') || model.includes('gemini-1.5-pro')) {
    costUsd = (inputTokens * 1.25 + outputTokens * 5.00) / 1_000_000;
  } else {
    // Default to Gemini 3.5 Flash rate card ($0.075 / 1M in, $0.30 / 1M out)
    costUsd = (inputTokens * 0.075 + outputTokens * 0.30) / 1_000_000;
  }

  const costInr = costUsd * USD_TO_INR;
  return {
    costUsd: Math.round(costUsd * 1_000_000) / 1_000_000,
    costInr: Math.round(costInr * 10_000) / 10_000,
  };
}

export interface LogTokenUsageOptions {
  jobType: JobType;
  featureGroup?: FeatureGroup;
  modelName: string;
  inputTokens: number;
  outputTokens: number;
  entityId?: string | null;
  userEmail?: string | null;
  durationSeconds?: number;
  latencyMs?: number;
}

export async function logLlmTokenUsage(opts: LogTokenUsageOptions): Promise<void> {
  try {
    const jobInfo = JOB_DISPLAY_NAMES[opts.jobType] || { label: opts.jobType, group: 'Others' };
    const featureGroup = opts.featureGroup || jobInfo.group;
    const inputTokens = Math.max(0, opts.inputTokens || 0);
    const outputTokens = Math.max(0, opts.outputTokens || 0);
    const totalTokens = inputTokens + outputTokens;
    const durationSeconds = opts.durationSeconds || 0;
    const latencyMs = opts.latencyMs || 0;

    const { costUsd, costInr } = calculateModelCost(opts.modelName, inputTokens, outputTokens, durationSeconds);

    await query(
      `INSERT INTO llm_token_logs (
        job_type, feature_group, model_name, entity_id, user_email,
        input_tokens, output_tokens, total_tokens, duration_seconds, latency_ms,
        estimated_cost_usd, estimated_cost_inr
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        opts.jobType,
        featureGroup,
        opts.modelName,
        opts.entityId || null,
        opts.userEmail || 'system',
        inputTokens,
        outputTokens,
        totalTokens,
        durationSeconds,
        latencyMs,
        costUsd,
        costInr,
      ]
    );
  } catch (err: any) {
    console.error('[token-tracker] Failed to log token usage:', err.message);
  }
}
