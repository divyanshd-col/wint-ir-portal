'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function RegisterPage() {
  const router = useRouter();
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm]   = useState('');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');
  const [success, setSuccess]   = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!email.toLowerCase().endsWith('@wintwealth.com')) {
      setError('Only @wintwealth.com email addresses are permitted.');
      return;
    }
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
        setError(data.error || 'Registration failed. Please try again.');
      } else {
        setSuccess(true);
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
            {success ? (
              <div className="text-center py-4">
                <div className="w-12 h-12 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#2d9e4f" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
                <h2 className="text-[#1a1a1a] text-lg font-semibold mb-1">Account created!</h2>
                <p className="text-gray-500 text-sm">Redirecting you to sign in…</p>
              </div>
            ) : (
              <>
                <h2 className="text-[#1a1a1a] text-xl font-semibold mb-1">Create your account</h2>
                <p className="text-gray-500 text-sm mb-6">Use your <span className="font-medium text-gray-600">@wintwealth.com</span> email to register</p>

                {error && (
                  <div className="bg-red-50 border border-red-200 text-red-600 text-sm px-4 py-3 rounded-lg mb-4">
                    {error}
                  </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-4">
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
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                    <input
                      type="password"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2d9e4f] focus:border-transparent transition"
                      placeholder="Min. 6 characters"
                      required
                      autoComplete="new-password"
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
                    {loading ? 'Creating account…' : 'Create Account'}
                  </button>
                </form>

                <p className="mt-5 text-center text-xs text-gray-400">
                  Already have an account?{' '}
                  <a href="/login" className="text-[#2d9e4f] hover:underline font-medium">
                    Sign in
                  </a>
                </p>
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
