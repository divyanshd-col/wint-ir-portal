'use client';

import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import QualityChatsPage from '@/components/tl/QualityChatsPage';
import TLQualityCallsPage from '@/components/tl/TLQualityCallsPage';
import TLEmailQualityPage from '@/components/tl/TLEmailQualityPage';
import MemberAnalyticsDashboard from '@/components/tl/MemberAnalyticsDashboard';
import TLTeamAnalyticsDashboard from '@/components/tl/TLTeamAnalyticsDashboard';
import AgentReportsClient from '@/components/ir/AgentReportsClient';

// ── Icons (Clean Monochrome) ──────────────────────────────────────────────────

const TrophyIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
    <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
    <path d="M4 22h16" />
    <path d="M10 14.66V17c0 .55-.45 1-1 1H7" />
    <path d="M14 14.66V17c0 .55.45 1 1 1h2" />
    <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
  </svg>
);

const DisputeIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="8" x2="12" y2="12" />
    <line x1="12" y1="16" x2="12.01" y2="16" />
  </svg>
);

const QualityShieldIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
  </svg>
);

interface Props {
  tlName?: string;
  tlEmail?: string;
  initialSection?: 'performance' | 'disputes' | 'quality';
}

export default function SimplifiedTLDashboard({
  tlName = 'Harsh',
  tlEmail = 'harsh.baid@wintwealth.com',
  initialSection = 'performance',
}: Props) {
  const searchParams = useSearchParams();
  const querySection = searchParams.get('section') as ('performance' | 'disputes' | 'quality') | null;
  const queryChannel = searchParams.get('channel') as ('calls' | 'chats' | 'emails') | null;
  const querySub = searchParams.get('sub') as ('member_analytics' | 'scorecard' | 'team_analytics') | null;

  // Active Section: 'performance' | 'disputes' | 'quality'
  const [section, setSection] = useState<'performance' | 'disputes' | 'quality'>(
    querySection && ['performance', 'disputes', 'quality'].includes(querySection)
      ? querySection
      : initialSection
  );

  // Section 1: Team Performance & Scorecard toggles: Team Analytics, Member Analytics, Scorecard
  const [perfSubTab, setPerfSubTab] = useState<'member_analytics' | 'scorecard' | 'team_analytics'>(
    querySub && ['member_analytics', 'scorecard', 'team_analytics'].includes(querySub)
      ? querySub
      : 'team_analytics'
  );
  const [selectedMemberAgent, setSelectedMemberAgent] = useState<string | undefined>(undefined);

  // Section 2: Disputes channel toggles: Chats, Calls, Emails
  const [disputeChannel, setDisputeChannel] = useState<'chats' | 'calls' | 'emails'>(
    queryChannel && ['chats', 'calls', 'emails'].includes(queryChannel)
      ? queryChannel
      : 'chats'
  );

  // Section 3: Quality channel toggles: Calls, Chats, Emails
  const [qualityChannel, setQualityChannel] = useState<'calls' | 'chats' | 'emails'>(
    queryChannel && ['calls', 'chats', 'emails'].includes(queryChannel)
      ? queryChannel
      : 'calls'
  );

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
      {/* Dynamic sidebar width styling for TL Dashboard to ensure long wording fits cleanly */}
      <style>{`
        .tl-dashboard-sidebar {
          width: 268px !important;
        }
        .tl-dashboard-sidebar.collapsed {
          width: 56px !important;
        }
        body:has(.tl-dashboard-sidebar) .topbar {
          padding-left: calc(16px + 268px) !important;
        }
        body:has(.tl-dashboard-sidebar.collapsed) .topbar {
          padding-left: calc(16px + 56px) !important;
        }
      `}</style>
      <div className="quality-shell-body">
        {/* Side Panel */}
        <aside className={`quality-shell-sidebar tl-dashboard-sidebar${collapsed ? ' collapsed' : ''}`}>
          <div className="quality-shell-sidebar-head">
            {!collapsed && (
              <div className="quality-shell-sidebar-title font-semibold text-xs tracking-wider uppercase text-gray-500">
                CX Team Lead
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
            {/* 1. Team Performance & Scorecard */}
            <button
              type="button"
              onClick={() => setSection('performance')}
              className={`quality-shell-sidebar-link text-left cursor-pointer ${
                section === 'performance' ? 'active' : ''
              }`}
              style={{
                height: 'auto',
                minHeight: 40,
                padding: '8px 12px',
                whiteSpace: 'normal',
                lineHeight: 1.3,
              }}
            >
              <span className="flex-shrink-0">
                <TrophyIcon />
              </span>
              <span className="quality-shell-sidebar-label text-[13px] leading-snug break-words">
                Team Performance &amp; Scorecard
              </span>
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

            {/* 3. Disputes */}
            <button
              type="button"
              onClick={() => setSection('disputes')}
              className={`quality-shell-sidebar-link text-left cursor-pointer ${
                section === 'disputes' ? 'active' : ''
              }`}
              style={{
                minHeight: 40,
                padding: '8px 12px',
              }}
            >
              <span className="flex-shrink-0">
                <DisputeIcon />
              </span>
              <span className="quality-shell-sidebar-label text-[13px]">Disputes</span>
            </button>
          </div>
        </aside>

        {/* Main Content Area */}
        <main className="quality-shell-main" style={{ padding: 0 }}>
          {/* ══════════════════════════════════════════════════════════════════════
              SECTION 1: TEAM PERFORMANCE & SCORECARD
              Toggles: Member Analytics, Scorecard, Team Analytics
             ══════════════════════════════════════════════════════════════════════ */}
          {section === 'performance' && (
            <div className="flex flex-col min-h-full">
              {/* Sticky Sub-Toggle Header */}
              <div className="sticky top-0 z-20 bg-white/95 backdrop-blur-xs border-b border-gray-200 px-6 py-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">View:</span>
                  <div className="inline-flex p-1 bg-gray-100/90 rounded-xl text-xs font-semibold">
                    <button
                      type="button"
                      onClick={() => setPerfSubTab('team_analytics')}
                      className={`px-4 py-1.5 rounded-lg transition cursor-pointer ${
                        perfSubTab === 'team_analytics'
                          ? 'bg-white text-gray-900 shadow-xs font-bold'
                          : 'text-gray-500 hover:text-gray-900'
                      }`}
                    >
                      Team Analytics
                    </button>
                    <button
                      type="button"
                      onClick={() => setPerfSubTab('member_analytics')}
                      className={`px-4 py-1.5 rounded-lg transition cursor-pointer ${
                        perfSubTab === 'member_analytics'
                          ? 'bg-white text-gray-900 shadow-xs font-bold'
                          : 'text-gray-500 hover:text-gray-900'
                      }`}
                    >
                      Member Analytics
                    </button>
                    <button
                      type="button"
                      onClick={() => setPerfSubTab('scorecard')}
                      className={`px-4 py-1.5 rounded-lg transition cursor-pointer ${
                        perfSubTab === 'scorecard'
                          ? 'bg-white text-gray-900 shadow-xs font-bold'
                          : 'text-gray-500 hover:text-gray-900'
                      }`}
                    >
                      Scorecard
                    </button>
                  </div>
                </div>
              </div>

              {/* Render Selected View */}
              <div className="p-6">
                {perfSubTab === 'member_analytics' && (
                  <MemberAnalyticsDashboard tlName={tlName} initialAgent={selectedMemberAgent} />
                )}
                {perfSubTab === 'scorecard' && (
                  <AgentReportsClient agentName={tlName} role="tl" />
                )}
                {perfSubTab === 'team_analytics' && (
                  <TLTeamAnalyticsDashboard
                    onSelectAgent={(agentName) => {
                      setSelectedMemberAgent(agentName);
                      setPerfSubTab('member_analytics');
                    }}
                  />
                )}
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════════════════
              SECTION 2: QUALITY
              Toggles: Calls, Chats, Emails
             ══════════════════════════════════════════════════════════════════════ */}
          {section === 'quality' && (
            <div className="flex flex-col min-h-full">
              {/* Sticky Sub-Toggle Header */}
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

              {/* Render Selected Channel Quality Evaluation Panel */}
              <div className="p-6">
                {qualityChannel === 'calls' && (
                  <TLQualityCallsPage mode="evaluated-only" hideHeader initialTab="evaluated" />
                )}
                {qualityChannel === 'chats' && (
                  <QualityChatsPage mode="evaluated-only" hideHeader initialTab="evaluated" />
                )}
                {qualityChannel === 'emails' && (
                  <TLEmailQualityPage mode="evaluated-only" hideHeader initialTab="evaluated" />
                )}
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════════════════
              SECTION 3: DISPUTES
              Filters: Chats, Calls, Emails
             ══════════════════════════════════════════════════════════════════════ */}
          {section === 'disputes' && (
            <div className="flex flex-col min-h-full">
              {/* Sticky Sub-Toggle Header */}
              <div className="sticky top-0 z-20 bg-white/95 backdrop-blur-xs border-b border-gray-200 px-6 py-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Channel:</span>
                  <div className="inline-flex p-1 bg-gray-100/90 rounded-xl text-xs font-semibold">
                    <button
                      type="button"
                      onClick={() => setDisputeChannel('chats')}
                      className={`px-4 py-1.5 rounded-lg transition cursor-pointer ${
                        disputeChannel === 'chats'
                          ? 'bg-white text-gray-900 shadow-xs font-bold'
                          : 'text-gray-500 hover:text-gray-900'
                      }`}
                    >
                      Chats
                    </button>
                    <button
                      type="button"
                      onClick={() => setDisputeChannel('calls')}
                      className={`px-4 py-1.5 rounded-lg transition cursor-pointer ${
                        disputeChannel === 'calls'
                          ? 'bg-white text-gray-900 shadow-xs font-bold'
                          : 'text-gray-500 hover:text-gray-900'
                      }`}
                    >
                      Calls
                    </button>
                    <button
                      type="button"
                      onClick={() => setDisputeChannel('emails')}
                      className={`px-4 py-1.5 rounded-lg transition cursor-pointer ${
                        disputeChannel === 'emails'
                          ? 'bg-white text-gray-900 shadow-xs font-bold'
                          : 'text-gray-500 hover:text-gray-900'
                      }`}
                    >
                      Emails
                    </button>
                  </div>
                </div>
              </div>

              {/* Render Selected Channel Disputes */}
              <div className="p-6">
                {disputeChannel === 'chats' && (
                  <QualityChatsPage mode="disputes-only" hideHeader initialTab="disputes" />
                )}
                {disputeChannel === 'calls' && (
                  <TLQualityCallsPage mode="disputes-only" hideHeader initialTab="disputes" />
                )}
                {disputeChannel === 'emails' && (
                  <TLEmailQualityPage mode="disputes-only" hideHeader initialTab="raised" />
                )}
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
