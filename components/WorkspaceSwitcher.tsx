'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';

export default function WorkspaceSwitcher({ compact = false }: { compact?: boolean }) {
  const { data: session, update } = useSession();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const isSuperAdmin = Boolean(session?.user?.isSuperAdmin);
  const platformDomain = session?.user?.platformDomain;

  // Only render switcher for Super Admins or users with access to 'both'
  if (!isSuperAdmin && platformDomain !== 'both') {
    return null;
  }

  const activeDomain = session?.user?.activeDomain || 'cx';

  const handleSwitch = async (targetDomain: 'cx' | 'pcg') => {
    if (targetDomain === activeDomain || loading) {
      setOpen(false);
      return;
    }

    try {
      setLoading(true);
      const res = await fetch('/api/auth/switch-domain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: targetDomain }),
      });

      if (!res.ok) {
        throw new Error('Failed to switch workspace profile');
      }

      // Update NextAuth client session
      await update({ activeDomain: targetDomain });

      // Navigate to respective workspace home
      if (targetDomain === 'pcg') {
        window.location.href = '/admin/pcg-calls';
      } else {
        window.location.href = '/quality';
      }
    } catch (err) {
      console.error('[WorkspaceSwitcher] Error switching domain:', err);
      setLoading(false);
      setOpen(false);
    }
  };

  return (
    <div className="relative inline-block text-left w-full" ref={dropdownRef}>
      {/* Switcher Trigger Button */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        disabled={loading}
        className={`w-full flex items-center justify-between gap-2.5 rounded-xl border transition-all text-left group ${
          compact
            ? 'px-2.5 py-1.5 text-xs bg-zinc-900/90 border-zinc-700/80 text-zinc-100 hover:border-zinc-500'
            : activeDomain === 'pcg'
            ? 'px-3.5 py-2.5 bg-gradient-to-r from-emerald-950/40 via-zinc-900 to-zinc-900 border-emerald-500/30 hover:border-emerald-500/60 text-white shadow-sm'
            : 'px-3.5 py-2.5 bg-gradient-to-r from-blue-950/40 via-zinc-900 to-zinc-900 border-blue-500/30 hover:border-blue-500/60 text-white shadow-sm'
        }`}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 transition-transform group-hover:scale-105 ${
              activeDomain === 'pcg'
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                : 'bg-blue-500/20 text-blue-400 border border-blue-500/40'
            }`}
          >
            {activeDomain === 'pcg' ? '📈' : '🏢'}
          </div>
          <div className="min-w-0 leading-tight">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-bold tracking-tight truncate text-zinc-100">
                {activeDomain === 'pcg' ? 'Wint PCG' : 'Wint CX'}
              </span>
              <span
                className={`text-[9px] font-semibold px-1 py-0.2 rounded uppercase tracking-wider ${
                  activeDomain === 'pcg'
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                    : 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                }`}
              >
                Profile
              </span>
            </div>
            {!compact && (
              <p className="text-[10px] text-zinc-400 truncate mt-0.5">
                {activeDomain === 'pcg' ? 'Private Client Group' : 'Customer Experience'}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1 text-zinc-400 group-hover:text-zinc-200">
          {loading ? (
            <svg className="animate-spin h-3.5 w-3.5 text-zinc-400" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
            </svg>
          ) : (
            <svg
              width="12"
              height="12"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              className={`transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
            >
              <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </div>
      </button>

      {/* Netflix-Style Profile Dropdown Menu */}
      {open && (
        <div className="absolute left-0 mt-2 w-72 rounded-2xl bg-[#141416] border border-zinc-700/80 shadow-2xl p-2 z-50 animate-in fade-in slide-in-from-top-2 duration-150 backdrop-blur-xl">
          <div className="px-2.5 py-2 border-b border-zinc-800/80 mb-1 flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
              Switch Workspace Profile
            </span>
            <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/20">
              Super Admin
            </span>
          </div>

          <div className="space-y-1">
            {/* CX Profile Option */}
            <button
              type="button"
              onClick={() => handleSwitch('cx')}
              className={`w-full flex items-center justify-between p-2.5 rounded-xl transition-all text-left ${
                activeDomain === 'cx'
                  ? 'bg-blue-600/15 border border-blue-500/40 text-white'
                  : 'hover:bg-zinc-800/60 text-zinc-300 hover:text-white border border-transparent'
              }`}
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-blue-500/20 border border-blue-500/30 flex items-center justify-center text-sm">
                  🏢
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <p className="text-xs font-bold text-white">Wint CX</p>
                    {activeDomain === 'cx' && (
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                    )}
                  </div>
                </div>
              </div>

              {activeDomain === 'cx' && (
                <span className="text-xs text-blue-400 font-bold">✓</span>
              )}
            </button>

            {/* PCG Profile Option */}
            <button
              type="button"
              onClick={() => handleSwitch('pcg')}
              className={`w-full flex items-center justify-between p-2.5 rounded-xl transition-all text-left ${
                activeDomain === 'pcg'
                  ? 'bg-emerald-600/15 border border-emerald-500/40 text-white'
                  : 'hover:bg-zinc-800/60 text-zinc-300 hover:text-white border border-transparent'
              }`}
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-sm">
                  📈
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <p className="text-xs font-bold text-white">Wint PCG</p>
                    {activeDomain === 'pcg' && (
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    )}
                  </div>
                </div>
              </div>

              {activeDomain === 'pcg' && (
                <span className="text-xs text-emerald-400 font-bold">✓</span>
              )}
            </button>
          </div>

          <div className="mt-2 pt-2 border-t border-zinc-800/80 px-2.5 pb-1">
            <p className="text-[10px] text-zinc-500 leading-tight">
              Switching profiles changes your navigation, analytics, and available dashboards.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
