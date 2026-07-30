import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { query } from '@/lib/cx/db';
import { readConfig } from '@/lib/config';
import { PARAM_ORDER, PARAM_NAMES, calculateWeightedOverallIQS } from '@/lib/quality';
import { ALL_DB_KEY_TO_PASCAL } from '@/lib/param-keys';
import Anthropic from '@anthropic-ai/sdk';

// Map any stored key (v4 canonical, old no-underscore v4, or legacy v3) to its
// canonical Pascal name. The old v3-only map left 6 of 10 v4 params out of the
// coaching prompt entirely.
function normParam(raw: string): string {
  return ALL_DB_KEY_TO_PASCAL[raw] ?? (raw.charAt(0).toUpperCase() + raw.slice(1));
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== 'agent') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const channel: string = body.channel || 'chats';
  const period: string  = body.period  || '30';
  const customFrom: string = body.from || '';
  const customTo: string   = body.to   || '';

  const config = await readConfig();
  const email = session.user.email || '';
  const configUser = config.users.find((u: any) => (u.email || u.username) === email);
  const agentName = configUser?.agentName || '';
  if (!agentName) return NextResponse.json({ error: 'Agent not configured' }, { status: 404 });

  const apiKey = config.iqsAnthropicApiKey || (config as any).anthropicApiKey || process.env.ANTHROPIC_API_KEY || '';
  if (!apiKey) return NextResponse.json({ error: 'AI not configured' }, { status: 503 });

  // Date range
  const today = new Date().toISOString().slice(0, 10);
  let dateFrom: string;
  let dateTo: string = today;
  if (period === 'custom' && customFrom && customTo) {
    dateFrom = customFrom; dateTo = customTo;
  } else if (period === '7') {
    const d = new Date(); d.setDate(d.getDate() - 6); dateFrom = d.toISOString().slice(0, 10);
  } else {
    const d = new Date(); d.setDate(d.getDate() - 29); dateFrom = d.toISOString().slice(0, 10);
  }

  if (channel === 'calls') {
    // Aggregate call IQS + parameters
    const rows = await query<{ avg_iqs: string; count: string; parameters: any }>(`
      SELECT
        AVG(s.call_iqs_score)::text AS avg_iqs,
        COUNT(cr.id)::text          AS count,
        jsonb_agg(s.call_parameters) FILTER (WHERE s.call_parameters IS NOT NULL) AS parameters
      FROM call_recordings cr
      JOIN agents a ON a.id = cr.agent_id
      LEFT JOIN iqs_scores s ON s.chat_id = cr.chat_id
      WHERE a.name = $1
        AND cr.called_at::date >= $2
        AND cr.called_at::date <= $3
    `, [agentName, dateFrom, dateTo]);

    const r = rows[0];
    const avgIqs = r?.avg_iqs ? Math.round(parseFloat(r.avg_iqs)) : null;
    const count  = parseInt(r?.count ?? '0');

    const paramRates: Record<string, { yes: number; total: number }> = {};
    for (const paramObj of (Array.isArray(r?.parameters) ? r.parameters : [])) {
      if (!paramObj) continue;
      for (const [rawKey, val] of Object.entries(paramObj as Record<string, any>)) {
        if (rawKey.startsWith('__')) continue;
        const pk = normParam(rawKey);
        if (!paramRates[pk]) paramRates[pk] = { yes: 0, total: 0 };
        const score = val?.score;
        if (score === true || score === 'Yes') { paramRates[pk].yes++; paramRates[pk].total++; }
        else if (score === false || score === 'No') { paramRates[pk].total++; }
      }
    }

    const context = buildCallContext(agentName, count, avgIqs, paramRates, dateFrom, dateTo);
    const result = await callLLM(apiKey, context, 'calls', count);
    return NextResponse.json(result);
  }

  // Default: chats
  const rows = await query<{
    avg_iqs: string; avg_csat: string; total: string; csat_good: string; csat_total: string;
    parameters: any; top_disp: string;
  }>(`
    SELECT
      AVG(s.iqs_score)::text                                          AS avg_iqs,
      COUNT(c.id)::text                                               AS total,
      COUNT(CASE WHEN c.csat_score = 5 THEN 1 END)::text             AS csat_good,
      COUNT(CASE WHEN c.csat_score IN (1,3,5) THEN 1 END)::text      AS csat_total,
      jsonb_agg(s.parameters) FILTER (WHERE s.parameters IS NOT NULL) AS parameters,
      (
        SELECT COALESCE(c2.tags->>'disposition','Other')
        FROM conversations c2
        JOIN agents a2 ON a2.id = c2.agent_id
        WHERE a2.name = $1
          AND c2.closed_at::date >= $2
          AND c2.closed_at::date <= $3
        GROUP BY 1 ORDER BY COUNT(*) DESC LIMIT 1
      ) AS top_disp
    FROM conversations c
    JOIN agents a ON a.id = c.agent_id
    LEFT JOIN iqs_scores s ON s.chat_id = c.id
    WHERE a.name = $1
      AND c.closed_at::date >= $2
      AND c.closed_at::date <= $3
      AND s.iqs_score IS NOT NULL
  `, [agentName, dateFrom, dateTo]);

  const r = rows[0];
  const count  = parseInt(r?.total ?? '0');
  const csatPct = r?.csat_total && parseInt(r.csat_total) > 0
    ? Math.round(parseInt(r.csat_good) / parseInt(r.csat_total) * 100)
    : null;

  // Per-parameter pass rates
  const paramRates: Record<string, { yes: number; total: number }> = {};
  for (const paramObj of (Array.isArray(r?.parameters) ? r.parameters : [])) {
    if (!paramObj) continue;
    const targetObj = paramObj.__agent_parameters || paramObj;
    for (const [rawKey, val] of Object.entries(targetObj as Record<string, any>)) {
      if (rawKey.startsWith('__')) continue;
      const pk = normParam(rawKey);
      if (!PARAM_ORDER.includes(pk)) continue;
      if (!paramRates[pk]) paramRates[pk] = { yes: 0, total: 0 };
      const score = val?.score;
      if (score === true || score === 'Yes' || score === 1 || score === '1') { paramRates[pk].yes++; paramRates[pk].total++; }
      else if (score === 0.5 || score === 'Half') { paramRates[pk].yes += 0.5; paramRates[pk].total++; }
      else if (score === false || score === 'No' || score === 0 || score === '0') { paramRates[pk].total++; }
    }
  }

  const avgIqs = calculateWeightedOverallIQS(paramRates, 'human') ?? (r?.avg_iqs ? Math.round(parseFloat(r.avg_iqs)) : null);

  const context = buildChatContext(agentName, count, avgIqs, csatPct, paramRates, r?.top_disp || '', dateFrom, dateTo);
  const result = await callLLM(apiKey, context, 'chats', count);
  return NextResponse.json(result);
}

