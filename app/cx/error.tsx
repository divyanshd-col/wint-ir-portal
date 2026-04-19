'use client';

import { useEffect } from 'react';

export default function CXError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[CX error boundary]', error);
  }, [error]);

  return (
    <div className="min-h-screen bg-[#111111] flex items-center justify-center p-8">
      <div className="bg-red-900/20 border border-red-500/40 rounded-2xl p-8 max-w-2xl w-full">
        <h2 className="text-red-400 font-bold text-lg mb-3">CX Dashboard error</h2>
        <p className="text-red-300 text-sm font-mono break-all mb-2">{error.message}</p>
        {error.digest && <p className="text-gray-500 text-xs mb-4">Digest: {error.digest}</p>}
        <pre className="text-gray-400 text-xs bg-black/30 rounded-lg p-4 overflow-auto max-h-48 whitespace-pre-wrap mb-4">
          {error.stack}
        </pre>
        <button
          onClick={reset}
          className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 transition"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
