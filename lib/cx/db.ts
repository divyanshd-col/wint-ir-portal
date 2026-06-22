// Requires POSTGRES_URL or POSTGRES_URL_NON_POOLING env var (Vercel / Neon).
// For Neon serverless, non-pooling connection is more reliable than PgBouncer pooled URL.
import { Pool } from 'pg';
import { log } from '@/lib/log';

const SLOW_QUERY_MS = 500;

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    // Prefer non-pooling URL for serverless (avoids PgBouncer transaction-mode issues)
    const connectionString =
      process.env.POSTGRES_URL_NON_POOLING ||
      process.env.POSTGRES_URL;

    if (!connectionString) {
      throw new Error('Missing POSTGRES_URL or POSTGRES_URL_NON_POOLING environment variable');
    }

    pool = new Pool({
      connectionString,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: true } : false,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });

    pool.on('error', (err) => {
      console.error('[db] Unexpected pool error:', err.message);
      pool = null; // force re-creation on next call
    });
  }
  return pool;
}

export async function query<T = any>(sql: string, params?: any[]): Promise<T[]> {
  const t0 = Date.now();
  const client = await getPool().connect();
  try {
    const result = await client.query(sql, params);
    const ms = Date.now() - t0;
    if (ms > SLOW_QUERY_MS) {
      log.warn('db', 'slow query', { durationMs: ms, preview: sql.replace(/\s+/g, ' ').slice(0, 80) });
    }
    return result.rows as T[];
  } finally {
    client.release();
  }
}
