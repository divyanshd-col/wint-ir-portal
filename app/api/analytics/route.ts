import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-guard';
import { csatScore, avgOrNull } from '@/lib/stats';
import { readLogs } from '@/lib/log';
import { readLogsFromSheet } from '@/lib/sheets';
import { readConfig } from '@/lib/config';
import { geminiGenerate, getOrderedGeminiKeys } from '@/lib/gemini';
import { getAllScoredConversations, type GetScoredConversationsOptions } from '@/lib/robylon/db';
import { DB_KEY_TO_LEGACY } from '@/lib/param-keys';
import { PARAM_NAMES, PARAM_ORDER, type IQSScoreEntry } from '@/lib/quality';

// ── Convert PostgreSQL row → IQSScoreEntry ────────────────────────────────────
function toIQSScoreEntry(row: any): IQSScoreEntry {
  const params = row.parameters || {};
  const scores: Record<string, string> = {};
  const reasoning: Record<string, string> = {};
  for (const [key, val] of Object.entries(params) as [string, any][]) {
    const k = DB_KEY_TO_LEGACY[key] ?? (key.charAt(0).toUpperCase() + key.slice(1));
    scores[k]    = val?.score === true ? 'Yes' : val?.score === false ? 'No' : 'NA';
    reasoning[k] = val?.reasoning || '';
  }
  const csatStr = row.csat_score ? String(row.csat_score) : '';
  const tagsStr = row.tags
    ? Object.values(row.tags).filter(Boolean).join(', ')
    : '';

  return {
    id:              `${row.scoredAt}-${row.chatId}`,
    chatId:          row.chatId,
    scoredAt:        row.scoredAt ? new Date(row.scoredAt).toISOString() : '',
    agentName:       row.agentName || '',
    date:            row.date ? String(row.date).slice(0, 10) : '',
    iqs:             row.iqs,
    csat:            csatStr,
    scores,
    reasoning,
    summary:         '',
    provider:        row.modelVersion?.includes('gemini') ? 'gemini' : 'claude',
    model:           row.modelVersion || '',
    conversationType: row.conversationType || 'agent',
    frt:             row.frt ?? undefined,
    botToTeamSecs:   row.botToTeamSecs ?? undefined,
    resolutionTime:  row.resolutionTime ?? undefined,
    tags:            tagsStr,
  } as any;
}

interface LogEntry {
  timestamp: string;
  username: string;
  query: string;
  model: string;
  category?: string;
  queryType?: string;
}

// ── Block types the LLM can produce ─────────────────────────────────────────
export type AnalyticsBlock =
  | { type: 'stat_row'; stats: { label: string; value: string; sub?: string; color?: string }[] }
  | { type: 'table'; title: string; columns: string[]; rows: (string | number)[][] }
  | { type: 'bar_chart'; title: string; data: { name: string; value: number; sub?: string }[]; unit?: string }
  | { type: 'line_chart'; title: string; data: { date: string; value: number }[]; unit?: string }
  | { type: 'insight'; text: string; severity?: 'info' | 'warning' | 'danger' };

// ── Log helpers ───────────────────────────────────────────────────────────────
function categorize(q: string, storedCategory?: string): string {
  if (storedCategory) {
    const map: Record<string, string> = { repayment: 'Repayment', kyc: 'Account & KYC', payment: 'Investment', sip: 'Investment', sell: 'Investment', referral: 'General', taxation: 'General', dashboard: 'Platform Issue', fd: 'Investment', huf: 'Account & KYC' };
    return map[storedCategory] || (storedCategory.charAt(0).toUpperCase() + storedCategory.slice(1));
  }
  const s = q.toLowerCase();
  if (/repayment|payout|interest paid|record date|maturity|coupon|credited|not received/.test(s)) return 'Repayment';
  if (/account|kyc|onboard|registr|pan|bank|ifsc|mandate|nominee/.test(s)) return 'Account & KYC';
  if (/bond|yield|return|invest|fixed deposit|wint wisdom|portfolio/.test(s)) return 'Investment';
  if (/withdraw|redeem|redemption|exit/.test(s)) return 'Withdrawal';
  if (/app|website|platform|login|error|not working|not showing|not loading|technical|bug|glitch/.test(s)) return 'Platform Issue';
  return 'General';
}

