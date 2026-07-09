import { query } from '@/lib/cx/db';
import { geminiGenerate, getOrderedGeminiKeys } from '@/lib/gemini';
import { readConfig } from '@/lib/config';
import { DEFAULT_GEMINI_MODEL } from '@/lib/models';
import { computeParamFailureRates } from './executor';
import { PARAM_NAMES as PARAM_DISPLAY } from '@/lib/quality';
import type { AnalyticsFilters, InsightBlock } from './types';

// ── Types ─────────────────────────────────────────────────────────────────────

interface CandidateRow {
  id: string;
  disposition: string;
  sub_disposition: string;
  csat_label: string;
  transcript: any;
  iqs_score: number;
  parameters: any;
}

interface Theme {
  name: string;
  description: string;
  indices: number[];
}

// ── DB fetch ──────────────────────────────────────────────────────────────────

function buildThemeFetch(f: AnalyticsFilters): { sql: string; params: any[] } {
  const params: any[] = [
    f.dateFrom + 'T00:00:00Z',
    f.dateTo + 'T23:59:59.999Z',
  ];
  const clauses: string[] = [
    `c.closed_at >= $1::timestamptz`,
    `c.closed_at < $2::timestamptz`,
    `c.csat_label IN ('bad', 'could_be_better')`,
    `c.tags->>'disposition' IS NOT NULL`,
    `c.tags->>'disposition' != ''`,
  ];
  let i = 3;

  if (f.dispositions.length) {
    clauses.push(`c.tags->>'disposition' = ANY($${i++}::text[])`);
    params.push(f.dispositions);
  }
  if (f.subDispositions.length) {
    clauses.push(`c.tags->>'sub_disposition' = ANY($${i++}::text[])`);
    params.push(f.subDispositions);
  }
  if (f.teams.length) {
    clauses.push(`c.team_id = ANY($${i++}::int[])`);
    params.push(f.teams);
  }
  if (f.conversationTypes.length) {
    clauses.push(`c.conversation_type = ANY($${i++}::text[])`);
    params.push(f.conversationTypes);
  }
  if (f.agentIds.length) {
    clauses.push(`c.agent_id = ANY($${i++}::int[])`);
    params.push(f.agentIds);
  }

  return {
    sql: `
      SELECT
        c.id,
        c.tags->>'disposition'     AS disposition,
        c.tags->>'sub_disposition' AS sub_disposition,
        c.csat_label,
        c.transcript,
        s.iqs_score,
        s.parameters
      FROM conversations c
      INNER JOIN iqs_scores s ON s.chat_id = c.id
      WHERE ${clauses.join(' AND ')}
      ORDER BY c.closed_at DESC, c.csat_score ASC
      LIMIT 500
    `,
    params,
  };
}

// ── Transcript text extraction ─────────────────────────────────────────────────

function extractTranscriptText(transcript: any): string {
  let msgs: any[] = [];
  if (Array.isArray(transcript)) {
    msgs = transcript;
  } else if (Array.isArray(transcript?.messages)) {
    msgs = transcript.messages;
  }
  return msgs
    .filter(m => m?.content)
    .map(m => {
      const sender = m.sender_type === 'customer' ? 'Customer' : 'Agent';
      return `${sender}: ${m.content}`;
    })
    .slice(0, 30) // cap at 30 messages for context window
    .join('\n');
}

// ── Batch summarization ────────────────────────────────────────────────────────

async function summarizeBatch(
  rows: CandidateRow[],
  keys: string[],
): Promise<string[]> {
  const convBlocks = rows.map((r, idx) => {
    const text = extractTranscriptText(r.transcript);
    return `--- Conversation ${idx + 1} (CSAT: ${r.csat_label}, Disposition: ${r.disposition}) ---\n${text || '(no transcript)'}`;
  });

  const prompt = `You have ${rows.length} customer service conversations with bad or could-be-better CSAT ratings.
For each conversation, write exactly 1-2 sentences explaining WHY the customer was dissatisfied.
Respond ONLY as a JSON array of ${rows.length} strings, one per conversation, in order.
Example: ["Agent gave incorrect TDS rate, leading to wrong expectations.", "Customer did not receive funds within promised T+2 timeline."]

${convBlocks.join('\n\n')}`;

  const raw = await geminiGenerate(
    keys,
    DEFAULT_GEMINI_MODEL,
    [{ role: 'user', parts: [{ text: prompt }] }],
    {},
    18_000,
  );

  const cleaned = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    const arr = JSON.parse(cleaned);
    if (Array.isArray(arr) && arr.length === rows.length) return arr;
  } catch {}

  // Fallback: extract per-line if JSON parse fails
  return rows.map(() => 'Reason not extracted.');
}

