import { geminiGenerate, getOrderedGeminiKeys } from '@/lib/gemini';
import { readConfig } from '@/lib/config';
import type { AnalyticsFilters, ClassifierResult, ClassifierEntities } from './types';

const TEMPLATE_IDS = [
  'count_by_disposition',
  'count_by_sub_disposition',
  'csat_distribution',
  'trend_by_week',
  'bad_csat_trend_by_week',
  'top_agents_by_metric',
  'top_dispositions_by_count',
  'bot_vs_human_resolution_rate',
  'avg_resolution_time',
  'iqs_score_distribution',
  'iqs_parameter_failure_rates',
  'team_breakdown',
  'agent_breakdown_in_team',
  'compare_two_windows',
  'unclassified_count',
];

function buildSystemPrompt(filters: AnalyticsFilters, dispositionNames: string[], today: string): string {
  const csatStr = filters.csatLabels.length ? filters.csatLabels.join(', ') : 'all';
  const typeStr = filters.conversationTypes.length ? filters.conversationTypes.join(', ') : 'all';
  const teamsStr = filters.teams.length ? `Team IDs: ${filters.teams.join(', ')}` : 'all teams';

  return `You are an intent classifier for a CX analytics system. Given a user question and their active filter bar state, output ONLY a valid JSON object — no markdown, no explanation, no code fences.

Output schema:
{
  "type": 1 or 2,
  "shape": "aggregate" | "breakdown" | "trend" | "comparison" | "distribution" | "ranked_list" | "type2_insight",
  "templateId": one of [${TEMPLATE_IDS.join(', ')}] or null if type=2,
  "entities": {
    "dateFrom": "YYYY-MM-DD" or null,
    "dateTo": "YYYY-MM-DD" or null,
    "dispositions": [] or null,
    "subDispositions": [] or null,
    "teams": [] or null,
    "csatLabels": [] or null,
    "conversationTypes": [] or null,
    "agentNames": [] or null,
    "topN": integer or null,
    "metricName": string or null,
    "windowA": {"dateFrom": "YYYY-MM-DD", "dateTo": "YYYY-MM-DD"} or null,
    "windowB": {"dateFrom": "YYYY-MM-DD", "dateTo": "YYYY-MM-DD"} or null
  }
}

IMPORTANT nullish semantics:
- null = "user did not mention this dimension" → use the filter bar value
- [] = "user explicitly said 'all'" → override bar with no filter
- A non-empty array = "user mentioned specific values" → use them

Type assignment:
- type=1: questions answerable by counting, averaging, grouping, or trending structured fields
- type=2: "why", "what themes", "what are customers complaining about", "summarise issues", "top issues"

templateId selection rules:
- "how many / count by disposition" → count_by_disposition, shape=breakdown
- "count by sub-disposition / sub-category" → count_by_sub_disposition, shape=breakdown
- "CSAT breakdown / CSAT split / good vs bad" → csat_distribution, shape=distribution
- "trend / week over week / over time / volume" → trend_by_week, shape=trend
- "bad CSAT trend / negative CSAT over time" → bad_csat_trend_by_week, shape=trend
- "which agent worst/best / top agents" → top_agents_by_metric, shape=ranked_list
- "top dispositions / most common issues" → top_dispositions_by_count, shape=ranked_list
- "bot vs human / bot vs agent / automation rate" → bot_vs_human_resolution_rate, shape=comparison
- "average FRT / resolution time / timing" → avg_resolution_time, shape=aggregate
- "IQS distribution / score histogram" → iqs_score_distribution, shape=distribution
- "which parameters failing / failure rate / IQS breakdown" → iqs_parameter_failure_rates, shape=ranked_list
- "regular vs HNI / team breakdown / team split" → team_breakdown, shape=breakdown
- "agents within team / agents in [team name]" → agent_breakdown_in_team, shape=ranked_list
- "compare [period A] to [period B] / vs last week" → compare_two_windows, shape=comparison
- "how many unclassified / missing tags" → unclassified_count, shape=aggregate

metricName values:
- For top_agents_by_metric: "bad_csat_count" (default), "cbb_count", "avg_iqs"
- For top_dispositions_by_count: "count" (default), "bad_csat_count"
- For team_breakdown: "count" (default), "avg_iqs", "bad_csat_pct"

Date resolution rules (today = ${today}):
- "today" → dateFrom=dateTo=${today}
- "yesterday" → dateFrom=dateTo=yesterday
- "this week" → dateFrom=Monday of this week, dateTo=${today}
- "last week" → Mon–Sun of previous week
- "this month" → 1st of current month to ${today}
- "last month" → 1st to last day of previous month
- "last 7 days" → ${today} minus 6 days to ${today}
- "last 15 days" → ${today} minus 14 days to ${today}
- "last 30 days" → ${today} minus 29 days to ${today}
- Relative "recently" / "lately" → last 7 days
- If no date mentioned → return null for dateFrom and dateTo (use filter bar)

Available CSAT label values: "good", "could_be_better", "bad"
Available conversation types: "bot", "agent", "hybrid"
Available dispositions in the system: ${dispositionNames.slice(0, 50).join(', ')}${dispositionNames.length > 50 ? ` ... (${dispositionNames.length} total)` : ''}

Active filter bar state (use these as defaults when user is silent on a dimension):
  dateFrom: ${filters.dateFrom}
  dateTo: ${filters.dateTo}
  csatLabels: ${csatStr}
  conversationTypes: ${typeStr}
  teams: ${teamsStr}`;
}

