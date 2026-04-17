import { query } from './db';

export interface CxBenchmark {
  qa: number | null;
  csat: number | null;
  volume: number | null;
}

/**
 * CX benchmark for a given week:
 * Mean across active agents who had ≥1 ticket that week.
 * Three separate averages — not a composite.
 */
export async function getCxBenchmark(weekStart: string): Promise<CxBenchmark> {
  const sql = `
    WITH active_with_tickets AS (
      SELECT DISTINCT t.agent_id
      FROM cx_tickets t
      JOIN cx_agents a ON a.agent_id = t.agent_id
      WHERE t.week_start = $1 AND a.status = 'active'
    ),
    qa_scores AS (
      SELECT DISTINCT ON (qa.agent_id, qa.week_start)
        qa.agent_id, qa.score
      FROM cx_qa_audits qa
      JOIN active_with_tickets awt ON awt.agent_id = qa.agent_id
      WHERE qa.week_start = $1
      ORDER BY qa.agent_id, qa.week_start, qa.audited_at DESC
    ),
    csat_scores AS (
      SELECT c.agent_id, AVG(c.rating) AS csat_avg
      FROM cx_csat_responses c
      JOIN active_with_tickets awt ON awt.agent_id = c.agent_id
      WHERE c.week_start = $1
      GROUP BY c.agent_id
    ),
    volume_scores AS (
      SELECT t.agent_id, COUNT(t.ticket_id)::FLOAT AS vol
      FROM cx_tickets t
      JOIN active_with_tickets awt ON awt.agent_id = t.agent_id
      WHERE t.week_start = $1
      GROUP BY t.agent_id
    )
    SELECT
      AVG(qs.score)       AS qa_avg,
      AVG(cs.csat_avg)    AS csat_avg,
      AVG(vs.vol)         AS vol_avg
    FROM active_with_tickets awt
    LEFT JOIN qa_scores    qs ON qs.agent_id = awt.agent_id
    LEFT JOIN csat_scores  cs ON cs.agent_id = awt.agent_id
    LEFT JOIN volume_scores vs ON vs.agent_id = awt.agent_id
  `;
  const rows = await query<{ qa_avg: string; csat_avg: string; vol_avg: string }>(sql, [weekStart]);
  const r = rows[0];
  return {
    qa:     r?.qa_avg   != null ? parseFloat(r.qa_avg)   : null,
    csat:   r?.csat_avg != null ? parseFloat(r.csat_avg) : null,
    volume: r?.vol_avg  != null ? parseFloat(r.vol_avg)  : null,
  };
}
