'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
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

interface Props {
  username: string;
  role: string;
  isAdmin: boolean;
  flags: { callAnalysis?: boolean; cxDashboard?: boolean };
  mcpUrl: string;
}

const cardCls = 'bg-white border border-gray-200 rounded-2xl p-6 shadow-sm';
const btnCls =
  'inline-flex items-center gap-2 rounded-xl bg-[#2d9e4f] px-4 py-2 text-sm font-medium text-white hover:bg-[#268544] disabled:opacity-50 transition-colors';

function fmtDate(s: string | null): string {
  if (!s) return '—';
  try {
    return new Date(s).toLocaleString();
  } catch {
    return s;
  }
}

export default function AnalyticsMcpClient({ username, role, isAdmin, flags, mcpUrl }: Props) {
  return (
    <div className="min-h-screen bg-[#f7f8f7] flex">
      <PageNav username={username} role={role} isAdmin={isAdmin} flags={flags} />

      <main className="flex-1 min-w-0 px-6 py-8 lg:px-10">
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

          <SafetyNote />
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
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#2d9e4f]/10 text-xs font-semibold text-[#2d9e4f]">
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
            Click <strong>Connect</strong>. Claude opens a Wint sign-in — log in with your Wint
            email, the same one you use here.
          </>,
        )}
        {step(
          3,
          <>
            Approve the access request. That&apos;s it — there&apos;s no token to copy or paste.
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
