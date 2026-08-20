import { createMcpHandler, withMcpAuth } from 'mcp-handler';
import { z } from 'zod';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { DB_SCHEMA } from '@/lib/analytics/schema';
import { executeReadOnlyQuery, writeAuditLog, isReadQuery } from '@/lib/analytics/executor';
import { verifyAccessToken, OAUTH_SCOPE } from '@/lib/mcp/oauth';
import { readTranscripts } from '@/lib/analytics/transcript-reader';

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

// Mask phone-number-like digit runs inside free text (transcript message bodies),
// preserving the last 4 digits — the column-based maskRow above can't reach text.
function maskPhonesInText(text: string): string {
  if (!text) return text;
  return text.replace(/\+?\d[\d\s-]{8,}\d/g, (m) => {
    const digits = m.replace(/\D/g, '');
    if (digits.length < 10 || digits.length > 15) return m; // not phone-like
    return `••••${digits.slice(-4)}`;
  });
}

// PII redaction hook for transcript message content. Currently phone-only, to
// keep the connector's "phone numbers stay masked" guarantee. Broader free-text
// PII redaction (emails, PANs, account numbers, names) is a pending product
// decision — extend this one function when that's decided.
function redactTranscriptText(text: string): string {
  return maskPhonesInText(text);
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
      'Run a single read-only PostgreSQL SELECT against the live CX analytics database and return the rows as JSON. Use this for counts, metrics, breakdowns, trends, and to find the chat_ids relevant to a question. Only SELECT / WITH…SELECT is permitted — writes, DDL, catalog access, and multiple statements are rejected. Results are capped at 10,000 rows and time out after 30s. Phone numbers are masked. The transcript column is NOT returned here — to read what was actually said, first narrow to chat_ids with this tool (you can filter on content with WHERE c.transcript::text ILIKE \'%keyword%\'), then call get_transcripts with those ids. Call get_schema first for table and column names.',
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

    server.tool(
      'get_transcripts',
      "Fetch full message-by-message transcripts for specific conversations by chat_id — for questions that depend on what was actually said (tone, verbatim quotes, root cause, why CSAT was bad, recurring themes across chats). This is NOT for counts or metrics: use run_read_query first to find the relevant chat_ids (filter by disposition/CSAT/date, or WHERE c.transcript::text ILIKE '%keyword%'), then pass up to 50 ids here. Only fetch transcripts when the answer genuinely needs their content. Phone numbers are masked; very large transcripts are truncated (flagged per conversation).",
      {
        chat_ids: z
          .array(z.string().min(1))
          .min(1)
          .max(50)
          .describe('conversations.id values to fetch transcripts for (max 50). Narrow with run_read_query first.'),
      },
      async ({ chat_ids }, extra) => {
        const auth = (extra as { authInfo?: AuthInfo }).authInfo;
        const userEmail = (auth?.extra?.email as string) || 'mcp:unknown';
        const t0 = Date.now();

        // Volume guards so a batch can't blow the model's context or dump data.
        const PER_TRANSCRIPT_CHAR_CAP = 20_000;
        const TOTAL_CHAR_BUDGET = 400_000;

        try {
          const convos = await readTranscripts(chat_ids);
          const found = new Set(convos.map((c) => c.conversation_id));

          const omitted: { conversation_id: string; reason: string }[] = chat_ids
            .filter((id) => !found.has(id))
            .map((id) => ({ conversation_id: id, reason: 'not_found' }));

          const transcripts: unknown[] = [];
          let totalChars = 0;

          for (const c of convos) {
            let used = 0;
            let truncated = false;
            const messages: { sender_type: string; content: string; timestamp: string }[] = [];
            for (const m of c.messages) {
              const content = redactTranscriptText(m.content || '');
              if (used + content.length > PER_TRANSCRIPT_CHAR_CAP) {
                truncated = true;
                break;
              }
              used += content.length;
              messages.push({ sender_type: m.sender_type, content, timestamp: m.timestamp });
            }

            if (totalChars + used > TOTAL_CHAR_BUDGET) {
              omitted.push({ conversation_id: c.conversation_id, reason: 'output_budget_exceeded' });
              continue;
            }
            totalChars += used;

            transcripts.push({
              conversation_id: c.conversation_id,
              csat_label: c.csat_label,
              csat_score: c.csat_score,
              disposition: c.disposition,
              sub_disposition: c.sub_disposition,
              iqs_score: c.iqs_score,
              message_count: c.messages.length,
              returned_messages: messages.length,
              truncated,
              messages,
            });
          }

          writeAuditLog({
            userEmail,
            queryText: `[mcp:transcripts] requested=${chat_ids.length} returned=${transcripts.length}`.slice(0, 8000),
            queryType: 1,
            templateId: 'mcp_transcripts',
            rowCount: transcripts.length,
            latencyMs: Date.now() - t0,
          }).catch(() => {});

          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(
                  { requested: chat_ids.length, returned: transcripts.length, omitted, transcripts },
                  null,
                  2,
                ),
              },
            ],
          };
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            content: [{ type: 'text' as const, text: `Transcript error: ${message}` }],
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

// ── OAuth bearer-token auth (tokens minted by the OAuth flow, not NextAuth) ─────
// Access tokens come from the OAuth authorization-code flow (app/api/oauth/*).
// The static wint_mcp_ token path has been retired — claude.ai's web connector
// authenticates via OAuth only. On failure, withMcpAuth emits a 401 whose
// WWW-Authenticate points at the protected-resource metadata below, which is how
// the connector discovers the authorization server.

async function verifyBearer(_req: Request, bearerToken?: string): Promise<AuthInfo | undefined> {
  const ctx = await verifyAccessToken(bearerToken);
  if (!ctx) return undefined;
  return {
    token: ctx.token,
    clientId: ctx.clientId,
    scopes: ctx.scope.split(/\s+/).filter(Boolean),
    expiresAt: ctx.expiresAt,
    resource: ctx.resource ? new URL(ctx.resource) : undefined,
    extra: {
      email: ctx.user.email,
      name: ctx.user.name,
      role: ctx.user.role,
      userId: ctx.user.userId,
    },
  };
}

const authHandler = withMcpAuth(handler, verifyBearer, {
  required: true,
  requiredScopes: [OAUTH_SCOPE],
  // The 401 WWW-Authenticate advertises this path so claude.ai can discover the
  // authorization server (served via a rewrite in next.config.ts).
  resourceMetadataPath: '/.well-known/oauth-protected-resource',
});

export { authHandler as GET, authHandler as POST, authHandler as DELETE };
