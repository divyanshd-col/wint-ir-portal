import { query } from '@/lib/cx/db';
import { resolveParamCell } from '@/lib/param-keys';
import { PARAM_ORDER, PARAM_NAMES, calculateWeightedOverallIQS, extractPooledParams } from '@/lib/quality';
import { geminiGenerate, getIQSGeminiKeys } from '@/lib/gemini';
import { readConfig } from '@/lib/config';

// Rubric weights defined in §5 & lib/scoring/prompt_v4.ts
export const RUBRIC_WEIGHTS: Record<string, number> = {
  IssueResolution: 25,
  Accuracy: 20,
  ExpectationFollowThrough: 20,
  DissatisfactionHandling: 10,
  Personalization: 10,
  Empathy: 5,
  EscalationDecision: 5,
  Readability: 3,
  GreetingHandover: 2,
  PostCallRecap: 5
};

export interface ScorecardInput {
  agentId: number;
  agentName: string;
  weekStart: string; // YYYY-MM-DD (Monday)
  weekEnd: string;   // YYYY-MM-DD (Sunday)
}

export interface GeneratedScorecard {
  numbers: {
    chatsHandled: number;
    averageScore: number | null;
    below85Count: number;
    csatText: string;
    complianceBreachesCount: number;
    scoresAdjustedCount: number;
  };
  whatWentWell: string;
  evidence: Array<{
    chatId: string;
    score: number | null;
    topic: string;
    summary: string;
  }>;
  breaches: Array<{
    chatId: string;
    score: number | null;
    flaggedContent: string;
    note: string;
  }>;
  themes: Array<{
    pattern: string;
    backingChatIds: string[];
    associatedParameters: string[];
    whyItMatters: string;
    actionable: string;
    isBreach: boolean;
    rankScore: number;
  }>;
}

/**
 * Computes CSAT details.
 * Good CSAT is 'good'. Neutral CSAT ('could_be_better') and Bad CSAT ('bad') count in denominator only.
 */
export function computeCSAT(rows: any[]) {
  let good = 0;
  let total = 0;
  for (const r of rows) {
    const label = r.csat_label;
    if (label === 'good') {
      good++;
      total++;
    } else if (label === 'could_be_better' || label === 'bad') {
      total++;
    }
  }
  if (total === 0) {
    return { good: 0, total: 0, percentage: null, text: 'no ratings this week' };
  }
  const percentage = Math.round((good / total) * 100);
  return {
    good,
    total,
    percentage,
    text: `${percentage}% positive (${good} of ${total} rated good)`
  };
}

/**
 * Computes strongest parameters for the week.
 * Sorts by average success rate, break ties by count of applicability, then rubric weight.
 */
export function getStrongestParameters(rows: any[]) {
  const stats: Record<string, { sum: number; count: number }> = {};
  for (const param of PARAM_ORDER) {
    stats[param] = { sum: 0, count: 0 };
  }

  for (const r of rows) {
    const agentParams = r.parameters?.__agent_parameters || r.parameters || {};
    for (const param of PARAM_ORDER) {
      const cell = resolveParamCell(agentParams, param);
      const scoreVal = cell.score;
      if (scoreVal === true || scoreVal === 1 || scoreVal === 'true') {
        stats[param].sum += 1;
        stats[param].count += 1;
      } else if (scoreVal === 0.5 || scoreVal === '0.5') {
        stats[param].sum += 0.5;
        stats[param].count += 1;
      } else if (scoreVal === false || scoreVal === 0 || scoreVal === 'false') {
        stats[param].count += 1;
      }
    }
  }

  const results = Object.entries(stats)
    .filter(([_, stat]) => stat.count > 0)
    .map(([param, stat]) => ({
      param,
      name: PARAM_NAMES[param] || param,
      successRate: stat.sum / stat.count,
      count: stat.count
    }));

  results.sort((a, b) => {
    if (Math.abs(a.successRate - b.successRate) > 0.0001) {
      return b.successRate - a.successRate;
    }
    if (a.count !== b.count) {
      return b.count - a.count;
    }
    return (RUBRIC_WEIGHTS[b.param] || 0) - (RUBRIC_WEIGHTS[a.param] || 0);
  });

  return results.slice(0, 3).map(r => r.name);
}

/**
 * Generates a scorecard for a single agent.
 */
