/**
 * Backfill: config.users (JSON blob) → Postgres `users` table, and link
 * agents.user_id by exact (normalized) name match.
 *
 * Safe + idempotent:
 *  - Skips users already present in `users` (by email).
 *  - Fails LOUDLY on a duplicate normalized name in the blob (name is a unique
 *    identity key now — a silent pick would misattribute data).
 *  - Blob users WITH a password  → status 'active' (their hash is preserved).
 *  - Blob users WITHOUT a password → status 'invited' (no login until they set
 *    one via a signup link — never 'active' with a null hash).
 *
 * Run:  npx tsx scripts/backfill-users.ts [--dry-run]
 * NOT run automatically — a human triggers it during the cutover.
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { query } from '@/lib/cx/db';
import { readConfig } from '@/lib/config';
import { normalizeEmail, normalizeName } from '@/lib/identity';
import type { UserRole } from '@/next-auth';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..');

const envFile = join(ROOT, '.env.local');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf-8').split('\n')) {
    const m = line.match(/^([^#=\s]+)\s*=\s*"?(.+?)"?\s*$/);
    if (m) process.env[m[1]] = m[2];
  }
}

const dryRun = process.argv.includes('--dry-run');
const VALID_ROLES: UserRole[] = ['agent', 'admin', 'quality', 'tl'];

function roleOf(u: { role?: string; isAdmin?: boolean }): UserRole {
  if (u.role && VALID_ROLES.includes(u.role as UserRole)) return u.role as UserRole;
  return u.isAdmin ? 'admin' : 'agent';
}

async function main() {
  const config = await readConfig();
  const blobUsers = config.users || [];
  console.log(`Found ${blobUsers.length} users in config blob.${dryRun ? ' (dry run)' : ''}`);

  // 1. Pre-flight: detect duplicate normalized names — fail loudly.
  const byName = new Map<string, string[]>();
  for (const u of blobUsers) {
    const email = normalizeEmail(u.email ?? u.username ?? '');
    const name = normalizeName(u.agentName || email.split('@')[0]);
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name)!.push(email);
  }
  const dupes = [...byName.entries()].filter(([, emails]) => emails.length > 1);
  if (dupes.length) {
    console.error('❌ Duplicate normalized names in the blob — resolve before backfill:');
    for (const [name, emails] of dupes) console.error(`   "${name}" → ${emails.join(', ')}`);
    process.exit(1);
  }

  let inserted = 0, skipped = 0, invited = 0;

  for (const u of blobUsers) {
    const email = normalizeEmail(u.email ?? u.username ?? '');
    if (!email) { console.warn('  skip: user with no email'); continue; }
    const name = normalizeName(u.agentName || email.split('@')[0]);
    const role = roleOf(u);
    const hasPassword = !!u.password;
    const status = hasPassword ? 'active' : 'invited';
    const dispositions = u.assignedDispositions?.length ? u.assignedDispositions : null;

    const existing = await query<{ user_id: number }>(`SELECT user_id FROM users WHERE email = $1`, [email]);
    if (existing.length) { skipped++; continue; }

    if (dryRun) {
      console.log(`  would insert: ${email} · "${name}" · ${role} · ${status}`);
      inserted++; if (!hasPassword) invited++;
      continue;
    }

    await query(
      `INSERT INTO users (email, name, password_hash, role, status, assigned_dispositions, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, 'migration')`,
      [email, name, hasPassword ? u.password : null, role, status, dispositions],
    );
    inserted++; if (!hasPassword) invited++;
  }

  // 2. Link agents.user_id by exact normalized name.
  let linked = 0;
  if (!dryRun) {
    const res = await query<{ id: number }>(
      `UPDATE agents a SET user_id = u.user_id
         FROM users u
        WHERE a.user_id IS NULL AND a.name = u.name
        RETURNING a.id`,
    );
    linked = res.length;
  }

  console.log('─'.repeat(48));
  console.log(`Inserted: ${inserted} (of which invited/no-password: ${invited})`);
  console.log(`Skipped (already present): ${skipped}`);
  console.log(`agents linked to user_id: ${linked}`);
  console.log(dryRun ? 'Dry run — no changes written.' : '✅ Backfill complete.');
  process.exit(0);
}

main().catch(err => { console.error('❌ Backfill failed:', err); process.exit(1); });
