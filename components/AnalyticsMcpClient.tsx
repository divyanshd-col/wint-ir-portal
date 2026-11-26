'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import PageNav from '@/components/PageNav';

interface ConnectionRow {
  userId: number;
  userEmail: string;
  userName: string;
  clientId: string;
  clientName: string | null;
  connectedAt: string;
  lastUsedAt: string | null;
  active: boolean;
}

interface TokenRow {
  id: string;
  label: string;
  userId: number;
  userEmail: string;
  userName: string;
  createdAt: string;
  createdBy: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

interface EligibleUser {
  user_id: number;
  name: string;
  email: string;
  role: string;
}

interface Props {
  username: string;
  role: string;
  isAdmin: boolean;
  flags: { callAnalysis?: boolean; cxDashboard?: boolean };
  mcpUrl: string;
  /** Shown as a popup: no sidebar, and it does not size itself to the screen. */
  inModal?: boolean;
  /** Other Analytics pages this user can open (listed in the popup, which has no sidebar). */
  otherPages?: { href: string; label: string }[];
}

const cardCls = 'bg-white border border-gray-200 rounded-2xl p-6 shadow-sm';
const btnCls =
  'inline-flex items-center gap-2 rounded-xl bg-[#1f7a4d] px-4 py-2 text-sm font-medium text-white hover:bg-[#268544] disabled:opacity-50 transition-colors';
const inputCls =
  'border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-[#1f7a4d]/30';

function fmtDate(s: string | null): string {
  if (!s) return '—';
  try {
    return new Date(s).toLocaleString();
  } catch {
    return s;
  }
}

export default function AnalyticsMcpClient({ username, role, isAdmin, flags, mcpUrl, inModal = false, otherPages = [] }: Props) {
  return (
    <div className={inModal ? 'bg-[#f7f8f7]' : 'min-h-screen bg-[#f7f8f7] flex'}>
      {!inModal && <PageNav username={username} role={role} isAdmin={isAdmin} flags={flags} />}

      <main className={`flex-1 min-w-0 px-6 py-8 ${inModal ? 'pr-14' : 'lg:px-10'}`}>
        <div className="mx-auto max-w-3xl space-y-6">
          <header>
            <h1 className="text-2xl font-semibold text-gray-900">Analytics via Claude</h1>
            <p className="mt-2 text-sm text-gray-600">
              Ask questions about the CX database in plain English, right inside Claude. Connect
              once, then ask anything. Claude reads the database schema and runs read-only queries
              against the live database to answer.
            </p>
          </header>

          <ConnectInstructions mcpUrl={mcpUrl} />

          {isAdmin && <ConnectionsManager />}

          {isAdmin && <TokenManager mcpUrl={mcpUrl} />}

          <SafetyNote />

          {inModal && otherPages.length > 0 && (
            <nav aria-label="Other analytics pages" className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
              <span className="text-gray-500">Also in Analytics:</span>
              {otherPages.map(p => <Link key={p.href} href={p.href} className="font-medium text-[#1f7a4d] hover:underline">{p.label}</Link>)}
            </nav>
          )}
        </div>
      </main>
    </div>
  );
}

function ConnectInstructions({ mcpUrl }: { mcpUrl: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(mcpUrl).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => {},
    );
  };

  const step = (n: number, content: ReactNode) => (
    <li className="flex gap-3">
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#1f7a4d]/10 text-xs font-semibold text-[#1f7a4d]">
        {n}
      </span>
      <div className="min-w-0 flex-1">{content}</div>
    </li>
  );

  return (
    <div className={cardCls}>
      <h2 className="text-base font-semibold text-gray-900">Connect it to Claude</h2>
      <p className="mt-1 text-sm text-gray-600">
        In Claude (claude.ai or the desktop app), go to <strong>Settings → Connectors → Add custom
        connector</strong>, then:
      </p>
      <ol className="mt-3 space-y-3 text-sm text-gray-700">
        {step(
          1,
          <>
            <div>Paste this as the connector URL:</div>
            <div className="mt-1 flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-lg bg-gray-50 px-3 py-2 font-mono text-xs text-gray-800 border border-gray-200">
                {mcpUrl}
              </code>
              <button type="button" onClick={copy} className={btnCls}>
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </>,
        )}
        {step(
          2,
          <>
            Click <strong>Connect</strong>. Claude opens a Wint sign-in. Log in with your Wint
            email, the same one you use here.
          </>,
        )}
        {step(
          3,
          <>
            Approve the access request. That&apos;s it. There&apos;s no token to copy or paste.
          </>,
        )}
        {step(
          4,
          <>
            Start a new chat and ask, e.g.{' '}
            <em>&ldquo;How many conversations last week had a bad CSAT, by team?&rdquo;</em> Claude
            calls <code className="font-mono text-xs">get_schema</code>, then{' '}
            <code className="font-mono text-xs">run_read_query</code>, and answers from live data.
          </>,
        )}
      </ol>
    </div>
  );
}

