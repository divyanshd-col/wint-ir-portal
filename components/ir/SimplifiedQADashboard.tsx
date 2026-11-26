'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import ChatEvaluationPage from '@/components/quality/ChatEvaluationPage';
import CallEvaluationPage from '@/components/quality/CallEvaluationPage';
import EmailEvaluationPage from '@/components/quality/EmailEvaluationPage';
import DateRangePicker from '@/components/quality/DateRangePicker';
import AiAccuracyTable from '@/components/quality/AiAccuracyTable';

// ── Icons (Clean Monochrome) ──────────────────────────────────────────────────

const AnalyticsIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="20" x2="18" y2="10" />
    <line x1="12" y1="20" x2="12" y2="4" />
    <line x1="6" y1="20" x2="6" y2="14" />
  </svg>
);

const QualityShieldIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
  </svg>
);

const AiAccuracyIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <circle cx="12" cy="12" r="6" />
    <circle cx="12" cy="12" r="2" />
  </svg>
);

const ChatBubbleIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);

const PhoneIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12a19.79 19.79 0 0 1-3-8.63 2 2 0 0 1 2-2.18h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
  </svg>
);

const MailIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="4" width="20" height="16" rx="2" />
    <path d="m22 7-10 6L2 7" />
  </svg>
);

const RefreshIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="23 4 23 10 17 10" />
    <polyline points="1 20 1 14 7 14" />
    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
  </svg>
);

const ArrowRightIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="5" y1="12" x2="19" y2="12" />
    <polyline points="12 5 19 12 12 19" />
  </svg>
);

// ── Types ─────────────────────────────────────────────────────────────────────

interface QAAnalyticsPayload {
  pending: {
    total: number;
    chats: number;
    calls: number;
    emails: number;
  };
  disputes: {
    total: number;
    chats: number;
    calls: number;
    emails: number;
  };
  aiAccuracy: {
    total: {
      evaluated: number;
      accurate: number;
      hallucinated: number;
      accuracyRate: number | null;
    };
    chats: {
      evaluated: number;
      accurate: number;
      hallucinated: number;
      accuracyRate: number | null;
    };
    calls: {
      evaluated: number;
      accurate: number;
      hallucinated: number;
      accuracyRate: number | null;
    };
    emails: {
      evaluated: number;
      accurate: number;
      hallucinated: number;
      accuracyRate: number | null;
    };
  };
  botPoorDispositions?: {
    disposition: string;
    volume: number;
    avg_iqs: number | null;
    low_iqs_count: number;
    csat_pct: number | null;
    bad_csat_count: number;
  }[];
}

interface Props {
  qaName?: string;
  qaEmail?: string;
  initialSection?: 'analytics' | 'quality' | 'ai-accuracy';
}

