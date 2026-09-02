import pg from 'pg';
import { readFileSync } from 'fs';

try {
  const env = readFileSync('.env.local', 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim().replace(/^"|"$/g, '');
  }
} catch (e) {}

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL,
  ssl: { rejectUnauthorized: false },
});

const rawList = [
  'Priya Singh',
  'Vignesh',
  'Divyansh',
  'Jai Krushnna',
  'Aachal',
  'Arik',
  'Ahaan (Founder\'s Office)',
  'Sridhar',
  'Vikrant',
  'Priyanka',
  'Arjun',
  'Anna',
  'Ishwarya',
  'Nihal',
  'Prakalp',
  'Purvi',
  'Tanisha',
  'Saiyam',
  'Shubhangini',
  'Shayari',
  'Swetha',
  'Gajal',
  'Prisha',
  'Varnika',
  'Amrita',
  'Nandini Jain',
  'Bismita',
  'Yogesh',
  'Varshini',
  'Sravanti',
  'Dheeraj',
  'Anushka',
  'Nishant',
  'Sahil Joshi',
  'Saksham',
  'Prakruti',
  'Saurabh (Marketing)',
  'Anjana',
  'Harsh Soni',
  'Sejal',
  'Jatin',
  'Sakshi',
  'Kanika Bhatter',
  'Pranav Sharma',
  'Kashika',
  'Srishti',
  'Mukund Agarwal',
  'Rachit Tiwari',
  'Kashvi Mehta',
  'Vidhi Kansal'
];

async function run() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Specific agent IDs to mark inactive
    const specificAgentIds = [
      402, // Divyansh
      54,  // Vikrant
      93,  // Arjun
      55,  // Purvi
      883, // Shubhangini
      45,  // Shayari
      31,  // Gajal K.
      29,  // Nandini
      33,  // Bismita
      38,  // Varshini
      5,   // Anushka Chowdhary
      885, // Anushka choudhary
      32,  // Sahil Joshi
      22,  // Saksham
      28,  // Anjana
      11,  // Harsh Soni
      12,  // Jatin Dulhani
      23,  // Sakshi
      13,  // Kanika
      19,  // Pranav
      14,  // Kashika
      25,  // Srishti
      819, // Aishwarya Gupta
      851  // Kashvi Sethi
    ];

    const agentRes = await client.query(
      `UPDATE agents SET status = 'inactive' WHERE id = ANY($1::int[]) RETURNING id, name, status`,
      [specificAgentIds]
    );
    console.log(`Updated ${agentRes.rowCount} existing agents to inactive:`, agentRes.rows.map(r => `${r.name} (#${r.id})`));

    // 2. Insert or update all names from list into agents table as inactive
    const namesToUpsert = new Set();
    for (const raw of rawList) {
      namesToUpsert.add(raw);
      const clean = raw.replace(/\s*\(.*?\)\s*/g, '').trim();
      if (clean && clean !== raw) {
        namesToUpsert.add(clean);
      }
    }

    for (const name of namesToUpsert) {
      await client.query(
        `INSERT INTO agents (name, status) VALUES ($1, 'inactive')
         ON CONFLICT (name) DO UPDATE SET status = 'inactive'`,
        [name]
      );
    }
    console.log(`Upserted ${namesToUpsert.size} names into agents table with status='inactive'.`);

    // 3. Update matching users to 'disabled'
    const specificUserIds = [
      1066, // vignesh
      1000, // Divyansh
      1054, // Vikrant
      1084, // Aishwarya Gupta
      1065, // Nihal
      1075, // Nihal K.
      1038, // Purvi
      1002, // Shubhangini
      1052, // Shayari
      1034, // Swetha
      1008, // Gajal K.
      1009, // Nandini
      1033, // Bismita
      1051, // Varshini
      1032, // Anushka Bagul
      1088, // Anushka Chowdhary
      1013, // Sahil Joshi
      1028, // Saksham
      1022, // Anjana
      1025, // Harsh Soni
      1056, // Jatin Dulhani
      1023, // Sakshi
      1003, // Kanika
      1018, // Pranav
      1016, // Srishti
      1093  // Kashvi Sethi
    ];

    const userRes = await client.query(
      `UPDATE users SET status = 'disabled', status_changed_at = NOW(), status_changed_by = 'admin' WHERE user_id = ANY($1::int[]) RETURNING user_id, name, email, status`,
      [specificUserIds]
    );
    console.log(`Updated ${userRes.rowCount} users to disabled:`, userRes.rows.map(r => `${r.name} <${r.email}>`));

    // Audit log
    for (const u of userRes.rows) {
      await client.query(
        `INSERT INTO identity_audit (actor_email, action, target_email, detail) VALUES ('admin', 'status_change', $1, $2)`,
        [u.email, JSON.stringify({ to: 'disabled', reason: 'Marked inactive as requested' })]
      );
    }

    // 4. Update cx_agents to inactive
    const cxRes = await client.query(`
      UPDATE cx_agents
      SET status = 'inactive'
      WHERE user_id IN (
        SELECT user_id FROM cx_users
        WHERE name ILIKE ANY(ARRAY['%Priya%', '%Vikrant%', '%Purvi%', '%Shubhangini%', '%Shayari%', '%Gajal%', '%Nandini%', '%Bismita%', '%Varshini%', '%Anushka%', '%Sahil%', '%Saksham%', '%Anjana%', '%Harsh Soni%', '%Jatin%', '%Sakshi%', '%Kanika%', '%Pranav%', '%Kashika%', '%Srishti%', '%Kashvi%'])
      )
      RETURNING agent_id, status
    `);
    console.log(`Updated ${cxRes.rowCount} cx_agents to inactive.`);

    await client.query('COMMIT');
    console.log('✅ Successfully committed all updates!');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('❌ Error during execution:', e);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