function computeLogStats(logs: LogEntry[]) {
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);

  const agentMap: Record<string, { count: number; lastSeen: string; queries: string[] }> = {};
  for (const log of logs) {
    if (!agentMap[log.username]) agentMap[log.username] = { count: 0, lastSeen: log.timestamp, queries: [] };
    agentMap[log.username].count++;
    if (log.timestamp > agentMap[log.username].lastSeen) agentMap[log.username].lastSeen = log.timestamp;
    agentMap[log.username].queries.push(log.query);
  }

  const agentBreakdown = Object.entries(agentMap)
    .map(([username, data]) => {
      const qCount: Record<string, number> = {};
      for (const q of data.queries) { qCount[q] = (qCount[q] || 0) + 1; }
      const topQuery = Object.entries(qCount).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
      return { username, count: data.count, lastSeen: data.lastSeen, topQuery };
    })
    .sort((a, b) => b.count - a.count);

  const queryCount: Record<string, { count: number; agents: Set<string> }> = {};
  for (const log of logs) {
    const key = log.query.toLowerCase().trim();
    if (!queryCount[key]) queryCount[key] = { count: 0, agents: new Set() };
    queryCount[key].count++;
    queryCount[key].agents.add(log.username);
  }
  const topQueries = Object.entries(queryCount)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 5)
    .map(([query, data]) => ({ query, count: data.count, agents: [...data.agents] }));

  const categoryCount: Record<string, number> = {};
  for (const log of logs) {
    const cat = categorize(log.query, log.category);
    categoryCount[cat] = (categoryCount[cat] || 0) + 1;
  }
  const total = logs.length || 1;
  const categoryBreakdown = Object.entries(categoryCount)
    .sort((a, b) => b[1] - a[1])
    .map(([category, count]) => ({ category, count, pct: Math.round((count / total) * 100) }));

  const modelDist: Record<string, number> = {};
  for (const log of logs) {
    const m = log.model?.includes('claude') ? 'claude' : 'gemini';
    modelDist[m] = (modelDist[m] || 0) + 1;
  }

  const dailyMap: Record<string, number> = {};
  for (const log of logs) {
    const d = log.timestamp.slice(0, 10);
    dailyMap[d] = (dailyMap[d] || 0) + 1;
  }
  const dailyTrend = Object.entries(dailyMap)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-14)
    .map(([date, count]) => ({ date, count }));

  return {
    totalQueries: logs.length,
    uniqueAgents: Object.keys(agentMap).length,
    queriesToday: logs.filter(l => l.timestamp.startsWith(todayStr)).length,
    mostActiveAgent: agentBreakdown[0]?.username || '—',
    agentBreakdown,
    topQueries,
    categoryBreakdown,
    modelDistribution: modelDist,
    dailyTrend,
    recentLogs: logs.slice(0, 50),
  };
}



