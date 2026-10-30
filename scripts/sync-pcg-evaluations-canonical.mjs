import { readFileSync } from 'fs';
import pg from 'pg';
const { Pool } = pg;

for (const line of readFileSync('.env', 'utf-8').split('\n')) {
  const m = line.match(/^([^#=\s]+)\s*=\s*"?(.+?)"?\s*$/);
  if (m) process.env[m[1]] = m[2];
}

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL,
  ssl: { rejectUnauthorized: false },
});

const RM_CANONICAL_MAP = {
  'samskriti rao': 'Samskrithi Rao N',
  'samskriti': 'Samskrithi Rao N',
  'samskrithi rao': 'Samskrithi Rao N',
  'samskrithi rao n': 'Samskrithi Rao N',
  'kriya maniyar': 'Maniyar Kriya Jignesh',
  'maniyar kriya jignesh': 'Maniyar Kriya Jignesh',
  'kriya': 'Maniyar Kriya Jignesh',
  'antara chakrabarty': 'Antara Chakraborty',
  'antara chakraborty': 'Antara Chakraborty',
  'antara': 'Antara Chakraborty',
  'vishal yadav': 'Vishal Kumar Yadav',
  'vishal kumar yadav': 'Vishal Kumar Yadav',
  'shruti': 'Shruti Sharma',
  'shruti sharma': 'Shruti Sharma',
  'nandani': 'Nandini',
  'nandini': 'Nandini',
  'vaishnavi': 'Vaishnavi N J',
  'vaishnavi n j': 'Vaishnavi N J',
  'vaishnavi naghat': 'Vaishnavi Naghat',
  'richa mishra': 'Mishra Richa Santoshkumar',
  'shreya mundada': 'Shreya Premkumar Mundada',
};

function canonicalize(name) {
  if (!name || !name.trim()) return 'Unknown RM';
  const clean = name.trim().toLowerCase();
  return RM_CANONICAL_MAP[clean] || name.trim();
}

async function main() {
  console.log('--- Syncing pcg_call_evaluations with canonical RM & TL names ---');
  const config = JSON.parse(readFileSync('portal-config.json', 'utf-8'));
  const teamAssignments = config.pcgTeamAssignments || {};

  const evals = await pool.query(`
    SELECT e.call_id, e.rm_name as eval_rm, r.called_by as rec_called_by, e.tl_name
    FROM pcg_call_evaluations e
    LEFT JOIN pcg_call_recordings r ON e.call_id = r.call_id
  `);

  let updatedCount = 0;
  for (const row of evals.rows) {
    const rawCaller = (row.rec_called_by && row.rec_called_by.trim() && row.rec_called_by !== 'Unknown')
      ? row.rec_called_by.trim()
      : (row.eval_rm || 'Unknown RM');
    const targetRm = canonicalize(rawCaller);

    // Determine target TL from teamAssignments
    const cleanLower = targetRm.toLowerCase().trim();
    const assignedTl = teamAssignments[cleanLower]
      || teamAssignments[rawCaller.toLowerCase().trim()]
      || 'Swetha';

    const targetTl = `Team ${assignedTl}`;

    if (row.eval_rm !== targetRm || row.tl_name !== targetTl) {
      await pool.query(
        "UPDATE pcg_call_evaluations SET rm_name = $1, tl_name = $2, updated_at = NOW() WHERE call_id = $3",
        [targetRm, targetTl, row.call_id]
      );
      updatedCount++;
    }
  }

  console.log(`✓ Updated ${updatedCount} evaluation records in pcg_call_evaluations to canonical RM & TL!`);

  // Verify Samskriti
  const samskCheck = await pool.query(`
    SELECT rm_name, tl_name, COUNT(*) as cnt, COUNT(iqs_score) as with_score, ROUND(AVG(iqs_score), 1) as avg_iqs
    FROM pcg_call_evaluations
    WHERE rm_name ILIKE '%samsk%'
    GROUP BY rm_name, tl_name
  `);
  console.log('Samskrithi Rao evaluations now in DB:', samskCheck.rows);

  await pool.end();
}
main().catch(console.error);
