import './_load-env';
import { query } from '../lib/cx/db';
import { isPcgAm, canonicalizePcgRmName } from '../lib/pcg/canonical-names';
import { resolveParameterAttribution } from '../lib/pcg/attribution';

async function run() {
  const isApply = process.argv.includes('--apply');
  console.log(`Fixing dual chat attributions (mode: ${isApply ? 'APPLY' : 'DRY RUN'})...`);

  const rows = await query<any>(`
    SELECT id, rm_name, preceding_rm_name, parameters, compliance_flags, transcript_turns
    FROM pcg_chat_evaluations
    WHERE preceding_rm_name IS NOT NULL AND TRIM(preceding_rm_name) != ''
  `);

  console.log(`Found ${rows.length} dual chats.`);

  for (const r of rows) {
    const rmName = canonicalizePcgRmName(r.preceding_rm_name || 'RM');
    const amName = canonicalizePcgRmName(r.rm_name || 'AM');
    const turns = Array.isArray(r.transcript_turns) ? r.transcript_turns : (typeof r.transcript_turns === 'string' ? JSON.parse(r.transcript_turns) : []);

    let params = typeof r.parameters === 'string' ? JSON.parse(r.parameters) : r.parameters;
    if (!params || typeof params !== 'object') continue;

    let hasParamChanges = false;
    for (const [key, p] of Object.entries<any>(params)) {
      const s = (p.status || '').trim().toLowerCase();
      const isFailed = s === 'no' || s === 'half' || s === 'partial';
      if (!isFailed) {
        if (p.status === 'Yes') {
          if (p.rmStatus !== 'Yes' || p.amStatus !== 'Yes') {
            p.rmStatus = 'Yes';
            p.amStatus = 'Yes';
            hasParamChanges = true;
          }
        }
        continue;
      }

      const attr = resolveParameterAttribution({ id: key, ...p }, turns, rmName, amName);
      if (p.failedBy !== attr) {
        console.log(`Chat ${r.id} (${rmName} + ${amName}) [${key}]: failedBy "${p.failedBy}" -> "${attr}" (reasoning: "${p.reasoning?.slice(0, 60)}...")`);
        p.failedBy = attr;
        hasParamChanges = true;
      }

      if (attr === 'both') {
        p.rmStatus = p.status;
        p.amStatus = p.status;
      } else if (attr === 'rm') {
        p.rmStatus = p.status;
        p.amStatus = 'NA';
      } else if (attr === 'am') {
        p.amStatus = p.status;
        p.rmStatus = 'NA';
      }
    }

    // Also ensure compliance flags in dual chats attribute to both if FAIL
    let compliance = typeof r.compliance_flags === 'string' ? JSON.parse(r.compliance_flags) : r.compliance_flags;
    let hasCompChanges = false;
    if (Array.isArray(compliance)) {
      for (const c of compliance) {
        if (c.status === 'FAIL' && c.failedBy !== 'both') {
          console.log(`Chat ${r.id} Compliance [${c.name}]: failedBy "${c.failedBy}" -> "both"`);
          c.failedBy = 'both';
          c.rmStatus = 'FAIL';
          c.amStatus = 'FAIL';
          hasCompChanges = true;
        }
      }
    }

    if (isApply && (hasParamChanges || hasCompChanges)) {
      await query(`
        UPDATE pcg_chat_evaluations
        SET parameters = $1,
            compliance_flags = $2,
            updated_at = NOW()
        WHERE id = $3
      `, [JSON.stringify(params), JSON.stringify(compliance), r.id]);
    }
  }

  console.log('Done!');
  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
