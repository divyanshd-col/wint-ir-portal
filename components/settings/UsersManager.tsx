'use client';

import React, { useEffect, useMemo, useState } from 'react';
import TimeAgo from '../TimeAgo';

export interface User {
  userId?: number;
  email: string;
  username?: string;
  name?: string;
  agentName?: string;
  role: string;
  isAdmin?: boolean;
  status?: 'invited' | 'active' | 'disabled';
  lastLogin?: string | null;
  dormant?: boolean;
}

type AgentAssignments = Record<string, { tl_name: string | null; qa_name: string | null }>;

interface UsersManagerProps {
  users: User[];
  setUsers: React.Dispatch<React.SetStateAction<User[]>>;
  agentAssignments: AgentAssignments;
  setAgentAssignments: React.Dispatch<React.SetStateAction<AgentAssignments>>;
  loadingUsers: boolean;
  reloadUsers: () => Promise<void>;
  showToast: (msg: string) => void;
}

const ROLE_OPTIONS: [string, string][] = [
  ['agent', 'Agent'],
  ['tl', 'TL'],
  ['quality', 'Quality'],
  ['admin', 'Admin'],
];

const STATUS_STYLES: Record<string, string> = {
  active: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  invited: 'bg-amber-50 text-amber-700 border-amber-200',
  disabled: 'bg-gray-100 text-gray-500 border-gray-200',
};

function roleLabel(role: string): string {
  return ROLE_OPTIONS.find(([v]) => v === role)?.[1] || role;
}

function initials(name: string, email: string): string {
  const src = name.trim() || email.split('@')[0] || '';
  const parts = src.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (src.slice(0, 2) || '?').toUpperCase();
}

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every(x => s.has(x));
}