export async function generateScorecard(input: ScorecardInput): Promise<GeneratedScorecard> {
  const { agentId, agentName, weekStart, weekEnd } = input;

  // 1. Fetch conversations closed in the week window
  // closed_at is inclusive of weekStart and exclusive of Monday of next week
  const nextMonday = new Date(new Date(weekStart).getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const rows = await query<any>(
    `SELECT c.id, c.csat_score, c.csat_label, c.tags->>'disposition' AS disposition, 
            s.iqs_score, s.parameters, s.reviewed_by IS NOT NULL AS overridden
     FROM conversations c
     JOIN iqs_scores s ON s.chat_id = c.id
     WHERE c.agent_id = $1 
       AND c.closed_at::date >= $2 
       AND c.closed_at::date < $3
       AND c.conversation_type IN ('agent', 'hybrid')`,
    [agentId, weekStart, nextMonday]
  );

  // 2. Compute the numbers
  const chatsHandled = rows.length;

  const validScores = rows.map(r => r.iqs_score).filter(s => s !== null && s !== undefined);
  const paramsArray = rows.map(r => r.parameters);
  const pooled = extractPooledParams(paramsArray);

  // Replicate the intermediate parameter-level rounding used in analytics to match exactly
  const chatPeriodParamMap: Record<string, number> = {};
  for (const [key, val] of Object.entries(pooled)) {
    if (val.total > 0) {
      chatPeriodParamMap[key] = Math.round(((val.yes + 0.5 * val.half) / val.total) * 1000) / 10;
    }
  }
  const weightedOverall = calculateWeightedOverallIQS(chatPeriodParamMap, 'human', { roundDecimals: 1 });
  const averageScore = weightedOverall;

  const below85Count = validScores.filter(s => s < 85).length;

  const csat = computeCSAT(rows);

  // Breach chats count (any chat containing compliance flags regardless of score)
  const breachRows = rows.filter(r => {
    const breaches = r.parameters?.__breaches;
    return Array.isArray(breaches) && breaches.length > 0;
  });
  const complianceBreachesCount = breachRows.length;

  const scoresAdjustedCount = rows.filter(r => r.overridden).length;

  // 3. Find top parameters for "What went well"
  const topParams = getStrongestParameters(rows);

  // 4. Group failing chats for evidence list
  const failingChats = rows
    .filter(r => r.iqs_score !== null && r.iqs_score < 85)
    .sort((a, b) => (a.iqs_score || 0) - (b.iqs_score || 0)); // worst first

  // 5. Structure compliance breaches
  const breachesList = breachRows.map(r => {
    const breaches = r.parameters?.__breaches || [];
    const formattedContent = breaches.join(', ');
    const note = r.iqs_score >= 85 
      ? `Note: This chat scored well (${r.iqs_score}%) but was flagged for compliance check.`
      : '';
    return {
      chatId: r.id,
      score: r.iqs_score,
      flaggedContent: formattedContent,
      note
    };
  });

  // 6. Generate the AI prose section (Discussion points & evidence summaries)
  let whatWentWell = `No strong parameters could be evaluated for ${agentName} this week.`;
  if (topParams.length > 0) {
    const joinedParams = topParams.slice(0, -1).join(', ') + (topParams.length > 1 ? ` and ${topParams[topParams.length - 1]}` : topParams[0]);
    whatWentWell = `${agentName} showed strong performance in ${joinedParams} this week.`;
  }

  let aiThemes: any[] = [];
  const evidenceSummaries: Record<string, string> = {};

  if (failingChats.length > 0) {
    const config = await readConfig();
    const keys = getIQSGeminiKeys(config);

    // Prepare content data for AI
    const formattedFailingChats = failingChats.map(c => {
      const agentParams = c.parameters?.__agent_parameters || c.parameters || {};
      const failingDetails = PARAM_ORDER.map(param => {
        const cell = resolveParamCell(agentParams, param);
        if (cell.score === false || cell.score === 0 || cell.score === 'false' || cell.score === 0.5) {
          return `- ${param} (Score: ${cell.score}): ${cell.reasoning || cell.comment || 'No explanation provided.'}`;
        }
        return null;
      }).filter(Boolean).join('\n');

      return `Chat ID: ${c.id}
Score: ${c.iqs_score}
Topic: ${c.disposition || 'unclassified'}
Failing Parameters:
${failingDetails || 'None'}`;
    }).join('\n\n---\n\n');

    const systemInstruction = `You are an expert Quality Assurance Coach. You generate weekly performance scorecards for support agents.
Your task is to analyze the provided set of low-scoring chats for the agent named ${agentName} and:
1. Generate a single plain-language, encouraging sentence for "whatWentWell" highlighting their strongest parameters: ${topParams.join(', ')}. Keep it encouraging, behavioral, and focused on ${agentName}.
2. Group the failures from the low-scoring chats into 1-3 cohesive coaching themes. Do NOT generate one theme per chat; group multiple chats under a single theme where possible.
3. For each chat in the low-scoring set, write a concise one-line summary of its main issue for the "evidenceSummaries" mapping.
4. Output a JSON object matching this structure EXACTLY:
{
  "whatWentWell": "A short sentence highlighting their strong parameters.",
  "evidenceSummaries": {
    "CHAT_ID": "A one-line summary of the main issue."
  },
  "themes": [
    {
      "pattern": "A plain behavioral description of the coaching theme.",
      "backingChatIds": ["CHAT_ID_1", "CHAT_ID_2"],
      "associatedParameters": ["ParameterPascalName1", "ParameterPascalName2"],
      "whyItMatters": "Why it matters, explicitly tied to the rubric parameters and their weights.",
      "actionable": "A specific behavioral change instruction for the agent. Never make character judgments."
    }
  ]
}

CRITICAL RULES:
- The word "agent" must never appear in the output. Always refer to the person by name: ${agentName}.
- In "associatedParameters", only use canonical Pascal-case rubric names: IssueResolution, Accuracy, ExpectationFollowThrough, DissatisfactionHandling, Personalization, Empathy, EscalationDecision, Readability, GreetingHandover, PostCallRecap.
- Every chat ID in backingChatIds and as keys in evidenceSummaries MUST match one of the provided chat IDs. Never invent a chat ID.
- In "actionable", suggest specific behaviors to change, not character flaws. E.g. "Ask if they have any other questions before closing" instead of "Agent is rushed".`;

    const responseText = await geminiGenerate(
      keys,
      'gemini-3.5-flash',
      [
        {
          text: `Here are the low-scoring chats for ${agentName} (week of ${weekStart} to ${weekEnd}):\n\n${formattedFailingChats}`
        }
      ],
      {
        systemInstruction,
        config: { responseMimeType: 'application/json' }
      }
    );

    let parsed: any;
    try {
      parsed = JSON.parse(responseText);
    } catch (err: any) {
      throw new Error(`Failed to parse AI response as JSON: ${err.message}. Response was: ${responseText}`);
    }

    // Validate the AI output
    const allowedChatIds = new Set(failingChats.map(c => c.id));
    
    // Check evidenceSummaries keys
    if (parsed.evidenceSummaries) {
      for (const cid of Object.keys(parsed.evidenceSummaries)) {
        if (!allowedChatIds.has(cid)) {
          throw new Error(`AI generated invalid/fabricated chat ID in evidenceSummaries: ${cid}`);
        }
      }
    }

    // Check themes
    if (Array.isArray(parsed.themes)) {
      for (const theme of parsed.themes) {
        if (!Array.isArray(theme.backingChatIds) || theme.backingChatIds.length === 0) {
          throw new Error('AI theme is missing backingChatIds.');
        }
        for (const cid of theme.backingChatIds) {
          if (!allowedChatIds.has(cid)) {
            throw new Error(`AI generated invalid/fabricated chat ID in theme backingChatIds: ${cid}`);
          }
        }
      }
    }

    if (parsed.whatWentWell) {
      whatWentWell = parsed.whatWentWell;
    }
    aiThemes = parsed.themes || [];
    Object.assign(evidenceSummaries, parsed.evidenceSummaries || {});
  }

  // Ensure every failing chat has a summary (even if LLM missed it or there are no failing chats)
  const evidenceList = failingChats.map(c => {
    return {
      chatId: c.id,
      score: c.iqs_score,
      topic: c.disposition || 'unclassified',
      summary: evidenceSummaries[c.id] || 'Quality scorecard scoring below threshold.'
    };
  });

  // Programmatically rank and structure the themes
  const breachChatIds = new Set(breachRows.map(r => r.id));

  const rankedThemes = aiThemes.map(t => {
    const backingIds = t.backingChatIds || [];
    const associatedParams = t.associatedParameters || [];

    // N = number of backing chats
    const n = backingIds.length;
    // W = highest rubric weight among associated parameters
    const w = Math.max(...associatedParams.map((p: string) => RUBRIC_WEIGHTS[p] || 0), 0);
    let rankScore = n * w;

    // Check if rooted in a breach (backing chats contain any breach chats)
    const isThemeBreach = backingIds.some((cid: string) => breachChatIds.has(cid));
    if (isThemeBreach) {
      rankScore += 10000; // pin to the top
    }

    return {
      pattern: t.pattern,
      backingChatIds: backingIds,
      associatedParameters: associatedParams,
      whyItMatters: t.whyItMatters,
      actionable: t.actionable,
      isBreach: isThemeBreach,
      rankScore
    };
  });

  // Sort rankedThemes DESC by rankScore
  rankedThemes.sort((a, b) => b.rankScore - a.rankScore);

  return {
    numbers: {
      chatsHandled,
      averageScore,
      below85Count,
      csatText: csat.text,
      complianceBreachesCount,
      scoresAdjustedCount
    },
    whatWentWell: whatWentWell.replace(/\bagent\b/gi, agentName), // safeguard to strip word "agent"
    evidence: evidenceList,
    breaches: breachesList,
    themes: rankedThemes
  };
}
