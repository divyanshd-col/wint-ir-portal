'use client';

import React, { useEffect, useMemo, useState } from 'react';
import TimeAgo from '../TimeAgo';

export interface PcgUser {
  userId: number;
  email: string;
  name: string;
  role: 'agent' | 'tl' | 'quality' | 'admin';
  status: 'invited' | 'active' | 'disabled';
  isAdmin: boolean;
  isSuperAdmin: boolean;
  platformDomain: string;
  tlName: string;
  lastLogin?: string | null;
  createdAt?: string;
  dormant?: boolean;
  hasPassword?: boolean;
}

interface PcgUsersManagerProps {
  showToast: (msg: string) => void;
  isSuperAdmin?: boolean;
}

const ROLE_OPTIONS: [string, string][] = [
  ['agent', 'Agent (RM)'],
  ['tl', 'Team Lead'],
  ['admin', 'Admin'],
];

const STATUS_STYLES: Record<string, string> = {
  active: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  invited: 'bg-amber-50 text-amber-700 border-amber-200',
  disabled: 'bg-gray-100 text-gray-500 border-gray-200',
};

function roleLabel(role: string): string {
  if (role === 'agent') return 'Agent';
  if (role === 'tl') return 'TL';
  if (role === 'admin') return 'Admin';
  return role;
}

function initials(name: string, email: string): string {
  const src = name.trim() || email.split('@')[0] || '';
  const parts = src.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (src.slice(0, 2) || '?').toUpperCase();
}

function Avatar({ name, email }: { name: string; email: string }) {
  return (
    <span className="shrink-0 w-8 h-8 rounded-full bg-gray-100 text-gray-500 text-xs font-semibold flex items-center justify-center">
      {initials(name, email)}
    </span>
  );
}

