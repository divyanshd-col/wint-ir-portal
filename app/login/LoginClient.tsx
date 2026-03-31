'use client';

import { signIn } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';

function LoginForm() {
  const searchParams = useSearchParams();
  const error = searchParams.get('error');
  const callbackUrl = searchParams.get('callbackUrl') || '/';
  const [loading, setLoading] = useState(false);

  const handleGoogleSignIn = () => {
    setLoading(true);
    signIn('google', { callbackUrl });
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
            <p className="text-gray-500 text-sm mb-6">Use your Wint Wealth Google account</p>

            {error === 'AccessDenied' ? (
              <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-4 mb-5">
                <p className="text-red-700 text-sm font-semibold mb-1">Account not permitted</p>
                <p className="text-red-600 text-xs mb-3">
                  This portal is restricted to <span className="font-semibold">@wintwealth.com</span> accounts.
                  If you need access, reach out to the IR team.
                </p>
                <a
                  href="mailto:ir@wintwealth.com?subject=IR Portal Access Request"
                  className="inline-flex items-center gap-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                    <polyline points="22,6 12,13 2,6"/>
                  </svg>
                  Email IR Team
                </a>
              </div>
            ) : error ? (
              <div className="bg-red-50 border border-red-200 text-red-600 text-sm px-4 py-3 rounded-lg mb-4">
                Sign-in failed. Please try again.
              </div>
            ) : null}

            <button
              onClick={handleGoogleSignIn}
              disabled={loading}
              className="w-full flex items-center justify-center gap-3 bg-white border border-gray-200 hover:border-gray-300 hover:bg-gray-50 text-gray-700 font-semibold py-3 rounded-xl transition shadow-sm text-sm disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <svg className="animate-spin" width="18" height="18" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z"/>
                  </svg>
                  Redirecting to Google…
                </>
              ) : (
                <>
                  <svg width="18" height="18" viewBox="0 0 24 24">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                  </svg>
                  Continue with Google
                </>
              )}
            </button>

            <p className="mt-6 text-center text-xs text-gray-400">
              Only <span className="font-semibold text-gray-500">@wintwealth.com</span> accounts are permitted
            </p>
            <p className="mt-3 text-center text-xs text-gray-400">
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
