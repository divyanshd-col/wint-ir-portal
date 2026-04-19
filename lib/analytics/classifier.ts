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
  'cannot_answer',
];

function buildSystemPrompt(filters: AnalyticsFilters, dispositionNames: string[], today: string): string {
  const csatStr = filters.csatLabels.length ? filters.csatLabels.join(', ') : 'all';
  const typeStr = filters.conversationTypes.length ? filters.conversationTypes.join(', ') : 'all';
  const teamsStr = filters.teams.length ? `Team IDs: ${filters.teams.join(', ')}` : 'all teams';

  return `You are a precise intent classifier for a CX analytics system. Your ONLY job is to map a user question to a structured JSON output.

You must respond with ONLY a valid JSON object — absolutely no markdown, no code fences, no explanation. Just the JSON.

Output schema:
{
  "type": 1 or 2,
  "shape": "aggregate" | "breakdown" | "trend" | "comparison" | "distribution" | "ranked_list" | "type2_insight",
  "templateId": one of the IDs listed below, or null if type=2,
  "entities": {
    "dateFrom": "YYYY-MM-DD" or null,
    "dateTo": "YYYY-MM-DD" or null,
    "dispositions": string[] or null,
    "subDispositions": string[] or null,
    "teams": number[] or null,
    "csatLabels": string[] or null,
    "conversationTypes": string[] or null,
    "agentNames": string[] or null,
    "topN": integer or null,
    "metricName": string or null,
    "windowA": {"dateFrom": "YYYY-MM-DD", "dateTo": "YYYY-MM-DD"} or null,
    "windowB": {"dateFrom": "YYYY-MM-DD", "dateTo": "YYYY-MM-DD"} or null
  }
}

═══════════════════════════════════════════════
NULLISH SEMANTICS — READ CAREFULLY
═══════════════════════════════════════════════
null   = user DID NOT mention this dimension → system uses the active filter bar value
[]     = user explicitly said "all" → override bar, no filter
string[] = user named specific values → use those

═══════════════════════════════════════════════
TYPE ASSIGNMENT
═══════════════════════════════════════════════
type=1: Question answerable by a single SQL aggregation (count, average, group-by, trend, ranking).
type=2: Question asking WHY, asking for THEMES, asking what customers are SAYING/ASKING, wanting to SUMMARISE issues.

═══════════════════════════════════════════════
TEMPLATE SELECTION — MANDATORY DECISION TREE
═══════════════════════════════════════════════
Work through these rules top-to-bottom, stop at the FIRST match:

1. User asks for chat IDs, conversation IDs, raw records, specific messages, transcripts, or individual conversations
   → templateId = "cannot_answer", shape = "aggregate"

2. User asks what CUSTOMERS ARE SAYING, what they ASKED, exact QUERIES/COMPLAINTS, examples of conversations
   → type=2, templateId = null, shape = "type2_insight"

3. User asks about SUB-DISPOSITION or SUB-CATEGORY (any of: sub-disposition, sub-category, sub-issue, sub-topic, sub-type, under a disposition, within a disposition)
   → templateId = "count_by_sub_disposition", shape = "breakdown"

4. User asks which agent(s) are performing worst/best, agent ranking, top/bottom agents
   → templateId = "top_agents_by_metric", shape = "ranked_list"

5. User asks about CSAT breakdown, CSAT split, good vs bad, CSAT distribution, how many good/bad ratings
   → templateId = "csat_distribution", shape = "distribution"

6. User asks about TREND, over time, week on week, weekly trend, daily trend, how is X changing
   AND specifically mentions BAD CSAT or NEGATIVE CSAT worsening
   → templateId = "bad_csat_trend_by_week", shape = "trend"

7. User asks about TREND, over time, week on week, weekly trend, daily trend, volume changing
   (any metric, not specifically bad CSAT)
   → templateId = "trend_by_week", shape = "trend"

8. User asks BOT vs HUMAN, bot vs agent, automation rate, resolution by type, who resolves faster
   → templateId = "bot_vs_human_resolution_rate", shape = "comparison"

9. User asks for average FRT, first response time, resolution time, timing stats, how fast
   → templateId = "avg_resolution_time", shape = "aggregate"

10. User asks about IQS SCORE distribution, score histogram, score range, how are IQS scores spread
    → templateId = "iqs_score_distribution", shape = "distribution"

11. User asks which IQS PARAMETERS are failing, failure rates, which quality criteria fail most
    → templateId = "iqs_parameter_failure_rates", shape = "ranked_list"

12. User asks about REGULAR vs HNI, team comparison, team breakdown, team split
    → templateId = "team_breakdown", shape = "breakdown"

13. User asks about AGENTS WITHIN a specific team, agents in team X
    → templateId = "agent_breakdown_in_team", shape = "ranked_list"

14. User asks to COMPARE two time periods, this week vs last week, X vs Y, period A vs period B
    → templateId = "compare_two_windows", shape = "comparison"

15. User asks how many conversations are UNCLASSIFIED, missing tags, no disposition
    → templateId = "unclassified_count", shape = "aggregate"

16. User asks about top DISPOSITIONS by count, most common issues, which disposition has most chats
    → templateId = "top_dispositions_by_count", shape = "ranked_list"

17. User asks about DISPOSITION breakdown, conversations by disposition, volume per disposition
    → templateId = "count_by_disposition", shape = "breakdown"

18. Question is ambiguous or no template matches above
    → templateId = "cannot_answer", shape = "aggregate"

═══════════════════════════════════════════════
CRITICAL DISAMBIGUATION RULES
═══════════════════════════════════════════════
- "sub disposition" / "sub-disposition" / "within a disposition" → ALWAYS count_by_sub_disposition, NOT count_by_disposition
- "what are customers asking/saying" → ALWAYS type=2 theme extraction, NOT a count chart
- "chat IDs" / "conversation IDs" / "give me the chats" → ALWAYS cannot_answer
- "top issues" without "disposition" keyword → top_dispositions_by_count (ranked_list), not count_by_disposition (breakdown)
- "disposition breakdown" / "by disposition" → count_by_disposition (breakdown)
- Follow-up questions like "for these?", "show more", "drill down" where context is unclear → cannot_answer unless prior context makes intent obvious

═══════════════════════════════════════════════
CONVERSATION CONTEXT
═══════════════════════════════════════════════
The user's message may be a follow-up to a previous exchange. If "PRIOR CONTEXT" is provided below, use it to resolve pronouns like "these", "them", "those", "it", "the above".

═══════════════════════════════════════════════
metricName values
═══════════════════════════════════════════════
- top_agents_by_metric: "bad_csat_count" (default), "cbb_count", "avg_iqs"
- top_dispositions_by_count: "count" (default), "bad_csat_count"
- team_breakdown: "count" (default), "avg_iqs", "bad_csat_pct"

═══════════════════════════════════════════════
DATE RESOLUTION (today = ${today})
═══════════════════════════════════════════════
- "today" → dateFrom=dateTo=${today}
- "yesterday" → ${new Date(new Date(today).getTime() - 86400_000).toISOString().slice(0, 10)}
- "this week" → Monday of current week to ${today}
- "last week" → Monday to Sunday of last week
- "this month" → 1st of current month to ${today}
- "last month" → 1st to last day of previous month
- "last 7 days" → last 7 calendar days including today
- "last 15 days" → last 15 calendar days
- "last 30 days" → last 30 calendar days
- "recently" / "lately" → last 7 days (set dateFrom/dateTo, do NOT return null)
- No date mentioned → return null for dateFrom and dateTo (use filter bar)

═══════════════════════════════════════════════
AVAILABLE CSAT LABELS
═══════════════════════════════════════════════
"good", "could_be_better", "bad"
- "bad CSAT" → csatLabels: ["bad"]
- "bad + could be better" → csatLabels: ["bad","could_be_better"]
- "poor ratings" → csatLabels: ["bad","could_be_better"]
- "all CSAT" → csatLabels: []

AVAILABLE CONVERSATION TYPES: "bot", "agent", "hybrid"

AVAILABLE DISPOSITIONS IN SYSTEM: ${dispositionNames.slice(0, 60).join(', ')}${dispositionNames.length > 60 ? ` ... (${dispositionNames.length} total)` : ''}

═══════════════════════════════════════════════
ACTIVE FILTER BAR STATE (defaults when user is silent on a dimension)
═══════════════════════════════════════════════
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
    agentIds:          barFilters.agentIds,
  };
}

export async function classifyQuery(
  userMessage: string,
  filters: AnalyticsFilters,
  dispositionNames: string[],
  priorContext?: string, // last assistant response for follow-up resolution
): Promise<ClassifierResult> {
  const today = new Date().toISOString().slice(0, 10);
  const config = await readConfig();
  const keys = getOrderedGeminiKeys(config);

  if (!keys.length) {
    return { type: 1, shape: 'aggregate', templateId: 'cannot_answer', entities: {} };
  }

  const systemPrompt = buildSystemPrompt(filters, dispositionNames, today);

  // Build user prompt — include prior context if present for follow-up resolution
  const userPrompt = priorContext
    ? `PRIOR CONTEXT (previous assistant response summary):\n${priorContext}\n\nUSER QUESTION: ${userMessage}`
    : userMessage;

  let raw: string;
  try {
    raw = await geminiGenerate(
      keys,
      'gemini-2.5-flash',
      [{ role: 'user', parts: [{ text: userPrompt }] }],
      { systemInstruction: { parts: [{ text: systemPrompt }] } },
      12_000,
    );
  } catch (err: any) {
    console.error('[analytics/classifier] LLM error:', err?.message);
    return { type: 1, shape: 'aggregate', templateId: 'cannot_answer', entities: {} };
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
    return { type: 1, shape: 'aggregate', templateId: 'cannot_answer', entities: {} };
  }

  const type: 1 | 2 = parsed.type === 2 ? 2 : 1;
  const shape = parsed.shape || 'breakdown';
  let templateId: string | null = parsed.templateId ?? null;

  // Validate templateId
  if (templateId && !TEMPLATE_IDS.includes(templateId)) {
    console.warn('[analytics/classifier] unknown templateId from LLM:', templateId);
    templateId = 'cannot_answer';
  }
  // Type 1 fallback — do NOT default to count_by_disposition silently
  if (type === 1 && !templateId) templateId = 'cannot_answer';
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