export function mergeFilters(
  entities: ClassifierEntities,
  barFilters: AnalyticsFilters,
): AnalyticsFilters {
  return {
    dateFrom:          entities.dateFrom          ?? barFilters.dateFrom,
    dateTo:            entities.dateTo            ?? barFilters.dateTo,
    dispositions:      entities.dispositions      ?? barFilters.dispositions,
    subDispositions:   entities.subDispositions   ?? barFilters.subDispositions,
    teams:             entities.teams             ?? barFilters.teams,
    csatLabels:        entities.csatLabels        ?? barFilters.csatLabels,
    conversationTypes: entities.conversationTypes ?? barFilters.conversationTypes,
    agentIds:          barFilters.agentIds, // resolved separately from agentNames
  };
}

export async function classifyQuery(
  userMessage: string,
  filters: AnalyticsFilters,
  dispositionNames: string[],
): Promise<ClassifierResult> {
  const today = new Date().toISOString().slice(0, 10);
  const config = await readConfig();
  const keys = getOrderedGeminiKeys(config);

  if (!keys.length) {
    // Fallback: can't classify — default to Type 1 breakdown
    return {
      type: 1,
      shape: 'breakdown',
      templateId: 'count_by_disposition',
      entities: {},
    };
  }

  const systemPrompt = buildSystemPrompt(filters, dispositionNames, today);

  let raw: string;
  try {
    raw = await geminiGenerate(
      keys,
      'gemini-2.5-flash',
      [{ role: 'user', parts: [{ text: userMessage }] }],
      { systemInstruction: { parts: [{ text: systemPrompt }] } },
      12_000,
    );
  } catch (err: any) {
    console.error('[analytics/classifier] LLM error:', err?.message);
    return {
      type: 1,
      shape: 'breakdown',
      templateId: 'count_by_disposition',
      entities: {},
    };
  }

  // Strip markdown fences
  const cleaned = raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  let parsed: any;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    console.error('[analytics/classifier] JSON parse failed, raw:', cleaned.slice(0, 300));
    return {
      type: 1,
      shape: 'breakdown',
      templateId: 'count_by_disposition',
      entities: {},
    };
  }

  const type: 1 | 2 = parsed.type === 2 ? 2 : 1;
  const shape = parsed.shape || 'breakdown';
  let templateId: string | null = parsed.templateId ?? null;

  // Validate templateId
  if (templateId && !TEMPLATE_IDS.includes(templateId)) templateId = null;
  // Type 1 fallback
  if (type === 1 && !templateId) templateId = 'count_by_disposition';
  // Type 2 never has a templateId
  if (type === 2) templateId = null;

  const entities: ClassifierEntities = parsed.entities ?? {};

  // Sanitize: remove hallucinated disposition values
  if (Array.isArray(entities.dispositions) && entities.dispositions.length) {
    const lower = new Set(dispositionNames.map(d => d.toLowerCase()));
    entities.dispositions = entities.dispositions.filter(
      (d: string) => lower.has(d.toLowerCase()),
    );
    if (!entities.dispositions.length) entities.dispositions = null;
  }

  return { type, shape, templateId, entities };
}
