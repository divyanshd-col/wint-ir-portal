/**
 * scripts/evaluate-10-emails.ts
 *
 * Takes 10 real email replies from the database and evaluates them
 * against the 7 newly implemented parameters using Gemini.
 */

import './_load-env';
import { query } from '@/lib/cx/db';
import { evaluateSingleReplySync } from '@/lib/email/gemini-batch-evaluator';
import { DEFAULT_EMAIL_PARAMETERS } from '@/lib/email/context-builder';

async function run() {
  console.log('Fetching 10 candidate email records from database...');

  // Select 10 records with valid customer and agent content
  const rows = await query(`
    SELECT e.id, e.message_id, e.ticket_id, e.agent_name, c.subject_line,
           e.sent_at,
           length(coalesce(e.customer_message, '')) as cust_len,
           length(coalesce(e.agent_reply_text, '')) as reply_len
    FROM email_reply_evaluations e
    JOIN email_conversations c ON e.ticket_id = c.id
    WHERE length(coalesce(e.agent_reply_text, '')) > 20
      AND length(coalesce(e.customer_message, '')) > 0
    ORDER BY e.id ASC
    LIMIT 10
  `);

  if (!rows || rows.length === 0) {
    console.error('No candidate emails found in email_reply_evaluations');
    process.exit(1);
  }

  console.log(`Found ${rows.length} email threads to evaluate.\n`);

  const results: any[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    console.log(`--------------------------------------------------------------------------------`);
    console.log(`[${i + 1}/${rows.length}] Evaluating Email ID: ${row.id} | Ticket: ${row.ticket_id}`);
    console.log(`Agent: ${row.agent_name || 'Agent'} | Subject: "${row.subject_line}"`);

    try {
      const startTime = Date.now();
      const evalResult = await evaluateSingleReplySync(row.message_id);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

      console.log(`✓ Completed in ${elapsed}s | Score: ${evalResult.quality_score}% | Compliance: ${evalResult.compliance_passed ? 'PASS' : 'FAIL'}`);

      // Fetch the updated DB row
      const updated = await query(`
        SELECT quality_score, compliance_passed, parameter_scores, qa_notes
        FROM email_reply_evaluations
        WHERE message_id = $1
      `, [row.message_id]);

      const paramScores = updated[0]?.parameter_scores || {};
      const reasoning = paramScores.__reasoning || {};

      results.push({
        id: row.id,
        agent: row.agent_name || 'Unknown',
        subject: row.subject_line?.slice(0, 35) || 'No Subject',
        score: `${evalResult.quality_score}%`,
        compliance: evalResult.compliance_passed ? 'PASS' : 'FAIL',
        issue_res: paramScores.issue_resolution || '-',
        accuracy: paramScores.accuracy || '-',
        exp_setting: paramScores.expectation_setting || '-',
        personal: paramScores.personalisation || paramScores.personalization || '-',
        empathy: paramScores.empathy || '-',
        sentences: paramScores.sentences_simple_to_understand || paramScores.sentences || '-',
        opening_closing: paramScores.opening_and_closing || paramScores.opening_closing_message || '-',
        summary: updated[0]?.qa_notes || '',
        reasoning,
      });
    } catch (err: any) {
      console.error(`❌ Failed evaluating message ${row.message_id}:`, err.message);
    }
  }

  console.log('\n================================================================================');
  console.log('                          EVALUATION RESULTS SUMMARY                            ');
  console.log('================================================================================\n');

  console.table(
    results.map(r => ({
      ID: r.id,
      Agent: r.agent,
      Subject: r.subject,
      Score: r.score,
      Compliance: r.compliance,
      'Issue Res (25%)': r.issue_res,
      'Accuracy (25%)': r.accuracy,
      'Expectation (15%)': r.exp_setting,
      'Personal (10%)': r.personal,
      'Empathy (10%)': r.empathy,
      'Sentences (10%)': r.sentences,
      'Open/Close (5%)': r.opening_closing,
    }))
  );

  console.log('\n--- Detailed Evaluator Feedback & Reasoning for each Email ---\n');
  results.forEach((r, idx) => {
    console.log(`[#${idx + 1}] ID ${r.id} | ${r.agent} | Score: ${r.score} | Compliance: ${r.compliance}`);
    console.log(`Summary: ${r.summary}`);
    if (r.reasoning && Object.keys(r.reasoning).length > 0) {
      console.log('Parameter Breakdown & Reasoning:');
      for (const [k, v] of Object.entries(r.reasoning)) {
        console.log(`  • ${k}: ${v}`);
      }
    }
    console.log('');
  });
}

run().catch(err => {
  console.error('Execution error:', err);
  process.exit(1);
});
