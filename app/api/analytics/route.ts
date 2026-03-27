import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { readLogs } from '@/lib/logger';
import { readLogsFromSheet } from '@/lib/sheets';
import { readConfig } from '@/lib/config';
import { geminiGenerate, getOrderedGeminiKeys } from '@/lib/gemini';

interface LogEntry {
  timestamp: string;
  username: string;
  query: string;
  model: string;
}

function categorize(q: string): string {
  const s = q.toLowerCase();
  if (/repayment|payout|interest paid|record date|maturity|coupon|credited|not received/.test(s)) return 'Repayment';
  if (/account|kyc|onboard|registr|pan|bank|ifsc|mandate|nominee/.test(s)) return 'Account & KYC';
  if (/bond|yield|return|invest|fixed deposit|wint wisdom|portfolio/.test(s)) return 'Investment';
  if (/withdraw|redeem|redemption|exit/.test(s)) return 'Withdrawal';
  if (/app|website|platform|login|error|not working|not showing|not loading|technical|bug|glitch/.test(s)) return 'Platform Issue';
  return 'General';
}

function computeStats(logs: LogEntry[]) {
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

  const PROBLEM_RE = /error|not (working|showing|loading|received|credited)|failed|issue|problem|wrong|broken|stuck|unable|can't|cannot/i;
  const unansweredQueries = Object.entries(queryCount)
    .filter(([q]) => PROBLEM_RE.test(q))
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 5)
    .map(([query, data]) => ({ query, count: data.count, agents: [...data.agents] }));

  const categoryCount: Record<string, number> = {};
  for (const log of logs) {
    const cat = categorize(log.query);
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
    unansweredQueries,
    categoryBreakdown,
    modelDistribution: modelDist,
    dailyTrend,
    recentLogs: logs.slice(0, 50),
  };
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!(session?.user as any)?.isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const question: string = body.question?.trim() || '';

  // Sheet is the source of truth — has full history.
  // Fall back to KV/file if service account is not configured.
  let logs: LogEntry[];
  let source: 'sheet' | 'kv';
  try {
    logs = await readLogsFromSheet();
    source = 'sheet';
    console.log(`[analytics] Loaded ${logs.length} logs from Google Sheet`);
  } catch (err: any) {
    console.warn(`[analytics] Sheet read failed (${err.message}), falling back to KV`);
    logs = await readLogs();
    source = 'kv';
  }

  const stats = { ...computeStats(logs), source, totalInSheet: logs.length };

  if (!question) {
    return NextResponse.json({ stats });
  }

  // LLM-powered Q&A over log data
  const config = await readConfig();
  const keys = getOrderedGeminiKeys(config);
  if (!keys.length) {
    return NextResponse.json({ stats, answer: 'No Gemini API key configured.' });
  }

  // Build a compact log table (last 300 entries) for LLM context
  const logTable = logs
    .slice(0, 300)
    .map(l => `${l.timestamp.slice(0, 16)} | ${l.username} | ${l.model} | ${l.query}`)
    .join('\n');

  const agentSummary = stats.agentBreakdown
    .map(a => `${a.username}: ${a.count} queries, last active ${a.lastSeen.slice(0, 10)}, top query: "${a.topQuery}"`)
    .join('\n');

  const topQueriesSummary = stats.topQueries
    .map((q, i) => `${i + 1}. "${q.query}" — ${q.count}x by [${q.agents.join(', ')}]`)
    .join('\n');

  const categorySummary = stats.categoryBreakdown
    .map(c => `${c.category}: ${c.count} (${c.pct}%)`)
    .join(', ');

  const prompt = `You are an analytics assistant for the Wint Wealth IR Portal — an internal AI tool used by CX agents.

OVERALL STATS:
- Total queries logged: ${stats.totalQueries}
- Unique agents: ${stats.uniqueAgents}
- Queries today: ${stats.queriesToday}
- Most active agent: ${stats.mostActiveAgent}
- Model distribution: ${JSON.stringify(stats.modelDistribution)}

PER-AGENT BREAKDOWN:
${agentSummary}

TOP QUERIES (by frequency):
${topQueriesSummary}

QUERY CATEGORIES:
${categorySummary}

RAW LOG (last 300 entries, format: timestamp | agent | model | query):
${logTable}

---
ADMIN QUESTION: ${question}

Answer analytically with specific numbers and data. Be concise but complete. Use bullet points or short tables where helpful.`;

  try {
    const answer = await geminiGenerate(
      keys,
      'gemini-2.5-flash',
      [{ role: 'user', parts: [{ text: prompt }] }],
      {},
      30000
    );
    return NextResponse.json({ stats, answer });
  } catch (err: any) {
    console.error('[analytics] LLM error:', err);
    return NextResponse.json({ stats, answer: `Analysis failed: ${err.message}` });
  }
}
