import { query } from './db';

export interface AgentComposite {
  agentId: string;
  composite: number;
  rank: number;
  metricsUsed: string[];
  qa: number | null;
  csat: number | null;
  volume: number | null;
}

export async function getCompositeRankings(weekStart: string): Promise<AgentComposite[]> {
  // Get all active agents' metrics for this week
  const sql = `
    WITH active_agents AS (
      SELECT a.agent_id
      FROM cx_agents a
      WHERE a.status = 'active'
    ),
    qa_scores AS (
      SELECT DISTINCT ON (qa.agent_id, qa.week_start)
        qa.agent_id, qa.score AS qa_score
      FROM cx_qa_audits qa
      JOIN active_agents aa ON aa.agent_id = qa.agent_id
      WHERE qa.week_start = $1
      ORDER BY qa.agent_id, qa.week_start, qa.audited_at DESC
    ),
    csat_scores AS (
      SELECT c.agent_id, AVG(c.rating) AS csat_avg
      FROM cx_csat_responses c
      JOIN active_agents aa ON aa.agent_id = c.agent_id
      WHERE c.week_start = $1
      GROUP BY c.agent_id
    ),
    volume_scores AS (
      SELECT t.agent_id, COUNT(t.ticket_id)::FLOAT AS vol
      FROM cx_tickets t
      JOIN active_agents aa ON aa.agent_id = t.agent_id
      WHERE t.week_start = $1
      GROUP BY t.agent_id
    )
    SELECT
      aa.agent_id,
      qs.qa_score,
      cs.csat_avg,
      COALESCE(vs.vol, 0) AS volume
    FROM active_agents aa
    LEFT JOIN qa_scores    qs ON qs.agent_id = aa.agent_id
    LEFT JOIN csat_scores  cs ON cs.agent_id = aa.agent_id
    LEFT JOIN volume_scores vs ON vs.agent_id = aa.agent_id
  `;

  const rows = await query<{
    agent_id: string;
    qa_score: string | null;
    csat_avg: string | null;
    volume: string;
  }>(sql, [weekStart]);

  if (!rows.length) return [];

  // Parse values
  const agents = rows.map(r => ({
    agentId: r.agent_id,
    qa:      r.qa_score != null ? parseFloat(r.qa_score) : null,
    csat:    r.csat_avg != null ? parseFloat(r.csat_avg) : null,
    volume:  parseFloat(r.volume),
  }));

  // Compute min/max per metric for normalization
  const qaValues     = agents.map(a => a.qa).filter((v): v is number => v !== null);
  const csatValues   = agents.map(a => a.csat).filter((v): v is number => v !== null);
  const volumeValues = agents.map(a => a.volume);

  const minMax = (arr: number[]) => arr.length ? { min: Math.min(...arr), max: Math.max(...arr) } : null;
  const qaMM   = minMax(qaValues);
  const csatMM = minMax(csatValues);
  const volMM  = minMax(volumeValues);

  const norm = (val: number | null, mm: { min: number; max: number } | null): number | null => {
    if (val === null || !mm) return null;
    if (mm.max === mm.min) return 0.5; // all same → neutral
    return (val - mm.min) / (mm.max - mm.min);
  };

  const results: AgentComposite[] = agents.map(a => {
    const nQa   = norm(a.qa, qaMM);
    const nCsat = norm(a.csat, csatMM);
    const nVol  = norm(a.volume, volMM);

    const available = [
      nQa   !== null ? { key: 'qa',     val: nQa }   : null,
      nCsat !== null ? { key: 'csat',   val: nCsat } : null,
      nVol  !== null ? { key: 'volume', val: nVol }  : null,
    ].filter(Boolean) as { key: string; val: number }[];

    if (!available.length) {
      return { agentId: a.agentId, composite: -1, rank: 0, metricsUsed: [], qa: a.qa, csat: a.csat, volume: a.volume };
    }

    const weight = 1 / available.length;
    const composite = available.reduce((sum, m) => sum + m.val * weight, 0);
    return {
      agentId: a.agentId,
      composite: parseFloat(composite.toFixed(4)),
      rank: 0,
      metricsUsed: available.map(m => m.key),
      qa: a.qa,
      csat: a.csat,
      volume: a.volume,
    };
  }).filter(a => a.composite >= 0); // exclude agents where all metrics are null

  // Sort descending and assign ranks
  results.sort((a, b) => b.composite - a.composite);
  results.forEach((r, i) => { r.rank = i + 1; });

  return results;
}
