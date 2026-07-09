import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { query } from '@/lib/cx/db';
import { getAgentNamesByTL } from '@/lib/robylon/db';
import { readConfig } from '@/lib/config';
import { geminiGenerate, getIQSGeminiKeys } from '@/lib/gemini';
import { DEFAULT_GEMINI_MODEL } from '@/lib/models';
import { PARAM_DEFS, normKey } from '../route';

function getDateRange(period: string, from?: string | null, to?: string | null) {
  const today = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  if (period === '7')                    return { dateFrom: fmt(new Date(today.getTime() - 6 * 86400_000)), dateTo: fmt(today) };
  if (period === 'custom' && from && to) return { dateFrom: from, dateTo: to };
  return { dateFrom: fmt(new Date(today.getTime() - 29 * 86400_000)), dateTo: fmt(today) };
}

const PASS_RATE_SELECT = `
  p.key AS param_key,
  ROUND(COUNT(*) FILTER (WHERE (p.val->>'score')='true')::numeric
        / NULLIF(COUNT(*) FILTER (WHERE p.val->>'score' IS NOT NULL AND p.val->>'score' NOT IN ('null','')),0)*100,1)::float AS pass_rate
`;

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userAny = session.user as Record<string, string | undefined>;
  const role = userAny.role;
  const email = userAny.email ?? '';
  if (role !== 'tl' && role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const channel = (searchParams.get('channel') ?? 'chats') as 'chats' | 'calls';
  const period  = searchParams.get('period') ?? '30';
  const { dateFrom, dateTo } = getDateRange(period, searchParams.get('from'), searchParams.get('to'));

  // ── Resolve agent ─────────────────────────────────────────────────────────────
  let tlAgentNames: string[];
  if (role === 'tl') {
    const config = await readConfig();
    const configUser = (config.users as any[]).find(u => (u.email || u.username) === email);
    const tlAgentName = configUser?.agentName ?? email;
    tlAgentNames = await getAgentNamesByTL(tlAgentName);
  } else {
    const rows = await query<{ name: string }>(`SELECT name FROM agents WHERE status = 'active'`, []);
    tlAgentNames = rows.map(r => r.name).sort();
  }

  const requestedAgent = searchParams.get('agent');
  if (!requestedAgent || !tlAgentNames.includes(requestedAgent)) {
    return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
  }
  const agentName = requestedAgent;

  // ── Fetch data for prompt ─────────────────────────────────────────────────────
  let stats: { csat_pct: number|null; iqs: number|null; volume: number } = { csat_pct: null, iqs: null, volume: 0 };
  let paramRows: { param_key: string; pass_rate: number|null }[] = [];
  let topCats: { disposition: string; volume: number; iqs: number|null }[] = [];

  if (channel === 'chats') {
    const [statRows, params, cats] = await Promise.all([
      query<{ csat_pct: number|null; iqs: number|null; volume: number }>(`
        SELECT ROUND(COUNT(CASE WHEN c.csat_label='good' THEN 1 END)::numeric
                     / NULLIF(COUNT(CASE WHEN c.csat_label IS NOT NULL THEN 1 END),0)*100,1)::float AS csat_pct,
               ROUND(AVG(s.iqs_score)::numeric,1)::float AS iqs,
               COUNT(c.id)::int AS volume
        FROM conversations c
        JOIN agents a ON a.id = c.agent_id
        LEFT JOIN iqs_scores s ON s.chat_id = c.id
        WHERE c.closed_at::date >= $1 AND c.closed_at::date <= $2 AND a.name = $3
      `, [dateFrom, dateTo, agentName]),

      query<{ param_key: string; pass_rate: number|null }>(`
        SELECT ${PASS_RATE_SELECT}
        FROM iqs_scores s
        JOIN conversations c ON c.id = s.chat_id
        JOIN agents a ON a.id = c.agent_id
        CROSS JOIN LATERAL jsonb_each(
          CASE WHEN s.parameters::text LIKE '{%' THEN s.parameters::jsonb ELSE '{}'::jsonb END
        ) AS p(key, val)
        WHERE c.closed_at::date >= $1 AND c.closed_at::date <= $2
          AND a.name = $3 AND s.parameters IS NOT NULL
        GROUP BY p.key
      `, [dateFrom, dateTo, agentName]),

      query<{ disposition: string; volume: number; iqs: number|null }>(`
        SELECT c.tags->>'disposition' AS disposition,
               COUNT(c.id)::int AS volume,
               ROUND(AVG(s.iqs_score)::numeric,1)::float AS iqs
        FROM conversations c
        JOIN agents a ON a.id = c.agent_id
        LEFT JOIN iqs_scores s ON s.chat_id = c.id
        WHERE c.closed_at::date >= $1 AND c.closed_at::date <= $2
          AND a.name = $3 AND c.tags->>'disposition' IS NOT NULL
        GROUP BY 1 ORDER BY COUNT(c.id) DESC LIMIT 5
      `, [dateFrom, dateTo, agentName]),
    ]);
    stats = statRows[0] ?? stats;
    paramRows = params;
    topCats = cats;
  } else {
    const [statRows, params, cats] = await Promise.all([
      query<{ csat_pct: number|null; iqs: number|null; volume: number }>(`
        SELECT ROUND(COUNT(CASE WHEN c.csat_label='good' THEN 1 END)::numeric
                     / NULLIF(COUNT(CASE WHEN c.csat_label IS NOT NULL THEN 1 END),0)*100,1)::float AS csat_pct,
               ROUND(AVG(s.call_iqs_score)::numeric,1)::float AS iqs,
               COUNT(cr.id)::int AS volume
        FROM call_recordings cr
        LEFT JOIN conversations c ON c.id = cr.chat_id
        LEFT JOIN iqs_scores s ON s.chat_id = cr.chat_id
        JOIN agents a ON a.id = COALESCE(cr.agent_id, c.agent_id)
        WHERE cr.called_at::date >= $1 AND cr.called_at::date <= $2 AND a.name = $3
      `, [dateFrom, dateTo, agentName]),

      query<{ param_key: string; pass_rate: number|null }>(`
        SELECT ${PASS_RATE_SELECT}
        FROM iqs_scores s
        JOIN call_recordings cr ON cr.chat_id = s.chat_id
        LEFT JOIN conversations c ON c.id = cr.chat_id
        JOIN agents a ON a.id = COALESCE(cr.agent_id, c.agent_id)
        CROSS JOIN LATERAL jsonb_each(
          CASE WHEN s.call_parameters::text LIKE '{%' THEN s.call_parameters::jsonb ELSE '{}'::jsonb END
        ) AS p(key, val)
        WHERE cr.called_at::date >= $1 AND cr.called_at::date <= $2
          AND a.name = $3 AND s.call_parameters IS NOT NULL
        GROUP BY p.key
      `, [dateFrom, dateTo, agentName]),

      query<{ disposition: string; volume: number; iqs: number|null }>(`
        SELECT c.tags->>'disposition' AS disposition,
               COUNT(cr.id)::int AS volume,
               ROUND(AVG(s.call_iqs_score)::numeric,1)::float AS iqs
        FROM call_recordings cr
        LEFT JOIN conversations c ON c.id = cr.chat_id
        LEFT JOIN iqs_scores s ON s.chat_id = cr.chat_id
        JOIN agents a ON a.id = COALESCE(cr.agent_id, c.agent_id)
        WHERE cr.called_at::date >= $1 AND cr.called_at::date <= $2
          AND a.name = $3 AND c.tags->>'disposition' IS NOT NULL
        GROUP BY 1 ORDER BY COUNT(cr.id) DESC LIMIT 5
      `, [dateFrom, dateTo, agentName]),
    ]);
    stats = statRows[0] ?? stats;
    paramRows = params;
    topCats = cats;
  }

  // ── Build Gemini prompt ───────────────────────────────────────────────────────
  const paramMap: Record<string, number | null> = {};
  for (const r of paramRows) {
    const k = normKey(r.param_key);
    if (paramMap[k] == null) paramMap[k] = r.pass_rate;
  }

  const paramSummary = PARAM_DEFS
    .map(p => ({ label: p.label, score: paramMap[p.key] }))
    .filter(p => p.score != null)
    .sort((a, b) => (a.score ?? 100) - (b.score ?? 100))
    .map(p => `${p.label}: ${p.score?.toFixed(1)}%`)
    .join(', ');

  const catSummary = topCats
    .map(c => `${c.disposition} (vol: ${c.volume}, IQS: ${c.iqs != null ? c.iqs.toFixed(1) + '%' : 'N/A'})`)
    .join('; ');

  const periodLabel = period === '7' ? 'last 7 days' : period === 'custom' ? `${dateFrom} to ${dateTo}` : 'last 30 days';

  const prompt = `You are a CX quality analyst reviewing an individual agent's performance data. Generate a concise, data-driven analysis.

Agent: ${agentName}
Channel: ${channel}
Period: ${periodLabel}

Performance data:
- CSAT: ${stats.csat_pct != null ? stats.csat_pct.toFixed(1) + '%' : 'N/A'}
- IQS: ${stats.iqs != null ? stats.iqs.toFixed(1) + '%' : 'N/A'}
- Volume: ${stats.volume} ${channel}
- Parameters (sorted weakest first): ${paramSummary || 'No parameter data available'}
- Top categories by volume: ${catSummary || 'No category data available'}

Return ONLY a valid JSON object (no markdown, no extra text) with this exact shape:
{
  "summary": "2-3 sentence paragraph summarising this agent's overall performance for the period, referencing specific numbers",
  "items": [
    { "type": "strength", "text": "one specific strength with the parameter name and percentage" },
    { "type": "watch",    "text": "one area to watch, specific to the data above" },
    { "type": "tip",      "text": "one actionable coaching tip tied to the weakest area" }
  ]
}

Rules:
- Use only the data provided; do not invent numbers
- "type" must be one of: strength, watch, tip
- 3 to 5 items total
- Plain text only in "text" fields — no HTML, no markdown`;

  try {
    const config = await readConfig();
    const keys = getIQSGeminiKeys(config);
    if (!keys.length) return NextResponse.json({ error: 'No Gemini API keys configured' }, { status: 500 });

    const raw = await geminiGenerate(
      keys,
      config.geminiModel || DEFAULT_GEMINI_MODEL,
      [{ role: 'user', parts: [{ text: prompt }] }],
      { config: { responseMimeType: 'application/json', temperature: 0.3 } },
      30_000,
    );

    let parsed: { summary: string; items: Array<{ type: string; text: string }> };
    try {
      const jsonStr = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
      parsed = JSON.parse(jsonStr);
    } catch {
      return NextResponse.json({ error: 'Failed to parse Gemini response', raw }, { status: 500 });
    }

    return NextResponse.json({ summary: parsed.summary ?? '', items: parsed.items ?? [] });
  } catch (err: any) {
    console.error('[member-analytics/ai]', err);
    return NextResponse.json({ error: err.message ?? 'Gemini error' }, { status: 500 });
  }
}