export default function PcgUsersManager({ showToast, isSuperAdmin = false }: PcgUsersManagerProps) {
  const [tab, setTab] = useState<'users' | 'teams'>('users');
  const inputCls =
    'border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-[#2d9e4f]/30';

  // ── PCG Users State ────────────────────────────────────────────────────────
  const [users, setUsers] = useState<PcgUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [menuFor, setMenuFor] = useState<number | null>(null);

  // ── Team Leads & Assignments State ─────────────────────────────────────────
  const [teamSearch, setTeamSearch] = useState('');
  const [pendingAssignments, setPendingAssignments] = useState<Record<string, string>>({});
  const [savingAssignments, setSavingAssignments] = useState(false);

  // Dynamic Team Leads derived from users who have role === 'tl'
  const tlOptions = useMemo(() => {
    return users.filter((u) => u.role === 'tl' && u.status !== 'disabled');
  }, [users]);

  // ── Invite Modal State ─────────────────────────────────────────────────────
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteName, setInviteName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'agent' | 'tl' | 'admin'>('agent');
  const [inviteTl, setInviteTl] = useState('');
  const [inviteSuperAdmin, setInviteSuperAdmin] = useState(false);
  const [inviteDomainBoth, setInviteDomainBoth] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState('');

  // ── Batch Invite Modal State ───────────────────────────────────────────────
  const [batchInviteOpen, setBatchInviteOpen] = useState(false);
  const [sendingBatch, setSendingBatch] = useState(false);
  const [batchResult, setBatchResult] = useState<{ total: number; sent: number; failed: number } | null>(null);

  // ── Edit Modal State ───────────────────────────────────────────────────────
  const [editUser, setEditUser] = useState<PcgUser | null>(null);
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editRole, setEditRole] = useState<'agent' | 'tl' | 'quality' | 'admin'>('agent');
  const [editTl, setEditTl] = useState('');
  const [editSuperAdmin, setEditSuperAdmin] = useState(false);
  const [editPlatformDomain, setEditPlatformDomain] = useState('pcg');
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState('');

  // ── Password Reset within Edit Modal ───────────────────────────────────────
  const [resetPassword, setResetPassword] = useState('');
  const [resettingPw, setResettingPw] = useState(false);
  const [resetPwMsg, setResetPwMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // ── Fetch Users & Teams ────────────────────────────────────────────────────
  const loadData = async () => {
    setLoadingUsers(true);
    try {
      const usersRes = await fetch('/api/pcg/admin/users').then((r) => r.json());
      if (usersRes.users) {
        setUsers(usersRes.users);
      }
    } catch (err: any) {
      console.error('[PcgUsersManager] failed to load:', err);
      showToast('Failed to load PCG users');
    } finally {
      setLoadingUsers(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const resetInviteForm = () => {
    setInviteName('');
    setInviteEmail('');
    setInviteRole('agent');
    setInviteTl('');
    setInviteSuperAdmin(false);
    setInviteDomainBoth(false);
    setInviteError('');
  };

  // Filtered Users List
  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter((u) => {
      const matchesSearch =
        !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
      const matchesRole = roleFilter === 'all' || u.role === roleFilter;
      const matchesStatus = statusFilter === 'all' || u.status === statusFilter;
      return matchesSearch && matchesRole && matchesStatus;
    });
  }, [users, search, roleFilter, statusFilter]);

  // Filtered Team Members (RMs)
  const rms = useMemo(() => {
    return users.filter((u) => u.role === 'agent');
  }, [users]);

  const filteredRms = useMemo(() => {
    const q = teamSearch.trim().toLowerCase();
    return rms.filter(
      (u) => !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
    );
  }, [rms, teamSearch]);

  const pendingInviteCount = useMemo(() => {
    return users.filter((u) => !u.hasPassword && u.status !== 'disabled').length;
  }, [users]);

  const runBatchInvite = async () => {
    setSendingBatch(true);
    setBatchResult(null);
    try {
      const res = await fetch('/api/pcg/admin/users/batch-invite', {
        method: 'POST',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(data.error || 'Failed to send batch invites');
        return;
      }
      setBatchResult(data);
      showToast(`Sent setup invites to ${data.sent} users`);
      await loadData();
    } catch {
      showToast('Network error triggering batch invites');
    } finally {
      setSendingBatch(false);
    }
  };

  // ── Actions ────────────────────────────────────────────────────────────────
  const submitInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteName.trim() || !inviteEmail.trim()) {
      setInviteError('Please provide both name and email.');
      return;
    }
    if (!inviteEmail.toLowerCase().endsWith('@wintwealth.com')) {
      setInviteError('Email must be an @wintwealth.com address.');
      return;
    }

    setInviting(true);
    setInviteError('');
    try {
      const res = await fetch('/api/pcg/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: inviteName.trim(),
          email: inviteEmail.trim().toLowerCase(),
          role: inviteRole,
          tlName: inviteRole === 'agent' ? inviteTl : undefined,
          isSuperAdmin: isSuperAdmin && inviteSuperAdmin,
          platformDomain: isSuperAdmin && inviteDomainBoth ? 'both' : 'pcg',
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setInviteError(data.error || 'Failed to create user.');
        return;
      }

      await loadData();
      setInviteOpen(false);
      resetInviteForm();
      showToast(data.emailed ? 'Invite sent' : 'User created — email not sent, use Resend');
    } catch {
      setInviteError('Network error — please try again.');
    } finally {
      setInviting(false);
    }
  };

  const openEditModal = (u: PcgUser) => {
    setMenuFor(null);
    setEditUser(u);
    setEditName(u.name);
    setEditEmail(u.email);
    setEditRole(u.role);
    setEditTl(u.tlName || '');
    setEditSuperAdmin(Boolean(u.isSuperAdmin));
    setEditPlatformDomain(u.platformDomain || 'pcg');
    setEditError('');
    setResetPassword('');
    setResetPwMsg(null);
  };

  const saveUserEdit = async () => {
    if (!editUser) return;
    const name = editName.trim();
    const email = editEmail.trim().toLowerCase();
    if (!name) {
      setEditError('Name cannot be empty.');
      return;
    }
    if (!email.endsWith('@wintwealth.com')) {
      setEditError('Email must be a @wintwealth.com address.');
      return;
    }

    setSavingEdit(true);
    setEditError('');
    try {
      const payload: any = {
        userId: editUser.userId,
        name,
        email,
        role: editRole,
        tlName: editRole === 'agent' ? editTl : undefined,
      };
      if (isSuperAdmin) {
        payload.isSuperAdmin = editSuperAdmin;
        payload.platformDomain = editPlatformDomain;
      }

      const res = await fetch('/api/pcg/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setEditError(data.error || 'Failed to update user.');
        return;
      }

      setEditUser(null);
      await loadData();
      showToast('User updated');
    } catch {
      setEditError('Network error — please try again.');
    } finally {
      setSavingEdit(false);
    }
  };

  const submitPasswordReset = async () => {
    if (!editUser || !resetPassword.trim()) return;
    setResettingPw(true);
    setResetPwMsg(null);
    try {
      const res = await fetch('/api/admin/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: editUser.email, newPassword: resetPassword.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setResetPwMsg({ ok: true, text: 'Password updated.' });
        setResetPassword('');
      } else {
        setResetPwMsg({ ok: false, text: data.error || 'Failed to reset password.' });
      }
    } catch {
      setResetPwMsg({ ok: false, text: 'Network error.' });
    } finally {
      setResettingPw(false);
    }
  };

  const toggleUserStatus = async (user: PcgUser) => {
    setMenuFor(null);
    const newStatus = user.status === 'active' ? 'disabled' : 'active';
    try {
      const res = await fetch('/api/pcg/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.userId, status: newStatus }),
      });
      if (res.ok) {
        setUsers((prev) =>
          prev.map((u) => (u.userId === user.userId ? { ...u, status: newStatus } : u))
        );
        showToast(newStatus === 'disabled' ? 'User disabled' : 'User reactivated');
      } else {
        const data = await res.json().catch(() => ({}));
        showToast(data.error || 'Failed');
      }
    } catch {
      showToast('Network error');
    }
  };

  const resendInvite = async (user: PcgUser) => {
    setMenuFor(null);
    try {
      const res = await fetch('/api/pcg/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.userId, action: 'resend' }),
      });
      const data = await res.json().catch(() => ({}));
      showToast(res.ok && data.emailed ? 'Invite resent' : data.error || 'Failed to resend');
    } catch {
      showToast('Network error');
    }
  };

  const saveTeamAssignments = async () => {
    const entries = Object.entries(pendingAssignments);
    if (!entries.length) return;
    setSavingAssignments(true);
    try {
      const res = await fetch('/api/pcg/admin/teams', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignments: pendingAssignments }),
      });
      if (res.ok) {
        setPendingAssignments({});
        await loadData();
        showToast('Assignments saved');
      } else {
        const data = await res.json().catch(() => ({}));
        showToast(data.error || 'Failed to save assignments');
      }
    } catch {
      showToast('Network error saving assignments');
    } finally {
      setSavingAssignments(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* ── Top Header Section (Exact CX typography & layout) ─────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Users</h2>
          <p className="text-sm text-gray-500 mt-1">Manage members, teams, and RM assignments.</p>
        </div>
        {tab === 'users' && (
          <div className="flex items-center gap-2">
            {pendingInviteCount > 0 && (
              <button
                type="button"
                onClick={() => {
                  setBatchResult(null);
                  setBatchInviteOpen(true);
                }}
                className="shrink-0 px-3.5 py-2.5 bg-amber-50 text-amber-800 border border-amber-200 rounded-xl text-sm font-semibold hover:bg-amber-100 transition flex items-center gap-1.5"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                  <polyline points="22,6 12,13 2,6" />
                </svg>
                Invite Pending ({pendingInviteCount})
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                resetInviteForm();
                setInviteOpen(true);
              }}
              className="shrink-0 px-4 py-2.5 bg-[#2d9e4f] text-white rounded-xl text-sm font-semibold hover:bg-[#25883f] transition"
            >
              + Invite User
            </button>
          </div>
        )}
      </div>

      {/* ── Tabs (Users & Teams alone, matching CX UsersManager) ──────────── */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
        <button
          type="button"
          onClick={() => setTab('users')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            tab === 'users' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Users
        </button>
        <button
          type="button"
          onClick={() => setTab('teams')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            tab === 'teams' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Teams
        </button>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* USERS TAB (100% Identical font, sizing, and styling to CX)             */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {tab === 'users' && (
        <div className="space-y-6">
          {/* Filters */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <svg
                width="15"
                height="15"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
              >
                <circle cx="7" cy="7" r="4.5" />
                <path d="M11 11l3 3" />
              </svg>
              <input
                type="text"
                placeholder="Search by name or email…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className={`${inputCls} w-full pl-9`}
              />
            </div>
            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              className={inputCls}
            >
              <option value="all">All roles</option>
              {ROLE_OPTIONS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className={inputCls}
            >
              <option value="all">All statuses</option>
              <option value="active">Active</option>
              <option value="invited">Invited</option>
              <option value="disabled">Disabled</option>
            </select>
          </div>

          {/* Table */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/60">
                  <th className="text-left px-5 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                    User
                  </th>
                  <th className="text-left px-4 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                    Role
                  </th>
                  <th className="text-left px-4 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                    Assigned Team
                  </th>
                  <th className="text-left px-4 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="text-left px-4 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                    Last Active
                  </th>
                  <th className="px-4 py-3 w-12" />
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((u) => {
                  const status = u.status || 'active';
                  const role = u.role || 'agent';
                  return (
                    <tr
                      key={u.email}
                      className="border-b border-gray-50 hover:bg-gray-50/40 transition"
                    >
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <Avatar name={u.name} email={u.email} />
                          <div className="min-w-0">
                            <div className="font-semibold text-gray-900 truncate flex items-center gap-1.5">
                              {u.name || (
                                <span className="text-gray-400 font-normal italic">No name</span>
                              )}
                              {u.isSuperAdmin && (
                                <span className="text-[10px] font-medium text-amber-600 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.2">
                                  Super Admin
                                </span>
                              )}
                              {u.dormant && (
                                <span
                                  className="text-[10px] font-medium text-amber-500"
                                  title="No login in 60+ days"
                                >
                                  dormant
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-gray-400 truncate">{u.email}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-600">{roleLabel(role)}</td>
                      <td className="px-4 py-3 text-gray-600">
                        {u.role === 'agent' ? (
                          u.tlName ? (
                            <span className="text-gray-700">{u.tlName}</span>
                          ) : (
                            <span className="text-gray-300">—</span>
                          )
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium border capitalize ${STATUS_STYLES[status]}`}
                        >
                          {status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs">
                        {u.lastLogin ? <TimeAgo ts={u.lastLogin} /> : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-right relative">
                        <button
                          onClick={() => setMenuFor(menuFor === u.userId ? null : u.userId)}
                          className="w-8 h-8 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition inline-flex items-center justify-center"
                          title="Actions"
                        >
                          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                            <circle cx="8" cy="3" r="1.4" />
                            <circle cx="8" cy="8" r="1.4" />
                            <circle cx="8" cy="13" r="1.4" />
                          </svg>
                        </button>
                        {menuFor === u.userId && (
                          <>
                            <div className="fixed inset-0 z-40" onClick={() => setMenuFor(null)} />
                            <div className="absolute right-4 top-11 z-50 w-44 bg-white rounded-xl border border-gray-200 shadow-lg py-1 text-left">
                              <button
                                onClick={() => openEditModal(u)}
                                className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition"
                              >
                                Edit
                              </button>
                              {(!u.hasPassword || status === 'invited') && (
                                <button
                                  onClick={() => resendInvite(u)}
                                  className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition"
                                >
                                  {u.hasPassword ? 'Resend invite' : 'Send setup invite'}
                                </button>
                              )}
                              {status === 'disabled' ? (
                                <button
                                  onClick={() => toggleUserStatus(u)}
                                  className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition"
                                >
                                  Reactivate
                                </button>
                              ) : (
                                <button
                                  onClick={() => toggleUserStatus(u)}
                                  className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition"
                                >
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
            {filteredUsers.length === 0 && (
              <p className="text-sm text-gray-400 text-center py-10">
                {loadingUsers ? 'Loading…' : 'No users match your filters.'}
              </p>
            )}
          </div>

          <p className="text-xs text-gray-400">
            {filteredUsers.length} of {users.length} users
          </p>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* TEAMS TAB (Exact match to CX Teams style & layout)                    */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {tab === 'teams' && (
        <div className="space-y-6">
          <div className="relative sm:max-w-sm">
            <svg
              width="15"
              height="15"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
            >
              <circle cx="7" cy="7" r="4.5" />
              <path d="M11 11l3 3" />
            </svg>
            <input
              type="text"
              placeholder="Search members…"
              value={teamSearch}
              onChange={(e) => setTeamSearch(e.target.value)}
              className={`${inputCls} w-full pl-9`}
            />
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/60">
                  <th className="text-left px-5 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                    Member (RM)
                  </th>
                  <th className="text-left px-4 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                    Assigned Team Lead
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredRms.map((rm) => {
                  const currentTl =
                    pendingAssignments[rm.name.toLowerCase()] ??
                    (rm.tlName && rm.tlName !== 'Unassigned' ? rm.tlName : '');
                  const isChanged = pendingAssignments[rm.name.toLowerCase()] !== undefined;

                  return (
                    <tr
                      key={rm.userId}
                      className="border-b border-gray-50 hover:bg-gray-50/40 transition"
                    >
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <Avatar name={rm.name} email={rm.email} />
                          <div className="min-w-0">
                            <div className="font-semibold text-gray-900 truncate">{rm.name}</div>
                            <div className="text-xs text-gray-400 truncate">{rm.email}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <select
                          value={currentTl}
                          onChange={(e) => {
                            const val = e.target.value;
                            setPendingAssignments((prev) => ({
                              ...prev,
                              [rm.name.toLowerCase()]: val,
                            }));
                          }}
                          className={`${inputCls} w-52 ${isChanged ? '!border-amber-400' : ''}`}
                        >
                          <option value="">—</option>
                          {tlOptions.map((tl) => (
                            <option key={tl.userId} value={tl.name}>
                              {tl.name}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {filteredRms.length === 0 && (
              <p className="text-sm text-gray-400 text-center py-10">
                {loadingUsers ? 'Loading…' : 'No relationship managers found.'}
              </p>
            )}
          </div>

          {Object.keys(pendingAssignments).length > 0 && (
            <div className="flex items-center justify-between bg-amber-50 border border-amber-200 rounded-2xl px-5 py-3">
              <p className="text-sm text-amber-700 font-medium">
                {Object.keys(pendingAssignments).length} unsaved change
                {Object.keys(pendingAssignments).length !== 1 ? 's' : ''}
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPendingAssignments({})}
                  className="text-xs text-amber-600 hover:underline font-medium"
                >
                  Discard
                </button>
                <button
                  onClick={saveTeamAssignments}
                  disabled={savingAssignments}
                  className="px-5 py-2 bg-[#2d9e4f] text-white rounded-xl text-sm font-semibold hover:bg-[#25883f] disabled:opacity-50 transition"
                >
                  {savingAssignments ? 'Saving…' : 'Save Assignments'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* INVITE USER MODAL                                                     */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {inviteOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-gray-900">Invite User</h3>
              <button
                type="button"
                onClick={() => setInviteOpen(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                ✕
              </button>
            </div>

            <form onSubmit={submitInvite} className="space-y-4">
              {inviteError && (
                <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs font-medium">
                  {inviteError}
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                  Full Name
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Priyanshu Sharma"
                  value={inviteName}
                  onChange={(e) => setInviteName(e.target.value)}
                  className={`${inputCls} w-full`}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                  Email
                </label>
                <input
                  type="email"
                  required
                  placeholder="name@wintwealth.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  className={`${inputCls} w-full`}
                />
                <p className="text-[11px] text-gray-400 mt-1">Must be an @wintwealth.com address</p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                  Role
                </label>
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as any)}
                  className={`${inputCls} w-full`}
                >
                  <option value="agent">Agent (RM)</option>
                  <option value="tl">Team Lead (TL)</option>
                  <option value="admin">Admin</option>
                </select>
              </div>

              {inviteRole === 'agent' && (
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                    Team Lead
                  </label>
                  <select
                    value={inviteTl}
                    onChange={(e) => setInviteTl(e.target.value)}
                    className={`${inputCls} w-full`}
                  >
                    <option value="">— Select Team Lead —</option>
                    {tlOptions.map((tl) => (
                      <option key={tl.userId} value={tl.name}>
                        {tl.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {isSuperAdmin && (
                <div className="pt-2 border-t border-gray-100 space-y-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={inviteSuperAdmin}
                      onChange={(e) => setInviteSuperAdmin(e.target.checked)}
                      className="rounded border-gray-300 text-[#2d9e4f] focus:ring-[#2d9e4f]"
                    />
                    <span className="text-xs font-medium text-amber-800">
                      Grant Super Admin Privileges
                    </span>
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={inviteDomainBoth}
                      onChange={(e) => setInviteDomainBoth(e.target.checked)}
                      className="rounded border-gray-300 text-[#2d9e4f] focus:ring-[#2d9e4f]"
                    />
                    <span className="text-xs font-medium text-gray-700">
                      Access Both Workspaces (CX &amp; PCG)
                    </span>
                  </label>
                </div>
              )}

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setInviteOpen(false)}
                  className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={inviting}
                  className="px-5 py-2 bg-[#2d9e4f] text-white rounded-xl text-sm font-semibold hover:bg-[#25883f] disabled:opacity-50 transition"
                >
                  {inviting ? 'Inviting…' : '+ Invite User'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* EDIT USER MODAL                                                       */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {editUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-xl w-full max-w-md p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-gray-900">Edit User</h3>
              <button
                type="button"
                onClick={() => setEditUser(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4">
              {editError && (
                <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs font-medium">
                  {editError}
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                  Full Name
                </label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className={`${inputCls} w-full`}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                  Email
                </label>
                <input
                  type="email"
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  className={`${inputCls} w-full`}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                  Role
                </label>
                <select
                  value={editRole}
                  onChange={(e) => setEditRole(e.target.value as any)}
                  className={`${inputCls} w-full`}
                >
                  <option value="agent">Agent (RM)</option>
                  <option value="tl">Team Lead (TL)</option>
                  <option value="admin">Admin</option>
                </select>
              </div>

              {editRole === 'agent' && (
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                    Assigned Team Lead
                  </label>
                  <select
                    value={editTl}
                    onChange={(e) => setEditTl(e.target.value)}
                    className={`${inputCls} w-full`}
                  >
                    <option value="">— Unassigned —</option>
                    {tlOptions.map((tl) => (
                      <option key={tl.userId} value={tl.name}>
                        {tl.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {isSuperAdmin && (
                <div className="pt-2 border-t border-gray-100 space-y-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={editSuperAdmin}
                      onChange={(e) => setEditSuperAdmin(e.target.checked)}
                      className="rounded border-gray-300 text-[#2d9e4f] focus:ring-[#2d9e4f]"
                    />
                    <span className="text-xs font-medium text-amber-800">
                      Super Admin Status
                    </span>
                  </label>

                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                      Platform Domain Scope
                    </label>
                    <select
                      value={editPlatformDomain}
                      onChange={(e) => setEditPlatformDomain(e.target.value)}
                      className={`${inputCls} w-full`}
                    >
                      <option value="pcg">PCG Only</option>
                      <option value="cx">CX Only</option>
                      <option value="both">Both (Unified Access)</option>
                    </select>
                  </div>
                </div>
              )}

              {/* Password Reset Section */}
              <div className="pt-3 border-t border-gray-100 space-y-2">
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  Reset Password
                </label>
                {resetPwMsg && (
                  <p
                    className={`text-xs ${
                      resetPwMsg.ok ? 'text-emerald-600 font-medium' : 'text-red-600'
                    }`}
                  >
                    {resetPwMsg.text}
                  </p>
                )}
                <div className="flex gap-2">
                  <input
                    type="password"
                    placeholder="New password (min 8 chars)"
                    value={resetPassword}
                    onChange={(e) => setResetPassword(e.target.value)}
                    className={`${inputCls} flex-1`}
                  />
                  <button
                    type="button"
                    disabled={resettingPw || !resetPassword.trim()}
                    onClick={submitPasswordReset}
                    className="px-4 py-2 bg-gray-100 text-gray-700 rounded-xl text-sm font-semibold hover:bg-gray-200 disabled:opacity-50 transition"
                  >
                    {resettingPw ? 'Resetting…' : 'Set'}
                  </button>
                </div>
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditUser(null)}
                  className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 transition"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={savingEdit}
                  onClick={saveUserEdit}
                  className="px-5 py-2 bg-[#2d9e4f] text-white rounded-xl text-sm font-semibold hover:bg-[#25883f] disabled:opacity-50 transition"
                >
                  {savingEdit ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* ── Batch Invite Modal ──────────────────────────────────────────────── */}
      {batchInviteOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                  <polyline points="22,6 12,13 2,6" />
                </svg>
              </div>
              <div>
                <h3 className="text-base font-bold text-gray-900">Send Setup Invites</h3>
                <p className="text-xs text-gray-500">Email password creation links to PCG team members</p>
              </div>
            </div>

            <p className="text-sm text-gray-600 leading-relaxed">
              This will send a single-use setup link (valid for 15 days) to all{' '}
              <strong className="text-gray-900 font-semibold">{pendingInviteCount} active PCG members</strong>{' '}
              who do not have a password set yet.
            </p>

            {batchResult && (
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 space-y-1">
                <p className="font-semibold">Batch invite process completed!</p>
                <p>Successfully sent: {batchResult.sent} / {batchResult.total}</p>
                {batchResult.failed > 0 && <p className="text-red-600">Failed: {batchResult.failed}</p>}
              </div>
            )}

            <div className="pt-2 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setBatchInviteOpen(false)}
                className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 transition"
              >
                {batchResult ? 'Close' : 'Cancel'}
              </button>
              {!batchResult && (
                <button
                  type="button"
                  disabled={sendingBatch || pendingInviteCount === 0}
                  onClick={runBatchInvite}
                  className="px-5 py-2 bg-[#2d9e4f] text-white rounded-xl text-sm font-semibold hover:bg-[#25883f] disabled:opacity-50 transition"
                >
                  {sendingBatch ? 'Sending Invites…' : `Send to ${pendingInviteCount} Users`}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
