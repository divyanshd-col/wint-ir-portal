import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';

// ── Load .env.local ──────────────────────────────────────────────────────────
const envPath = path.resolve('./.env.local');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const match = line.match(/^\s*([^#=]+)\s*=\s*(.*)$/);
    if (match) {
      let val = match[2].trim();
      if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
      if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
      process.env[match[1].trim()] = val;
    }
  });
}

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL,
  ssl: false
});

// Known agent parameter keys in snake_case / camelCase / PascalCase
const AGENT_PARAM_KEYS = new Set([
  'accuracy', 'issue_resolution', 'expectationfollowthrough', 'dissatisfactionhandling',
  'personalization', 'empathy', 'escalationdecision', 'readability', 'greetinghandover',
  'postcallrecap', 'technical', 'all_questions', 'expectation', 'contextual',
  'follow_up', 'sentences', 'process', 'opening', 'call', 'grammar',
  'Technical', 'AllQuestions', 'Expectation', 'DissatisfactionHandling', 'Contextual',
  'FollowUp', 'Sentences', 'Process', 'Opening', 'Call', 'Grammar', 'Empathy',
  'IssueResolution', 'Accuracy', 'ExpectationFollowThrough', 'Personalization', 'GreetingHandover', 'PostCallRecap'
]);

async function main() {
  const isDryRun = process.argv.includes('--dry-run');

  console.log('--- RESTRUCTURING V4 EVALUATED PARAMETERS IN DATABASE ---');
  if (isDryRun) {
    console.log('👉 [DRY RUN MODE] No changes will be written to PostgreSQL.\n');
  } else {
    console.log('🚀 [LIVE MODE] Updating database rows in PostgreSQL...\n');
  }

  // Query all v4 evaluated rows
  const querySql = `
    SELECT chat_id, parameters, model_version, iqs_score 
    FROM iqs_scores 
    WHERE (model_version LIKE '%flash%' OR model_version LIKE '%v4%' OR parameters::text LIKE '%dissatisfactionhandling%' OR parameters::text LIKE '%__agent_parameters%')
    ORDER BY scored_at DESC
  `;

  const { rows } = await pool.query(querySql);
  console.log(`- Found ${rows.length} v4 evaluation rows in iqs_scores.\n`);

  let updatedCount = 0;
  let skippedCount = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const chatId = row.chat_id;
    let params = row.parameters;

    if (typeof params === 'string') {
      try {
        params = JSON.parse(params);
      } catch (err) {
        console.error(`⚠️  Chat ${chatId}: Invalid JSON string in parameters. Skipping.`);
        skippedCount++;
        continue;
      }
    }

    if (!params || typeof params !== 'object') {
      skippedCount++;
      continue;
    }

    // Extract agent parameters
    const agentParams = params.__agent_parameters ? { ...params.__agent_parameters } : {};

    for (const [key, val] of Object.entries(params)) {
      if (!key.startsWith('__')) {
        agentParams[key] = val;
      }
    }

    // Attach __agent_parameters
    const newParams = {
      ...params,
      __agent_parameters: agentParams,
    };

    // Determine scores object if missing
    if (!newParams.__scores && row.iqs_score != null) {
      newParams.__scores = {
        agent_iqs: row.iqs_score,
        bot_iqs: params.__bot_parameters ? (params.__scores?.bot_iqs ?? 100) : null,
      };
    }

    if (!isDryRun) {
      await pool.query(
        'UPDATE iqs_scores SET parameters = $1 WHERE chat_id = $2',
        [JSON.stringify(newParams), chatId]
      );
    }

    updatedCount++;
    if (updatedCount % 500 === 0 || updatedCount === rows.length) {
      console.log(`  Progress: ${updatedCount} / ${rows.length} chats processed...`);
    }
  }

  console.log('\n--- RESTRUCTURING COMPLETE ---');
  console.log(`- Total v4 rows scanned : ${rows.length}`);
  console.log(`- Total rows restructured: ${updatedCount}`);
  console.log(`- Total rows skipped     : ${skippedCount}`);
  if (isDryRun) {
    console.log('\n💡 Run without --dry-run to apply changes to the live database.');
  }

  await pool.end();
}

main().catch(err => {
  console.error('Fatal error:', err);
  pool.end();
  process.exit(1);
});
