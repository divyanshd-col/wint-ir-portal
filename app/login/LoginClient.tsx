'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function LoginClient() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    const result = await signIn('credentials', { username, password, redirect: false });
    setLoading(false);
    if (result?.error) {
      setError('Invalid credentials. Please try again.');
    } else {
      router.push('/');
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
            <h2 className="text-[#1a1a1a] text-xl font-semibold mb-1">Welcome back</h2>
            <p className="text-gray-500 text-sm mb-6">Sign in to access your IR dashboard</p>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Username</label>
                <input
                  type="text"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2d9e4f] focus:border-transparent transition"
                  placeholder="Enter your username"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2d9e4f] focus:border-transparent transition"
                  placeholder="Enter your password"
                  required
                />
              </div>
              {error && (
                <div className="bg-red-50 border border-red-200 text-red-600 text-sm px-4 py-2.5 rounded-lg">
                  {error}
                </div>
              )}
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-[#2d9e4f] hover:bg-[#27883f] text-white font-semibold py-2.5 rounded-lg transition disabled:opacity-60 text-sm mt-2"
              >
                {loading ? 'Signing in...' : 'Sign In'}
              </button>
            </form>
            <p className="mt-4 text-center text-sm text-gray-500">
              New user?{' '}
              <Link href="/register" className="text-[#2d9e4f] hover:underline font-medium">
                Create an account
              </Link>
            </p>
            <p className="mt-3 text-center text-xs text-gray-400">
              Having trouble? Contact{' '}
              <a href="mailto:ir@wintwealth.com" className="text-[#2d9e4f] hover:underline">
                ir@wintwealth.com
              </a>
            </p>
          </div>
        </div>
        <p className="text-center text-xs text-gray-400 mt-6">
          © {new Date().getFullYear()} Wint Wealth. All rights reserved.
        </p>
      </div>
    </div>
  );
}
