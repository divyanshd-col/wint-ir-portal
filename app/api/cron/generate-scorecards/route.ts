import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/cx/db';
import { generateScorecard } from '@/lib/scorecard/generator';
import { sendSlackMessage } from '@/lib/slack';

// Helper to get the Monday date for a given Date
function getMonday(d: Date): string {
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d.setDate(diff));
  return monday.toISOString().split('T')[0];
}

export const maxDuration = 300; // 5 minutes max duration on Vercel Pro
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  // 1. Authorisation check using CRON_SECRET if present
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get('authorization') || '';
    const { searchParams } = new URL(req.url);
    if (auth !== `Bearer ${cronSecret}` && searchParams.get('secret') !== cronSecret) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }
  }

  // 2. Parse query parameters
  const { searchParams } = new URL(req.url);
  const agentParam = searchParams.get('agent'); // e.g. ?agent=Ashwitha
  const weekParam = searchParams.get('week');   // e.g. ?week=2026-08-03

  // Determine week range
  let targetDate = new Date();
  if (weekParam) {
    targetDate = new Date(weekParam);
    if (isNaN(targetDate.getTime())) {
      return NextResponse.json({ error: 'Invalid week date format. Use YYYY-MM-DD.' }, { status: 400 });
    }
  } else {
    // Default to last completed week: subtract 7 days from today
    targetDate.setDate(targetDate.getDate() - 7);
  }

  const weekStart = getMonday(targetDate);
  const weekEnd = new Date(new Date(weekStart).getTime() + 6 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const nextMonday = new Date(new Date(weekStart).getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  // 3. Determine scope of agents
  let targetAgents: Array<{ id: number; name: string }> = [];

  if (agentParam) {
    const matched = await query<any>(
      `SELECT id, name FROM agents WHERE LOWER(name) = LOWER($1)`,
      [agentParam.trim()]
    );
    if (matched.length === 0) {
      return NextResponse.json({ error: `Agent "${agentParam}" not found.` }, { status: 404 });
    }
    targetAgents = [{ id: matched[0].id, name: matched[0].name }];
  } else {
    // Generate for all agents who handled at least one chat during the week
    targetAgents = await query<any>(
      `SELECT DISTINCT a.id, a.name 
       FROM agents a 
       JOIN conversations c ON c.agent_id = a.id 
       WHERE c.closed_at >= $1::timestamptz 
         AND c.closed_at < $2::timestamptz
         AND c.conversation_type IN ('agent', 'hybrid')`,
      [weekStart, nextMonday]
    );
  }

  // Fetch all agents to check who had no chats
  const allAgents = await query<any>(`SELECT id, name FROM agents`);
  const activeAgentIds = new Set(targetAgents.map(a => a.id));
  const noChatsAgents = allAgents
    .filter(a => !activeAgentIds.has(a.id))
    .map(a => a.name);

  // 4. Concurrent batch generation loop (batch size: 4)
  let generatedCount = 0;
  let failedCount = 0;
  const failures: Array<{ name: string; reason: string }> = [];

  const BATCH_SIZE = 4;
  for (let i = 0; i < targetAgents.length; i += BATCH_SIZE) {
    const batch = targetAgents.slice(i, i + BATCH_SIZE);

    await Promise.all(
      batch.map(async (agent) => {
        let success = false;
        let errorMsg = '';
        const reportId = `${agent.id}:${weekStart}`;

        // Retry once on failure as per spec (§87)
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            const scorecard = await generateScorecard({
              agentId: agent.id,
              agentName: agent.name,
              weekStart,
              weekEnd
            });

            // Insert / Update in database
            await query(
              `INSERT INTO ir_reports (id, agent_id, week_start, week_end, status, generated, model_version, error_note)
               VALUES ($1, $2, $3, $4, 'published', $5, 'gemini-3.5-flash', NULL)
               ON CONFLICT (agent_id, week_start)
               DO UPDATE SET status = EXCLUDED.status, generated = EXCLUDED.generated, 
                             model_version = EXCLUDED.model_version, error_note = NULL, generated_at = NOW()`,
              [reportId, agent.id, weekStart, weekEnd, JSON.stringify(scorecard)]
            );

            success = true;
            generatedCount++;
            break;
          } catch (err: any) {
            errorMsg = err.message || 'Unknown error';
            console.error(`[generate-scorecards] Attempt ${attempt} failed for ${agent.name}:`, errorMsg);
          }
        }

        if (!success) {
          failedCount++;
          failures.push({ name: agent.name, reason: errorMsg });

          try {
            await query(
              `INSERT INTO ir_reports (id, agent_id, week_start, week_end, status, generated, model_version, error_note)
               VALUES ($1, $2, $3, $4, 'failed', '{}'::jsonb, 'gemini-3.5-flash', $5)
               ON CONFLICT (agent_id, week_start)
               DO UPDATE SET status = EXCLUDED.status, error_note = EXCLUDED.error_note, generated_at = NOW()`,
              [reportId, agent.id, weekStart, weekEnd, errorMsg]
            );
          } catch (saveErr: any) {
            console.error(`[generate-scorecards] Failed to save failed state for ${agent.name}:`, saveErr.message);
          }
        }
      })
    );
  }

  // 5. Construct run summary
  const summaryLines = [
    `IR Weekly Scorecard — week of ${weekStart} to ${weekEnd}`,
    `Generated ${generatedCount} · Failed ${failedCount} · No chats ${noChatsAgents.length}`
  ];

  if (failures.length > 0) {
    summaryLines.push('', 'Failed:');
    for (const f of failures) {
      summaryLines.push(`• ${f.name} — ${f.reason}`);
    }
  }

  if (noChatsAgents.length > 0) {
    summaryLines.push('', `No chats this week: ${noChatsAgents.join(', ')}`);
  }

  const runSummary = summaryLines.join('\n');
  console.log('[generate-scorecards] Run Summary:\n' + runSummary);

  // 6. Alert Slack if configured
  const slackChannel = process.env.SCORECARD_SLACK_CHANNEL;
  const slackToken = process.env.SLACK_BOT_TOKEN;

  if (slackChannel) {
    if (!slackToken) {
      console.error('[generate-scorecards] SCORECARD_SLACK_CHANNEL is set but SLACK_BOT_TOKEN is missing!');
    } else {
      try {
        await sendSlackMessage(slackChannel, runSummary, slackToken);
      } catch (err: any) {
        console.error('[generate-scorecards] Failed to post summary to Slack:', err.message);
      }
    }
  } else {
    // If Slack is unset, we check if it is required to fail loudly (only once out of pilot/wired up)
    // For now (pilot), we log the summary and continue.
    console.log('[generate-scorecards] Slack posting skipped (SCORECARD_SLACK_CHANNEL unset).');
  }

  return NextResponse.json({
    ok: true,
    weekStart,
    weekEnd,
    generated: generatedCount,
    failed: failedCount,
    noChats: noChatsAgents.length,
    failures,
    noChatsAgents,
    summary: runSummary
  });
}
