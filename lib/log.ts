/**
 * lib/log.ts — lightweight structured logger
 *
 * Outputs one JSON line per call to stdout/stderr.
 * Vercel captures console output and makes it searchable in the Logs tab.
 *
 * Usage:
 *   import { log } from '@/lib/log';
 *   log.info('route-name', 'description', { key: value });
 *
 * HOC usage:
 *   export const GET = withLogging('cx/qa/analytics', async (req) => { ... });
 */

import type { NextRequest, NextResponse } from 'next/server';

type Level = 'debug' | 'info' | 'warn' | 'error';

export interface LogCtx {
  [key: string]: unknown;
}

function emit(level: Level, route: string, msg: string, ctx?: LogCtx) {
  const entry = {
    ts:    new Date().toISOString(),
    level,
    route,
    msg,
    ...ctx,
  };
  const line = JSON.stringify(entry);
  if      (level === 'error') console.error(line);
  else if (level === 'warn')  console.warn(line);
  else                        console.log(line);
}

export const log = {
  debug: (route: string, msg: string, ctx?: LogCtx) => emit('debug', route, msg, ctx),
  info:  (route: string, msg: string, ctx?: LogCtx) => emit('info',  route, msg, ctx),
  warn:  (route: string, msg: string, ctx?: LogCtx) => emit('warn',  route, msg, ctx),
  error: (route: string, msg: string, ctx?: LogCtx) => emit('error', route, msg, ctx),
};

/**
 * withLogging — wraps a Next.js App Router handler to log:
 *   - request  (method, path, reqId)
 *   - response (status, durationMs)
 *   - unhandled errors (err, durationMs)
 *
 * Works for GET, POST, PATCH, DELETE, etc.
 */
export function withLogging<T extends unknown[]>(
  route: string,
  handler: (req: NextRequest, ...args: T) => Response | NextResponse | Promise<Response | NextResponse>
): (req: NextRequest, ...args: T) => Promise<Response | NextResponse> {
  return async (req: NextRequest, ...args: T): Promise<Response | NextResponse> => {
    const start = Date.now();
    const reqId =
      req.headers.get('x-vercel-id') ??
      req.headers.get('x-request-id') ??
      Math.random().toString(36).slice(2, 10);

    log.info(route, 'request', {
      method: req.method,
      path:   req.nextUrl.pathname,
      reqId,
    });

    try {
      const res = await handler(req, ...args);
      log.info(route, 'response', {
        status:     res.status,
        durationMs: Date.now() - start,
        reqId,
      });
      return res;
    } catch (e: any) {
      log.error(route, 'unhandled', {
        err:        e?.message ?? String(e),
        durationMs: Date.now() - start,
        reqId,
      });
      throw e;
    }
  };
}

import { storeAppendLog, storeGetLogs } from './store';

export interface LogEntry {
  timestamp: string;
  username: string;
  query: string;
  model: string;
  category?: string;
  queryType?: string;
}

export async function logChatMessage(
  username: string,
  query: string,
  model: string,
  category?: string,
  queryType?: string
): Promise<void> {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    username,
    query,
    model,
    ...(category ? { category } : {}),
    ...(queryType ? { queryType } : {}),
  };
  // Log metadata only — never the raw query text which may contain customer PII.
  console.log('[IR_LOG]', JSON.stringify({
    timestamp: entry.timestamp,
    username: entry.username,
    model: entry.model,
    category: entry.category,
    queryType: entry.queryType,
    queryLen: entry.query?.length ?? 0
  }));
  // KV (Vercel) + file (local) in parallel
  await Promise.allSettled([
    storeAppendLog(entry),
    appendToFile(entry),
  ]);
}

async function appendToFile(entry: LogEntry): Promise<void> {
  try {
    const fs = require('fs');
    const path = require('path');
    const logPath = path.join(process.cwd(), 'ir-logs.jsonl');
    fs.appendFileSync(logPath, JSON.stringify(entry) + '\n');
  } catch {}
}

export async function readLogs(): Promise<LogEntry[]> {
  // KV first
  const kvItems = await storeGetLogs();
  if (kvItems.length > 0) {
    return kvItems.map(item => (typeof item === 'string' ? JSON.parse(item) : item));
  }
  // Fall back to file
  try {
    const fs = require('fs');
    const path = require('path');
    const logPath = path.join(process.cwd(), 'ir-logs.jsonl');
    if (!fs.existsSync(logPath)) return [];
    return fs
      .readFileSync(logPath, 'utf-8')
      .split('\n')
      .filter(Boolean)
      .map((line: string) => JSON.parse(line))
      .reverse()
      .slice(0, 500);
  } catch {
    return [];
  }
}

