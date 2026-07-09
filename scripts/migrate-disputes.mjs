#!/usr/bin/env node
/**
 * scripts/migrate-disputes.mjs
 *
 * 1. Creates `iqs_flags` and `iqs_flag_comments` tables by running `db/migrations/011_iqs_flags.sql`.
 * 2. Fetches existing flags (`wint_iqs_flags`) and thread comments (`wint_iqs_thread:*`) from Redis.
 * 3. Migrates them into Postgres, resolving foreign key requirements.
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
const { Pool } = pg;

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT  = join(__dir, '..');

// ── Load env ──────────────────────────────────────────────────────────────────
for (const f of ['.env.local', '.env.vercel.tmp']) {
  const p = join(ROOT, f);
  if (existsSync(p)) {
    for (const line of readFileSync(p, 'utf-8').split('\n')) {
      const m = line.match(/^([^#=\s]+)\s*=\s*"?(.+?)"?\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  }
}

const UPSTASH_URL   = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const POSTGRES_URL  = process.env.POSTGRES_URL;

if (!UPSTASH_URL || !UPSTASH_TOKEN) {
  console.error('❌ Missing UPSTASH_REDIS_REST_URL / TOKEN');
  process.exit(1);
}
if (!POSTGRES_URL) {
  console.error('❌ Missing POSTGRES_URL');
  process.exit(1);
}

const pool = new Pool({ connectionString: POSTGRES_URL, ssl: { rejectUnauthorized: false } });
const db = async (q, p = []) => (await pool.query(q, p)).rows;

async function upstash(path) {
  const r = await fetch(`${UPSTASH_URL}/${path}`, {
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
  });
  return (await r.json()).result;
}

async function main() {
  console.log('1. Running database migration 011_iqs_flags.sql...');
  const migrationSql = readFileSync(join(ROOT, 'db/migrations/011_iqs_flags.sql'), 'utf-8');
  await pool.query(migrationSql);
  console.log('✅ Tables created.');

  console.log('2. Fetching IQS flags from Redis...');
  const rawFlags = await upstash('lrange/wint_iqs_flags/0/-1') || [];
  console.log(`Found ${rawFlags.length} flags in Redis.`);

  let flagsMigrated = 0;
  let commentsMigrated = 0;

  for (const rawFlag of rawFlags) {
    try {
      const flag = JSON.parse(rawFlag);
      if (!flag.id || !flag.chatId) continue;

      // Check if conversation exists (foreign key constraint)
      const convs = await db('SELECT id FROM conversations WHERE id = $1', [String(flag.chatId)]);
      if (convs.length === 0) {
        console.warn(`⚠️ Slipped flag ${flag.id}: conversation ${flag.chatId} does not exist in Postgres. Mocking conversation...`);
        // Create mock conversation
        await db(`
          INSERT INTO conversations (id, conversation_type, started_at, closed_at)
          VALUES ($1, 'agent', NOW(), NOW())
          ON CONFLICT DO NOTHING
        `, [String(flag.chatId)]);
      }

      // Insert flag
      await db(`
        INSERT INTO iqs_flags (
          id, score_id, chat_id, agent_name, agent_email, agent_note,
          challenged_params, flagged_at, updated_at, raised_by_role,
          param_category, parent_flag_id, status, reviewed_by, reviewed_at, review_note
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
        ON CONFLICT (id) DO NOTHING
      `, [
        flag.id,
        flag.scoreId || null,
        String(flag.chatId),
        flag.agentName || '',
        flag.agentEmail || '',
        flag.agentNote || '',
        JSON.stringify(flag.challengedParams || []),
        flag.flaggedAt || new Date().toISOString(),
        flag.updatedAt || null,
        flag.raisedByRole || 'ir',
        flag.paramCategory || 'cat1',
        flag.parentFlagId || null,
        flag.status || 'pending',
        flag.reviewedBy || null,
        flag.reviewedAt || null,
        flag.reviewNote || null,
      ]);
      flagsMigrated++;

      // Fetch comments thread for this flag
      const rawComments = await upstash(`lrange/wint_iqs_thread:${flag.id}/0/-1`) || [];
      for (const rawComment of rawComments) {
        try {
          const comment = JSON.parse(rawComment);
          if (!comment.id) continue;
          await db(`
            INSERT INTO iqs_flag_comments (id, flag_id, author_email, author_name, role, content, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (id) DO NOTHING
          `, [
            comment.id,
            flag.id,
            comment.authorEmail || '',
            comment.authorName || '',
            comment.role || 'agent',
            comment.content || '',
            comment.createdAt || new Date().toISOString(),
          ]);
          commentsMigrated++;
        } catch (commentErr) {
          console.error(`Error parsing comment: ${commentErr.message}`);
        }
      }

    } catch (flagErr) {
      console.error(`Error parsing/migrating flag: ${flagErr.message}`);
    }
  }

  console.log(`\n🎉 Migration Complete:`);
  console.log(`   - IQS Flags Migrated: ${flagsMigrated}`);
  console.log(`   - Comments Migrated:  ${commentsMigrated}`);

  await pool.end();
}

main().catch(err => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
