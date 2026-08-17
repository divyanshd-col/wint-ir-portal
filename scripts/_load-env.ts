/**
 * Side-effect module: loads .env.local into process.env.
 *
 * MUST be imported FIRST (before any `@/lib/*` import) in scripts that read
 * config/KV. Several lib modules (e.g. lib/store.ts) capture env vars into
 * module-level constants at import time, so if .env.local is loaded after
 * those imports, they see empty values. ES modules evaluate imported modules
 * in source order, so `import './_load-env'` at the top guarantees the env is
 * populated before the lib modules are evaluated.
 */
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const envFile = join(ROOT, '.env.local');

if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf-8').split('\n')) {
    const m = line.match(/^([^#=\s]+)\s*=\s*"?(.+?)"?\s*$/);
    // Don't clobber vars already set in the real environment.
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}