function SafetyNote() {
  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
      <h3 className="text-sm font-semibold text-amber-900">Good to know</h3>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-800">
        <li>The connection is strictly read-only. Claude can query data but never change it.</li>
        <li>Phone numbers stay masked (last 4 digits only) in results.</li>
        <li>Every query is logged in the analytics audit trail against your account.</li>
        <li>Sign-in uses your Wint account. An admin can revoke any connection instantly.</li>
      </ul>
    </div>
  );
}

function ConnectionsManager() {
  const [connections, setConnections] = useState<ConnectionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/mcp-connections');
      if (!res.ok) throw new Error('Failed to load connections');
      const data = await res.json();
      setConnections(data.connections ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const revoke = async (c: ConnectionRow) => {
    if (
      !confirm(
        `Revoke ${c.userName}'s connection? Claude will lose access right away and they'll need to sign in again to reconnect.`,
      )
    ) {
      return;
    }
    try {
      const res = await fetch('/api/admin/mcp-connections', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: c.userId, clientId: c.clientId }),
      });
      if (!res.ok) throw new Error('Failed to revoke');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to revoke');
    }
  };

  return (
    <div className={cardCls}>
      <h2 className="text-base font-semibold text-gray-900">Connected apps</h2>
      <p className="mt-1 text-sm text-gray-600">
        Every connection made through the sign-in flow shows up here. Revoke any one to cut off its
        access right away.
      </p>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      <div className="mt-4">
        {loading ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : connections.length === 0 ? (
          <p className="text-sm text-gray-500">No connections yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-400">
                  <th className="py-2 pr-4 font-medium">User</th>
                  <th className="py-2 pr-4 font-medium">App</th>
                  <th className="py-2 pr-4 font-medium">Connected</th>
                  <th className="py-2 pr-4 font-medium">Last used</th>
                  <th className="py-2 pr-4 font-medium">Status</th>
                  <th className="py-2 pr-0 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {connections.map((c) => (
                  <tr key={`${c.userId}:${c.clientId}`} className="border-b border-gray-100 last:border-0">
                    <td className="py-2 pr-4 text-gray-800">
                      {c.userName}
                      <span className="block text-xs text-gray-400">{c.userEmail}</span>
                    </td>
                    <td className="py-2 pr-4 text-gray-600">{c.clientName || 'Claude'}</td>
                    <td className="py-2 pr-4 text-gray-500">{fmtDate(c.connectedAt)}</td>
                    <td className="py-2 pr-4 text-gray-500">{fmtDate(c.lastUsedAt)}</td>
                    <td className="py-2 pr-4">
                      <span
                        className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${
                          c.active
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                            : 'border-gray-200 bg-gray-100 text-gray-500'
                        }`}
                      >
                        {c.active ? 'Active' : 'Revoked'}
                      </span>
                    </td>
                    <td className="py-2 pr-0 text-right">
                      {c.active && (
                        <button
                          type="button"
                          onClick={() => revoke(c)}
                          className="text-xs font-medium text-red-600 hover:text-red-700"
                        >
                          Revoke
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function TokenManager({ mcpUrl }: { mcpUrl: string }) {
  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [users, setUsers] = useState<EligibleUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState('');
  const [label, setLabel] = useState('');
  const [creating, setCreating] = useState(false);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/mcp-tokens');
      if (!res.ok) throw new Error('Failed to load tokens');
      const data = await res.json();
      setTokens(data.tokens ?? []);
      setUsers(data.eligibleUsers ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const create = async () => {
    setError(null);
    setNewToken(null);
    if (!userId || !label.trim()) {
      setError('Pick a user and enter a label.');
      return;
    }
    setCreating(true);
    try {
      const res = await fetch('/api/admin/mcp-tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: Number(userId), label: label.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create token');
      setNewToken(data.token);
      setLabel('');
      setUserId('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create token');
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (id: string) => {
    if (!confirm('Revoke this token? Any IDE using it stops working right away.')) return;
    try {
      const res = await fetch(`/api/admin/mcp-tokens/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to revoke');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to revoke');
    }
  };

  const configSnippet = (token: string) =>
    JSON.stringify(
      { mcpServers: { 'wint-analytics': { serverUrl: mcpUrl, headers: { Authorization: `Bearer ${token}` } } } },
      null,
      2,
    );

  return (
    <div className={cardCls}>
      <h2 className="text-base font-semibold text-gray-900">Personal access tokens (for IDEs)</h2>
      <p className="mt-1 text-sm text-gray-600">
        For MCP clients that connect with a token instead of the sign-in flow — like Antigravity or
        Cursor. Generate a token for an admin or TL, then paste it into the client&apos;s config. The
        token is shown once, so copy it right away and hand it over securely.
      </p>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-500">
          User
          <select className={inputCls} value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">Select a user…</option>
            {users.map((u) => (
              <option key={u.user_id} value={u.user_id}>
                {u.name} ({u.role}) — {u.email}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-1 flex-col gap-1 text-xs font-medium text-gray-500">
          Label
          <input
            className={inputCls}
            placeholder="e.g. Antigravity — Divyansh"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={120}
          />
        </label>
        <button type="button" onClick={create} disabled={creating} className={btnCls}>
          {creating ? 'Generating…' : 'Generate token'}
        </button>
      </div>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      {newToken && (
        <div className="mt-4 rounded-xl border border-[#1f7a4d]/30 bg-[#1f7a4d]/5 p-4">
          <div className="text-xs font-semibold text-[#1f7a4d]">
            Copy this now — it won&apos;t be shown again
          </div>
          <div className="mt-2 flex items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded-lg bg-white px-3 py-2 font-mono text-xs text-gray-800 border border-gray-200">
              {newToken}
            </code>
            <button type="button" className={btnCls} onClick={() => navigator.clipboard?.writeText(newToken)}>
              Copy
            </button>
          </div>
          <div className="mt-3 text-xs font-medium text-gray-500">
            Antigravity — paste into <code className="font-mono">~/.gemini/config/mcp_config.json</code>:
          </div>
          <div className="mt-1 flex items-start gap-2">
            <pre className="min-w-0 flex-1 overflow-x-auto rounded-lg bg-white px-3 py-2 font-mono text-xs text-gray-800 border border-gray-200">
              {configSnippet(newToken)}
            </pre>
            <button
              type="button"
              className={btnCls}
              onClick={() => navigator.clipboard?.writeText(configSnippet(newToken))}
            >
              Copy
            </button>
          </div>
        </div>
      )}

      <div className="mt-6">
        {loading ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : tokens.length === 0 ? (
          <p className="text-sm text-gray-500">No tokens yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-400">
                  <th className="py-2 pr-4 font-medium">Label</th>
                  <th className="py-2 pr-4 font-medium">User</th>
                  <th className="py-2 pr-4 font-medium">Created</th>
                  <th className="py-2 pr-4 font-medium">Last used</th>
                  <th className="py-2 pr-4 font-medium">Status</th>
                  <th className="py-2 pr-0 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {tokens.map((t) => {
                  const revoked = !!t.revokedAt;
                  return (
                    <tr key={t.id} className="border-b border-gray-100 last:border-0">
                      <td className="py-2 pr-4 text-gray-800">{t.label}</td>
                      <td className="py-2 pr-4 text-gray-600">
                        {t.userName}
                        <span className="block text-xs text-gray-400">{t.userEmail}</span>
                      </td>
                      <td className="py-2 pr-4 text-gray-500">{fmtDate(t.createdAt)}</td>
                      <td className="py-2 pr-4 text-gray-500">{fmtDate(t.lastUsedAt)}</td>
                      <td className="py-2 pr-4">
                        <span
                          className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${
                            revoked
                              ? 'border-gray-200 bg-gray-100 text-gray-500'
                              : 'border-emerald-200 bg-emerald-50 text-emerald-700'
                          }`}
                        >
                          {revoked ? 'Revoked' : 'Active'}
                        </span>
                      </td>
                      <td className="py-2 pr-0 text-right">
                        {!revoked && (
                          <button
                            type="button"
                            onClick={() => revoke(t.id)}
                            className="text-xs font-medium text-red-600 hover:text-red-700"
                          >
                            Revoke
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
