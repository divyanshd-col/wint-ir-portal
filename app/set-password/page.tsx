'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Step = 'email' | 'password' | 'done';

export default function SetPasswordPage() {
  const router = useRouter();
  const [step, setStep]         = useState<Step>('email');
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm]   = useState('');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');

  const checkEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!email.toLowerCase().endsWith('@wintwealth.com')) {
      setError('Only @wintwealth.com email addresses are permitted.');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/auth/check-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Something went wrong.');
      } else {
        setStep('password');
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const setNewPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to set password.');
      } else {
        setStep('done');
        setTimeout(() => router.push('/login'), 2500);
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#f5f5f0] flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-xl overflow-hidden">
          <div className="bg-[#1a1a1a] px-8 py-8 flex flex-col items-center">
            <div className="flex items-center gap-3 mb-3">
              <svg width="40" height="32" viewBox="0 0 40 32" fill="none">
                <rect x="0" y="12" width="12" height="20" fill="#2d9e4f" rx="1"/>
                <rect x="14" y="6" width="12" height="26" fill="#2d9e4f" rx="1"/>
                <rect x="28" y="0" width="12" height="32" fill="#2d9e4f" rx="1"/>
              </svg>
              <span className="text-white text-2xl font-bold tracking-tight">wint</span>
            </div>
            <p className="text-gray-400 text-sm tracking-widest uppercase">Investor Relations Portal</p>
          </div>

          <div className="px-8 py-8">
            {step === 'done' ? (
              <div className="text-center py-4">
                <div className="w-12 h-12 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#2d9e4f" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
                <h2 className="text-[#1a1a1a] text-lg font-semibold mb-1">Password set!</h2>
                <p className="text-gray-500 text-sm">Redirecting you to sign in…</p>
              </div>
            ) : step === 'email' ? (
              <>
                <h2 className="text-[#1a1a1a] text-xl font-semibold mb-1">Set your password</h2>
                <p className="text-gray-500 text-sm mb-6">
                  Enter your <span className="font-medium text-gray-600">@wintwealth.com</span> email to get started.
                  Your account and data will be preserved.
                </p>

                {error && (
                  <div className="bg-red-50 border border-red-200 text-red-600 text-sm px-4 py-3 rounded-lg mb-4">
                    {error}
                  </div>
                )}

                <form onSubmit={checkEmail} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                    <input
                      type="email"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2d9e4f] focus:border-transparent transition"
                      placeholder="you@wintwealth.com"
                      required
                      autoComplete="email"
                      autoFocus
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full bg-[#2d9e4f] hover:bg-[#27883f] text-white font-semibold py-2.5 rounded-lg transition disabled:opacity-60 text-sm"
                  >
                    {loading ? 'Checking…' : 'Continue'}
                  </button>
                </form>

                <p className="mt-5 text-center text-xs text-gray-400">
                  Already have a password?{' '}
                  <a href="/login" className="text-[#2d9e4f] hover:underline font-medium">Sign in</a>
                </p>
              </>
            ) : (
              <>
                <div className="flex items-center gap-2 mb-5">
                  <button onClick={() => { setStep('email'); setError(''); }}
                    className="text-gray-400 hover:text-gray-600 transition">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="15 18 9 12 15 6" />
                    </svg>
                  </button>
                  <div>
                    <h2 className="text-[#1a1a1a] text-xl font-semibold leading-tight">Choose a password</h2>
                    <p className="text-xs text-gray-500 mt-0.5">{email}</p>
                  </div>
                </div>

                {error && (
                  <div className="bg-red-50 border border-red-200 text-red-600 text-sm px-4 py-3 rounded-lg mb-4">
                    {error}
                  </div>
                )}

                <form onSubmit={setNewPassword} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">New Password</label>
                    <input
                      type="password"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2d9e4f] focus:border-transparent transition"
                      placeholder="Min. 6 characters"
                      required
                      autoComplete="new-password"
                      autoFocus
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Confirm Password</label>
                    <input
                      type="password"
                      value={confirm}
                      onChange={e => setConfirm(e.target.value)}
                      className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2d9e4f] focus:border-transparent transition"
                      placeholder="Re-enter your password"
                      required
                      autoComplete="new-password"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full bg-[#2d9e4f] hover:bg-[#27883f] text-white font-semibold py-2.5 rounded-lg transition disabled:opacity-60 text-sm"
                  >
                    {loading ? 'Saving…' : 'Save Password'}
                  </button>
                </form>
              </>
            )}
          </div>
        </div>
        <p className="text-center text-xs text-gray-400 mt-6">
          © {new Date().getFullYear()} Wint Wealth. All rights reserved.
        </p>
      </div>
    </div>
  );
}