// ── Theme clustering ───────────────────────────────────────────────────────────

async function clusterThemes(
  summaries: string[],
  keys: string[],
): Promise<Theme[]> {
  const numbered = summaries.map((s, i) => `${i}: ${s}`).join('\n');

  const prompt = `You have ${summaries.length} one-sentence customer complaint summaries from a CX team.
Cluster them into at most 7 themes. Merge any cluster with fewer than 3 members into a theme called "Other Issues".

Respond ONLY as valid JSON with this exact shape:
{"themes":[{"name":"3-6 word label","description":"1 sentence","indices":[0,1,2,...]}]}

Summaries:
${numbered}`;

  const raw = await geminiGenerate(
    keys,
    DEFAULT_GEMINI_MODEL,
    [{ role: 'user', parts: [{ text: prompt }] }],
    {},
    20_000,
  );

  const cleaned = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed.themes)) {
      return parsed.themes.filter(
        (t: any) => t.name && t.description && Array.isArray(t.indices),
      );
    }
  } catch {}

  // Fallback: single theme with all
  return [{ name: 'Customer Issues', description: 'Unable to cluster themes automatically.', indices: summaries.map((_, i) => i) }];
}

// ── Main export ────────────────────────────────────────────────────────────────

export async function extractThemes(filters: AnalyticsFilters): Promise<InsightBlock[]> {
  // Fetch candidates
  const { sql, params } = buildThemeFetch(filters);
  const rows = await query<CandidateRow>(sql, params);

  if (rows.length < 5) {
    return [{
      type: 'insight',
      text: `Not enough data for reliable insight (${rows.length} conversation${rows.length !== 1 ? 's' : ''} matched; need at least 5).`,
      severity: 'info',
    }];
  }

  const config = await readConfig();
  const keys = getOrderedGeminiKeys(config);
  if (!keys.length) {
    return [{ type: 'insight', text: 'No LLM API key configured for theme extraction.', severity: 'warning' }];
  }

  // Cap warning
  const cappedAt500 = rows.length >= 500;

  // Batch summarize — max 3 concurrent batches of 10
  const BATCH_SIZE = 10;
  const batches: CandidateRow[][] = [];
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    batches.push(rows.slice(i, i + BATCH_SIZE));
  }

  const summaries: string[] = new Array(rows.length).fill('');
  for (let i = 0; i < batches.length; i += 3) {
    const slice = batches.slice(i, i + 3);
    const results = await Promise.all(slice.map(b => summarizeBatch(b, keys).catch(() => b.map(() => 'Reason not extracted.'))));
    results.forEach((batchSummaries, bi) => {
      const baseIdx = (i + bi) * BATCH_SIZE;
      batchSummaries.forEach((s, j) => { summaries[baseIdx + j] = s; });
    });
  }

  // Cluster into themes
  const themes = await clusterThemes(summaries, keys);

  // IQS enrichment per theme
  const blocks: InsightBlock[] = [];

  // Header stat_row
  const cbbCount = rows.filter(r => r.csat_label === 'could_be_better').length;
  const badCount = rows.filter(r => r.csat_label === 'bad').length;
  blocks.push({
    type: 'stat_row',
    stats: [
      { label: 'Conversations Analysed', value: String(rows.length) },
      { label: 'Bad CSAT', value: String(badCount), color: badCount > 0 ? 'red' : undefined },
      { label: 'Could Be Better', value: String(cbbCount), color: cbbCount > 0 ? 'orange' : undefined },
      { label: 'Themes Found', value: String(themes.length) },
    ],
  });

  if (cappedAt500) {
    blocks.push({
      type: 'insight',
      text: 'Showing 500 of more conversations, most recent bad-CSAT first.',
      severity: 'info',
    });
  }

  // Theme cards
  for (const theme of themes) {
    const themeRows = theme.indices.map(idx => rows[idx]).filter(Boolean);
    const paramRates = computeParamFailureRates(themeRows.map(r => ({ parameters: r.parameters })));
    const topParams = paramRates
      .slice(0, 2)
      .map(r => PARAM_DISPLAY[r.param] ?? r.displayName);

    blocks.push({
      type: 'theme_card',
      name: theme.name,
      description: theme.description,
      count: themeRows.length,
      pct: Math.round((themeRows.length / rows.length) * 100),
      topParams,
      examplesAvailable: false,
    });
  }

  return blocks;
}
