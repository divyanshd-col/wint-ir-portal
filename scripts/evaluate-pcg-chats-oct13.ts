import './_load-env';
import { query } from '../lib/cx/db';
import { runPcgChatPipeline, sanitizeChatTurns } from '../lib/scoring/pcg-chat-pipeline';

interface Options {
  limit?: number;
  concurrency: number;
  fromDate: string;
  dryRun: boolean;
}

function parseArgs(): Options {
  const args = process.argv.slice(2);
  const opts: Options = {
    concurrency: 3,
    fromDate: '2026-10-13',
    dryRun: false,
  };

  for (const arg of args) {
    if (arg.startsWith('--limit=')) {
      const val = parseInt(arg.split('=')[1], 10);
      if (!isNaN(val) && val > 0) opts.limit = val;
    } else if (arg.startsWith('--concurrency=')) {
      const val = parseInt(arg.split('=')[1], 10);
      if (!isNaN(val) && val > 0) opts.concurrency = Math.min(10, Math.max(1, val));
    } else if (arg.startsWith('--from=')) {
      opts.fromDate = arg.split('=')[1].trim();
    } else if (arg === '--dry-run') {
      opts.dryRun = true;
    }
  }

  return opts;
}

async function main() {
  const opts = parseArgs();

  console.log('========================================================================');
  console.log(' 💬 PCG WhatsApp Chat Evaluation Pipeline');
  console.log(` 📅 Starting Date: ${opts.fromDate} onwards`);
  console.log(` ⚡ Concurrency:   ${opts.concurrency} parallel evaluations`);
  if (opts.limit) console.log(` 🎯 Limit:         ${opts.limit} chats`);
  if (opts.dryRun) console.log(' ⚠️  Mode:          DRY RUN (no database changes)');
  console.log('========================================================================\n');

  // 1. Fetch closed conversations from the given date that are not yet evaluated
  const limitClause = opts.limit ? `LIMIT ${opts.limit}` : '';
  const pending = await query<any>(`
    SELECT c.id, c.customer_phone, c.waba_number, c.customer_name, c.assigned_rm_id, c.rm_name,
           c.total_messages, c.status, c.closed_at, c.created_at, c.last_message_at, c.transcript,
           c.is_am
    FROM pcg_conversations c
    WHERE c.status = 'CLOSED'
      AND c.closed_at IS NOT NULL
      AND c.created_at >= $1::timestamptz
      AND NOT EXISTS (
        SELECT 1 FROM pcg_chat_evaluations e
        WHERE e.conversation_id = c.id
           OR (e.customer_phone = c.customer_phone AND e.chat_closed_at = COALESCE(c.closed_at, c.last_message_at))
      )
    ORDER BY COALESCE(c.closed_at, c.last_message_at) ASC, c.id ASC
    ${limitClause}
  `, [`${opts.fromDate}T00:00:00.000Z`]);

  console.log(`Found ${pending.length} pending conversations to evaluate.\n`);

  if (pending.length === 0) {
    console.log('All eligible conversations are already evaluated! Dashboard is fully up to date.');
    process.exit(0);
  }

  let processedCount = 0;
  let scoreableEvaluated = 0;
  let unscoreableCount = 0;
  let errorCount = 0;
  let complianceBreachCount = 0;
  const iqsScores: number[] = [];

  const startTime = Date.now();

  // Process in batches matching concurrency
  for (let i = 0; i < pending.length; i += opts.concurrency) {
    const chunk = pending.slice(i, i + opts.concurrency);

    await Promise.all(
      chunk.map(async (conv) => {
        const itemIdx = ++processedCount;
        const phone = conv.customer_phone;
        const custName = conv.customer_name || 'Client';
        const turns = sanitizeChatTurns(conv.transcript);
        const rmTurns = turns.filter((t: any) => t.speaker === 'RM' || t.speaker === 'AM' || t.direction === 'outbound');
        const isScoreable = rmTurns.length > 0 && turns.length >= 2;

        const progressPrefix = `[${itemIdx}/${pending.length}] (${Math.round((itemIdx / pending.length) * 100)}%)`;

        if (opts.dryRun) {
          if (isScoreable) {
            scoreableEvaluated++;
            console.log(`${progressPrefix} [DRY RUN - SCOREABLE] Phone: +${phone} (${custName}) | RM: ${conv.rm_name || 'Unassigned'} | Turns: ${turns.length}`);
          } else {
            unscoreableCount++;
            console.log(`${progressPrefix} [DRY RUN - UNVOICED]  Phone: +${phone} (${custName}) | No RM dialogue turns.`);
          }
          return;
        }

        try {
          const evalRecord = await runPcgChatPipeline(conv);

          if (evalRecord.verdict === 'NOT_SCOREABLE') {
            unscoreableCount++;
            console.log(
              `${progressPrefix} ⚪ NOT_SCOREABLE | Phone: +${phone.padEnd(14)} | ${custName.slice(0, 20).padEnd(20)} | RM: ${(evalRecord.rm_name || 'Unassigned').padEnd(18)} | Turns: ${evalRecord.total_messages || turns.length}`
            );
          } else if (evalRecord.verdict === 'EXCLUDED_NON_CLIENT') {
            unscoreableCount++;
            console.log(
              `${progressPrefix} 🚫 EXCLUDED_HIRING | Phone: +${phone.padEnd(14)} | ${custName.slice(0, 20).padEnd(20)} | RM: ${(evalRecord.rm_name || 'Unassigned').padEnd(18)} | Non-client recruitment chat`
            );
          } else {
            scoreableEvaluated++;
            if (evalRecord.iqs_score != null) {
              iqsScores.push(Number(evalRecord.iqs_score));
            }
            if (evalRecord.compliance_tripwire) {
              complianceBreachCount++;
            }

            const verdictBadge = evalRecord.compliance_tripwire
              ? '🚨 TRIPWIRE'
              : evalRecord.verdict === 'excellent'
              ? '🟢 EXCELLENT'
              : evalRecord.verdict === 'meets_expectations'
              ? '🔵 MEETS'
              : evalRecord.verdict === 'coaching'
              ? '🟡 COACHING'
              : '🔴 REMEDIATION';

            console.log(
              `${progressPrefix} ${verdictBadge.padEnd(14)} | Phone: +${phone.padEnd(14)} | ${custName.slice(0, 20).padEnd(20)} | RM: ${evalRecord.rm_name.padEnd(18)} | IQS: ${String(evalRecord.iqs_score).padStart(3)}% | Turns: ${evalRecord.total_messages}`
            );
          }
        } catch (err: any) {
          errorCount++;
          console.error(
            `${progressPrefix} ❌ ERROR | Phone: +${phone} (${custName}) | ${err?.message || err}`
          );
        }
      })
    );
  }

  const elapsedSec = Math.round((Date.now() - startTime) / 1000);
  const avgIqs = iqsScores.length > 0 ? (iqsScores.reduce((a, b) => a + b, 0) / iqsScores.length).toFixed(1) : '—';

  console.log('\n========================================================================');
  console.log(' ✅ Batch Evaluation Completed!');
  console.log(` ⏱️  Duration:           ${Math.floor(elapsedSec / 60)}m ${elapsedSec % 60}s`);
  console.log(` 💬 Total Processed:    ${processedCount}`);
  console.log(` 📊 Evaluated Dialogues: ${scoreableEvaluated}`);
  console.log(` ⚪ Not Scoreable:      ${unscoreableCount} (0 RM replies or <2 turns)`);
  console.log(` 🚨 Compliance Flags:   ${complianceBreachCount}`);
  console.log(` 📈 Average Chat IQS:   ${avgIqs}%`);
  if (errorCount > 0) {
    console.log(` ⚠️  Errors Encountered: ${errorCount}`);
  }
  console.log('========================================================================\n');
  console.log('Chats are now visible in the PCG Chat Quality dashboard:');
  console.log('http://localhost:3000/admin/pcg-calls?tab=chat_quality\n');

  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal batch evaluation error:', err);
  process.exit(1);
});
