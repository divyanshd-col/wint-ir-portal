import { createMcpHandler, withMcpAuth } from 'mcp-handler';
import { z } from 'zod';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { DB_SCHEMA } from '@/lib/analytics/schema';
import { executeReadOnlyQuery, writeAuditLog, isReadQuery } from '@/lib/analytics/executor';
import { verifyToken as verifyMcpToken } from '@/lib/mcp/tokens';

// pg needs a TCP socket → Node runtime, not Edge. maxDuration mirrors the
// analytics functions (30s query timeout + headroom).
export const runtime = 'nodejs';
export const maxDuration = 60;

// ── Read-only guard ────────────────────────────────────────────────────────────
// The executor does not block writes on its own. Since Claude composes arbitrary
// SQL here, validate first. Combines the executor's DML/multi-statement guard
// (isReadQuery) with the text-to-sql pg_*/information_schema block.
const CATALOG_PATTERN = /\bPG_[A-Z_]+\b|\bINFORMATION_SCHEMA\b/i;

function assertReadOnly(sql: string): string | null {
  if (!isReadQuery(sql)) {
    return 'Only a single read-only SELECT (or WITH … SELECT) statement is allowed. Writes, DDL, and multiple statements are rejected.';
  }
  if (CATALOG_PATTERN.test(sql)) {
    return 'Access to pg_* catalog tables and information_schema is not allowed.';
  }
  return null;
}

// ── PII masking ────────────────────────────────────────────────────────────────
// Product / CEO audience: never surface raw phone numbers. executeReadOnlyQuery
// already strips raw_payload + transcript; this masks any phone-like column to
// its last 4 digits. Relax by removing this pass if fuller access is approved.
const PHONE_KEY = /(^|_)phone$/i;

function maskPhoneValue(value: unknown): unknown {
  if (typeof value !== 'string' || value.length === 0) return value;
  const digits = value.replace(/\D/g, '');
  if (digits.length < 4) return '••••';
  return `••••${digits.slice(-4)}`;
}

function maskRow(row: Record<string, unknown>): void {
  for (const key of Object.keys(row)) {
    if (PHONE_KEY.test(key)) row[key] = maskPhoneValue(row[key]);
  }
}

// ── MCP server ─────────────────────────────────────────────────────────────────

const handler = createMcpHandler(
  (server) => {
    server.tool(
      'get_schema',
      'Return the full schema of the Wint Wealth CX analytics database (tables, columns, JSONB access patterns, and join rules). Call this before writing SQL so you use correct table/column names.',
      {},
      async () => ({
        content: [{ type: 'text' as const, text: DB_SCHEMA.trim() }],
      }),
    );

    server.tool(
      'run_read_query',
      'Run a single read-only PostgreSQL SELECT against the live CX analytics database and return the rows as JSON. Only SELECT / WITH…SELECT is permitted — writes, DDL, catalog access, and multiple statements are rejected. Results are capped at 10,000 rows and time out after 30s. Phone numbers are masked. Call get_schema first for table and column names.',
      { sql: z.string().describe('A single read-only SQL SELECT statement.') },
      async ({ sql }, extra) => {
        const auth = (extra as { authInfo?: AuthInfo }).authInfo;
        const userEmail = (auth?.extra?.email as string) || 'mcp:unknown';

        const violation = assertReadOnly(sql);
        if (violation) {
          return {
            content: [{ type: 'text' as const, text: `Rejected: ${violation}` }],
            isError: true,
          };
        }

        try {
          const { rows, rowCount, latencyMs } = await executeReadOnlyQuery(sql);
          for (const row of rows) maskRow(row as Record<string, unknown>);

          // Audit every MCP query alongside the in-app analytics queries.
          writeAuditLog({
            userEmail,
            queryText: `[mcp] ${sql}`.slice(0, 8000),
            queryType: 1,
            templateId: 'mcp',
            rowCount,
            latencyMs,
          }).catch(() => {});

          return {
            content: [
              { type: 'text' as const, text: JSON.stringify({ rowCount, rows }, null, 2) },
            ],
          };
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            content: [{ type: 'text' as const, text: `Query error: ${message}` }],
            isError: true,
          };
        }
      },
    );
  },
  {
    serverInfo: { name: 'wint-analytics', version: '1.0.0' },
    capabilities: { tools: {} },
  },
  {
    // Route lives at app/api/mcp/[transport]/route.ts → streamable endpoint is
    // {basePath}/mcp = /api/mcp/mcp. SSE disabled (no Redis needed).
    basePath: '/api/mcp',
    maxDuration: 60,
    disableSse: true,
    verboseLogs: false,
  },
);

// ── Bearer-token auth (opaque tokens minted in Settings, not NextAuth) ──────────

async function verifyBearer(_req: Request, bearerToken?: string): Promise<AuthInfo | undefined> {
  const user = await verifyMcpToken(bearerToken);
  if (!user) return undefined;
  return {
    token: bearerToken as string,
    clientId: `user:${user.userId}`,
    scopes: ['analytics:read'],
    extra: {
      email: user.email,
      name: user.name,
      role: user.role,
      userId: user.userId,
    },
  };
}

const authHandler = withMcpAuth(handler, verifyBearer, { required: true });

export { authHandler as GET, authHandler as POST, authHandler as DELETE };
