'use client';
import React from 'react';

interface DataStateProps {
  loading?: boolean;
  error?: string | null;
  empty?: boolean;
  emptyIcon?: React.ReactNode;
  emptyTitle?: string;
  emptyBody?: string;
  onRetry?: () => void;
  skeletonRows?: number;
  children?: React.ReactNode;
}

function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 py-3 px-4 animate-pulse">
      <div className="h-3 bg-gray-100 rounded-full w-1/4" />
      <div className="h-3 bg-gray-100 rounded-full flex-1" />
      <div className="h-3 bg-gray-100 rounded-full w-16" />
    </div>
  );
}

export default function DataState({
  loading, error, empty, emptyIcon, emptyTitle, emptyBody, onRetry,
  skeletonRows = 5, children,
}: DataStateProps) {
  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        {Array.from({ length: skeletonRows }).map((_, i) => (
          <div key={i} className="border-b border-gray-50 last:border-0">
            <SkeletonRow />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white rounded-2xl border border-red-100 shadow-sm px-6 py-10 text-center">
        <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-red-50 mb-3">
          <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="#dc2626" strokeWidth="1.5">
            <circle cx="8" cy="8" r="7"/><path d="M8 5v3M8 11h.01"/>
          </svg>
        </div>
        <p className="text-sm font-semibold text-gray-800 mb-1">Something went wrong</p>
        <p className="text-xs text-gray-500 mb-4">{error}</p>
        {onRetry && (
          <button onClick={onRetry}
            className="text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 px-4 py-2 rounded-xl transition">
            Try again
          </button>
        )}
      </div>
    );
  }

  if (empty) {
    return (
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-6 py-14 text-center">
        {emptyIcon && <div className="flex justify-center mb-3 text-gray-300">{emptyIcon}</div>}
        {emptyTitle && <p className="text-sm font-semibold text-gray-700 mb-1">{emptyTitle}</p>}
        {emptyBody  && <p className="text-xs text-gray-400">{emptyBody}</p>}
      </div>
    );
  }

  return <>{children}</>;
}