export default function UsersManager({
  users, setUsers, agentAssignments, setAgentAssignments, loadingUsers, reloadUsers, showToast,
}: UsersManagerProps) {
  // ── Filters ────────────────────────────────────────────────────────────────
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  // ── QA disposition map (live source for the Dispositions column + editor) ───
  const [qaMap, setQaMap] = useState<{ email: string; dispositions: string[] }[]>([]);
  const [availableDispositions, setAvailableDispositions] = useState<string[]>([]);

  useEffect(() => {
    fetch('/api/cx/qa/disposition-config')
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (d) { setQaMap(d.map ?? []); setAvailableDispositions(d.availableDispositions ?? []); } })
      .catch(() => {});
  }, []);

  const dispositionsFor = (email: string): string[] =>
    qaMap.find(e => e.email.toLowerCase() === email.toLowerCase())?.dispositions ?? [];

  // ── Row action menu ──────────────────────────────────────────────────────────
  const [menuFor, setMenuFor] = useState<string | null>(null);

  // ── Invite modal ─────────────────────────────────────────────────────────────
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteRole, setInviteRole] = useState('agent');
  const [inviteDispositions, setInviteDispositions] = useState('');
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState('');

  const resetInviteForm = () => {
    setInviteEmail(''); setInviteName(''); setInviteRole('agent');
    setInviteDispositions(''); setInviteError('');
  };

  const submitInvite = async () => {
    if (!inviteEmail.trim() || !inviteName.trim()) return;
    setInviting(true);
    setInviteError('');
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: inviteEmail.trim(),
          name: inviteName.trim(),
          role: inviteRole,
          assignedDispositions: inviteDispositions.trim()
            ? inviteDispositions.split(',').map(d => d.trim()).filter(Boolean)
            : [],
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setInviteError(data.error || 'Failed to create user.'); return; }
      await reloadUsers();
      setInviteOpen(false);
      resetInviteForm();
      showToast(data.emailed ? 'Invite sent' : 'User created — email not sent, use Resend');
    } catch {
      setInviteError('Network error — try again.');
    } finally { setInviting(false); }
  };

  // ── Edit panel ───────────────────────────────────────────────────────────────
  const [editUser, setEditUser] = useState<User | null>(null);
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editRole, setEditRole] = useState('agent');
  const [editTl, setEditTl] = useState('');
  const [editQa, setEditQa] = useState('');
  const [editDispositions, setEditDispositions] = useState<string[]>([]);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState('');
  // reset password (inside the edit panel)
  const [resetPassword, setResetPassword] = useState('');
  const [resetting, setResetting] = useState(false);
  const [resetMsg, setResetMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const openEdit = (u: User) => {
    setMenuFor(null);
    setEditUser(u);
    setEditName(u.agentName || u.name || '');
    setEditEmail(u.email);
    setEditRole(u.role || (u.isAdmin ? 'admin' : 'agent'));
    const key = (u.agentName || '').toLowerCase();
    setEditTl(agentAssignments[key]?.tl_name || '');
    setEditQa(agentAssignments[key]?.qa_name || '');
    setEditDispositions(dispositionsFor(u.email));
    setEditError('');
    setResetPassword('');
    setResetMsg(null);
  };

  const toggleEditDisposition = (d: string) =>
    setEditDispositions(prev => (prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d]));

  const saveEdit = async () => {
    if (!editUser?.userId) return;
    const name = editName.trim();
    const email = editEmail.trim().toLowerCase();
    if (!name) { setEditError('Name cannot be empty.'); return; }
    if (!email.endsWith('@wintwealth.com')) { setEditError('Email must be a @wintwealth.com address.'); return; }
    setSavingEdit(true);
    setEditError('');
    try {
      // 1. Profile + role
      const res = await fetch('/api/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: editUser.userId, name, email, role: editRole }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setEditError(data.error || 'Failed to update user.'); return; }

      // 2. TL / QA assignment (keyed by the agent's Name in the agents table)
      const key = (editUser.agentName || '').toLowerCase();
      const savedTl = agentAssignments[key]?.tl_name || '';
      const savedQa = agentAssignments[key]?.qa_name || '';
      if (editUser.agentName && ((editTl || '') !== savedTl || (editQa || '') !== savedQa)) {
        const ares = await fetch('/api/cx/admin/agents', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agent_name: editUser.agentName, tl_name: editTl || null, qa_name: editQa || null }),
        });
        if (ares.ok) {
          setAgentAssignments(prev => ({ ...prev, [key]: { tl_name: editTl || null, qa_name: editQa || null } }));
        }
      }

      // 3. QA dispositions (only relevant for quality analysts)
      if (editRole === 'quality' && !sameSet(dispositionsFor(editUser.email), editDispositions)) {
        const dres = await fetch('/api/cx/qa/disposition-config', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, dispositions: editDispositions }),
        });
        if (dres.ok) { const dd = await dres.json(); setQaMap(dd.map ?? []); }
      }

      setEditUser(null);
      await reloadUsers();
      const emailChanged = email !== editUser.email.toLowerCase();
      showToast(emailChanged ? 'User updated — any pending invite link was invalidated' : 'User updated');
    } catch {
      setEditError('Network error — try again.');
    } finally { setSavingEdit(false); }
  };

  const submitReset = async () => {
    if (!editUser || !resetPassword.trim()) return;
    setResetting(true);
    setResetMsg(null);
    try {
      const res = await fetch('/api/admin/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: editUser.email, newPassword: resetPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) { setResetMsg({ ok: true, text: 'Password updated.' }); setResetPassword(''); }
      else { setResetMsg({ ok: false, text: data.error || 'Failed to reset password.' }); }
    } catch {
      setResetMsg({ ok: false, text: 'Network error.' });
    } finally { setResetting(false); }
  };

  // ── Row actions ──────────────────────────────────────────────────────────────
  const setStatus = async (userId: number | undefined, status: 'active' | 'disabled') => {
    setMenuFor(null);
    if (userId == null) return;
    const res = await fetch('/api/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, status }),
    });
    if (res.ok) {
      setUsers(prev => prev.map(u => (u.userId === userId ? { ...u, status } : u)));
      showToast(status === 'disabled' ? 'User disabled' : 'User reactivated');
    } else {
      const data = await res.json().catch(() => ({}));
      showToast(data.error || 'Failed');
    }
  };

  const resendInvite = async (userId: number | undefined) => {
    setMenuFor(null);
    if (userId == null) return;
    const res = await fetch('/api/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, action: 'resend' }),
    });
    const data = await res.json().catch(() => ({}));
    showToast(res.ok && data.emailed ? 'Invite resent' : (data.error || 'Failed to resend'));
  };

  // ── Derived list ─────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter(u => {
      const role = u.role || (u.isAdmin ? 'admin' : 'agent');
      const status = u.status || 'active';
      const matchesSearch = !q || u.email.toLowerCase().includes(q) || (u.agentName || u.name || '').toLowerCase().includes(q);
      return matchesSearch
        && (roleFilter === 'all' || role === roleFilter)
        && (statusFilter === 'all' || status === statusFilter);
    });
  }, [users, search, roleFilter, statusFilter]);

  const tlOptions = users.filter(u => u.role === 'tl');
  const qaOptions = users.filter(u => u.role === 'quality');

  const inputCls = 'border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-[#2d9e4f]/30';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Users</h2>
          <p className="text-sm text-gray-500 mt-1">Manage who can access the IR Portal.</p>
        </div>
        <button
          onClick={() => { resetInviteForm(); setInviteOpen(true); }}
          className="shrink-0 px-4 py-2.5 bg-[#2d9e4f] text-white rounded-xl text-sm font-semibold hover:bg-[#25883f] transition"
        >
          + Invite User
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"
            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
            <circle cx="7" cy="7" r="4.5" /><path d="M11 11l3 3" />
          </svg>
          <input
            type="text"
            placeholder="Search by name or email…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className={`${inputCls} w-full pl-9`}
          />
        </div>
        <select value={roleFilter} onChange={e => setRoleFilter(e.target.value)} className={inputCls}>
          <option value="all">All roles</option>
          {ROLE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className={inputCls}>
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="invited">Invited</option>
          <option value="disabled">Disabled</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-x-auto">
        <table className="w-full text-sm min-w-[820px]">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/60">
              <th className="text-left px-5 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">User</th>
              <th className="text-left px-4 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Role</th>
              <th className="text-left px-4 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Dispositions</th>
              <th className="text-left px-4 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Status</th>
              <th className="text-left px-4 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Last Active</th>
              <th className="px-4 py-3 w-12" />
            </tr>
          </thead>
          <tbody>
            {filtered.map(u => {
              const status = u.status || 'active';
              const role = u.role || (u.isAdmin ? 'admin' : 'agent');
              const dispCount = dispositionsFor(u.email).length;
              return (
                <tr key={u.email} className="border-b border-gray-50 hover:bg-gray-50/40 transition">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="shrink-0 w-8 h-8 rounded-full bg-gray-100 text-gray-500 text-xs font-semibold flex items-center justify-center">
                        {initials(u.agentName || u.name || '', u.email)}
                      </span>
                      <div className="min-w-0">
                        <div className="font-semibold text-gray-900 truncate flex items-center gap-1.5">
                          {u.agentName || u.name || <span className="text-gray-400 font-normal italic">No name</span>}
                          {u.dormant && <span className="text-[10px] font-medium text-amber-500" title="No login in 60+ days">dormant</span>}
                        </div>
                        <div className="text-xs text-gray-400 truncate">{u.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{roleLabel(role)}</td>
                  <td className="px-4 py-3 text-gray-600">
                    {dispCount > 0 ? `${dispCount} disposition${dispCount !== 1 ? 's' : ''}` : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium border capitalize ${STATUS_STYLES[status]}`}>
                      {status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">
                    {u.lastLogin ? <TimeAgo ts={u.lastLogin} /> : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right relative">
                    <button
                      onClick={() => setMenuFor(menuFor === u.email ? null : u.email)}
                      className="w-8 h-8 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition inline-flex items-center justify-center"
                      title="Actions"
                    >
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                        <circle cx="8" cy="3" r="1.4" /><circle cx="8" cy="8" r="1.4" /><circle cx="8" cy="13" r="1.4" />
                      </svg>
                    </button>
                    {menuFor === u.email && (
                      <>
                        <div className="fixed inset-0 z-40" onClick={() => setMenuFor(null)} />
                        <div className="absolute right-4 top-11 z-50 w-44 bg-white rounded-xl border border-gray-200 shadow-lg py-1 text-left">
                          <button onClick={() => openEdit(u)}
                            className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition">
                            Edit
                          </button>
                          {status === 'invited' && (
                            <button onClick={() => resendInvite(u.userId)}
                              className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition">
                              Resend invite
                            </button>
                          )}
                          {status === 'disabled' ? (
                            <button onClick={() => setStatus(u.userId, 'active')}
                              className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition">
                              Reactivate
                            </button>
                          ) : (
                            <button onClick={() => setStatus(u.userId, 'disabled')}
                              className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition">
                              Disable
                            </button>
                          )}
                        </div>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <p className="text-sm text-gray-400 text-center py-10">
            {loadingUsers ? 'Loading…' : 'No users match your filters.'}
          </p>
        )}
      </div>

      {/* Footer count */}
      <p className="text-xs text-gray-400">{filtered.length} of {users.length} users</p>

      {/* ── Invite modal ── */}
      {inviteOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !inviting && setInviteOpen(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <div>
              <h3 className="text-base font-bold text-gray-900">Invite user</h3>
              <p className="text-xs text-gray-500 mt-0.5">Creates the account and emails a single-use signup link (valid 15 days).</p>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Email</label>
              <input type="email" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} placeholder="name@wintwealth.com" className={`${inputCls} w-full`} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Name (must match Robylon exactly)</label>
              <input type="text" value={inviteName} onChange={e => setInviteName(e.target.value)} placeholder="Exact name as it appears in call/chat data…" className={`${inputCls} w-full`} />
              <p className="text-[11px] text-gray-400 mt-1">This is the attribution key for their calls &amp; chats — enter it exactly as the source system sends it.</p>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Role</label>
              <select value={inviteRole} onChange={e => setInviteRole(e.target.value)} className={`${inputCls} w-full`}>
                {ROLE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            {inviteRole === 'quality' && (
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Assigned Dispositions (comma-separated)</label>
                <input type="text" value={inviteDispositions} onChange={e => setInviteDispositions(e.target.value)} placeholder="e.g. TAXATION, SGB, LIQUIDITY" className={`${inputCls} w-full`} />
              </div>
            )}
            {inviteError && <p className="text-xs text-red-500">{inviteError}</p>}
            <div className="flex items-center justify-end gap-2 pt-1">
              <button onClick={() => setInviteOpen(false)} disabled={inviting}
                className="px-4 py-2 text-sm font-medium text-gray-500 hover:text-gray-800 rounded-xl disabled:opacity-50 transition">
                Cancel
              </button>
              <button onClick={submitInvite} disabled={inviting || !inviteEmail.trim() || !inviteName.trim()}
                className="px-5 py-2 bg-[#2d9e4f] text-white rounded-xl text-sm font-semibold hover:bg-[#25883f] disabled:opacity-50 transition">
                {inviting ? 'Sending…' : 'Send Invite'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Edit panel ── */}
      {editUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !savingEdit && setEditUser(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <div>
              <h3 className="text-base font-bold text-gray-900">Edit user</h3>
              <p className="text-xs text-gray-500 mt-0.5">{editUser.email}</p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Name (must match Robylon exactly)</label>
              <input type="text" value={editName} onChange={e => setEditName(e.target.value)} className={`${inputCls} w-full`} />
              <p className="text-[11px] text-gray-400 mt-1">Changing this re-links their call/chat attribution to the new name.</p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Email</label>
              <input type="email" value={editEmail} onChange={e => setEditEmail(e.target.value)} className={`${inputCls} w-full`} />
              {editUser.status === 'invited' && (
                <p className="text-[11px] text-amber-600 mt-1">This user hasn&apos;t signed up yet — changing the email invalidates their current invite link. Use Resend afterward.</p>
              )}
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Role</label>
                <select value={editRole} onChange={e => setEditRole(e.target.value)} className={`${inputCls} w-full`}>
                  {ROLE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Team Lead</label>
                <select value={editTl} onChange={e => setEditTl(e.target.value)} disabled={!editUser.agentName} className={`${inputCls} w-full disabled:opacity-50`}>
                  <option value="">—</option>
                  {tlOptions.map(t => <option key={t.email} value={t.agentName || ''}>{t.agentName || t.email}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">QA</label>
                <select value={editQa} onChange={e => setEditQa(e.target.value)} disabled={!editUser.agentName} className={`${inputCls} w-full disabled:opacity-50`}>
                  <option value="">—</option>
                  {qaOptions.map(q => <option key={q.email} value={q.agentName || ''}>{q.agentName || q.email}</option>)}
                </select>
              </div>
            </div>
            {!editUser.agentName && <p className="text-[11px] text-gray-400 -mt-2">Set a Name above to assign a TL or QA.</p>}

            {editRole === 'quality' && (
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Assigned Dispositions ({editDispositions.length})</label>
                {availableDispositions.length === 0 ? (
                  <p className="text-xs text-gray-400">No dispositions available yet.</p>
                ) : (
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 max-h-48 overflow-y-auto border border-gray-100 rounded-xl p-3">
                    {availableDispositions.map(d => (
                      <label key={d} className="flex items-center gap-2 cursor-pointer group">
                        <input type="checkbox" checked={editDispositions.includes(d)} onChange={() => toggleEditDisposition(d)} className="accent-[#2d9e4f] w-3.5 h-3.5" />
                        <span className="text-sm text-gray-700 group-hover:text-gray-900 truncate">{d}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}

            {editError && <p className="text-xs text-red-500">{editError}</p>}

            <div className="flex items-center justify-end gap-2 pt-1">
              <button onClick={() => setEditUser(null)} disabled={savingEdit}
                className="px-4 py-2 text-sm font-medium text-gray-500 hover:text-gray-800 rounded-xl disabled:opacity-50 transition">
                Cancel
              </button>
              <button onClick={saveEdit} disabled={savingEdit || !editName.trim() || !editEmail.trim()}
                className="px-5 py-2 bg-[#2d9e4f] text-white rounded-xl text-sm font-semibold hover:bg-[#25883f] disabled:opacity-50 transition">
                {savingEdit ? 'Saving…' : 'Save changes'}
              </button>
            </div>

            {/* Reset password */}
            <div className="border-t border-gray-100 pt-4 space-y-2">
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider">Reset password</label>
              <div className="flex gap-2">
                <input type="password" value={resetPassword} onChange={e => setResetPassword(e.target.value)} placeholder="New password (min. 8 characters)" className={`${inputCls} flex-1`} />
                <button onClick={submitReset} disabled={resetting || !resetPassword.trim()}
                  className="px-4 py-2 bg-gray-800 text-white rounded-xl text-sm font-semibold hover:bg-gray-700 disabled:opacity-50 transition whitespace-nowrap">
                  {resetting ? 'Saving…' : 'Set'}
                </button>
              </div>
              {resetMsg && <p className={`text-xs font-medium ${resetMsg.ok ? 'text-emerald-600' : 'text-red-500'}`}>{resetMsg.text}</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
