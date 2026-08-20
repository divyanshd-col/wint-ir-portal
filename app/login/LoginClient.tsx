'use client';

import { signIn } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';

function LoginForm() {
  const searchParams = useSearchParams();
  const error = searchParams.get('error');
  const callbackUrl = searchParams.get('callbackUrl') || '/';
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading]   = useState(false);
  const [loginError, setLoginError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    if (!email.toLowerCase().endsWith('@wintwealth.com')) {
      setLoginError('Only @wintwealth.com email addresses are permitted.');
      return;
    }
    setLoading(true);
    try {
      const result = await signIn('credentials', { email, password, callbackUrl, redirect: false });
      if (result?.error) {
        if (result.error !== 'CredentialsSignin') {
          setLoginError(result.error);
        } else {
          setLoginError('Invalid email or password.');
        }
      } else if (result?.url) {
        window.location.href = result.url;
      }
    } catch {
      setLoginError('Network error. Please try again.');
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
            <h2 className="text-[#1a1a1a] text-xl font-semibold mb-1">Sign in to continue</h2>
            <p className="text-gray-500 text-sm mb-6">Use your <span className="font-medium text-gray-600">@wintwealth.com</span> email and password</p>

            {(error || loginError) && (
              <div className="bg-red-50 border border-red-200 text-red-600 text-sm px-4 py-3 rounded-lg mb-4">
                {loginError || 'Sign-in failed. Please try again.'}
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
                  placeholder="••••••••"
                  required
                  autoComplete="current-password"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-[#2d9e4f] hover:bg-[#27883f] text-white font-semibold py-2.5 rounded-lg transition disabled:opacity-60 text-sm"
              >
                {loading ? 'Signing in…' : 'Sign In'}
              </button>
            </form>

            <p className="mt-5 text-center text-xs text-gray-400">
              Need an account? Ask an admin to invite you — you'll get a signup link by email.
            </p>
            <p className="mt-2 text-center text-xs text-gray-400">
              Need help?{' '}
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

export default function LoginClient() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