function computeQualitySummary(entries: IQSScoreEntry[]) {
  if (!entries.length) return null;

  const botEntries = entries.filter(e => e.conversationType === 'bot');
  const agentEntries = entries.filter(e => e.conversationType !== 'bot');

  const csatNums = entries.map(e => csatScore(e.csat)).filter((n): n is number => n !== null);
  const botCsatNums = botEntries.map(e => csatScore(e.csat)).filter((n): n is number => n !== null);
  const agentCsatNums = agentEntries.map(e => csatScore(e.csat)).filter((n): n is number => n !== null);

  const good = entries.filter(e => e.csat === '5').length;
  const cbbBad = entries.filter(e => e.csat === '3' || e.csat === '1').length;

  const frtNums = entries.map(e => e.frt).filter((n): n is number => n !== undefined);
  const b2tNums = entries.map(e => e.botToTeamSecs).filter((n): n is number => n !== undefined);
  const resNums = entries.map(e => e.resolutionTime).filter((n): n is number => n !== undefined);
  const closNums = entries.map(e => e.closureTime).filter((n): n is number => n !== undefined);
  const iqsNums = entries.map(e => e.iqs);

  const slaMet = b2tNums.filter(s => s <= 180).length;

  // Per-agent stats
  const agentMap: Record<string, { chats: number; iqsSum: number; csatNums: number[]; frtNums: number[] }> = {};
  for (const e of entries) {
    const a = e.agentName || 'Unknown';
    if (!agentMap[a]) agentMap[a] = { chats: 0, iqsSum: 0, csatNums: [], frtNums: [] };
    agentMap[a].chats++;
    agentMap[a].iqsSum += e.iqs;
    const cs = csatScore(e.csat);
    if (cs !== null) agentMap[a].csatNums.push(cs);
    if (e.frt !== undefined) agentMap[a].frtNums.push(e.frt);
  }
  const agentStats = Object.entries(agentMap).map(([agent, d]) => ({
    agent,
    chats: d.chats,
    avgIqs: Math.round(d.iqsSum / d.chats),
    avgCsat: avgOrNull(d.csatNums),
    avgFrtSecs: avgOrNull(d.frtNums),
  })).sort((a, b) => b.chats - a.chats);

  // Parameter fail rates
  const paramFails: Record<string, number> = {};
  for (const param of PARAM_ORDER) {
    const fails = entries.filter(e => e.scores?.[param] === 'No').length;
    paramFails[param] = entries.length ? Math.round((fails / entries.length) * 100) : 0;
  }

  // Tag frequency
  const tagCount: Record<string, number> = {};
  for (const e of entries) {
    if (e.tags) {
      for (const t of e.tags.split(',').map(s => s.trim()).filter(Boolean)) {
        tagCount[t] = (tagCount[t] || 0) + 1;
      }
    }
  }
  const topTags = Object.entries(tagCount).sort((a, b) => b[1] - a[1]).slice(0, 10);

  // Daily IQS trend (last 30 days)
  const dailyIqs: Record<string, number[]> = {};
  for (const e of entries) {
    const d = (e.date || e.scoredAt?.slice(0, 10) || '');
    if (d) { if (!dailyIqs[d]) dailyIqs[d] = []; dailyIqs[d].push(e.iqs); }
  }
  const dailyIqsTrend = Object.entries(dailyIqs)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-30)
    .map(([date, scores]) => ({ date, avgIqs: Math.round(scores.reduce((s, n) => s + n, 0) / scores.length), count: scores.length }));

  return {
    totalConvos: entries.length,
    botConvos: botEntries.length,
    agentConvos: agentEntries.length,
    overallCsat: avgOrNull(csatNums),
    botCsat: avgOrNull(botCsatNums),
    agentCsat: avgOrNull(agentCsatNums),
    good,
    cbbBad,
    cbbBadPct: csatNums.length ? Math.round((cbbBad / csatNums.length) * 100) : 0,
    avgFrt: avgOrNull(frtNums),
    avgBotToTeam: avgOrNull(b2tNums),
    slaPercent: b2tNums.length ? Math.round((slaMet / b2tNums.length) * 100) : null,
    avgResolution: avgOrNull(resNums),
    avgClosure: avgOrNull(closNums),
    avgIqs: avgOrNull(iqsNums),
    iqsSampleSize: entries.length,
    agentStats,
    paramFails,
    topTags,
    dailyIqsTrend,
  };
}

