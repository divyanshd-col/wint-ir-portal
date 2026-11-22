import { query } from '@/lib/cx/db';

// Read-only SQL execution and audit logging for the MCP endpoint (app/api/mcp/[transport]/route.ts).

const QUERY_TIMEOUT_MS = 30_000;
const ROW_CAP = 10_000;

// DML keywords that must never appear in an analytics query, even inside a CTE.
const DML_PATTERN = /\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|CREATE|GRANT|REVOKE|COPY|CALL|EXECUTE)\b/i;

export function isReadQuery(sql: string): boolean {
  const t = sql.trim().toUpperCase();
  if (!t.startsWith('SELECT') && !t.startsWith('WITH')) return false;
  // Reject any SQL that contains DML keywords (covers "WITH … DELETE … RETURNING" bypass).
  if (DML_PATTERN.test(sql)) return false;
  // Reject multi-statement injection (semicolon followed by non-whitespace).
  if (/;\s*\S/.test(sql)) return false;
  return true;
}

function stripHeavyColumns(rows: any[]): void {
  for (const row of rows) {
    delete row.raw_payload;
    delete row.transcript;
  }
}

// ── Read-only execution ───────────────────────────────────────────────────────
// Returns rows exactly as selected, so Claude-composed SQL answers truthfully. Enforces the 30s timeout and the 10k
// row cap, and strips only the heavy/sensitive raw_payload + transcript columns.
export async function executeReadOnlyQuery(
  sql: string,
): Promise<{ rows: any[]; rowCount: number; latencyMs: number }> {
  const start = Date.now();

  const rows = await Promise.race([
    query<any>(sql, []),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error('Query timed out after 30 seconds. Try narrowing the time range.')),
        QUERY_TIMEOUT_MS,
      ),
    ),
  ]);

  if (rows.length > ROW_CAP) {
    throw new Error(
      `Result too large (${rows.length.toLocaleString()} rows, cap ${ROW_CAP.toLocaleString()}). Add a LIMIT or more filters.`,
    );
  }

  stripHeavyColumns(rows);

  return { rows, rowCount: rows.length, latencyMs: Date.now() - start };
}

// ── Audit log ─────────────────────────────────────────────────────────────────

export async function writeAuditLog(data: {
  userEmail: string;
  queryText: string;
  queryType: 1 | 2;
  templateId: string | null;
  rowCount: number;
  latencyMs: number;
}): Promise<void> {
  try {
    await query(
      `INSERT INTO analytics_audit_log
         (user_email, query_text, query_type, template_id, row_count, latency_ms)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [data.userEmail, data.queryText, data.queryType, data.templateId, data.rowCount, data.latencyMs],
    );
  } catch (err: any) {
    // Non-fatal — log but don't surface to user
    console.error('[analytics] audit log write failed:', err?.message);
  }
}
