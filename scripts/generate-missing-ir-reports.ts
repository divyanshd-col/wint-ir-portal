/**
 * Generate missing IR reports for agents who handled chats in a given week
 * but do not have a published scorecard in ir_reports table.
 *
 * Usage:
 *   npx tsx scripts/generate-missing-ir-reports.ts [--week=YYYY-MM-DD] [--force]
 */

import './_load-env';
import { query } from '../lib/cx/db';
import { generateScorecard } from '../lib/scorecard/generator';

// Helper to get Monday of a week
function getMonday(d: Date): string {
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d.setDate(diff));
  return monday.toISOString().split('T')[0];
}

async function main() {
  const args = process.argv.slice(2);
  const weekArg = args.find(a => a.startsWith('--week='))?.split('=')[1];
  const force = args.includes('--force');

  const targetDate = weekArg ? new Date(weekArg) : new Date('2026-08-10');
  if (isNaN(targetDate.getTime())) {
    console.error('Invalid date format for --week. Use YYYY-MM-DD.');
    process.exit(1);
  }

  const weekStart = getMonday(targetDate);
  const weekEnd = new Date(new Date(weekStart).getTime() + 6 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const nextMonday = new Date(new Date(weekStart).getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  console.log(`\n======================================================`);
  console.log(` IR Scorecard Generator for Week: ${weekStart} to ${weekEnd}`);
  console.log(` Force overwrite existing: ${force}`);
  console.log(`======================================================\n`);

  // 1. Fetch all agents who handled chats during this week
  const activeAgents = await query<{ id: number; name: string; chat_count: string }>(
    `SELECT a.id, a.name, count(c.id) as chat_count
     FROM agents a
     JOIN conversations c ON c.agent_id = a.id
     WHERE c.closed_at >= $1::timestamptz
       AND c.closed_at < $2::timestamptz
       AND c.conversation_type IN ('agent', 'hybrid')
     GROUP BY a.id, a.name
     ORDER BY a.name ASC`,
    [weekStart, nextMonday]
  );

  console.log(`Found ${activeAgents.length} agents who handled chats between ${weekStart} and ${weekEnd}.`);

  // 2. Fetch existing published reports
  const existingReports = await query<{ agent_id: number; status: string; generated_at: string }>(
    `SELECT agent_id, status, generated_at
     FROM ir_reports
     WHERE week_start = $1::date`,
    [weekStart]
  );

  const existingMap = new Map(existingReports.map(r => [r.agent_id, r]));

  // 3. Determine which agents need generation
  const agentsToProcess = activeAgents.filter(a => {
    if (force) return true;
    const existing = existingMap.get(a.id);
    return !existing || existing.status !== 'published';
  });

  if (agentsToProcess.length === 0) {
    console.log(`All ${activeAgents.length} active agents already have published IR reports for this week.`);
    process.exit(0);
  }

  console.log(`\nGenerating reports for ${agentsToProcess.length} agents:\n`);
  for (const a of agentsToProcess) {
    const existing = existingMap.get(a.id);
    console.log(`  - [ID ${a.id}] ${a.name} (${a.chat_count} chats) - Status: ${existing?.status || 'missing'}`);
  }
  console.log('\nStarting scorecard generation...\n');

  let successCount = 0;
  let failCount = 0;
  const resultsSummary: Array<{
    name: string;
    chats: number;
    score: number | null;
    below85: number;
    breaches: number;
    status: string;
    error?: string;
  }> = [];

  for (let i = 0; i < agentsToProcess.length; i++) {
    const agent = agentsToProcess[i];
    const reportId = `${agent.id}:${weekStart}`;
    const progress = `[${i + 1}/${agentsToProcess.length}]`;
    process.stdout.write(`${progress} Generating for ${agent.name} (ID: ${agent.id})... `);

    let success = false;
    let errorMsg = '';
    let scorecard: any = null;

    // Retry up to 2 times
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        scorecard = await generateScorecard({
          agentId: agent.id,
          agentName: agent.name,
          weekStart,
          weekEnd
        });

        await query(
          `INSERT INTO ir_reports (id, agent_id, week_start, week_end, status, generated, model_version, error_note)
           VALUES ($1, $2, $3, $4, 'published', $5, 'gemini-3.5-flash', NULL)
           ON CONFLICT (agent_id, week_start)
           DO UPDATE SET status = EXCLUDED.status, generated = EXCLUDED.generated,
                         model_version = EXCLUDED.model_version, error_note = NULL, generated_at = NOW()`,
          [reportId, agent.id, weekStart, weekEnd, JSON.stringify(scorecard)]
        );

        success = true;
        break;
      } catch (err: any) {
        errorMsg = err.message || String(err);
        if (attempt < 2) {
          process.stdout.write(`(retry ${attempt})... `);
          await new Promise(res => setTimeout(res, 3000));
        }
      }
    }

    if (success) {
      successCount++;
      console.log(`✅ SUCCESS (IQS: ${scorecard.numbers.averageScore ?? 'N/A'}%, Chats: ${scorecard.numbers.chatsHandled})`);
      resultsSummary.push({
        name: agent.name,
        chats: scorecard.numbers.chatsHandled,
        score: scorecard.numbers.averageScore,
        below85: scorecard.numbers.below85Count,
        breaches: scorecard.numbers.complianceBreachesCount,
        status: 'published'
      });
    } else {
      failCount++;
      console.log(`❌ FAILED: ${errorMsg}`);
      try {
        await query(
          `INSERT INTO ir_reports (id, agent_id, week_start, week_end, status, generated, model_version, error_note)
           VALUES ($1, $2, $3, $4, 'failed', '{}'::jsonb, 'gemini-3.5-flash', $5)
           ON CONFLICT (agent_id, week_start)
           DO UPDATE SET status = EXCLUDED.status, error_note = EXCLUDED.error_note, generated_at = NOW()`,
          [reportId, agent.id, weekStart, weekEnd, errorMsg]
        );
      } catch (dbErr: any) {
        console.error(`   Failed to record failed status in DB: ${dbErr.message}`);
      }
      resultsSummary.push({
        name: agent.name,
        chats: Number(agent.chat_count),
        score: null,
        below85: 0,
        breaches: 0,
        status: 'failed',
        error: errorMsg
      });
    }

    // Small delay between agents to prevent bursting API limits
    if (i < agentsToProcess.length - 1) {
      await new Promise(res => setTimeout(res, 1000));
    }
  }

  console.log(`\n======================================================`);
  console.log(` Generation Run Complete`);
  console.log(` Successfully Generated: ${successCount}`);
  console.log(` Failed: ${failCount}`);
  console.log(`======================================================\n`);

  console.table(resultsSummary);

  // Final check of total published reports for this week
  const finalCheck = await query<{ count: string }>(
    `SELECT count(*) as count FROM ir_reports WHERE week_start = $1::date AND status = 'published'`,
    [weekStart]
  );
  console.log(`Total Published IR Reports for Week ${weekStart}: ${finalCheck[0].count} of ${activeAgents.length} active agents.`);
}

main().catch(console.error).finally(() => process.exit(0));
