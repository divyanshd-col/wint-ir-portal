// Load the rotating roster: who is on which type in a given week. The rotation then carries on by itself.
//
//   node scripts/import-roster.mjs roster.csv --week 2026-11-02          # preview only, writes nothing
//   node scripts/import-roster.mjs roster.csv --week 2026-11-02 --apply  # write it
//
// CSV: one person per line, `email-or-name,type` (type 1-4), optional third column `week` (a Monday) to override --week.
// A header line (starting with "email") is ignored. A person can also be given as an exact name instead of an email.
// Types: 1 Sat+Sun off, 2 Thu+Fri off, 3 Tue+Wed off, 4 Mon+Sun off. `type` is the type that person is on in that week.
// Re-running replaces each listed person's earlier rows (they are cancelled, not deleted). Needs POSTGRES_URL(_NON_POOLING).
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const envFile = join(ROOT, '.env.local');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf-8').split('\n')) {
    const m = line.match(/^([^#=\s]+)\s*=\s*"?(.+?)"?\s*$/);
    if (m) process.env[m[1]] = m[2];
  }
}

const args = process.argv.slice(2);
const file = args.find(a => !a.startsWith('--') && a !== args[args.indexOf('--week') + 1]);
const week = args.includes('--week') ? args[args.indexOf('--week') + 1] : null;
const apply = args.includes('--apply');
const isMonday = d => /^\d{4}-\d{2}-\d{2}$/.test(d) && new Date(d + 'T00:00:00Z').getUTCDay() === 1;
if (!file || !existsSync(file)) { console.error('Usage: node scripts/import-roster.mjs <file.csv> --week <Monday YYYY-MM-DD> [--apply]'); process.exit(1); }
if (week && !isMonday(week)) { console.error(`--week ${week} is not a Monday.`); process.exit(1); }

const rows = [], problems = [];
readFileSync(file, 'utf-8').split(/\r?\n/).forEach((line, i) => {
  if (!line.trim() || /^(email|name)\b/i.test(line.trim())) return;
  const [who, type, wk] = line.split(',').map(s => s.trim().replace(/^"|"$/g, ''));
  const w = wk || week;
  if (!who || !['1', '2', '3', '4'].includes(type)) return problems.push(`line ${i + 1}: need "email-or-name,type" with type 1-4 (got "${line}")`);
  if (!w || !isMonday(w)) return problems.push(`line ${i + 1}: needs a Monday week (use --week or a third column), got "${w ?? ''}"`);
  rows.push({ who, type: Number(type), week: w, line: i + 1 });
});

const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
if (!connectionString) { console.error('Missing POSTGRES_URL or POSTGRES_URL_NON_POOLING'); process.exit(1); }
const pool = new pg.Pool({ connectionString, ssl: { rejectUnauthorized: false } });
const client = await pool.connect();
try {
  const users = (await client.query(`SELECT user_id, email, name, role, platform_domain FROM users WHERE status = 'active'`)).rows;
  const norm = t => t.toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const eligible = users.filter(u => ['agent', 'tl'].includes(u.role) && u.platform_domain !== 'pcg');
  const byEmail = new Map(users.map(u => [u.email.toLowerCase(), u]));
  // Sheet names are often partial ("Harsh", "Suchinth K"): exact full name first, then a name that starts with it, then the same first name,
  // each only when exactly one person fits. Anything ambiguous is reported, never guessed.
  const find = who => {
    // An explicit email can be anyone active on the CX side (QA analysts and admins on the sheet are not agents), names only agents/team leads.
    if (who.includes('@')) { const u = byEmail.get(who.toLowerCase()); return u ? { u } : { err: `no user with email ${who}` }; }
    const n = norm(who);
    const tries = [u => norm(u.name) === n, u => (norm(u.name) + ' ').startsWith(n + ' '), u => norm(u.name).split(' ')[0] === n.split(' ')[0] && n.split(' ').length === 1];
    for (const t of tries) { const hit = eligible.filter(t); if (hit.length === 1) return { u: hit[0] }; if (hit.length > 1) return { err: `"${who}" fits ${hit.length} people: ${hit.map(h => h.name).join(' / ')}` }; }
    return { err: `no active CX agent or team lead matches "${who}"` };
  };
  const plan = [], seen = new Set();
  for (const r of rows) {
    const f = find(r.who);
    if (f.err) { problems.push(`line ${r.line}: ${f.err}`); continue; }
    const u = f.u;
    if (u.platform_domain === 'pcg') { problems.push(`line ${r.line}: ${u.email} is PCG, the roster is CX only`); continue; }
    if (seen.has(u.user_id)) { problems.push(`line ${r.line}: ${u.name} is listed twice (also matched by an earlier line)`); continue; }
    seen.add(u.user_id); plan.push({ ...r, user: u });
  }
  console.log('Matches (check these):'); plan.forEach(p => console.log(`  ${p.who.padEnd(24)} -> ${p.user.name} (${p.user.email}, ${p.user.role})  Type ${p.type}`));
  const notOnSheet = eligible.filter(u => !seen.has(u.user_id));
  if (notOnSheet.length) console.log(`\n${notOnSheet.length} active CX agents/team leads are not on this sheet: ${notOnSheet.map(u => u.name).join(', ')}`);
  const counts = [1, 2, 3, 4].map(t => plan.filter(p => p.type === t).length);
  console.log(`\n${plan.length} people ready. Per type: ${counts.map((c, i) => `Type ${i + 1}: ${c}`).join(', ')}`);
  if (problems.length) { console.log(`\n${problems.length} problem(s), these lines are skipped:`); problems.forEach(p => console.log('  - ' + p)); }
  if (!apply) { console.log('\nPreview only. Add --apply to write it.'); }
  else {
    await client.query('BEGIN');
    for (const p of plan) {
      await client.query(`UPDATE roster_assignments SET cancelled_at = NOW(), cancel_reason = 'Replaced by roster import' WHERE user_id = $1 AND cancelled_at IS NULL`, [p.user.user_id]);
      await client.query(`INSERT INTO roster_assignments (user_id, pattern_id, effective_from, reason) VALUES ($1, $2, $3, 'Imported roster')`, [p.user.user_id, p.type, p.week]);
    }
    await client.query('COMMIT');
    console.log(`\nDone. ${plan.length} people loaded.`);
  }
} catch (e) {
  await client.query('ROLLBACK').catch(() => {});
  console.error('Failed:', e.message); process.exitCode = 1;
} finally { client.release(); await pool.end(); }