function buildChatContext(
  name: string, count: number, avgIqs: number | null, csatPct: number | null,
  paramRates: Record<string, { yes: number; total: number }>,
  topDisp: string, from: string, to: string,
): string {
  const paramLines = PARAM_ORDER
    .map(pk => {
      const d = paramRates[pk];
      if (!d || !d.total) return null;
      const pct = Math.round(d.yes / d.total * 100);
      return `  ${PARAM_NAMES[pk]}: ${pct}% pass rate`;
    })
    .filter(Boolean)
    .join('\n');

  return `Agent: ${name}
Period: ${from} to ${to}
Channel: Chats
Evaluated chats: ${count}
Average IQS: ${avgIqs != null ? avgIqs + '%' : 'N/A'}
CSAT (good): ${csatPct != null ? csatPct + '%' : 'N/A'}
Top disposition: ${topDisp || 'N/A'}

Parameter pass rates:
${paramLines || '  No parameter data available'}`;
}

function buildCallContext(
  name: string, count: number, avgIqs: number | null,
  paramRates: Record<string, { yes: number; total: number }>,
  from: string, to: string,
): string {
  const paramLines = Object.entries(paramRates)
    .map(([pk, d]) => {
      const pct = Math.round(d.yes / d.total * 100);
      return `  ${pk}: ${pct}% pass rate`;
    })
    .join('\n');

  return `Agent: ${name}
Period: ${from} to ${to}
Channel: Calls
Evaluated calls: ${count}
Average Call IQS: ${avgIqs != null ? avgIqs + '%' : 'N/A'}

Parameter pass rates:
${paramLines || '  No parameter data available'}`;
}

async function callLLM(
  apiKey: string, context: string, channel: 'chats' | 'calls', count: number,
): Promise<{ summary: string; items: Array<{ tag: string; text: string }> }> {
  const client = new Anthropic({ apiKey });

  const systemPrompt = `You are a quality coaching assistant at Wint Wealth.
Given an agent's performance stats, produce:
1. One concise summary sentence (plain text, no markdown bold)
2. Exactly 3-4 insight items, each tagged as one of: Strength, Watch, or Tip

Rules:
- Strength: something genuinely above expectations
- Watch: a parameter or pattern needing improvement
- Tip: one specific actionable recommendation
- Keep each item to 1-2 sentences. Be specific to the numbers given.
- Do NOT say "powered by AI" or similar

Respond with ONLY valid JSON in this exact shape:
{
  "summary": "...",
  "items": [
    { "tag": "Strength", "text": "..." },
    { "tag": "Watch", "text": "..." },
    { "tag": "Tip", "text": "..." }
  ]
}`;

  const userMsg = `Here is the agent's performance data:\n\n${context}\n\nProduce coaching insights as JSON.`;

  try {
    const resp = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMsg }],
    });

    const raw = (resp.content[0] as any)?.text || '';
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return { summary: parsed.summary || '', items: parsed.items || [] };
    }
  } catch (err) {
    console.error('[my-analytics/ai] LLM error:', err);
  }

  // Fallback if LLM fails
  return {
    summary: `Analysis based on ${count} evaluated ${channel}.`,
    items: [
      { tag: 'Tip', text: 'Review your parameter scores above to identify areas for improvement.' },
    ],
  };
}
