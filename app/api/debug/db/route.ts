const ROUTE = 'debug/db';
import { log, withLogging } from '@/lib/log';
import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-guard';
import { DB_KEY_TO_LEGACY } from '@/lib/param-keys';

async function _GET() {
  // const { session, response } = await requireRole('admin');
  // if (response) return response;

  const result: Record<string, any> = {
    env: {
      POSTGRES_URL:             !!process.env.POSTGRES_URL,
      POSTGRES_URL_NON_POOLING: !!process.env.POSTGRES_URL_NON_POOLING,
      url_prefix: (process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL || '').slice(0, 30) || '(not set)',
    },
    table_counts: null as any,
    agent_columns: null as any,
    raw_sample: null as any,
    quality_test: null as any,
    errors: [] as string[],
  };

  try {
    const { query } = await import('@/lib/cx/db');

    // Row counts
    const [counts] = await query(`
      SELECT
        (SELECT COUNT(*) FROM conversations) AS conversations,
        (SELECT COUNT(*) FROM iqs_scores)    AS iqs_scores,
        (SELECT COUNT(*) FROM agents)        AS agents
    `);
    result.table_counts = counts;

    // Agent columns
    const cols = await query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'agents' ORDER BY ordinal_position
    `);
    result.agent_columns = cols.map((r: any) => r.column_name);

    // Raw sample — exactly what getAllScoredConversations returns
    const sample = await query(`
      SELECT
        c.id                  AS "chatId",
        c.started_at::date    AS "date",
        c.conversation_type   AS "conversationType",
        c.frt_seconds         AS "frt",
        c.bot_to_team_seconds AS "botToTeamSecs",
        c.resolution_seconds  AS "resolutionTime",
        c.csat_score,
        c.csat_label,
        c.tags,
        a.name                AS "agentName",
        s.iqs_score           AS "iqs",
        s.parameters,
        s.model_version       AS "modelVersion",
        s.scored_at           AS "scoredAt"
      FROM conversations c
      JOIN iqs_scores s ON s.chat_id = c.id
      LEFT JOIN agents a ON a.id = c.agent_id
      ORDER BY s.scored_at DESC
      LIMIT 3
    `);
    result.raw_sample = sample.map((r: any) => ({
      chatId:       r.chatId,
      iqs:          r.iqs,
      iqs_type:     typeof r.iqs,
      date:         r.date,
      date_type:    typeof r.date,
      agentName:    r.agentName,
      scoredAt:     r.scoredAt,
      parameters_keys: r.parameters ? Object.keys(r.parameters) : null,
      first_param_val: r.parameters ? JSON.stringify(Object.values(r.parameters)[0]).slice(0, 80) : null,
    }));

    // Test getAllScoredConversations (the actual quality pipeline function)
    const { getAllScoredConversations } = await import('@/lib/robylon/db');
    let qualityRows: any[] = [];
    let qualityError: string | null = null;
    try {
      qualityRows = (await getAllScoredConversations({ limit: 5 })).rows;
    } catch (e: any) {
      qualityError = e?.message;
    }
    result.quality_pipeline = {
      getAllScoredConversations_count: qualityRows.length,
      getAllScoredConversations_error: qualityError,
      first_row_keys: qualityRows[0] ? Object.keys(qualityRows[0]) : null,
      first_row_iqs: qualityRows[0]?.iqs,
      first_row_iqs_type: qualityRows[0] ? typeof qualityRows[0].iqs : null,
    };



    result.quality_test = sample.map((row: any, i: number) => {
      try {
        const params = row.parameters || {};
        const scores: Record<string, string> = {};
        for (const [key, val] of Object.entries(params) as [string, any][]) {
          const k = DB_KEY_TO_LEGACY[key] ?? (key.charAt(0).toUpperCase() + key.slice(1));
          scores[k] = val?.score === true ? 'Yes' : val?.score === false ? 'No' : 'NA';
        }
        const iqsNum = row.iqs;
        const passes_filter = iqsNum >= 0 && iqsNum <= 100;
        return {
          row_index: i,
          ok: true,
          iqs: iqsNum,
          iqs_passes_filter: passes_filter,
          score_keys: Object.keys(scores),
        };
      } catch (e: any) {
        return { row_index: i, ok: false, error: e?.message };
      }
    });
  } catch (err: any) {
    result.errors.push(err?.message ?? String(err));
  }

  // Full quality pipeline simulation
  try {
    const { getAllScoredConversations } = await import('@/lib/robylon/db');
    const allRows = (await getAllScoredConversations({ limit: 2000 })).rows;

    let parsed = 0, failed = 0, nullIqs = 0, passFilter = 0;
    const agentNames = new Set<string>();

    for (const row of allRows) {
      try {
        const params = row.parameters || {};
        const scores: Record<string, string> = {};
        for (const [key, val] of Object.entries(params) as [string, any][]) {
          scores[key] = val?.score === true ? 'Yes' : val?.score === false ? 'No' : 'NA';
        }
        const entry = {
          iqs: row.iqs,
          agentName: row.agentName || '',
          scoredAt: row.scoredAt,
          scores,
        };
        parsed++;
        if (entry.iqs == null) { nullIqs++; continue; }
        if (entry.iqs >= 0 && entry.iqs <= 100) {
          passFilter++;
          agentNames.add(entry.agentName || 'Unknown');
        }
      } catch { failed++; }
    }

    result.full_pipeline_sim = {
      total_rows: allRows.length,
      parsed_ok: parsed,
      parse_failed: failed,
      null_iqs: nullIqs,
      pass_0_100_filter: passFilter,
      distinct_agents: agentNames.size,
      agent_names: [...agentNames].slice(0, 10),
    };
  } catch (e: any) {
    result.full_pipeline_sim = { error: e?.message };
  }

  return NextResponse.json(result);
}

export const GET = withLogging(ROUTE, _GET);