// ── Main handler ──────────────────────────────────────────────────────────────
export async function POST(req: Request) {
  const { session, response } = await requireRole('admin');
  if (response) return response;

  const body = await req.json().catch(() => ({}));
  const question: string = body.question?.trim() || '';
  const filters: { dateFrom?: string; dateTo?: string; agent?: string; category?: string; queryType?: string } = body.filters || {};

  // Load logs
  let allLogs: LogEntry[];
  let source: 'sheet' | 'kv';
  try {
    allLogs = await readLogsFromSheet();
    source = 'sheet';
  } catch (err: any) {
    console.warn(`[analytics] Sheet read failed (${err.message}), falling back to KV`);
    allLogs = await readLogs();
    source = 'kv';
  }

  // Apply log filters
  let logs = allLogs;
  if (filters.dateFrom) logs = logs.filter(l => l.timestamp >= filters.dateFrom!);
  if (filters.dateTo)   logs = logs.filter(l => l.timestamp <= filters.dateTo! + 'T23:59:59');
  if (filters.agent)    logs = logs.filter(l => l.username === filters.agent);
  if (filters.category) logs = logs.filter(l => categorize(l.query, l.category) === filters.category);
  if (filters.queryType) logs = logs.filter(l => l.queryType === filters.queryType);

  const availableAgents = [...new Set(allLogs.map(l => l.username))].sort();
  const stats = { ...computeLogStats(logs), source, totalInSheet: allLogs.length, availableAgents };

  // Load quality scores
  let qualitySummary: ReturnType<typeof computeQualitySummary> = null;
  let qualityAgents: string[] = [];
  try {
    const dbOpts: GetScoredConversationsOptions = {};
    if (filters.dateFrom) dbOpts.dateFrom = filters.dateFrom;
    if (filters.dateTo) dbOpts.dateTo = filters.dateTo;
    if (filters.agent) dbOpts.agentName = filters.agent;

    const { rows: raw } = await getAllScoredConversations(dbOpts);
    const entries: IQSScoreEntry[] = raw.map(row => {
      try { return toIQSScoreEntry(row); } catch { return null; }
    }).filter(Boolean) as any[];

    qualityAgents = [...new Set(entries.map(e => e.agentName).filter(Boolean))].sort();
    qualitySummary = computeQualitySummary(entries);
  } catch (err: any) {
    console.warn('[analytics] Quality scores load failed:', err.message);
  }

  if (!question) {
    return NextResponse.json({ stats, qualitySummary, qualityAgents });
  }

  // LLM-powered analyst
  const config = await readConfig();
  const keys = getOrderedGeminiKeys(config);
  if (!keys.length) {
    return NextResponse.json({ stats, qualitySummary, qualityAgents, answer: 'No Gemini API key configured.', blocks: [] });
  }

  // Build context for the LLM
  const logSummary = `
PORTAL USAGE (IR agent queries):
- Total queries: ${stats.totalQueries} | Unique agents: ${stats.uniqueAgents} | Today: ${stats.queriesToday}
- Most active: ${stats.mostActiveAgent}
- By agent: ${stats.agentBreakdown.slice(0, 10).map(a => `${a.username}(${a.count})`).join(', ')}
- By category: ${stats.categoryBreakdown.map(c => `${c.category}:${c.count}(${c.pct}%)`).join(', ')}
- Daily trend (last 14d): ${stats.dailyTrend.map(d => `${d.date}:${d.count}`).join(', ')}
`.trim();

  const qualCtx = qualitySummary ? `
ROBYLON CONVERSATION QUALITY:
- Total scored convos: ${qualitySummary.totalConvos} | Bot: ${qualitySummary.botConvos} | Agent: ${qualitySummary.agentConvos}
- Avg IQS: ${qualitySummary.avgIqs ?? 'N/A'} | CSAT: ${qualitySummary.overallCsat ?? 'N/A'}% | Good: ${qualitySummary.good} | CBB+Bad: ${qualitySummary.cbbBad} (${qualitySummary.cbbBadPct}%)
- SLA (B→T ≤3min): ${qualitySummary.slaPercent ?? 'N/A'}% | Avg FRT: ${qualitySummary.avgFrt != null ? Math.round(qualitySummary.avgFrt / 60) + 'min' : 'N/A'} | Avg Resolution: ${qualitySummary.avgResolution != null ? Math.round(qualitySummary.avgResolution / 60) + 'min' : 'N/A'}

PER-AGENT QUALITY:
${qualitySummary.agentStats.map(a => `  ${a.agent}: ${a.chats} chats, IQS ${a.avgIqs}, CSAT ${a.avgCsat ?? 'N/A'}%, FRT ${a.avgFrtSecs != null ? Math.round(a.avgFrtSecs / 60) + 'min' : 'N/A'}`).join('\n')}

PARAMETER FAIL RATES (% of chats where parameter scored No):
${PARAM_ORDER.map(p => `  ${PARAM_NAMES[p]}: ${qualitySummary!.paramFails[p]}%`).join('\n')}

TOP TAGS: ${qualitySummary.topTags.map(([t, n]) => `${t}(${n})`).join(', ')}

DAILY IQS TREND: ${qualitySummary.dailyIqsTrend.map(d => `${d.date}:IQS${d.avgIqs}(n=${d.count})`).join(', ')}
`.trim() : 'Quality scores: No data available yet.';

  const systemPrompt = `You are an AI business analyst for Wint Wealth, a fintech bond investment company.
You have access to two data sources:
1. Portal usage logs — how IR agents use the internal AI assistant
2. Robylon conversation quality data — IQS scores, CSAT, timing metrics for customer chats

Your job is to answer the founder/co-founder's questions analytically, like a senior data analyst would.

ALWAYS return a valid JSON object (no markdown fences) with this exact shape:
{
  "answer": "<1-3 sentence narrative summary>",
  "blocks": [<array of Block objects>]
}

Block types you can use:
- {"type":"stat_row","stats":[{"label":"...","value":"...","sub":"...","color":"green|red|orange"}]}
- {"type":"table","title":"...","columns":["col1","col2",...],"rows":[["val","val"],...]}
- {"type":"bar_chart","title":"...","data":[{"name":"...","value":123,"sub":"..."}],"unit":"..."}
- {"type":"line_chart","title":"...","data":[{"date":"YYYY-MM-DD","value":123}],"unit":"..."}
- {"type":"insight","text":"...","severity":"info|warning|danger"}

Rules:
- Always include at least one block when there is data to show
- Use bar_chart for comparisons (agents, parameters, categories)
- Use line_chart for time trends
- Use table for detailed per-entity data (more than 5 items)
- Use stat_row for KPI summaries (3-6 key numbers)
- Use insight for findings that need attention (low IQS, SLA breach, specific agent issues)
- Sort bar charts descending by value
- Format seconds as minutes (e.g. 127 → "2m 7s"), percentages with % sign
- Be specific, use actual numbers from the data provided
- If the question cannot be answered from the data, say so clearly in "answer" and return empty blocks []`;

  const userPrompt = `DATA CONTEXT:
${logSummary}

${qualCtx}

QUESTION: ${question}`;

  try {
    const raw = await geminiGenerate(
      keys,
      'gemini-3.5-flash',
      [{ role: 'user', parts: [{ text: userPrompt }] }],
      { systemInstruction: { parts: [{ text: systemPrompt }] } },
      45000
    );

    let answer = 'Here is the analysis.';
    let blocks: AnalyticsBlock[] = [];
    try {
      // Strip markdown fences if model wrapped it
      const cleaned = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
      const parsed = JSON.parse(cleaned);
      answer = parsed.answer || answer;
      blocks = Array.isArray(parsed.blocks) ? parsed.blocks : [];
    } catch {
      // LLM returned plain text — use it as the answer
      answer = raw.trim();
      blocks = [];
    }

    return NextResponse.json({ stats, qualitySummary, qualityAgents, answer, blocks });
  } catch (err: any) {
    console.error('[analytics] LLM error:', err);
    return NextResponse.json({ stats, qualitySummary, qualityAgents, answer: `Analysis failed: ${err.message}`, blocks: [] });
  }
}
