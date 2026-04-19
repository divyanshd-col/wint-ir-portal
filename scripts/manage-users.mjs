#!/usr/bin/env node
/**
 * manage-users.mjs  —  View and update user roles directly in Upstash
 *
 * Usage:
 *   node scripts/manage-users.mjs list
 *   node scripts/manage-users.mjs set-role rahul.m@wintwealth.com agent
 *   node scripts/manage-users.mjs set-role divyansh.d@wintwealth.com admin
 *   node scripts/manage-users.mjs add divyansh.d@wintwealth.com admin "Divyansh"
 *   node scripts/manage-users.mjs remove old.user@wintwealth.com
 *
 * Roles: agent | tl | quality | admin
 *
 * Set env vars first:
 *   export UPSTASH_REDIS_REST_URL=https://...
 *   export UPSTASH_REDIS_REST_TOKEN=...
 *   (or create a .env.local file — this script reads it automatically)
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT  = join(__dir, '..');

// ── Load .env.local if present ───────────────────────────────────────────────
const envFile = join(ROOT, '.env.local');
if (existsSync(envFile)) {
  const lines = readFileSync(envFile, 'utf-8').split('\n');
  for (const line of lines) {
    const m = line.match(/^([^#=\s]+)\s*=\s*"?(.+?)"?\s*$/);
    if (m) process.env[m[1]] = m[2];
  }
}

const URL   = process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const KEY   = 'wint_portal_config';
const VALID_ROLES = new Set(['agent', 'tl', 'quality', 'admin']);

if (!URL || !TOKEN) {
  console.error('❌  UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN must be set.');
  process.exit(1);
}

// ── Upstash helpers ───────────────────────────────────────────────────────────
async function kvGet(key) {
  const res = await fetch(`${URL}/get/${key}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  const data = await res.json();
  return data.result ?? null;
}

async function kvSet(key, value) {
  await fetch(`${URL}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([['SET', key, value]]),
  });
}

async function loadConfig() {
  const raw = await kvGet(KEY);
  if (!raw) throw new Error('No config found in Upstash. Is the portal configured?');
  return JSON.parse(raw);
}

async function saveConfig(cfg) {
  await kvSet(KEY, JSON.stringify(cfg));
}

// ── Pretty table ──────────────────────────────────────────────────────────────
function printTable(users) {
  const roleColor = r => ({
    admin: '\x1b[31m', tl: '\x1b[33m', quality: '\x1b[35m', agent: '\x1b[32m',
  }[r] || '\x1b[37m');
  const reset = '\x1b[0m';

  const rows = users.map(u => ({
    Email:      u.email || u.username || '—',
    'Agent Name': u.agentName || '—',
    Role:       u.role || 'agent',
  }));

  const cols = ['Email', 'Agent Name', 'Role'];
  const widths = cols.map(c => Math.max(c.length, ...rows.map(r => String(r[c]).length)));
  const hr = '─'.repeat(widths.reduce((s, w) => s + w + 3, 1));

  console.log('\n' + hr);
  console.log('│ ' + cols.map((c, i) => c.padEnd(widths[i])).join(' │ ') + ' │');
  console.log(hr);
  for (const row of rows) {
    const roleCol = `${roleColor(row.Role)}${row.Role.padEnd(widths[2])}${reset}`;
    console.log('│ ' + [
      row.Email.padEnd(widths[0]),
      row['Agent Name'].padEnd(widths[1]),
      roleCol,
    ].join(' │ ') + ' │');
  }
  console.log(hr + '\n');
  console.log(`  ${users.length} users total\n`);
}

// ── Commands ──────────────────────────────────────────────────────────────────
const [,, cmd, ...args] = process.argv;

if (!cmd || cmd === 'help') {
  console.log(`
  Usage:
    node scripts/manage-users.mjs list
    node scripts/manage-users.mjs set-role <email> <role>
    node scripts/manage-users.mjs add <email> <role> [agentName]
    node scripts/manage-users.mjs remove <email>

  Roles: agent | tl | quality | admin
  `);
  process.exit(0);
}

// ── list ──────────────────────────────────────────────────────────────────────
if (cmd === 'list') {
  const cfg = await loadConfig();
  const users = cfg.users || [];
  if (!users.length) { console.log('\n  No users found.\n'); process.exit(0); }
  printTable(users);
  process.exit(0);
}

// ── set-role ──────────────────────────────────────────────────────────────────
if (cmd === 'set-role') {
  const [email, role] = args;
  if (!email || !role) { console.error('Usage: set-role <email> <role>'); process.exit(1); }
  if (!VALID_ROLES.has(role)) { console.error(`❌  Invalid role "${role}". Valid: ${[...VALID_ROLES].join(', ')}`); process.exit(1); }

  const cfg = await loadConfig();
  const users = cfg.users || [];
  const idx = users.findIndex(u => (u.email || u.username || '').toLowerCase() === email.toLowerCase());

  if (idx < 0) {
    console.error(`❌  User "${email}" not found. Use "add" to create.`);
    printTable(users);
    process.exit(1);
  }

  const prev = users[idx].role || 'agent';
  users[idx] = { ...users[idx], role, isAdmin: role === 'admin' };
  cfg.users = users;
  await saveConfig(cfg);
  console.log(`\n  ✅  ${email}  ${prev} → ${role}\n`);
  printTable(users);
  process.exit(0);
}

// ── add ───────────────────────────────────────────────────────────────────────
if (cmd === 'add') {
  const [email, role = 'agent', agentName] = args;
  if (!email) { console.error('Usage: add <email> <role> [agentName]'); process.exit(1); }
  if (!VALID_ROLES.has(role)) { console.error(`❌  Invalid role "${role}".`); process.exit(1); }
  if (!email.includes('@')) { console.error('❌  Email must contain @'); process.exit(1); }

  const cfg = await loadConfig();
  const users = cfg.users || [];
  const existing = users.findIndex(u => (u.email || u.username || '').toLowerCase() === email.toLowerCase());

  if (existing >= 0) {
    // Update existing
    const prev = users[existing].role || 'agent';
    users[existing] = { ...users[existing], role, isAdmin: role === 'admin', ...(agentName && { agentName }) };
    cfg.users = users;
    await saveConfig(cfg);
    console.log(`\n  ✅  Updated existing user — ${email}  ${prev} → ${role}\n`);
  } else {
    // Add new
    users.push({ username: email, email, role, isAdmin: role === 'admin', ...(agentName && { agentName }) });
    cfg.users = users;
    await saveConfig(cfg);
    console.log(`\n  ✅  Added ${email} as ${role}\n`);
  }
  printTable(users);
  process.exit(0);
}

// ── remove ────────────────────────────────────────────────────────────────────
if (cmd === 'remove') {
  const [email] = args;
  if (!email) { console.error('Usage: remove <email>'); process.exit(1); }

  const cfg = await loadConfig();
  const before = (cfg.users || []).length;
  cfg.users = (cfg.users || []).filter(u => (u.email || u.username || '').toLowerCase() !== email.toLowerCase());

  if (cfg.users.length === before) {
    console.error(`❌  User "${email}" not found.`);
    process.exit(1);
  }

  await saveConfig(cfg);
  console.log(`\n  ✅  Removed ${email}\n`);
  printTable(cfg.users);
  process.exit(0);
}

console.error(`❌  Unknown command "${cmd}". Run with "help" to see usage.`);
process.exit(1);
