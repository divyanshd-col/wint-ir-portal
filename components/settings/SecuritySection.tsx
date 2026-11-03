'use client';

import React, { useState } from 'react';

interface SecuritySectionProps {
  onSuccess?: () => void;
}

export default function SecuritySection({ onSuccess }: SecuritySectionProps) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordMsg, setPasswordMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const changePassword = async () => {
    setPasswordMsg(null);
    if (!currentPassword) {
      setPasswordMsg({ ok: false, text: 'Please enter your current password' });
      return;
    }
    if (!newPassword) {
      setPasswordMsg({ ok: false, text: 'Please enter a new password' });
      return;
    }
    if (newPassword.length < 8) {
      setPasswordMsg({ ok: false, text: 'Password must be at least 8 characters' });
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordMsg({ ok: false, text: 'New passwords do not match' });
      return;
    }
    setChangingPassword(true);
    try {
      const res = await fetch('/api/users/me/password', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (res.ok) {
        setPasswordMsg({ ok: true, text: 'Password updated successfully' });
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
        onSuccess?.();
      } else {
        setPasswordMsg({ ok: false, text: data.error || 'Failed to update password' });
      }
    } catch {
      setPasswordMsg({ ok: false, text: 'Network error — please try again.' });
    } finally {
      setChangingPassword(false);
    }
  };

  return (
    <div className="space-y-8">
      <h2 className="text-xl font-bold text-gray-900">Security</h2>
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-5 max-w-md">
        <h3 className="text-sm font-bold text-gray-900">Change Password</h3>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
              CURRENT PASSWORD
            </label>
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1f7a4d]/30"
              placeholder="Enter current password"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
              NEW PASSWORD
            </label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1f7a4d]/30"
              placeholder="At least 8 characters"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
              CONFIRM NEW PASSWORD
            </label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1f7a4d]/30"
              placeholder="Repeat new password"
            />
          </div>
        </div>
        {passwordMsg && (
          <p className={`text-sm font-medium ${passwordMsg.ok ? 'text-emerald-600' : 'text-red-500'}`}>
            {passwordMsg.text}
          </p>
        )}
        <button
          type="button"
          onClick={changePassword}
          disabled={changingPassword || !currentPassword || !newPassword || !confirmPassword}
          className="px-5 py-2 bg-[#1f7a4d] text-white rounded-xl text-sm font-semibold hover:bg-[#1a6a42] disabled:opacity-50 transition cursor-pointer"
        >
          {changingPassword ? 'Saving…' : 'Update Password'}
        </button>
      </div>
    </div>
  );
}