export default function SimplifiedQADashboard({
  qaName = 'Sindhu',
  qaEmail = '',
  initialSection = 'analytics',
}: Props) {
  const searchParams = useSearchParams();
  const querySection = searchParams.get('section') as ('analytics' | 'quality' | 'ai-accuracy') | null;
  const queryChannel = searchParams.get('channel') as ('calls' | 'chats' | 'emails') | null;

  // Active Section: 'analytics' | 'quality' | 'ai-accuracy'
  const [section, setSection] = useState<'analytics' | 'quality' | 'ai-accuracy'>(
    querySection && ['analytics', 'quality', 'ai-accuracy'].includes(querySection)
      ? querySection
      : initialSection
  );

  // Section 2: Quality channel toggles: Calls, Chats, Emails
  const [qualityChannel, setQualityChannel] = useState<'calls' | 'chats' | 'emails'>(
    queryChannel && ['calls', 'chats', 'emails'].includes(queryChannel)
      ? queryChannel
      : 'calls'
  );

  // Section 3: AI Accuracy channel (calls, chats, emails) & filter (accurate, hallucinated)
  const [aiAccuracyChannel, setAiAccuracyChannel] = useState<'calls' | 'chats' | 'emails'>('calls');
  const [aiAccuracyFilter, setAiAccuracyFilter] = useState<'accurate' | 'hallucinated'>('accurate');

  // Period Filter State: '7' | '30' | 'custom'
  type Period = '7' | '30' | 'custom';
  const [period, setPeriod] = useState<Period>('7');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [showPicker, setShowPicker] = useState(false);

  function fmtDateDisplay(iso: string) {
    if (!iso) return '';
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  }

  const handlePeriod = (p: Period) => {
    if (p === 'custom') {
      setShowPicker(true);
      return;
    }
    setPeriod(p);
    setCustomFrom('');
    setCustomTo('');
    setShowPicker(false);
  };

  const handleCustomApply = (from: string, to: string) => {
    setCustomFrom(from);
    setCustomTo(to);
    setPeriod('custom');
    setShowPicker(false);
  };

  // Analytics API data state
  const [analyticsData, setAnalyticsData] = useState<QAAnalyticsPayload | null>(null);
  const [loadingAnalytics, setLoadingAnalytics] = useState(true);
  const [analyticsError, setAnalyticsError] = useState<string | null>(null);

  const fetchAnalytics = useCallback(async () => {
    setLoadingAnalytics(true);
    setAnalyticsError(null);
    try {
      const qs = new URLSearchParams({ period });
      if (period === 'custom' && customFrom && customTo) {
        qs.set('from', customFrom);
        qs.set('to', customTo);
      }
      const res = await fetch(`/api/cx/qa/simplified-analytics?${qs}`);
      if (!res.ok) {
        throw new Error(`Failed to load analytics: ${res.statusText}`);
      }
      const data = await res.json();
      setAnalyticsData(data);
    } catch (err: any) {
      setAnalyticsError(err.message || 'Error loading QA analytics');
    } finally {
      setLoadingAnalytics(false);
    }
  }, [period, customFrom, customTo]);

  useEffect(() => {
    if (section === 'analytics') {
      fetchAnalytics();
    }
  }, [fetchAnalytics, section]);

  // Sidebar collapse state
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      const saved = localStorage.getItem('wint_sidebar');
      if (saved) setCollapsed(saved === 'collapsed');
    } catch {
      // ignore
    }
  }, []);

  const toggleSidebar = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('wint_sidebar', next ? 'collapsed' : 'expanded');
      } catch {
        // ignore
      }
      return next;
    });
  };

  return (
    <div className="quality-shell-container">
      {/* Sidebar styling to match Harsh & Dhanush layouts */}
      <style>{`
        .qa-dashboard-sidebar {
          width: 250px !important;
        }
        .qa-dashboard-sidebar.collapsed {
          width: 56px !important;
        }
        body:has(.qa-dashboard-sidebar) .topbar {
          padding-left: calc(16px + 250px) !important;
        }
        body:has(.qa-dashboard-sidebar.collapsed) .topbar {
          padding-left: calc(16px + 56px) !important;
        }
      `}</style>

      <div className="quality-shell-body">
        {/* Side Panel: CX QA Navigation */}
        <aside className={`quality-shell-sidebar qa-dashboard-sidebar${collapsed ? ' collapsed' : ''}`}>
          <div className="quality-shell-sidebar-head">
            {!collapsed && (
              <div className="quality-shell-sidebar-title font-semibold text-xs tracking-wider uppercase text-gray-500">
                CX QA
              </div>
            )}
            <button
              type="button"
              className="quality-shell-sidebar-toggle"
              onClick={toggleSidebar}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              aria-expanded={!collapsed}
              title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="11 17 6 12 11 7" />
                <polyline points="18 17 13 12 18 7" />
              </svg>
            </button>
          </div>

          <div className="space-y-1">
            {/* 1. Analytics */}
            <button
              type="button"
              onClick={() => setSection('analytics')}
              className={`quality-shell-sidebar-link text-left cursor-pointer ${
                section === 'analytics' ? 'active' : ''
              }`}
              style={{
                minHeight: 40,
                padding: '8px 12px',
              }}
            >
              <span className="flex-shrink-0">
                <AnalyticsIcon />
              </span>
              <span className="quality-shell-sidebar-label text-[13px]">Analytics</span>
            </button>

            {/* 2. Quality */}
            <button
              type="button"
              onClick={() => setSection('quality')}
              className={`quality-shell-sidebar-link text-left cursor-pointer ${
                section === 'quality' ? 'active' : ''
              }`}
              style={{
                minHeight: 40,
                padding: '8px 12px',
              }}
            >
              <span className="flex-shrink-0">
                <QualityShieldIcon />
              </span>
              <span className="quality-shell-sidebar-label text-[13px]">Quality</span>
            </button>

            {/* 3. AI Accuracy */}
            <button
              type="button"
              onClick={() => setSection('ai-accuracy')}
              className={`quality-shell-sidebar-link text-left cursor-pointer ${
                section === 'ai-accuracy' ? 'active' : ''
              }`}
              style={{
                minHeight: 40,
                padding: '8px 12px',
              }}
            >
              <span className="flex-shrink-0">
                <AiAccuracyIcon />
              </span>
              <span className="quality-shell-sidebar-label text-[13px]">AI Accuracy</span>
            </button>
          </div>
        </aside>

        {/* Main Content Area */}
        <main className="quality-shell-main" style={{ padding: 0 }}>
          {/* ══════════════════════════════════════════════════════════════════════
              SECTION 1: ANALYTICS
              Strict scope:
              1. Pending to Evaluate (Chats, Emails, Calls)
              2. Disputes Pending Review (Chats, Calls, Emails)
              3. AI Accurate vs AI Hallucinated counts
             ══════════════════════════════════════════════════════════════════════ */}
          {section === 'analytics' && (
            <div className="flex flex-col min-h-full bg-white">
              {/* Header */}
              <div className="sticky top-0 z-20 bg-white/95 backdrop-blur-xs border-b border-gray-200 px-8 py-3.5 flex items-center justify-between">
                <div>
                  <h2 className="text-base font-bold text-gray-900 tracking-tight">
                    QA Overview &amp; Evaluation Pipeline
                  </h2>
                </div>
              </div>

              {/* Main Analytics Content */}
              <div className="p-8 max-w-6xl space-y-8">
                {analyticsError && (
                  <div className="p-4 rounded-xl border border-gray-200 bg-gray-50 text-gray-700 text-xs">
                    {analyticsError}
                  </div>
                )}

                {/* ── CARD GROUP 1: PENDING EVALUATIONS ─────────────────────── */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wider flex items-center gap-2">
                        <span>Pending to Evaluate</span>
                        <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-800 border border-gray-200">
                          {analyticsData?.pending.total ?? '—'} Total
                        </span>
                        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 normal-case tracking-normal">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                          Live
                        </span>
                      </h3>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    {/* 1. Chats Pending */}
                    <div className="rounded-2xl border border-gray-200 bg-gray-50/50 p-5 flex flex-col justify-between hover:bg-gray-50 transition">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
                          <ChatBubbleIcon />
                          <span>Chats Pending</span>
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setQualityChannel('chats');
                            setSection('quality');
                          }}
                          className="text-[11px] font-semibold text-gray-700 hover:text-black flex items-center gap-1 cursor-pointer transition"
                        >
                          <span>Review</span>
                          <ArrowRightIcon />
                        </button>
                      </div>

                      <div className="mt-4">
                        <div className="text-3xl font-extrabold text-gray-900 tracking-tight font-mono">
                          {loadingAnalytics ? '—' : analyticsData?.pending.chats ?? 0}
                        </div>
                      </div>
                    </div>

                    {/* 2. Calls Pending */}
                    <div className="rounded-2xl border border-gray-200 bg-gray-50/50 p-5 flex flex-col justify-between hover:bg-gray-50 transition">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
                          <PhoneIcon />
                          <span>Calls Pending</span>
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setQualityChannel('calls');
                            setSection('quality');
                          }}
                          className="text-[11px] font-semibold text-gray-700 hover:text-black flex items-center gap-1 cursor-pointer transition"
                        >
                          <span>Review</span>
                          <ArrowRightIcon />
                        </button>
                      </div>

                      <div className="mt-4">
                        <div className="text-3xl font-extrabold text-gray-900 tracking-tight font-mono">
                          {loadingAnalytics ? '—' : analyticsData?.pending.calls ?? 0}
                        </div>
                      </div>
                    </div>

                    {/* 3. Emails Pending */}
                    <div className="rounded-2xl border border-gray-200 bg-gray-50/50 p-5 flex flex-col justify-between hover:bg-gray-50 transition">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
                          <MailIcon />
                          <span>Emails Pending</span>
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setQualityChannel('emails');
                            setSection('quality');
                          }}
                          className="text-[11px] font-semibold text-gray-700 hover:text-black flex items-center gap-1 cursor-pointer transition"
                        >
                          <span>Review</span>
                          <ArrowRightIcon />
                        </button>
                      </div>

                      <div className="mt-4">
                        <div className="text-3xl font-extrabold text-gray-900 tracking-tight font-mono">
                          {loadingAnalytics ? '—' : analyticsData?.pending.emails ?? 0}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* ── CARD GROUP 2: AI EVALUATION AUDIT (ACCURATE VS HALLUCINATED) */}
                <div className="space-y-3 pt-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wider flex items-center gap-2">
                        <span>AI Accuracy vs. Hallucination Breakdown</span>
                        {analyticsData?.aiAccuracy.total.accuracyRate != null && (analyticsData?.aiAccuracy.total.evaluated ?? 0) > 0 && (
                          <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-800 border border-gray-200">
                            {analyticsData.aiAccuracy.total.accuracyRate}% Accurate
                          </span>
                        )}
                      </h3>
                    </div>

                    {/* Period Filter: 7 days | 30 days | Custom range (scoped to AI Accuracy) */}
                    <div className="relative">
                      <div className="inline-flex border border-gray-300 rounded-lg overflow-hidden bg-white shadow-2xs">
                        <button
                          type="button"
                          onClick={() => handlePeriod('7')}
                          className={`h-8 px-3.5 text-xs font-medium cursor-pointer transition select-none ${
                            period === '7'
                              ? 'bg-black text-white font-semibold'
                              : 'bg-white text-gray-700 hover:bg-gray-50'
                          }`}
                        >
                          7 days
                        </button>
                        <button
                          type="button"
                          onClick={() => handlePeriod('30')}
                          className={`h-8 px-3.5 text-xs font-medium border-l border-gray-200 cursor-pointer transition select-none ${
                            period === '30'
                              ? 'bg-black text-white font-semibold'
                              : 'bg-white text-gray-700 hover:bg-gray-50'
                          }`}
                        >
                          30 days
                        </button>
                        <button
                          type="button"
                          onClick={() => handlePeriod('custom')}
                          className={`h-8 px-3.5 text-xs font-medium border-l border-gray-200 cursor-pointer transition select-none ${
                            period === 'custom'
                              ? 'bg-black text-white font-semibold'
                              : 'bg-white text-gray-700 hover:bg-gray-50'
                          }`}
                        >
                          {period === 'custom' && customFrom && customTo
                            ? `${fmtDateDisplay(customFrom)} – ${fmtDateDisplay(customTo)}`
                            : 'Custom range'}
                        </button>
                      </div>

                      {showPicker && (
                        <div className="absolute top-[calc(100%+8px)] right-0 z-50 shadow-2xl rounded-2xl border border-gray-100 bg-white">
                          <DateRangePicker
                            onApply={handleCustomApply}
                            onCancel={() => {
                              setShowPicker(false);
                              if (period === 'custom' && !customFrom) setPeriod('7');
                            }}
                            initialFrom={customFrom}
                            initialTo={customTo}
                          />
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Clean Monochrome Table */}
                  <div className="border border-gray-200 rounded-2xl overflow-hidden shadow-2xs">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="bg-gray-50/90 border-b border-gray-200 text-gray-600 font-semibold uppercase tracking-wider text-[11px]">
                          <th className="py-3 px-5">Channel</th>
                          <th className="py-3 px-4 text-center">Marked AI Accurate</th>
                          <th className="py-3 px-4 text-center">Marked AI Hallucinated</th>
                          <th className="py-3 px-5 text-right">AI Accuracy Rate</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {/* Chats Row */}
                        <tr className="hover:bg-gray-50/50 transition">
                          <td className="py-3.5 px-5 font-semibold text-gray-900 flex items-center gap-2">
                            <span className="text-gray-500"><ChatBubbleIcon /></span>
                            <span>Chats</span>
                          </td>
                          <td className="py-3.5 px-4 text-center font-mono font-semibold text-gray-900">
                            {loadingAnalytics || !analyticsData?.aiAccuracy.chats.evaluated ? '—' : analyticsData.aiAccuracy.chats.accurate}
                          </td>
                          <td className="py-3.5 px-4 text-center font-mono font-semibold text-gray-900">
                            {loadingAnalytics || !analyticsData?.aiAccuracy.chats.evaluated ? '—' : analyticsData.aiAccuracy.chats.hallucinated}
                          </td>
                          <td className="py-3.5 px-5 text-right font-mono font-bold text-gray-900">
                            {loadingAnalytics
                              ? '—'
                              : analyticsData?.aiAccuracy.chats.accuracyRate != null
                              ? `${analyticsData.aiAccuracy.chats.accuracyRate}%`
                              : '—'}
                          </td>
                        </tr>

                        {/* Calls Row */}
                        <tr className="hover:bg-gray-50/50 transition">
                          <td className="py-3.5 px-5 font-semibold text-gray-900 flex items-center gap-2">
                            <span className="text-gray-500"><PhoneIcon /></span>
                            <span>Calls</span>
                          </td>
                          <td className="py-3.5 px-4 text-center font-mono font-semibold text-gray-900">
                            {loadingAnalytics || !analyticsData?.aiAccuracy.calls.evaluated ? '—' : analyticsData.aiAccuracy.calls.accurate}
                          </td>
                          <td className="py-3.5 px-4 text-center font-mono font-semibold text-gray-900">
                            {loadingAnalytics || !analyticsData?.aiAccuracy.calls.evaluated ? '—' : analyticsData.aiAccuracy.calls.hallucinated}
                          </td>
                          <td className="py-3.5 px-5 text-right font-mono font-bold text-gray-900">
                            {loadingAnalytics
                              ? '—'
                              : analyticsData?.aiAccuracy.calls.accuracyRate != null
                              ? `${analyticsData.aiAccuracy.calls.accuracyRate}%`
                              : '—'}
                          </td>
                        </tr>

                        {/* Emails Row */}
                        <tr className="hover:bg-gray-50/50 transition">
                          <td className="py-3.5 px-5 font-semibold text-gray-900 flex items-center gap-2">
                            <span className="text-gray-500"><MailIcon /></span>
                            <span>Emails</span>
                          </td>
                          <td className="py-3.5 px-4 text-center font-mono font-semibold text-gray-900">
                            {loadingAnalytics || !analyticsData?.aiAccuracy.emails.evaluated ? '—' : analyticsData.aiAccuracy.emails.accurate}
                          </td>
                          <td className="py-3.5 px-4 text-center font-mono font-semibold text-gray-900">
                            {loadingAnalytics || !analyticsData?.aiAccuracy.emails.evaluated ? '—' : analyticsData.aiAccuracy.emails.hallucinated}
                          </td>
                          <td className="py-3.5 px-5 text-right font-mono font-bold text-gray-900">
                            {loadingAnalytics
                              ? '—'
                              : analyticsData?.aiAccuracy.emails.accuracyRate != null
                              ? `${analyticsData.aiAccuracy.emails.accuracyRate}%`
                              : '—'}
                          </td>
                        </tr>

                        {/* Overall Combined Total Row */}
                        <tr className="bg-gray-50/80 font-bold border-t border-gray-200">
                          <td className="py-3.5 px-5 text-gray-900 uppercase tracking-wider text-[11px]">
                            Total All Channels
                          </td>
                          <td className="py-3.5 px-4 text-center font-mono text-gray-900">
                            {loadingAnalytics || !analyticsData?.aiAccuracy.total.evaluated ? '—' : analyticsData.aiAccuracy.total.accurate}
                          </td>
                          <td className="py-3.5 px-4 text-center font-mono text-gray-900">
                            {loadingAnalytics || !analyticsData?.aiAccuracy.total.evaluated ? '—' : analyticsData.aiAccuracy.total.hallucinated}
                          </td>
                          <td className="py-3.5 px-5 text-right font-mono text-gray-900">
                            {loadingAnalytics
                              ? '—'
                              : analyticsData?.aiAccuracy.total.accuracyRate != null
                              ? `${analyticsData.aiAccuracy.total.accuracyRate}%`
                              : '—'}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* ── CARD GROUP 3: ROBYLON BOT — POORLY HANDLED DISPOSITIONS ── */}
                <div className="space-y-3 pt-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wider flex items-center gap-2">
                        <span>Robylon Bot — Poorly Handled Dispositions</span>
                        <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 border border-gray-200 normal-case tracking-normal">
                          Bot-Only Chats
                        </span>
                      </h3>
                    </div>
                    <span className="text-xs text-gray-500">
                      Sorted by lowest Avg Bot IQS ({period === 'custom' && customFrom && customTo ? `${fmtDateDisplay(customFrom)} – ${fmtDateDisplay(customTo)}` : `${period} days`})
                    </span>
                  </div>

                  <div className="border border-gray-200 rounded-2xl overflow-hidden shadow-2xs">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="bg-gray-50/90 border-b border-gray-200 text-gray-600 font-semibold uppercase tracking-wider text-[11px]">
                          <th className="py-3 px-5">Disposition</th>
                          <th className="py-3 px-4 text-center">Bot Chats</th>
                          <th className="py-3 px-4 text-center">Avg Bot IQS</th>
                          <th className="py-3 px-4 text-center">Low IQS (&lt;80%)</th>
                          <th className="py-3 px-4 text-center">CSAT %</th>
                          <th className="py-3 px-5 text-right">Bad CSAT</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {loadingAnalytics ? (
                          <tr>
                            <td colSpan={6} className="py-6 text-center text-gray-400">
                              Loading Robylon bot performance…
                            </td>
                          </tr>
                        ) : !analyticsData?.botPoorDispositions?.length ? (
                          <tr>
                            <td colSpan={6} className="py-6 text-center text-gray-400">
                              No poorly handled bot-only dispositions found for this period.
                            </td>
                          </tr>
                        ) : (
                          analyticsData.botPoorDispositions.map((row) => (
                            <tr key={row.disposition} className="hover:bg-gray-50/50 transition">
                              <td className="py-3 px-5 font-semibold text-gray-900">
                                {row.disposition}
                              </td>
                              <td className="py-3 px-4 text-center font-mono text-gray-700">
                                {row.volume}
                              </td>
                              <td className="py-3 px-4 text-center font-mono font-bold text-gray-900">
                                {row.avg_iqs != null ? `${row.avg_iqs}%` : '—'}
                              </td>
                              <td className="py-3 px-4 text-center font-mono font-semibold text-gray-900">
                                {row.low_iqs_count}{' '}
                                <span className="text-gray-400 font-normal">
                                  ({row.volume > 0 ? Math.round((row.low_iqs_count / row.volume) * 100) : 0}%)
                                </span>
                              </td>
                              <td className="py-3 px-4 text-center font-mono font-semibold text-gray-900">
                                {row.csat_pct != null ? `${row.csat_pct}%` : '—'}
                              </td>
                              <td className="py-3 px-5 text-right font-mono font-semibold text-gray-900">
                                {row.bad_csat_count}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════════════════
              SECTION 2: QUALITY
              Three toggles: Calls, Chats, Emails
              Each toggle displays the respective evaluation panel as currently
              available in the portal.
             ══════════════════════════════════════════════════════════════════════ */}
          {section === 'quality' && (
            <div className="flex flex-col min-h-full">
              {/* Sticky Channel Toggle Header */}
              <div className="sticky top-0 z-20 bg-white/95 backdrop-blur-xs border-b border-gray-200 px-6 py-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Channel:</span>
                  <div className="inline-flex p-1 bg-gray-100/90 rounded-xl text-xs font-semibold">
                    <button
                      type="button"
                      onClick={() => setQualityChannel('calls')}
                      className={`px-4 py-1.5 rounded-lg transition cursor-pointer ${
                        qualityChannel === 'calls'
                          ? 'bg-white text-gray-900 shadow-xs font-bold'
                          : 'text-gray-500 hover:text-gray-900'
                      }`}
                    >
                      Calls
                    </button>
                    <button
                      type="button"
                      onClick={() => setQualityChannel('chats')}
                      className={`px-4 py-1.5 rounded-lg transition cursor-pointer ${
                        qualityChannel === 'chats'
                          ? 'bg-white text-gray-900 shadow-xs font-bold'
                          : 'text-gray-500 hover:text-gray-900'
                      }`}
                    >
                      Chats
                    </button>
                    <button
                      type="button"
                      onClick={() => setQualityChannel('emails')}
                      className={`px-4 py-1.5 rounded-lg transition cursor-pointer ${
                        qualityChannel === 'emails'
                          ? 'bg-white text-gray-900 shadow-xs font-bold'
                          : 'text-gray-500 hover:text-gray-900'
                      }`}
                    >
                      Emails
                    </button>
                  </div>
                </div>
              </div>

              {/* Render Respective Evaluation Panel */}
              <div className="p-6">
                {qualityChannel === 'calls' && (
                  <CallEvaluationPage hideDisputes={true} />
                )}
                {qualityChannel === 'chats' && (
                  <ChatEvaluationPage role="quality" hideDisputes={true} />
                )}
                {qualityChannel === 'emails' && (
                  <EmailEvaluationPage embedded={false} hideDisputes={true} />
                )}
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════════════════
              SECTION 3: AI ACCURACY
              3 toggles: Calls, Chats, Emails
              2 filters: AI Accurate, AI Hallucinated
             ══════════════════════════════════════════════════════════════════════ */}
          {section === 'ai-accuracy' && (
            <div className="flex flex-col min-h-full">
              {/* Sticky Header: 3 Channel Toggles & 2 AI Filters */}
              <div className="sticky top-0 z-20 bg-white/95 backdrop-blur-xs border-b border-gray-200 px-6 py-3 flex items-center justify-between flex-wrap gap-4">
                {/* 3 Channel Toggles: Calls, Chats, Emails */}
                <div className="flex items-center gap-3">
                  <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Channel:</span>
                  <div className="inline-flex p-1 bg-gray-100/90 rounded-xl text-xs font-semibold">
                    <button
                      type="button"
                      onClick={() => setAiAccuracyChannel('calls')}
                      className={`px-4 py-1.5 rounded-lg transition cursor-pointer ${
                        aiAccuracyChannel === 'calls'
                          ? 'bg-white text-gray-900 shadow-xs font-bold'
                          : 'text-gray-500 hover:text-gray-900'
                      }`}
                    >
                      Calls
                    </button>
                    <button
                      type="button"
                      onClick={() => setAiAccuracyChannel('chats')}
                      className={`px-4 py-1.5 rounded-lg transition cursor-pointer ${
                        aiAccuracyChannel === 'chats'
                          ? 'bg-white text-gray-900 shadow-xs font-bold'
                          : 'text-gray-500 hover:text-gray-900'
                      }`}
                    >
                      Chats
                    </button>
                    <button
                      type="button"
                      onClick={() => setAiAccuracyChannel('emails')}
                      className={`px-4 py-1.5 rounded-lg transition cursor-pointer ${
                        aiAccuracyChannel === 'emails'
                          ? 'bg-white text-gray-900 shadow-xs font-bold'
                          : 'text-gray-500 hover:text-gray-900'
                      }`}
                    >
                      Emails
                    </button>
                  </div>
                </div>

                {/* Two Filters: AI Accurate and AI Hallucinated */}
                <div className="flex items-center gap-3">
                  <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Status:</span>
                  <div className="inline-flex p-1 bg-gray-100/90 rounded-xl text-xs font-semibold">
                    <button
                      type="button"
                      onClick={() => setAiAccuracyFilter('accurate')}
                      className={`px-4 py-1.5 rounded-lg transition cursor-pointer ${
                        aiAccuracyFilter === 'accurate'
                          ? 'bg-white text-gray-900 shadow-xs font-bold'
                          : 'text-gray-500 hover:text-gray-900'
                      }`}
                    >
                      AI Accurate
                    </button>
                    <button
                      type="button"
                      onClick={() => setAiAccuracyFilter('hallucinated')}
                      className={`px-4 py-1.5 rounded-lg transition cursor-pointer ${
                        aiAccuracyFilter === 'hallucinated'
                          ? 'bg-white text-gray-900 shadow-xs font-bold'
                          : 'text-gray-500 hover:text-gray-900'
                      }`}
                    >
                      AI Hallucinated
                    </button>
                  </div>
                </div>
              </div>

              {/* Render AI Accuracy Table */}
              <div className="p-6">
                <AiAccuracyTable channel={aiAccuracyChannel} filter={aiAccuracyFilter} />
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
