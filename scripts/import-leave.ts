// The go-live load: balances, leave and holidays from the Excel template (see scripts/make-leave-template.ts).
//
//   npx tsx scripts/import-leave.ts leave.xlsx            # preview only, writes nothing
//   npx tsx scripts/import-leave.ts leave.xlsx --apply    # write it
//
// Load the roster first (people need a roster type). Run it once: it refuses to load anyone who already has a balance.
// Needs POSTGRES_URL_NON_POOLING (or POSTGRES_URL), like the other import scripts.
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import * as XLSX from 'xlsx';
import pg from 'pg';
import { todayIST } from '../lib/ist';
import { buildLoad, type BalanceRow, type LeaveRow } from '../lib/leave-import';
import { fmtQ } from '../lib/leave';
import type { Assignment, Pattern } from '../lib/roster';

const ROOT = join(__dirname, '..');
const envFile = join(ROOT, '.env.local');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf-8').split('\n')) {
    const m = line.match(/^([^#=\s]+)\s*=\s*"?(.+?)"?\s*$/);
    if (m) process.env[m[1]] = m[2];
  }
}

const file = process.argv[2];
const apply = process.argv.includes('--apply');
if (!file || file.startsWith('--') || !existsSync(file)) { console.error('Usage: npx tsx scripts/import-leave.ts <file.xlsx> [--apply]'); process.exit(1); }

const toIso = (v: unknown): string => {
  if (v instanceof Date) return new Date(v.getTime() - v.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  if (typeof v === 'number') { const d = XLSX.SSF.parse_date_code(v); return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`; }
  return String(v ?? '').trim();
};
const wb = XLSX.readFile(file, { cellDates: true });
const rowsOf = (name: string): Record<string, unknown>[] => {
  const ws = wb.Sheets[name];
  if (!ws) { console.error(`The file has no "${name}" sheet.`); process.exit(1); }
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' }).map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k.trim().toLowerCase(), v])));
};
const s = (v: unknown) => String(v ?? '').trim();

const balances: BalanceRow[] = rowsOf('Balances').map((r, i) => ({ email: s(r['email']), balance: Number(r['balance']), line: i + 2 })).filter(r => r.email);
const leaves: LeaveRow[] = rowsOf('Leaves').map((r, i) => ({
  email: s(r['email']), leaveId: s(r['leave id']), type: s(r['type']), status: s(r['status']), start: toIso(r['start date']), startHalf: s(r['start half']),
  end: toIso(r['end date']), endHalf: s(r['end half']), reason: s(r['reason']), line: i + 2 })).filter(r => r.email);
const holidays = rowsOf('Holidays').map((r, i) => ({ day: toIso(r['date']), name: s(r['name']), line: i + 2 })).filter(r => r.day || r.name);

(async () => {
const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
if (!connectionString) { console.error('Missing POSTGRES_URL or POSTGRES_URL_NON_POOLING'); process.exit(1); }
const pool = new pg.Pool({ connectionString, ssl: connectionString.includes('localhost') || connectionString.includes('127.0.0.1') ? false : { rejectUnauthorized: false } });
const client = await pool.connect();
try {
  const users = (await client.query(`SELECT user_id, name, email FROM users WHERE status = 'active' AND platform_domain <> 'pcg'`)).rows;
  const byEmail = new Map<string, { userId: number; name: string }>(users.map(u => [String(u.email).toLowerCase(), { userId: u.user_id, name: u.name }]));
  const patterns: Pattern[] = (await client.query(`SELECT id, label, off_weekdays, rotates FROM roster_patterns ORDER BY id`)).rows;
  const assignments = new Map<number, Assignment[]>();
  for (const r of (await client.query(`SELECT user_id, pattern_id, to_char(effective_from,'YYYY-MM-DD') AS effective_from FROM roster_assignments WHERE cancelled_at IS NULL`)).rows)
    assignments.set(r.user_id, [...(assignments.get(r.user_id) ?? []), { pattern_id: r.pattern_id, effective_from: r.effective_from }]);

  // Leave IDs: use the sheet's, otherwise the next numbers. A preview never uses up the sequence.
  const missing = leaves.filter(l => !l.leaveId).length;
  const fresh: string[] = apply && missing ? (await client.query(`SELECT 'LV-' || nextval('leave_id_seq') AS id FROM generate_series(1, $1)`, [missing])).rows.map(r => r.id) : [];
  let p = 0;
  const plan = buildLoad({ balances, leaves, users: byEmail, assignments, patterns, today: todayIST(), nextLeaveId: () => fresh[p++] ?? `LV-new-${++p}` });

  const problems = [...plan.problems];
  for (const h of holidays) if (!/^\d{4}-\d{2}-\d{2}$/.test(h.day) || !h.name) problems.push(`Holidays line ${h.line}: needs a date (YYYY-MM-DD) and a name`);
  const already = await client.query(`SELECT DISTINCT u.name FROM leave_ledger l JOIN users u USING (user_id) WHERE l.user_id = ANY($1::int[])`, [[...new Set(plan.ledger.map(l => l.user_id))]]);
  if (already.rows.length) problems.push(`These people already have a balance, so this looks loaded already: ${already.rows.map(r => r.name).join(', ')}`);

  const perUser = new Map<number, { name: string; opening: number; leaves: number }>();
  for (const l of plan.ledger) if (l.entry_type === 'Opening balance') perUser.set(l.user_id, { name: users.find(u => u.user_id === l.user_id)?.name ?? String(l.user_id), opening: l.amount, leaves: 0 });
  for (const r of plan.requests) { const e = perUser.get(r.user_id); if (e) e.leaves++; }
  const sheetBalance = (uid: number) => plan.ledger.filter(l => l.user_id === uid).reduce((a, l) => a + l.amount, 0);
  console.log(`Balances: ${balances.length} rows, Leaves: ${leaves.length} rows, Holidays: ${holidays.length} rows (today is ${todayIST()} IST)\n`);
  for (const [uid, e] of perUser) console.log(`  ${e.name.padEnd(28)} balance ${fmtQ(sheetBalance(uid)).padStart(6)}   (opening ${fmtQ(e.opening)} before future leave)   ${e.leaves} leave request${e.leaves === 1 ? '' : 's'}`);
  console.log(`\nWould write: ${plan.requests.length} requests, ${plan.lines.length} day lines, ${plan.ledger.length} ledger entries, ${holidays.length} holidays`);
  if (problems.length) { console.log(`\n${problems.length} problem(s):`); problems.forEach(x => console.log('  - ' + x)); }

  if (!apply) console.log(problems.length ? '\nPreview only. Fix the problems, then run again.' : '\nPreview only. Add --apply to write it.');
  else if (problems.length) { console.log('\nNothing was written. Fix the problems first.'); process.exitCode = 1; }
  else {
    await client.query('BEGIN');
    for (const r of plan.requests) await client.query(
      `INSERT INTO leave_requests (leave_id, user_id, type, status, reason, start_date, end_date, start_half, end_half, source) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'import')`,
      [r.leave_id, r.user_id, r.type, r.status, r.reason, r.start_date, r.end_date, r.start_half, r.end_half]);
    for (const l of plan.lines) await client.query(`INSERT INTO leave_days (leave_id, day, kind, half, state, charge) VALUES ($1,$2,$3,$4,$5,$6)`, [l.leave_id, l.day, l.kind, l.half, l.state, l.charge]);
    for (const l of plan.ledger) await client.query(`INSERT INTO leave_ledger (user_id, entry_type, amount, leave_id, description) VALUES ($1,$2,$3,$4,$5)`, [l.user_id, l.entry_type, l.amount, l.leave_id, l.description]);
    for (const h of holidays) await client.query(`INSERT INTO holidays (day, name) VALUES ($1,$2) ON CONFLICT (day) DO UPDATE SET name = EXCLUDED.name`, [h.day, h.name]);
    await client.query(`INSERT INTO hrms_audit (actor_user_id, action, target_user_id, detail) VALUES (NULL, 'leave_go_live_load', NULL, $1)`,
      [JSON.stringify({ people: perUser.size, requests: plan.requests.length, lines: plan.lines.length, ledger: plan.ledger.length, holidays: holidays.length, file })]);
    await client.query('COMMIT');
    console.log('\nDone.');
  }
} catch (e) {
  await client.query('ROLLBACK').catch(() => {});
  console.error('Failed:', (e as Error).message); process.exitCode = 1;
} finally { client.release(); await pool.end(); }
})();
