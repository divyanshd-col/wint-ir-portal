// Requires POSTGRES_URL or POSTGRES_URL_NON_POOLING env var (Vercel / Neon).
// For Neon serverless, non-pooling connection is more reliable than PgBouncer pooled URL.
import { Pool, PoolClient } from 'pg';
import dns from 'dns';
import { log } from '@/lib/log';

// Resilient DNS resolution fallback: if local ISP / hotspot DNS refuses neon.tech, fallback to 8.8.8.8 / 1.1.1.1
if (typeof globalThis !== 'undefined' && !(globalThis as any)._neon_dns_installed) {
  (globalThis as any)._neon_dns_installed = true;
  const { Resolver } = dns;
  const fallbackResolver = new Resolver();
  fallbackResolver.setServers(['8.8.8.8', '1.1.1.1', '8.8.4.4']);

  const origLookup = dns.lookup;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (dns as any).lookup = function (hostname: string, options: any, callback?: any) {
    let cb = callback;
    let opt = options;
    if (typeof options === 'function') {
      cb = options;
      opt = {};
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    origLookup(hostname, opt, (err: any, address: any, family: any) => {
      if (!err && address) {
        return cb(null, address, family);
      }
      if (hostname && (hostname.includes('neon.tech') || hostname.includes('aws.'))) {
        fallbackResolver.resolve4(hostname, (rErr, addresses) => {
          if (!rErr && addresses && addresses.length) {
            if (opt && opt.all) {
              return cb(null, addresses.map((a) => ({ address: a, family: 4 })));
            }
            return cb(null, addresses[0], 4);
          }
          cb(err || rErr);
        });
      } else {
        cb(err, address, family);
      }
    });
  };
}

const SLOW_QUERY_MS = 500;

declare global {
  // eslint-disable-next-line no-var
  var _cx_db_pool: Pool | undefined;
}

export function getPool(): Pool {
  if (!globalThis._cx_db_pool) {
    // Prefer non-pooling URL for serverless (avoids PgBouncer transaction-mode issues)
    const connectionString =
      process.env.POSTGRES_URL_NON_POOLING ||
      process.env.POSTGRES_URL;

    if (!connectionString) {
      throw new Error('Missing POSTGRES_URL or POSTGRES_URL_NON_POOLING environment variable');
    }

    const newPool = new Pool({
      connectionString,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: true } : false,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 15000,
    });

    newPool.on('connect', (client) => {
      client.on('error', () => {
        // Prevent idle client disconnection from bubbling as uncaughtException
      });
    });

    newPool.on('error', (err) => {
      console.warn('[db] Pool error:', err.message);
      globalThis._cx_db_pool = undefined;
    });

    globalThis._cx_db_pool = newPool;
  }
  return globalThis._cx_db_pool;
}

async function connectWithRetry(): Promise<PoolClient> {
  try {
    return await getPool().connect();
  } catch (err) {
    console.warn('[db] Connection attempt 1 failed, retrying in 300ms:', (err as Error)?.message);
    await new Promise((r) => setTimeout(r, 300));
    try {
      return await getPool().connect();
    } catch (err2) {
      console.warn('[db] Connection attempt 2 failed, recycling pool:', (err2 as Error)?.message);
      if (globalThis._cx_db_pool) {
        try { await globalThis._cx_db_pool.end(); } catch {}
        globalThis._cx_db_pool = undefined;
      }
      return await getPool().connect();
    }
  }
}

export async function query<T = any>(sql: string, params?: any[]): Promise<T[]> {
  const t0 = Date.now();
  const client = await connectWithRetry();
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

// A client bound to a single transaction — same query(sql, params) shape as
// the module-level `query()`, but scoped to the caller's BEGIN/COMMIT.
export interface TxClient {
  query<T = any>(sql: string, params?: any[]): Promise<T[]>;
}

/**
 * Runs `fn` inside a BEGIN/COMMIT transaction on a single dedicated client.
 * Rolls back and rethrows on any error. Use for multi-statement mutations
 * that must not partially apply (e.g. user creation + audit write).
 */
export async function withTransaction<T>(fn: (tx: TxClient) => Promise<T>): Promise<T> {
  const client = await connectWithRetry();
  try {
    await client.query('BEGIN');
    const tx: TxClient = {
      query: async (sql, params) => (await client.query(sql, params)).rows,
    };
    const result = await fn(tx);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Runs `fn` using a single leased client from the pool.
 * Prevents connection pool starvation when executing multiple queries.
 */
export async function withClient<T>(fn: (db: TxClient) => Promise<T>): Promise<T> {
  const client = await connectWithRetry();
  try {
    const db: TxClient = {
      query: async (sql, params) => (await client.query(sql, params)).rows,
    };
    return await fn(db);
  } finally {
    client.release();
  }
}
// Hot-reload trigger.
